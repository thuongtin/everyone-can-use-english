import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(root, ".tmp-enjoy-learning-practice-"));
const output = path.join(temp, "practice-grading.mjs");

const tests = [];
const test = (name, callback) => {
  callback();
  tests.push(name);
};

const target = {
  id: "target-coffee",
  term: "coffee",
  sense: "a drink made from roasted beans",
  definition: "A hot drink made from roasted coffee beans.",
  translationVi: "cà phê",
  example: "I drink coffee in the morning.",
};
const secondTarget = {
  id: "target-colleague",
  term: "colleague",
  sense: "a person you work with",
  definition: "Someone who works with you.",
  translationVi: "đồng nghiệp",
  example: "My colleague joined me for coffee.",
};

const meaningExercise = {
  kind: "meaning",
  id: "exercise-meaning",
  prompt: "Which word means a hot drink?",
  targetIds: [target.id],
  choices: [
    { id: "choice-coffee", text: "A hot drink" },
    { id: "choice-table", text: "A piece of furniture" },
    { id: "choice-window", text: "An opening in a wall" },
  ],
  answerChoiceIds: ["choice-coffee"],
};
const multiMeaningExercise = {
  ...meaningExercise,
  id: "exercise-meaning-multi",
  choices: [
    { id: "choice-coffee", text: "A hot drink" },
    { id: "choice-colleague", text: "A person at work" },
    { id: "choice-table", text: "A piece of furniture" },
  ],
  targetIds: [target.id, secondTarget.id],
  answerChoiceIds: ["choice-coffee", "choice-colleague"],
};
const fillExercise = {
  kind: "fill",
  id: "exercise-fill",
  prompt: "Complete the sentence.",
  targetIds: [target.id],
  acceptedAnswers: ["I'd like coffee, please."],
};
const punctuationFillExercise = {
  kind: "fill",
  id: "exercise-fill-punctuation",
  prompt: "Complete the sentence.",
  targetIds: [target.id],
  acceptedAnswers: ["Coffee, please."],
};
const lexicalFillExercise = {
  kind: "fill",
  id: "exercise-fill-lexical",
  prompt: "Complete the sentence.",
  targetIds: [target.id],
  acceptedAnswers: ["I can't re-sign and/or pay 1.2 in Việt Nam."],
};
const orderExercise = {
  kind: "order",
  id: "exercise-order",
  prompt: "Put the words in order.",
  targetIds: [target.id, secondTarget.id],
  tokens: [
    { id: "token-buy", text: "buy" },
    { id: "token-buy-again", text: "buy" },
    { id: "token-coffee", text: "coffee" },
  ],
  acceptedOrders: [
    ["token-buy", "token-coffee", "token-buy-again"],
    ["token-buy-again", "token-coffee", "token-buy"],
  ],
};
const retellExercise = {
  kind: "retell",
  id: "exercise-retell",
  prompt: "Retell the coffee conversation.",
  targetIds: [target.id],
  hints: ["Say what you ordered."],
};

