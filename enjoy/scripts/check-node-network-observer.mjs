/* global globalThis:readonly */
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-node-network-observer-"));
const receivedPaths = [];
const server = http.createServer((request, response) => {
  receivedPaths.push(request.url);
  response.end("ok");
});
server.on("clientError", (_error, socket) => socket.destroy());

const listen = () => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => resolve());
});
const close = () => new Promise(resolve => server.close(() => resolve()));

try {
  const output = path.join(temp, "observer.mjs");
  await build({
    stdin: {
      contents: [
        'export * from "./src/lib/network-policy.ts";',
        'export * from "./src/main/node-network-observer.ts";',
      ].join("\n"),
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });
  const policy = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
  const dispose = policy.installNodeNetworkObserver();
  const disposeDuplicate = policy.installNodeNetworkObserver();
  const getterDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    policy.NODE_NETWORK_DIAGNOSTICS_GLOBAL,
  );
  assert.equal(getterDescriptor?.writable, false);
  assert.equal(getterDescriptor?.configurable, false);
  assert.equal(getterDescriptor?.enumerable, false);
  assert.equal(typeof getterDescriptor?.value, "function");
  const before = policy.getNetworkPolicyDiagnostics();
  assert.deepEqual(getterDescriptor.value(), before);
  assert.equal(Object.isFrozen(before), true);
  assert.equal(Object.isFrozen(before.observedRequests), true);

  await listen();
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;

  await new Promise((resolve, reject) => {
    http.get(`${origin}/node-http?token=private-query`, {
      headers: { Authorization: "Bearer private-header" },
    }, response => {
      response.resume();
      response.once("end", resolve);
    }).once("error", reject);
  });
  assert.equal(
    await (await fetch(`${origin}/undici?api_key=private-query`, {
      headers: { "x-api-key": "private-header" },
    })).text(),
    "ok",
  );
  await new Promise(resolve => {
    https.get({
      hostname: "127.0.0.1",
      port: address.port,
      path: "/node-https?credential=private-query",
      rejectUnauthorized: false,
      headers: { "x-goog-api-key": "private-header" },
    }).once("error", resolve);
  });

  const afterObserved = policy.getNetworkPolicyDiagnostics();
  assert.equal(afterObserved.observedRequestCount, before.observedRequestCount + 3);
  assert.equal(afterObserved.observedRequests["node:http|127.0.0.1"], 1);
  assert.equal(afterObserved.observedRequests["node:https|127.0.0.1"], 1);
  assert.equal(afterObserved.observedRequests["undici|127.0.0.1"], 1);
  assert.deepEqual(receivedPaths, [
    "/node-http?token=private-query",
    "/undici?api_key=private-query",
  ]);
  assert.doesNotMatch(
    JSON.stringify(afterObserved),
    /private|node-http|node-https|undici\?/u,
  );

  let guardedTransportCalls = 0;
  const guardedFetch = policy.createGuardedFetch(async () => {
    guardedTransportCalls += 1;
    throw new Error("Guarded transport must not run");
  }, { transport: "observer-contract", operation: "blocked-before-egress" });
  const beforeBlocked = policy.getNetworkPolicyDiagnostics();
  await assert.rejects(
    guardedFetch("https://api.enjoy.bot/private?token=do-not-log"),
    error => error.code === "retired_enjoy_host",
  );
  const afterBlocked = policy.getNetworkPolicyDiagnostics();
  assert.equal(guardedTransportCalls, 0);
  assert.equal(afterBlocked.blockedAttemptCount, beforeBlocked.blockedAttemptCount + 1);
  assert.equal(afterBlocked.observedRequestCount, beforeBlocked.observedRequestCount);

  disposeDuplicate();
  dispose();
  await new Promise((resolve, reject) => {
    http.get(`${origin}/after-dispose`, response => {
      response.resume();
      response.once("end", resolve);
    }).once("error", reject);
  });
  assert.equal(
    policy.getNetworkPolicyDiagnostics().observedRequestCount,
    afterBlocked.observedRequestCount,
  );

  console.info(
    "check-node-network-observer: PASS (local Node HTTP/HTTPS/undici observation and blocked pre-egress separation)",
  );
} finally {
  await close().catch(() => undefined);
  await rm(temp, { recursive: true, force: true });
}
