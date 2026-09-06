import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { build } from "esbuild";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import OpenAIClient from "openai";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-ai-speech-"));

try {
  const output = path.join(temp, "speech-models.mjs");
  await build({
    stdin: {
      contents: `export * from "./src/lib/speech-models.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });

  const {
    ENJOYAI_TTS_MODELS,
    OPENAI_TTS_MODELS,
    OPENAI_TTS_RESPONSE_FORMAT,
    OPENAI_TTS_VOICES,
    buildOpenAiSpeechRequest,
    buildOpenAiTranscriptionRequest,
    ensureAudioArrayBuffer,
    normalizeOpenAiTranscriptionModel,
    normalizeOpenAiTranscriptionResponse,
    normalizeSpeechModel,
    resolveTtsModel,
    sanitizeSpeechError,
    selectCanonicalOpenAiConfig,
  } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

  const tests = [];
  const test = async (name, callback) => {
    await callback();
    tests.push(name);
  };

  const readRequestBody = async (body) => {
    if (typeof body === "string") return body;
    if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
    if (!body || typeof body[Symbol.asyncIterator] !== "function") return "";

    const chunks = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  };

  const getHeader = (headers, name) => {
    if (headers instanceof Headers) return headers.get(name);
    return headers?.[name] || headers?.[name.toLowerCase()] || null;
  };

  await test("keeps legacy models and adds direct OpenAI TTS", () => {
    assert.deepEqual([...ENJOYAI_TTS_MODELS], ["tts-1", "tts-1-hd"]);
    assert.deepEqual([...OPENAI_TTS_MODELS], [
      "tts-1",
      "tts-1-hd",
      "gpt-4o-mini-tts",
    ]);
    assert.deepEqual([...OPENAI_TTS_VOICES], [
      "alloy",
      "echo",
      "fable",
      "onyx",
      "nova",
      "shimmer",
    ]);
  });

  await test("normalizes prefixed models without changing endpoint ownership", () => {
    assert.equal(normalizeSpeechModel(" openai/tts-1-hd "), "tts-1-hd");
    assert.deepEqual(resolveTtsModel("enjoyai", "openai/tts-1"), {
      engine: "enjoyai",
      provider: "openai",
      model: "openai/tts-1",
      apiModel: "tts-1",
    });
    assert.deepEqual(resolveTtsModel("openai", "openai/gpt-4o-mini-tts"), {
      engine: "openai",
      provider: "openai",
      model: "gpt-4o-mini-tts",
      apiModel: "gpt-4o-mini-tts",
    });
    assert.deepEqual(resolveTtsModel("enjoyai", "azure/speech"), {
      engine: "enjoyai",
      provider: "azure",
      model: "azure/speech",
    });
  });

  await test("sends mp3 through the OpenAI SDK transport", async () => {
    const fakeApiKey = "sk-test-speech-only";
    const calls = [];
    const request = buildOpenAiSpeechRequest({
      engine: "openai",
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      text: "A short test sentence.",
    });
    const client = new OpenAIClient({
      apiKey: fakeApiKey,
      baseURL: "https://speech.test/v1",
      maxRetries: 0,
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      },
    });
    const response = await client.audio.speech.create(request);
    const body = JSON.parse(await readRequestBody(calls[0].init.body));

    assert.equal(calls[0].url, "https://speech.test/v1/audio/speech");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(
      getHeader(calls[0].init.headers, "authorization"),
      `Bearer ${fakeApiKey}`
    );
    assert.deepEqual(body, {
      input: "A short test sentence.",
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      response_format: OPENAI_TTS_RESPONSE_FORMAT,
    });
    assert.equal(body.input.includes(fakeApiKey), false);
    assert.equal(ensureAudioArrayBuffer(await response.arrayBuffer()).byteLength, 3);
  });

  await test("rejects empty, unknown model, and unknown voice before API calls", () => {
    assert.throws(
      () => buildOpenAiSpeechRequest({
        engine: "openai",
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        text: "   ",
      }),
      /TTS text must not be empty/
    );
    assert.throws(
      () => buildOpenAiSpeechRequest({
        engine: "openai",
        model: "unknown-tts",
        voice: "alloy",
        text: "Hello",
      }),
      /not supported/
    );
    assert.throws(
      () => buildOpenAiSpeechRequest({
        engine: "openai",
        model: "gpt-4o-mini-tts",
        voice: "invalid-voice",
        text: "Hello",
      }),
      /not supported/
    );
  });

  await test("normalizes legacy STT and builds the verified file contract", () => {
    assert.equal(normalizeOpenAiTranscriptionModel(undefined), "whisper-1");
    assert.equal(normalizeOpenAiTranscriptionModel(" gpt-transcribe "), "gpt-transcribe");
    const file = { name: "audio.mp3" };
    assert.deepEqual(buildOpenAiTranscriptionRequest({
      file,
      model: "gpt-transcribe",
      language: "en-US",
    }), {
      file,
      model: "gpt-transcribe",
      response_format: "verbose_json",
      timestamp_granularities: ["word", "segment"],
      language: "en",
    });
  });

  await test("sends gpt-transcribe as multipart without realtime fields", async () => {
    const fakeApiKey = "sk-test-transcribe-only";
    const calls = [];
    const client = new OpenAIClient({
      apiKey: fakeApiKey,
      baseURL: "https://speech.test/v1",
      maxRetries: 0,
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({
          text: "Hello",
          words: [{ word: "Hello", start: 0, end: 0.4 }],
          segments: [{ text: "Hello", start: 0, end: 0.4 }],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const request = buildOpenAiTranscriptionRequest({
      file: new File(["audio"], "audio.mp3", { type: "audio/mpeg" }),
      model: "gpt-transcribe",
      language: "en-US",
    });
    const response = await client.audio.transcriptions.create(request);
    const body = await readRequestBody(calls[0].init.body);

    assert.equal(calls[0].url, "https://speech.test/v1/audio/transcriptions");
    assert.equal(calls[0].init.method, "POST");
    assert.match(
      getHeader(calls[0].init.headers, "content-type"),
      /^multipart\/form-data; boundary=/
    );
    assert.equal(
      getHeader(calls[0].init.headers, "authorization"),
      `Bearer ${fakeApiKey}`
    );
    assert.match(body, /name="model"\r\n\r\ngpt-transcribe/);
    assert.match(body, /name="response_format"\r\n\r\nverbose_json/);
    assert.match(body, /name="timestamp_granularities\[\]"\r\n\r\nword/);
    assert.match(body, /name="timestamp_granularities\[\]"\r\n\r\nsegment/);
    assert.match(body, /name="language"\r\n\r\nen/);
    assert.equal(body.includes("gpt-live-transcribe"), false);
    assert.equal(body.includes("logprobs"), false);
    assert.equal(body.includes(fakeApiKey), false);
    assert.equal(response.text, "Hello");
  });

  await test("preserves words and leaves missing segments for DTW fallback", () => {
    const words = [{ word: "Hello", start: 0, end: 0.4 }];
    const normalized = normalizeOpenAiTranscriptionResponse({
      text: "Hello",
      words,
    });
    assert.deepEqual(normalized.words, words);
    assert.deepEqual(normalized.segments, []);
  });

  await test("redacts a key from provider errors and rejects invalid audio", async () => {
    assert.equal(
      sanitizeSpeechError(new Error("request failed sk-test-speech-only"), "sk-test-speech-only"),
      "request failed [redacted]"
    );
    assert.throws(() => ensureAudioArrayBuffer(undefined), /invalid audio/);
    assert.throws(() => ensureAudioArrayBuffer(new ArrayBuffer(0)), /empty audio/);
  });

  await test("uses canonical OpenAI config and lazily falls back for legacy data", () => {
    let legacyReads = 0;
    const legacyConfig = { key: "legacy-key" };
    assert.deepEqual(
      selectCanonicalOpenAiConfig(undefined, () => {
        legacyReads += 1;
        return legacyConfig;
      }),
      legacyConfig
    );
    const clearedConfig = { key: "" };
    assert.deepEqual(
      selectCanonicalOpenAiConfig(clearedConfig, () => {
        legacyReads += 1;
        return legacyConfig;
      }),
      clearedConfig
    );
    assert.equal(legacyReads, 1);
  });

  const transcribeSource = await readFile(
    path.join(root, "src/renderer/hooks/use-transcribe.tsx"),
    "utf8"
  );
  assert.match(
    transcribeSource,
    /else if \(transcript\)[\s\S]*EnjoyApp\.echogarden\.align\(/
  );
  const speechSource = await readFile(
    path.join(root, "src/renderer/hooks/use-speech.tsx"),
    "utf8"
  );
  assert.match(speechSource, /resolveTtsModel/);
  assert.doesNotMatch(speechSource, /model\.match\(/);
  const mainSpeechSource = await readFile(
    path.join(root, "src/main/db/models/speech.ts"),
    "utf8"
  );
  assert.match(mainSpeechSource, /selectCanonicalOpenAiConfig/);

  console.log(`PASS: ${tests.length} speech contract cases.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
