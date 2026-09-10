#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

if (process.env.ENJOY_RUN_NATIVE_PROXY_ACTUAL !== "1") {
  console.error("Set ENJOY_RUN_NATIVE_PROXY_ACTUAL=1 for the bounded installed-binary probe.");
  process.exit(2);
}

const enjoyRoot = path.resolve(import.meta.dirname, "..");
const receiptDirectory = path.join(enjoyRoot, "tmp/network-transport-controls/2026-09-09");
const receiptPath = path.join(receiptDirectory, "native-agent-proxy-receipt.json");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-native-proxy-actual-"));
const workspace = path.join(temp, "workspace");
const privateHome = path.join(temp, "private-home");
const bundle = path.join(temp, "native-proxy.mjs");
const sandboxWrapper = path.join(temp, "sandbox-wrapper.mjs");
const requests = [];
const mcpRequests = [];
const fixtureMcpToken = "fixture-loopback-token-not-persisted";

const commandPath = async (name) => {
  const found = spawnSync("/usr/bin/which", [name], { encoding: "utf8" }).stdout.trim();
  assert(found, `${name} is not installed`);
  return realpath(found);
};
const sha256 = async (filePath) => createHash("sha256").update(await readFile(filePath)).digest("hex");
const summarize = (rows) => Object.entries(rows.reduce((counts, row) => {
  const key = `${row.method} ${row.hostname}:${row.port}`;
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {})).map(([target, count]) => ({ target, count }));

await Promise.all([mkdir(workspace), mkdir(privateHome), mkdir(receiptDirectory, { recursive: true })]);
await writeFile(sandboxWrapper, `#!${process.execPath}
import { spawn } from "node:child_process";
const child = spawn("/usr/bin/sandbox-exec", process.argv.slice(2), { stdio: ["ignore", "inherit", "inherit"] });
child.once("error", () => process.exit(127));
child.once("exit", (code, signal) => signal ? process.kill(process.pid, signal) : process.exit(code ?? 1));
`, { mode: 0o755 });
await build({
  stdin: {
    contents: [
      'export { AgentProcessManager, pinExecutable } from "./src/main/agents/process-manager";',
      'export { nativeProxyEnvironmentFor } from "./src/main/agents/proxy-environment";',
    ].join("\n"),
    resolveDir: enjoyRoot,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: bundle,
  logLevel: "silent",
  plugins: [{
    name: "fixture-settings",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@main\/settings$/u }, () => ({ path: "fixture-settings", namespace: "fixture" }));
      buildApi.onLoad({ filter: /.*/u, namespace: "fixture" }, () => ({
        contents: 'export default { getSync: () => { throw new Error("unexpected settings read"); } };',
        loader: "js",
      }));
    },
  }],
});

