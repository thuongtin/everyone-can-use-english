import assert from "node:assert/strict";
import { build } from "esbuild";
import { Sequelize } from "sequelize";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const root = resolve(import.meta.dirname, "..");
const evidenceDirectory = join(root, "tmp/learning-acceptance/2026-09-07/ae1-six-targets");
const temporary = await mkdtemp(join(root, ".tmp-native-generation-ae1-"));
const targetDefinitions = [
  {
    id: "order",
    term: "order",
    sense: "to ask for food or a drink at a cafe or restaurant",
    definition: "To ask for the food or drink that you want.",
    translationVi: "gọi món; đặt món",
    example: "We order coffee at the cafe.",
  },
  {
    id: "menu",
    term: "menu",
    sense: "a list of food and drinks available at a cafe or restaurant",
    definition: "A list of food and drinks that a cafe or restaurant offers.",
    translationVi: "thực đơn",
    example: "The menu has tea, coffee, and sandwiches.",
  },
  {
    id: "coffee",
    term: "coffee",
    sense: "a hot drink made from roasted coffee beans",
    definition: "A hot drink made from roasted coffee beans.",
    translationVi: "cà phê",
    example: "I drink coffee in the morning.",
  },
  {
    id: "colleague",
    term: "colleague",
    sense: "a person you work with",
    definition: "A person who works with you.",
    translationVi: "đồng nghiệp",
    example: "My colleague sits beside me at work.",
  },
  {
    id: "prefer",
    term: "prefer",
    sense: "to like one thing more than another",
    definition: "To like one thing more than another thing.",
    translationVi: "thích hơn",
    example: "I prefer coffee to tea.",
  },
  {
    id: "bill",
    term: "bill",
    sense: "the amount of money to pay for food or drinks",
    definition: "The amount of money that you must pay for food or drinks.",
    translationVi: "hóa đơn",
    example: "The waiter brings the bill after lunch.",
  },
];
const brief = {
  topic: "Ordering a drink and paying the bill at a coffee shop with a colleague",
  keywords: targetDefinitions.map((target) => target.term),
  level: "A2",
  length: "short",
  imageCount: 0,
  audio: false,
  targets: targetDefinitions,
};

let database;
let runtime;

function countTargetReferences(items, targetIds) {
  const counts = Object.fromEntries(targetIds.map((targetId) => [targetId, 0]));
  for (const item of items) {
    for (const targetId of item.targetIds ?? []) {
      if (targetId in counts) counts[targetId] += 1;
    }
  }
  return counts;
}

