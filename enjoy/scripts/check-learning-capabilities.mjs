import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-capability-"));
const identity = {
  profileId: "profile-a",
  connectionId: "connection-a",
  jobId: "job-a",
  stageId: "stage-a",
  attemptId: "attempt-a",
  revisionId: "revision-a",
};
const cases = [];
const test = async (name, action) => { await action(); cases.push(name); };

try {
  const output = path.join(temp, "capabilities.mjs");
  await build({ entryPoints: [path.join(root, "src/main/learning/capability-registry.ts")],
    bundle: true, platform: "node", format: "esm", outfile: output, logLevel: "silent" });
  const { LearningCapabilityRegistry } = await import(pathToFileURL(output).href);

  await test("issues unique opaque tokens and only returns immutable scoped metadata", () => {
    const registry = new LearningCapabilityRegistry();
    const tools = ["enjoy.get_job_context", "enjoy.submit_lesson_draft"];
    const token = registry.issue({ ...identity, tools });
    const other = registry.issue({ ...identity, attemptId: "attempt-b", tools });
    assert.equal(token.length >= 43, true);
    assert.notEqual(token, other);
    tools.push("enjoy.arbitrary");
    const grant = registry.authorize(token, { ...identity, tool: "enjoy.submit_lesson_draft" });
    assert.equal(Object.isFrozen(grant), true);
    assert.equal(Object.isFrozen(grant.tools), true);
    assert.equal(JSON.stringify(grant).includes(token), false);
    assert.throws(() => registry.authorize(token, { ...identity, tool: "enjoy.arbitrary" }), { code: "capability_denied" });
  });

  await test("denies every cross-profile, connection, job, stage, attempt and revision request", () => {
    const registry = new LearningCapabilityRegistry();
    const token = registry.issue({ ...identity, tools: ["enjoy.submit_lesson_draft"] });
    for (const key of Object.keys(identity)) {
      assert.throws(() => registry.authorize(token, {
        ...identity, [key]: "different", tool: "enjoy.submit_lesson_draft",
      }), { code: "capability_denied" });
    }
    for (const bad of ["", "invalid", "x".repeat(500), null, undefined]) {
      assert.throws(() => registry.resolve(bad), { code: "capability_denied" });
    }
  });

  await test("expired and revoked capabilities cannot be replayed", () => {
    let now = 1000;
    const registry = new LearningCapabilityRegistry({ now: () => now });
    const first = registry.issue({ ...identity, tools: ["enjoy.get_job_context"] }, 10);
    now = 1010;
    assert.throws(() => registry.resolve(first), { code: "capability_denied" });
    const second = registry.issue({ ...identity, tools: ["enjoy.get_job_context"] });
    registry.revoke({ attemptId: identity.attemptId, connectionId: identity.connectionId });
    assert.throws(() => registry.resolve(second), { code: "capability_denied" });
  });

  await test("profile revocation preserves another profile and revokeAll closes everything", () => {
    const registry = new LearningCapabilityRegistry();
    const a = registry.issue({ ...identity, tools: ["enjoy.get_job_context"] });
    const b = registry.issue({ ...identity, profileId: "profile-b", tools: ["enjoy.get_job_context"] });
    registry.revoke({ profileId: "profile-a" });
    assert.throws(() => registry.resolve(a), { code: "capability_denied" });
    assert.equal(registry.resolve(b).profileId, "profile-b");
    registry.revokeAll();
    assert.throws(() => registry.resolve(b), { code: "capability_denied" });
  });

  await test("rejects invalid TTLs, empty tools and unbounded grants", () => {
    const registry = new LearningCapabilityRegistry({ maxGrants: 1 });
    const input = { ...identity, tools: ["enjoy.get_job_context"] };
    for (const ttl of [0, -1, NaN, Infinity, 900001]) {
      assert.throws(() => registry.issue(input, ttl));
    }
    assert.throws(() => registry.issue({ ...identity, tools: [] }));
    registry.issue(input);
    assert.throws(() => registry.issue(input), { code: "capability_limit" });
  });

  console.log(`PASS: ${cases.length} learning capability cases.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
