#!/usr/bin/env node

import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const enjoyRoot = path.resolve(import.meta.dirname, "..");
const adapterEntry = path.join(enjoyRoot, "src/main/agents/codex-native.ts");
const managerEntry = path.join(enjoyRoot, "src/main/agents/process-manager.ts");
const fixture = path.join(enjoyRoot, "scripts/fixtures/codex-adapter/fixture.mjs");
const evidencePath = process.env.ENJOY_CODEX_ADAPTER_EVIDENCE || "/tmp/enjoy-u4-codex-adapter.md";
const cases = [];
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-codex-adapter-"));
const previousCredentialEnv = Object.fromEntries([
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CODEX_API_KEY",
  "CLAUDE_API_KEY",
  "OPENAI_OAUTH_TOKEN",
  "ANTHROPIC_AUTH_TOKEN",
].map((key) => [key, process.env[key]]));

const waitFor = async (predicate, timeoutMs = 2_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
};

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const expectError = (outcome, code) => {
  assert.equal(outcome.ok, false, `expected ${code}, received a successful adapter result`);
  assert.equal(outcome.code, code);
};

await chmod(fixture, 0o755);
const adapterBundle = path.join(temp, "codex-native.mjs");
const managerBundle = path.join(temp, "process-manager.mjs");
await Promise.all([
  build({
    entryPoints: [adapterEntry],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: adapterBundle,
    logLevel: "silent",
  }),
  build({
    entryPoints: [managerEntry],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: managerBundle,
    logLevel: "silent",
  }),
]);
const [{ CodexNativeAgent }, { pinExecutable }] = await Promise.all([
  import(pathToFileURL(adapterBundle).href),
  import(pathToFileURL(managerBundle).href),
]);

const workspaceRoot = path.join(temp, "workspaces");
const privateRoot = path.join(temp, "private-homes");
await Promise.all([
  mkdir(workspaceRoot, { recursive: true }),
  mkdir(privateRoot, { recursive: true }),
]);
const executable = await pinExecutable(fixture, { jobRoot: temp });
const agent = new CodexNativeAgent();
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function runCase(name, options = {}) {
  const workspace = path.join(workspaceRoot, name);
  const privateHome = path.join(privateRoot, name);
  await Promise.all([
    mkdir(workspace, { recursive: true }),
    mkdir(privateHome, { recursive: true }),
  ]);
  const controller = new AbortController();
  const events = [];
  let cancelTimer;
  if (options.cancel) {
    const previousOnEvent = options.onEvent;
    options.onEvent = (event) => {
      events.push(event);
      previousOnEvent?.(event);
      if (event.type === "started") cancelTimer = setTimeout(() => controller.abort(), 50);
    };
  }
  const request = {
    executable,
    workspace,
    privateHome,
    prompt: `fixture prompt for ${name}`,
    mcp: { url: "http://127.0.0.1:43127/mcp", token: "fixture-token" },
    outputSchema: options.outputSchema,
    image: options.image === true,
    timeoutMs: options.timeoutMs,
    signal: controller.signal,
    onEvent: (event) => {
      if (!options.cancel) events.push(event);
      options.onEvent?.(event);
    },
  };
  let outcome;
  try {
    outcome = { ok: true, result: await agent.run(request) };
  } catch (error) {
    outcome = { ok: false, code: error?.code || "unknown_error" };
  } finally {
    if (cancelTimer) clearTimeout(cancelTimer);
  }
  const summary = JSON.parse(await readFile(path.join(workspace, ".fixture-summary.json"), "utf8"));
  const remainingPrivateHomeFiles = await readdir(privateHome);
  assert.deepEqual(remainingPrivateHomeFiles, [], `${name} left generated files in privateHome`);
  cases.push(name);
  return { outcome, events, summary, workspace };
}

