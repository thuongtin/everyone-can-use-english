import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "enjoy-asr-providers-"));
const audio = Buffer.from("synthetic audio");

async function rejectsWithCode(operation, code) {
  await assert.rejects(operation, (error) => {
    assert.equal(error?.name, "LearningAsrError");
    assert.equal(error?.code, code);
    return true;
  });
}

try {
  const output = path.join(temporaryDirectory, "providers.mjs");
  await build({
    entryPoints: [path.join(root, "src/main/learning-asr/providers.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });
  const subject = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

  const cloudflareCalls = [];
  const cloudflareFetch = async (url, init) => {
    cloudflareCalls.push({ url, init });
    return new Response(JSON.stringify({
      ok: true,
      result: { text: " Xin chào ", segments: [{ text: " Xin chào ", start: 0, end: 1.2 }] },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const cloudflare = subject.createLearningAsrProvider("cloudflare_workers_ai", {
    cloudflare: { baseUrl: "https://EXAMPLE.workers.dev/", token: "secret-cf-token" },
  }, cloudflareFetch);
  assert.equal(cloudflare.engine, "cloudflare_workers_ai");
  assert.equal(cloudflare.model, "@cf/openai/whisper-large-v3-turbo");
  assert.equal(cloudflare.preferWhole, true);
  assert.equal(cloudflare.minRequestIntervalMs, 0);
  assert.equal(cloudflare.identity.includes("secret-cf-token"), false);
  assert.deepEqual(await cloudflare.transcribe(audio, {
    format: "mp3",
    language: "vi-VN",
    duration: 1.2,
  }), {
    transcript: "Xin chào",
    segments: [{ text: "Xin chào", start: 0, end: 1.2 }],
  });
  assert.equal(cloudflareCalls[0].url, "https://example.workers.dev/v1/transcriptions");
  assert.equal(cloudflareCalls[0].init.method, "POST");
  assert.equal(cloudflareCalls[0].init.redirect, "manual");
  assert.equal(cloudflareCalls[0].init.headers.Authorization, "Bearer secret-cf-token");
  assert.equal(cloudflareCalls[0].init.headers["Content-Type"], "audio/mpeg");
  assert.equal(cloudflareCalls[0].init.headers["X-Audio-Language"], "vi");
  assert.equal(Buffer.from(cloudflareCalls[0].init.body).equals(audio), true);

  await cloudflare.transcribe(audio, { format: "wav", language: "en-US", duration: 1 });
  assert.equal(cloudflareCalls[1].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(cloudflareCalls[1].init.body), {
    audio: audio.toString("base64"),
    language: "en",
  });
  const sameCloudflareIdentity = subject.createLearningAsrProvider("cloudflare_workers_ai", {
    cloudflare: { baseUrl: "https://example.workers.dev", token: "different-secret" },
  }, cloudflareFetch);
  assert.equal(sameCloudflareIdentity.identity, cloudflare.identity);

  let maiCall;
  const mai = subject.createLearningAsrProvider("mai_transcribe", {
    mai: { key: "secret-mai-key" },
  }, async (url, init) => {
    maiCall = { url, init };
    return new Response(JSON.stringify({
      text: "hello world",
      segments: [{ text: "hello world", start: 0.1, end: 1.5 }],
    }), { status: 200 });
  });
  assert.equal(mai.engine, "mai_transcribe");
  assert.equal(mai.model, "microsoft/mai-transcribe-2");
  assert.equal(mai.preferWhole, false);
  assert.equal(mai.minRequestIntervalMs, 7_000);
  assert.equal(mai.identity.includes("secret-mai-key"), false);
  assert.equal((await mai.transcribe(audio, { format: "wav", language: "en-US", duration: 2 })).transcript, "hello world");
  assert.equal(maiCall.url, "https://openrouter.ai/api/v1/audio/transcriptions");
  assert.equal(maiCall.init.headers.Authorization, "Bearer secret-mai-key");
  assert.equal(maiCall.init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(maiCall.init.body), {
    model: "microsoft/mai-transcribe-2",
    input_audio: { data: audio.toString("base64"), format: "wav" },
    language: "en",
    response_format: "verbose_json",
    timestamp_granularities: ["segment", "word"],
    provider: { options: { azure: { diarization: { enabled: true } } } },
  });

  const openAiCalls = [];
  const openAiFetch = async (url, init) => {
    openAiCalls.push({ url, init });
    return new Response(JSON.stringify({
      text: "OpenAI transcript",
      segments: [{ text: "OpenAI transcript", start: 0, end: 1 }],
    }), { status: 200 });
  };
  const whisper = subject.createLearningAsrProvider("openai", {
    openai: {
      key: "secret-openai-key",
      baseUrl: "https://api.example.test/openai/v1/",
      model: "whisper-1",
    },
  }, openAiFetch);
  assert.equal(whisper.model, "whisper-1");
  assert.equal(whisper.preferWhole, true);
  assert.equal(whisper.maxWholeRequestBytes, 25_000_000);
  assert.equal(whisper.minRequestIntervalMs, 0);
  assert.deepEqual(await whisper.transcribe(audio, { format: "wav", language: "fr-FR", duration: 1 }), {
    transcript: "OpenAI transcript",
    segments: [{ text: "OpenAI transcript", start: 0, end: 1 }],
  });
  assert.equal(openAiCalls[0].url, "https://api.example.test/openai/v1/audio/transcriptions");
  assert.equal(openAiCalls[0].init.headers.Authorization, "Bearer secret-openai-key");
  assert.equal("Content-Type" in openAiCalls[0].init.headers, false);
  assert.ok(openAiCalls[0].init.body instanceof FormData);
  assert.equal(openAiCalls[0].init.body.get("model"), "whisper-1");
  assert.equal(openAiCalls[0].init.body.get("response_format"), "verbose_json");
  assert.deepEqual(openAiCalls[0].init.body.getAll("timestamp_granularities[]"), ["word", "segment"]);
  assert.equal(openAiCalls[0].init.body.get("language"), "fr");
  const wavFile = openAiCalls[0].init.body.get("file");
  assert.ok(wavFile instanceof Blob);
  assert.equal(wavFile.type, "audio/wav");
  assert.equal(wavFile.name, "audio.wav");
  assert.equal(Buffer.from(await wavFile.arrayBuffer()).equals(audio), true);

  const gpt = subject.createLearningAsrProvider("openai", {
    openai: { key: "openai-key", model: "gpt-transcribe" },
  }, openAiFetch);
  assert.equal(gpt.preferWhole, false, "Text-only models must retain bounded window alignment");
  await gpt.transcribe(audio, { format: "mp3", language: "", duration: 1 });
  const gptForm = openAiCalls[1].init.body;
  assert.equal(gptForm.get("model"), "gpt-transcribe");
  assert.equal(gptForm.get("response_format"), "json");
  assert.deepEqual(gptForm.getAll("timestamp_granularities[]"), []);
  assert.equal(gptForm.get("file").type, "audio/mpeg");
  const callsBeforeOversize = openAiCalls.length;
  await rejectsWithCode(
    () => whisper.transcribe(Buffer.alloc(25_000_001), { format: "mp3", language: "en", duration: 3600 }),
    "asr_invalid_audio",
  );
  assert.equal(openAiCalls.length, callsBeforeOversize, "Oversized OpenAI input must never be uploaded");

  assert.throws(
    () => subject.createLearningAsrProvider("openai", {
      openai: { key: "key", model: "invented-model" },
    }, openAiFetch),
    (error) => error?.code === "asr_model_unsupported",
  );

  for (const [status, code] of [[401, "asr_auth"], [403, "asr_auth"], [402, "asr_quota"], [408, "asr_timeout"], [504, "asr_timeout"], [500, "asr_network"]]) {
    const provider = subject.createLearningAsrProvider("mai_transcribe", { mai: { key: "key" } }, async () =>
      new Response("raw provider secret detail", { status }));
    await assert.rejects(
      () => provider.transcribe(audio, { format: "wav", language: "en", duration: 1 }),
      (error) => error?.code === code && !error.message.includes("raw provider secret detail"),
    );
  }

  const rateLimited = subject.createLearningAsrProvider("mai_transcribe", { mai: { key: "key" } }, async () =>
    new Response("do not expose", { status: 429, headers: { "retry-after": "999" } }));
  await assert.rejects(
    () => rateLimited.transcribe(audio, { format: "wav", language: "en", duration: 1 }),
    (error) => error?.code === "asr_rate_limit" && error.retryAfterMs === 120_000 && !error.message.includes("do not expose"),
  );

  const oversized = subject.createLearningAsrProvider("mai_transcribe", { mai: { key: "key" } }, async () =>
    new Response("{}", { status: 200, headers: { "content-length": String(8 * 1024 * 1024 + 1) } }));
  await rejectsWithCode(
    () => oversized.transcribe(audio, { format: "wav", language: "en", duration: 1 }),
    "asr_invalid_response",
  );

  const preAborted = new AbortController();
  preAborted.abort();
  let cancelledFetches = 0;
  const cancellable = subject.createLearningAsrProvider("mai_transcribe", { mai: { key: "key" } }, async (_url, init) => {
    cancelledFetches += 1;
    return await new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  });
  await rejectsWithCode(
    () => cancellable.transcribe(audio, { format: "wav", language: "en", duration: 1, signal: preAborted.signal }),
    "asr_cancelled",
  );
  assert.equal(cancelledFetches, 0);
  const activeAbort = new AbortController();
  const pendingCancellation = cancellable.transcribe(audio, {
    format: "wav",
    language: "en",
    duration: 1,
    signal: activeAbort.signal,
  });
  activeAbort.abort();
  await rejectsWithCode(() => pendingCancellation, "asr_cancelled");

  const networkFailure = subject.createLearningAsrProvider("mai_transcribe", { mai: { key: "never leak this key" } }, async () => {
    throw new Error("socket failed with never leak this key");
  });
  await assert.rejects(
    () => networkFailure.transcribe(audio, { format: "wav", language: "en", duration: 1 }),
    (error) => error?.code === "asr_network" && !error.message.includes("never leak this key"),
  );

  assert.deepEqual(subject.validateProviderTranscript({
    transcript: " text ",
    segments: [{ text: " text ", start: 0, end: 1.01 }],
  }, 1), { transcript: "text", segments: [{ text: "text", start: 0, end: 1 }] });
  for (const invalid of [
    {},
    { transcript: 42 },
    { transcript: "text", segments: "bad" },
    { transcript: "text", segments: [{ text: "x", start: -1, end: 1 }] },
    { transcript: "text", segments: [{ text: "x", start: 1, end: 0 }] },
  ]) {
    assert.throws(() => subject.validateProviderTranscript(invalid, 1), (error) => error?.code === "asr_invalid_response");
  }

  const originalSetTimeout = globalThis.setTimeout;
  const deadlines = [];
  globalThis.setTimeout = (callback, milliseconds, ...args) => {
    deadlines.push(milliseconds);
    return originalSetTimeout(callback, milliseconds, ...args);
  };
  try {
    await cloudflare.transcribe(audio, { format: "wav", language: "en", duration: 60 });
    await cloudflare.transcribe(audio, { format: "mp3", language: "en", duration: 722 });
    await mai.transcribe(audio, { format: "wav", language: "en", duration: 60 });
    assert.deepEqual(deadlines, [90_000, 16 * 60_000, 90_000]);
  } finally { globalThis.setTimeout = originalSetTimeout; }

  console.log("learning ASR provider checks passed");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
