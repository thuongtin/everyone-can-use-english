import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-learning-mcp-"));
const cases = [];

const test = async (name, action) => {
  await action();
  cases.push(name);
};

const compile = async (entry, name) => {
  const output = path.join(temp, name);
  await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });
  return import(`${pathToFileURL(output).href}?test=${Date.now()}-${name}`);
};

const ids = {
  profileId: randomUUID(),
  connectionId: randomUUID(),
  jobId: randomUUID(),
  stageId: randomUUID(),
  attemptId: randomUUID(),
  revisionId: randomUUID(),
};

const validMap = () => ({
  rootNodeId: "node-root",
  nodes: [{
    id: "node-root",
    term: "coffee",
    sense: "a hot drink",
    definition: "A hot drink made from roasted beans.",
    translationVi: "cà phê",
    example: "I drink coffee in the morning.",
    evidence: { status: "unverified" },
  }],
  edges: [],
});

const validExercises = () => ({
  exercises: [{
    kind: "fill",
    id: "exercise-fill",
    prompt: "Complete the sentence.",
    targetIds: ["target-coffee"],
    acceptedAnswers: ["coffee"],
  }],
});

const validDraft = () => ({
  title: "Coffee",
  sections: [{ id: "section-one", text: "I drink coffee.", targetIds: ["target-coffee"] }],
  glossary: [{
    targetId: "target-coffee",
    definition: "A hot drink made from roasted beans.",
    translationVi: "cà phê",
    example: "I drink coffee.",
  }],
  scenes: [],
  exercises: [],
  entityDescriptions: [],
});

const jsonResponse = async (response) => {
  const text = await response.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
    try { value = dataLine ? JSON.parse(dataLine.slice(6)) : undefined; } catch { value = undefined; }
  }
  return { text, value };
};

const rawRpc = async (url, token, body, headers = {}) => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body,
  });
  return { response, ...(await jsonResponse(response)) };
};

const rawNodeRpc = async (url, token, body, headers = {}) => {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(body);
  });
};

