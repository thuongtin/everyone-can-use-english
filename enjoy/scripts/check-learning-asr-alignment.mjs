import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "learning-asr-alignment-"));

function word(text, startTime, endTime, timeline = []) {
  return { type: "word", text, startTime, endTime, timeline };
}

function fakeEchogardenPlugin() {
  return {
    name: "fake-echogarden",
    setup(builder) {
      builder.onResolve({ filter: /^\.\.\/echogarden$/ }, () => ({ path: "echogarden", namespace: "alignment-test" }));
      builder.onLoad({ filter: /.*/, namespace: "alignment-test" }, () => ({
        loader: "js",
        contents: `
          export default {
            async align(audio, transcript, options) {
              const state = globalThis.__alignmentFake;
              state.calls.push({ audio: [...audio], transcript, options });
              state.active += 1;
              state.maxActive = Math.max(state.maxActive, state.active);
              try {
                if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
                const next = state.responses.shift();
                if (next instanceof Error) throw next;
                return typeof next === "function" ? next({ audio, transcript, options }) : next;
              } finally {
                state.active -= 1;
              }
            }
          };
        `,
      }));
    },
  };
}

function setFake(responses, delay = 0) {
  globalThis.__alignmentFake = { responses: [...responses], calls: [], active: 0, maxActive: 0, delay };
  return globalThis.__alignmentFake;
}

function result(words) {
  return { wordTimeline: words, timeline: [], transcript: words.map((entry) => entry.text).join(" "), language: "English" };
}

function pcmWav(durationSeconds, sampleRate = 10) {
  const frames = durationSeconds * sampleRate;
  const output = Buffer.alloc(44 + frames * 2);
  output.write("RIFF", 0, 4, "ascii");
  output.writeUInt32LE(36 + frames * 2, 4);
  output.write("WAVEfmt ", 8, 8, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36, 4, "ascii");
  output.writeUInt32LE(frames * 2, 40);
  return output;
}

