import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "enjoy-audio-windows-"));

function riffChunk(name, body) {
  const chunk = Buffer.alloc(8 + body.length + (body.length % 2));
  chunk.write(name, 0, 4, "ascii");
  chunk.writeUInt32LE(body.length, 4);
  body.copy(chunk, 8);
  return chunk;
}

function makeWav({ sampleRate = 1_000, channels = 1, frames, junk = false }) {
  const blockAlign = channels * 2;
  const data = Buffer.alloc(frames.length * blockAlign);
  for (let frame = 0; frame < frames.length; frame += 1) {
    const values = Array.isArray(frames[frame]) ? frames[frame] : [frames[frame]];
    for (let channel = 0; channel < channels; channel += 1) {
      data.writeInt16LE(values[channel] ?? values[0], frame * blockAlign + channel * 2);
    }
  }
  const format = Buffer.alloc(16);
  format.writeUInt16LE(1, 0);
  format.writeUInt16LE(channels, 2);
  format.writeUInt32LE(sampleRate, 4);
  format.writeUInt32LE(sampleRate * blockAlign, 8);
  format.writeUInt16LE(blockAlign, 12);
  format.writeUInt16LE(16, 14);
  const chunks = [riffChunk("fmt ", format)];
  if (junk) chunks.push(riffChunk("JUNK", Buffer.from([1, 2, 3])));
  chunks.push(riffChunk("data", data));
  const body = Buffer.concat([Buffer.from("WAVE"), ...chunks]);
  const wav = Buffer.alloc(8 + body.length);
  wav.write("RIFF", 0, 4, "ascii");
  wav.writeUInt32LE(body.length, 4);
  body.copy(wav, 8);
  return wav;
}

function constantFrames(seconds, value, sampleRate = 1_000) {
  return Array(seconds * sampleRate).fill(value);
}

function assertCoverage(windows, frameCount, maxSamples) {
  assert.ok(windows.length > 0);
  assert.deepEqual(windows.map((window) => window.index), windows.map((_, index) => index));
  assert.equal(windows[0].coreStartSample, 0);
  assert.equal(windows.at(-1).coreEndSample, frameCount);
  for (const [index, window] of windows.entries()) {
    assert.ok(Number.isInteger(window.startSample));
    assert.ok(Number.isInteger(window.endSample));
    assert.ok(window.startSample <= window.coreStartSample);
    assert.ok(window.coreStartSample < window.coreEndSample);
    assert.ok(window.coreEndSample <= window.endSample);
    assert.ok(window.endSample - window.startSample <= maxSamples);
    if (index > 0) {
      assert.equal(window.coreStartSample, windows[index - 1].coreEndSample);
      assert.ok(window.startSample < window.coreStartSample);
    }
  }
}

