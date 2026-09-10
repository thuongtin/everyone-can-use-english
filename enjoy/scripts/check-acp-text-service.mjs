#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-acp-text-service-check-"));
const bundle = path.join(root, ".acp-text-service-check.mjs");
const electronStub = path.join(temp, "electron-stub.mjs");
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

const expectCode = async (action, code) => {
  await assert.rejects(action, error => error?.code === code, `expected error code ${code}`);
};

const uuid = (suffix) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const request = (requestId, overrides = {}) => ({
  requestId,
  provider: "codex",
  messages: [{ role: "user", content: "hello" }],
  ...overrides,
});

const executable = Object.freeze({
  path: "/fixture/acp-node",
  realpath: "/fixture/acp-node",
  sha256: "0".repeat(64),
  size: 1,
  mtimeMs: 1,
});

const probeFor = (provider) => ({
  provider,
  executable,
  version: "fixture-1",
  authenticated: true,
  text: true,
  image: false,
  reason: null,
});

class FixtureAdapter {
  constructor(provider, plans, calls) {
    this.provider = provider;
    this.plans = plans;
    this.calls = calls;
    this.pending = [];
  }

  run(request) {
    const plan = this.plans.shift() || { kind: "success", text: "fixture default" };
    const call = { provider: this.provider, ...request, plan };
    this.calls.push(call);
    const emit = (event) => request.onEvent?.(event);
    emit({ type: "started" });

    if (plan.kind === "success") {
      for (const text of plan.chunks || [plan.text]) emit({ type: "text", text });
      return Promise.resolve({
        provider: this.provider,
        text: plan.text,
        images: [],
        model: plan.model ?? request.model ?? "fixture-default",
      });
    }

    if (plan.kind === "failure") {
      const error = Object.assign(new Error(plan.code || "native_fixture_failed"), {
        code: plan.code || "native_fixture_failed",
      });
      if (plan.cleanup) error.cleanup = plan.cleanup;
      return Promise.reject(error);
    }

    if (plan.kind !== "pending") throw new Error(`Unknown fixture plan: ${plan.kind}`);

    return new Promise((resolve, reject) => {
      const entry = { call, plan, resolve, reject, aborted: false };
      this.pending.push(entry);
      request.signal.addEventListener("abort", () => {
        if (entry.aborted) return;
        entry.aborted = true;
        if (plan.lateText) emit({ type: "text", text: plan.lateText });
        reject(Object.assign(new Error(plan.abortCode || "native_cancelled"), {
          code: plan.abortCode || "native_cancelled",
        }));
      }, { once: true });
    });
  }
}

const makeSenderEvent = ({ id = 73, url = "https://enjoy.test/learning", destroyed = false } = {}) => {
  const frame = { url, routingId: 19, parent: null };
  frame.top = frame;
  const sender = {
    id,
    mainFrame: frame,
    isDestroyed: () => destroyed,
    send: () => undefined,
  };
  return { sender, senderFrame: frame };
};

const inspectionFor = (provider) => ({
  probe: probeFor(provider),
  models: [{ id: "fixture-small", name: "Fixture Small" }],
  currentModel: "fixture-small",
});

const makePendingInspect = () => {
  const calls = [];
  const pending = new Map();
  const aborts = [];
  const inspect = async (provider, options = {}) => {
    calls.push({ provider, signal: options.signal });
    return new Promise((resolve, reject) => {
      pending.set(provider, { resolve, reject });
      const onAbort = () => aborts.push(provider);
      if (options.signal?.aborted) onAbort();
      else options.signal?.addEventListener("abort", onAbort, { once: true });
    });
  };
  const release = (provider, result = inspectionFor(provider)) => pending.get(provider)?.resolve(result);
  return { inspect, calls, pending, aborts, release };
};

