import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { Sequelize } from "sequelize";

import { learningBrief, learningDraft } from "./fixtures/learning-lesson.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(root, ".tmp-learning-controller-"));
const output = path.join(temp, "controller.mjs");
let db;

try {
  await build({
    stdin: {
      contents: `export { LearningController } from "./src/main/learning/controller.ts"; export { LearningRuntime } from "./src/main/learning/runtime.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });

  const { LearningController, LearningRuntime } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
  const migration = await import(pathToFileURL(path.join(root, "src/main/db/migrations/1788701024340-create-learning-studio.js")).href);
  db = new Sequelize({ dialect: "sqlite", storage: path.join(temp, "learning.sqlite"), logging: false });
  await migration.up({ context: db.getQueryInterface() });
  const mapBriefMigration = await import(pathToFileURL(path.join(root, "src/main/db/migrations/1788789600000-add-learning-map-brief.js")).href);
  await mapBriefMigration.up({ context: db.getQueryInterface() });
  const runtime = await LearningRuntime.open({ sequelize: db, profileId: "profile-a", assetRoot: path.join(temp, "assets"), watchdogMs: 0 });
  const controller = new LearningController(runtime);
  const context = runtime.scope.context;

  try {
    const empty = await controller.request(context, "list", {});
    assert.deepEqual(empty, { lessons: [], maps: [] });
    await assert.rejects(
      controller.request(context, "list", { unexpected: true }),
      { code: "learning_request_invalid" },
    );
    await assert.rejects(
      controller.request({ profileId: context.profileId, connectionId: "stale" }, "list", {}),
      { code: "learning_context_denied" },
    );

    const created = await controller.request(context, "createLesson", { brief: learningBrief, title: "Controller lesson" });
    const ready = await controller.request(context, "reviseLesson", {
      lessonId: created.lesson.id,
      expectedRevisionId: created.revision.id,
      brief: learningBrief,
      content: learningDraft,
    });
    await assert.rejects(
      controller.request(context, "practice", {
        lessonRevisionId: ready.revision.id,
        questionId: "fill-cup",
        answer: "cup",
        result: { correct: false },
      }),
      { code: "learning_request_invalid" },
    );
    const practice = await controller.request(context, "practice", {
      lessonRevisionId: ready.revision.id,
      questionId: "fill-cup",
      answer: "cup",
    });
    assert.equal(practice.grade.correct, true);
    assert.deepEqual(practice.attempt.result, practice.grade);
    assert.equal(practice.attempt.recordingAssetId, null);

    const wav = new Uint8Array(await readFile(path.join(root, "samples", "jfk.wav")));
    const recorded = await controller.request(context, "practice", {
      lessonRevisionId: ready.revision.id,
      questionId: "retell-cup",
      answer: "I ordered tea.",
      recording: { bytes: wav, mimeType: "audio/webm;codecs=opus" },
    });
    assert.equal(recorded.grade.feedbackCode, "self_review");
    assert.ok(recorded.attempt.recordingAssetId);
    const recording = await runtime.storage.getLesson(ready.lesson.id);
    const recordingAsset = recording.assets.find((asset) => asset.id === recorded.attempt.recordingAssetId);
    assert.equal(recordingAsset?.mimeType, "audio/wav");
    assert.equal(recordingAsset?.relativePath.endsWith(".wav"), true);

    const audioOnly = await controller.request(context, "practice", {
      lessonRevisionId: ready.revision.id,
      questionId: "retell-cup",
      answer: "   ",
      recording: { bytes: wav, mimeType: "audio/ogg;codecs=opus,vorbis" },
    });
    assert.deepEqual(audioOnly.grade, {
      kind: "retell",
      correct: null,
      normalizedAnswer: "",
      expectedAnswer: null,
      feedbackCode: "self_review",
      targetIds: ["cup"],
    });
    assert.equal(audioOnly.attempt.answer, "");
    assert.deepEqual(audioOnly.attempt.result, audioOnly.grade);
    await assert.rejects(
      controller.request(context, "practice", {
        lessonRevisionId: ready.revision.id,
        questionId: "retell-cup",
        answer: "   ",
      }),
      { code: "invalid_answer" },
    );
    for (const mimeType of ["audio/mp4", "audio/ogg;codecs=opus;unexpected=1", "audio/wav;codecs=opus"]) {
      await assert.rejects(
        controller.request(context, "practice", {
          lessonRevisionId: ready.revision.id,
          questionId: "retell-cup",
          answer: "I ordered tea.",
          recording: { bytes: wav, mimeType },
        }),
        { code: "learning_request_invalid" },
      );
    }

    const beforeInvalidRecording = await runtime.storage.getLesson(ready.lesson.id);
    await assert.rejects(
      controller.request(context, "practice", {
        lessonRevisionId: ready.revision.id,
        questionId: "retell-cup",
        answer: "I ordered tea.",
        recording: { bytes: new Uint8Array(Buffer.from("not-audio")), mimeType: "audio/wav" },
      }),
      { code: "invalid_audio" },
    );
    const afterInvalidRecording = await runtime.storage.getLesson(ready.lesson.id);
    assert.equal(afterInvalidRecording.assets.length, beforeInvalidRecording.assets.length);
    assert.equal(afterInvalidRecording.practiceAttempts.length, beforeInvalidRecording.practiceAttempts.length);

    const originalPracticeCreate = runtime.storage.models.PracticeAttempt.create;
    runtime.storage.models.PracticeAttempt.create = async () => {
      throw new Error("practice_commit_fixture_failure");
    };
    try {
      await assert.rejects(
        controller.request(context, "practice", {
          lessonRevisionId: ready.revision.id,
          questionId: "retell-cup",
          answer: "I ordered tea.",
          recording: { bytes: wav, mimeType: "audio/wav" },
        }),
        /practice_commit_fixture_failure/,
      );
    } finally {
      runtime.storage.models.PracticeAttempt.create = originalPracticeCreate;
    }
    const afterCommitFailure = await runtime.storage.getLesson(ready.lesson.id);
    assert.equal(afterCommitFailure.assets.length, beforeInvalidRecording.assets.length);
    assert.equal(afterCommitFailure.practiceAttempts.length, beforeInvalidRecording.practiceAttempts.length);

    const raceJob = await runtime.application.jobs.create({
      resourceType: "lesson",
      resourceId: ready.lesson.id,
      revisionId: ready.revision.id,
      requestKey: "controller-cancel-race",
      stages: [{ key: "story", kind: "text" }],
    });

    const originalCancelAttempt = runtime.cancelAttempt.bind(runtime);
    const cancelledAttemptIds = [];
    runtime.cancelAttempt = async (attemptId) => {
      cancelledAttemptIds.push(attemptId);
      return originalCancelAttempt(attemptId);
    };
    const startImmediatelyBeforeCancel = runtime.application.jobs.startAttempt(raceJob.stages[0].id, "controller-race");
    const cancelImmediatelyAfterStart = controller.request(context, "cancelJob", { id: raceJob.job.id });
    const [raceAttempt, raceCancelled] = await Promise.all([startImmediatelyBeforeCancel, cancelImmediatelyAfterStart]);
    assert.deepEqual(raceCancelled, { cancelled: true });
    assert.equal(cancelledAttemptIds.filter((id) => id === raceAttempt.id).length, 1);
    const repeatedCancel = await controller.request(context, "cancelJob", { id: raceJob.job.id });
    assert.deepEqual(repeatedCancel, { cancelled: true });
    assert.equal(cancelledAttemptIds.filter((id) => id === raceAttempt.id).length, 2);
    runtime.cancelAttempt = originalCancelAttempt;

    const job = await runtime.application.jobs.create({
      resourceType: "lesson",
      resourceId: ready.lesson.id,
      revisionId: ready.revision.id,
      requestKey: "controller-cancel-owned",
      stages: [{ key: "owned-story", kind: "text" }],
    });
    const attempt = await runtime.application.jobs.startAttempt(job.stages[0].id, "controller-test");
    let stopped = false;
    let finishCleanup;
    runtime.trackAttempt(attempt.id, async () => {
      await new Promise(resolve => { finishCleanup = resolve; });
      stopped = true;
    });
    await runtime.application.jobs.failAttempt(attempt.id, "provider_timeout", true);
    assert.equal((await runtime.application.jobs.get(job.job.id)).job.state, "interrupted");
    await assert.rejects(
      controller.request(context, "deleteLesson", { id: ready.lesson.id }),
      { code: "resource_busy" },
    );
    assert.equal(stopped, false);
    assert.equal((await runtime.storage.getLesson(ready.lesson.id)).lesson.id, ready.lesson.id);
    const cancelling = controller.request(context, "cancelJob", { id: job.job.id });
    for (let i = 0; !finishCleanup && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.ok(finishCleanup, "owned cleanup must start");
    try {
      await assert.rejects(controller.request(context, "deleteLesson", { id: ready.lesson.id }), { code: "resource_busy" });
    } finally {
      finishCleanup();
      await cancelling;
    }
    const cancelled = await cancelling;
    assert.deepEqual(cancelled, { cancelled: true });
    assert.equal(stopped, true);
    assert.equal((await runtime.application.jobs.get(job.job.id)).job.state, "cancelled");

    const originalRemove = runtime.assets.remove.bind(runtime.assets);
    runtime.assets.remove = async () => {
      throw new Error("delete_cleanup_fixture_failure");
    };
    try {
      await assert.rejects(
        controller.request(context, "deleteLesson", { id: ready.lesson.id }),
        { code: "learning_asset_cleanup_failed" },
      );
    } finally {
      runtime.assets.remove = originalRemove;
    }
    await assert.rejects(
      controller.request(context, "getLesson", { id: ready.lesson.id }),
      { code: "learning_not_found" },
    );

    await runtime.scope.quiesce();
    await assert.rejects(controller.request(context, "list", {}), { code: "profile_closed" });
    console.log("PASS: learning controller validates scoped IPC requests, grades practice in main, persists recordings atomically, and cancels owned jobs.");
  } finally {
    await runtime.close().catch(() => undefined);
  }
} finally {
  await db?.close();
  await rm(temp, { recursive: true, force: true });
}
