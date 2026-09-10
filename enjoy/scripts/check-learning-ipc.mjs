import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-learning-ipc-"));
const cases = [];

const test = async (name, action) => {
  await action();
  cases.push(name);
};

const compile = async () => {
  const output = path.join(temp, "ipc-guard.mjs");
  await build({
    entryPoints: [path.join(root, "src/main/learning/ipc-guard.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });
  return import(pathToFileURL(output).href);
};

const makeFrame = (url, options = {}) => {
  const frame = {
    url,
    routingId: options.routingId ?? 1,
    parent: options.parent ?? null,
    top: options.top,
  };
  frame.top ??= frame;
  return frame;
};

const makeEvent = ({
  expectedUrl,
  senderId = 42,
  actualUrl = expectedUrl,
  destroyed = false,
  frame,
  mainFrame,
  senderOverrides = {},
} = {}) => {
  const rootFrame = mainFrame ?? makeFrame(actualUrl);
  const senderFrame = frame === undefined ? rootFrame : frame;
  const sender = {
    id: senderId,
    mainFrame: rootFrame,
    isDestroyed: () => destroyed,
    ...senderOverrides,
  };
  return { sender, senderFrame };
};

try {
  const { createLearningIpcGuard, assertLearningContext } = await compile();

  await test("accepts the pinned development URL while ignoring hash-only route changes", () => {
    const expectedUrl = "http://localhost:5173/index.html?build=42#boot";
    const guard = createLearningIpcGuard({ webContentsId: 42, expectedUrl });
    const event = makeEvent({ expectedUrl, actualUrl: "http://localhost:5173/index.html?build=42#learning/studio" });
    assert.equal(guard.assertSender(event), undefined);
  });

  await test("accepts the pinned packaged file URL while preserving encoded path and query", () => {
    const expectedUrl = "file:///Applications/Enjoy.app/Contents/Resources/renderer/index.html#boot";
    const guard = createLearningIpcGuard({ webContentsId: 42, expectedUrl });
    assert.equal(guard.assertSender(makeEvent({ expectedUrl, actualUrl: expectedUrl.replace("#boot", "#learning") })), undefined);
  });

  await test("requires the exact webContents and a live sender", () => {
    const expectedUrl = "http://localhost:5173/index.html";
    const guard = createLearningIpcGuard({ webContentsId: 42, expectedUrl });
    assert.throws(() => guard.assertSender(makeEvent({ expectedUrl, senderId: 41 })), { code: "learning_ipc_sender_denied" });
    assert.throws(() => guard.assertSender(makeEvent({ expectedUrl, destroyed: true })), { code: "learning_ipc_sender_denied" });
  });

  await test("requires a live main frame identity and rejects iframe or popup lookalikes", () => {
    const expectedUrl = "http://localhost:5173/index.html";
    const guard = createLearningIpcGuard({ webContentsId: 42, expectedUrl });
    const mainFrame = makeFrame(expectedUrl);
    const iframe = makeFrame(expectedUrl, { top: mainFrame, parent: mainFrame, routingId: 2 });
    assert.throws(() => guard.assertSender(makeEvent({ expectedUrl, mainFrame, frame: iframe })), { code: "learning_ipc_sender_denied" });
    const popupFrame = makeFrame(expectedUrl);
    const popupEvent = makeEvent({ expectedUrl, frame: popupFrame, mainFrame: makeFrame(expectedUrl) });
    assert.throws(() => guard.assertSender(popupEvent), { code: "learning_ipc_sender_denied" });
    assert.throws(() => guard.assertSender(makeEvent({ expectedUrl, mainFrame, frame: { ...mainFrame, top: mainFrame, parent: null } })), { code: "learning_ipc_sender_denied" });
  });

  await test("rejects a missing, nested, or stale frame before an IPC action runs", () => {
    const expectedUrl = "http://localhost:5173/index.html";
    const guard = createLearningIpcGuard({ webContentsId: 42, expectedUrl });
    let actionRuns = 0;
    const guardedAction = (event) => {
      guard.assertSender(event);
      actionRuns += 1;
    };
    assert.throws(() => guardedAction({ sender: makeEvent({ expectedUrl }).sender, senderFrame: null }), { code: "learning_ipc_sender_denied" });
    assert.throws(() => guardedAction(makeEvent({ expectedUrl, actualUrl: "http://localhost:5173/settings" })), { code: "learning_ipc_sender_denied" });
    assert.equal(actionRuns, 0);
  });

  await test("requires a top-level frame even when the routing ID is guessed correctly", () => {
    const expectedUrl = "http://localhost:5173/index.html";
    const guard = createLearningIpcGuard({ webContentsId: 42, mainFrameRoutingId: 1, expectedUrl });
    const mainFrame = makeFrame(expectedUrl, { routingId: 1 });
    const nested = makeFrame(expectedUrl, { routingId: 1, top: mainFrame, parent: mainFrame });
    assert.throws(() => guard.assertSender(makeEvent({ expectedUrl, mainFrame, frame: nested })), { code: "learning_ipc_sender_denied" });
    const wrongRouting = makeFrame(expectedUrl, { routingId: 99 });
    assert.throws(() => guard.assertSender(makeEvent({ expectedUrl, mainFrame, frame: wrongRouting })), { code: "learning_ipc_sender_denied" });
  });

  await test("rejects protocol, host, port, path, query, userinfo, malformed percent and encoded path aliases", () => {
    const expectedUrl = "http://localhost:5173/index.html?build=42";
    const guard = createLearningIpcGuard({ webContentsId: 42, expectedUrl });
    for (const actualUrl of [
      "https://localhost:5173/index.html?build=42",
      "http://127.0.0.1:5173/index.html?build=42",
      "http://localhost:5174/index.html?build=42",
      "http://localhost:5173/other.html?build=42",
      "http://localhost:5173/index.html?build=43",
      "http://user:pass@localhost:5173/index.html?build=42",
      "http://localhost:5173/index.html?build=%ZZ",
      "http://localhost:5173/%69ndex.html?build=42",
    ]) {
      assert.throws(() => guard.assertSender(makeEvent({ expectedUrl, actualUrl })), { code: "learning_ipc_sender_denied" });
    }
  });

  await test("rejects packaged file aliases and accepts only the exact encoded path", () => {
    const expectedUrl = "file:///Applications/Enjoy.app/Contents/Resources/renderer/main%20window/index.html";
    const guard = createLearningIpcGuard({ webContentsId: 42, expectedUrl });
    assert.equal(guard.assertSender(makeEvent({ expectedUrl })), undefined);
    for (const actualUrl of [
      "file:///Applications/Enjoy.app/Contents/Resources/renderer/main window/index.html",
      "file:///Applications/Enjoy.app/Contents/Resources/renderer/main%2Fwindow/index.html",
      "file:///Applications/Enjoy.app/Contents/Resources/renderer/./main%20window/index.html",
      "file:///Applications/Enjoy.app/Contents/Resources/renderer/%2e/main%20window/index.html",
      "file://localhost/Applications/Enjoy.app/Contents/Resources/renderer/main%20window/index.html",
      "file:///Applications/Enjoy.app/Contents/Resources/renderer/main%20window/index.html?x=1",
    ]) {
      assert.throws(() => guard.assertSender(makeEvent({ expectedUrl, actualUrl })), { code: "learning_ipc_sender_denied" });
    }
  });

  await test("validates profile and connection context without global mutable state", () => {
    const expected = Object.freeze({ profileId: "profile-a", connectionId: "connection-a" });
    assert.equal(assertLearningContext(expected, { profileId: "profile-a", connectionId: "connection-a", assetRoot: "/private" }), undefined);
    for (const received of [
      null,
      undefined,
      {},
      { profileId: "profile-b", connectionId: "connection-a" },
      { profileId: "profile-a", connectionId: "connection-b" },
      { profileId: "", connectionId: "connection-a" },
      { profileId: "profile-a", connectionId: 7 },
    ]) {
      assert.throws(() => assertLearningContext(expected, received), { code: "learning_context_denied" });
    }
    assert.throws(() => assertLearningContext({ profileId: "", connectionId: "connection-a" }, expected), { code: "learning_context_denied" });
  });

  console.log(`PASS: ${cases.length} learning IPC guard cases.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