try {
  await build({
    stdin: {
      contents: `export { gradePractice, summarizePractice, selectRetryExercises } from "./src/lib/practice-grading.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });

  const { gradePractice, summarizePractice, selectRetryExercises } = await import(
    `${pathToFileURL(output).href}?test=${Date.now()}`
  );

  test("grades a meaning answer by exact choice ID set", () => {
    const result = gradePractice(meaningExercise, "choice-coffee");
    assert.deepEqual(result, {
      kind: "meaning",
      correct: true,
      normalizedAnswer: ["choice-coffee"],
      expectedAnswer: ["choice-coffee"],
      feedbackCode: "correct",
      targetIds: [target.id],
    });
  });

  test("accepts a meaning answer set in another order and rejects incomplete sets", () => {
    assert.equal(
      gradePractice(multiMeaningExercise, ["choice-colleague", "choice-coffee"]).correct,
      true
    );
    assert.equal(
      gradePractice(multiMeaningExercise, ["choice-coffee"]).correct,
      false
    );
    assert.equal(
      gradePractice(multiMeaningExercise, ["choice-coffee", "choice-table"]).correct,
      false
    );
  });

  test("rejects meaning answer duplicates, unknown IDs, and wrong types", () => {
    assert.throws(() => gradePractice(multiMeaningExercise, ["choice-coffee", "choice-coffee"]));
    assert.throws(() => gradePractice(multiMeaningExercise, ["choice-unknown"]));
    assert.throws(() => gradePractice(meaningExercise, 1));
  });

  test("rejects semantically invalid meaning exercises", () => {
    assert.throws(() => gradePractice({
      ...meaningExercise,
      choices: [
        { id: "choice-one", text: "Same text" },
        { id: "choice-two", text: "Same text" },
      ],
      answerChoiceIds: ["choice-one"],
    }, "choice-one"));
  });

  test("normalizes fill whitespace, case, and English apostrophe variants only", () => {
    const result = gradePractice(fillExercise, "  I’d   LIKE coffee, please.  ");
    assert.equal(result.correct, true);
    assert.equal(result.normalizedAnswer, "i'd like coffee please");
  assert.deepEqual(result.expectedAnswer, ["I'd like coffee, please."]);
  assert.equal(
    gradePractice(fillExercise, "I'd like coffee please").correct,
    true
  );
  });

  test("ignores sentence-ending punctuation and comma separators without stripping meaningful punctuation", () => {
    assert.equal(
      gradePractice(punctuationFillExercise, "COFFEE please").correct,
      true
    );
    assert.equal(
      gradePractice(punctuationFillExercise, "coffee, please!").correct,
      true
    );
    assert.equal(
      gradePractice(lexicalFillExercise, "I can't re-sign and/or pay 1.2 in việt nam").correct,
      true
    );
    assert.equal(
      gradePractice(lexicalFillExercise, "I cant re-sign and/or pay 1.2 in Việt Nam").correct,
      false
    );
    assert.equal(
      gradePractice(lexicalFillExercise, "I can't resign and/or pay 1.2 in Việt Nam").correct,
      false
    );
    assert.equal(
      gradePractice(lexicalFillExercise, "I can't re-sign and/or pay 12 in Việt Nam").correct,
      false
    );
  });

  test("rejects fill answers with wrong type, empty text, or oversized text", () => {
    assert.throws(() => gradePractice(fillExercise, ["I'd like coffee, please."]));
    assert.throws(() => gradePractice(fillExercise, "   "));
    assert.throws(() => gradePractice(fillExercise, "x".repeat(301)));
  });

  test("grades order IDs exactly and preserves repeated token occurrences", () => {
    const result = gradePractice(orderExercise, [
      "token-buy-again",
      "token-coffee",
      "token-buy",
    ]);
    assert.equal(result.correct, true);
    assert.deepEqual(result.normalizedAnswer, [
      "token-buy-again",
      "token-coffee",
      "token-buy",
    ]);
    assert.equal(
      gradePractice(orderExercise, ["token-buy", "token-coffee"]).correct,
      false
    );
    assert.throws(() => gradePractice(orderExercise, [0, 1, 2]));
    assert.throws(() => gradePractice(orderExercise, [
      "token-buy",
      "token-coffee",
      "token-coffee",
    ]));
  });

  test("retell is bounded self review without an automatic correctness claim", () => {
    const result = gradePractice(retellExercise, "I ordered coffee with my colleague.");
    assert.deepEqual(result, {
      kind: "retell",
      correct: null,
      normalizedAnswer: "I ordered coffee with my colleague.",
      expectedAnswer: null,
      feedbackCode: "self_review",
      targetIds: [target.id],
    });
    assert.throws(() => gradePractice(retellExercise, "   "));
    assert.throws(() => gradePractice(retellExercise, "x".repeat(24_001)));
  });

  test("summarizes only known target IDs and marks incorrect or ungraded attempts for review", () => {
    const summary = summarizePractice(
      [target, secondTarget],
      [
        {
          questionId: meaningExercise.id,
          kind: meaningExercise.kind,
          targetIds: [target.id, "unknown-target"],
          result: { correct: true },
        },
        {
          questionId: "exercise-fill-history",
          kind: "fill",
          targetIds: [target.id],
          result: { correct: false },
        },
        {
          questionId: "exercise-fill-history",
          kind: "fill",
          targetIds: [target.id],
          result: { correct: true },
        },
        {
          questionId: retellExercise.id,
          kind: retellExercise.kind,
          targetIds: [target.id, secondTarget.id],
          result: { correct: null },
        },
        {
          questionId: "unknown-question",
          kind: "fill",
          targetIds: ["unknown-target"],
          result: { correct: false },
        },
      ]
    );
    assert.deepEqual(summary, [
      { targetId: target.id, attempts: 4, correct: 2, incorrect: 1, needsReview: true },
      { targetId: secondTarget.id, attempts: 1, correct: 0, incorrect: 0, needsReview: true },
    ]);

    assert.deepEqual(
      summarizePractice([target], [
        {
          questionId: "exercise-fill-history",
          kind: "fill",
          targetIds: [target.id],
          result: { correct: false },
        },
        {
          questionId: "exercise-fill-history",
          kind: "fill",
          targetIds: [target.id],
          result: { correct: true },
        },
      ]),
      [{ targetId: target.id, attempts: 2, correct: 1, incorrect: 1, needsReview: false }]
    );
  });

  test("selects fixed exercises for latest wrong target IDs and removes superseded wrong answers", () => {
    const exercises = [meaningExercise, fillExercise, orderExercise, retellExercise];
    const attempts = [
      {
        questionId: meaningExercise.id,
        kind: meaningExercise.kind,
        targetIds: [target.id],
        result: { correct: false },
      },
      {
        questionId: meaningExercise.id,
        kind: meaningExercise.kind,
        targetIds: [target.id],
        result: { correct: true },
      },
      {
        questionId: orderExercise.id,
        kind: orderExercise.kind,
        targetIds: [target.id, secondTarget.id],
        result: { correct: false },
      },
      {
        questionId: retellExercise.id,
        kind: retellExercise.kind,
        targetIds: [target.id],
        result: { correct: null },
      },
    ];
    const before = structuredClone(exercises);
    const retry = selectRetryExercises(exercises, attempts);
    assert.deepEqual(retry.map(({ id }) => id), [fillExercise.id, orderExercise.id]);
    assert.deepEqual(exercises, before);
  });

  console.info(`check-learning-practice: PASS (${tests.length} deterministic grading cases)`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
