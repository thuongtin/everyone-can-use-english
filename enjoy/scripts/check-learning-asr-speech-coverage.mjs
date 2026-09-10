/* global globalThis */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "learning-asr-speech-coverage-"));

function word(text, startTime, endTime) {
  return { type: "word", text, startTime, endTime, timeline: [] };
}

function setVad(timeline, delay = 0) {
  const timelines = Array.isArray(timeline) ? { webrtc: timeline, silero: timeline } : timeline;
  globalThis.__speechCoverageVad = { timelines, delay, calls: [] };
  return globalThis.__speechCoverageVad;
}

try {
  const output = path.join(temporaryDirectory, "speech-coverage.mjs");
  await build({
    entryPoints: [path.join(root, "src/main/learning-asr/speech-coverage.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
    plugins: [{
      name: "fake-vad-api",
      setup(builder) {
        builder.onResolve({ filter: /^echogarden\/dist\/api\/API\.js$/ }, () => ({ path: "vad-api", namespace: "coverage-test" }));
        builder.onLoad({ filter: /.*/, namespace: "coverage-test" }, () => ({
          loader: "js",
          contents: `
            export async function detectVoiceActivity(audio, options) {
              const state = globalThis.__speechCoverageVad;
              state.calls.push({ audio: [...audio], options });
              if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
              return {
                timeline: state.timelines[options.engine],
                get croppedRawAudio() { throw new Error("cropped audio must not be read"); }
              };
            }
          `,
        }));
      },
    }],
  });
  const { findUncoveredSpeech, hasDetectedSpeech } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

  const healthyVad = setVad([{ type: "segment", text: "active", startTime: 0, endTime: 2 }]);
  assert.deepEqual(await findUncoveredSpeech(new Uint8Array([1]), [
    word("one", 0.05, 0.75),
    word("two", 0.8, 1.45),
    word("three", 1.5, 1.95),
  ], 2), []);
  assert.equal(healthyVad.calls.length, 2);
  assert.equal(healthyVad.calls[0].options.engine, "webrtc");
  assert.equal(healthyVad.calls[1].options.engine, "silero");

  setVad([{ type: "segment", text: "active", startTime: 0, endTime: 2 }]);
  const continuous = await findUncoveredSpeech(new Uint8Array([2]), [
    word("before", 0, 0.4),
    word("after", 1.3, 2),
  ], 2);
  assert.equal(continuous.length, 1);
  assert.ok(Math.abs(continuous[0].startTime - 0.55) < 1e-9);
  assert.ok(Math.abs(continuous[0].endTime - 1.15) < 1e-9);

  setVad([
    { type: "segment", text: "active", startTime: 0, endTime: 0.25 },
    { type: "segment", text: "active", startTime: 0.35, endTime: 0.6 },
    { type: "segment", text: "active", startTime: 0.7, endTime: 0.9 },
  ]);
  assert.deepEqual(await findUncoveredSpeech(new Uint8Array([3]), [], 1), [{ startTime: 0, endTime: 0.9 }]);

  setVad([
    { type: "segment", text: "active", startTime: Number.NaN, endTime: 1 },
    { type: "segment", text: "active", startTime: 1.9, endTime: 2.1 },
  ]);
  assert.deepEqual(await findUncoveredSpeech(new Uint8Array([4]), [], 2), []);

  const silenceAudio = new Uint8Array([7]);
  const silenceVad = setVad([]);
  await assert.rejects(findUncoveredSpeech(silenceAudio,[word("hallucinated",0,.9)],1),error=>error.code==='asr_review_required');
  assert.equal(await hasDetectedSpeech(silenceAudio,1),false);
  assert.deepEqual(await findUncoveredSpeech(silenceAudio,[],1),[]);
  assert.equal(silenceVad.calls.length,2,'Both source VAD results must be reused when checking new word coverage on the same PCM');
  const tinySpeech = new Uint8Array([8]);
  setVad([{type:'segment',text:'active',startTime:.2,endTime:.3}]);
  assert.equal(await hasDetectedSpeech(tinySpeech,1),true,'A short voiced word must not be dismissed by the gap-duration threshold');
  setVad({
    webrtc: [{ type: "segment", text: "active", startTime: 0, endTime: 2 }],
    silero: [{ type: "segment", text: "active", startTime: 0.55, endTime: 0.75 }],
  });
  const corroborated = await findUncoveredSpeech(new Uint8Array([9]), [
    word("before", 0, 0.4), word("after", 1.3, 2),
  ], 2);
  assert.equal(corroborated.length, 1, "Partial Silero activity must preserve the full WebRTC repair candidate");
  assert.ok(Math.abs(corroborated[0].startTime - 0.55) < 1e-9);
  assert.ok(Math.abs(corroborated[0].endTime - 1.15) < 1e-9);
  setVad({
    webrtc: [{ type: "segment", text: "active", startTime: 0, endTime: 2 }],
    silero: [{ type: "segment", text: "active", startTime: 1.5, endTime: 2 }],
  });
  assert.deepEqual(await findUncoveredSpeech(new Uint8Array([10]), [
    word("before", 0, 0.4), word("after", 1.3, 2),
  ], 2), [], "Uncorroborated WebRTC noise must not become a repair candidate");
  const noiseOnlyAudio = new Uint8Array([11]);
  const noiseOnly = setVad({
    webrtc: [{ type: "segment", text: "active", startTime: 0, endTime: 1 }],
    silero: [],
  });
  assert.equal(await hasDetectedSpeech(noiseOnlyAudio, 1), false);
  await assert.rejects(
    findUncoveredSpeech(noiseOnlyAudio, [word("unsupported", 0.1, 0.9)], 1),
    error => error.code === "asr_review_required",
    "Words over WebRTC-only noise must remain a review failure",
  );
  assert.deepEqual(await findUncoveredSpeech(noiseOnlyAudio, [], 1), []);
  assert.equal(noiseOnly.calls.length, 2, "Noise-only source activity must reuse both cached detectors");
  const preCancelled = new AbortController();
  preCancelled.abort();
  const noCall = setVad([]);
  await assert.rejects(findUncoveredSpeech(new Uint8Array([5]), [], 1, preCancelled.signal), (error) => error?.code === "asr_cancelled");
  assert.equal(noCall.calls.length, 0);

  const during = new AbortController();
  setVad([], 20);
  const pending = findUncoveredSpeech(new Uint8Array([6]), [], 1, during.signal);
  during.abort();
  await assert.rejects(pending, (error) => error?.code === "asr_cancelled");

  await assert.rejects(findUncoveredSpeech(new Uint8Array(), [], 1), (error) => error?.code === "asr_invalid_audio");
  await assert.rejects(findUncoveredSpeech(new Uint8Array([1]), [], 0), (error) => error?.code === "asr_invalid_audio");

  console.info("PASS: WebRTC candidate coverage, Silero corroboration, cache reuse, continuous and cumulative gaps, cancellation");
} finally {
  delete globalThis.__speechCoverageVad;
  await rm(temporaryDirectory, { recursive: true, force: true });
}