try {
  const output = join(temporary, "subject.mjs");
  await build({
    stdin: {
      contents: [
        'export { LearningRuntime } from "./src/main/learning/runtime";',
        'export { evaluateLessonDraft } from "./src/lib/learning-validator";',
        'export { probeNativeAgent } from "./src/main/agents/native-discovery";',
      ].join("\n"),
      resolveDir: root,
      sourcefile: "ae1-native-subject.ts",
    },
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "silent",
  });
  const { LearningRuntime, evaluateLessonDraft, probeNativeAgent } = await import(pathToFileURL(output).href);
  const migration = await import(pathToFileURL(join(root, "src/main/db/migrations/1788701024340-create-learning-studio.js")).href);

  const probe = await probeNativeAgent("codex");
  assert.equal(probe.version, "0.153.4");
  assert.equal(probe.authenticated, true);
  assert.equal(probe.text, true);
  assert.equal(probe.image, true);
  assert.equal(probe.reason, null);
  assert.ok(probe.executable);

  database = new Sequelize({
    dialect: "sqlite",
    storage: join(temporary, "learning.sqlite"),
    logging: false,
  });
  await migration.up({ context: database.getQueryInterface() });
  runtime = await LearningRuntime.open({
    sequelize: database,
    profileId: "ae1-six-targets",
    assetRoot: join(temporary, "assets"),
  });

  const created = await runtime.storage.createLesson({
    brief,
    title: "A Coffee Break with a Colleague",
  });
  const startedAt = Date.now();
  const { jobId } = await runtime.generation.generate({
    provider: "codex",
    resourceType: "lesson",
    resourceId: created.lesson.id,
    revisionId: created.revision.id,
    requestKey: randomUUID(),
  });

  let state;
  let lastSummary = "";
  while (Date.now() - startedAt < 700_000) {
    state = await runtime.application.jobs.get(jobId);
    const summary = JSON.stringify({
      state: state.job.state,
      stages: state.stages.map((stage) => ({ key: stage.key, kind: stage.kind, state: stage.state })),
      errors: state.attempts.filter((attempt) => attempt.errorCode).map((attempt) => attempt.errorCode),
    });
    if (summary !== lastSummary) {
      console.log(summary);
      lastSummary = summary;
    }
    if (["completed", "failed", "cancelled", "interrupted"].includes(state.job.state)) break;
    if (state.job.state === "partial" && state.stages.some((stage) => stage.state === "failed")) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }

  assert.ok(state);
  assert.equal(state.job.state, "completed", JSON.stringify(state.attempts.map((attempt) => ({ state: attempt.state, error: attempt.errorCode }))));
  const lesson = await runtime.storage.getLesson(created.lesson.id);
  const revision = lesson.revisions.find((candidate) => candidate.id === created.revision.id);
  assert.ok(revision);
  assert.equal(revision.status, "ready");

  const validation = evaluateLessonDraft(revision.content, brief);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));

  const targetIds = targetDefinitions.map((target) => target.id);
  const glossaryReferences = Object.fromEntries(targetIds.map((targetId) => [
    targetId,
    revision.content.glossary.filter((entry) => entry.targetId === targetId).length,
  ]));
  const sectionReferences = countTargetReferences(revision.content.sections, targetIds);
  const exerciseReferences = countTargetReferences(revision.content.exercises, targetIds);
  const mechanical = {
    validatorOk: validation.ok,
    issueCount: validation.issues.length,
    warningCount: validation.warnings.length,
    metrics: validation.metrics,
    targetIds,
    glossaryReferences,
    sectionReferences,
    exerciseReferences,
    allTargetsInStory: targetIds.every((targetId) => validation.metrics.targetOccurrences[targetId] >= 1),
    exactlyOneGlossaryEach: targetIds.every((targetId) => glossaryReferences[targetId] === 1),
    practiceAtLeastTwiceEach: targetIds.every((targetId) => validation.metrics.practiceExposure[targetId] >= 2),
  };
  assert.equal(mechanical.allTargetsInStory, true);
  assert.equal(mechanical.exactlyOneGlossaryEach, true);
  assert.equal(mechanical.practiceAtLeastTwiceEach, true);

  await mkdir(evidenceDirectory, { recursive: true });
  const evidence = {
    schemaVersion: 1,
    pass: true,
    acceptance: "AE1",
    provider: "codex",
    version: probe.version,
    runtime: "native CLI auth reuse + Enjoy MCP + SQLite",
    elapsedMs: Date.now() - startedAt,
    brief,
    job: state,
    content: revision.content,
    validation: {
      issues: validation.issues,
      warnings: validation.warnings,
    },
    mechanical,
    assets: lesson.assets,
  };
  await writeFile(
    join(evidenceDirectory, "codex-native-ae1-lesson.json"),
    JSON.stringify(evidence, null, 2),
  );
  await writeFile(
    join(evidenceDirectory, "brief.json"),
    JSON.stringify(brief, null, 2),
  );
  console.log(JSON.stringify({
    pass: true,
    acceptance: "AE1",
    provider: "codex",
    version: probe.version,
    elapsedMs: evidence.elapsedMs,
    targets: targetIds,
    sections: revision.content.sections.length,
    exercises: revision.content.exercises.length,
    warnings: validation.warnings.length,
  }));
} catch (error) {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : "ae1_native_check_failed";
  console.error(JSON.stringify({ pass: false, acceptance: "AE1", code }));
  process.exitCode = 1;
} finally {
  await runtime?.close();
  await database?.close();
  await rm(temporary, { recursive: true, force: true });
}
