import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { Sequelize } from "sequelize";
import { learningBrief } from "./fixtures/learning-lesson.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(root, ".tmp-learning-runtime-"));
let db, runtime;
try {
  const output = path.join(temp, "subject.mjs");
  await build({ entryPoints: [path.join(root, "src/main/learning/runtime.ts")], bundle: true, platform: "node", format: "esm", outfile: output, packages: "external", logLevel: "silent" });
  const { LearningRuntime } = await import(pathToFileURL(output).href);
  const migration = await import(pathToFileURL(path.join(root, "src/main/db/migrations/1788701024340-create-learning-studio.js")).href);
  const openDb = () => new Sequelize({ dialect: "sqlite", storage: path.join(temp, "learning.sqlite"), logging: false });
  db = openDb();
  await migration.up({ context: db.getQueryInterface() });
  const mapBriefMigration = await import(pathToFileURL(path.join(root, "src/main/db/migrations/1788789600000-add-learning-map-brief.js")).href);
  await mapBriefMigration.up({ context: db.getQueryInterface() });
  runtime = await LearningRuntime.open({ sequelize: db, profileId: "profile-a", assetRoot: path.join(temp, "assets"), watchdogMs: 0 });
  const firstContext = runtime.scope.context;
  const lesson = await runtime.storage.createLesson({ brief: learningBrief });
  const referencedId = randomUUID();
  const orphanId = randomUUID();
  const symlinkId = randomUUID();
  const referencedPath = `${referencedId}.png`;
  const orphanPath = `${orphanId}.png`;
  const symlinkPath = `${symlinkId}.png`;
  const outsidePath = path.join(temp, "outside-secret.bin");
  await writeFile(path.join(firstContext.assetRoot, referencedPath), Buffer.from("referenced"));
  await runtime.storage.models.GeneratedAsset.create({
    id: referencedId,
    profileId: firstContext.profileId,
    slotId: randomUUID(),
    relativePath: referencedPath,
    kind: "image",
    mimeType: "image/png",
    sha256: "0".repeat(64),
    sizeBytes: 10,
    width: 1,
    height: 1,
    durationMs: null,
    provenance: { source: "runtime-check" },
  });
  await writeFile(outsidePath, Buffer.from("outside"));
  await symlink(outsidePath, path.join(firstContext.assetRoot, symlinkPath));
  const job = await runtime.application.jobs.create({ resourceType: "lesson", resourceId: lesson.lesson.id, revisionId: lesson.revision.id, requestKey: randomUUID(), stages: [{ key: "text", kind: "text" }] });
  const attempt = await runtime.application.jobs.startAttempt(job.stages[0].id, "test", 10);
  let cancelled = 0;
  runtime.trackAttempt(attempt.id, async () => { cancelled++; });
  await new Promise(resolve => setTimeout(resolve, 15));
  await runtime.tick();
  assert.equal(cancelled, 1);
  assert.equal((await runtime.application.jobs.get(job.job.id)).stages[0].state, "awaiting_retry");
  await runtime.tick();
  assert.equal(cancelled, 1);

  const retried = await runtime.application.jobs.retryAttempt(job.stages[0].id, "test");
  let release;
  runtime.trackAttempt(retried.id, () => new Promise(resolve => { release = resolve; }));
  const closing = runtime.close();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.scope.state, "closing");
  await assert.rejects(runtime.storage.listLessons(), { code: "profile_closed" });
  release();
  await closing;
  await db.close();

  await writeFile(path.join(firstContext.assetRoot, orphanPath), Buffer.from("orphan"));
  await writeFile(path.join(firstContext.assetRoot, "foreign.txt"), Buffer.from("foreign"));

  db = openDb();
  runtime = await LearningRuntime.open({ sequelize: db, profileId: "profile-a", assetRoot: path.join(temp, "assets"), watchdogMs: 0 });
  assert.notEqual(runtime.scope.context.connectionId, firstContext.connectionId);
  assert.equal((await runtime.storage.listLessons()).length, 1);
  assert.equal((await runtime.application.jobs.get(job.job.id)).job.state, "interrupted");
  await assert.rejects(() => stat(path.join(runtime.scope.context.assetRoot, orphanPath)), /ENOENT|no such file/i);
  assert.equal((await readFile(path.join(runtime.scope.context.assetRoot, referencedPath))).toString(), "referenced");
  assert.equal((await readFile(path.join(runtime.scope.context.assetRoot, "foreign.txt"))).toString(), "foreign");
  assert.equal((await readFile(outsidePath)).toString(), "outside");
  assert.equal((await lstat(path.join(runtime.scope.context.assetRoot, symlinkPath))).isSymbolicLink(), true);
  assert.equal((await runtime.application.jobs.get(job.job.id)).attempts.length, 2);
  await runtime.close();
  runtime = await LearningRuntime.open({ sequelize: db, profileId: "profile-b", assetRoot: path.join(temp, "assets-b"), watchdogMs: 0 });
  assert.equal((await runtime.storage.listLessons()).length, 0);
  let cleanupFails = true;
  runtime.trackAttempt(randomUUID(), async () => { if (cleanupFails) throw new Error("cleanup failed"); });
  await assert.rejects(runtime.close(), { code: "profile_quiesce_failed" });
  assert.equal(runtime.scope.state, "closing");
  cleanupFails = false;
  await runtime.close();
  assert.equal(runtime.scope.state, "closed");
  console.log("PASS: learning runtime SQLite restart, profile isolation, lease cancellation, close drain and cleanup retry.");
} finally {
  await runtime?.close();
  await db?.close();
  await rm(temp, { recursive: true, force: true });
}
