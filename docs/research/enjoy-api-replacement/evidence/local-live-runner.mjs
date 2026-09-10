import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const [repo, outputDir] = process.argv.slice(2);
if (!repo || !outputDir) throw new Error("Usage: node local-live-runner.mjs REPO OUTPUT_DIR");

const importFromRepo = async relativePath => import(pathToFileURL(path.join(repo, relativePath)).href);
const Echogarden = await importFromRepo("enjoy/node_modules/echogarden/dist/api/API.js");
const { default: ffmpegPath } = await importFromRepo("enjoy/node_modules/ffmpeg-static/index.js");
Echogarden.setGlobalOption("ffmpegPath", ffmpegPath);
Echogarden.setGlobalOption("logLevel", "info");

const jfkAudio = path.join(outputDir, "jfk.wav");
const dialogueAudio = path.join(outputDir, "dialogue.wav");
const jfkReference = (await readFile(path.join(outputDir, "jfk-reference.txt"), "utf8")).trim();
const dialogueReference = JSON.parse(await readFile(path.join(outputDir, "dialogue-reference.json"), "utf8")).text;
const whisperCppExecutable = path.join(repo, "enjoy/.vite/build/lib/whisper/main");

const flattenTimeline = timeline => {
  const entries = [];
  const visit = (items, depth = 0) => {
    for (const item of items ?? []) {
      entries.push({ ...item, depth, timeline: undefined });
      visit(item.timeline, depth + 1);
    }
  };
  visit(timeline);
  return entries;
};

const timelineStats = timeline => {
  const entries = flattenTimeline(timeline);
  const byType = {};
  for (const entry of entries) byType[entry.type] = (byType[entry.type] ?? 0) + 1;
  const invalidTimes = entries.filter(entry =>
    !Number.isFinite(entry.startTime)
    || !Number.isFinite(entry.endTime)
    || entry.startTime < 0
    || entry.endTime < entry.startTime
  ).length;
  return { topLevel: timeline?.length ?? 0, total: entries.length, byType, invalidTimes };
};

const words = text => text.toLowerCase().replace(/[^a-z0-9']+/g, " ").trim().split(/\s+/).filter(Boolean);
const wordErrorRate = (reference, hypothesis) => {
  const expected = words(reference);
  const actual = words(hypothesis);
  const rows = Array.from({ length: expected.length + 1 }, () => Array(actual.length + 1).fill(0));
  for (let i = 0; i <= expected.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= actual.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= expected.length; i += 1) {
    for (let j = 1; j <= actual.length; j += 1) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (expected[i - 1] === actual[j - 1] ? 0 : 1),
      );
    }
  }
  const edits = rows[expected.length][actual.length];
  return { edits, referenceWords: expected.length, hypothesisWords: actual.length, wer: expected.length ? edits / expected.length : null };
};

const compact = result => ({
  transcript: result.transcript,
  language: result.language,
  timeline: result.timeline,
  wordTimeline: result.wordTimeline,
});

const tasks = [
  {
    id: "local-integrated-jfk-recognize",
    reference: jfkReference,
    run: () => Echogarden.recognize(jfkAudio, {
      engine: "whisper",
      language: "en",
      crop: false,
      whisper: { model: "tiny.en", encoderProvider: "cpu", decoderProvider: "cpu", seed: 1 },
    }),
  },
  {
    id: "local-integrated-jfk-align-whisper",
    reference: jfkReference,
    run: () => Echogarden.align(jfkAudio, jfkReference, {
      engine: "whisper",
      language: "en",
      crop: false,
      whisper: { model: "tiny.en", encoderProvider: "cpu", decoderProvider: "cpu" },
    }),
  },
  {
    id: "local-integrated-jfk-align-dtw",
    reference: jfkReference,
    run: () => Echogarden.align(jfkAudio, jfkReference, {
      engine: "dtw",
      language: "en",
      crop: false,
      dtw: { granularity: "high", phoneAlignmentMethod: "dtw" },
    }),
  },
  {
    id: "local-whispercpp-jfk",
    reference: jfkReference,
    run: () => Echogarden.recognize(jfkAudio, {
      engine: "whisper.cpp",
      language: "en",
      crop: false,
      whisperCpp: {
        model: "tiny.en",
        executablePath: whisperCppExecutable,
        enableGPU: false,
        enableDTW: false,
        threadCount: 4,
        splitCount: 1,
      },
    }),
  },
  {
    id: "local-whispercpp-dialogue",
    reference: dialogueReference,
    run: () => Echogarden.recognize(dialogueAudio, {
      engine: "whisper.cpp",
      language: "en",
      crop: false,
      whisperCpp: {
        model: "tiny.en",
        executablePath: whisperCppExecutable,
        enableGPU: false,
        enableDTW: false,
        threadCount: 4,
        splitCount: 1,
      },
    }),
  },
];

const summary = [];
for (const task of tasks) {
  const startedAt = performance.now();
  try {
    const result = await task.run();
    const elapsedMs = Math.round(performance.now() - startedAt);
    const payload = { id: task.id, ok: true, elapsedMs, ...compact(result) };
    await writeFile(path.join(outputDir, `${task.id}.json`), JSON.stringify(payload, null, 2));
    summary.push({
      id: task.id,
      ok: true,
      elapsedMs,
      transcript: result.transcript,
      wer: wordErrorRate(task.reference, result.transcript),
      timeline: timelineStats(result.timeline),
      wordTimeline: timelineStats(result.wordTimeline),
    });
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - startedAt);
    const item = { id: task.id, ok: false, elapsedMs, error: String(error?.stack ?? error) };
    await writeFile(path.join(outputDir, `${task.id}.json`), JSON.stringify(item, null, 2));
    summary.push(item);
  }
}

await writeFile(path.join(outputDir, "local-live-summary.json"), JSON.stringify({
  runtime: { node: process.version, arch: process.arch, platform: process.platform },
  networkPolicy: "sandbox-exec deny network*",
  summary,
}, null, 2));
console.log(JSON.stringify(summary, null, 2));
