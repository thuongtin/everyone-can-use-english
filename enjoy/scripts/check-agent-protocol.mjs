#!/usr/bin/env node

import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const enjoyRoot = path.resolve(import.meta.dirname, "..");
const fixture = path.join(enjoyRoot, "scripts", "fixtures", "agent-process", "fixture-process.mjs");
const nodeExecutable = process.execPath;
const evidencePath = process.env.ENJOY_AGENT_PROTOCOL_EVIDENCE || "/tmp/enjoy-u4-process-manager.md";
const cases = [];
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-agent-process-"));
const jobRoot = path.join(temp, "job");
const isolatedHome = path.join(temp, "profile");
const bundle = path.join(temp, "process-manager.mjs");

const test = async (name, action) => {
  await action();
  cases.push(name);
};

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

await import("node:fs/promises").then(({ mkdir }) => Promise.all([
  mkdir(jobRoot, { recursive: true }),
  mkdir(isolatedHome, { recursive: true }),
]));
await build({
  entryPoints: [path.join(enjoyRoot, "src/main/agents/process-manager.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: bundle,
  logLevel: "silent",
});

const {
  ProcessManager,
  buildAllowlistedEnv,
  pinExecutable,
  sanitizeDiagnostic,
} = await import(pathToFileURL(bundle).href);

try {
  await test("pins an absolute regular executable outside the job root", async () => {
    const pin = await pinExecutable(nodeExecutable, { jobRoot });
    assert.equal(path.isAbsolute(pin.path), true);
    assert.equal(pin.path, pin.realpath);
    assert.match(pin.sha256, /^[a-f0-9]{64}$/);
    assert.equal(typeof pin.size, "number");
    assert.equal(typeof pin.mtimeMs, "number");

    const localExecutable = path.join(jobRoot, "inside");
    await writeFile(localExecutable, "#!/bin/sh\nexit 0\n");
    await chmod(localExecutable, 0o755);
    await assert.rejects(pinExecutable(localExecutable, { jobRoot }), { code: "invalid_executable" });
    await assert.rejects(pinExecutable("relative-node", { jobRoot }), { code: "invalid_executable" });
    assert.throws(() => new ProcessManager({ jobRoot }), { code: "invalid_path" });
  });

  await test("builds an allowlisted environment without inherited secrets", () => {
  const env = buildAllowlistedEnv({
      baseEnv: { PATH: "/bin", HOME: "/global-home", ENJOY_MCP_TOKEN: "host-token", SECRET_SHOULD_NOT_PASS: "do-not-copy" },
      overrides: { ENJOY_MCP_TOKEN: "safe", SECRET_SHOULD_NOT_PASS: "still-do-not-copy" },
    });
    assert.deepEqual(env, { PATH: "/bin", ENJOY_MCP_TOKEN: "safe" });
  });

  await test("rejects host HOME as isolatedHome for every auth mode", () => {
    if (!process.env.HOME || !existsSync(process.env.HOME)) return;
    const hostHome = realpathSync(process.env.HOME);
    for (const authMode of ["isolated", "existing-codex", "existing-claude"]) {
      assert.throws(() => new ProcessManager({ jobRoot, isolatedHome: hostHome, authMode }), { code: "invalid_path" });
    }
  });

  const pin = await pinExecutable(nodeExecutable, { jobRoot });
  const manager = new ProcessManager({ jobRoot, isolatedHome, maxLineBytes: 2_048, maxOutputBytes: 4_096, killGraceMs: 100 });
  const run = (options = {}) => manager.run({ cwd: jobRoot, ...options });
  const start = (options = {}) => manager.spawn({ cwd: jobRoot, ...options });

  await test("spawns with literal argv, detached process group, and scoped env", async () => {
    const messages = [];
    const result = await run({
      executable: pin,
      args: [fixture, "argv-env", "value with spaces", "$(touch should-not-exist)", "--flag=value"],
      env: { HOME: "/global-home", ENJOY_MCP_TOKEN: "safe", CODEX_HOME: path.join(realpathSync(isolatedHome), "codex"), SECRET_SHOULD_NOT_PASS: "secret" },
      envAllowlist: ["SECRET_SHOULD_NOT_PASS", "ENJOY_MCP_TOKEN", "CODEX_HOME"],
      onMessage: (message) => messages.push(message),
    });
    assert.equal(result.reason, "completed");
    assert.deepEqual(messages[0], {
      argv: ["argv-env", "value with spaces", "$(touch should-not-exist)", "--flag=value"],
      env: {
        HOME: realpathSync(isolatedHome),
        USER: null,
        LOGNAME: null,
        ENJOY_MCP_TOKEN: "safe",
        CODEX_HOME: path.join(realpathSync(isolatedHome), "codex"),
        CLAUDE_CONFIG_DIR: null,
        XDG_CONFIG_HOME: null,
        XDG_CACHE_HOME: null,
        SECRET_SHOULD_NOT_PASS: null,
        OPENAI_API_KEY: null,
        ANTHROPIC_API_KEY: null,
        CODEX_API_KEY: null,
        CLAUDE_API_KEY: null,
      },
    });
    assert.equal(result.eventCount, 1);
    assert.equal(existsSync(path.join(jobRoot, "should-not-exist")), false);
  });

  await test("reuses the existing Codex identity and constructor-snapshotted profile", async () => {
    const hostHome = path.join(temp, "host-home");
    const hostCodexHome = path.join(temp, "host-codex-a");
    const laterCodexHome = path.join(temp, "host-codex-b");
    const previous = Object.fromEntries([
      "HOME",
      "USER",
      "LOGNAME",
      "CODEX_HOME",
      "CLAUDE_CONFIG_DIR",
      "XDG_CONFIG_HOME",
      "XDG_CACHE_HOME",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "CODEX_API_KEY",
      "CLAUDE_API_KEY",
    ].map((key) => [key, process.env[key]]));
    Object.assign(process.env, {
      HOME: hostHome,
      USER: "native-user",
      LOGNAME: "native-logname",
      CODEX_HOME: hostCodexHome,
      CLAUDE_CONFIG_DIR: path.join(temp, "host-claude-config"),
      XDG_CONFIG_HOME: path.join(temp, "host-xdg-config"),
      XDG_CACHE_HOME: path.join(temp, "host-xdg-cache"),
      OPENAI_API_KEY: "host-openai-secret",
      ANTHROPIC_API_KEY: "host-anthropic-secret",
      CODEX_API_KEY: "host-codex-secret",
      CLAUDE_API_KEY: "host-claude-secret",
    });
    try {
      const existing = new ProcessManager({ jobRoot, isolatedHome, authMode: "existing-codex" });
      process.env.CODEX_HOME = laterCodexHome;
      const messages = [];
      const result = await existing.run({
        cwd: jobRoot,
        executable: pin,
        args: [fixture, "argv-env"],
        env: {
          OPENAI_API_KEY: "spawn-openai-secret",
          ANTHROPIC_API_KEY: "spawn-anthropic-secret",
          CODEX_API_KEY: "spawn-codex-secret",
          CLAUDE_API_KEY: "spawn-claude-secret",
          ENJOY_MCP_TOKEN: "explicit-main-token",
        },
        envAllowlist: [
          "OPENAI_API_KEY",
          "ANTHROPIC_API_KEY",
          "CODEX_API_KEY",
          "CLAUDE_API_KEY",
          "ENJOY_MCP_TOKEN",
        ],
        onMessage: (message) => messages.push(message),
      });
      assert.equal(result.reason, "completed");
      assert.deepEqual(messages[0].env, {
        HOME: hostHome,
        USER: "native-user",
        LOGNAME: "native-logname",
        ENJOY_MCP_TOKEN: "explicit-main-token",
        CODEX_HOME: hostCodexHome,
        CLAUDE_CONFIG_DIR: null,
        XDG_CONFIG_HOME: null,
        XDG_CACHE_HOME: null,
        SECRET_SHOULD_NOT_PASS: null,
        OPENAI_API_KEY: null,
        ANTHROPIC_API_KEY: null,
        CODEX_API_KEY: null,
        CLAUDE_API_KEY: null,
      });
      await existing.shutdown();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  await test("reuses existing Claude profile paths and preserves the host identity", async () => {
    const hostHome = path.join(temp, "claude-host-home");
    const previous = Object.fromEntries([
      "HOME",
      "USER",
      "LOGNAME",
      "CODEX_HOME",
      "CLAUDE_CONFIG_DIR",
      "XDG_CONFIG_HOME",
      "XDG_CACHE_HOME",
    ].map((key) => [key, process.env[key]]));
    Object.assign(process.env, {
      HOME: hostHome,
      USER: "claude-user",
      LOGNAME: "claude-logname",
      CODEX_HOME: path.join(temp, "claude-should-not-pass-codex"),
      CLAUDE_CONFIG_DIR: path.join(temp, "claude-config"),
      XDG_CONFIG_HOME: path.join(temp, "claude-xdg-config"),
      XDG_CACHE_HOME: path.join(temp, "claude-xdg-cache"),
    });
    try {
      const existing = new ProcessManager({ jobRoot, isolatedHome, authMode: "existing-claude" });
      const messages = [];
      const result = await existing.run({ cwd: jobRoot, executable: pin, args: [fixture, "argv-env"], onMessage: (message) => messages.push(message) });
      assert.equal(result.reason, "completed");
      assert.deepEqual(messages[0].env, {
        HOME: hostHome,
        USER: "claude-user",
        LOGNAME: "claude-logname",
        ENJOY_MCP_TOKEN: null,
        CODEX_HOME: null,
        CLAUDE_CONFIG_DIR: path.join(temp, "claude-config"),
        XDG_CONFIG_HOME: path.join(temp, "claude-xdg-config"),
        XDG_CACHE_HOME: path.join(temp, "claude-xdg-cache"),
        SECRET_SHOULD_NOT_PASS: null,
        OPENAI_API_KEY: null,
        ANTHROPIC_API_KEY: null,
        CODEX_API_KEY: null,
        CLAUDE_API_KEY: null,
      });
      await existing.shutdown();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  await test("rejects existing-mode identity and profile overrides with a stable error", async () => {
    const previous = Object.fromEntries(["HOME", "USER", "LOGNAME", "CODEX_HOME"].map((key) => [key, process.env[key]]));
    Object.assign(process.env, {
      HOME: path.join(temp, "override-host-home"),
      USER: "override-user",
      LOGNAME: "override-logname",
      CODEX_HOME: path.join(temp, "override-codex"),
    });
    try {
      const existing = new ProcessManager({ jobRoot, isolatedHome, authMode: "existing-codex" });
      for (const key of ["HOME", "USER", "LOGNAME", "CODEX_HOME"]) {
        const override = key === "CODEX_HOME"
          ? path.join(realpathSync(isolatedHome), "caller-override")
          : "/caller-override";
        const result = await existing.run({ cwd: jobRoot, executable: pin, args: [fixture, "argv-env"], env: { [key]: override } });
        assert.equal(result.reason, "spawn_failed");
        assert.equal(result.errorCode, "invalid_environment");
      }
      await existing.shutdown();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  await test("keeps default isolated mode behavior", async () => {
    const messages = [];
    const result = await run({
      executable: pin,
      args: [fixture, "argv-env"],
      env: {
        HOME: "/caller-home-must-not-pass",
        USER: "caller-user-must-not-pass",
        LOGNAME: "caller-logname-must-not-pass",
        CODEX_HOME: path.join(realpathSync(isolatedHome), "codex-default"),
        OPENAI_API_KEY: "caller-openai-secret",
      },
      envAllowlist: ["HOME", "USER", "LOGNAME", "CODEX_HOME", "OPENAI_API_KEY"],
      onMessage: (message) => messages.push(message),
    });
    assert.equal(result.reason, "completed");
    assert.equal(messages[0].env.HOME, realpathSync(isolatedHome));
    assert.equal(messages[0].env.USER, null);
    assert.equal(messages[0].env.LOGNAME, null);
    assert.equal(messages[0].env.CODEX_HOME, path.join(realpathSync(isolatedHome), "codex-default"));
    assert.equal(messages[0].env.OPENAI_API_KEY, null);
  });

  await test("parses JSONL split across chunks and flushes the final line", async () => {
    const messages = [];
    const result = await run({ executable: pin, args: [fixture, "success", "literal"], onMessage: (message) => messages.push(message) });
    assert.equal(result.reason, "completed");
    assert.deepEqual(messages, [
      { type: "partial", value: "split" },
      { type: "done", value: "literal" },
    ]);
    const many = [];
    const manyResult = await run({ executable: pin, args: [fixture, "many-lines"], maxLineBytes: 64, onMessage: (message) => many.push(message) });
    assert.equal(manyResult.reason, "completed");
    assert.equal(many.length, 3);
  });

  await test("writes bounded JSONL with stdin backpressure", async () => {
    const messages = [];
    const running = start({ executable: pin, args: [fixture, "echo"], onMessage: (message) => messages.push(message) });
    await running.write({ request: "literal value", nested: { ok: true } });
    assert.equal(await waitFor(() => messages.length === 1), true);
    assert.deepEqual(messages[0], { echo: { request: "literal value", nested: { ok: true } } });
    await running.cancel();
    assert.equal((await running.result).reason, "cancelled");
  });

  await test("turns malformed JSONL into protocol_error without raw output", async () => {
    const result = await run({ executable: pin, args: [fixture, "malformed"] });
    assert.equal(result.reason, "protocol_error");
    assert.equal("events" in result, false);
    assert.equal(JSON.stringify(result).includes("not-json"), false);
    const invalidUtf8 = await run({ executable: pin, args: [fixture, "invalid-utf8"] });
    assert.equal(invalidUtf8.reason, "protocol_error");
  });

  await test("enforces per-line and total output limits", async () => {
    const line = await run({ executable: pin, args: [fixture, "huge-line"], maxLineBytes: 128 });
    assert.equal(line.reason, "output_limit");
    const total = await run({ executable: pin, args: [fixture, "huge-total"], maxOutputBytes: 256 });
    assert.equal(total.reason, "output_limit");
  });

  await test("counts stderr but never retains a raw credential diagnostic", async () => {
    const result = await run({ executable: pin, args: [fixture, "stderr-secret"] });
    assert.equal(result.reason, "completed");
    assert.equal(result.stderrBytes > 0, true);
    assert.equal(JSON.stringify(result).includes("secret-should-never-be-retained"), false);
  });

  await test("uses a controlled argv for native version probing", async () => {
    const messages = [];
    const result = await run({ executable: pin, args: [fixture, "version", "--version"], onMessage: (message) => messages.push(message) });
    assert.equal(result.reason, "completed");
    assert.deepEqual(messages, [{ type: "version", value: "fixture-agent 1.0.0" }]);
  });

  await test("reports timeout and cancellation as stable reasons", async () => {
    const timedOut = await run({ executable: pin, args: [fixture, "sleep"], timeoutMs: 80 });
    assert.equal(timedOut.reason, "timeout");
    assert.equal(timedOut.groupCleanupVerified, true);
    const running = start({ executable: pin, args: [fixture, "sleep"] });
    await waitFor(() => running.pid !== undefined);
    const cancelled = await running.cancel();
    assert.equal(cancelled.reason, "cancelled");
    assert.equal(cancelled.groupCleanupVerified, true);
    await assert.rejects(running.write({ after: "cancel" }), { code: "process_closed" });
  });

  await test("kills descendants with the owned detached process group", async () => {
    const marker = path.join(temp, "descendant-pids");
    const running = start({ executable: pin, args: [fixture, "descendant", marker] });
    assert.equal(await waitFor(() => existsSync(marker)), true);
    const markerContents = await readFile(marker, "utf8");
    const descendantPid = Number(markerContents.split(/\s+/)[0]);
    assert.equal(Number.isInteger(descendantPid) && descendantPid > 1, true);
    const cancelled = await running.cancel();
    assert.equal(cancelled.reason, "cancelled");
    assert.equal(cancelled.groupCleanupVerified, true);
    assert.equal(await waitFor(() => !isAlive(descendantPid), 2_000), true);
  });

  await test("cleans an ignored-stdio descendant after a successful parent exit", async () => {
    const marker = path.join(temp, "orphan-pids");
    const result = await run({ executable: pin, args: [fixture, "orphan-exit", marker] });
    assert.equal(result.reason, "completed");
    assert.equal(result.groupCleanupVerified, true);
    const descendantPid = Number((await readFile(marker, "utf8")).split(/\s+/)[0]);
    assert.equal(await waitFor(() => !isAlive(descendantPid), 2_000), true);
  });

  await test("reports spawn failure without leaking a raw path or stderr", async () => {
    const result = await run({ executable: { realpath: "/definitely/missing/enjoy-agent", path: "/definitely/missing/enjoy-agent", sha256: "0".repeat(64), size: 0, mtimeMs: 0 }, args: [] });
    assert.equal(result.reason, "spawn_failed");
    assert.equal(JSON.stringify(result).includes("definitely/missing"), false);
  });

  await test("shutdown is idempotent and rejects new work", async () => {
    const running = start({ executable: pin, args: [fixture, "sleep"] });
    const first = manager.shutdown();
    const second = manager.shutdown();
    assert.strictEqual(first, second);
    await first;
    assert.equal((await running.result).reason, "cancelled");
    assert.equal(manager.isShutdown, true);
    assert.throws(() => manager.spawn({ cwd: jobRoot, executable: pin, args: [fixture, "success"] }), { code: "manager_shutdown" });
  });

  const diagnostic = sanitizeDiagnostic("Authorization: Bearer sk-ant-secret https://example.test/oauth?token=private");
  assert.equal(diagnostic.includes("sk-ant-secret"), false);
  assert.equal(diagnostic.includes("private"), false);

  const evidence = [
    "# U4 Process Manager Protocol",
    "",
    `- Checked: ${new Date().toISOString()}`,
    `- Cases: ${cases.length}`,
    "- Executable identity: absolute canonical path, SHA-256, size and mtime; job-root paths rejected.",
    "- Spawn policy: literal argv, shell disabled, detached process group and allowlisted environment.",
    "- JSONL: split UTF-8 chunks, line and total output limits, malformed protocol handling.",
    "- Lifecycle reasons: cancelled, timeout, output_limit, protocol_error, spawn_failed and process exit.",
    "- Diagnostics: stderr is counted and discarded; raw output and credential-shaped values are omitted.",
    "- Native auth: existing-codex keeps constructor-snapshotted HOME/USER/LOGNAME/CODEX_HOME; existing-claude keeps HOME/USER/LOGNAME and Claude XDG paths.",
    "- Native auth safety: caller identity/profile overrides return invalid_environment; API-key and OAuth-shaped env names are excluded.",
    "- Process groups: cancellation and successful parent exit both verify no owned descendants remain.",
    "- Shutdown: idempotent, waits for owned processes, retains failed cleanup records and rejects new work.",
  ].join("\n") + "\n";
  await writeFile(evidencePath, evidence, "utf8");
  console.log(`PASS: ${cases.length} agent process manager cases. Evidence: ${evidencePath}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