try {
  const [{ LearningCapabilityRegistry }, mcp, candidate] = await Promise.all([
    compile("src/main/learning/capability-registry.ts", "capability-registry.mjs"),
    compile("src/main/learning/mcp-server.ts", "mcp-server.mjs"),
    compile("src/main/learning/candidate.ts", "candidate.mjs"),
  ]);
  const { createLearningMcpServer } = mcp;
  const { canonicalPayloadHash } = candidate;

  await test("canonical payload hashing is key-order independent and payload-sensitive", () => {
    assert.equal(canonicalPayloadHash({ b: 2, a: { d: true, c: 1 } }), canonicalPayloadHash({ a: { c: 1, d: true }, b: 2 }));
    assert.notEqual(canonicalPayloadHash({ value: 1 }), canonicalPayloadHash({ value: 2 }));
    assert.equal(canonicalPayloadHash({ value: 1 }), createHash("sha256").update('{"value":1}').digest("hex"));
    const circular = {};
    circular.self = circular;
    assert.throws(() => canonicalPayloadHash(circular), { code: "invalid_payload" });
    assert.throws(() => canonicalPayloadHash({ value: Number.NaN }), { code: "invalid_payload" });
  });

  let now = Date.now();
  const registry = new LearningCapabilityRegistry({ now: () => now });
  const receipts = [];
  let throwSecret = false;
  const application = {
    async getJobContext(grant) {
      if (throwSecret) throw Object.assign(new Error("secret-body-should-never-escape"), { code: "application_failed" });
      return { kind: "job_context", jobId: grant.jobId, stageId: grant.stageId };
    },
    async getLessonRevision(grant) {
      return { kind: "lesson_revision", revisionId: grant.revisionId };
    },
    async getJobStatus(grant) {
      return { kind: "job_status", jobId: grant.jobId, attemptId: grant.attemptId };
    },
    async submitCandidate(grant, envelope) {
      receipts.push({ grant: { ...grant }, envelope });
      return { accepted: true, kind: envelope.kind, payloadHash: envelope.payloadHash };
    },
  };

  const tools = [
    "enjoy.get_job_context",
    "enjoy.get_lesson_revision",
    "enjoy.get_job_status",
    "enjoy.submit_lesson_draft",
    "enjoy.submit_mindmap",
    "enjoy.submit_exercises",
  ];
  const token = registry.issue({ ...ids, tools });
  const server = await createLearningMcpServer({ capabilities: registry, application });

  try {
    await test("real SDK initialize/list/call exposes only the immutable grant tool set", async () => {
      const transport = new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      const client = new Client({ name: "learning-mcp-check", version: "1.0.0" });
      await client.connect(transport);
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [...tools].sort());
      const context = await client.callTool({ name: "enjoy.get_job_context", arguments: {} });
      assert.equal(context.isError, undefined);
      assert.deepEqual(JSON.parse(context.content[0].text), { kind: "job_context", jobId: ids.jobId, stageId: ids.stageId });
      const revision = await client.callTool({ name: "enjoy.get_lesson_revision", arguments: {} });
      assert.deepEqual(JSON.parse(revision.content[0].text), { kind: "lesson_revision", revisionId: ids.revisionId });
      const status = await client.callTool({ name: "enjoy.get_job_status", arguments: {} });
      assert.deepEqual(JSON.parse(status.content[0].text), { kind: "job_status", jobId: ids.jobId, attemptId: ids.attemptId });
      await client.close();
    });

    await test("submit tools own the kind and boundary hash, ignoring client payloadHash", async () => {
      const transport = new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      const client = new Client({ name: "learning-mcp-submit-check", version: "1.0.0" });
      await client.connect(transport);
      const result = await client.callTool({
        name: "enjoy.submit_mindmap",
        arguments: {
          schemaVersion: 1,
          jobId: ids.jobId,
          stageId: ids.stageId,
          attemptId: ids.attemptId,
          expectedRevisionId: ids.revisionId,
          payload: validMap(),
          payloadHash: "f".repeat(64),
        },
      });
      assert.equal(result.isError, undefined);
      const receipt = receipts.at(-1);
      assert.equal(receipt.envelope.kind, "map");
      assert.notEqual(receipt.envelope.payloadHash, "f".repeat(64));
      assert.equal(receipt.envelope.payloadHash, canonicalPayloadHash(receipt.envelope.payload));
      assert.equal(receipt.envelope.schemaVersion, 1);
      const draft = await client.callTool({
        name: "enjoy.submit_lesson_draft",
        arguments: {
          schemaVersion: 1,
          jobId: ids.jobId,
          stageId: ids.stageId,
          attemptId: ids.attemptId,
          expectedRevisionId: ids.revisionId,
          payload: validDraft(),
        },
      });
      assert.equal(draft.isError, undefined);
      assert.equal(receipts.at(-1).envelope.kind, "text");
      const exercises = await client.callTool({
        name: "enjoy.submit_exercises",
        arguments: {
          schemaVersion: 1,
          jobId: ids.jobId,
          stageId: ids.stageId,
          attemptId: ids.attemptId,
          expectedRevisionId: ids.revisionId,
          payload: validExercises(),
        },
      });
      assert.equal(exercises.isError, undefined);
      assert.equal(receipts.at(-1).envelope.kind, "exercises");
      await client.close();
    });

    await test("malicious cross-job, revision, and attempt submissions are denied before application", async () => {
      const before = receipts.length;
      const transport = new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      const client = new Client({ name: "learning-mcp-scope-check", version: "1.0.0" });
      await client.connect(transport);
      for (const [key, value] of [["jobId", randomUUID()], ["stageId", randomUUID()], ["attemptId", randomUUID()], ["expectedRevisionId", randomUUID()]]) {
        const result = await client.callTool({
          name: "enjoy.submit_mindmap",
          arguments: {
            schemaVersion: 1,
            jobId: key === "jobId" ? value : ids.jobId,
            stageId: key === "stageId" ? value : ids.stageId,
            attemptId: key === "attemptId" ? value : ids.attemptId,
            expectedRevisionId: key === "expectedRevisionId" ? value : ids.revisionId,
            payload: validMap(),
          },
        });
        assert.equal(result.isError, true);
        assert.deepEqual(JSON.parse(result.content[0].text), { error: { code: "capability_denied" } });
      }
      assert.equal(receipts.length, before);
      await client.close();
    });

    await test("unknown tools and ungranted tools do not become callable", async () => {
      const limitedToken = registry.issue({ ...ids, tools: ["enjoy.get_job_status"] });
      const listed = await rawRpc(server.url, limitedToken, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "raw", version: "1" } } }));
      assert.equal(listed.response.ok, true);
      const call = await rawRpc(server.url, limitedToken, JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "enjoy.submit_mindmap", arguments: {} } }));
      assert.equal(call.response.ok, true);
      assert.equal(call.text.includes("Tool enjoy.submit_mindmap not found"), true);
      assert.equal(call.text.includes("secret"), false);
    });

    await test("expired and revoked token replays are rejected", async () => {
      const shortToken = registry.issue({ ...ids, tools: ["enjoy.get_job_status"] }, 10);
      now += 10;
      const expired = await rawRpc(server.url, shortToken, JSON.stringify({ jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "raw", version: "1" } } }));
      assert.equal(expired.response.status, 401);
      const revokedToken = registry.issue({ ...ids, tools: ["enjoy.get_job_status"] });
      registry.revoke({ attemptId: ids.attemptId, connectionId: ids.connectionId });
      const revoked = await rawRpc(server.url, revokedToken, JSON.stringify({ jsonrpc: "2.0", id: 4, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "raw", version: "1" } } }));
      assert.equal(revoked.response.status, 401);
    });

    await test("Host and Origin policy accepts loopback ownership and rejects foreign values", async () => {
      const policyToken = registry.issue({ ...ids, tools: ["enjoy.get_job_context"] });
      const own = await rawRpc(server.url, policyToken, JSON.stringify({ jsonrpc: "2.0", id: 5, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "raw", version: "1" } } }));
      assert.equal(own.response.ok, true);
      const foreignOrigin = await rawRpc(server.url, policyToken, JSON.stringify({ jsonrpc: "2.0", id: 6, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "raw", version: "1" } } }), { Origin: "http://evil.test" });
      assert.equal(foreignOrigin.response.status, 403);
      const foreignHost = await rawNodeRpc(server.url, policyToken, JSON.stringify({ jsonrpc: "2.0", id: 7, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "raw", version: "1" } } }), { Host: "127.0.0.1:1" });
      assert.equal(foreignHost.status, 403);
    });

    await test("oversized and malformed bodies are rejected before SDK protocol handling", async () => {
      const bodyToken = registry.issue({ ...ids, tools: ["enjoy.get_job_context"] });
      const oversized = await rawRpc(server.url, bodyToken, "{" + "x".repeat(512 * 1024) + "}");
      assert.equal(oversized.response.status, 413);
      const malformed = await rawRpc(server.url, bodyToken, "{\"jsonrpc\":");
      assert.equal(malformed.response.status, 400);
      assert.equal(malformed.text.includes("jsonrpc"), false);
    });

    await test("application and protocol errors expose stable codes without secrets", async () => {
      throwSecret = true;
      const errorToken = registry.issue({ ...ids, tools: ["enjoy.get_job_context"] });
      const failed = await rawRpc(server.url, errorToken, JSON.stringify({ jsonrpc: "2.0", id: 8, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "raw", version: "1" } } }));
      assert.equal(failed.response.ok, true);
      const followup = await rawRpc(server.url, errorToken, JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "enjoy.get_job_context", arguments: {} } }));
      assert.equal(followup.response.ok, true);
      assert.equal(followup.text.includes("secret-body-should-never-escape"), false);
      assert.equal(followup.text.includes("application_failed"), true);
      throwSecret = false;
    });
  } finally {
    await server.close();
  }

  await test("shutdown closes the listening port and shares concurrent cleanup", async () => {
    const firstClose = server.close();
    const secondClose = server.close();
    assert.equal(firstClose, secondClose);
    await Promise.all([firstClose, secondClose]);
    await assert.rejects(fetch(server.url), /fetch failed|ECONNREFUSED/);
  });

  console.log(`PASS: ${cases.length} learning MCP cases.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
