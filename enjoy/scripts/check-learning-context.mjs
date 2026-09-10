#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-learning-context-check-"));
const bundle = path.join(temp, "learning-context.mjs");
const electronStub = path.join(temp, "electron-stub.mjs");
const controllerStub = path.join(temp, "controller-stub.mjs");
const passed = [];

const check = async (name, action) => {
  await action();
  passed.push(name);
};

const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const expectMessage = async (action, message) => {
  await assert.rejects(action, error => error?.message === message, `expected error message ${message}`);
};

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
};

const makeRuntime = ({ profileId, connectionId, capabilities, healthError = null }) => {
  const gates = [];
  const calls = { capabilities: 0, assertOpen: 0 };
  let open = true;
  const runtime = {
    scope: {
      context: { profileId, connectionId },
      assertOpen: () => {
        calls.assertOpen += 1;
        if (!open) throw Object.assign(new Error("profile_closed"), { code: "profile_closed" });
      },
    },
    generation: {
      capabilities: async () => {
        calls.capabilities += 1;
        const result = capabilities.map(capability => ({ ...capability }));
        const gate = gates.shift();
        if (gate) await gate;
        return result;
      },
    },
    healthError,
  };
  return {
    runtime,
    calls,
    gates,
    close: () => { open = false; },
  };
};

const makeEvent = ({ senderId = 42, url = "https://enjoy.test/learning", destroyed = false } = {}) => {
  const frame = { url, routingId: 1, parent: null };
  frame.top = frame;
  const sender = {
    id: senderId,
    mainFrame: frame,
    isDestroyed: () => destroyed,
  };
  return { sender, senderFrame: frame };
};

const uncheckedCapabilities = [
  { provider: "codex", text: false, image: false, reason: "native_not_checked" },
  { provider: "claude", text: false, image: false, reason: "native_not_checked" },
  { provider: "azure-openai", text: false, image: false, reason: "native_not_checked" },
];
const codexCapabilities = [
  { provider: "codex", text: true, image: false, reason: null },
  { provider: "claude", text: false, image: false, reason: "native_missing" },
];
const freshProfileCapabilities = [
  { provider: "codex", text: false, image: true, reason: null },
  { provider: "claude", text: true, image: false, reason: null },
];

