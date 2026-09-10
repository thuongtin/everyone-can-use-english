import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNativeInvocation,
  parseStreamJsonLine,
  sanitizeDiagnostic,
  validateSubmitCandidate,
} from "../../../check-claude-native.mjs";

const paths = {
  binary: "/Users/ethan/.local/bin/claude",
  node: "/opt/homebrew/opt/node@24/bin/node",
  mcpConfig: "/tmp/enjoy-claude-spike/mcp.json",
  settings: "/tmp/enjoy-claude-spike/settings.json",
  systemPrompt: "Submit the candidate through the Enjoy tool.",
};

test("buildNativeInvocation pins stream JSON, strict MCP, tool scope, and non-persistent lifecycle", () => {
  const invocation = buildNativeInvocation(paths);

  assert.equal(invocation.command, paths.binary);
  assert.deepEqual(invocation.args.slice(0, 4), ["--print", "--output-format", "stream-json", "--input-format"]);
  assert.equal(invocation.args.includes("--verbose"), true);
  assert.equal(invocation.args.includes("--strict-mcp-config"), true);
  assert.equal(invocation.args.includes("--no-session-persistence"), true);
  assert.equal(invocation.args.includes("--permission-prompts"), true);
  assert.equal(invocation.args[invocation.args.indexOf("--permission-prompts") + 1], "none");
  assert.equal(invocation.args.includes("--mcp-config"), true);
  assert.equal(invocation.args[invocation.args.indexOf("--mcp-config") + 1], paths.mcpConfig);
  assert.equal(invocation.args.includes("mcp__enjoy__submit_lesson_draft"), true);
  assert.equal(invocation.args.includes("Bash"), false);
  assert.equal(invocation.args.includes("Read"), false);
  assert.equal(invocation.cwd, undefined);
});

test("parseStreamJsonLine turns malformed JSONL into a bounded diagnostic", () => {
  const parsed = parseStreamJsonLine("not-json" + String.fromCharCode(10));

  assert.deepEqual(parsed, {
    kind: "malformed",
    reason: "invalid-json",
    byteLength: 9,
  });
  assert.equal("raw" in parsed, false);
  assert.equal("line" in parsed, false);
});

test("parseStreamJsonLine keeps only allowlisted lifecycle and MCP fields", () => {
  const parsed = parseStreamJsonLine(JSON.stringify({
    type: "assistant",
    session_id: "session-secret-like-value",
    message: {
      content: [
        {
          type: "tool_use",
          name: "mcp__enjoy__submit_lesson_draft",
          input: { lesson: "candidate text is not a diagnostic" },
        },
      ],
    },
  }));

  assert.deepEqual(parsed, {
    kind: "event",
    type: "assistant",
    toolNames: ["mcp__enjoy__submit_lesson_draft"],
  });
  assert.equal(JSON.stringify(parsed).includes("candidate text"), false);
  assert.equal(JSON.stringify(parsed).includes("session-secret"), false);
});

test("parseStreamJsonLine records effective MCP tools without retaining init payload", () => {
  const parsed = parseStreamJsonLine(JSON.stringify({
    type: "system",
    subtype: "init",
    tools: ["mcp__enjoy__submit_lesson_draft", "Bash"],
    mcp_servers: [{ name: "enjoy", status: "connected" }, { name: "rogue", status: "connected" }],
    apiKeySource: "none",
    plugins: [],
    session_id: "session-secret-like-value",
  }));

  assert.deepEqual(parsed, {
    kind: "event",
    type: "system",
    subtype: "init",
    tools: ["mcp__enjoy__submit_lesson_draft", "Bash"],
    mcpServers: [{ name: "enjoy", status: "connected" }, { name: "rogue", status: "connected" }],
    apiKeySource: "none",
    pluginCount: 0,
  });
  assert.equal(JSON.stringify(parsed).includes("session-secret"), false);
});

test("sanitizeDiagnostic removes credential-shaped values without retaining raw stderr", () => {
  const sanitized = sanitizeDiagnostic(
    "Authorization: Bearer sk-ant-api03-secret-value\\nhttps://console.anthropic.com/oauth/code=private-code",
  );

  assert.equal(sanitized.includes("sk-ant"), false);
  assert.equal(sanitized.includes("private-code"), false);
  assert.equal(sanitized.includes("Authorization"), false);
  assert.equal(sanitized.length <= 240, true);
});

test("sanitizeDiagnostic removes a bearer credential even when its value is separated by whitespace", () => {
  const sanitized = sanitizeDiagnostic("Authorization: Bearer genericSecret");

  assert.equal(sanitized.includes("genericSecret"), false);
  assert.equal(sanitized.includes("Bearer"), false);
});

test("validateSubmitCandidate accepts the authoritative Enjoy MCP envelope and rejects missing identity", () => {
  const valid = validateSubmitCandidate({
    schemaVersion: "stage-candidate/v1",
    jobId: "job-1",
    stageId: "stage-text",
    attemptId: "attempt-1",
    expectedRevision: 1,
    payload: {
      title: "Coffee at the Corner",
      sections: [{ id: "section-1", text: "A short lesson." }],
    },
  });

  assert.equal(valid.ok, true);
  assert.equal(valid.payloadHash.length, 64);

  const invalid = validateSubmitCandidate({
    schemaVersion: "stage-candidate/v1",
    jobId: "job-1",
    stageId: "stage-text",
    expectedRevision: 1,
    payload: {},
  });

  assert.deepEqual(invalid, {
    ok: false,
    code: "invalid-envelope",
  });
});
