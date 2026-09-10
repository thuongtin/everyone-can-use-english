#!/usr/bin/env node

import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const enjoyRoot = path.resolve(import.meta.dirname, "..");
const fixture = path.join(enjoyRoot, "scripts", "fixtures", "acp", "fixture-agent.mjs");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-acp-client-"));
const workspace = path.join(temp, "workspace");
const privateHome = path.join(temp, "private-home");
const bundle = path.join(enjoyRoot, ".acp-client-check.mjs");
const completed = [];

const test = async (name, action) => {
  await action();
  completed.push(name);
};

const waitFor = async (predicate, timeoutMs = 2_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
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

await Promise.all([
  mkdir(workspace, { recursive: true }),
  mkdir(privateHome, { recursive: true }),
]);

await build({
  stdin: {
    contents: [
      'export { buildAcpAdapterEnvironment, runAcpSession, resolveAcpAdapterEntry } from "./src/main/agents/acp-client";',
      'export { pinExecutable } from "./src/main/agents/process-manager";',
    ].join("\n"),
    resolveDir: enjoyRoot,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  plugins: [{
    name: "fixture-native-proxy",
    setup(buildApi) {
      buildApi.onResolve({ filter: /proxy-environment$/u }, () => ({ path: "fixture-native-proxy", namespace: "fixture" }));
      buildApi.onLoad({ filter: /.*/u, namespace: "fixture" }, () => ({
        contents: `export const configuredNativeProxyEnvironment = () => ({
          HTTP_PROXY: "http://127.0.0.1:8123/",
          HTTPS_PROXY: "http://127.0.0.1:8123/",
          NO_PROXY: "localhost,127.0.0.1,::1,[::1]",
          http_proxy: "http://127.0.0.1:8123/",
          https_proxy: "http://127.0.0.1:8123/",
          no_proxy: "localhost,127.0.0.1,::1,[::1]",
        });`,
        loader: "js",
      }));
    },
  }],
  outfile: bundle,
  logLevel: "silent",
});

const previous = {
  ENJOY_ACP_NODE_PATH: process.env.ENJOY_ACP_NODE_PATH,
  ENJOY_CODEX_ACP_ENTRY: process.env.ENJOY_CODEX_ACP_ENTRY,
  ENJOY_CLAUDE_ACP_ENTRY: process.env.ENJOY_CLAUDE_ACP_ENTRY,
};
process.env.ENJOY_ACP_NODE_PATH = process.execPath;
process.env.ENJOY_CODEX_ACP_ENTRY = fixture;
process.env.ENJOY_CLAUDE_ACP_ENTRY = fixture;

try {
  const { buildAcpAdapterEnvironment, runAcpSession, resolveAcpAdapterEntry, pinExecutable } = await import(`${pathToFileURL(bundle).href}?${Date.now()}`);
  const executable = await pinExecutable(process.execPath, { jobRoot: workspace });
  const run = (provider, prompt, options = {}) => runAcpSession({
    provider,
    executable,
    workspace,
    privateHome,
    prompt,
    signal: options.signal ?? new AbortController().signal,
    model: options.model,
    mcp: options.mcp,
    onEvent: options.onEvent,
    timeoutMs: 5_000,
  });

  await test("resolves exact installed adapter packages to external Node files", async () => {
    delete process.env.ENJOY_CODEX_ACP_ENTRY;
    delete process.env.ENJOY_CLAUDE_ACP_ENTRY;
    const entries = await Promise.all([resolveAcpAdapterEntry("codex"), resolveAcpAdapterEntry("claude")]);
    assert.ok(entries.every((entry) => path.isAbsolute(entry) && !entry.includes(".asar/")));
    process.env.ENJOY_CODEX_ACP_ENTRY = fixture;
    process.env.ENJOY_CLAUDE_ACP_ENTRY = fixture;
  });

  await test("preserves disabled host MCP entries beside the scoped Codex server without embedding its token", () => {
    const env = buildAcpAdapterEnvironment("codex", executable, ["host-one", "host-two"], "enjoy_learning_test", {
      provider: "codex",
      executable,
      workspace,
      privateHome,
      signal: new AbortController().signal,
      mcp: { url: "http://127.0.0.1:9/mcp", token: "fixture-token" },
    });
    const config = JSON.parse(env.CODEX_CONFIG);
    assert.deepEqual(config.mcp_servers["host-one"], { enabled: false });
    assert.deepEqual(config.mcp_servers["host-two"], { enabled: false });
    assert.equal(config.mcp_servers["enjoy_learning_test"].enabled, true);
    assert.equal(config.mcp_servers["enjoy_learning_test"].bearer_token_env_var, "ENJOY_MCP_TOKEN");
    assert.equal(env.ENJOY_MCP_TOKEN, "fixture-token");
    assert.equal(env.CODEX_CONFIG.includes("fixture-token"), false);
  });

  await test("adds only the explicit app-owned proxy environment to the ACP child", () => {
    const env = buildAcpAdapterEnvironment("claude", executable, [], "unused", {
      provider: "claude",
      executable,
      workspace,
      privateHome,
      signal: new AbortController().signal,
    }, {
      HTTP_PROXY: "http://127.0.0.1:8123",
      HTTPS_PROXY: "http://127.0.0.1:8123",
    });
    assert.equal(env.HTTP_PROXY, "http://127.0.0.1:8123");
    assert.equal(env.HTTPS_PROXY, "http://127.0.0.1:8123");
  });

  await test("passes the configured proxy and loopback bypass through runAcpSession", async () => {
    const result = await run("codex", "proxy-env");
    assert.equal(result.text, "fixture fixture-small:proxy-env");
  });

  await test("streams text and applies an explicit model for Codex ACP", async () => {
    const events = [];
    const result = await run("codex", "hello", { model: "fixture-large", onEvent: (event) => events.push(event) });
    assert.equal(result.text, "fixture fixture-large:hello");
    assert.equal(result.model, "fixture-large");
    assert.deepEqual(result.models.map((model) => model.id), ["fixture-small", "fixture-large"]);
    assert.deepEqual(events.map((event) => event.type), ["started", "text", "text", "completed"]);
  });

  await test("runs the Claude ACP adapter with the default model", async () => {
    const result = await run("claude", "hello");
    assert.equal(result.text, "fixture fixture-small:hello");
    assert.equal(result.model, "fixture-small");
  });

  for (const provider of ["codex", "claude"]) {
    await test(`maps a system prompt to the provider-level role for ${provider}`, async () => {
      const result = await runAcpSession({
        provider,
        executable,
        workspace,
        privateHome,
        prompt: "role-check",
        systemPrompt: "FIXTURE_SYSTEM_ROLE",
        signal: new AbortController().signal,
        timeoutMs: 5_000,
      });
      assert.equal(result.text, "fixture fixture-small:role-check");
    });
  }

  for (const provider of ["codex", "claude"]) {
    await test(`allows one declared Enjoy MCP call and its sparse updates for ${provider}`, async () => {
      const tools = [];
      const result = await run(provider, "allowed-tool", {
        mcp: { url: "http://127.0.0.1:9/mcp", token: "fixture-token" },
        onEvent: (event) => { if (event.type === "tool") tools.push(event.toolName); },
      });
      assert.equal(result.text, "fixture fixture-small:allowed-tool");
      assert.deepEqual(tools, ["enjoy.get_job_context", undefined]);
    });
  }

  for (const prompt of ["foreign-tool", "unknown-tool-update"]) {
    await test(`rejects out-of-scope ACP tool traffic: ${prompt}`, async () => {
      await assert.rejects(run("codex", prompt, {
        mcp: { url: "http://127.0.0.1:9/mcp", token: "fixture-token" },
      }), { code: "native_foreign_tools" });
    });
  }

  for (const provider of ["codex", "claude"]) {
    await test(`does not trust a spoofed display name for ${provider}`, async () => {
      await assert.rejects(run(provider, "spoofed-tool", {
        mcp: { url: "http://127.0.0.1:9/mcp", token: "fixture-token" },
      }), { code: "native_foreign_tools" });
    });
  }

  await test("force-kills an agent that ignores cancellation after a scope violation", async () => {
    const pidFile = path.join(workspace, "ignore-cancel.pid");
    const startedAt = Date.now();
    await assert.rejects(run("codex", "ignore-cancel-foreign", {
      mcp: { url: "http://127.0.0.1:9/mcp", token: "fixture-token" },
    }), { code: "native_foreign_tools" });
    assert.ok(Date.now() - startedAt < 3_000);
    const pid = Number(await readFile(pidFile, "utf8"));
    assert.equal(await waitFor(() => !isAlive(pid)), true);
  });

  await test("force-kills an agent that ignores cancellation after the text limit", async () => {
    const pidFile = path.join(workspace, "ignore-output-cancel.pid");
    const startedAt = Date.now();
    await assert.rejects(run("claude", "ignore-cancel-output"), { code: "native_output_limit" });
    assert.ok(Date.now() - startedAt < 3_000);
    const pid = Number(await readFile(pidFile, "utf8"));
    assert.equal(await waitFor(() => !isAlive(pid)), true);
  });

  await test("rejects unsupported model selection", async () => {
    await assert.rejects(run("codex", "hello", { model: "missing" }), { code: "native_model_unavailable" });
  });

  await test("honors cancellation before process start", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(run("codex", "hello", { signal: controller.signal }), { code: "native_cancelled" });
  });

  await test("cancels during Node preflight without starting an ACP prompt or leaking the probe", async () => {
    const wrapper = path.join(temp, "slow-node.mjs");
    const pidFile = path.join(temp, "slow-node.pid");
    const promptMarker = path.join(workspace, "abort-preflight.prompt-reached");
    await writeFile(wrapper, [
      `#!${process.execPath}`,
      'import { spawn } from "node:child_process";',
      'import { writeFileSync } from "node:fs";',
      `writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
      'if (process.argv[2] === "-p") {',
      '  setTimeout(() => console.log(JSON.stringify({ major: Number(process.versions.node.split(".")[0]) })), 1_000);',
      '} else {',
      `  const child = spawn(${JSON.stringify(process.execPath)}, process.argv.slice(2), { stdio: "inherit" });`,
      '  child.once("exit", (code, signal) => signal ? process.kill(process.pid, signal) : process.exit(code ?? 1));',
      '}',
    ].join("\n"), { mode: 0o755 });
    await chmod(wrapper, 0o755);
    process.env.ENJOY_ACP_NODE_PATH = wrapper;
    const controller = new AbortController();
    const pending = run("claude", "abort-preflight", { signal: controller.signal });
    assert.equal(await waitFor(async () => access(pidFile).then(() => true, () => false)), true);
    controller.abort();
    await assert.rejects(pending, { code: "native_cancelled" });
    const pid = Number(await readFile(pidFile, "utf8"));
    assert.equal(await waitFor(() => !isAlive(pid)), true);
    assert.equal(await access(promptMarker).then(() => true, () => false), false);
    process.env.ENJOY_ACP_NODE_PATH = process.execPath;
  });

  await test("cancels an active ACP prompt and cleans up its child", async () => {
    const controller = new AbortController();
    const pending = run("claude", "wait", {
      signal: controller.signal,
      onEvent: (event) => { if (event.type === "started") controller.abort(); },
    });
    await assert.rejects(pending, { code: "native_cancelled" });
  });

  await test("bounds an agent that never answers session close", async () => {
    const startedAt = Date.now();
    const result = await run("claude", "hang-close");
    assert.equal(result.text, "fixture fixture-small:hang-close");
    assert.ok(Date.now() - startedAt < 4_000);
  });

  console.log(`ACP client checks passed (${completed.length}): ${completed.join("; ")}`);
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await Promise.all([
    rm(temp, { recursive: true, force: true }),
    rm(bundle, { force: true }),
  ]);
}