const server = http.createServer((request, response) => {
  const parsed = new URL(request.url || "/", "http://loopback.invalid");
  requests.push({ method: request.method || "GET", hostname: parsed.hostname, port: Number(parsed.port || 80) });
  request.resume();
  response.writeHead(502).end();
});
server.on("connect", (request, socket) => {
  const match = /^(.*):(\d+)$/u.exec(request.url || "");
  requests.push({ method: "CONNECT", hostname: match?.[1] || "invalid", port: Number(match?.[2] || 0) });
  socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const mcpServer = http.createServer((request, response) => {
  mcpRequests.push({
    method: request.method || "GET",
    path: new URL(request.url || "/", "http://127.0.0.1").pathname,
    fixtureAuthorization: request.headers.authorization === `Bearer ${fixtureMcpToken}`,
  });
  request.resume();
  response.writeHead(404).end();
});
await new Promise((resolve) => mcpServer.listen(0, "127.0.0.1", resolve));

try {
  const address = server.address();
  assert(address && typeof address !== "string");
  const mcpAddress = mcpServer.address();
  assert(mcpAddress && typeof mcpAddress !== "string");
  const proxyUrl = `http://127.0.0.1:${address.port}`;
  const { AgentProcessManager, nativeProxyEnvironmentFor, pinExecutable } = await import(pathToFileURL(bundle));
  const environment = nativeProxyEnvironmentFor({ enabled: true, url: proxyUrl });
  const sandboxExecutable = await pinExecutable(sandboxWrapper, { jobRoot: workspace });
  const profile = `(version 1) (allow default) (deny network*) (allow network-outbound (remote ip "localhost:${address.port}")) (allow network-outbound (remote ip "localhost:${mcpAddress.port}"))`;
  const binaries = {
    codex: await commandPath("codex"),
    claude: await commandPath("claude"),
  };
  const claudeMcpConfig = path.join(temp, "claude-mcp.json");
  const claudeSettings = path.join(temp, "claude-settings.json");
  await Promise.all([
    writeFile(claudeMcpConfig, `${JSON.stringify({ mcpServers: {
      enjoy_fixture: {
        type: "http",
        url: `http://127.0.0.1:${mcpAddress.port}/mcp`,
        headers: { Authorization: `Bearer ${fixtureMcpToken}` },
      },
    } })}\n`, { mode: 0o600 }),
    writeFile(claudeSettings, "{}\n", { mode: 0o600 }),
  ]);
  const results = {};

  for (const [provider, binary] of Object.entries(binaries)) {
    const manager = new AgentProcessManager({
      jobRoot: workspace,
      isolatedHome: privateHome,
      authMode: provider === "codex" ? "existing-codex" : "existing-claude",
    });
    const before = requests.length;
    const beforeMcp = mcpRequests.length;
    const args = provider === "codex"
      ? [
        "-p", profile, binary, "exec", "--skip-git-repo-check", "--json", "--sandbox", "read-only",
        "-c", 'web_search="disabled"',
        "-c", `mcp_servers.enjoy_fixture.url="http://127.0.0.1:${mcpAddress.port}/mcp"`,
        "-c", 'mcp_servers.enjoy_fixture.bearer_token_env_var="ENJOY_MCP_TOKEN"',
        "Say fixture.",
      ]
      : [
        "-p", profile, binary, "-p", "Say fixture.", "--output-format", "stream-json", "--verbose",
        "--mcp-config", claudeMcpConfig, "--strict-mcp-config", "--settings", claudeSettings,
      ];
    const result = await manager.run({
      executable: sandboxExecutable,
      args,
      cwd: workspace,
      env: { ...environment, ...(provider === "codex" ? { ENJOY_MCP_TOKEN: fixtureMcpToken } : {}) },
      timeoutMs: 8_000,
      maxOutputBytes: 2 * 1_048_576,
    });
    await manager.shutdown();
    const providerRequests = requests.slice(before);
    const providerMcpRequests = mcpRequests.slice(beforeMcp);
    assert(providerRequests.length > 0, `${provider} did not route through the loopback proxy: ${JSON.stringify(result)}`);
    assert(providerMcpRequests.some((request) => request.fixtureAuthorization), `${provider} did not contact loopback MCP with scoped authorization`);
    assert.equal(result.groupCleanupVerified, true);
    results[provider] = {
      actualInstalledBinary: true,
      binaryRealpath: binary,
      binarySha256: await sha256(binary),
      processResult: { reason: result.reason, exitCode: result.exitCode, groupCleanupVerified: result.groupCleanupVerified },
      proxyReceipts: summarize(providerRequests),
      loopbackMcpReceipts: providerMcpRequests.map(({ method, path, fixtureAuthorization }) => ({ method, path, fixtureAuthorization })),
    };
  }
  assert(mcpRequests.length >= 2, "Both installed CLIs must contact the configured loopback MCP server");
  assert.equal(requests.some((request) => request.hostname === "127.0.0.1" || request.hostname === "localhost"), false);

  const retiredManager = new AgentProcessManager({ jobRoot: workspace, isolatedHome: privateHome });
  const beforeRetired = requests.length;
  const retired = await retiredManager.run({
    executable: sandboxExecutable,
    args: ["-p", profile, "/usr/bin/true"],
    cwd: workspace,
    env: { HTTP_PROXY: "http://proxy.enjoy.bot:8080" },
  });
  await retiredManager.shutdown();
  assert.equal(retired.reason, "spawn_failed");
  assert.equal(retired.errorCode, "retired_enjoy_host");
  assert.equal(requests.length, beforeRetired);

  await writeFile(receiptPath, `${JSON.stringify({
    schemaVersion: 1,
    scope: "Installed Codex and Claude CLI proxy routing under a process-local outbound sandbox",
    productionPath: "nativeProxyEnvironmentFor -> AgentProcessManager -> installed CLI descendant",
    controls: {
      loopbackProxy: true,
      proxyExternalForwarding: false,
      processSandboxDeniedAllNonLoopbackOutbound: true,
      tlsInterception: false,
      inferenceResponseReceived: false,
      sensitiveOutputPersisted: false,
    },
    positive: results,
    loopbackMcpBypass: {
      directRequestCount: mcpRequests.length,
      methodsAndPaths: mcpRequests.map(({ method, path }) => ({ method, path })),
      scopedAuthorizationObservedDirectly: mcpRequests.some((request) => request.fixtureAuthorization),
      proxySawLoopbackMcpRequest: false,
      tokenPersisted: false,
    },
    negative: {
      retiredProxyRejectedBeforeSpawn: true,
      retiredProxyProducedNoReceipt: true,
    },
    limitation: "The probe uses sandbox-exec as the pinned manager child so the installed CLI descendant cannot bypass the loopback-only network boundary.",
  }, null, 2)}\n`, { mode: 0o600 });
  console.log(receiptPath);
} finally {
  await Promise.all([
    new Promise((resolve) => server.close(resolve)),
    new Promise((resolve) => mcpServer.close(resolve)),
  ]);
  await rm(temp, { recursive: true, force: true });
}
