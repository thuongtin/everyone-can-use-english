#!/usr/bin/env node

import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const enjoyRoot = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-native-proxy-"));
const workspace = path.join(temp, "workspace");
const privateHome = path.join(temp, "private-home");
const fixture = path.join(temp, "proxy-child.mjs");
const bundle = path.join(temp, "process-manager.mjs");
const proxyBundle = path.join(temp, "proxy-environment.mjs");
const received = [];

await Promise.all([mkdir(workspace), mkdir(privateHome)]);
await writeFile(fixture, `#!${process.execPath}
import http from "node:http";
import { writeFileSync } from "node:fs";
writeFileSync("proxy-child-spawned", String(process.pid));
const proxyKeys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"];
const presentProxyKeys = proxyKeys.filter((key) => process.env[key] !== undefined);
const proxy = process.env.HTTP_PROXY;
if (!proxy) {
  console.log(JSON.stringify({ proxy: presentProxyKeys.length ? "unexpected-proxy" : "missing", proxyKeys: presentProxyKeys }));
  process.exit(0);
}
if (proxy.includes("enjoy.bot")) {
  console.log(JSON.stringify({ proxy: "retired-reached-child" }));
  process.exit(0);
}
const endpoint = new URL(proxy);
const request = http.request({
  hostname: endpoint.hostname,
  port: endpoint.port,
  method: "GET",
  path: "http://native.fixture.invalid/probe",
  headers: { host: "native.fixture.invalid" },
}, (response) => {
  response.resume();
  response.once("end", () => console.log(JSON.stringify({ proxy: "received", status: response.statusCode, proxyKeys: presentProxyKeys.sort() })));
});
request.once("error", () => process.exit(2));
request.end();
`, { mode: 0o755 });
await chmod(fixture, 0o755);

await build({
  stdin: {
    contents: 'export { AgentProcessManager, pinExecutable } from "./src/main/agents/process-manager";',
    resolveDir: enjoyRoot,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: bundle,
  logLevel: "silent",
});
await build({
  stdin: {
    contents: 'export { nativeProxyEnvironmentFor } from "./src/main/agents/proxy-environment";',
    resolveDir: enjoyRoot,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: proxyBundle,
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
  received.push({ method: request.method, url: request.url, host: request.headers.host });
  request.resume();
  response.writeHead(502).end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

try {
  const address = server.address();
  assert(address && typeof address !== "string");
  const proxyUrl = `http://127.0.0.1:${address.port}`;
  const { AgentProcessManager, pinExecutable } = await import(pathToFileURL(bundle));
  const { nativeProxyEnvironmentFor } = await import(pathToFileURL(proxyBundle));
  const configured = nativeProxyEnvironmentFor({ enabled: true, url: proxyUrl });
  assert.equal(configured.HTTP_PROXY, `${proxyUrl}/`);
  assert.equal(configured.HTTPS_PROXY, `${proxyUrl}/`);
  assert.equal(configured.NO_PROXY, "localhost,127.0.0.1,::1,[::1]");
  assert.equal(configured.no_proxy, configured.NO_PROXY);
  assert.deepEqual(nativeProxyEnvironmentFor({ enabled: false, url: proxyUrl }), {});
  assert.throws(
    () => nativeProxyEnvironmentFor({ enabled: true, url: "http://proxy.enjoy.bot:8080" }),
    (error) => error?.code === "retired_enjoy_host",
  );
  const executable = await pinExecutable(fixture, { jobRoot: workspace });
  const messages = [];
  const manager = new AgentProcessManager({ jobRoot: workspace, isolatedHome: privateHome });

  const proxyKeys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"];
  const previousAmbient = Object.fromEntries(proxyKeys.map((key) => [key, process.env[key]]));
  for (const key of proxyKeys) process.env[key] = key.toLowerCase() === "no_proxy" ? "ambient.invalid" : proxyUrl;
  try {
    const ambient = await manager.run({ executable, cwd: workspace, onMessage: (message) => messages.push(message) });
    assert.equal(ambient.reason, "completed");
    assert.deepEqual(messages.shift(), { proxy: "missing", proxyKeys: [] });
    assert.equal(received.length, 0);
  } finally {
    for (const [key, value] of Object.entries(previousAmbient)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  const explicitEnvironment = Object.fromEntries(proxyKeys.map((key) => [
    key,
    key.toLowerCase() === "no_proxy" ? "localhost,127.0.0.1,::1,[::1]" : proxyUrl,
  ]));
  const explicit = await manager.run({
    executable,
    cwd: workspace,
    env: explicitEnvironment,
    onMessage: (message) => messages.push(message),
  });
  assert.equal(explicit.reason, "completed");
  assert.deepEqual(messages.shift(), { proxy: "received", status: 502, proxyKeys: [...proxyKeys].sort() });
  assert.deepEqual(received, [{ method: "GET", url: "http://native.fixture.invalid/probe", host: "native.fixture.invalid" }]);

  const beforeRetired = received.length;
  const spawnMarker = path.join(workspace, "proxy-child-spawned");
  await rm(spawnMarker, { force: true });
  const proxyUrlKeys = proxyKeys.filter((key) => key.toLowerCase() !== "no_proxy");
  const retiredHosts = ["proxy.enjoy.bot", "api.getenjoyapp.com", "enjoy-storage.baizhiheizi.com"];
  for (const [index, key] of proxyUrlKeys.entries()) {
    const retired = await manager.run({
      executable,
      cwd: workspace,
      env: { [key]: `http://${retiredHosts[index % retiredHosts.length]}:8080` },
      onMessage: (message) => messages.push(message),
    });
    assert.equal(retired.reason, "spawn_failed");
    assert.equal(retired.errorCode, "retired_enjoy_host");
    await assert.rejects(access(spawnMarker));
  }
  assert.equal(received.length, beforeRetired);
  assert.equal(messages.length, 0);

  await manager.shutdown();
  console.log("PASS: all eight ambient proxy keys excluded, all eight explicit keys reach child, retired root and aliases rejected before spawn");
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