try {
  await writeFile(electronStub, `
    const handlers = new Map();
    export const ipcMain = {
      removeHandler(channel) { handlers.delete(channel); },
      handle(channel, handler) { handlers.set(channel, handler); },
    };
    export const getHandlers = () => handlers;
  `);
  await writeFile(controllerStub, `
    export class LearningController {
      constructor(runtime) { this.runtime = runtime; }
      request() { throw Object.assign(new Error("fixture_controller_not_expected"), { code: "fixture_controller_not_expected" }); }
    }
  `);

  await build({
    stdin: {
      contents: `
        export { registerLearningIpc } from "./src/main/learning/ipc.ts";
        export { getHandlers } from "electron";
      `,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: bundle,
    logLevel: "silent",
    plugins: [{
      name: "learning-context-fixtures",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^electron$/ }, () => ({ path: electronStub }));
        buildApi.onResolve({ filter: /(?:^|\/)controller$/ }, () => ({ path: controllerStub }));
      },
    }],
  });

  const { getHandlers, registerLearningIpc } = await import(`${pathToFileURL(bundle).href}?check=${Date.now()}`);
  const initial = makeRuntime({
    profileId: "profile-one",
    connectionId: "connection-one",
    capabilities: codexCapabilities,
    healthError: "fixture_health_warning",
  });
  let currentRuntime = initial.runtime;
  const window = {
    webContents: { id: 42 },
  };
  registerLearningIpc(window, "https://enjoy.test/learning", () => currentRuntime);
  const contextHandler = getHandlers().get("learning-context");
  assert.equal(typeof contextHandler, "function");

  await check("returns cheap unchecked capabilities without probing native providers", async () => {
    const context = await contextHandler(makeEvent());
    assert.deepEqual(context, {
      profileId: "profile-one",
      connectionId: "connection-one",
      capabilities: uncheckedCapabilities,
      healthError: "fixture_health_warning",
    });
    assert.equal(initial.calls.capabilities, 0);
  });

  await check("rejects malformed refresh options before capability access", async () => {
    for (const options of [
      null,
      [],
      { refreshCapabilities: "true" },
      { refreshCapabilities: true, unexpected: false },
      { unexpected: true },
    ]) {
      await expectMessage(() => contextHandler(makeEvent(), options), "learning_request_invalid");
    }
    assert.equal(initial.calls.capabilities, 0);
  });

  await check("awaits explicit capability refresh and caches it per runtime", async () => {
    const gate = deferred();
    initial.gates.push(gate.promise);
    let settled = false;
    const pending = contextHandler(makeEvent(), { refreshCapabilities: true }).then((value) => {
      settled = true;
      return value;
    });
    await waitFor(() => initial.calls.capabilities === 1, "explicit capability probe");
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(settled, false);
    gate.resolve();
    const refreshed = await pending;
    assert.deepEqual(refreshed.capabilities, codexCapabilities);
    assert.equal(initial.calls.capabilities, 1);

    const cached = await contextHandler(makeEvent());
    assert.deepEqual(cached.capabilities, codexCapabilities);
    assert.equal(initial.calls.capabilities, 1);
  });

  await check("keeps the newest same-runtime capability refresh in cache", async () => {
    const mutableCapabilities = codexCapabilities.map(capability => ({ ...capability }));
    const sameRuntime = makeRuntime({
      profileId: "profile-one",
      connectionId: "same-runtime-race",
      capabilities: mutableCapabilities,
    });
    currentRuntime = sameRuntime.runtime;
    const staleGate = deferred();
    sameRuntime.gates.push(staleGate.promise);
    const stale = contextHandler(makeEvent(), { refreshCapabilities: true });
    await waitFor(() => sameRuntime.calls.capabilities === 1, "stale same-runtime probe");
    mutableCapabilities.splice(0, mutableCapabilities.length, ...freshProfileCapabilities.map(capability => ({ ...capability })));
    const fresh = await contextHandler(makeEvent(), { refreshCapabilities: true });
    assert.deepEqual(fresh.capabilities, freshProfileCapabilities);
    staleGate.resolve();
    assert.deepEqual((await stale).capabilities, codexCapabilities, "the original caller still receives its own snapshot");
    const cached = await contextHandler(makeEvent());
    assert.deepEqual(cached.capabilities, freshProfileCapabilities, "late stale completion must not overwrite the newest cache");
    currentRuntime = initial.runtime;
  });

  await check("does not cache a pending result after the runtime changes", async () => {
    const replacement = makeRuntime({
      profileId: "profile-one",
      connectionId: "connection-two",
      capabilities: freshProfileCapabilities,
    });
    const gate = deferred();
    initial.gates.push(gate.promise);
    currentRuntime = initial.runtime;
    const pending = contextHandler(makeEvent(), { refreshCapabilities: true });
    await waitFor(() => initial.calls.capabilities === 2, "second capability probe");
    currentRuntime = replacement.runtime;
    gate.resolve();
    await expectMessage(() => pending, "profile_changed");

    const newContext = await contextHandler(makeEvent());
    assert.equal(newContext.profileId, "profile-one");
    assert.equal(newContext.connectionId, "connection-two");
    assert.deepEqual(newContext.capabilities, uncheckedCapabilities);
    assert.equal(replacement.calls.capabilities, 0);

    const refreshed = await contextHandler(makeEvent(), { refreshCapabilities: true });
    assert.deepEqual(refreshed.capabilities, freshProfileCapabilities);
    assert.equal(replacement.calls.capabilities, 1);
    const replacementCached = await contextHandler(makeEvent());
    assert.deepEqual(replacementCached.capabilities, freshProfileCapabilities);
    assert.equal(replacement.calls.capabilities, 1);
  });

  await check("rejects a closed runtime before reading or caching capabilities", async () => {
    const closed = makeRuntime({
      profileId: "profile-closed",
      connectionId: "connection-closed",
      capabilities: codexCapabilities,
    });
    currentRuntime = closed.runtime;
    closed.close();
    await expectMessage(() => contextHandler(makeEvent()), "profile_closed");
    await expectMessage(() => contextHandler(makeEvent(), { refreshCapabilities: true }), "profile_closed");
    assert.equal(closed.calls.capabilities, 0);
  });

  await check("rejects a foreign renderer before touching the runtime", async () => {
    currentRuntime = initial.runtime;
    const before = initial.calls.assertOpen;
    await expectMessage(() => contextHandler(makeEvent({ senderId: 99 })), "learning_ipc_sender_denied");
    assert.equal(initial.calls.assertOpen, before);
  });

  console.log(`Learning context checks passed (${passed.length}): ${passed.join("; ")}`);
} finally {
  await Promise.all([
    rm(temp, { recursive: true, force: true }),
    rm(bundle, { force: true }),
  ]);
}
