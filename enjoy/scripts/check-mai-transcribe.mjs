import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-mai-transcribe-"));

const makeWav = (seconds, sampleRate = 16_000, channels = 1) => {
  const samples = seconds * sampleRate;
  const blockAlign = channels * 2;
  const dataLength = samples * blockAlign;
  const wav = Buffer.alloc(44 + dataLength);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataLength, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * blockAlign, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataLength, 40);
  return wav;
};

try {
  const output = path.join(temp, "mai-transcribe-service.mjs");
  await build({
    stdin: {
      contents: `export * from "./src/main/mai-transcribe/service.ts";`,
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
    MAI_TRANSCRIBE_MODEL,
    MaiTranscribeError,
    buildMaiTranscribeRequest,
    chunkPcmWav,
    createMaiTranscribeService,
    normalizeMaiTranscribeResponse,
  } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

  assert.equal(MAI_TRANSCRIBE_MODEL, "microsoft/mai-transcribe-2");
  assert.deepEqual(buildMaiTranscribeRequest(Buffer.from("wav"), "en-US"), {
    model: MAI_TRANSCRIBE_MODEL,
    input_audio: { data: Buffer.from("wav").toString("base64"), format: "wav" },
    language: "en",
    response_format: "verbose_json",
    timestamp_granularities: ["segment", "word"],
    provider: { options: { azure: { diarization: { enabled: true } } } },
  });

  const normalized = normalizeMaiTranscribeResponse({
    text: " Hello world. ",
    language: "en",
    duration: 2,
    segments: [{ id: 1, start: 0.2, end: 1.8, text: " Hello world. ", speaker: "A" }],
    words: [{ word: "Hello", start: 0.2, end: 0.7, speaker: "A" }],
    usage: { seconds: 2, cost: 0.001 },
  });
  assert.equal(normalized.transcript, "Hello world.");
  assert.deepEqual(normalized.segments, [
    { text: "Hello world.", start: 0.2, end: 1.8, speaker: "A" },
  ]);
  assert.deepEqual(normalized.words, [
    { word: "Hello", start: 0.2, end: 0.7, speaker: "A" },
  ]);
  assert.deepEqual(
    normalizeMaiTranscribeResponse({ text: "", segments: [], words: [] }),
    { transcript: "", segments: [], words: [] }
  );
  assert.throws(
    () => normalizeMaiTranscribeResponse({ text: "bad", segments: [{ text: "x", start: 2, end: 1 }] }),
    /invalid segment/i
  );

  const chunks = chunkPcmWav(makeWav(11), { maxChunkSeconds: 5 });
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.map((chunk) => chunk.startTime), [0, 5, 10]);
  assert.deepEqual(chunks.map((chunk) => chunk.duration), [5, 5, 1]);
  assert.ok(chunks.every((chunk) => chunk.bytes.subarray(0, 4).toString() === "RIFF"));

  const calls = [];
  const progress = [];
  const service = createMaiTranscribeService({
    credential: async () => "test-key",
    readAudio: async () => makeWav(11),
    maxChunkSeconds: 5,
    requestTimeoutMs: 1_000,
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      const index = calls.length - 1;
      return new Response(JSON.stringify({
        text: `chunk ${index + 1}`,
        duration: index === 2 ? 1 : 5,
        segments: [{ id: index, start: 0, end: index === 2 ? 1 : 5, text: `chunk ${index + 1}` }],
        words: [{ word: "chunk", start: 0, end: 0.5 }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const result = await service.transcribe(
    { jobId: "job-offset", audioUrl: "enjoy://audio.wav", language: "en-US" },
    { onProgress: (event) => progress.push(event) }
  );
  assert.equal(calls.length, 3);
  assert.equal(result.transcript, "chunk 1 chunk 2 chunk 3");
  assert.deepEqual(result.segments.map((segment) => segment.start), [0, 5, 10]);
  assert.deepEqual(result.words.map((word) => word.start), [0, 5, 10]);
  assert.deepEqual(progress.map((event) => event.percent), [0, 33, 67, 100]);

  let silentCall = 0;
  const silentProgress = [];
  const silentService = createMaiTranscribeService({
    credential: async () => "test-key",
    readAudio: async () => makeWav(11),
    maxChunkSeconds: 5,
    fetch: async () => {
      silentCall += 1;
      if (silentCall === 2) {
        return new Response(JSON.stringify({
          text: "",
          duration: 5,
          segments: [],
          words: [],
          usage: { seconds: 5, cost: 0.002 },
        }), { status: 200 });
      }
      const duration = silentCall === 3 ? 1 : 5;
      return new Response(JSON.stringify({
        text: `speech ${silentCall}`,
        duration,
        segments: [{ start: 0, end: duration, text: `speech ${silentCall}` }],
        words: [{ word: "speech", start: 0, end: Math.min(0.5, duration) }],
        usage: { seconds: duration, cost: 0.001 },
      }), { status: 200 });
    },
  });
  const silentResult = await silentService.transcribe(
    { jobId: "job-silent-middle", audioUrl: "x", language: "en" },
    { onProgress: (event) => silentProgress.push(event) }
  );
  assert.equal(silentResult.transcript, "speech 1 speech 3");
  assert.deepEqual(silentResult.segments.map((segment) => segment.start), [0, 10]);
  assert.deepEqual(silentResult.words.map((word) => word.start), [0, 10]);
  assert.deepEqual(silentProgress.map((event) => event.percent), [0, 33, 67, 100]);
  assert.deepEqual(silentResult.usage, { seconds: 11, cost: 0.004 });

  const allSilentService = createMaiTranscribeService({
    credential: async () => "test-key",
    readAudio: async () => makeWav(1),
    fetch: async () => new Response(JSON.stringify({
      text: "",
      duration: 1,
      segments: [],
      words: [],
      usage: { seconds: 1, cost: 0.001 },
    }), { status: 200 }),
  });
  await assert.rejects(
    allSilentService.transcribe({ jobId: "job-all-silent", audioUrl: "x", language: "en" }),
    (error) => error instanceof MaiTranscribeError && error.code === "mai_no_speech"
  );

  let silentTailCall = 0;
  const silentTailService = createMaiTranscribeService({
    credential: async () => "test-key",
    readAudio: async () => makeWav(6),
    maxChunkSeconds: 5,
    fetch: async () => {
      silentTailCall += 1;
      return new Response(JSON.stringify(silentTailCall === 1 ? {
        text: "Spoken start.",
        duration: 5,
        segments: [{ start: 0, end: 5, text: "Spoken start." }],
        words: [{ word: "Spoken", start: 0, end: 0.5 }],
      } : {
        text: "",
        duration: 1,
        segments: [],
        words: [],
      }), { status: 200 });
    },
  });
  const silentTail = await silentTailService.transcribe({
    jobId: "job-silent-tail",
    audioUrl: "x",
    language: "en",
  });
  assert.equal(silentTail.transcript, "Spoken start.");
  assert.equal(silentTail.segments.length, 1);

  const slightOvershootService = createMaiTranscribeService({
    credential: async () => "test-key",
    readAudio: async () => makeWav(1),
    fetch: async () => new Response(JSON.stringify({
      text: "Hello.",
      duration: 1,
      segments: [{ start: 0, end: 1.1, text: "Hello." }],
      words: [{ word: "Hello", start: 0, end: 1.1 }],
    }), { status: 200 }),
  });
  const slightOvershoot = await slightOvershootService.transcribe({
    jobId: "job-small-rounding",
    audioUrl: "x",
    language: "en",
  });
  assert.equal(slightOvershoot.segments[0].end, 1);
  assert.equal(slightOvershoot.words[0].end, 1);

  const outOfBoundsService = createMaiTranscribeService({
    credential: async () => "test-key",
    readAudio: async () => makeWav(1),
    fetch: async () => new Response(JSON.stringify({
      text: "Hello.",
      duration: 1,
      segments: [{ start: 10, end: 11, text: "Hello." }],
      words: [{ word: "Hello", start: 10, end: 11 }],
    }), { status: 200 }),
  });
  await assert.rejects(
    outOfBoundsService.transcribe({ jobId: "job-bounds", audioUrl: "x", language: "en" }),
    (error) => error instanceof MaiTranscribeError && error.code === "mai_invalid_response"
  );

  const zeroDurationService = createMaiTranscribeService({
    credential: async () => "test-key",
    readAudio: async () => makeWav(1),
    fetch: async () => new Response(JSON.stringify({
      text: "Hello.",
      duration: 1,
      segments: [{ start: 0.5, end: 0.5, text: "Hello." }],
      words: [],
    }), { status: 200 }),
  });
  await assert.rejects(
    zeroDurationService.transcribe({ jobId: "job-zero-duration", audioUrl: "x", language: "en" }),
    (error) => error instanceof MaiTranscribeError && error.code === "mai_invalid_response"
  );

  const authService = createMaiTranscribeService({
    credential: async () => "private-key",
    readAudio: async () => makeWav(1),
    fetch: async () => new Response("private-key rejected", { status: 401 }),
  });
  await assert.rejects(
    authService.transcribe({ jobId: "job-auth", audioUrl: "x", language: "en" }),
    (error) => error instanceof MaiTranscribeError && error.code === "mai_auth" && !error.message.includes("private-key")
  );

  const quotaService = createMaiTranscribeService({
    credential: async () => "test-key",
    readAudio: async () => makeWav(1),
    fetch: async () => new Response("quota", { status: 429 }),
  });
  await assert.rejects(
    quotaService.transcribe({ jobId: "job-quota", audioUrl: "x", language: "en" }),
    (error) => error instanceof MaiTranscribeError && error.code === "mai_quota"
  );

  const malformedService = createMaiTranscribeService({
    credential: async () => "test-key",
    readAudio: async () => makeWav(1),
    fetch: async () => new Response("not-json", { status: 200 }),
  });
  await assert.rejects(
    malformedService.transcribe({ jobId: "job-json", audioUrl: "x", language: "en" }),
    (error) => error instanceof MaiTranscribeError && error.code === "mai_invalid_response"
  );

  const timeoutService = createMaiTranscribeService({
    credential: async () => "test-key",
    readAudio: async () => makeWav(1),
    requestTimeoutMs: 10,
    fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
  });
  await assert.rejects(
    timeoutService.transcribe({ jobId: "job-timeout", audioUrl: "x", language: "en" }),
    (error) => error instanceof MaiTranscribeError && error.code === "mai_timeout"
  );

  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    service.transcribe(
      { jobId: "job-cancel", audioUrl: "x", language: "en" },
      { signal: cancelled.signal }
    ),
    (error) => error instanceof MaiTranscribeError && error.code === "mai_cancelled"
  );

  assert.throws(
    () => chunkPcmWav(Buffer.from("not a wav")),
    (error) => error instanceof MaiTranscribeError && error.code === "mai_invalid_audio"
  );

  const longWav = makeWav(323.63975, 16_000, 2);
  const longChunks = chunkPcmWav(longWav);
  assert.equal(longChunks.length, 6);
  assert.deepEqual(longChunks.slice(0, 5).map((chunk) => chunk.duration), [
    60, 60, 60, 60, 60,
  ]);
  assert.ok(Math.abs(longChunks[5].duration - 23.63975) < 0.000001);
  assert.deepEqual(longChunks.map((chunk) => chunk.startTime), [
    0, 60, 120, 180, 240, 300,
  ]);
  const longRequestBytes = longChunks.map((chunk) =>
    Buffer.byteLength(
      JSON.stringify(buildMaiTranscribeRequest(chunk.bytes, "en"))
    )
  );
  assert.deepEqual(longRequestBytes.slice(0, 5), [
    5_120_299, 5_120_299, 5_120_299, 5_120_299, 5_120_299,
  ]);
  assert.ok(longRequestBytes.every((bytes) => bytes < 8_000_000));
  assert.ok(longChunks.every((chunk) => (chunk.bytes.length - 44) % 4 === 0));
  assert.equal(
    longChunks.reduce((bytes, chunk) => bytes + chunk.bytes.length - 44, 0),
    longWav.length - 44
  );

  const guardOutput = path.join(temp, "mai-transcribe-guard.mjs");
  await build({
    stdin: {
      contents: `export { createLearningIpcGuard } from "./src/main/learning/ipc-guard.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: guardOutput,
    logLevel: "silent",
  });
  const { createLearningIpcGuard } = await import(
    `${pathToFileURL(guardOutput).href}?test=${Date.now()}`
  );
  const expectedUrl = "file:///Applications/Enjoy.app/index.html";
  const guard = createLearningIpcGuard({ webContentsId: 7, expectedUrl });
  const mainFrame = { url: expectedUrl, parent: null };
  mainFrame.top = mainFrame;
  const sender = { id: 7, isDestroyed: () => false, mainFrame };
  assert.doesNotThrow(() => guard.assertSender({ sender, senderFrame: mainFrame }));
  assert.throws(
    () => guard.assertSender({ sender: { ...sender, id: 8 }, senderFrame: mainFrame }),
    /learning_ipc_sender_denied/
  );
  const subframe = { url: expectedUrl, parent: mainFrame, top: mainFrame };
  assert.throws(
    () => guard.assertSender({ sender, senderFrame: subframe }),
    /learning_ipc_sender_denied/
  );
  const changedFrame = { url: "https://untrusted.example/", parent: null };
  changedFrame.top = changedFrame;
  assert.throws(
    () => guard.assertSender({ sender: { ...sender, mainFrame: changedFrame }, senderFrame: changedFrame }),
    /learning_ipc_sender_denied/
  );

  const [hookSource, formSource, settingsSource, ipcSource, transcriptionsSource, lookupSource] = await Promise.all([
    readFile(path.join(root, "src/renderer/hooks/use-transcribe.tsx"), "utf8"),
    readFile(path.join(root, "src/renderer/components/transcriptions/transcription-create-form.tsx"), "utf8"),
    readFile(path.join(root, "src/renderer/components/preferences/stt-settings.tsx"), "utf8"),
    readFile(path.join(root, "src/main/mai-transcribe/ipc.ts"), "utf8"),
    readFile(path.join(root, "src/renderer/hooks/use-transcriptions.tsx"), "utf8"),
    readFile(path.join(root, "src/renderer/components/widgets/lookup/lookup-widget.tsx"), "utf8"),
  ]);
  assert.match(hookSource, /isLearningAsrEngine\(service\)/);
  assert.match(hookSource, /EnjoyApp\.learningAsr\.start/);
  assert.doesNotMatch(hookSource, /EnjoyApp\.maiTranscribe\.start/);
  assert.match(hookSource, /alignSegments[\s\S]*wordToSentenceTimeline/);
  assert.match(hookSource, /runVersion/);
  assert.match(formSource, /transcription-service-mai/);
  assert.match(settingsSource, /setProviderConfig\("openrouter"/);
  assert.doesNotMatch(transcriptionsSource, /webApi\.transcriptions/);
  assert.match(
    transcriptionsSource,
    /videos\.update[\s\S]*ensureActive\(runVersion\)[\s\S]*transcriptions\.update/
  );
  assert.match(transcriptionsSource, /committingRef\.current = true[\s\S]*transcriptions\.update/);
  assert.doesNotMatch(
    transcriptionsSource,
    /setTranscribing\(false\)[\s\S]*transcriptions\.update/
  );
  assert.doesNotMatch(ipcSource, /ipcMain\.handle\(START_CHANNEL/);
  assert.doesNotMatch(ipcSource, /ipcMain\.handle\(CANCEL_CHANNEL/);
  const serviceSource = await readFile(
    path.join(root, "src/main/mai-transcribe/service.ts"),
    "utf8"
  );
  assert.match(serviceSource, /DEFAULT_MAX_CHUNK_SECONDS = 60/);
  assert.match(serviceSource, /MAX_JSON_REQUEST_BYTES = 8_000_000/);
  assert.match(serviceSource, /8 MB safety limit/);
  const findRecordingSource = lookupSource.match(
    /const findRecording = \(\) => \{([\s\S]*?)\n  \};/
  )?.[1] || "";
  assert.match(findRecordingSource, /recordings[\s\S]*\.findAll\(/);
  assert.match(findRecordingSource, /where: \{ referenceText: word \}/);
  assert.match(findRecordingSource, /limit: 1/);
  assert.match(findRecordingSource, /recordings\?\.\[0\]/);
  assert.doesNotMatch(findRecordingSource, /\.findOne\(/);

  console.log(`MAI Transcribe checks passed (${calls.length} chunk requests).`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
