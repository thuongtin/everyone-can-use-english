import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { Sequelize } from "sequelize";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { learningBrief, learningDraft, learningMap } from "./fixtures/learning-lesson.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(root, ".tmp-learning-application-"));
let db, app, scope;
const clients = [];
try {
  const output = path.join(temp, "subject.mjs");
  await build({ stdin: { contents: `export { LearningApplication } from './src/main/learning/service'; export { LearningProfileScope } from './src/main/learning/profile-scope'; export { createLearningModels } from './src/main/db/learning-models'; export { canonicalPayloadHash } from './src/main/learning/candidate'; export { createLearningMcpServer } from './src/main/learning/mcp-server';`, resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "esm", outfile: output, packages: "external", logLevel: "silent" });
  const { LearningApplication, LearningProfileScope, createLearningModels, canonicalPayloadHash, createLearningMcpServer } = await import(pathToFileURL(output).href);
  db = new Sequelize({ dialect: "sqlite", storage: path.join(temp, "app.sqlite"), logging: false });
  const models = createLearningModels(db);
  const migration = await import(pathToFileURL(path.join(root, "src/main/db/migrations/1788701024340-create-learning-studio.js")).href);
  await migration.up({ context: db.getQueryInterface() });
  const mapBriefMigration = await import(pathToFileURL(path.join(root, "src/main/db/migrations/1788789600000-add-learning-map-brief.js")).href);
  await mapBriefMigration.up({ context: db.getQueryInterface() });
  scope = new LearningProfileScope("profile-a", temp);
  let tail = Promise.resolve();
  const storage = { models, scope, write(action) { const operation = tail.then(() => scope.run(() => db.transaction(action))); tail = operation.catch(() => {}); return operation; } };
  app = new LearningApplication(storage);
  const profileId = scope.context.profileId;
  const makeLesson = async (brief = learningBrief) => {
    const lesson = await models.LearningLesson.create({ profileId, title: "Draft" });
    const revision = await models.LessonRevision.create({ profileId, lessonId: lesson.id, number: 1, brief, status: "draft" });
    await lesson.update({ activeRevisionId: revision.id });
    const created = await app.jobs.create({ resourceType: "lesson", resourceId: lesson.id, revisionId: revision.id, requestKey: randomUUID(), stages: [{ key: "text", kind: "text" }] });
    const attempt = await app.jobs.startAttempt(created.stages[0].id, "test-native");
    return { lesson, revision, ...created, attempt };
  };
  const connect = async (subject) => {
    const access = await app.connectAttempt({ jobId: subject.job.id, stageId: subject.stages[0].id, attemptId: subject.attempt.id, revisionId: subject.revision.id });
    const client = new Client({ name: "learning-application-test", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(access.url), { requestInit: { headers: { Authorization: `Bearer ${access.token}` } } }));
    clients.push(client);
    return client;
  };
  const submitArgs = (subject, payload) => ({ schemaVersion: 1, jobId: subject.job.id, stageId: subject.stages[0].id, attemptId: subject.attempt.id, expectedRevisionId: subject.revision.id, payload });
  const first = await makeLesson();
  const client = await connect(first);
  await assert.rejects(app.connectAttempt({ jobId: first.job.id, stageId: first.stages[0].id, attemptId: first.attempt.id, revisionId: first.revision.id }), { code: "learning_attempt_connection_exists" });
  const context = JSON.parse((await client.callTool({ name: "enjoy.get_job_context", arguments: {} })).content[0].text);
  assert.deepEqual(context.brief, learningBrief);
  assert.equal(JSON.stringify(context).includes(temp), false);
  const missingCup = structuredClone(learningDraft);
  missingCup.sections[0].text = "I have a drink. My friend is here.";
  const rejected = JSON.parse((await client.callTool({ name: "enjoy.submit_lesson_draft", arguments: submitArgs(first, missingCup) })).content[0].text);
  assert.equal(rejected.accepted, false);
  assert.ok(rejected.issues.some((issue) => issue.code === "target_story_missing"));
  assert.equal((await first.revision.reload()).status, "draft");
  assert.ok(first.revision.validation.length > 0);
  const accepted = JSON.parse((await client.callTool({ name: "enjoy.submit_lesson_draft", arguments: submitArgs(first, learningDraft) })).content[0].text);
  assert.equal(accepted.accepted, true);
  assert.equal((await first.revision.reload()).status, "ready");
  assert.equal((await first.lesson.reload()).title, learningDraft.title);
  assert.deepEqual(first.revision.content, learningDraft);
  await assert.rejects(client.callTool({ name: "enjoy.get_job_context", arguments: {} }));
  await app.releaseAttempt(first.attempt.id);

  const withAssets = await makeLesson({ ...learningBrief, imageCount: 1, audio: true });
  const secondClient = await connect(withAssets);
  const illustrated = { ...learningDraft, scenes: [{ id: "scene-one", description: "A cup of tea on a cafe table.", sectionIds: ["section-one"], targetIds: ["cup"] }] };
  assert.equal(JSON.parse((await secondClient.callTool({ name: "enjoy.submit_lesson_draft", arguments: submitArgs(withAssets, illustrated) })).content[0].text).accepted, true);
  const bundle = await app.jobs.get(withAssets.job.id);
  assert.equal(bundle.job.state, "partial");
  assert.deepEqual(bundle.stages.map((stage) => stage.kind).sort(), ["audio", "image", "text"]);
  assert.equal(await models.AssetSlot.count({ where: { profileId, lessonRevisionId: withAssets.revision.id } }), 2);
  const duplicateWithAssets = await app.jobs.create({ resourceType: "lesson", resourceId: withAssets.lesson.id, revisionId: withAssets.revision.id, requestKey: withAssets.job.requestKey, stages: [{ key: "text", kind: "text" }] });
  assert.equal(duplicateWithAssets.job.id, withAssets.job.id);
  assert.equal(duplicateWithAssets.stages.length, 3);
  await assert.rejects(app.jobs.create({ resourceType: "lesson", resourceId: withAssets.lesson.id, revisionId: withAssets.revision.id, requestKey: withAssets.job.requestKey, stages: [{ key: "map", kind: "map" }] }), { code: "learning_request_conflict" });
  await app.releaseAttempt(withAssets.attempt.id);

  const map = await models.LearningMap.create({ profileId, title: "Cup", lessonRevisionId: first.revision.id });
  const mapRevision = await models.LearningMapRevision.create({
    profileId,
    mapId: map.id,
    number: 1,
    brief: { level: "B1", illustrations: true },
  });
  await map.update({ activeRevisionId: mapRevision.id });
  const mapJob = await app.jobs.create({ resourceType: "map", resourceId: map.id, revisionId: mapRevision.id, requestKey: randomUUID(), stages: [{ key: "map", kind: "map" }] });
  const mapAttempt = await app.jobs.startAttempt(mapJob.stages[0].id, "test-native");
  const mapClient = await connect({ ...mapJob, revision: mapRevision, attempt: mapAttempt });
  const mapContext = JSON.parse((await mapClient.callTool({ name: "enjoy.get_job_context", arguments: {} })).content[0].text);
  assert.equal(mapContext.lesson.revisionId, first.revision.id);
  assert.deepEqual(mapContext.brief, { level: "B1", illustrations: true });
  assert.deepEqual(mapContext.rubric, { wordRange: [140, 220], maxSentenceWords: 20 });
  assert.deepEqual(mapContext.lesson.brief, learningBrief);
  assert.deepEqual(mapContext.lesson.content, learningDraft);
  const fakeVerified = structuredClone(learningMap);
  fakeVerified.studyGroups[0].illustration = {
    prompt: "A cup of tea on a cafe table",
    alt: "A cup of tea",
  };
  fakeVerified.nodes[0].evidence = { status: "dictionary", source: "The model claims a dictionary" };
  const mapResult = await mapClient.callTool({ name: "enjoy.submit_mindmap", arguments: submitArgs({ ...mapJob, revision: mapRevision, attempt: mapAttempt }, fakeVerified) });
  assert.equal(JSON.parse(mapResult.content[0].text).accepted, true);
  assert.deepEqual((await mapRevision.reload()).content.nodes[0].evidence, { status: "unverified" });
  assert.equal(mapRevision.status, "ready");
  const acceptedMapJob = await app.jobs.get(mapJob.job.id);
  assert.equal(acceptedMapJob.job.state, "partial");
  assert.deepEqual(acceptedMapJob.stages.map((stage) => stage.kind).sort(), ["image", "map"]);
  const groupSlot = await models.AssetSlot.findOne({ where: { profileId, mapRevisionId: mapRevision.id } });
  assert.equal(groupSlot.sourceType, "group");
  assert.equal(groupSlot.sourceId, "drink-words");
  assert.equal(groupSlot.sourceHash, canonicalPayloadHash({
    group: fakeVerified.studyGroups[0],
    nodes: [fakeVerified.nodes[1]],
  }));
  await app.jobs.cancel(mapJob.job.id);
  const cancelledMapJob = await app.jobs.get(mapJob.job.id);
  assert.equal(cancelledMapJob.job.state, "cancelled");
  assert.equal(cancelledMapJob.stages.find((stage) => stage.kind === "image").state, "cancelled");
  assert.equal((await mapRevision.reload()).status, "ready");
  assert.deepEqual(mapRevision.content.studyGroups, fakeVerified.studyGroups);
  assert.equal((await groupSlot.reload()).selectedAssetId, null);
  await app.releaseAttempt(mapAttempt.id);
  const raced = await makeLesson();
  const raceServer = await createLearningMcpServer({ capabilities: app.capabilities, application: app });
  let resolveServer;
  let serverResolved = false;
  const serverBarrier = new Promise((resolve) => {
    resolveServer = (server) => {
      serverResolved = true;
      resolve(server);
    };
  });
  app.server = serverBarrier;
  let pendingAccess;
  let pendingRelease;
  try {
    pendingAccess = app.connectAttempt({ jobId: raced.job.id, stageId: raced.stages[0].id, attemptId: raced.attempt.id, revisionId: raced.revision.id });
    const deadline = Date.now() + 1000;
    while (!app.activeConnections.has(raced.attempt.id) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.equal(app.activeConnections.has(raced.attempt.id), true, "connectAttempt must claim the attempt before awaiting server startup");
    pendingRelease = app.releaseAttempt(raced.attempt.id);
    let releaseSettled = false;
    void pendingRelease.then(() => { releaseSettled = true; }, () => { releaseSettled = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(releaseSettled, false, "releaseAttempt must wait for the in-flight server startup");
    resolveServer(raceServer);
    await assert.rejects(pendingAccess, { code: "learning_attempt_released" });
    await pendingRelease;
    await assert.rejects(fetch(raceServer.url, { method: "POST", signal: AbortSignal.timeout(1000) }));
  } finally {
    if (!serverResolved) resolveServer(raceServer);
    await Promise.allSettled([pendingAccess, pendingRelease]);
    await raceServer.close().catch(() => {});
  }
  await scope.quiesce();
  await assert.rejects(app.connectAttempt({ jobId: withAssets.job.id, stageId: withAssets.stages[0].id, attemptId: withAssets.attempt.id, revisionId: withAssets.revision.id }), { code: "profile_closed" });
  console.log("PASS: application service via real HTTP MCP + SQLite: invalid draft, ready commit, scoped context, revocation, asset stages and unverified evidence.");
} finally {
  await Promise.allSettled(clients.map((client) => client.close()));
  await app?.close();
  await db?.close();
  await rm(temp, { recursive: true, force: true });
}
