import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(root, ".tmp-enjoy-learning-lesson-reader-"));
const output = path.join(temp, "lesson-reader.mjs");

const revisionOneId = "00000000-0000-4000-8000-000000000101";
const revisionTwoId = "00000000-0000-4000-8000-000000000102";
const lessonId = "00000000-0000-4000-8000-000000000100";
const imageSlotId = "00000000-0000-4000-8000-000000000201";
const audioSlotId = "00000000-0000-4000-8000-000000000202";
const secondAudioSlotId = "00000000-0000-4000-8000-000000000203";
const imageOneId = "00000000-0000-4000-8000-000000000301";
const imageTwoId = "00000000-0000-4000-8000-000000000302";
const audioId = "00000000-0000-4000-8000-000000000303";
const audioVariantId = "00000000-0000-4000-8000-000000000304";
const secondAudioId = "00000000-0000-4000-8000-000000000305";

const target = {
  id: "coffee",
  term: "coffee",
  sense: "a drink made from roasted beans",
  definition: "A hot drink made from roasted coffee beans.",
  translationVi: "cà phê",
  example: "I drink coffee in the morning.",
  evidence: { status: "unverified" },
};

const draft = {
  title: "Coffee with a colleague",
  sections: [
    {
      id: "section-opening",
      text: "I meet my colleague at a small cafe. We order coffee and talk about our morning.",
      targetIds: ["coffee"],
    },
    {
      id: "section-followup",
      text: "After our chat, we walk back to work and plan another coffee tomorrow.",
      targetIds: ["coffee"],
    },
  ],
  glossary: [{
    targetId: "coffee",
    definition: target.definition,
    translationVi: target.translationVi,
    example: target.example,
  }],
  scenes: [{
    id: "scene-cafe",
    description: "Two colleagues talk beside a sunny cafe window.",
    sectionIds: ["section-opening"],
    targetIds: ["coffee"],
  }],
  exercises: [{
    id: "meaning-coffee",
    kind: "meaning",
    prompt: "What is coffee?",
    targetIds: ["coffee"],
    choices: [
      { id: "drink", text: "A drink" },
      { id: "vehicle", text: "A vehicle" },
    ],
    answerChoiceIds: ["drink"],
  }],
  entityDescriptions: [],
};