try {
  await writeFile(electronStub, `
    const handlers = new Map();
    export const ipcMain = {
      removeHandler(channel) { handlers.delete(channel); },
      handle(channel, handler) { handlers.set(channel, handler); },
    };
    export const getHandlers = () => handlers;
  `);

  await build({
    stdin: {
      contents: `
        export { AcpTextService } from "./src/main/agents/acp-text-service.ts";
        export { NativeAgentError } from "./src/main/agents/native-types.ts";
        export { LearningProfileScope } from "./src/main/learning/profile-scope.ts";
        export { assertLearningContext, createLearningIpcGuard } from "./src/main/learning/ipc-guard.ts";
        export { registerAcpIpc } from "./src/main/agents/acp-ipc.ts";
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
      name: "electron-fixture",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^electron$/ }, () => ({ path: electronStub }));
      },
    }],
  });

  const {
    AcpTextService,
    NativeAgentError,
    LearningProfileScope,
    assertLearningContext,
    createLearningIpcGuard,
    getHandlers,
    registerAcpIpc,
  } = await import(`${pathToFileURL(bundle).href}?check=${Date.now()}`);

  const plans = [];
  const calls = [];
  const codex = new FixtureAdapter("codex", plans, calls);
  const claude = new FixtureAdapter("claude", plans, calls);
  const inspected = [];
  const statusSignals = [];
  const service = new AcpTextService({
    adapters: { codex, claude },
    probe: async (provider) => probeFor(provider),
    inspect: async (provider, options = {}) => {
      inspected.push(provider);
      statusSignals.push(options.signal);
      if (provider === "claude") throw new Error("fixture inspection failure with secret");
      return inspectionFor(provider);
    },
  });

  const assetRoot = path.join(temp, "profile-assets");
  const scope = new LearningProfileScope("profile-one", assetRoot);
  const runtime = { scope };

  await check("status reports inspected models and sanitizes provider probe failures", async () => {
    const statuses = await service.status();
    assert.deepEqual(statuses, [
      {
        provider: "codex",
        available: true,
        reason: null,
        models: [{ id: "fixture-small", name: "Fixture Small" }],
        currentModel: "fixture-small",
      },
      {
        provider: "claude",
        available: false,
        reason: "native_probe_failed",
        models: [],
        currentModel: null,
      },
    ]);
    assert.deepEqual(inspected, ["codex", "claude"]);
    assert.equal(statusSignals.length, 2);
    assert(statusSignals.every(signal => signal instanceof AbortSignal));
    assert(statusSignals.every(signal => !signal.aborted));
  });

  await check("deduplicates in-flight status inspections for both providers", async () => {
    const statusScope = new LearningProfileScope("status-dedupe", path.join(temp, "status-dedupe"));
    const statusRuntime = { scope: statusScope };
    const fixture = makePendingInspect();
    const statusService = new AcpTextService({ inspect: fixture.inspect });
    const first = statusService.status(statusRuntime);
    const second = statusService.status(statusRuntime);
    await waitFor(() => fixture.calls.length === 2, "deduplicated provider inspections");
    assert.deepEqual(fixture.calls.map(call => call.provider).sort(), ["claude", "codex"]);
    assert(fixture.calls.every(call => call.signal instanceof AbortSignal && !call.signal.aborted));
    fixture.release("codex");
    fixture.release("claude");
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.deepEqual(secondResult, firstResult);
    assert.equal(fixture.calls.length, 2);
    await statusScope.quiesce();
  });

  await check("service close aborts and awaits in-flight status inspections", async () => {
    const statusScope = new LearningProfileScope("status-close", path.join(temp, "status-close"));
    const statusRuntime = { scope: statusScope };
    const fixture = makePendingInspect();
    const statusService = new AcpTextService({ inspect: fixture.inspect });
    const status = statusService.status(statusRuntime);
    await waitFor(() => fixture.calls.length === 2, "status-close provider inspections");
    let closeSettled = false;
    const closing = statusService.close().then(() => { closeSettled = true; });
    await waitFor(() => fixture.aborts.length === 2, "status-close abort signals");
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(closeSettled, false);
    fixture.release("codex");
    fixture.release("claude");
    await closing;
    await status;
    assert.equal(closeSettled, true);
    assert(fixture.calls.every(call => call.signal.aborted));
    await statusScope.quiesce();
  });

  await check("profile quiesce aborts and awaits status inspections", async () => {
    const statusScope = new LearningProfileScope("status-profile-close", path.join(temp, "status-profile-close"));
    const statusRuntime = { scope: statusScope };
    const fixture = makePendingInspect();
    const statusService = new AcpTextService({ inspect: fixture.inspect });
    const status = statusService.status(statusRuntime);
    await waitFor(() => fixture.calls.length === 2, "profile-quiesce provider inspections");
    let quiesceSettled = false;
    const quiescing = statusScope.quiesce().then(() => { quiesceSettled = true; });
    await waitFor(() => fixture.aborts.length === 2, "profile-quiesce abort signals");
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(quiesceSettled, false);
    fixture.release("codex");
    fixture.release("claude");
    await quiescing;
    await status;
    assert.equal(statusScope.state, "closed");
    assert.equal(quiesceSettled, true);
  });

  await check("retains failed inspection cleanup for a later successful retry", async () => {
    const statusScope = new LearningProfileScope("status-cleanup-retry", path.join(temp, "status-cleanup-retry"));
    const statusRuntime = { scope: statusScope };
    let cleanupAttempts = 0;
    const cleanup = async () => {
      cleanupAttempts += 1;
      if (cleanupAttempts === 1) throw new Error("fixture cleanup failure");
    };
    const statusService = new AcpTextService({
      inspect: async (provider) => {
        if (provider === "codex") throw new NativeAgentError("native_probe_failed", cleanup);
        return inspectionFor(provider);
      },
    });
    const statuses = await statusService.status(statusRuntime);
    assert.equal(statuses.find(status => status.provider === "codex")?.reason, "native_cleanup_failed");
    await expectCode(() => statusScope.quiesce(), "profile_quiesce_failed");
    assert.equal(statusScope.state, "closing");
    assert.equal(cleanupAttempts, 1);
    await statusScope.quiesce();
    assert.equal(statusScope.state, "closed");
    assert.equal(cleanupAttempts, 2);
    await statusService.close();
  });

  await check("strictly rejects malformed ACP requests before adapter access", async () => {
    const invalid = [
      null,
      request("bad-id"),
      { ...request(uuid(1)), extra: true },
      request(uuid(2), { model: "   " }),
      request(uuid(3), { model: "m".repeat(201) }),
      request(uuid(4), { messages: [] }),
      request(uuid(5), { messages: [{ role: "tool", content: "bad" }] }),
      request(uuid(6), { messages: [{ role: "user", content: "" }] }),
      request(uuid(7), { messages: [{ role: "user", content: "hello", extra: true }] }),
      request(uuid(8), { messages: Array.from({ length: 101 }, () => ({ role: "user", content: "x" })) }),
      request(uuid(9), { messages: [{ role: "user", content: "a".repeat(120_000) }, { role: "user", content: "b" }] }),
    ];
    for (const value of invalid) await expectCode(() => service.invoke(runtime, value, () => undefined), "acp_request_invalid");
    assert.equal(calls.length, 0);
  });

  await check("streams ordered updates and removes the private job directory", async () => {
    const id = uuid(10);
    plans.push({ kind: "success", text: "fixture answer", chunks: ["fixture ", "answer"], model: "fixture-large" });
    const updates = [];
    const result = await service.invoke(runtime, request(id, {
      model: "fixture-large",
      messages: [
        { role: "system", content: "SYSTEM_SECRET must stay in systemPrompt" },
        { role: "user", content: "hello user" },
        { role: "assistant", content: "prior assistant answer" },
      ],
    }), update => updates.push(update));
    assert.deepEqual(result, { text: "fixture answer", model: "fixture-large" });
    assert.deepEqual(updates, [
      { requestId: id, type: "started" },
      { requestId: id, type: "text", text: "fixture " },
      { requestId: id, type: "text", text: "answer" },
      { requestId: id, type: "completed" },
    ]);
    const call = calls.at(-1);
    assert.equal(call.timeoutMs, 300_000);
    assert.equal(call.model, "fixture-large");
    assert.notEqual(call.workspace, call.privateHome);
    assert.equal(call.systemPrompt, "SYSTEM_SECRET must stay in systemPrompt");
    assert.match(call.prompt, /Do not use files, terminals, external tools, or MCP servers/);
    assert.doesNotMatch(call.prompt, /SYSTEM_SECRET/);
    const conversation = JSON.parse(call.prompt.split("\n").at(-1));
    assert.deepEqual(conversation, [
      { role: "user", content: "hello user" },
      { role: "assistant", content: "prior assistant answer" },
    ]);
    assert(conversation.every(message => message.role === "user" || message.role === "assistant"));
    assert.equal(existsSync(path.dirname(call.workspace)), false);
  });

  await check("rejects duplicate requests and cancels with cleanup and no late text", async () => {
    const id = uuid(11);
    const updates = [];
    const callIndex = calls.length;
    plans.push({ kind: "pending", lateText: "late text after cancellation" });
    const invocation = service.invoke(runtime, request(id), update => updates.push(update));
    const invocationRejection = expectCode(() => invocation, "native_cancelled");
    await waitFor(() => calls.length > callIndex, "pending ACP adapter");
    await expectCode(() => service.invoke(runtime, request(id), () => undefined), "acp_request_busy");
    const call = calls[callIndex];
    await service.cancel(id);
    await invocationRejection;
    assert.deepEqual(updates, [{ requestId: id, type: "started" }]);
    assert.equal(existsSync(path.dirname(call.workspace)), false);
    await service.cancel("missing-request");
  });

  await check("defers provider cleanup failures until explicit cancellation", async () => {
    const id = uuid(12);
    const cleanup = [];
    plans.push({
      kind: "failure",
      code: "native_process_failed",
      cleanup: async () => cleanup.push("provider"),
    });
    const invocation = service.invoke(runtime, request(id), () => undefined);
    await expectCode(() => invocation, "native_process_failed");
    const call = calls.at(-1);
    assert.equal(existsSync(path.dirname(call.workspace)), true);
    await service.cancel(id);
    assert.deepEqual(cleanup, ["provider"]);
    assert.equal(existsSync(path.dirname(call.workspace)), false);
  });

  await check("service close cancels every outstanding ACP task", async () => {
    const id = uuid(15);
    const callIndex = calls.length;
    plans.push({ kind: "pending", lateText: "late text after service close" });
    const invocation = service.invoke(runtime, request(id), () => undefined);
    const invocationRejection = expectCode(() => invocation, "native_cancelled");
    await waitFor(() => calls.length > callIndex, "service-close pending request");
    const call = calls[callIndex];
    await service.close();
    await invocationRejection;
    assert.equal(existsSync(path.dirname(call.workspace)), false);
  });

  await check("profile quiesce aborts in-flight work and closes the scope", async () => {
    const id = uuid(13);
    const updates = [];
    const callIndex = calls.length;
    plans.push({ kind: "pending", lateText: "old profile late text" });
    const invocation = service.invoke(runtime, request(id), update => updates.push(update));
    const invocationRejection = expectCode(() => invocation, "native_cancelled");
    await waitFor(() => calls.length > callIndex, "profile-scoped pending request");
    const call = calls[callIndex];
    await scope.quiesce();
    await invocationRejection;
    assert.equal(scope.state, "closed");
    assert.equal(scope.signal.aborted, true);
    assert.deepEqual(updates, [{ requestId: id, type: "started" }]);
    assert.equal(existsSync(path.dirname(call.workspace)), false);
    await expectCode(() => service.invoke(runtime, request(uuid(14)), () => undefined), "profile_closed");
  });

  const nextScope = new LearningProfileScope("profile-one", path.join(temp, "profile-assets-next"));
  const nextRuntime = { scope: nextScope };

  await check("rejects stale profile context after a new connection opens", async () => {
    assert.throws(() => nextScope.assertOpen(scope.context), error => error?.code === "profile_changed");
  });

  await check("enforces four concurrent ACP jobs and closes all on scope quiesce", async () => {
    const ids = [uuid(20), uuid(21), uuid(22), uuid(23)];
    const callIndex = calls.length;
    plans.push(...ids.map(() => ({ kind: "pending", lateText: "late concurrent text" })));
    const invocations = ids.map(id => service.invoke(nextRuntime, request(id), () => undefined));
    const outcomesPromise = Promise.allSettled(invocations);
    await waitFor(() => calls.length >= callIndex + ids.length, "four concurrent ACP adapters");
    await expectCode(() => service.invoke(nextRuntime, request(uuid(24)), () => undefined), "acp_concurrency_limit");
    await nextScope.quiesce();
    const outcomes = await outcomesPromise;
    assert.equal(outcomes.filter(outcome => outcome.status === "rejected").length, 4);
    assert(outcomes.every(outcome => outcome.status === "rejected" && outcome.reason?.code === "native_cancelled"));
  });

  const freshScope = new LearningProfileScope("profile-one", path.join(temp, "profile-assets-fresh"));
  const freshRuntime = { scope: freshScope };

  await check("allows the same request ID in a fresh profile session", async () => {
    const id = uuid(13);
    plans.push({ kind: "success", text: "fresh session answer", chunks: ["fresh session answer"], model: "fixture-fresh" });
    const updates = [];
    const result = await service.invoke(freshRuntime, request(id), update => updates.push(update));
    assert.equal(result.text, "fresh session answer");
    assert.equal(result.model, "fixture-fresh");
    assert.deepEqual(updates, [
      { requestId: id, type: "started" },
      { requestId: id, type: "text", text: "fresh session answer" },
      { requestId: id, type: "completed" },
    ]);
  });
  await freshScope.quiesce();

  await check("guards exact renderer, main frame, URL, and routing identity", async () => {
    const guard = createLearningIpcGuard({
      webContentsId: 73,
      mainFrameRoutingId: 19,
      expectedUrl: "https://enjoy.test/learning",
    });
    assert.doesNotThrow(() => guard.assertSender(makeSenderEvent()));
    const denied = [
      makeSenderEvent({ id: 74 }),
      makeSenderEvent({ url: "https://evil.test/learning" }),
      makeSenderEvent({ url: "https://enjoy.test/learning?foreign=1" }),
      makeSenderEvent({ destroyed: true }),
    ];
    for (const event of denied) await expectCode(() => Promise.resolve().then(() => guard.assertSender(event)), "learning_ipc_sender_denied");

    const main = makeSenderEvent();
    const child = { url: main.senderFrame.url, routingId: 20, parent: main.senderFrame, top: main.senderFrame };
    await expectCode(() => Promise.resolve().then(() => guard.assertSender({
      sender: { ...main.sender, mainFrame: main.senderFrame },
      senderFrame: child,
    })), "learning_ipc_sender_denied");
    const wrongRouting = makeSenderEvent();
    wrongRouting.senderFrame.routingId = 20;
    await expectCode(() => Promise.resolve().then(() => guard.assertSender(wrongRouting)), "learning_ipc_sender_denied");
  });

  await check("rejects malformed pinned URLs and profile identity mismatches", async () => {
    for (const expectedUrl of [
      "javascript:alert(1)",
      "https://user:pass@enjoy.test/learning",
      "https://enjoy.test/learning/%ZZ",
      "https://enjoy.test/learning/../other",
      "https://enjoy.test/learning/%2e%2e/other",
      "file://foreign-host/learning/index.html",
    ]) {
      assert.throws(() => createLearningIpcGuard({ webContentsId: 73, expectedUrl }), error => error?.code === "learning_ipc_expected_url_invalid");
    }

    const expected = { profileId: "profile-one", connectionId: "connection-one" };
    assert.doesNotThrow(() => assertLearningContext(expected, { ...expected }));
    for (const received of [
      null,
      [],
      { profileId: "other", connectionId: expected.connectionId },
      { profileId: expected.profileId, connectionId: "other" },
      { profileId: "", connectionId: expected.connectionId },
      { profileId: "p".repeat(201), connectionId: expected.connectionId },
    ]) {
      assert.throws(() => assertLearningContext(expected, received), error => error?.code === "learning_context_denied");
    }
  });

  await check("sanitizes unknown IPC failures and preserves only safe error codes", async () => {
    const window = {
      webContents: {
        id: 73,
        on: () => undefined,
      },
      on: () => undefined,
    };
    const validEvent = makeSenderEvent();
    registerAcpIpc(window, "https://enjoy.test/learning", () => null);
    const handlers = getHandlers();
    await assert.rejects(
      handlers.get("acp-status")(validEvent),
      error => error?.message === "learning_not_ready" && !error.message.includes("secret"),
    );

    const secretRuntime = {
      scope: {
        assertOpen: () => {
          throw Object.assign(new Error("SECRET_TOKEN=/private/home"), { code: "provider_secret" });
        },
      },
    };
    registerAcpIpc(window, "https://enjoy.test/learning", () => secretRuntime);
    await assert.rejects(
      getHandlers().get("acp-status")(validEvent),
      error => error?.message === "acp_request_failed" && !error.message.includes("SECRET_TOKEN") && !error.message.includes("/private/home"),
    );
  });

  console.log(`ACP shared service checks passed (${passed.length}): ${passed.join("; ")}`);
} finally {
  await Promise.all([
    rm(temp, { recursive: true, force: true }),
    rm(bundle, { force: true }),
  ]);
}