try {
  const output = path.join(temporaryDirectory, "audio-windows.mjs");
  await build({
    entryPoints: [path.join(root, "src/main/learning-asr/audio-windows.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });
  const subject = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

  const padded = subject.parsePcmWav(makeWav({ frames: [100, -200, 300], junk: true }));
  assert.equal(padded.sampleRate, 1_000);
  assert.equal(padded.channels, 1);
  assert.equal(padded.blockAlign, 2);
  assert.equal(padded.frameCount, 3);
  assert.deepEqual([...padded.pcm], [100, 0, 56, 255, 44, 1]);

  const knownFrames = [
    ...constantFrames(9, 12_000),
    ...constantFrames(1, 0),
    ...constantFrames(9, 12_000),
    ...constantFrames(1, 0),
    ...constantFrames(9, 12_000),
  ];
  const known = subject.parsePcmWav(makeWav({ frames: knownFrames }));
  const quietWindows = subject.planAudioWindows(known, {
    targetSeconds: 10,
    maxSeconds: 14,
    overlapSeconds: 1,
    searchSeconds: 2,
    minSeconds: 4,
  });
  assertCoverage(quietWindows, 29_000, 14_000);
  assert.equal(quietWindows[0].cutKind, "silence");
  assert.ok(quietWindows[0].coreEndSample >= 9_000 && quietWindows[0].coreEndSample <= 10_000);
  assert.equal(quietWindows[0].endSample, quietWindows[0].coreEndSample + 1_000);
  assert.equal(quietWindows[1].cutKind, "silence");
  assert.ok(quietWindows[1].coreEndSample >= 19_000 && quietWindows[1].coreEndSample <= 20_000);
  assert.equal(quietWindows[1].startSample, quietWindows[1].coreStartSample - 1_000);
  assert.equal(quietWindows.at(-1).cutKind, "end");

  const speech = subject.parsePcmWav(makeWav({ frames: constantFrames(28, 10_000) }));
  const bounded = subject.planAudioWindows(speech, {
    targetSeconds: 10,
    maxSeconds: 14,
    overlapSeconds: 1,
    searchSeconds: 2,
    minSeconds: 4,
  });
  assertCoverage(bounded, 28_000, 14_000);
  assert.ok(bounded.slice(0, -1).every((window) => window.cutKind === "bounded"));

  const defaultSpeech = subject.parsePcmWav(makeWav({
    sampleRate: 100,
    frames: Array(12_500).fill(10_000),
  }));
  const defaultWindows = subject.planAudioWindows(defaultSpeech);
  assertCoverage(defaultWindows, 12_500, 6_000);
  assert.deepEqual(defaultWindows.map((window) => window.coreEndSample), [4_500, 9_000, 12_500]);
  assert.equal(defaultWindows[0].endSample - defaultWindows[0].coreEndSample, 200);

  const oppositePhase = subject.parsePcmWav(makeWav({
    channels: 2,
    frames: Array.from({ length: 28_000 }, () => [12_000, -12_000]),
  }));
  const stereoWindows = subject.planAudioWindows(oppositePhase, {
    targetSeconds: 10,
    maxSeconds: 14,
    overlapSeconds: 1,
    searchSeconds: 2,
    minSeconds: 4,
  });
  assert.ok(stereoWindows.slice(0, -1).every((window) => window.cutKind === "bounded"));

  const tail = subject.parsePcmWav(makeWav({ frames: constantFrames(31, 9_000) }));
  const tailWindows = subject.planAudioWindows(tail, {
    targetSeconds: 12,
    maxSeconds: 18,
    overlapSeconds: 1,
    searchSeconds: 1,
    minSeconds: 8,
  });
  assertCoverage(tailWindows, 31_000, 18_000);
  assert.ok(tailWindows.at(-1).coreEndSample - tailWindows.at(-1).coreStartSample >= 8_000);

  const encoded = subject.encodePcmWindow(known, quietWindows[0]);
  const encodedParsed = subject.parsePcmWav(encoded);
  assert.equal(encodedParsed.frameCount, quietWindows[0].endSample - quietWindows[0].startSample);
  assert.equal(encodedParsed.sampleRate, known.sampleRate);
  assert.equal(encodedParsed.channels, known.channels);
  assert.equal(encodedParsed.pcm.equals(subject.slicePcmWindow(known, quietWindows[0])), true);
  assert.throws(() => subject.slicePcmWindow(known, { startSample: 1.5, endSample: 2 }));
  assert.throws(() => subject.slicePcmWindow(known, { startSample: 2, endSample: 2 }));
  assert.throws(() => subject.slicePcmWindow(known, { startSample: 0, endSample: known.frameCount + 1 }));

  for (let frameCount = 1; frameCount <= 13_700; frameCount += 137) {
    const parsed = subject.parsePcmWav(makeWav({ sampleRate: 100, frames: Array(frameCount).fill(7_000) }));
    const windows = subject.planAudioWindows(parsed, {
      targetSeconds: 50,
      maxSeconds: 80,
      overlapSeconds: 5,
      searchSeconds: 10,
      minSeconds: 20,
    });
    assertCoverage(windows, frameCount, 8_000);
  }

  const malformed = makeWav({ frames: [1, 2, 3] });
  const truncatedChunk = Buffer.from(malformed);
  truncatedChunk.writeUInt32LE(1_000, 40);
  const badBlockAlign = Buffer.from(malformed);
  badBlockAlign.writeUInt16LE(4, 32);
  const badRiffSize = Buffer.from(malformed);
  badRiffSize.writeUInt32LE(badRiffSize.length + 20, 4);
  const paddedWav = makeWav({ frames: [1, 2, 3], junk: true });
  const missingOddPadding = Buffer.concat([paddedWav.subarray(0, 47), paddedWav.subarray(48)]);
  missingOddPadding.writeUInt32LE(missingOddPadding.length - 8, 4);
  for (const input of [
    Buffer.from("not a wav"),
    truncatedChunk,
    badBlockAlign,
    badRiffSize,
    missingOddPadding,
    makeWav({ frames: [] }),
  ]) {
    assert.throws(() => subject.parsePcmWav(input), /WAV|PCM|malformed|empty/i);
  }

  const valid = subject.parsePcmWav(makeWav({ frames: constantFrames(2, 1_000) }));
  for (const options of [
    { targetSeconds: Number.NaN },
    { maxSeconds: Number.POSITIVE_INFINITY },
    { overlapSeconds: -1 },
    { targetSeconds: 1, overlapSeconds: 1 },
    { targetSeconds: 1, overlapSeconds: 2 },
    { targetSeconds: 3, maxSeconds: 2 },
    { maxSeconds: 3, overlapSeconds: 2 },
  ]) {
    assert.throws(() => subject.planAudioWindows(valid, options), /option|seconds|overlap|target|max/i);
  }

  console.log("learning audio windows checks passed");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