const bundle = {
  lesson: {
    id: lessonId,
    profileId: "profile-a",
    title: draft.title,
    activeRevisionId: revisionOneId,
    createdAt: "2026-09-06T07:00:00.000Z",
    updatedAt: "2026-09-06T07:00:00.000Z",
  },
  revisions: [
    {
      id: revisionOneId,
      profileId: "profile-a",
      lessonId,
      number: 1,
      brief: {
        topic: "Coffee",
        level: "A2",
        length: "short",
        imageCount: 1,
        audio: true,
        targets: [target],
      },
      content: draft,
      status: "ready",
      validation: { warnings: ["AI draft, cần đọc lại trước khi học."] },
      provenance: { provider: "fixture" },
      sourceHash: null,
      createdAt: "2026-09-06T07:01:00.000Z",
      updatedAt: "2026-09-06T07:01:00.000Z",
    },
    {
      id: revisionTwoId,
      profileId: "profile-a",
      lessonId,
      number: 2,
      brief: {
        topic: "Coffee revised",
        level: "A2",
        length: "short",
        imageCount: 1,
        audio: true,
        targets: [target],
      },
      content: null,
      status: "draft",
      validation: { warnings: ["Nội dung đang chờ provider."] },
      provenance: { provider: "fixture" },
      sourceHash: null,
      createdAt: "2026-09-06T07:02:00.000Z",
      updatedAt: "2026-09-06T07:02:00.000Z",
    },
  ],
  slots: [
    {
      id: imageSlotId,
      profileId: "profile-a",
      lessonRevisionId: revisionOneId,
      mapRevisionId: null,
      sourceType: "scene",
      sourceId: "scene-cafe",
      kind: "image",
      sourceHash: "a".repeat(64),
      slotKey: "scene:scene-cafe:image",
      selectedAssetId: imageOneId,
      createdAt: "2026-09-06T07:03:00.000Z",
      updatedAt: "2026-09-06T07:03:00.000Z",
    },
    {
      id: audioSlotId,
      profileId: "profile-a",
      lessonRevisionId: revisionOneId,
      mapRevisionId: null,
      sourceType: "section",
      sourceId: "section-opening",
      kind: "audio",
      sourceHash: "b".repeat(64),
      slotKey: "section:section-opening:audio",
      selectedAssetId: audioId,
      createdAt: "2026-09-06T07:03:00.000Z",
      updatedAt: "2026-09-06T07:03:00.000Z",
    },
    {
      id: secondAudioSlotId,
      profileId: "profile-a",
      lessonRevisionId: revisionOneId,
      mapRevisionId: null,
      sourceType: "section",
      sourceId: "section-followup",
      kind: "audio",
      sourceHash: "f".repeat(64),
      slotKey: "section:section-followup:audio",
      selectedAssetId: secondAudioId,
      createdAt: "2026-09-06T07:03:00.000Z",
      updatedAt: "2026-09-06T07:03:00.000Z",
    },
  ],
  assets: [
    {
      id: imageOneId,
      profileId: "profile-a",
      slotId: imageSlotId,
      relativePath: `${imageOneId}.png`,
      kind: "image",
      mimeType: "image/png",
      sha256: "c".repeat(64),
      sizeBytes: 2048,
      width: 1200,
      height: 675,
      durationMs: null,
      provenance: { provider: "fixture" },
      createdAt: "2026-09-06T07:04:00.000Z",
      updatedAt: "2026-09-06T07:04:00.000Z",
    },
    {
      id: imageTwoId,
      profileId: "profile-a",
      slotId: imageSlotId,
      relativePath: `${imageTwoId}.png`,
      kind: "image",
      mimeType: "image/png",
      sha256: "d".repeat(64),
      sizeBytes: 4096,
      width: 1200,
      height: 675,
      durationMs: null,
      provenance: { provider: "fixture" },
      createdAt: "2026-09-06T07:05:00.000Z",
      updatedAt: "2026-09-06T07:05:00.000Z",
    },
    {
      id: audioId,
      profileId: "profile-a",
      slotId: audioSlotId,
      relativePath: `${audioId}.mp3`,
      kind: "audio",
      mimeType: "audio/mpeg",
      sha256: "e".repeat(64),
      sizeBytes: 8192,
      width: null,
      height: null,
      durationMs: 3200,
      provenance: { provider: "fixture" },
      createdAt: "2026-09-06T07:04:00.000Z",
      updatedAt: "2026-09-06T07:04:00.000Z",
    },
    {
      id: audioVariantId,
      profileId: "profile-a",
      slotId: audioSlotId,
      relativePath: `${audioVariantId}.mp3`,
      kind: "audio",
      mimeType: "audio/mpeg",
      sha256: "g".repeat(64),
      sizeBytes: 9216,
      width: null,
      height: null,
      durationMs: 3000,
      provenance: { provider: "fixture" },
      createdAt: "2026-09-06T07:05:00.000Z",
      updatedAt: "2026-09-06T07:05:00.000Z",
    },
    {
      id: secondAudioId,
      profileId: "profile-a",
      slotId: secondAudioSlotId,
      relativePath: `${secondAudioId}.mp3`,
      kind: "audio",
      mimeType: "audio/mpeg",
      sha256: "h".repeat(64),
      sizeBytes: 10240,
      width: null,
      height: null,
      durationMs: 2800,
      provenance: { provider: "fixture" },
      createdAt: "2026-09-06T07:06:00.000Z",
      updatedAt: "2026-09-06T07:06:00.000Z",
    },
  ],
  practiceAttempts: [],
};

const incompleteBundle = {
  ...bundle,
  slots: bundle.slots.map((slot) => slot.id === secondAudioSlotId ? { ...slot, selectedAssetId: null } : slot),
};
const scopeChangedBundle = {
  ...bundle,
  lesson: { ...bundle.lesson, id: "00000000-0000-4000-8000-000000000110" },
};

function dispatchValue(element, value) {
  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new element.ownerDocument.defaultView.Event("input", { bubbles: true }));
  element.dispatchEvent(new element.ownerDocument.defaultView.Event("change", { bubbles: true }));
}