try {
  process.env.OPENAI_API_KEY = "fixture-openai-secret";
  process.env.ANTHROPIC_API_KEY = "fixture-anthropic-secret";
  process.env.CODEX_API_KEY = "fixture-codex-secret";
  process.env.CLAUDE_API_KEY = "fixture-claude-secret";
  process.env.OPENAI_OAUTH_TOKEN = "fixture-openai-oauth";
  process.env.ANTHROPIC_AUTH_TOKEN = "fixture-anthropic-auth";

  const text = await runCase("happy-text", { outputSchema: { type: "object", properties: { ok: { type: "boolean" } } } });
  assert.equal(text.outcome.ok, true);
  assert.deepEqual(text.events.map((event) => event.type), ["started", "tool", "completed"]);
  assert.equal(text.events[1].toolName, "enjoy.submit_lesson_draft");
  assert.deepEqual(text.outcome.result, {
    provider: "codex",
    text: "fixture lesson text",
    images: [],
    model: "fixture-model",
  });
  assert.deepEqual(text.summary.methods, [
    "initialize",
    "initialized",
    "account/read",
    "config/read",
    "thread/start",
    "mcpServerStatus/list",
    "turn/start",
  ]);
  assert.equal(text.summary.tokenPresent, true);
  assert.equal(text.summary.credentialEnvPresent, false);
  assert.equal(text.summary.config.imageGeneration, false);
  assert.equal(text.summary.config.webSearchDisabled, true);
  assert.equal(text.summary.config.defaultPermissions, true);
  assert.equal(text.summary.config.modelCatalogPresent, true);
  assert.deepEqual(text.summary.thread.serverNames.length, 3);
  assert.equal(text.summary.thread.nativeServersDisabled, true);
  assert.equal(text.summary.thread.enjoyToolsCount, 6);
  assert.equal(text.summary.thread.workspaceScoped, true);
  assert.equal(text.summary.thread.permissionProfile, "enjoy-job");
  assert.equal(text.summary.thread.hasOutputSchema, true);
  assert.deepEqual(text.summary.status.scopedTools, [
    "enjoy.get_job_context",
    "enjoy.get_lesson_revision",
    "enjoy.get_job_status",
    "enjoy.submit_lesson_draft",
    "enjoy.submit_mindmap",
    "enjoy.submit_exercises",
  ]);
  assert.deepEqual(text.summary.status.foreignTools, []);
  assert.equal(text.summary.turnStarted, true);

  const image = await runCase("happy-image", { image: true });
  assert.equal(image.outcome.ok, true);
  assert.equal(image.outcome.result.provider, "codex");
  assert.equal(image.outcome.result.images.length, 1);
  assert.equal(image.outcome.result.images[0].mimeType, "image/png");
  assert.equal(image.outcome.result.images[0].providerItemId, "image-1");
  assert.equal(Buffer.isBuffer(image.outcome.result.images[0].bytes), true);
  assert.deepEqual(image.outcome.result.images[0].bytes.subarray(0, 8), pngSignature);
  assert.equal(image.summary.config.imageGeneration, true);
  assert.equal(image.summary.credentialEnvPresent, false);

  const foreign = await runCase("foreign-mcp");
  expectError(foreign.outcome, "native_foreign_tools");
  assert.equal(foreign.summary.turnStarted, false);
  assert.equal(foreign.summary.methods.includes("turn/start"), false);
  assert.deepEqual(foreign.summary.status.foreignTools, ["read_file"]);

  for (const scenario of ["foreign-event-tool", "foreign-event-server"]) {
    const rejected = await runCase(scenario);
    expectError(rejected.outcome, "native_foreign_tools");
    assert.equal(rejected.events.some(event => event.type === "tool"), false);
  }

  const missing = await runCase("missing-scoped-tools");
  expectError(missing.outcome, "native_mcp_unavailable");
  assert.equal(missing.summary.turnStarted, false);
  assert.equal(missing.summary.methods.includes("turn/start"), false);
  assert.equal(missing.summary.status.scopedTools.length, 5);

  const unauth = await runCase("unauthenticated");
  expectError(unauth.outcome, "native_auth_required");
  assert.deepEqual(unauth.summary.methods, ["initialize", "initialized", "account/read"]);
  assert.equal(unauth.summary.turnStarted, false);

  const wrongPermission = await runCase("wrong-permission");
  expectError(wrongPermission.outcome, "native_policy_unverified");
  assert.equal(wrongPermission.summary.thread.permissionProfile, "wrong-profile");
  assert.equal(wrongPermission.summary.turnStarted, false);

  const timeout = await runCase("timeout", { timeoutMs: 120 });
  expectError(timeout.outcome, "native_timeout");
  assert.equal(timeout.summary.turnStarted, true);
  assert.equal(Number.isInteger(timeout.summary.descendantPid), true);
  assert.equal(await waitFor(() => !isAlive(timeout.summary.descendantPid)), true);

  const cancelled = await runCase("cancel", { cancel: true, timeoutMs: 2_000 });
  expectError(cancelled.outcome, "native_cancelled");
  assert.equal(cancelled.summary.turnStarted, true);
  assert.equal(Number.isInteger(cancelled.summary.descendantPid), true);
  assert.equal(await waitFor(() => !isAlive(cancelled.summary.descendantPid)), true);

  const malformedResult = await runCase("malformed-result");
  expectError(malformedResult.outcome, "native_turn_failed");
  assert.equal(malformedResult.summary.turnStarted, true);

  const malformedStatus = await runCase("malformed-status");
  expectError(malformedStatus.outcome, "native_policy_unverified");
  assert.equal(malformedStatus.summary.turnStarted, false);

  const evidence = [
    "# U4 Codex native adapter protocol",
    "",
    `- Checked: ${new Date().toISOString()}`,
    `- Cases: ${cases.length}`,
    "- Harness: bundled CodexNativeAgent plus pinned executable fixture with a node shebang; no real inference or credentials were used.",
    "- Handshake: initialize, account/read, config/read, thread/start and MCP status were exercised over JSON-RPC JSONL.",
    "- Policy: Enjoy MCP tool names are exact, host MCP entries are disabled, workspace permission is checked, and foreign tools fail before turn/start.",
    "- Results: text and image item completion were parsed; image output passed the PNG signature check.",
    "- Failure mapping: missing tools, unauthenticated account, wrong permission, malformed status/result, timeout and cancellation were checked.",
    "- Cleanup: timeout and cancellation removed the fixture descendant process; generated model catalog files were removed from privateHome.",
    "- Environment: credential-shaped env values were present in the harness host but absent from the child; only the explicit MCP capability token was observed as present.",
  ].join("\n") + "\n";
  await writeFile(evidencePath, evidence, "utf8");
  console.log(`PASS: ${cases.length} Codex adapter cases. Evidence: ${evidencePath}`);
} finally {
  for (const [key, value] of Object.entries(previousCredentialEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(temp, { recursive: true, force: true });
}
