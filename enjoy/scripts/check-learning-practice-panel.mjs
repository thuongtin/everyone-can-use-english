import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(root, "scripts/.tmp-learning-practice-panel-"));

const target = {
  id: "target-coffee",
  term: "coffee",
  sense: "a drink made from roasted beans",
  definition: "A hot drink made from roasted coffee beans.",
  translationVi: "cà phê",
  example: "I drink coffee in the morning.",
};

const meaningExercise = {
  kind: "meaning",
  id: "exercise-meaning",
  prompt: "Which word means a hot drink?",
  targetIds: [target.id],
  choices: [
    { id: "choice-coffee", text: "A hot drink" },
    { id: "choice-table", text: "A piece of furniture" },
  ],
  answerChoiceIds: ["choice-coffee"],
};

const fillExercise = {
  kind: "fill",
  id: "exercise-fill",
  prompt: "Complete the sentence.",
  targetIds: [target.id],
  acceptedAnswers: ["coffee"],
};

const orderExercise = {
  kind: "order",
  id: "exercise-order",
  prompt: "Put the words in order.",
  targetIds: [target.id],
  tokens: [
    { id: "token-drink", text: "drink" },
    { id: "token-coffee", text: "coffee" },
    { id: "token-I", text: "I" },
  ],
  acceptedOrders: [["token-I", "token-drink", "token-coffee"]],
};

const retellExercise = {
  kind: "retell",
  id: "exercise-retell",
  prompt: "Retell the coffee conversation.",
  targetIds: [target.id],
  hints: ["Say what you ordered."],
};

const attempts = [
  {
    questionId: fillExercise.id,
    kind: fillExercise.kind,
    targetIds: fillExercise.targetIds,
    result: { correct: false },
    recordingAssetId: "recording-1",
    createdAt: "2026-09-06T08:00:00.000Z",
  },
];

