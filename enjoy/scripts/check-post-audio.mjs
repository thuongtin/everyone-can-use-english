import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const helperPath = path.join(root, "src/renderer/lib/post-audio-transcription.ts");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-post-audio-"));

const validTimeline = [
  {
    type: "segment",
    text: "Hello",
    startTime: 0,
    endTime: 2,
  },
];
const validResult = {
  transcript: "Hello",
  timeline: validTimeline,
  wordTimeline: [],
  language: "en-US",
  inputRawAudio: {},
};
const makeTranscription = (result = validResult, targetMd5 = "md5-a") => ({
  id: "transcription-1",
  targetId: "audio-1",
  targetType: "Audio",
  targetMd5,
  state: "finished",
  engine: "whisper",
  model: "base",
  language: "en-US",
  result,
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z",
});

try {
  const source = await readFile(helperPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    fileName: helperPath,
  });
  const compiledPath = path.join(temp, "post-audio-transcription.mjs");
  await writeFile(compiledPath, compiled.outputText, "utf8");
  const {
    getCurrentPostAudioSegment,
    isStorageAudioSource,
    requestPostAudioTranscription,
  } = await import(`${pathToFileURL(compiledPath).href}?test=${Date.now()}`);

  const tests = [];
  const test = async (name, callback) => {
    await callback();
    tests.push(name);
  };

  await test("empty transcription response clears the transcript", async () => {
    const calls = [];
    const result = await requestPostAudioTranscription(
      {
        transcriptions: async (params) => {
          calls.push(params);
          return { transcriptions: [] };
        },
      },
      "md5-a"
    );

    assert.equal(result, undefined);
    assert.deepEqual(calls, [{ targetMd5: "md5-a" }]);
  });

  await test("a transcription without result is ignored", async () => {
    const result = await requestPostAudioTranscription(
      {
        transcriptions: async () => ({
          transcriptions: [{ ...makeTranscription(), result: undefined }],
        }),
      },
      "md5-a"
    );

    assert.equal(result, undefined);
  });

  await test("a malformed result object cannot break segment selection", async () => {
    const malformedResult = {
      transcript: "Hello",
      timeline: { text: "not an array" },
    };
    const result = await requestPostAudioTranscription(
      {
        transcriptions: async () => ({
          transcriptions: [makeTranscription(malformedResult)],
        }),
      },
      "md5-a"
    );

    assert.equal(result, undefined);
    assert.doesNotThrow(() => {
      assert.equal(
        getCurrentPostAudioSegment(makeTranscription(malformedResult), 1),
        undefined
      );
    });
  });

  await test("a rejected transcription request resolves as no transcript", async () => {
    const result = await requestPostAudioTranscription(
      {
        transcriptions: async () => {
          throw new Error("network failure");
        },
      },
      "md5-a"
    );

    assert.equal(result, undefined);
  });

  await test("a pending request for the previous md5 is ignored", async () => {
    let resolveOld;
    let currentMd5 = "md5-a";
    const oldRequest = requestPostAudioTranscription(
      {
        transcriptions: () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      },
      "md5-a",
      () => currentMd5 === "md5-a"
    );
    await Promise.resolve();
    currentMd5 = "md5-b";
    resolveOld({ transcriptions: [makeTranscription(validResult, "md5-a")] });

    assert.equal(await oldRequest, undefined);
  });

  await test("a pending request is ignored after unmount", async () => {
    let resolvePending;
    let mounted = true;
    const request = requestPostAudioTranscription(
      {
        transcriptions: () =>
          new Promise((resolve) => {
            resolvePending = resolve;
          }),
      },
      "md5-a",
      () => mounted
    );
    await Promise.resolve();
    mounted = false;
    resolvePending({ transcriptions: [makeTranscription()] });

    assert.equal(await request, undefined);
  });

  await test("missing API returns without starting a request", async () => {
    const result = await requestPostAudioTranscription(undefined, "md5-a");
    assert.equal(result, undefined);
  });

  await test("missing sourceUrl does not select a waveform player", async () => {
    assert.equal(
      isStorageAudioSource(undefined, ["https://storage.example.test"]),
      false
    );
    assert.equal(
      isStorageAudioSource("https://storage.example.test/audio.mp3", [
        "https://storage.example.test",
      ]),
      true
    );
  });

  await test("valid alignment and legacy segments remain selectable", async () => {
    assert.deepEqual(
      getCurrentPostAudioSegment(makeTranscription(), 1),
      validTimeline[0]
    );

    const legacySegment = {
      offsets: { from: 0, to: 2000 },
      text: "Hello",
      timestamps: { from: "00:00:00.000", to: "00:00:02.000" },
    };
    assert.deepEqual(
      getCurrentPostAudioSegment(
        makeTranscription([legacySegment]),
        1
      ),
      legacySegment
    );
  });

  console.log(`PASS: ${tests.length} post-audio regression cases.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