try {
  const source = await readFile(path.join(root, "src/renderer/components/learning/lesson-reader.tsx"), "utf8");
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|ipcRenderer|window\./u, "reader must stay renderer-safe");

  await build({
    entryPoints: [path.join(root, "src/renderer/components/learning/lesson-reader.tsx")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: output,
    logLevel: "silent",
    external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
  });
  const { LessonReader } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
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
    Event: dom.window.Event,
  });
  const playCalls = [];
  const pauseCalls = [];
  dom.window.HTMLMediaElement.prototype.play = function play() {
    playCalls.push(this.getAttribute("src"));
    return Promise.resolve();
  };
  dom.window.HTMLMediaElement.prototype.pause = function pause() {
    pauseCalls.push(this.getAttribute("src"));
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = React;
  const rootNode = createRoot(dom.window.document.getElementById("root"));
  const selectedRevisions = [];
  const selectedAssets = [];
  const generatedImages = [];
  const generatedAudio = [];
  const saved = [];
  const renderProps = {
    bundle,
    onRevisionSelect: (id) => selectedRevisions.push(id),
    onSaveRevision: async (content) => { saved.push(content); },
    assetUrl: (relativePath) => `/learning-assets/${relativePath}`,
    onSelectAsset: async (slotId, assetId) => { selectedAssets.push({ slotId, assetId }); },
    onGenerateImage: async (slotId) => { generatedImages.push(slotId); },
    onGenerateAudio: async (slotId) => { generatedAudio.push(slotId); },
  };

  await act(async () => rootNode.render(React.createElement(LessonReader, renderProps)));
  const container = dom.window.document.getElementById("root");
  assert.match(container.textContent, /Coffee with a colleague/u);
  assert.match(container.textContent, /AI draft, cần đọc lại/u);
  assert.equal(container.querySelector('[data-testid="lesson-scene-image-scene-cafe"]')?.getAttribute("src"), `/learning-assets/${imageOneId}.png`);
  assert.ok(container.querySelector('[data-testid="lesson-section-audio-player-section-opening"]')?.hasAttribute("controls"));
  assert.equal(container.querySelectorAll('[data-testid^="lesson-select-asset-"]').length, 5);

  const fullAudio = () => container.querySelector('[data-testid="lesson-full-audio"]');
  const firstAudioUrl = `/learning-assets/${audioId}.mp3`;
  const secondAudioUrl = `/learning-assets/${secondAudioId}.mp3`;
  assert.equal(container.querySelector('[data-testid="lesson-audio-coverage"]')?.textContent, "Nghe toàn bài");
  assert.equal(fullAudio()?.getAttribute("src"), firstAudioUrl);
  assert.equal(fullAudio()?.hasAttribute("controls"), true);
  assert.equal(fullAudio()?.hasAttribute("autoplay"), false);
  assert.deepEqual([...container.querySelector('[data-testid="lesson-audio-playback-rate"]')?.options ?? []].map((option) => option.value), ["0.75", "1", "1.25", "1.5"]);

  await act(async () => {
    dispatchValue(container.querySelector('[data-testid="lesson-audio-playback-rate"]'), "1.25");
  });
  assert.equal(fullAudio()?.playbackRate, 1.25);
  await act(async () => {
    container.querySelector('[data-testid="lesson-audio-start"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(fullAudio()?.hasAttribute("autoplay"), true);
  assert.ok(playCalls.includes(firstAudioUrl));
  await act(async () => {
    fullAudio().dispatchEvent(new dom.window.Event("ended", { bubbles: true }));
  });
  assert.equal(fullAudio()?.getAttribute("src"), secondAudioUrl);
  assert.equal(fullAudio()?.playbackRate, 1.25);
  assert.equal(playCalls.at(-1), secondAudioUrl);

  const firstAudioVariant = container.querySelector(`[data-testid="lesson-select-asset-${audioVariantId}"]`);
  const playCallsBeforeVariantReset = playCalls.length;
  fullAudio().currentTime = 7;
  await act(async () => {
    firstAudioVariant.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(fullAudio()?.hasAttribute("autoplay"), false);
  assert.equal(fullAudio()?.currentTime, 0);
  assert.equal(playCalls.length, playCallsBeforeVariantReset);
  assert.ok(pauseCalls.length > 0);

  await act(async () => {
    rootNode.render(React.createElement(LessonReader, { ...renderProps, bundle: incompleteBundle }));
  });
  assert.equal(container.querySelector('[data-testid="lesson-audio-coverage"]')?.textContent, "Nghe các đoạn đã có giọng đọc (1/2)");
  assert.equal(fullAudio()?.getAttribute("src"), firstAudioUrl);

  await act(async () => {
    container.querySelector('[data-testid="lesson-audio-start"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(fullAudio()?.hasAttribute("autoplay"), true);
  const playCallsBeforeScopeReset = playCalls.length;
  await act(async () => {
    rootNode.render(React.createElement(LessonReader, { ...renderProps, bundle: scopeChangedBundle }));
  });
  assert.equal(fullAudio()?.hasAttribute("autoplay"), false);
  assert.equal(playCalls.length, playCallsBeforeScopeReset);
  await act(async () => {
    container.querySelector('[data-testid="lesson-audio-start"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(fullAudio()?.hasAttribute("autoplay"), true);
  const playCallsBeforeRevisionReset = playCalls.length;

  await act(async () => {
    rootNode.render(React.createElement(LessonReader, { ...renderProps, revisionId: revisionTwoId }));
  });
  assert.match(container.textContent, /Bản nháp đang chờ nội dung/u);
  assert.match(container.textContent, /Nội dung đang chờ provider/u);
  assert.equal(container.querySelector('[data-testid="lesson-editor"]'), null);
  assert.equal(playCalls.length, playCallsBeforeRevisionReset);

  await act(async () => {
    rootNode.render(React.createElement(LessonReader, { ...renderProps, revisionId: revisionOneId }));
  });
  assert.equal(fullAudio()?.getAttribute("src"), firstAudioUrl);
  assert.equal(fullAudio()?.hasAttribute("autoplay"), false);

  await act(async () => {
    container.querySelector(`[data-testid="lesson-select-asset-${imageTwoId}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.deepEqual(selectedAssets.at(-1), { slotId: imageSlotId, assetId: imageTwoId });
  await act(async () => {
    container.querySelector(`[data-testid="lesson-generate-image-${imageSlotId}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    container.querySelector(`[data-testid="lesson-generate-audio-${audioSlotId}"]`).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.deepEqual(generatedImages, [imageSlotId]);
  assert.deepEqual(generatedAudio, [audioSlotId]);

  await act(async () => {
    container.querySelector('[data-testid="lesson-toggle-editor"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  const titleInput = container.querySelector('[data-testid="lesson-editor-title"]');
  const sectionInput = container.querySelector('[data-testid="lesson-editor-section-section-opening"]');
  await act(async () => {
    dispatchValue(titleInput, "Coffee after work");
    dispatchValue(sectionInput, "I meet my colleague after work and share coffee.");
  });
  await act(async () => {
    container.querySelector('[data-testid="lesson-save-revision"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].title, "Coffee after work");
  assert.equal(saved[0].sections[0].id, "section-opening");
  assert.equal(saved[0].sections[0].text, "I meet my colleague after work and share coffee.");
  assert.deepEqual(saved[0].glossary, draft.glossary);
  assert.deepEqual(saved[0].exercises, draft.exercises);
  assert.match(container.textContent, /tạo riêng/u);

  await act(async () => {
    container.querySelector('[data-testid="lesson-toggle-editor"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    dispatchValue(container.querySelector('[data-testid="lesson-editor-title"]'), "Unsaved title");
    container.querySelector('[data-testid="lesson-cancel-edit"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.match(container.querySelector('[data-testid="lesson-reader-heading"]')?.textContent, /Coffee with a colleague/u);

  await act(async () => {
    container.querySelector('[data-testid="lesson-tab-story"]').dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });
  assert.equal(dom.window.document.activeElement?.id, "lesson-reader-tab-glossary");
  assert.equal(container.querySelector('[data-testid="lesson-tab-glossary"]')?.getAttribute("aria-selected"), "true");
  assert.equal(container.querySelector('[data-testid="lesson-tabpanel-glossary"]')?.getAttribute("role"), "tabpanel");
  assert.match(container.querySelector('[data-testid="lesson-glossary-coffee"]')?.textContent, /English/u);
  assert.match(container.textContent, /cà phê/u);
  assert.match(container.textContent, /Chưa xác minh độc lập/u);

  await act(async () => {
    rootNode.render(React.createElement(LessonReader, { ...renderProps, bundle: null }));
  });
  assert.match(container.textContent, /Chưa có dữ liệu bài học/u);

  await act(async () => {
    rootNode.render(React.createElement(LessonReader, renderProps));
  });
  const pauseCallsBeforeUnmount = pauseCalls.length;
  await act(async () => rootNode.unmount());
  assert.ok(pauseCalls.length > pauseCallsBeforeUnmount);
  console.log("PASS: lesson reader renders revision content, bilingual glossary, selected image/audio variants, safe generation callbacks, immutable editing, history, warnings, and draft state.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
