import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { build } from "esbuild";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-learning-contracts-"));

try {
  const output = path.join(temp, "learning-contracts.mjs");
  await build({
    stdin: {
      contents: `
        export * from "./src/lib/learning-schemas.ts";
        export * from "./src/lib/mindmap-schema.ts";
        export * from "./src/lib/learning-validator.ts";
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
  const {
    CefrLevelSchema,
    RawBriefInputSchema,
    LearningTargetSchema,
    LessonBriefSchema,
    LessonDraftSchema,
    ExerciseSchema,
    MindmapGraphSchema,
    GenerationStageSchema,
    StageAttemptSchema,
    StageCandidateEnvelopeSchema,
    validateLessonDraft,
    validateGeneratedMindmapGraph,
    validateMindmapGraph,
    evaluateLessonDraft,
  } = contracts;

  const tests = [];
  const test = async (name, callback) => {
    await callback();
    tests.push(name);
  };

  const validRawBrief = {
    topic: "Ordering coffee with a colleague",
    keywords: ["order", "coffee", "colleague"],
    level: "A2",
    length: "short",
    imageCount: 1,
    audio: true,
  };
  const targetOrder = {
    id: "target-order",
    term: "order coffee",
    sense: "ask for food or drink in a cafe",
    definition: "To request something from a menu.",
    translationVi: "gọi món cà phê",
    example: "I would like to order coffee, please.",
    inflections: ["ordered", "ordering"],
    evidence: { status: "unverified" },
  };
  const targetColleague = {
    id: "target-colleague",
    term: "colleague",
    sense: "a person you work with",
    definition: "Someone who works with you.",
    translationVi: "đồng nghiệp",
    example: "My colleague joined me for coffee.",
    evidence: { status: "dictionary", source: "local-en-vi" },
  };
  const validBrief = {
    ...validRawBrief,
    targets: [targetOrder, targetColleague],
  };
  const validDraft = {
    title: "Coffee with a colleague",
    sections: [{
      id: "section-opening",
      text: "I order coffee with my colleague.",
      targetIds: ["target-order", "target-colleague"],
    }],
    glossary: [
      {
        targetId: "target-order",
        definition: targetOrder.definition,
        translationVi: targetOrder.translationVi,
        example: targetOrder.example,
      },
      {
        targetId: "target-colleague",
        definition: targetColleague.definition,
        translationVi: targetColleague.translationVi,
        example: targetColleague.example,
      },
    ],
    scenes: [{
      id: "scene-cafe",
      description: "A quiet cafe counter.",
      sectionIds: ["section-opening"],
      targetIds: ["target-order", "target-colleague"],
      entityDescriptionIds: [],
    }],
    exercises: [
      {
        kind: "meaning",
        id: "exercise-meaning",
        prompt: "What does colleague mean?",
        targetIds: ["target-colleague"],
        choices: [
          { id: "choice-workmate", text: "A person you work with" },
          { id: "choice-customer", text: "A person who buys something" },
        ],
        answerChoiceIds: ["choice-workmate"],
      },
      {
        kind: "fill",
        id: "exercise-fill",
        prompt: "Complete: I ___ coffee.",
        targetIds: ["target-order"],
        acceptedAnswers: ["order", "ordered"],
      },
      {
        kind: "order",
        id: "exercise-order",
        prompt: "Put the words in order.",
        targetIds: ["target-order"],
        tokens: [
          { id: "token-i", text: "I" },
          { id: "token-order", text: "order" },
          { id: "token-coffee", text: "coffee" },
        ],
        acceptedOrders: [["token-i", "token-order", "token-coffee"]],
      },
      {
        kind: "retell",
        id: "exercise-retell",
        prompt: "Retell the cafe conversation.",
        targetIds: ["target-order", "target-colleague"],
        hints: ["Say who you met.", "Say what you ordered."],
      },
    ],
    entityDescriptions: [{
      id: "entity-cafe",
      description: "A small cafe with a wooden counter.",
      entityResourceId: "5d6f1c2a-7d5b-4f83-b2c1-0e65a2a48e21",
    }],
  };

  await test("accepts CEFR levels and the valid raw brief", () => {
    for (const level of ["A1", "A2", "B1", "B2", "C1", "C2"]) {
      assert.equal(CefrLevelSchema.safeParse(level).success, true);
    }
    assert.equal(RawBriefInputSchema.safeParse(validRawBrief).success, true);
  });

  await test("rejects an empty raw brief and bounded input overflow", () => {
    assert.equal(RawBriefInputSchema.safeParse({
      ...validRawBrief,
      topic: "",
      keywords: ["coffee"],
    }).success, true);
    assert.equal(RawBriefInputSchema.safeParse({
      ...validRawBrief,
      topic: "   ",
      keywords: [],
    }).success, false);
    assert.equal(RawBriefInputSchema.safeParse({
      ...validRawBrief,
      topic: "x".repeat(501),
    }).success, false);
    assert.equal(RawBriefInputSchema.safeParse({
      ...validRawBrief,
      keywords: ["x".repeat(81)],
    }).success, false);
    assert.equal(RawBriefInputSchema.safeParse({
      ...validRawBrief,
      keywords: Array.from({ length: 13 }, (_, index) => `keyword-${index}`),
    }).success, false);
    assert.equal(RawBriefInputSchema.safeParse({
      ...validRawBrief,
      imageCount: 5,
    }).success, false);
  });

  await test("keeps a multiword target intact and does not normalize semantic case", () => {
    const parsed = LearningTargetSchema.parse(targetOrder);
    assert.equal(parsed.term, "order coffee");
    assert.equal(parsed.sense, "ask for food or drink in a cafe");
    assert.equal(LearningTargetSchema.safeParse({
      ...targetOrder,
      term: "Order Coffee",
    }).success, true);
    assert.equal(LearningTargetSchema.safeParse({
      ...targetOrder,
      sense: "Art as a creative practice",
    }).success, true);
  });

  await test("validates finalized briefs with one to twelve targets", () => {
    assert.equal(LessonBriefSchema.safeParse(validBrief).success, true);
    assert.equal(LessonBriefSchema.safeParse({
      ...validBrief,
      topic: "",
    }).success, true);
    const resolvedBrief = { ...validBrief };
    delete resolvedBrief.topic;
    delete resolvedBrief.keywords;
    assert.equal(LessonBriefSchema.safeParse(resolvedBrief).success, true);
    assert.equal(LessonBriefSchema.safeParse({
      ...validBrief,
      targets: [],
    }).success, false);
    assert.equal(LessonBriefSchema.safeParse({
      ...validBrief,
      targets: Array.from({ length: 13 }, (_, index) => ({
        ...targetOrder,
        id: `target-${index}`,
      })),
    }).success, false);
  });

  await test("validates all polymorphic exercise kinds and their canonical answers", () => {
    assert.equal(ExerciseSchema.safeParse(validDraft.exercises[0]).success, true);
    assert.equal(ExerciseSchema.safeParse(validDraft.exercises[1]).success, true);
    assert.equal(ExerciseSchema.safeParse(validDraft.exercises[2]).success, true);
    assert.equal(ExerciseSchema.safeParse(validDraft.exercises[3]).success, true);
    assert.equal(ExerciseSchema.safeParse({
      ...validDraft.exercises[3],
      score: 1,
    }).success, false);
    assert.equal(ExerciseSchema.safeParse({
      ...validDraft.exercises[0],
      answerChoiceIds: ["choice-missing"],
    }).success, false);
    assert.equal(ExerciseSchema.safeParse({
      ...validDraft.exercises[0],
      choices: [
        validDraft.exercises[0].choices[0],
        { ...validDraft.exercises[0].choices[1], text: validDraft.exercises[0].choices[0].text },
      ],
    }).success, false);
  });

  const grammarTarget = {
    id: "target-coffee",
    term: "coffee",
    sense: "a drink made from roasted beans",
    definition: "A drink made from roasted coffee beans.",
    translationVi: "cà phê",
    example: "Mara orders coffee.",
  };
  const grammarBrief = {
    ...validBrief,
    topic: "Ordering coffee",
    keywords: ["coffee"],
    targets: [grammarTarget],
  };
  const grammarDraft = {
    title: "Ordering coffee",
    sections: [{
      id: "section-coffee",
      text: "Mara orders coffee at a cafe.",
      targetIds: [grammarTarget.id],
    }],
    glossary: [{
      targetId: grammarTarget.id,
      definition: grammarTarget.definition,
      translationVi: grammarTarget.translationVi,
      example: grammarTarget.example,
    }],
    scenes: [{
      id: "scene-coffee",
      description: "A quiet cafe counter.",
      sectionIds: ["section-coffee"],
      targetIds: [grammarTarget.id],
      entityDescriptionIds: [],
    }],
    exercises: [
      {
        kind: "meaning",
        id: "exercise-coffee-meaning",
        prompt: "What does coffee mean?",
        targetIds: [grammarTarget.id],
        choices: [
          { id: "choice-coffee-drink", text: grammarTarget.definition },
          { id: "choice-coffee-place", text: "A place to sleep" },
        ],
        answerChoiceIds: ["choice-coffee-drink"],
      },
      {
        kind: "fill",
        id: "exercise-coffee-fill",
        prompt: "Complete: I drink coffee.",
        targetIds: [grammarTarget.id],
        acceptedAnswers: ["coffee"],
      },
      {
        kind: "order",
        id: "exercise-coffee-order",
        prompt: "Put the coffee words in order.",
        targetIds: [grammarTarget.id],
        tokens: [
          { id: "token-i", text: "I" },
          { id: "token-coffee", text: "coffee" },
        ],
        acceptedOrders: [["token-i", "token-coffee"]],
      },
      {
        kind: "retell",
        id: "exercise-coffee-retell",
        prompt: "Retell the coffee order.",
        targetIds: [grammarTarget.id],
        hints: ["Say what Mara ordered."],
      },
    ],
    entityDescriptions: [],
  };
  const makeFillDraft = (prompt, acceptedAnswers) => {
    const draft = structuredClone(grammarDraft);
    const fill = draft.exercises.find((exercise) => exercise.kind === "fill");
    assert.ok(fill && fill.kind === "fill");
    fill.prompt = `Complete the coffee sentence: ${prompt}`;
    fill.acceptedAnswers = acceptedAnswers;
    return draft;
  };

  await test("rejects fill answers that repeat prompt articles or infinitive markers", () => {
    const accepted = evaluateLessonDraft(
      makeFillDraft("Mara ordered a large____.", ["coffee"]),
      grammarBrief,
    );
    assert.equal(accepted.ok, true);
    assert.equal(
      accepted.issues.some((issue) => issue.code === "fill_answer_leading_article"),
      false,
    );

    const repeatedArticleCases = [
      ["Mara ordered a____.", ["a coffee"]],
      ["Mara ordered a large____.", ["a coffee"]],
      ["Mara opened the____.", ["a coffee"]],
      ["Mara bought a flexible____.", ["a ticket", "the ticket"]],
      ["Maya's____.", ["a colleague"]],
    ];
    for (const [prompt, answers] of repeatedArticleCases) {
      const result = evaluateLessonDraft(makeFillDraft(prompt, answers), grammarBrief);
      const violations = result.issues.filter(
        (issue) => issue.code === "fill_answer_leading_article",
      );
      assert.equal(result.ok, false);
      assert.equal(violations.length, answers.length);
      assert.ok(violations.every((issue) => (
        issue.path[0] === "draft"
        && issue.path[1] === "exercises"
        && issue.path[3] === "acceptedAnswers"
      )));
      assert.ok(violations.every((issue) => issue.message.includes("remove the leading article")));
    }

    const repeatedInfinitiveCases = [
      ["Mara tried to____.", ["to sleep"]],
      ["Mara began to ____.", ["to sleep"]],
    ];
    for (const [prompt, answers] of repeatedInfinitiveCases) {
      const result = evaluateLessonDraft(makeFillDraft(prompt, answers), grammarBrief);
      const violations = result.issues.filter(
        (issue) => issue.code === "fill_answer_repeats_infinitive_marker",
      );
      assert.equal(result.ok, false);
      assert.equal(violations.length, answers.length);
      assert.ok(violations.every((issue) => issue.message.includes("remove the repeated marker")));
    }

    const noPromptDeterminer = evaluateLessonDraft(
      makeFillDraft("Mara ordered ______.", ["a ticket"]),
      grammarBrief,
    );
    assert.equal(noPromptDeterminer.ok, true);
    assert.equal(
      noPromptDeterminer.issues.some((issue) => issue.code === "fill_answer_leading_article"),
      false,
    );

    const oneUnderscore = evaluateLessonDraft(
      makeFillDraft("Mara ordered a _.", ["a ticket"]),
      grammarBrief,
    );
    assert.equal(oneUnderscore.ok, true);
    assert.equal(
      oneUnderscore.issues.some((issue) => issue.code === "fill_answer_leading_article"),
      false,
    );

    const noPromptInfinitive = evaluateLessonDraft(
      makeFillDraft("Mara tried to____.", ["sleep"]),
      grammarBrief,
    );
    assert.equal(noPromptInfinitive.ok, true);
    assert.equal(
      noPromptInfinitive.issues.some((issue) => issue.code === "fill_answer_repeats_infinitive_marker"),
      false,
    );
  });

  await test("rejects duplicate and dangling lesson IDs with structured errors", () => {
    const duplicate = structuredClone(validDraft);
    duplicate.sections.push({ ...duplicate.sections[0], id: "section-opening" });
    const duplicateResult = validateLessonDraft(duplicate, validBrief);
    assert.equal(duplicateResult.ok, false);
    assert.ok(duplicateResult.issues.some((issue) => issue.code === "duplicate_id"));

    const dangling = structuredClone(validDraft);
    dangling.scenes[0].sectionIds = ["section-missing"];
    const danglingResult = validateLessonDraft(dangling, validBrief);
    assert.equal(danglingResult.ok, false);
    assert.ok(danglingResult.issues.some((issue) => issue.code === "dangling_reference"));

    const duplicateReference = structuredClone(validDraft);
    duplicateReference.sections[0].targetIds.push("target-order");
    const duplicateReferenceResult = validateLessonDraft(duplicateReference, validBrief);
    assert.equal(duplicateReferenceResult.ok, false);
    assert.ok(duplicateReferenceResult.issues.some((issue) => issue.code === "duplicate_reference"));
  });

  await test("rejects lesson target references outside the finalized brief", () => {
    const draft = structuredClone(validDraft);
    draft.sections[0].targetIds.push("target-outside-brief");
    const result = validateLessonDraft(draft, validBrief);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === "target_out_of_scope"));
  });

  await test("enforces lesson, scene, and content ID limits", () => {
    assert.equal(LessonDraftSchema.safeParse({
      ...validDraft,
      title: "   ",
    }).success, false);
    assert.equal(LessonDraftSchema.safeParse({
      ...validDraft,
      sections: [{
        ...validDraft.sections[0],
        text: Array.from({ length: 1201 }, () => "word").join(" "),
      }],
    }).success, false);
    assert.equal(LessonDraftSchema.safeParse({
      ...validDraft,
      scenes: Array.from({ length: 5 }, (_, index) => ({
        ...validDraft.scenes[0],
        id: `scene-${index}`,
      })),
    }).success, false);
    assert.equal(LessonDraftSchema.safeParse({
      ...validDraft,
      entityDescriptions: [{
        ...validDraft.entityDescriptions[0],
        id: "unsafe id",
      }],
    }).success, false);
    assert.equal(LessonDraftSchema.safeParse({
      ...validDraft,
      entityDescriptions: [{
        ...validDraft.entityDescriptions[0],
        entityResourceId: "entity-resource-1",
      }],
    }).success, false);
    const tooManyScenes = structuredClone(validDraft);
    tooManyScenes.scenes.push({ ...tooManyScenes.scenes[0], id: "scene-second" });
    const sceneLimitResult = validateLessonDraft(tooManyScenes, validBrief);
    assert.equal(sceneLimitResult.ok, false);
    assert.ok(sceneLimitResult.issues.some((issue) => issue.code === "scene_count_exceeds_brief"));
  });

  await test("validates bounded mindmap graph content without layout", () => {
    const graph = {
      rootNodeId: "node-bank",
      nodes: [{
        id: "node-bank",
        term: "bank",
        sense: "a financial institution",
        definition: "An organization that keeps and lends money.",
        translationVi: "ngân hàng",
        partOfSpeech: "noun",
        example: "She works at a bank.",
        evidence: { status: "dictionary", source: "local-en-vi" },
      }],
      edges: [],
    };
    assert.equal(MindmapGraphSchema.safeParse(graph).success, true);
    assert.equal(validateMindmapGraph(graph).ok, true);
    assert.equal(MindmapGraphSchema.safeParse({ ...graph, layout: {} }).success, false);
    assert.equal(MindmapGraphSchema.safeParse({
      ...graph,
      nodes: [{
        ...graph.nodes[0],
        evidence: { status: "verified" },
      }],
    }).success, false);
    assert.equal(validateMindmapGraph({
      ...graph,
      edges: [{
        id: "edge-dangling",
        source: "node-bank",
        target: "node-missing",
        kind: "related-concept",
        evidence: { status: "unverified" },
      }],
    }).ok, false);
  });

  await test("rejects graph duplicate, self, and oversized edges", () => {
    const graph = {
      rootNodeId: "node-bank",
      nodes: [
        {
          id: "node-bank",
          term: "bank",
          sense: "financial institution",
          definition: "An organization that manages money.",
          translationVi: "ngân hàng",
          example: "The bank is open.",
          evidence: { status: "unverified" },
        },
        {
          id: "node-money",
          term: "money",
          sense: "currency",
          definition: "Something used to buy goods.",
          translationVi: "tiền",
          example: "I saved my money.",
          evidence: { status: "user" },
        },
      ],
      edges: [
        {
          id: "edge-bank-money",
          source: "node-bank",
          target: "node-money",
          kind: "related-concept",
          evidence: { status: "unverified" },
        },
      ],
    };
    const duplicate = structuredClone(graph);
    duplicate.edges.push({ ...duplicate.edges[0], id: "edge-duplicate" });
    assert.equal(validateMindmapGraph(duplicate).ok, false);
    const duplicateNodeEdgeId = structuredClone(graph);
    duplicateNodeEdgeId.edges[0].id = "node-bank";
    assert.equal(validateMindmapGraph(duplicateNodeEdgeId).ok, false);
    const selfEdge = structuredClone(graph);
    selfEdge.edges[0].target = "node-bank";
    assert.equal(validateMindmapGraph(selfEdge).ok, false);
    assert.equal(MindmapGraphSchema.safeParse({
      ...graph,
      nodes: Array.from({ length: 41 }, (_, index) => ({
        ...graph.nodes[0],
        id: `node-${index}`,
      })),
    }).success, false);
  });

  await test("keeps legacy graph parsing while enforcing generated study-group partitions", () => {
    const root = {
      id: "topic",
      term: "Travel",
      sense: "a study topic",
      definition: "Words used while travelling.",
      translationVi: "du lịch",
      example: "We travel by train.",
      evidence: { status: "unverified" },
    };
    const station = {
      id: "station",
      term: "station",
      sense: "a train station",
      definition: "A place where trains stop.",
      translationVi: "nhà ga",
      ipa: "/ˈsteɪ.ʃən/",
      example: "Meet me at the station.",
      evidence: { status: "unverified" },
    };
    const legacy = { rootNodeId: root.id, nodes: [root, { ...station, ipa: undefined }], edges: [] };
    assert.equal(MindmapGraphSchema.safeParse(legacy).success, true);
    assert.equal(validateMindmapGraph(legacy).ok, true);
    assert.equal(validateGeneratedMindmapGraph(legacy, { level: "A2", illustrations: false }).ok, false);

    const generated = {
      rootNodeId: root.id,
      nodes: [root, station],
      edges: [],
      studyGroups: [{
        id: "places",
        title: "Places",
        translationVi: "Địa điểm",
        nodeIds: [station.id],
        example: "The station is nearby.",
        exampleTranslationVi: "Nhà ga ở gần đây.",
        illustration: { prompt: "A traveller waiting beside a train platform", alt: "A traveller at a train station" },
      }],
    };
    assert.equal(validateGeneratedMindmapGraph(generated, { level: "A2", illustrations: true }).ok, true);

    const duplicateMember = structuredClone(generated);
    duplicateMember.studyGroups.push({ ...duplicateMember.studyGroups[0], id: "more-places" });
    const duplicateResult = validateGeneratedMindmapGraph(duplicateMember, { level: "A2", illustrations: true });
    assert.equal(duplicateResult.ok, false);
    assert.ok(duplicateResult.issues.some((issue) => issue.code === "duplicate_reference"));

    const missingMember = structuredClone(generated);
    missingMember.studyGroups[0].nodeIds = [];
    assert.equal(validateGeneratedMindmapGraph(missingMember, { level: "A2", illustrations: true }).ok, false);

    const danglingMember = structuredClone(generated);
    danglingMember.studyGroups[0].nodeIds = ["missing-node"];
    assert.equal(validateGeneratedMindmapGraph(danglingMember, { level: "A2", illustrations: true }).ok, false);

    const collidingGroup = structuredClone(generated);
    collidingGroup.studyGroups[0].id = "station";
    assert.equal(validateGeneratedMindmapGraph(collidingGroup, { level: "A2", illustrations: true }).ok, false);

    const missingIllustration = structuredClone(generated);
    delete missingIllustration.studyGroups[0].illustration;
    assert.equal(validateGeneratedMindmapGraph(missingIllustration, { level: "A2", illustrations: true }).ok, false);
    assert.equal(validateGeneratedMindmapGraph(missingIllustration, { level: "A2", illustrations: false }).ok, true);
  });

  await test("validates generation identities and finite candidate envelopes", () => {
    const ids = {
      jobId: "5d6f1c2a-7d5b-4f83-b2c1-0e65a2a48e21",
      stageId: "93e0d3c8-6ae7-4b70-9ee7-bf53ae6c0a91",
      attemptId: "b47c22e3-2e88-4a7e-94f4-4d96a9be49e7",
      expectedRevisionId: "58a78010-08f3-48c3-8e6a-2b44ed41a1a0",
    };
    assert.equal(GenerationStageSchema.safeParse({
      id: ids.stageId,
      jobId: ids.jobId,
      kind: "text",
      expectedRevisionId: ids.expectedRevisionId,
      state: "queued",
      activeAttemptId: null,
    }).success, true);
    assert.equal(StageAttemptSchema.safeParse({
      id: ids.attemptId,
      jobId: ids.jobId,
      stageId: ids.stageId,
      ordinal: 1,
      state: "running",
    }).success, true);
    assert.equal(StageAttemptSchema.safeParse({
      id: ids.attemptId,
      jobId: ids.jobId,
      stageId: ids.stageId,
      ordinal: 33,
      state: "running",
    }).success, true);
    assert.equal(StageAttemptSchema.safeParse({
      id: ids.attemptId,
      jobId: ids.jobId,
      stageId: ids.stageId,
      ordinal: Number.MAX_SAFE_INTEGER,
      state: "running",
    }).success, true);
    assert.equal(StageAttemptSchema.safeParse({
      id: ids.attemptId,
      jobId: ids.jobId,
      stageId: ids.stageId,
      ordinal: Number.MAX_SAFE_INTEGER + 1,
      state: "running",
    }).success, false);
    assert.equal(GenerationStageSchema.safeParse({
      id: ids.stageId,
      jobId: ids.jobId,
      kind: "text",
      expectedRevisionId: ids.expectedRevisionId,
      status: "queued",
      activeAttemptId: null,
    }).success, false);
    assert.equal(StageCandidateEnvelopeSchema.safeParse({
      kind: "text",
      ...ids,
      schemaVersion: 1,
      payloadHash: "a".repeat(64),
      payload: validDraft,
    }).success, true);
    const mapPayload = {
      rootNodeId: "node-bank",
      nodes: [{
        id: "node-bank",
        term: "bank",
        sense: "financial institution",
        definition: "An organization that manages money.",
        translationVi: "ngân hàng",
        example: "The bank is open.",
        evidence: { status: "unverified" },
      }],
      edges: [],
    };
    const assetBase = {
      assetId: "5d6f1c2a-7d5b-4f83-b2c1-0e65a2a48e21",
      slotId: "93e0d3c8-6ae7-4b70-9ee7-bf53ae6c0a91",
      sourceId: "scene-cafe",
      sourceHash: "c".repeat(64),
      relativePath: "b47c22e3-2e88-4a7e-94f4-4d96a9be49e7.png",
      sha256: "d".repeat(64),
      sizeBytes: 1024,
    };
    const envelopePayloads = {
      map: mapPayload,
      image: { ...assetBase, mimeType: "image/png", width: 1024, height: 768 },
      audio: {
        ...assetBase,
        relativePath: "b47c22e3-2e88-4a7e-94f4-4d96a9be49e7.mp3",
        mimeType: "audio/mpeg",
        durationMs: 5_000,
        sourceType: "section",
      },
      exercises: { exercises: validDraft.exercises },
    };
    for (const [kind, payload] of Object.entries(envelopePayloads)) {
      assert.equal(StageCandidateEnvelopeSchema.safeParse({
        kind,
        ...ids,
        schemaVersion: 1,
        payloadHash: "b".repeat(64),
        payload,
      }).success, true);
    }
    assert.equal(StageCandidateEnvelopeSchema.safeParse({
      kind: "image",
      ...ids,
      schemaVersion: 1,
      payloadHash: "b".repeat(64),
      payload: {
        ...envelopePayloads.image,
        sizeBytes: 64 * 1024 * 1024,
        width: 16_384,
        height: 16_384,
      },
    }).success, true);
    assert.equal(StageCandidateEnvelopeSchema.safeParse({
      kind: "audio",
      ...ids,
      schemaVersion: 1,
      payloadHash: "b".repeat(64),
      payload: {
        ...envelopePayloads.audio,
        durationMs: 2 * 60 * 60 * 1_000,
      },
    }).success, true);
    const invalidImageAssetFields = [
      ["assetId", "asset-1"],
      ["slotId", "slot-1"],
      ["sourceId", "unsafe source id"],
      ["sourceHash", "not-a-sha256"],
      ["relativePath", "folder/asset.png"],
      ["sha256", "g".repeat(64)],
      ["sizeBytes", 0],
      ["sizeBytes", 1.5],
      ["sizeBytes", Number.MAX_SAFE_INTEGER + 1],
      ["mimeType", "image/gif"],
      ["width", 0],
      ["width", 16_385],
      ["width", 1.5],
      ["height", 0],
      ["height", 16_385],
      ["height", 1.5],
    ];
    for (const [field, value] of invalidImageAssetFields) {
      assert.equal(StageCandidateEnvelopeSchema.safeParse({
        kind: "image",
        ...ids,
        schemaVersion: 1,
        payloadHash: "b".repeat(64),
        payload: { ...envelopePayloads.image, [field]: value },
      }).success, false, `image field should reject: ${field}`);
    }
    const invalidAudioAssetFields = [
      ["mimeType", "audio/flac"],
      ["durationMs", 0],
      ["durationMs", 2 * 60 * 60 * 1_000 + 1],
      ["durationMs", 1.5],
      ["sourceType", "scene"],
    ];
    for (const [field, value] of invalidAudioAssetFields) {
      assert.equal(StageCandidateEnvelopeSchema.safeParse({
        kind: "audio",
        ...ids,
        schemaVersion: 1,
        payloadHash: "b".repeat(64),
        payload: { ...envelopePayloads.audio, [field]: value },
      }).success, false, `audio field should reject: ${field}`);
    }
    assert.equal(StageCandidateEnvelopeSchema.safeParse({
      kind: "image",
      ...ids,
      schemaVersion: 1,
      payloadHash: "b".repeat(64),
      payload: {
        ...envelopePayloads.image,
        bytes: "base64-data",
      },
    }).success, false);
    assert.equal(StageCandidateEnvelopeSchema.safeParse({
      kind: "image",
      ...ids,
      schemaVersion: 1,
      payloadHash: "b".repeat(64),
      payload: {
        ...envelopePayloads.image,
        relativePath: "/tmp/absolute.png",
      },
    }).success, false);
    assert.equal(StageCandidateEnvelopeSchema.safeParse({
      kind: "image",
      ...ids,
      schemaVersion: 1,
      payloadHash: "b".repeat(64),
      payload: {
        ...envelopePayloads.image,
        sizeBytes: 64 * 1024 * 1024 + 1,
      },
    }).success, false);
    assert.equal(StageCandidateEnvelopeSchema.safeParse({
      kind: "audio",
      ...ids,
      schemaVersion: 1,
      payloadHash: "b".repeat(64),
      payload: {
        ...envelopePayloads.audio,
        sourceType: "scene",
      },
    }).success, false);
    assert.equal(StageCandidateEnvelopeSchema.safeParse({
      kind: "text",
      ...ids,
      schemaVersion: 2,
      payloadHash: "a".repeat(64),
      payload: validDraft,
    }).success, false);
  });

  console.log(`PASS: ${tests.length} learning contract cases.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
