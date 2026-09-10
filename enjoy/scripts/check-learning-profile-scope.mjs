import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-learning-scope-"));
const deferred = () => {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
};
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
const cases = [];
const test = async (name, action) => { await action(); cases.push(name); };

try {
  const output = path.join(temp, "profile-scope.mjs");
  await build({
    entryPoints: [path.join(root, "src/main/learning/profile-scope.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });
  const { LearningProfileScope } = await import(pathToFileURL(output).href);

  await test("captures an immutable profile identity and rejects another scope", async () => {
    const first = new LearningProfileScope("profile-a", path.join(temp, "a"));
    const second = new LearningProfileScope("profile-b", path.join(temp, "b"));
    assert.equal(Object.isFrozen(first.context), true);
    assert.notEqual(first.context.connectionId, second.context.connectionId);
    assert.throws(() => first.assertOpen(second.context), { code: "profile_changed" });
    await first.run(async (context) => assert.equal(context.profileId, "profile-a"));
    await first.quiesce();
    await second.run(async (context) => assert.equal(context.profileId, "profile-b"));
    await second.quiesce();
  });

  await test("cancels owned work and waits for active writes before disconnect", async () => {
    const scope = new LearningProfileScope("profile-a", path.join(temp, "a"));
    const started = deferred();
    const write = deferred();
    const events = [];
    scope.registerCancellation(async () => { events.push("cancel-child"); });
    const operation = scope.run(async (_context, signal) => {
      assert.equal(signal.aborted, false);
      started.resolve();
      await write.promise;
      assert.equal(signal.aborted, true);
      events.push("finish-old-write");
    });
    await started.promise;
    let closed = false;
    const shutdown = scope.quiesce().then(() => { closed = true; events.push("disconnect"); });
    await nextTurn();
    assert.equal(closed, false);
    await assert.rejects(scope.run(async () => events.push("new-write")), { code: "profile_closed" });
    assert.throws(() => scope.assertOpen(), { code: "profile_closed" });
    write.resolve();
    await Promise.all([operation, shutdown]);
    assert.deepEqual(events, ["cancel-child", "finish-old-write", "disconnect"]);
    await scope.quiesce();
    assert.equal(scope.state, "closed");
  });

  await test("a rejected write does not poison draining or leak an operation", async () => {
    const scope = new LearningProfileScope("profile-a", path.join(temp, "a"));
    await assert.rejects(scope.run(async () => { throw new Error("fixture failure"); }));
    await scope.quiesce();
    assert.equal(scope.state, "closed");
  });

  await test("failed cancellation blocks disconnect and can be retried", async () => {
    const scope = new LearningProfileScope("profile-a", path.join(temp, "a"));
    let calls = 0;
    scope.registerCancellation(async () => {
      calls += 1;
      if (calls === 1) throw new Error("fixture child still alive");
    });
    await assert.rejects(scope.quiesce(), { code: "profile_quiesce_failed" });
    assert.equal(scope.state, "closing");
    await assert.rejects(scope.run(async () => undefined), { code: "profile_closed" });
    await scope.quiesce();
    assert.equal(scope.state, "closed");
    assert.equal(calls, 2);
  });

  await test("unregistered children are not cancelled and concurrent drains share work", async () => {
    const scope = new LearningProfileScope("profile-a", path.join(temp, "a"));
    let calls = 0;
    const unregister = scope.registerCancellation(async () => { calls += 100; });
    unregister();
    scope.registerCancellation(async () => { calls += 1; });
    await Promise.all([scope.quiesce(), scope.quiesce(), scope.quiesce()]);
    assert.equal(calls, 1);
    assert.throws(() => scope.registerCancellation(async () => undefined), { code: "profile_closed" });
  });

  await test("profile switch cancels a deferred ASR operation before the old scope closes", async () => {
    const oldScope = new LearningProfileScope("profile-a", path.join(temp, "asr-a"));
    const nextScope = new LearningProfileScope("profile-b", path.join(temp, "asr-b"));
    const started = deferred();
    const controller = new AbortController();
    const unregister = oldScope.registerCancellation(async () => controller.abort());
    const transcription = oldScope.run(async (context) => {
      assert.equal(context.profileId, "profile-a");
      started.resolve();
      await new Promise((resolve, reject) => {
        const abort = () => reject(Object.assign(new Error("cancelled"), { code: "asr_cancelled" }));
        controller.signal.addEventListener("abort", abort, { once: true });
        if (controller.signal.aborted) abort();
      });
    }).finally(unregister);
    await started.promise;
    await Promise.all([
      assert.rejects(transcription, { code: "asr_cancelled" }),
      oldScope.quiesce(),
    ]);
    assert.equal(oldScope.state, "closed");
    await nextScope.run(async (context) => assert.equal(context.profileId, "profile-b"));
    await nextScope.quiesce();
  });

  console.log(`PASS: ${cases.length} learning profile lifecycle cases.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