try {
  const output = path.join(temp, "practice-panel.mjs");
  await build({
    entryPoints: [path.join(root, "src/renderer/components/learning/practice-panel.tsx")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: output,
    logLevel: "silent",
    loader: { ".css": "empty" },
    mainFields: ["module", "main"],
    conditions: ["import", "browser"],
    external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
  });

  const { PracticePanel } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
    cancelAnimationFrame: (handle) => clearTimeout(handle),
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  dom.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  dom.window.navigator.mediaDevices = {
    getUserMedia: async () => { throw new Error("permission denied"); },
  };
  const recorderInstances = [];
  class FakeMediaRecorder {
    static isTypeSupported(type) { return type === "audio/webm;codecs=opus"; }

    constructor(stream, options = {}) {
      this.stream = stream;
      this.mimeType = options.mimeType || "audio/webm;codecs=opus";
      this.state = "inactive";
      this.timeslice = undefined;
      this.stopCalls = 0;
      this.ondataavailable = undefined;
      this.onstop = undefined;
      this.onerror = undefined;
      recorderInstances.push(this);
    }

    start(timeslice) {
      this.timeslice = timeslice;
      this.state = "recording";
    }

    stop() {
      if (this.state === "inactive") return;
      this.stopCalls += 1;
      this.state = "inactive";
      this.onstop?.();
    }

    emitChunk(data) {
      this.ondataavailable?.({ data });
    }
  }
  globalThis.MediaRecorder = FakeMediaRecorder;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = React;
  const submitted = [];
  const played = [];
  const container = dom.window.document.getElementById("root");
  const rootNode = createRoot(container);
  await act(async () => {
    rootNode.render(React.createElement(PracticePanel, {
      exercises: [meaningExercise, fillExercise, orderExercise, { ...orderExercise, id: "already-ordered", tokens: [orderExercise.tokens[2], orderExercise.tokens[0], orderExercise.tokens[1]] }, retellExercise],
      targets: [target],
      attempts,
      onSubmit: async (questionId, answer, recording) => {
        submitted.push({ questionId, answer, recording });
        return { correct: false, feedbackCode: "incorrect" };
      },
      onPlayRecording: (assetId) => played.push(assetId),
    }));
  });

  assert.ok(container.querySelector('[data-testid="practice-panel"]'));
  assert.ok(container.querySelectorAll('input[type="radio"]').length === 2);
  assert.match(container.textContent, /Cần ôn lại/iu);
  assert.ok(container.querySelector('[data-testid="practice-retry-section"]'));
  assert.ok(container.querySelector('[data-testid="practice-retell-targets-exercise-retell"]'));
  assert.ok(container.querySelector('[data-testid="practice-order-up-exercise-order-token-coffee"]'));
  const orderedLabels = Array.from(container.querySelector('[data-testid="practice-order-already-ordered"]').querySelectorAll('ol li')).map(node => node.querySelectorAll('span')[1]?.textContent);
  assert.deepEqual([...orderedLabels].sort(), ["I", "coffee", "drink"]);
  assert.notDeepEqual(orderedLabels, ["I", "drink", "coffee"], "model-provided correct token order must be shuffled before practice");
  assert.ok(container.querySelector('[data-testid="practice-play-recording-exercise-fill"]'));

  const input = container.querySelector('[data-testid="practice-fill-input-exercise-fill"]');
  assert.ok(input);
  const valueSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    valueSetter.call(input, "coffee");
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    container.querySelector('[data-testid="practice-submit-exercise-fill"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(submitted.length, 1);
  assert.deepEqual(submitted[0], { questionId: fillExercise.id, answer: "coffee", recording: undefined });
  assert.match(container.textContent, /Cần luyện thêm/iu);

  await act(async () => {
    container.querySelector('[data-testid="practice-play-recording-exercise-fill"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.deepEqual(played, ["recording-1"]);

  await act(async () => {
    container.querySelector('[data-testid="practice-recording-start-exercise-retell"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.match(container.textContent, /Không thể truy cập microphone/iu);

  const makeStream = () => {
    const track = {
      stopped: false,
      stop() { this.stopped = true; },
    };
    return {
      track,
      getTracks() { return [track]; },
    };
  };
  let pendingPermissions = [];
  dom.window.navigator.mediaDevices.getUserMedia = () => new Promise((resolve) => {
    pendingPermissions.push(resolve);
  });

  await act(async () => {
    container.querySelector('[data-testid="practice-recording-start-exercise-retell"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  const stalePendingStream = makeStream();
  await act(async () => {
    container.querySelector('[data-testid="practice-recording-cancel-exercise-retell"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    pendingPermissions.shift()(stalePendingStream);
    await Promise.resolve();
  });
  assert.equal(recorderInstances.length, 0, "cancelled permission must not start a recorder when it resolves");
  assert.equal(stalePendingStream.track.stopped, true, "stale permission stream must be stopped");

  await act(async () => {
    container.querySelector('[data-testid="practice-recording-start-exercise-retell"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    container.querySelector('[data-testid="practice-recording-cancel-exercise-retell"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
  await act(async () => {
    container.querySelector('[data-testid="practice-recording-start-exercise-retell"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  const staleRestartStream = makeStream();
  const currentRestartStream = makeStream();
  await act(async () => {
    pendingPermissions.shift()(staleRestartStream);
    await Promise.resolve();
    pendingPermissions.shift()(currentRestartStream);
    await Promise.resolve();
  });
  assert.equal(recorderInstances.length, 1, "only the current recording epoch may create a recorder");
  assert.equal(staleRestartStream.track.stopped, true, "stale restart stream must be stopped");
  assert.equal(recorderInstances[0].timeslice, 1_000, "recording must emit bounded timeslices");
  assert.equal(recorderInstances[0].mimeType, "audio/webm;codecs=opus", "recording must use an accepted MIME container");

  const NativeBlob = globalThis.Blob;
  await act(async () => {
    recorderInstances[0].emitChunk(new NativeBlob(["spoken response"]));
  });
  await act(async () => {
    container.querySelector('[data-testid="practice-recording-stop-exercise-retell"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
  const retellText = container.querySelector('[data-testid="practice-retell-input-exercise-retell"]');
  assert.ok(retellText);
  await act(async () => {
    container.querySelector('[data-testid="practice-submit-exercise-retell"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(submitted[1].questionId, retellExercise.id);
  assert.equal(submitted[1].answer, "", "audio-only retell must submit an empty text answer");
  assert.ok(submitted[1].recording?.bytes instanceof Uint8Array);
  assert.equal(submitted[1].recording?.mimeType, "audio/webm;codecs=opus");
  assert.equal(currentRestartStream.track.stopped, true, "stopping a recording must release its track");

  dom.window.navigator.mediaDevices.getUserMedia = async () => makeStream();
  await act(async () => {
    container.querySelector('[data-testid="practice-recording-start-exercise-retell"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
  assert.equal(recorderInstances.length, 2);
  await act(async () => {
    recorderInstances[1].emitChunk({ size: 16 * 1024 * 1024 + 1 });
    await Promise.resolve();
  });
  assert.equal(recorderInstances[1].stopCalls, 1, "oversized chunks must stop recording immediately");
  assert.match(container.textContent, /16 MiB/iu);

  const originalArrayBuffer = NativeBlob.prototype.arrayBuffer;
  let resolveArrayBuffer;
  NativeBlob.prototype.arrayBuffer = function controlledArrayBuffer() {
    return new Promise((resolve) => { resolveArrayBuffer = resolve; });
  };
  let createObjectUrlCalls = 0;
  const originalCreateObjectUrl = globalThis.URL.createObjectURL;
  globalThis.URL.createObjectURL = () => {
    createObjectUrlCalls += 1;
    return "blob:practice-test";
  };
  await act(async () => {
    container.querySelector('[data-testid="practice-recording-start-exercise-retell"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
  assert.equal(recorderInstances.length, 3);
  await act(async () => {
    recorderInstances[2].emitChunk(new NativeBlob(["delayed bytes"]));
  });
  await act(async () => {
    container.querySelector('[data-testid="practice-recording-stop-exercise-retell"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
  assert.equal(typeof resolveArrayBuffer, "function", "blob conversion should be pending");
  await act(async () => rootNode.unmount());
  await act(async () => {
    resolveArrayBuffer(new ArrayBuffer(4));
    await Promise.resolve();
  });
  assert.equal(createObjectUrlCalls, 0, "unmount during blob conversion must not create a stale blob URL");
  NativeBlob.prototype.arrayBuffer = originalArrayBuffer;
  globalThis.URL.createObjectURL = originalCreateObjectUrl;

  console.log("check-learning-practice-panel: PASS (accessible answers, authoritative submit, retry summary, epoch-safe recording, MIME, bounds, and blob cleanup)");
} finally {
  await rm(temp, { recursive: true, force: true });
}
