import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "enjoy-azure-transcribe-"));
const audio = Buffer.from("synthetic wav audio");

async function rejectsWithCode(operation, code) {
  await assert.rejects(operation, (error) => {
    assert.equal(error?.name, "LearningAsrError");
    assert.equal(error?.code, code);
    return true;
  });
}

function azureResponse(text = "Hello world") {
  return {
    durationMilliseconds: 2_000,
    combinedPhrases: [{ text }],
    phrases: text
      ? [
          { text: "Hello", offsetMilliseconds: 40, durationMilliseconds: 320 },
          { text: "world", offsetMilliseconds: 400, durationMilliseconds: 600 },
        ]
      : [],
  };
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

  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(azureResponse()), { status: 200 });
  };
  const mai = subject.createLearningAsrProvider("azure_mai", {
    azure: {
      key: "azure-secret-one",
      endpoint: "https://ENJOY-SPEECH.cognitiveservices.azure.com/",
      region: "eastus",
    },
  }, fetchImpl);

  assert.equal(mai.engine, "azure_mai");
  assert.equal(mai.model, "MAI-Transcribe-2");
  assert.equal(mai.preferWhole, true);
  assert.equal(mai.maxWholeRequestBytes, 250_000_000);
  assert.equal(mai.minRequestIntervalMs, 0);
  assert.equal(mai.identity.includes("azure-secret-one"), false);
  assert.deepEqual(await mai.transcribe(audio, {
    format: "wav",
    language: "en-US",
    duration: 2,
  }), {
    transcript: "Hello world",
    segments: [
      { text: "Hello", start: 0.04, end: 0.36 },
      { text: "world", start: 0.4, end: 1 },
    ],
  });

  assert.equal(
    calls[0].url,
    "https://enjoy-speech.cognitiveservices.azure.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.headers["Ocp-Apim-Subscription-Key"], "azure-secret-one");
  assert.equal("Content-Type" in calls[0].init.headers, false);
  assert.ok(calls[0].init.body instanceof FormData);
  const maiFile = calls[0].init.body.get("audio");
  assert.ok(maiFile instanceof Blob);
  assert.equal(maiFile.name, "audio.wav");
  assert.equal(maiFile.type, "audio/wav");
  assert.equal(Buffer.from(await maiFile.arrayBuffer()).equals(audio), true);
  assert.deepEqual(JSON.parse(calls[0].init.body.get("definition")), {
    locales: ["en"],
    enhancedMode: {
      enabled: true,
      model: "MAI-Transcribe-2",
      modelOptions: { timestamps: "word" },
    },
  });

  const sameMaiIdentity = subject.createLearningAsrProvider("azure_mai", {
    azure: {
      key: "different-secret",
      endpoint: "https://enjoy-speech.cognitiveservices.azure.com",
    },
  }, fetchImpl);
  assert.equal(sameMaiIdentity.identity, mai.identity);

  const speech = subject.createLearningAsrProvider("azure_speech", {
    azure: {
      key: "azure-speech-secret",
      endpoint: "https://enjoy-speech.cognitiveservices.azure.com",
    },
  }, fetchImpl);
  assert.equal(speech.engine, "azure_speech");
  assert.equal(speech.model, "azure-speech-fast");
  assert.equal(speech.identity.includes("azure-speech-secret"), false);
  await speech.transcribe(audio, { format: "mp3", language: "en-US", duration: 2 });
  const englishSpeechForm = calls[1].init.body;
  assert.deepEqual(JSON.parse(englishSpeechForm.get("definition")), { locales: ["en-US"] });
  assert.equal("enhancedMode" in JSON.parse(englishSpeechForm.get("definition")), false);
  assert.equal(englishSpeechForm.get("audio").name, "audio.mp3");
  assert.equal(englishSpeechForm.get("audio").type, "audio/mpeg");

  await speech.transcribe(audio, { format: "wav", language: "vi-VN", duration: 2 });
  assert.deepEqual(JSON.parse(calls[2].init.body.get("definition")), { locales: ["vi-VN"] });

  await speech.transcribe(audio, { format: "wav", language: "en", duration: 2 });
  assert.deepEqual(JSON.parse(calls[3].init.body.get("definition")), { locales: ["en-US"] });
  await speech.transcribe(audio, { format: "wav", language: "vi", duration: 2 });
  assert.deepEqual(JSON.parse(calls[4].init.body.get("definition")), { locales: ["vi-VN"] });
  await speech.transcribe(audio, { format: "wav", language: "en-GB", duration: 2 });
  assert.deepEqual(JSON.parse(calls[5].init.body.get("definition")), { locales: ["en-GB"] });

  for (const endpoint of [
    "http://demo.cognitiveservices.azure.com",
    "https://user:pass@demo.cognitiveservices.azure.com",
    "https://demo.cognitiveservices.azure.com:8443",
    "https://demo.cognitiveservices.azure.com/path",
    "https://demo.cognitiveservices.azure.com?api-key=secret",
    "https://demo.cognitiveservices.azure.com#fragment",
    "https://cognitiveservices.azure.com",
    "https://demo.cognitiveservices.azure.com.evil.example",
  ]) {
    assert.throws(
      () => subject.createLearningAsrProvider("azure_speech", {
        azure: { key: "secret", endpoint },
      }, fetchImpl),
      (error) => error?.code === "asr_failed" && !error.message.includes("secret"),
    );
  }
  assert.throws(
    () => subject.createLearningAsrProvider("azure_speech", {
      azure: { key: "   ", endpoint: "https://demo.cognitiveservices.azure.com" },
    }, fetchImpl),
    (error) => error?.code === "asr_auth" && !error.message.includes("demo"),
  );

  const durationCalls = calls.length;
  await rejectsWithCode(
    () => speech.transcribe(audio, { format: "wav", language: "en", duration: 7_200 }),
    "asr_invalid_audio",
  );
  assert.equal(calls.length, durationCalls, "Out-of-contract duration must not be uploaded");

  for (const invalidResponse of [
    {},
    { combinedPhrases: [{ text: "Hello" }] },
    { combinedPhrases: "Hello", phrases: [] },
    { combinedPhrases: [{ text: 42 }], phrases: [] },
    { combinedPhrases: [{ text: "Hello" }], phrases: [{ text: "Hello" }] },
    {
      combinedPhrases: [{ text: "Hello" }],
      phrases: [{ text: "Hello", offsetMilliseconds: -1, durationMilliseconds: 10 }],
    },
    {
      combinedPhrases: [{ text: "Hello" }],
      phrases: [{ text: "Hello", offsetMilliseconds: 0, durationMilliseconds: 0 }],
    },
  ]) {
    const invalid = subject.createLearningAsrProvider("azure_speech", {
      azure: { key: "secret", endpoint: "https://demo.cognitiveservices.azure.com" },
    }, async () => new Response(JSON.stringify(invalidResponse), { status: 200 }));
    await rejectsWithCode(
      () => invalid.transcribe(audio, { format: "wav", language: "en", duration: 2 }),
      "asr_invalid_response",
    );
  }

  const silence = subject.createLearningAsrProvider("azure_speech", {
    azure: { key: "secret", endpoint: "https://demo.cognitiveservices.azure.com" },
  }, async () => new Response(JSON.stringify(azureResponse("")), { status: 200 }));
  await rejectsWithCode(
    () => silence.transcribe(audio, { format: "wav", language: "en", duration: 2 }),
    "asr_no_speech",
  );

  for (const [status, code] of [
    [401, "asr_auth"],
    [403, "asr_auth"],
    [402, "asr_quota"],
    [408, "asr_timeout"],
    [500, "asr_network"],
  ]) {
    const failing = subject.createLearningAsrProvider("azure_mai", {
      azure: { key: "never-expose-key", endpoint: "https://demo.cognitiveservices.azure.com" },
    }, async () => new Response("provider detail never-expose-key", { status }));
    await assert.rejects(
      () => failing.transcribe(audio, { format: "wav", language: "en", duration: 2 }),
      (error) => error?.code === code && !error.message.includes("never-expose-key"),
    );
  }

  const rateLimited = subject.createLearningAsrProvider("azure_mai", {
    azure: { key: "secret", endpoint: "https://demo.cognitiveservices.azure.com" },
  }, async () => new Response("hidden", {
    status: 429,
    headers: { "retry-after": "999" },
  }));
  await assert.rejects(
    () => rateLimited.transcribe(audio, { format: "wav", language: "en", duration: 2 }),
    (error) => error?.code === "asr_rate_limit" && error.retryAfterMs === 120_000,
  );

  const oversizedResponse = subject.createLearningAsrProvider("azure_speech", {
    azure: { key: "secret", endpoint: "https://demo.cognitiveservices.azure.com" },
  }, async () => new Response("{}", {
    status: 200,
    headers: { "content-length": String(8 * 1024 * 1024 + 1) },
  }));
  await rejectsWithCode(
    () => oversizedResponse.transcribe(audio, { format: "wav", language: "en", duration: 2 }),
    "asr_invalid_response",
  );

  const redirected = subject.createLearningAsrProvider("azure_speech", {
    azure: { key: "redirect-secret", endpoint: "https://demo.cognitiveservices.azure.com" },
  }, async () => new Response(null, {
    status: 307,
    headers: { location: "https://attacker.example/collect" },
  }));
  await assert.rejects(
    () => redirected.transcribe(audio, { format: "wav", language: "en", duration: 2 }),
    (error) => error?.code === "asr_network" && !error.message.includes("redirect-secret"),
  );

  const networkFailure = subject.createLearningAsrProvider("azure_speech", {
    azure: { key: "network-secret", endpoint: "https://demo.cognitiveservices.azure.com" },
  }, async () => {
    throw new Error("socket failed with network-secret");
  });
  await assert.rejects(
    () => networkFailure.transcribe(audio, { format: "wav", language: "en", duration: 2 }),
    (error) => error?.code === "asr_network" && !error.message.includes("network-secret"),
  );

  const preAborted = new AbortController();
  preAborted.abort();
  let cancellationFetches = 0;
  const cancellable = subject.createLearningAsrProvider("azure_speech", {
    azure: { key: "secret", endpoint: "https://demo.cognitiveservices.azure.com" },
  }, async (_url, init) => {
    cancellationFetches += 1;
    return await new Promise((_resolve, reject) => {
      init.signal.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    });
  });
  await rejectsWithCode(
    () => cancellable.transcribe(audio, {
      format: "wav",
      language: "en",
      duration: 2,
      signal: preAborted.signal,
    }),
    "asr_cancelled",
  );
  assert.equal(cancellationFetches, 0);

  const activeAbort = new AbortController();
  const pending = cancellable.transcribe(audio, {
    format: "wav",
    language: "en",
    duration: 2,
    signal: activeAbort.signal,
  });
  activeAbort.abort();
  await rejectsWithCode(() => pending, "asr_cancelled");

  console.log("Azure direct transcription provider checks passed.");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
