#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const enjoyRoot = path.resolve(import.meta.dirname, "..");
const adapterSource = path.join(enjoyRoot, "src", "main", "agents", "claude-native.ts");
const evidencePath = process.env.ENJOY_CLAUDE_ADAPTER_EVIDENCE || "/tmp/enjoy-claude-adapter.md";
const live = process.argv.includes("--live");
const expectedTools = [
  "mcp__enjoy__enjoy_get_job_context",
  "mcp__enjoy__enjoy_get_lesson_revision",
  "mcp__enjoy__enjoy_get_job_status",
  "mcp__enjoy__enjoy_submit_lesson_draft",
  "mcp__enjoy__enjoy_submit_mindmap",
  "mcp__enjoy__enjoy_submit_exercises",
];

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "enjoy-claude-adapter-check-"));
const workspace = path.join(tempRoot, "workspace");
const privateHome = path.join(tempRoot, "private-home");
const bundle = path.join(tempRoot, "claude-native.mjs");
const cases = [];
const observations = [];

await Promise.all([
  mkdir(workspace, { recursive: true }),
  mkdir(privateHome, { recursive: true }),
]);

function jsonLiteral(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function fixtureSource(mode, markerPath) {
  const tools = jsonLiteral(expectedTools);
  return `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const mode = ${jsonLiteral(mode)};
const markerPath = ${jsonLiteral(markerPath)};
const args = process.argv.slice(2);
const optionValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const writeMarker = (value) => writeFileSync(markerPath, JSON.stringify(value) + "\\n");
const validTools = ${tools};
const mcpConfigPath = optionValue("--mcp-config");
const settingsPath = optionValue("--settings");
if (mode === "cancel") writeMarker({ mode, started: true });
let mcpConfig = null;
let settings = null;
try {
  mcpConfig = mcpConfigPath ? JSON.parse(readFileSync(mcpConfigPath, "utf8")) : null;
  settings = settingsPath ? JSON.parse(readFileSync(settingsPath, "utf8")) : null;
} catch {
  writeMarker({ mode, configReadable: false });
  process.exit(23);
}

const init = (overrides = {}) => emit({
  type: "system",
  subtype: "init",
  tools: validTools,
  mcp_servers: mcpConfig?.mcpServers?.enjoy
    ? [{ name: "enjoy", status: "connected" }]
    : [],
  plugins: [],
  model: "fixture-claude",
  ...overrides,
});
const finish = (value, overrides = {}) => {
  emit({ type: "result", subtype: "success", is_error: false, result: value, model: "fixture-claude", ...overrides });
  process.exit(0);
};

if (mode === "success") {
  writeMarker({
    mode,
    configReadable: Boolean(mcpConfig),
    settingsReadable: Boolean(settings),
    configType: mcpConfig?.mcpServers?.enjoy?.type ?? null,
    configUrl: mcpConfig?.mcpServers?.enjoy?.url ?? null,
    bearerHeaderMatches: mcpConfig?.mcpServers?.enjoy?.headers?.Authorization === "Bearer fixture-secret",
    tokenInArgv: args.some((value) => value.includes("fixture-secret")),
    settingsHasHooks: Boolean(settings && Object.prototype.hasOwnProperty.call(settings, "hooks")),
    mcpConfigPath,
    settingsPath,
    args,
    home: process.env.HOME ?? null,
    user: process.env.USER ?? null,
    claudeConfigDir: process.env.CLAUDE_CONFIG_DIR ?? null,
    xdgConfigHome: process.env.XDG_CONFIG_HOME ?? null,
    xdgCacheHome: process.env.XDG_CACHE_HOME ?? null,
  });
  init();
  emit({
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "Coffee is ready." },
        { type: "tool_use", name: "mcp__enjoy__enjoy_get_job_context", input: { secret: "must-not-be-forwarded" } },
      ],
    },
  });
  finish("Coffee is ready.", { structured_output: { status: "ok", message: "ready" } });
}

if (mode === "no-mcp") {
  writeMarker({
    mode,
    serverCount: Object.keys(mcpConfig?.mcpServers ?? {}).length,
    settingsHasHooks: Boolean(settings && Object.prototype.hasOwnProperty.call(settings, "hooks")),
  });
  init({ tools: [], mcp_servers: [] });
  finish("No tool needed.");
}

if (mode === "unexpected-tool") {
  process.on("SIGTERM", () => {
    writeMarker({ mode, terminated: true });
    process.exit(0);
  });
  init({ tools: [validTools[0], "Bash"] });
  setTimeout(() => finish("late result"), 30_000);
}

if (mode === "unexpected-plugin") {
  process.on("SIGTERM", () => {
    writeMarker({ mode, terminated: true });
    process.exit(0);
  });
  init({ plugins: [{ name: "rogue-plugin" }] });
  setTimeout(() => finish("late result"), 30_000);
}

if (mode === "unexpected-server") {
  process.on("SIGTERM", () => {
    writeMarker({ mode, terminated: true });
    process.exit(0);
  });
  init({ mcp_servers: [{ name: "enjoy", status: "connected" }, { name: "rogue", status: "connected" }] });
  setTimeout(() => finish("late result"), 30_000);
}

if (mode === "malformed") {
  process.stdout.write("not-json\\n");
}

if (mode === "auth") {
  init();
  emit({ type: "result", subtype: "error", is_error: true, result: "Not authenticated. Please log in to continue." });
  process.exit(1);
}

if (mode === "quota") {
  init();
  emit({ type: "result", subtype: "error", is_error: true, result: "Rate limit reached: usage quota exceeded." });
  process.exit(1);
}

if (mode === "cancel") {
  process.on("SIGTERM", () => {
    writeMarker({ mode, terminated: true });
    process.exit(0);
  });
  init();
  setInterval(() => {}, 1_000);
}
`;
}

async function createFixture(mode) {
  const markerPath = path.join(tempRoot, `${mode}.json`);
  const fixturePath = path.join(tempRoot, `fixture-${mode}.mjs`);
  await writeFile(fixturePath, fixtureSource(mode, markerPath), { encoding: "utf8", mode: 0o700 });
  await chmod(fixturePath, 0o700);
  return { fixturePath, markerPath };
}

async function readMarker(markerPath) {
  try {
    return JSON.parse(await readFile(markerPath, "utf8"));
  } catch {
    return null;
  }
}

async function pinExecutable(executablePath) {
  const canonical = realpathSync(executablePath);
  const stats = await stat(canonical);
  const bytes = await readFile(canonical);
  return {
    path: canonical,
    realpath: canonical,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  };
}

function makeRequest(mod, fixturePath, overrides = {}) {
  const controller = overrides.controller || new AbortController();
  const request = {
    executable: overrides.executable,
    workspace,
    privateHome,
    prompt: "Return a tiny status.",
    mcp: { url: "https://mcp.example.test/enjoy", token: "fixture-secret" },
    timeoutMs: 2_000,
    signal: controller.signal,
    onEvent: overrides.onEvent,
    ...overrides,
  };
  request.executable = request.executable || overrides.pin;
  request.__fixturePath = fixturePath;
  return { request, controller };
}

async function runWithFixture(mod, mode, overrides = {}) {
  const { fixturePath, markerPath } = await createFixture(mode);
  const executable = overrides.executable || await pinExecutable(fixturePath);
  const events = [];
  const { request, controller } = makeRequest(mod, fixturePath, {
    executable,
    onEvent: (event) => {
      events.push(event);
      overrides.onEvent?.(event);
    },
    ...overrides,
  });
  const adapter = new mod.ClaudeNativeAgent();
  const result = await adapter.run(request).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
  const marker = await readMarker(markerPath);
  return { result, events, marker, markerPath, controller, fixturePath };
}

async function test(name, action) {
  try {
    await action();
    cases.push({ name, status: "PASS" });
  } catch (error) {
    cases.push({ name, status: "FAIL", code: error?.code || "assertion_failed" });
    throw error;
  }
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

try {
  await build({
    entryPoints: [adapterSource],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    outfile: bundle,
    logLevel: "silent",
  });
  const mod = await import(pathToFileURL(bundle).href);

  await test("builds the restricted Claude invocation without bypass or token argv", () => {
    const invocation = mod.buildClaudeInvocation({
      mcpConfigPath: "/tmp/app-owned-mcp.json",
      settingsPath: "/tmp/app-owned-settings.json",
      prompt: "tiny prompt",
      outputSchema: { type: "object", properties: { ok: { type: "boolean" } } },
    });
    assert.equal(invocation.command, undefined);
    assert.equal(invocation.args.includes("--restricted"), true);
    assert.equal(invocation.args.includes("--safe-mode"), false);
    assert.equal(invocation.args.includes("--dangerously-skip-permissions"), false);
    assert.equal(invocation.args.includes("--allow-dangerously-skip-permissions"), false);
    assert.equal(invocation.args.includes("--bypass-permissions"), false);
    assert.equal(invocation.args.includes("--setting-sources"), true);
    assert.equal(invocation.args[invocation.args.indexOf("--setting-sources") + 1], "");
    assert.equal(invocation.args.includes("--strict-mcp-config"), true);
    assert.equal(invocation.args.includes("--tools"), true);
    assert.equal(invocation.args[invocation.args.indexOf("--tools") + 1], "");
    assert.deepEqual(invocation.allowedTools, expectedTools);
    assert.equal(invocation.args.includes("fixture-secret"), false);
    assert.equal(invocation.args.includes("--json-schema"), true);
  });

  await test("returns structured output, maps text/tool lifecycle, and cleans app-owned files", async () => {
    const run = await runWithFixture(mod, "success");
    assert.equal(run.result.ok, true);
    assert.deepEqual(run.result.value, {
      provider: "claude",
      text: JSON.stringify({ status: "ok", message: "ready" }),
      images: [],
      model: "fixture-claude",
    });
    assert.deepEqual(run.events.map((event) => event.type), ["started", "tool", "text", "completed"]);
    assert.equal(run.events.some((event) => event.toolName === "mcp__enjoy__enjoy_get_job_context"), true);
    assert.equal(run.events.some((event) => event.text === "Coffee is ready."), true);
    assert.equal(run.marker.configType, "http");
    assert.equal(run.marker.configUrl, "https://mcp.example.test/enjoy");
    assert.equal(run.marker.bearerHeaderMatches, true);
    assert.equal(run.marker.tokenInArgv, false);
    assert.equal(run.marker.settingsHasHooks, false);
    assert.equal(run.marker.home, process.env.HOME || null);
    assert.equal(run.marker.user, process.env.USER || null);
    assert.equal(existsSync(run.marker.mcpConfigPath), false);
    assert.equal(existsSync(run.marker.settingsPath), false);
    assert.equal(JSON.stringify(run.result).includes("must-not-be-forwarded"), false);
  });

  await test("allows a text-only turn with an empty explicit MCP config", async () => {
    const run = await runWithFixture(mod, "no-mcp", { mcp: undefined });
    assert.equal(run.result.ok, true);
    assert.equal(run.result.value.text, "No tool needed.");
    assert.equal(run.marker.serverCount, 0);
    assert.equal(run.marker.settingsHasHooks, false);
  });

  for (const [mode, expectedCode] of [
    ["unexpected-tool", "native_catalog"],
    ["unexpected-plugin", "native_catalog"],
    ["unexpected-server", "native_catalog"],
  ]) {
    await test(`fails closed and terminates on ${mode}`, async () => {
      const run = await runWithFixture(mod, mode);
      assert.equal(run.result.ok, false);
      assert.equal(run.result.error.code, expectedCode);
      assert.equal(await waitFor(async () => (await readMarker(run.markerPath))?.terminated === true), true);
      assert.equal(JSON.stringify(run.result.error).includes("Bash"), false);
      assert.equal(JSON.stringify(run.result.error).includes("rogue"), false);
    });
  }

  await test("maps malformed JSONL to a bounded protocol error", async () => {
    const run = await runWithFixture(mod, "malformed");
    assert.equal(run.result.ok, false);
    assert.equal(run.result.error.code, "native_protocol");
    assert.equal(JSON.stringify(run.result.error).includes("not-json"), false);
  });

  await test("maps auth and quota result failures without exposing raw output", async () => {
    const auth = await runWithFixture(mod, "auth");
    assert.equal(auth.result.ok, false);
    assert.equal(auth.result.error.code, "native_auth");
    assert.equal(JSON.stringify(auth.result.error).includes("Not authenticated"), false);

    const quota = await runWithFixture(mod, "quota");
    assert.equal(quota.result.ok, false);
    assert.equal(quota.result.error.code, "native_quota");
    assert.equal(JSON.stringify(quota.result.error).includes("quota exceeded"), false);
  });

  await test("maps AbortSignal cancellation to native_cancelled after process cleanup", async () => {
    const controller = new AbortController();
    const runPromise = runWithFixture(mod, "cancel", { controller });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    controller.abort();
    const run = await runPromise;
    assert.equal(run.result.ok, false);
    assert.equal(run.result.error.code, "native_cancelled");
    assert.equal(run.marker?.terminated, true);
  });

  if (live) {
    observations.push(await runLiveSmoke(mod, { maxTurns: 2 }));
  } else {
    observations.push({ status: "SKIP", reason: "live flag not supplied" });
  }
} finally {
  const failed = cases.filter((entry) => entry.status === "FAIL");
  const report = [
    "# Claude native adapter check",
    "",
    `- Fixture checks: ${cases.filter((entry) => entry.status === "PASS").length} passed, ${failed.length} failed.`,
    `- Live smoke: ${observations.map((entry) => entry.status).join(", ") || "not run"}.`,
    "- Credential values are intentionally omitted from this report.",
    "",
    ...cases.map((entry) => `- ${entry.status}: ${entry.name}${entry.code ? ` (${entry.code})` : ""}.`),
    "",
    ...observations.map((entry) => `- ${entry.status}: ${entry.reason || "completed"}.`),
    "",
  ].join("\n");
  try {
    await writeFile(evidencePath, report, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Keep test failure focused on adapter behavior when optional evidence cannot be written.
  }
  await rm(tempRoot, { recursive: true, force: true });
}

if (cases.some((entry) => entry.status === "FAIL")) process.exitCode = 1;
console.log(`Claude native adapter checks: ${cases.filter((entry) => entry.status === "PASS").length}/${cases.length} fixture checks passed.`);

async function runLiveSmoke(mod, { maxTurns }) {
  if (maxTurns > 2) throw new Error("live smoke turn limit exceeded");
  const binary = process.env.ENJOY_CLAUDE_BINARY || "/Users/ethan/.local/bin/claude";
  if (!existsSync(binary)) return { status: "BLOCKED", reason: "claude binary unavailable" };
  const executable = await pinExecutable(binary);
  const localMcp = await createLiveEnjoyMcpServer();
  const prompt = [
    "Call the Enjoy MCP tool mcp__enjoy__enjoy_get_job_status exactly once before answering.",
    "Then return one short sentence about coffee.",
    "Do not call any other tool.",
  ].join(" ");
  const controller = new AbortController();
  const events = [];
  let result;
  try {
    const adapter = new mod.ClaudeNativeAgent();
    result = await adapter.run({
      executable,
      workspace,
      privateHome,
      prompt,
      mcp: { url: localMcp.url, token: localMcp.token },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { sentence: { type: "string", maxLength: 160 } },
        required: ["sentence"],
      },
      timeoutMs: 45_000,
      signal: controller.signal,
      onEvent: (event) => events.push(event),
    });
  } catch (error) {
    if (error?.code === "native_auth" || error?.code === "native_quota") {
      return { status: "BLOCKED", reason: error.code };
    }
    return { status: "FAIL", reason: error?.code || "native_error" };
  } finally {
    await localMcp.close();
  }
  if (!result || result.provider !== "claude") return { status: "FAIL", reason: "live adapter returned no result" };
  if (localMcp.callCount !== 1) return { status: "FAIL", reason: `MCP call count ${localMcp.callCount}` };
  return { status: "PASS", reason: "one live Claude text turn and one scoped Enjoy MCP call completed" };
}

async function createLiveEnjoyMcpServer() {
  const capabilityBundle = path.join(tempRoot, "live-capability-registry.mjs");
  const mcpBundle = path.join(tempRoot, "live-mcp-server.mjs");
  await Promise.all([
    build({
      entryPoints: [path.join(enjoyRoot, "src", "main", "learning", "capability-registry.ts")],
      bundle: true,
      platform: "node",
      target: "node24",
      format: "esm",
      outfile: capabilityBundle,
      logLevel: "silent",
    }),
    build({
      entryPoints: [path.join(enjoyRoot, "src", "main", "learning", "mcp-server.ts")],
      bundle: true,
      platform: "node",
      target: "node24",
      format: "esm",
      outfile: mcpBundle,
      logLevel: "silent",
    }),
  ]);
  const [{ LearningCapabilityRegistry }, { createLearningMcpServer }] = await Promise.all([
    import(pathToFileURL(capabilityBundle).href),
    import(pathToFileURL(mcpBundle).href),
  ]);
  const ids = {
    profileId: "live-profile",
    connectionId: "live-connection",
    jobId: "live-job",
    stageId: "live-stage",
    attemptId: "live-attempt",
    revisionId: "live-revision",
  };
  const registry = new LearningCapabilityRegistry();
  const token = registry.issue({
    ...ids,
    tools: ["enjoy.get_job_context", "enjoy.get_lesson_revision", "enjoy.get_job_status", "enjoy.submit_lesson_draft"],
  });
  let callCount = 0;
  const server = await createLearningMcpServer({
    capabilities: registry,
    application: {
      async getJobContext() { return { kind: "job_context" }; },
      async getLessonRevision() { return { kind: "lesson_revision" }; },
      async getJobStatus(grant) {
        callCount += 1;
        return { kind: "job_status", jobId: grant.jobId };
      },
      async submitCandidate() { return { accepted: true }; },
    },
  });
  return {
    ...server,
    token,
    get callCount() { return callCount; },
  };
}