try {
  const output = path.join(temporaryDirectory, "alignment.mjs");
  await build({
    entryPoints: [path.join(root, "src/main/learning-asr/alignment.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
    plugins: [fakeEchogardenPlugin()],
  });
  const subject = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

  const invalidPhone = { type: "phone", text: "h", startTime: 0, endTime: 0, timeline: [] };
  const validPhone = { type: "phone", text: "i", startTime: 0.1, endTime: 0.2, timeline: [] };
  const fake = setFake([result([
    word("HELLO", 0.05, 0.3, [{ type: "token", text: "hello", startTime: 0.05, endTime: 0.3, timeline: [invalidPhone, validPhone] }]),
    word("world", 0.4, 0.9),
  ])]);
  const aligned = await subject.alignStudyWindow(new Uint8Array([1, 2, 3]), "Hello, world!", {
    language: "en-US",
    offsetSeconds: 4,
    durationSeconds: 1,
  });
  assert.deepEqual(aligned.words.map((entry) => entry.text), ["Hello,", "world!"]);
  assert.deepEqual(aligned.words.map((entry) => [entry.startTime, entry.endTime]), [[4.05, 4.3], [4.4, 4.9]]);
  assert.equal(aligned.omittedPhoneTimings, 1);
  assert.deepEqual(aligned.words[0].timeline[0].timeline.map((entry) => entry.text), ["i"]);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].options.engine, "dtw");
  assert.equal(fake.calls[0].options.crop, false);

  const fallback = setFake([
    result([word("wrong", 0.1, 0.2)]),
    result([
      word("can", 0.1, 0.25), word("'t", 0.25, 0.35),
      word("re", 0.4, 0.58), word("enter", 0.58, 0.8),
      word("3", 0.85, 1), word("14", 1, 1.2),
    ]),
  ]);
  const recovered = await subject.alignStudyWindow(new Uint8Array([4]), "Can't re-enter 3.14.", {
    language: "en-US",
    offsetSeconds: 0,
    durationSeconds: 2,
  });
  assert.deepEqual(recovered.words.map((entry) => entry.text), ["Can't", "re-enter", "3.14."]);
  assert.deepEqual(recovered.words.map((entry) => [entry.startTime, entry.endTime]), [[0.1, 0.35], [0.4, 0.8], [0.85, 1.2]]);
  assert.equal(fallback.calls.length, 2);
  assert.equal(fallback.calls[1].options.engine, "whisper");
  assert.equal(fallback.calls[1].options.crop, false);
  assert.equal(fallback.calls[1].options.whisper.model, "tiny.en");

  const groupedNumber = setFake([result([
    word("over", 0.1, 0.3), word("100,000", 0.4, 0.8), word("and", 0.9, 1.1),
    word("1,000.25", 1.2, 1.7), word("people", 1.8, 2.1),
  ])]);
  const groupedNumberResult = await subject.alignStudyWindow(new Uint8Array([4]), "over 100,000 and 1,000.25 people", {
    language: "en-US",
    offsetSeconds: 0,
    durationSeconds: 3,
  });
  assert.deepEqual(groupedNumberResult.words.map((entry) => entry.text), ["over", "100,000", "and", "1,000.25", "people"]);
  assert.equal(groupedNumber.calls.length, 1);

  const splitNumericPunctuation = setFake([
    result([word("wrong", 0.1, 0.2)]),
    result([
      word("over", 0.1, 0.3),
      word("100", 0.4, 0.55), word(",", 0.55, 0.55), word("000", 0.55, 0.8),
      word("and", 0.9, 1.1),
      word("1", 1.2, 1.3), word(",", 1.3, 1.3), word("000", 1.3, 1.5),
      word(".", 1.5, 1.5), word("25", 1.5, 1.7),
      word("people", 1.8, 2.1),
    ]),
  ]);
  const splitNumericResult = await subject.alignStudyWindow(
    new Uint8Array([4]),
    "over 100,000 and 1,000.25 people",
    { language: "en-US", offsetSeconds: 0, durationSeconds: 3 },
  );
  assert.deepEqual(splitNumericResult.words.map((entry) => entry.text), ["over", "100,000", "and", "1,000.25", "people"]);
  assert.deepEqual(splitNumericResult.words.map((entry) => [entry.startTime, entry.endTime]), [
    [0.1, 0.3], [0.4, 0.8], [0.9, 1.1], [1.2, 1.7], [1.8, 2.1],
  ]);
  assert.equal(splitNumericPunctuation.calls.length, 2);

  const unrelatedComma = setFake([
    result([word("one", 0.1, 0.3), word(",", 0.3, 0.3), word("two", 0.4, 0.7)]),
    new Error("fallback rejected"),
  ]);
  await assert.rejects(
    subject.alignStudyWindow(new Uint8Array([4]), "one, two", { language: "en-US", offsetSeconds: 0, durationSeconds: 1 }),
    (error) => error?.code === "asr_review_required",
  );

  const wrongRawNumberSeparator = setFake([
    result([
      word("over", 0.1, 0.3),
      word("100", 0.4, 0.55), word(".", 0.55, 0.55), word("000", 0.55, 0.8),
      word("people", 0.9, 1.2),
    ]),
    new Error("fallback rejected"),
  ]);
  await assert.rejects(
    subject.alignStudyWindow(new Uint8Array([4]), "over 100,000 people", { language: "en-US", offsetSeconds: 0, durationSeconds: 2 }),
    (error) => error?.code === "asr_review_required",
  );

  const wrongNumberSeparator = setFake([
    result([word("over", 0.1, 0.3), word("100,00", 0.4, 0.8), word("people", 0.9, 1.2)]),
    new Error("fallback rejected"),
  ]);
  await assert.rejects(
    subject.alignStudyWindow(new Uint8Array([4]), "over 100,000 people", { language: "en-US", offsetSeconds: 0, durationSeconds: 2 }),
    (error) => error?.code === "asr_review_required",
  );

  const multilingualFallback = setFake([
    new Error("DTW failed"),
    result([word("xin", 0.1, 0.3), word("chào", 0.4, 0.8)]),
  ]);
  await subject.alignStudyWindow(new Uint8Array([5]), "Xin chào!", {
    language: "vi-VN",
    offsetSeconds: 0,
    durationSeconds: 1,
  });
  assert.equal(multilingualFallback.calls.length, 2);
  assert.equal(multilingualFallback.calls[1].options.whisper.model, "tiny");

  const primaryRepair = setFake([
    result([word("keep", 2, 3), word("this", 3, 3), word("strict", 3, 5)]),
    result([word("keep", 0.4, 1.4), word("this", 1.4, 2), word("strict", 2, 3.4)]),
  ]);
  const repairedPrimary = await subject.alignStudyWindow(pcmWav(10), "keep this strict", {
    language: "en-US",
    offsetSeconds: 0,
    durationSeconds: 10,
  });
  assert.equal(repairedPrimary.repairedWordTimings, 2);
  assert.equal(primaryRepair.calls.length, 2, "A valid primary repair must avoid full-window fallback");
  assert.equal(primaryRepair.calls[1].options.engine, "whisper");
  assert.equal(primaryRepair.calls[1].options.whisper.model, "tiny.en");

  const repaired = setFake([
    result([word("wrong", 0.1, 0.2)]),
    result([
      word("the", 2, 3), word("border", 3, 4), word("of", 4, 4),
      word("Belarus", 4, 5), word("and", 5, 6),
    ]),
    result([
      word("the", 0.4, 1.4), word("border", 1.4, 2.2), word("of", 2.2, 2.5),
      word("Belarus", 2.5, 3.4), word("and", 3.4, 4.4),
    ]),
  ]);
  const locallyRepaired = await subject.alignStudyWindow(pcmWav(10), "the border of Belarus and", {
    language: "en-US",
    offsetSeconds: 0,
    durationSeconds: 10,
  });
  assert.deepEqual(locallyRepaired.words.map((entry) => [entry.text, Number(entry.startTime.toFixed(3)), Number(entry.endTime.toFixed(3))]), [
    ["the", 2, 3], ["border", 3, 3.8], ["of", 3.8, 4.1], ["Belarus", 4.1, 5], ["and", 5, 6],
  ]);
  assert.equal(locallyRepaired.repairedWordTimings, 3);
  assert.equal(repaired.calls.length, 3);
  assert.equal(repaired.calls[2].transcript, "the border of Belarus and");
  assert.equal(repaired.calls[2].options.engine, "dtw");
  assert.ok(repaired.calls[2].audio.length < pcmWav(10).length, "Repair must align a bounded local audio slice");

  const cancelledDuringRepair = new AbortController();
  const interruptedRepair = setFake([
    result([word("keep", 2, 2), word("going", 2, 3)]),
    () => {
      cancelledDuringRepair.abort();
      return result([word("keep", 0.4, 1.2), word("going", 1.2, 2.2)]);
    },
  ]);
  await assert.rejects(
    subject.alignStudyWindow(pcmWav(10), "keep going", {
      language: "en-US", offsetSeconds: 0, durationSeconds: 10, signal: cancelledDuringRepair.signal,
    }),
    (error) => error?.code === "asr_cancelled",
  );
  assert.equal(interruptedRepair.calls.length, 2);

  const rejectedRepair = setFake([
    new Error("DTW failed"),
    result([word("one", 2, 2), word("two", 2, 3)]),
    result([word("changed", 0.2, 0.5), word("words", 0.5, 0.8)]),
    result([word("still", 0.2, 0.5), word("wrong", 0.5, 0.8)]),
  ]);
  await assert.rejects(
    subject.alignStudyWindow(pcmWav(10), "one two", { language: "en", offsetSeconds: 0, durationSeconds: 10 }),
    (error) => error?.code === "asr_review_required",
  );
  assert.equal(rejectedRepair.calls.length, 8, "Local repair attempts must be bounded");

  const queued = setFake([
    result([word("one", 0.1, 0.3)]),
    result([word("two", 0.1, 0.3)]),
  ], 20);
  await Promise.all([
    subject.alignStudyWindow(new Uint8Array([1]), "one", { language: "en", offsetSeconds: 0, durationSeconds: 1 }),
    subject.alignStudyWindow(new Uint8Array([2]), "two", { language: "en", offsetSeconds: 0, durationSeconds: 1 }),
  ]);
  assert.equal(queued.maxActive, 1, "Expensive local alignments must be serialized");

  assert.throws(
    () => subject.validateStudyWords([word("wrong", 0.1, 0.2)], "right", 1),
    (error) => error?.code === "asr_review_required",
  );
  assert.throws(
    () => subject.validateStudyWords([word("right", 0.2, 0.2)], "right", 1),
    (error) => error?.code === "asr_review_required",
  );
  assert.throws(
    () => subject.validateStudyWords([word("right", 0.2, 1.1)], "right", 1),
    (error) => error?.code === "asr_review_required",
  );
  assert.throws(
    () => subject.validateStudyWords([word("one", 0.3, 0.6), word("two", 0.5, 0.8)], "one two", 1),
    (error) => error?.code === "asr_review_required",
  );

  const transcript = "Dr. Smith can't re-enter Room 3.14. Next?";
  const studyWords = [
    word("Dr", 0.1, 0.3),
    word("Smith", 0.4, 0.7),
    word("can't", 0.8, 1.1),
    word("re-enter", 1.2, 1.6),
    word("Room", 1.7, 2),
    word("3.14", 2.1, 2.5),
    word("Next", 2.7, 3),
  ];
  const sentences = subject.buildStudyTimeline(studyWords, transcript, "en-US", 3.2);
  assert.equal(sentences.map((entry) => entry.text).join(""), transcript);
  assert.deepEqual(sentences.map((entry) => entry.text), ["Dr. Smith can't re-enter Room 3.14. ", "Next?"]);
  assert.deepEqual(sentences.map((entry) => entry.timeline.map((item) => item.text)), [
    ["Dr.", "Smith", "can't", "re-enter", "Room", "3.14."],
    ["Next?"],
  ]);
  assert.ok(sentences.every((sentence) => sentence.timeline.every((entry) => entry.startTime >= sentence.startTime && entry.endTime <= sentence.endTime)));

  const cancelled = new AbortController();
  cancelled.abort();
  const noCall = setFake([result([word("unused", 0, 1)])]);
  await assert.rejects(
    subject.alignStudyWindow(new Uint8Array([9]), "unused", { language: "en", offsetSeconds: 0, durationSeconds: 1, signal: cancelled.signal }),
    (error) => error?.code === "asr_cancelled",
  );
  assert.equal(noCall.calls.length, 0);

  console.info("PASS: strict lexical alignment, bounded local repair, fallback policy, queueing, phone omission, punctuation and sentence boundaries");
} finally {
  delete globalThis.__alignmentFake;
  await rm(temporaryDirectory, { recursive: true, force: true });
}
