import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const temp = await mkdtemp(path.join(os.tmpdir(), "learning-asr-seams-"));
try {
  await build({
    entryPoints: ["src/main/learning-asr/seams.ts"],
    outfile: path.join(temp, "module.mjs"),
    platform: "node",
    format: "esm",
    bundle: true,
    logLevel: "silent",
  });
  const { mergeAlignedWindows } = await import(
    pathToFileURL(path.join(temp, "module.mjs")).href
  );
  const words = (text, start = 0) =>
    text.split(" ").map((text, i) => ({
      type: "word",
      text,
      startTime: start + i * 0.4,
      endTime: start + i * 0.4 + 0.3,
      timeline: [],
    }));
  const bounds = {
    overlapStartTime: 1.2,
    overlapEndTime: 3.2,
    boundaryTime: 2.2,
  };
  const left = words("We can learn this entire sentence together today");
  const right = words(
    "this entire sentence together today without losing words.",
    1.2,
  );
  const merged = mergeAlignedWindows(left, right, bounds);
  assert.equal(merged.consistent, true);
  assert.equal(
    merged.words.map((w) => w.text).join(" "),
    "We can learn this entire sentence together today without losing words.",
  );
  const conflict = mergeAlignedWindows(
    left,
    words("this whole sentence together today without losing words.", 1.2),
    { ...bounds, language: "en" },
  );
  assert.equal(
    conflict.consistent,
    false,
    "Interior disagreement must request repair",
  );
  const repeated = mergeAlignedWindows(
    words("He said that that idea is really really useful"),
    words("that idea is really really useful for us.", 1.2),
    { overlapStartTime: 1.2, overlapEndTime: 3.6, boundaryTime: 2.4 },
  );
  assert.equal(repeated.consistent, true);
  assert.equal(repeated.words.filter((w) => w.text === "that").length, 2);
  assert.equal(repeated.words.filter((w) => w.text === "really").length, 2);
  const unrelated = mergeAlignedWindows(
    words("we can do this", 0),
    words("we can do this", 20),
    { overlapStartTime: 1, overlapEndTime: 21, boundaryTime: 10 },
  );
  assert.equal(
    unrelated.consistent,
    false,
    "Matching text at unrelated times is not an anchor",
  );
  const silence = mergeAlignedWindows(
    words("Hello there.", 0),
    words("How are you?", 4),
    {
      overlapStartTime: 1.2,
      overlapEndTime: 3.8,
      boundaryTime: 2.5,
      silenceVerified: true,
    },
  );
  assert.equal(silence.consistent, true);
  assert.equal(silence.words.length, 5);
  assert.equal(
    mergeAlignedWindows(words("Before", 41), words("After", 48), {
      overlapStartTime: 43,
      overlapEndTime: 47,
      boundaryTime: 45,
    }).consistent,
    false,
    "Two empty ASR overlaps cannot prove source silence",
  );
  const noAnchor = mergeAlignedWindows(words("a", 2), words("the", 2), {
    overlapStartTime: 1,
    overlapEndTime: 3,
    boundaryTime: 2,
  });
  assert.equal(noAnchor.consistent, false);
  const shifted = right.map((word, index) => ({
    ...word,
    startTime: word.startTime - (index <= 3 ? 0.15 : 0),
    endTime: word.endTime - (index <= 3 ? 0.15 : 0),
  }));
  const compatible = mergeAlignedWindows(left, shifted, bounds);
  assert.equal(
    compatible.consistent,
    true,
    "A compatible anchor must be used when the nearest one overlaps word times",
  );
  assert(
    compatible.words.every(
      (word, index) =>
        index === 0 ||
        word.startTime >= compatible.words[index - 1].endTime - 1e-6,
    ),
  );
  const incompatible = right.map((word) => ({
    ...word,
    startTime: word.startTime - 0.15,
    endTime: word.endTime - 0.15,
  }));
  assert.equal(
    mergeAlignedWindows(left, incompatible, bounds).consistent,
    false,
    "Text agreement alone must not accept overlapping word times",
  );

  const timed = (text, startTime, endTime) => ({
    type: "word",
    text,
    startTime,
    endTime,
    timeline: [],
  });
  const coverageLeft = [
    timed("alpha", 0.5, 0.7320625),
    timed("beta", 1, 1.34),
    timed("gamma", 1.34, 1.48),
    timed("delta", 1.5, 2.7),
    timed("epsilon", 2.7, 3.48),
    timed("finish", 3.5, 3.8),
  ];
  const coverageRight = [
    timed("alpha", 0.5, 0.7),
    timed("beta", 0.975, 1.275),
    timed("gamma", 1.311, 1.605),
    timed("delta", 2.395, 2.572),
    timed("epsilon", 2.698, 2.755),
    timed("finish", 3.5, 3.8),
    timed("today", 3.9, 4.1),
  ];
  const coverageSeam = mergeAlignedWindows(coverageLeft, coverageRight, {
    overlapStartTime: 0.4,
    overlapEndTime: 3.85,
    boundaryTime: 1.2,
    language: "en",
  });
  assert.equal(coverageSeam.consistent, true);
  assert.equal(
    coverageSeam.words.map((word) => word.text).join(" "),
    "alpha beta gamma delta epsilon finish today",
    "Choosing a different valid anchor must preserve complete seam content",
  );
  const coverageGamma = coverageSeam.words.find((word) => word.text === "gamma");
  assert.equal(
    coverageGamma?.endTime,
    1.605,
    "A valid 0.2429375-second splice must beat the nearer anchor that creates a 0.915-second gap",
  );
  assert(
    coverageSeam.words.every(
      (word, index) => index === 0 || word.startTime >= coverageSeam.words[index - 1].endTime - 1e-6,
    ),
    "Coverage-aware anchor selection must retain monotonic word geometry",
  );
  const nearerSafeRight = coverageRight.map((word) => {
    if (word.text === "beta") return { ...word, startTime: 0.8320625, endTime: 1.2 };
    if (word.text === "delta") return { ...word, startTime: 1.68, endTime: 1.9 };
    if (word.text === "epsilon") return { ...word, startTime: 2.7, endTime: 3 };
    return word;
  });
  const nearerSafe = mergeAlignedWindows(coverageLeft, nearerSafeRight, {
    overlapStartTime: 0.4,
    overlapEndTime: 3.85,
    boundaryTime: 1.2,
    language: "en",
  });
  assert.equal(nearerSafe.consistent, true);
  assert.equal(
    nearerSafe.words.find((word) => word.text === "gamma")?.endTime,
    1.48,
    "The nearest safe anchor must remain preferred over a farther splice with a smaller gap",
  );
  const noRightContinuation = coverageRight
    .filter((word) => word.text !== "today")
    .map((word) =>
      word.text === "finish"
        ? { ...word, startTime: 3.51, endTime: 3.82 }
        : word,
    );
  const noRightNext = mergeAlignedWindows(coverageLeft, noRightContinuation, {
    overlapStartTime: 0.4,
    overlapEndTime: 3.85,
    boundaryTime: 3.65,
    language: "en",
  });
  assert.equal(noRightNext.consistent, true);
  assert.equal(
    noRightNext.words.find((word) => word.text === "finish")?.startTime,
    3.51,
    "A nearest anchor without a following right word must not outrank an earlier safe splice",
  );
  const naturalPauseLeft = [
    timed("alpha", 0, 0.2),
    timed("beta", 1.5, 1.7),
    timed("gamma", 3, 3.2),
  ];
  const naturalPauseRight = [
    timed("alpha", 0.05, 0.25),
    timed("beta", 1.55, 1.75),
    timed("gamma", 3.05, 3.25),
  ];
  const naturalPause = mergeAlignedWindows(naturalPauseLeft, naturalPauseRight, {
    overlapStartTime: 0,
    overlapEndTime: 3.3,
    boundaryTime: 1.6,
    language: "en",
  });
  assert.equal(naturalPause.consistent, true);
  assert.equal(
    naturalPause.words.find((word) => word.text === "beta")?.startTime,
    1.5,
    "When every compatible splice gap is unsafe, fallback must retain the nearest anchor across a true pause",
  );
  const input = JSON.stringify([left, right]);
  mergeAlignedWindows(left, right, bounds);
  assert.equal(JSON.stringify([left, right]), input);

  const numericLeft = words(
    "Please bring two notebooks to class before lunch so we can review every page together today",
  );
  const numericRight = words(
    "bring 2 notebooks to class before lunch so we can review every page together today without delay",
    0.4,
  );
  const numericBounds = {
    overlapStartTime: 0.35,
    overlapEndTime: 5.95,
    boundaryTime: 0.95,
    language: "en-US",
  };
  const numeric = mergeAlignedWindows(numericLeft, numericRight, numericBounds);
  assert.equal(
    numeric.consistent,
    true,
    "Equivalent English integer tokens should anchor an otherwise exact seam",
  );
  assert.equal(
    numeric.words.map((word) => word.text).join(" "),
    "Please bring two notebooks to class before lunch so we can review every page together today without delay",
  );

  const digitLeft = words(
    "Please bring 42 notebooks to class before lunch so we can review every page together today",
  );
  const wordRight = words(
    "bring forty-two notebooks to class before lunch so we can review every page together today without delay",
    0.4,
  );
  const digitDisplay = mergeAlignedWindows(digitLeft, wordRight, {
    ...numericBounds,
    boundaryTime: 0.95,
  });
  assert.equal(digitDisplay.consistent, true);
  assert.equal(
    digitDisplay.words[2].text,
    "42",
    "The selected source token must keep its original display",
  );

  const numericConflict = mergeAlignedWindows(
    numericLeft,
    words(
      "bring 3 notebooks to class before lunch so we can review every page together today without delay",
      0.4,
    ),
    numericBounds,
  );
  assert.equal(
    numericConflict.consistent,
    false,
    "Different numeric values must remain a disagreement",
  );

  for (const [leftToken, rightToken] of [
    ["zero", "0"],
    ["nineteen", "19"],
    ["twenty", "20"],
    ["ninety-nine", "99"],
  ]) {
    const equivalent = mergeAlignedWindows(
      words(
        `Please bring ${leftToken} notebooks to class before lunch so we can review every page together today`,
      ),
      words(
        `bring ${rightToken} notebooks to class before lunch so we can review every page together today without delay`,
        0.4,
      ),
      numericBounds,
    );
    assert.equal(
      equivalent.consistent,
      true,
      `${leftToken}/${rightToken} should be an equivalent integer token`,
    );
  }

  for (const [leftToken, rightToken] of [
    ["twenty", "2.0"],
    ["two", "-2"],
    ["twenty", "2:0"],
    ["two", "02"],
    ["two", "-two"],
  ]) {
    const unsafeNumeric = mergeAlignedWindows(
      words(
        `Please bring ${leftToken} notebooks to class before lunch so we can review every page together today`,
      ),
      words(
        `bring ${rightToken} notebooks to class before lunch so we can review every page together today without delay`,
        0.4,
      ),
      numericBounds,
    );
    assert.equal(
      unsafeNumeric.consistent,
      false,
      `${leftToken}/${rightToken} must retain sign, decimal, time separator or leading-zero meaning`,
    );
  }

  const punctuatedNumber = mergeAlignedWindows(
    words(
      "Please bring two, notebooks to class before lunch so we can review every page together today",
    ),
    words(
      'bring "2," notebooks to class before lunch so we can review every page together today without delay',
      0.4,
    ),
    numericBounds,
  );
  assert.equal(
    punctuatedNumber.consistent,
    true,
    "Conservative surrounding quotes and terminal punctuation should remain acceptable",
  );
  assert.equal(punctuatedNumber.words[2].text, "two,");

  for (const [leftToken, rightToken] of [
    ["four", "for"],
    ["two", "to"],
    ["one", "a"],
  ]) {
    const homophone = mergeAlignedWindows(
      words(
        `Please bring ${leftToken} notebooks to class before lunch so we can review every page together today`,
      ),
      words(
        `bring ${rightToken} notebooks to class before lunch so we can review every page together today without delay`,
        0.4,
      ),
      numericBounds,
    );
    assert.equal(
      homophone.consistent,
      false,
      `${leftToken}/${rightToken} must not be treated as numeric equivalence`,
    );
  }

  const noLanguageGate = mergeAlignedWindows(numericLeft, numericRight, {
    ...numericBounds,
    language: undefined,
  });
  assert.equal(
    noLanguageGate.consistent,
    false,
    "Missing language must retain exact lexical comparison",
  );

  const numericAtDifferentTimes = mergeAlignedWindows(
    words("one two three", 0),
    words("1 2 3", 20),
    {
      overlapStartTime: 0,
      overlapEndTime: 22,
      boundaryTime: 10,
      language: "en",
    },
  );
  assert.equal(
    numericAtDifferentTimes.consistent,
    false,
    "Equivalent numbers at unrelated times must not merge",
  );

  const numericRepeat = mergeAlignedWindows(
    words("Say two two times before we stop now", 0),
    words("2 2 times before we stop now please", 0.4),
    {
      overlapStartTime: 0.35,
      overlapEndTime: 3.2,
      boundaryTime: 0.95,
      language: "en",
    },
  );
  assert.equal(numericRepeat.consistent, true);
  assert.equal(
    numericRepeat.words.filter((word) => word.text === "two").length,
    2,
    "Intentional repeated number words must be preserved",
  );

  const timedWord = (text, startTime, endTime) => ({
    type: "word",
    text,
    startTime,
    endTime,
    timeline: [],
  });
  const kenyaLeft = [
    timedWord("looks", 450.6, 450.76),
    timedWord("like", 450.76, 450.92),
    timedWord("at", 450.92, 451.04),
    timedWord("the", 451.04, 451.28),
    timedWord("speed", 451.28, 451.38),
    timedWord("of", 451.38, 451.54),
    timedWord("change.", 451.54, 452.1),
    timedWord("Let's", 452.1, 453.12),
    timedWord("go", 453.12, 453.22),
    timedWord("to", 453.22, 453.44),
    timedWord("Kenya.", 453.44, 453.56),
  ];
  const kenyaRight = [
    timedWord("looks", 450.49, 450.7499375),
    timedWord("like", 450.75, 450.91),
    timedWord("at", 450.91, 451.04),
    timedWord("the", 451.04, 451.09),
    timedWord("speed", 451.1, 451.38),
    timedWord("of", 451.41, 451.43),
    timedWord("change.", 451.43, 452.09),
    timedWord("Let's", 452.09, 453.15),
    timedWord("go", 453.15, 453.19),
    timedWord("to", 453.19, 453.43),
    timedWord("Kenya.", 453.43, 453.63),
    timedWord("A", 453.63, 454.39),
    timedWord("herder", 454.39, 454.89),
  ];
  const kenyaBounds = {
    overlapStartTime: 450.49,
    overlapEndTime: 454.49,
    boundaryTime: 452.49,
    language: "en",
  };
  const kenyaContinuation = mergeAlignedWindows(
    kenyaLeft,
    kenyaRight,
    kenyaBounds,
  );
  assert.equal(
    kenyaContinuation.consistent,
    true,
    "A right continuation after the final whole-left anchor should be retained",
  );
  assert.deepEqual(
    kenyaContinuation.words.slice(-3).map(({ text, startTime, endTime }) => ({
      text,
      startTime,
      endTime,
    })),
    [
      { text: "Kenya.", startTime: 453.43, endTime: 453.63 },
      { text: "A", startTime: 453.63, endTime: 454.39 },
      { text: "herder", startTime: 454.39, endTime: 454.89 },
    ],
    "Continuation words and timestamps must not be dropped or invented",
  );

  const missingInterior = kenyaRight.filter((word) => word.text !== "speed");
  assert.equal(
    mergeAlignedWindows(kenyaLeft, missingInterior, kenyaBounds).consistent,
    false,
    "A missing interior word must remain a disagreement",
  );

  const leftTail = [...kenyaLeft, timedWord("left-tail", 453.7, 453.9)];
  assert.equal(
    mergeAlignedWindows(leftTail, kenyaRight.slice(0, 11), kenyaBounds)
      .consistent,
    false,
    "An unmatched interior left tail must not be discarded",
  );
  const clippedLeftEdge = [
    ...kenyaLeft,
    timedWord("clipped-edge", 454.08, 454.38),
  ];
  assert.equal(
    mergeAlignedWindows(clippedLeftEdge, kenyaRight.slice(0, 11), kenyaBounds)
      .consistent,
    true,
    "The existing clipped-edge allowance must remain unchanged",
  );

  const overlappingRightSuffix = kenyaRight.map((word) =>
    word.text === "A" ? { ...word, startTime: 453.5, endTime: 454.39 } : word,
  );
  assert.equal(
    mergeAlignedWindows(kenyaLeft, overlappingRightSuffix, kenyaBounds)
      .consistent,
    false,
    "A right suffix that overlaps the final left word must be rejected",
  );

  const repeatedContinuationLeft = words("we go go to Kenya", 451.6);
  const repeatedContinuationRight = [
    ...words("we go go to Kenya", 451.6),
    timedWord("today", 453.6, 453.9),
  ];
  const repeatedContinuation = mergeAlignedWindows(
    repeatedContinuationLeft,
    repeatedContinuationRight,
    {
      overlapStartTime: 451.5,
      overlapEndTime: 454,
      boundaryTime: 452.5,
      language: "en",
    },
  );
  assert.equal(repeatedContinuation.consistent, true);
  assert.equal(
    repeatedContinuation.words.filter((word) => word.text === "go").length,
    2,
    "Continuation handling must preserve repeated lexical tokens",
  );

  console.info(
    "PASS: seam anchors, numeric equivalence, conflict rejection, repetition, timing, display, silence and immutable inputs",
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
