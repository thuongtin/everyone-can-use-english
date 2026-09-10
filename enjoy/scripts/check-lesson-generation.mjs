import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { build } from "esbuild";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-lesson-generation-"));

try {
  const output = path.join(temp, "lesson-generation.mjs");
  await build({
    stdin: {
      contents: `
        export * from "./src/lib/learning-validator.ts";
        export * from "./src/lib/cefr-rubrics.ts";
      `,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });

  const contracts = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
  const { evaluateLessonDraft, getCefrRubric } = contracts;

  const tests = [];
  const test = async (name, callback) => {
    await callback();
    tests.push(name);
  };

  const makeTarget = (id, term, sense = `meaning of ${term}`) => ({
    id,
    term,
    sense,
    definition: `A clear definition of ${term}.`,
    translationVi: `bản dịch ${term}`,
    example: `This example uses ${term}.`,
  });

  const makeBrief = ({
    targets,
    level = "A2",
    length = "medium",
    topic = "A day at the cafe",
    keywords = targets.map((target) => target.term),
    imageCount = 0,
  }) => ({
    topic,
    keywords,
    level,
    length,
    imageCount,
    audio: false,
    targets,
  });

  const makeDraft = ({
    targets,
    story = "The coffee shop is open. I order coffee with my colleague.",
    sectionTargetIds = targets.map((target) => target.id),
  }) => ({
    title: "A short learning story",
    sections: [{
      id: "section-story",
      text: story,
      targetIds: sectionTargetIds,
    }],
    glossary: targets.map((target) => ({
      targetId: target.id,
      definition: target.definition,
      translationVi: target.translationVi,
      example: target.example,
    })),
    scenes: [],
    exercises: [
      ...targets.flatMap((target) => {
        const prefix = `exercise-${target.id}`;
        const tokenTexts = target.term.trim().split(/\s+/u);
        const orderTexts = tokenTexts.length > 1 ? tokenTexts : ["I", ...tokenTexts];
        const orderTokens = orderTexts.map((text, index) => ({
          id: `${prefix}-token-${index + 1}`,
          text,
        }));
        return [
          {
            kind: "meaning",
            id: `${prefix}-meaning`,
            prompt: `What does ${target.term} mean?`,
            targetIds: [target.id],
            choices: [
              { id: `${prefix}-choice-correct`, text: target.definition },
              { id: `${prefix}-choice-other`, text: "Another meaning" },
            ],
            answerChoiceIds: [`${prefix}-choice-correct`],
          },
          {
            kind: "fill",
            id: `${prefix}-fill`,
            prompt: `Complete the sentence with ${target.term}.`,
            targetIds: [target.id],
            acceptedAnswers: [target.term],
          },
          {
            kind: "order",
            id: `${prefix}-order`,
            prompt: `Put the words for ${target.term} in order.`,
            targetIds: [target.id],
            tokens: orderTokens,
            acceptedOrders: [orderTokens.map((token) => token.id)],
          },
        ];
      }),
      {
        kind: "retell",
        id: "exercise-retell",
        prompt: "Retell the story and use the target words.",
        targetIds: targets.map((target) => target.id),
        hints: ["Say what happened."],
      },
    ],
    entityDescriptions: [],
  });

  await test("returns metrics for a structurally valid English draft", () => {
    const targets = [
      makeTarget("target-coffee", "coffee"),
      makeTarget("target-colleague", "colleague"),
    ];
    const result = evaluateLessonDraft(
      makeDraft({ targets, story: "The coffee shop is open. I order coffee with my colleague." }),
      makeBrief({ targets }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.issues.length, 0);
    assert.equal(result.metrics.targetOccurrences["target-coffee"], 2);
    assert.equal(result.metrics.targetOccurrences["target-colleague"], 1);
    assert.equal(result.metrics.practiceExposure["target-coffee"], 4);
    assert.equal(result.metrics.practiceExposure["target-colleague"], 4);
    assert.ok(result.metrics.wordCount > 0);
    assert.ok(result.metrics.sentenceCount >= 2);
    assert.ok(result.data);
  });

  await test("returns canonical structural issues before quality checks", () => {
    const targets = [makeTarget("target-coffee", "coffee")];
    const draft = makeDraft({ targets });
    draft.sections[0].targetIds = ["target-missing"];
    const result = evaluateLessonDraft(draft, makeBrief({ targets }));
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === "target_out_of_scope"));
    assert.equal(result.data, undefined);
  });

  await test("requires the generated scene count to match the brief", () => {
    const targets = [makeTarget("target-coffee", "coffee")];
    const result = evaluateLessonDraft(
      makeDraft({ targets }),
      makeBrief({ targets, imageCount: 1 }),
    );
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === "scene_count_mismatch"));
  });

  await test("matches exact whole-word terms, approved inflections, and apostrophes", () => {
    const targets = [
      { ...makeTarget("target-art", "art"), inflections: [] },
      { ...makeTarget("target-run", "run"), inflections: ["ran", "running"] },
      makeTarget("target-coffee-shop", "coffee shop"),
      makeTarget("target-dont", "don't"),
    ];
    const result = evaluateLessonDraft(
      makeDraft({
        targets,
        story: "Art is useful. The artist works. I ran to the coffee shop. I don’t stop.",
      }),
      makeBrief({ targets }),
    );
    assert.equal(result.metrics.targetOccurrences["target-art"], 1);
    assert.equal(result.metrics.targetOccurrences["target-run"], 1);
    assert.equal(result.metrics.targetOccurrences["target-coffee-shop"], 1);
    assert.equal(result.metrics.targetOccurrences["target-dont"], 1);
    assert.ok(!result.issues.some((issue) => issue.code === "target_story_missing"));
  });

  await test("accepts only deterministic inflections and keeps unsafe variants out of metrics", () => {
    const invalidTarget = {
      ...makeTarget("target-art", "art"),
      inflections: ["artist", "the"],
    };
    const invalid = evaluateLessonDraft(
      makeDraft({
        targets: [invalidTarget],
        story: "The artist works in a gallery.",
      }),
      makeBrief({ targets: [invalidTarget] }),
    );
    assert.equal(invalid.metrics.targetOccurrences["target-art"], 0);
    assert.equal(
      invalid.issues.filter((issue) => issue.code === "unverified_inflection").length,
      2,
    );
    assert.ok(invalid.issues.some((issue) => issue.code === "target_story_missing"));

    const approvedTargets = [
      { ...makeTarget("target-go", "go"), inflections: ["went"] },
      { ...makeTarget("target-look-up", "look up"), inflections: ["looked up"] },
      { ...makeTarget("target-city", "city"), inflections: ["cities"] },
      { ...makeTarget("target-prefer", "prefer"), inflections: ["preferred", "preferring"] },
    ];
    const approved = evaluateLessonDraft(
      makeDraft({
        targets: approvedTargets,
        story: "We went home. I looked up the answer. Cities grow. The team preferred tea and was preferring a quiet room.",
      }),
      makeBrief({ targets: approvedTargets }),
    );
    assert.equal(approved.metrics.targetOccurrences["target-go"], 1);
    assert.equal(approved.metrics.targetOccurrences["target-look-up"], 1);
    assert.equal(approved.metrics.targetOccurrences["target-city"], 1);
    assert.equal(approved.metrics.targetOccurrences["target-prefer"], 2);
    assert.ok(!approved.issues.some((issue) => issue.code === "unverified_inflection"));

    const contraction = evaluateLessonDraft(
      makeDraft({
        targets: [makeTarget("target-can", "can")],
        story: "I can't wait.",
      }),
      makeBrief({ targets: [makeTarget("target-can", "can")] }),
    );
    assert.equal(contraction.metrics.targetOccurrences["target-can"], 0);
    assert.ok(contraction.issues.some((issue) => issue.code === "target_story_missing"));

    const unsupportedPossessive = evaluateLessonDraft(
      makeDraft({
        targets: [makeTarget("target-john", "John")],
        story: "John's bag is here.",
      }),
      makeBrief({ targets: [makeTarget("target-john", "John")] }),
    );
    assert.equal(unsupportedPossessive.metrics.targetOccurrences["target-john"], 0);
    assert.ok(unsupportedPossessive.issues.some((issue) => issue.code === "target_story_missing"));

    const approvedPossessiveTarget = {
      ...makeTarget("target-john", "John"),
      inflections: ["John's"],
    };
    const approvedPossessive = evaluateLessonDraft(
      makeDraft({
        targets: [approvedPossessiveTarget],
        story: "John's bag is here.",
      }),
      makeBrief({ targets: [approvedPossessiveTarget] }),
    );
    assert.equal(approvedPossessive.metrics.targetOccurrences["target-john"], 1);
    assert.ok(!approvedPossessive.issues.some((issue) => issue.code === "unverified_inflection"));
  });

  await test("does not invent unsafe stems and rejects section claims without occurrences", () => {
    const targets = [makeTarget("target-art", "art"), makeTarget("target-play", "play")];
    const result = evaluateLessonDraft(
      makeDraft({
        targets,
        story: "The artist is a player.",
        sectionTargetIds: ["target-art", "target-play"],
      }),
      makeBrief({ targets }),
    );
    assert.equal(result.metrics.targetOccurrences["target-art"], 0);
    assert.equal(result.metrics.targetOccurrences["target-play"], 0);
    assert.ok(result.issues.some((issue) => issue.code === "target_story_missing"));
    assert.ok(result.issues.some((issue) => issue.code === "section_target_missing"));
  });

  await test("requires practice exposure and the three fixed exercise kinds plus retell", () => {
    const targets = [makeTarget("target-coffee", "coffee")];
    const draft = makeDraft({ targets });
    draft.exercises = [draft.exercises[0]];
    const result = evaluateLessonDraft(draft, makeBrief({ targets }));
    assert.equal(result.ok, false);
    assert.equal(result.metrics.practiceExposure["target-coffee"], 1);
    assert.ok(result.issues.some((issue) => issue.code === "practice_coverage_missing"));
    assert.ok(result.issues.some((issue) => issue.code === "exercise_kind_missing"));
  });

  await test("binds fixed exercises to visible target text before counting exposure", () => {
    const targets = [makeTarget("target-cup", "cup"), makeTarget("target-tea", "tea")];
    const draft = makeDraft({
      targets,
      story: "The cup holds tea. The tea is warm.",
    });
    draft.exercises = [draft.exercises[0], draft.exercises[1]];
    draft.exercises[0].targetIds = targets.map((target) => target.id);
    draft.exercises[1].targetIds = targets.map((target) => target.id);
    const result = evaluateLessonDraft(draft, makeBrief({ targets }));
    assert.equal(result.metrics.targetOccurrences["target-tea"], 2);
    assert.equal(result.metrics.practiceExposure["target-tea"], 0);
    assert.ok(result.issues.some((issue) => issue.code === "meaning_target_ambiguous"));
    assert.ok(result.issues.some((issue) => issue.code === "exercise_target_missing"));
  });

  await test("counts a target in paired single quotes without accepting a possessive", () => {
    const target = makeTarget("target-cup", "cup");
    const quoted = makeDraft({ targets: [target], story: "The cup is clean." });
    quoted.exercises[0].choices = [
      { id: "choice-container", text: "A drinking container" },
      { id: "choice-other", text: "Another meaning" },
    ];
    quoted.exercises[0].answerChoiceIds = ["choice-container"];
    quoted.exercises[0].prompt = "What is a 'cup'?";
    const quotedResult = evaluateLessonDraft(quoted, makeBrief({ targets: [target] }));
    assert.ok(!quotedResult.issues.some((issue) => issue.code === "exercise_target_missing"));

    quoted.exercises[0].prompt = "What is a ‘cup’?";
    const curlyQuotedResult = evaluateLessonDraft(quoted, makeBrief({ targets: [target] }));
    assert.ok(!curlyQuotedResult.issues.some((issue) => issue.code === "exercise_target_missing"));

    quoted.exercises[0].prompt = "What belongs to cup's owner?";
    const possessiveResult = evaluateLessonDraft(quoted, makeBrief({ targets: [target] }));
    assert.ok(possessiveResult.issues.some((issue) => issue.code === "exercise_target_missing"));
  });

  await test("rejects answer choices that only differ by case or whitespace", () => {
    const target = makeTarget("target-cup", "cup");
    const draft = makeDraft({ targets: [target] });
    draft.exercises[0].choices = [
      { id: "choice-one", text: "A small cup" },
      { id: "choice-two", text: "  a SMALL   cup " },
    ];
    draft.exercises[0].answerChoiceIds = ["choice-one"];
    const result = evaluateLessonDraft(draft, makeBrief({ targets: [target] }));
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === "ambiguous_answers"));
  });

  await test("flags duplicate normalized targets and duplicate keywords", () => {
    const targets = [
      makeTarget("target-one", "Coffee", "a drink"),
      makeTarget("target-two", "coffee", "a drink"),
    ];
    const result = evaluateLessonDraft(
      makeDraft({ targets, story: "Coffee is ready. I drink coffee." }),
      makeBrief({ targets, keywords: ["coffee", "Coffee"] }),
    );
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === "duplicate_target"));
    assert.ok(result.issues.some((issue) => issue.code === "duplicate_keyword"));
  });

  await test("flags clearly Vietnamese stories hard and uncertain language softly", () => {
    const targets = [makeTarget("target-market", "market")];
    const vietnamese = evaluateLessonDraft(
      makeDraft({ targets, story: "Tôi đi đến chợ và mua cà phê." }),
      makeBrief({ targets }),
    );
    assert.equal(vietnamese.ok, false);
    assert.ok(vietnamese.issues.some((issue) => issue.code === "story_language_mismatch"));

    const uncertain = evaluateLessonDraft(
      makeDraft({ targets, story: "Bright market. Small table. People talk." }),
      makeBrief({ targets }),
    );
    assert.equal(uncertain.ok, true);
    assert.ok(uncertain.warnings.some((issue) => issue.code === "story_language_uncertain"));
  });

  await test("uses transparent CEFR length guidance as warnings, not semantic gates", () => {
    const targets = [makeTarget("target-nevertheless", "nevertheless")];
    const result = evaluateLessonDraft(
      makeDraft({ targets, story: "Nevertheless, we continue." }),
      makeBrief({ targets, level: "A1", length: "medium" }),
    );
    assert.equal(result.ok, true);
    assert.ok(result.warnings.some((issue) => issue.code === "cefr_length_outside_rubric"));
    assert.ok(result.warnings.some((issue) => issue.code === "target_above_requested_level"));
    assert.deepEqual(getCefrRubric("A2", "medium").wordRange, [150, 250]);
  });

  const fixturePath = path.join(root, "e2e/fixtures/learning-evaluation.json");
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  await test("ships thirty labeled deterministic evaluation fixtures", () => {
    assert.equal(fixture.fixtureType, "deterministic-handmade-not-real-generated-corpus");
    assert.equal(fixture.cases.length, 30);
    assert.deepEqual(new Set(fixture.cases.map((item) => item.level)), new Set([
      "A1", "A2", "B1", "B2", "C1", "C2",
    ]));
    assert.equal(new Set(fixture.cases.map((item) => item.topic)).size, 5);
  });

  const sharedLessonFixture = await import(
    pathToFileURL(path.join(root, "scripts/fixtures/learning-lesson.mjs")).href,
  );
  await test("accepts the shared cup lesson fixture", () => {
    const result = evaluateLessonDraft(
      sharedLessonFixture.learningDraft,
      sharedLessonFixture.learningBrief,
    );
    assert.equal(result.ok, true);
    assert.match(
      sharedLessonFixture.learningDraft.exercises.find((exercise) => exercise.kind === "meaning").prompt,
      /cup/iu,
    );
  });

  const fixtureDraft = (item, target) => {
    const term = target.term;
    let story = `The ${term} is useful. We discuss ${term} today.`;
    if (item.adversarial === "wrong-language") {
      story = "Tôi đi đến chợ và mua cà phê.";
    } else if (item.adversarial === "art-prefix") {
      story = "The artist works in a gallery. The artist greets a friend.";
    } else if (item.adversarial === "missing-coverage") {
      story = "The player smiles at the market. The player talks with a friend.";
    } else if (item.adversarial === "multiword") {
      story = "We walk to the coffee shop. The coffee shop is busy today.";
    } else if (item.adversarial === "apostrophe") {
      story = "I don't sleep late. I don't sleep at work.";
    } else if (item.adversarial === "polysemy") {
      story = `The ${term} opens early. We visit the ${term} together.`;
    }
    const targetId = `fixture-target-${item.id}`;
    const exerciseTargetIds = [targetId];
    return {
      title: `Fixture lesson: ${item.id}`,
      sections: [{ id: `fixture-section-${item.id}`, text: story, targetIds: [targetId] }],
      glossary: [{
        targetId,
        definition: target.definition,
        translationVi: target.translationVi,
        example: target.example,
      }],
      scenes: [],
      exercises: [
        {
          kind: "meaning",
          id: `fixture-meaning-${item.id}`,
          prompt: `What does ${term} mean?`,
          targetIds: exerciseTargetIds,
          choices: [
            { id: `fixture-choice-correct-${item.id}`, text: target.definition },
            { id: `fixture-choice-other-${item.id}`, text: "Another meaning" },
          ],
          answerChoiceIds: [`fixture-choice-correct-${item.id}`],
        },
        {
          kind: "fill",
          id: `fixture-fill-${item.id}`,
          prompt: `Complete the sentence with ${term}.`,
          targetIds: exerciseTargetIds,
          acceptedAnswers: [term],
        },
        {
          kind: "order",
          id: `fixture-order-${item.id}`,
          prompt: `Put the words for ${term} in order.`,
          targetIds: exerciseTargetIds,
          tokens: term.split(/\s+/u).length > 1
            ? term.split(/\s+/u).map((text, index) => ({
              id: `fixture-token-${item.id}-${index + 1}`,
              text,
            }))
            : [
              { id: `fixture-token-${item.id}-1`, text: "We" },
              { id: `fixture-token-${item.id}-2`, text: term },
            ],
          acceptedOrders: [term.split(/\s+/u).length > 1
            ? term.split(/\s+/u).map((_, index) => `fixture-token-${item.id}-${index + 1}`)
            : [`fixture-token-${item.id}-1`, `fixture-token-${item.id}-2`]],
        },
        {
          kind: "retell",
          id: `fixture-retell-${item.id}`,
          prompt: "Retell the story.",
          targetIds: exerciseTargetIds,
          hints: ["Say what happened."],
        },
      ],
      entityDescriptions: [],
    };
  };

  await test("evaluates every labeled fixture with the canonical validator", () => {
    for (const item of fixture.cases) {
      const targetId = `fixture-target-${item.id}`;
      const target = {
        id: targetId,
        term: item.targets[0].term,
        sense: item.targets[0].sense,
        definition: `A clear definition of ${item.targets[0].term}.`,
        translationVi: `bản dịch ${item.targets[0].term}`,
        example: `This example uses ${item.targets[0].term}.`,
      };
      const brief = {
        topic: item.topic,
        keywords: item.keywords,
        level: item.level,
        length: item.length,
        imageCount: 0,
        audio: false,
        targets: [target],
      };
      const result = evaluateLessonDraft(fixtureDraft(item, target), brief);
      assert.equal(result.ok, item.expectedOk, item.id);
      for (const expectedCode of item.expectedIssueCodes ?? []) {
        assert.ok(
          result.issues.some((issue) => issue.code === expectedCode),
          `${item.id} missing expected issue ${expectedCode}`,
        );
      }
      assert.ok(result.metrics.targetOccurrences[targetId] >= 0, `${item.id} has no target metric`);
    }
  });

  console.log(`PASS: ${tests.length} lesson generation contract cases.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
