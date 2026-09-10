import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { Sequelize } from "sequelize";
import { JSDOM } from "jsdom";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(root, ".tmp-learning-studio-"));
let runtime, db, reactRoot, briefRoot, briefContainer, raceRoot, raceContainer, lateRoot, lateContainer, dom;
try {
  const output = path.join(temp, "subject.mjs");
  await build({ stdin: { contents: `export { LearningStudio, createLayoutSaveQueue } from './src/renderer/components/learning/learning-studio'; export { BriefForm } from './src/renderer/components/learning/brief-form'; export { LearningRuntime } from './src/main/learning/runtime'; export { LearningController } from './src/main/learning/controller';`, loader: "ts", resolveDir: root }, bundle: true, platform: "node", format: "esm", outfile: output, packages: "external", logLevel: "silent", plugins: [{ name: "node-test-runtime", setup(builder) { builder.onResolve({ filter: /^lodash\/[^.]+$/ }, args => ({ path: `${args.path}.js`, external: true })); builder.onResolve({ filter: /^dayjs\/(locale|plugin)\/[^.]+$/ }, args => ({ path: `${args.path}.js`, external: true })); builder.onResolve({ filter: /^electron-log\/main$/ }, () => ({ path: "electron-log/main.js", external: true })); builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "electron-test" })); builder.onLoad({ filter: /.*/, namespace: "electron-test" }, () => ({ contents: `export const ipcMain = { handle() {}, removeHandler() {}, on() {} }; export const app = { getPath() { return ""; }, isPackaged: false }; export class BrowserWindow { static getAllWindows() { return []; } } export class WebContentsView {}; export class Menu {}; export const shell = {}; export const dialog = {}; export const systemPreferences = {}; export const autoUpdater = {}; export const session = {}; export const safeStorage = { isEncryptionAvailable() { return true; }, encryptString(value) { return Buffer.from(value); }, decryptString(value) { return Buffer.from(value).toString("utf8"); } };`, loader: "js" })); } }, { name: "css-in-dom-test", setup(builder) { builder.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: "empty-css" })); builder.onLoad({ filter: /.*/, namespace: "empty-css" }, () => ({ contents: "", loader: "js" })); } }] });
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/", pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, SVGElement: dom.window.SVGElement, getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const { LearningStudio, BriefForm, LearningRuntime, LearningController, createLayoutSaveQueue } = await import(pathToFileURL(output).href);
  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const briefSettle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
  briefContainer = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(briefContainer);
  briefRoot = createRoot(briefContainer);
  const readyCapabilities = [{ provider: "codex", text: true, image: true, reason: null }, { provider: "claude", text: false, image: false, reason: "native_auth_unconfirmed" }];
  const renderBrief = async (key, props = {}) => {
    await act(async () => {
      briefRoot.render(React.createElement(BriefForm, {
        key,
        capabilities: readyCapabilities,
        onCancel() {},
        async onSave() {},
        ...props,
      }));
    });
    await briefSettle();
  };
  const briefClick = async text => {
    const button = [...briefContainer.querySelectorAll("button")].find(item => item.textContent.trim() === text);
    assert.ok(button, `brief button not found: ${text}`);
    assert.equal(button.disabled, false, `brief button is disabled: ${text}`);
    await act(async () => { button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
    await briefSettle();
  };
  const briefEnter = async (element, value) => {
    assert.ok(element, "brief input not found");
    const prototype = element instanceof dom.window.HTMLTextAreaElement
      ? dom.window.HTMLTextAreaElement.prototype
      : dom.window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
    await act(async () => { setter.call(element, value); element.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  };
  const briefLabeledControl = (text, scope = briefContainer) => {
    const labelText = item => item.firstChild?.textContent?.replace(/\s*\([^)]*\)\s*$/u, "").trim();
    const label = [...scope.querySelectorAll("label")].find(item => labelText(item) === text);
    assert.ok(label, `brief label not found: ${text}`);
    const control = label.querySelector("input, textarea, select");
    assert.ok(control, `brief control not found: ${text}`);
    return control;
  };
  const suggestedBrief = (input, term) => ({
    ...input,
    targets: [{
      id: "suggested-target",
      term,
      sense: "the intended meaning",
      definition: "A clear English definition.",
      translationVi: "nghĩa tiếng Việt",
      example: `This example uses ${term}.`,
    }],
  });

  let manualSaved = null;
  await renderBrief("manual-only", { onSave: async brief => { manualSaved = brief; } });
  await briefClick("Thêm mục học thủ công (0/12)");
  const manualTarget = briefContainer.querySelector("fieldset");
  assert.ok(manualTarget, "manual target fields should appear only after the user requests them");
  for (const [label, value] of [
    ["Từ hoặc cụm từ", "cup"],
    ["Nghĩa muốn học", "a drinking container"],
    ["Giải thích bằng tiếng Anh", "A small container for a drink."],
    ["Nghĩa tiếng Việt", "cốc"],
    ["Câu ví dụ tiếng Anh", "I have a cup of tea."],
  ]) await briefEnter(briefLabeledControl(label, manualTarget), value);
  await act(async () => { briefContainer.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
  await briefSettle();
  assert.deepEqual(manualSaved?.keywords, ["cup"], "manual-only save derives valid keywords from completed targets");
  assert.equal(manualSaved?.targets[0].sense, "a drinking container");

  const topicSuggestionCalls = [];
  await renderBrief("topic-only", {
    onSuggest: async (input, provider, signal) => {
      topicSuggestionCalls.push({ input, provider, signal });
      return suggestedBrief(input, "café");
    },
  });
  await briefEnter(briefLabeledControl("Chủ đề"), "A quiet café");
  await briefClick("Gợi ý mục học");
  assert.equal(topicSuggestionCalls.length, 1);
  assert.deepEqual(topicSuggestionCalls[0].input.keywords, [], "topic-only suggestion does not invent raw keywords");
  assert.equal(topicSuggestionCalls[0].provider, "codex");
  assert.match(briefContainer.textContent, /AI gợi ý, chưa xác minh/);
  const topicDetails = briefContainer.querySelector("details[open], section details");
  await briefEnter(briefLabeledControl("Nghĩa tiếng Việt", topicDetails), "quán cà phê");
  assert.match(briefContainer.textContent, /Bạn đã xác nhận/, "editing an AI target marks it as user-confirmed");

  const keywordSuggestionCalls = [];
  await renderBrief("keywords-only", {
    onSuggest: async input => {
      keywordSuggestionCalls.push(input);
      return suggestedBrief(input, "ice cream");
    },
  });
  const keywordsInput = briefContainer.querySelector("textarea");
  await briefEnter(keywordsInput, "ice cream,\nmake a reservation");
  await briefClick("Gợi ý mục học");
  assert.deepEqual(keywordSuggestionCalls[0].keywords, ["ice cream", "make a reservation"], "keyword phrases preserve internal spaces");
  assert.equal(keywordSuggestionCalls[0].topic, undefined);
  const keywordDetails = briefContainer.querySelector("section details");
  await briefEnter(briefLabeledControl("Câu ví dụ tiếng Anh", keywordDetails), "We ordered ice cream.");
  assert.equal(briefLabeledControl("Câu ví dụ tiếng Anh", keywordDetails).value, "We ordered ice cream.");

  const preferredAzureCalls = [];
  await renderBrief("preferred-azure", {
    capabilities: [
      { provider: "codex", text: true, image: true, reason: null },
      { provider: "claude", text: true, image: false, reason: null },
      { provider: "azure-openai", text: true, image: false, reason: null },
    ],
    preferredProvider: "azure-openai",
    onSuggest: async (input, provider) => {
      preferredAzureCalls.push(provider);
      return suggestedBrief(input, "tea");
    },
  });
  await briefEnter(briefLabeledControl("Chủ đề"), "Tea time");
  await briefClick("Gợi ý mục học");
  assert.deepEqual(preferredAzureCalls, ["azure-openai"], "brief suggestions honor the configured ready Azure provider");

  const cancelledSuggestion = (() => {
    let resolve;
    const promise = new Promise(res => { resolve = res; });
    return { promise, resolve };
  })();
  let cancellationCall = 0;
  let cancelledSignal = null;
  await renderBrief("cancellation", {
    onSuggest: async (input, _provider, signal) => {
      cancellationCall += 1;
      if (cancellationCall === 1) return suggestedBrief(input, "coffee");
      cancelledSignal = signal;
      return cancelledSuggestion.promise;
    },
  });
  const cancellationTopic = briefLabeledControl("Chủ đề");
  await briefEnter(cancellationTopic, "Coffee with friends");
  await briefClick("Gợi ý mục học");
  await briefClick("Gợi ý lại");
  await briefClick("Dừng gợi ý");
  assert.equal(cancelledSignal?.aborted, true, "stopping suggestion aborts its signal");
  assert.equal(cancellationTopic.value, "Coffee with friends", "stopping suggestion retains the brief input");
  assert.match(briefContainer.textContent, /coffee/, "stopping suggestion retains existing targets");
  cancelledSuggestion.resolve(suggestedBrief({ topic: "stale", keywords: [], level: "A2", length: "medium", imageCount: 1, audio: true }, "stale"));
  await briefSettle();
  assert.doesNotMatch(briefContainer.textContent, /stale/, "a stopped suggestion cannot replace current targets");

  await renderBrief("missing-provider", {
    capabilities: [{ provider: "codex", text: false, image: false, reason: "raw_machine_reason" }],
    onSuggest: async input => suggestedBrief(input, "unused"),
  });
  const missingProviderTopic = briefLabeledControl("Chủ đề");
  await briefEnter(missingProviderTopic, "Travel plans");
  const disabledSuggestion = [...briefContainer.querySelectorAll("button")].find(item => item.textContent.trim() === "Gợi ý mục học");
  assert.equal(disabledSuggestion?.disabled, true, "missing AI capability keeps suggestion disabled");
  assert.equal(missingProviderTopic.value, "Travel plans");
  assert.doesNotMatch(briefContainer.textContent, /raw_machine_reason/, "machine capability reasons are not exposed");

  await renderBrief("suggestion-error", { onSuggest: async () => { throw new Error("provider_failed"); } });
  const errorKeywords = briefContainer.querySelector("textarea");
  await briefEnter(errorKeywords, "check in");
  await briefClick("Gợi ý mục học");
  assert.equal(errorKeywords.value, "check in", "suggestion errors retain keyword input");
  assert.match(briefContainer.querySelector('[role="alert"]')?.textContent ?? "", /Chưa tạo được gợi ý/);

  const migration = await import(pathToFileURL(path.join(root, "src/main/db/migrations/1788701024340-create-learning-studio.js")).href);
  db = new Sequelize({ dialect: "sqlite", storage: path.join(temp, "app.sqlite"), logging: false });
  await migration.up({ context: db.getQueryInterface() });
  runtime = await LearningRuntime.open({ sequelize: db, profileId: "studio-test", assetRoot: path.join(temp, "assets"), watchdogMs: 0 });
  const controller = new LearningController(runtime);
  const bridge = { getContext: async () => ({ profileId: runtime.scope.context.profileId, connectionId: runtime.scope.context.connectionId, healthError: null, capabilities: [{ provider: "codex", text: false, image: false, reason: "native_auth_unconfirmed" }, { provider: "claude", text: false, image: false, reason: "native_version_unsupported" }] }), request: (context, action, input) => controller.request(context, action, input) };
  const container = dom.window.document.getElementById("root");
  reactRoot = createRoot(container);
  const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); }); };
  const click = async text => {
    const button = [...container.querySelectorAll("button")].find(item => item.textContent.trim() === text);
    assert.ok(button, `button not found: ${text}`);
    await act(async () => { button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
    await settle();
  };
  const enter = async (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
    await act(async () => { setter.call(element, value); element.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  };
  await act(async () => { reactRoot.render(React.createElement(LearningStudio, { bridge })); });
  await settle();
  assert.match(container.textContent, /Chưa có bài học/);
  await click("Bài học mới");
  const form = container.querySelector('form[aria-label="Tạo bản nháp bài học"]');
  assert.ok(form);
  await enter(form.querySelector('input[placeholder="Ví dụ: Gọi món ở quán cà phê"]'), "A cup of tea");
  await click("Thêm mục học thủ công (0/12)");
  const manualInputs = [...form.querySelectorAll('fieldset input[type="text"], fieldset input:not([type])')];
  const values = ["cup", "a drinking container", "A small container for a drink.", "cốc", "I have a cup of tea."];
  assert.equal(manualInputs.length, values.length);
  for (let i = 0; i < values.length; i++) await enter(manualInputs[i], values[i]);
  await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
  await settle();
  const stored = await runtime.storage.listLessons();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].title, "A cup of tea");
  const saved = await runtime.storage.getLesson(stored[0].id);
  assert.equal(saved.revisions[0].brief.targets[0].sense, "a drinking container");
  assert.equal(saved.revisions[0].status, "draft");
  const gatedGenerationButtons = [...container.querySelectorAll('div[aria-label="Tạo nội dung bằng AI"] button')];
  assert.equal(gatedGenerationButtons.length, 3);
  assert.equal(gatedGenerationButtons.every(button => button.disabled), true, "capability false never enables generation");
  await click("Kết nối AI");
  assert.match(container.textContent, /Chưa sẵn sàng tạo nội dung/);
  assert.match(container.textContent, /chưa xác nhận đăng nhập/);
  assert.match(container.textContent, /Phiên bản kết nối Claude Code hiện tại chưa được hỗ trợ/);
  assert.match(container.textContent, /Hãy kiểm tra trong Dịch vụ AI/);
  await click("Về thư viện");
  await click("Xoá bài học");
  await click("Giữ lại");
  assert.equal((await runtime.storage.listLessons()).length, 1);
  await click("Xoá bài học");
  await click("Xoá khỏi thư viện");
  assert.equal((await runtime.storage.listLessons()).length, 0);

  const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
  const layoutCalls = [];
  const layoutSaved = [];
  const layoutBusy = [];
  const firstLayout = deferred();
  let currentMap = "map-a";
  const layoutQueue = createLayoutSaveQueue(value => layoutBusy.push(value));
  layoutQueue.enqueue({
    key: "revision-a",
    run: async () => { layoutCalls.push({ revisionId: "revision-a", positions: [{ id: "root", x: 1, y: 1 }] }); await firstLayout.promise; },
    isCurrent: () => currentMap === "map-a",
    onSaved: () => layoutSaved.push("revision-a:first"),
    onError: error => { throw error; },
  });
  layoutQueue.enqueue({
    key: "revision-a",
    run: async () => { layoutCalls.push({ revisionId: "revision-a", positions: [{ id: "root", x: 3, y: 3 }] }); },
    isCurrent: () => currentMap === "map-a",
    onSaved: () => layoutSaved.push("revision-a:latest"),
    onError: error => { throw error; },
  });
  layoutQueue.enqueue({
    key: "revision-b",
    run: async () => { layoutCalls.push({ revisionId: "revision-b", positions: [{ id: "root", x: 8, y: 8 }] }); },
    isCurrent: () => currentMap === "map-b",
    onSaved: () => layoutSaved.push("revision-b"),
    onError: error => { throw error; },
  });
  assert.deepEqual(layoutCalls, [{ revisionId: "revision-a", positions: [{ id: "root", x: 1, y: 1 }] }]);
  currentMap = "map-b";
  firstLayout.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(layoutCalls.map(call => call.revisionId), ["revision-a", "revision-a", "revision-b"]);
  assert.deepEqual(layoutCalls[1].positions, [{ id: "root", x: 3, y: 3 }], "same revision coalesces to latest positions");
  assert.deepEqual(layoutCalls[2].positions, [{ id: "root", x: 8, y: 8 }], "different revision remains queued with its own ID");
  assert.deepEqual(layoutSaved, ["revision-b"], "navigation suppresses stale UI notice but does not drop persisted layout");
  assert.deepEqual(layoutBusy, [true, false]);
  layoutQueue.dispose();

  const makeLesson = (id, title) => {
    const revisionId = `${id}-revision`;
    const target = { id: "coffee", term: "coffee", sense: "a drink", definition: "A hot drink.", translationVi: "cà phê", example: "I drink coffee." };
    const content = {
      title,
      sections: [{ id: "section-one", text: `${title} content.`, targetIds: ["coffee"] }],
      glossary: [{ targetId: "coffee", definition: "A hot drink.", translationVi: "cà phê", example: "I drink coffee." }],
      scenes: [],
      exercises: [],
      entityDescriptions: [],
    };
    return {
      lesson: { id, profileId: "race", title, activeRevisionId: revisionId, createdAt: new Date(), updatedAt: new Date() },
      revisions: [{ id: revisionId, profileId: "race", lessonId: id, number: 1, brief: { topic: title, level: "A2", length: "short", imageCount: 0, audio: false, targets: [target] }, content, status: "ready", validation: {}, provenance: {}, sourceHash: null, createdAt: new Date(), updatedAt: new Date() }],
      slots: [],
      assets: [],
      practiceAttempts: [],
    };
  };
  const lessonA = makeLesson("lesson-a", "Lesson A");
  lessonA.revisions[0].status = "draft";
  const lessonB = makeLesson("lesson-b", "Lesson B");
  lessonB.revisions[0].content.scenes = [{ id: "scene-one", description: "A cup of coffee on a table.", sectionIds: ["section-one"], targetIds: ["coffee"] }];
  lessonB.slots.push(
    { id: "lesson-b-image-slot", profileId: "race", lessonRevisionId: "lesson-b-revision", mapRevisionId: null, sourceType: "scene", sourceId: "scene-one", kind: "image", sourceHash: "image-source", slotKey: "lesson-b-image", selectedAssetId: null, createdAt: new Date(), updatedAt: new Date() },
    { id: "lesson-b-audio-slot", profileId: "race", lessonRevisionId: "lesson-b-revision", mapRevisionId: null, sourceType: "section", sourceId: "section-one", kind: "audio", sourceHash: "audio-source", slotKey: "lesson-b-audio", selectedAssetId: null, createdAt: new Date(), updatedAt: new Date() },
  );
  const lessonC = makeLesson("lesson-c", "Lesson C");
  lessonC.revisions[0].status = "draft";
  const mapA = {
    map: { id: "map-a", profileId: "race", title: "Map A", lessonRevisionId: null, activeRevisionId: "map-revision-a", createdAt: new Date(), updatedAt: new Date() },
    revisions: [{ id: "map-revision-a", profileId: "race", mapId: "map-a", number: 1, brief: { level: "A2", illustrations: true }, content: { rootNodeId: "coffee", nodes: [{ id: "coffee", term: "coffee", sense: "a drink", definition: "A hot drink.", translationVi: "cà phê", example: "I drink coffee.", evidence: { status: "unverified" } }, { id: "latte", term: "latte", ipa: "ˈlɑːteɪ", sense: "coffee with milk", definition: "Coffee made with hot milk.", translationVi: "cà phê sữa", example: "She orders a latte.", evidence: { status: "unverified" } }], edges: [{ id: "coffee-latte", source: "coffee", target: "latte", kind: "related-concept", evidence: { status: "unverified" } }], studyGroups: [{ id: "coffee-drinks", title: "Coffee drinks", translationVi: "Các loại cà phê", nodeIds: ["latte"], example: "She orders a latte.", exampleTranslationVi: "Cô ấy gọi một ly cà phê sữa.", illustration: { prompt: "A warm latte in a ceramic cup", alt: "Một ly cà phê sữa ấm" } }] }, status: "ready", provenance: {}, createdAt: new Date(), updatedAt: new Date() }],
    layouts: [],
    slots: [{ id: "map-group-image-slot", profileId: "race", lessonRevisionId: null, mapRevisionId: "map-revision-a", sourceType: "group", sourceId: "coffee-drinks", kind: "image", sourceHash: "group-source", slotKey: "map-group-image", selectedAssetId: "map-group-image-selected", createdAt: new Date(), updatedAt: new Date() }],
    assets: [{ id: "map-group-image-old", profileId: "race", slotId: "map-group-image-slot", relativePath: "map-group-old.png", kind: "image", mimeType: "image/png", sha256: "old-group-image", sizeBytes: 10, width: 640, height: 360, durationMs: null, provenance: {}, createdAt: new Date(), updatedAt: new Date() }, { id: "map-group-image-selected", profileId: "race", slotId: "map-group-image-slot", relativePath: "map-group-selected.png", kind: "image", mimeType: "image/png", sha256: "selected-group-image", sizeBytes: 10, width: 640, height: 360, durationMs: null, provenance: {}, createdAt: new Date(), updatedAt: new Date() }],
  };
  const raceState = { lessons: [lessonA, lessonB, lessonC], maps: [mapA], pendingDelete: null, pendingCreate: null, pendingRevise: null, pendingGenerate: null, pendingAssetGenerate: null, narrationFailure: null, immediateCreate: false };
  const raceContext = { profileId: "race", connectionId: "race-connection", healthError: null, capabilities: [{ provider: "codex", text: true, image: true, reason: null }, { provider: "claude", text: true, image: false, reason: null }] };
  const generationCalls = [];
  const createMapCalls = [];
  const mapCreationOrder = [];
  const jobCalls = [];
  const cancelCalls = [];
  const retryCalls = [];
  const narrateCalls = [];
  const assetGenerationCalls = [];
  const generationJobs = new Map();
  const listedJobs = new Map();
  const pendingJobPoll = deferred();
  const jobSnapshot = (id, state, stages) => ({
    job: { id, profileId: "race", resourceType: "lesson", resourceId: "lesson-a", revisionId: "lesson-a-revision", requestKey: `request-${id}`, state, metadata: {}, createdAt: new Date(), updatedAt: new Date() },
    stages: stages.map((stage, index) => ({ id: `${id}-stage-${index}`, profileId: "race", jobId: id, key: stage.kind, kind: stage.kind, slotId: null, state: stage.state, activeAttemptId: null, expectedRevisionId: "lesson-a-revision", committedHash: stage.state === "completed" ? "hash" : null, createdAt: new Date(), updatedAt: new Date() })),
    attempts: [],
  });
  let getContextCalls = 0;
  const raceBridge = {
    getContext: async () => { getContextCalls += 1; return raceContext; },
    request: async (context, action, input) => {
      if (action === "list") return { lessons: raceState.lessons.map(item => item.lesson), maps: raceState.maps.map(item => item.map) };
      if (action === "getLesson") return raceState.lessons.find(item => item.lesson.id === input.id);
      if (action === "getMap") return raceState.maps.find(item => item.map.id === input.id);
      if (action === "listJobs") return listedJobs.get(`${input.resourceType}:${input.resourceId}`) ?? [];
      if (action === "deleteLesson") {
        const wait = deferred();
        raceState.pendingDelete = wait;
        await wait.promise;
        raceState.lessons = raceState.lessons.filter(item => item.lesson.id !== input.id);
        if (raceState.cleanupFailure) throw new Error("learning_asset_cleanup_failed");
        return { deleted: true };
      }
      if (action === "createMap") {
        createMapCalls.push(input);
        mapCreationOrder.push("createMap");
        if (raceState.immediateCreate) {
          const result = { ...mapA, map: { ...mapA.map, id: "map-generated", title: input.title, activeRevisionId: "map-revision-generated" }, revisions: [{ ...mapA.revisions[0], id: "map-revision-generated", mapId: "map-generated", status: "draft", content: {} }] };
          raceState.maps.push(result);
          return { map: result.map, revision: result.revisions[0] };
        }
        const wait = deferred();
        raceState.pendingCreate = wait;
        const result = await wait.promise;
        raceState.maps.push(result);
        return { map: result.map, revision: result.revisions[0] };
      }
      if (action === "reviseLesson") {
        const wait = deferred();
        raceState.pendingRevise = wait;
        await wait.promise;
        return { lesson: lessonB.lesson, revision: lessonB.revisions[0] };
      }
      if (action === "saveMapLayout") return { mapRevision: mapA.revisions[0], layout: input.positions };
      if (action === "generate") {
        generationCalls.push(input);
        if (input.resourceType === "map") mapCreationOrder.push("generate");
        if (input.resourceId === "lesson-c") {
          const wait = deferred();
          raceState.pendingGenerate = wait;
          return wait.promise;
        }
        const jobId = `job-${generationCalls.length}`;
        generationJobs.set(jobId, generationCalls.length === 1
          ? [jobSnapshot(jobId, "running", [{ kind: "text", state: "running" }]), jobSnapshot(jobId, "completed", [{ kind: "text", state: "completed" }])]
          : generationCalls.length === 2
            ? pendingJobPoll
          : generationCalls.length === 5
            ? [jobSnapshot(jobId, "failed", [{ kind: "text", state: "failed" }])]
            : [jobSnapshot(jobId, "running", [{ kind: "text", state: "running" }])]);
        return { jobId };
      }
      if (action === "generateAsset") {
        assetGenerationCalls.push({ context: { profileId: context.profileId, connectionId: context.connectionId }, input });
        if (raceState.pendingAssetGenerate) return raceState.pendingAssetGenerate.promise;
        if (input.slotId === "lesson-b-audio-slot") throw new Error("learning_speech_not_configured");
        const running = jobSnapshot("job-asset-image", "running", [{ kind: "image", state: "running" }]);
        const completed = jobSnapshot("job-asset-image", "completed", [{ kind: "image", state: "completed" }]);
        for (const snapshot of [running, completed]) {
          snapshot.job.resourceId = input.resourceId;
          snapshot.job.revisionId = input.revisionId;
          snapshot.stages[0].slotId = input.slotId;
          snapshot.stages[0].expectedRevisionId = input.revisionId;
        }
        generationJobs.set("job-asset-image", [running, completed]);
        return { jobId: "job-asset-image" };
      }
      if (action === "job") {
        jobCalls.push(input.id);
        const snapshots = generationJobs.get(input.id);
        if (snapshots?.promise) return snapshots.promise;
        assert.ok(snapshots?.length, `missing job snapshot: ${input.id}`);
        const snapshot = snapshots.length > 1 ? snapshots.shift() : snapshots[0];
        if (input.id === "job-asset-image" && snapshot.job.state === "completed" && lessonB.assets.length === 0) {
          const currentLesson = raceState.lessons.find(item => item.lesson.id === "lesson-b");
          raceState.lessons = raceState.lessons.map(item => item.lesson.id === "lesson-b" ? {
            ...currentLesson,
            slots: currentLesson.slots.map(slot => slot.id === "lesson-b-image-slot" ? { ...slot, selectedAssetId: "lesson-b-image-asset" } : slot),
            assets: [...currentLesson.assets, { id: "lesson-b-image-asset", profileId: "race", slotId: "lesson-b-image-slot", relativePath: "lesson-b-image.png", kind: "image", mimeType: "image/png", sha256: "image-hash", sizeBytes: 10, width: 640, height: 360, durationMs: null, provenance: {}, createdAt: new Date(), updatedAt: new Date() }],
          } : item);
        }
        if (input.id === "job-narration" && snapshot.job.state === "completed" && !mapA.assets.some(asset => asset.id === "node-audio-asset")) {
          mapA.slots.push({ id: "node-audio-slot", profileId: "race", lessonRevisionId: null, mapRevisionId: "map-revision-a", sourceType: "node", sourceId: "latte", kind: "audio", sourceHash: "source-hash", slotKey: "node-audio", selectedAssetId: "node-audio-asset", createdAt: new Date(), updatedAt: new Date() });
          mapA.assets.push({ id: "node-audio-asset", profileId: "race", slotId: "node-audio-slot", relativePath: "node-audio.mp3", kind: "audio", mimeType: "audio/mpeg", sha256: "asset-hash", sizeBytes: 10, width: null, height: null, durationMs: 1_000, provenance: {}, createdAt: new Date(), updatedAt: new Date() });
        }
        return snapshot;
      }
      if (action === "cancelJob") {
        cancelCalls.push(input.id);
        generationJobs.set(input.id, [jobSnapshot(input.id, "cancelled", [{ kind: "text", state: "cancelled" }])]);
        return { cancelled: true };
      }
      if (action === "retryGeneration") {
        retryCalls.push(input);
        generationJobs.set(input.jobId, [
          jobSnapshot(input.jobId, "running", [{ kind: "text", state: "running" }]),
          jobSnapshot(input.jobId, "completed", [{ kind: "text", state: "completed" }]),
        ]);
        return { jobId: input.jobId };
      }
      if (action === "narrateMapNode") {
        if (raceState.narrationFailure) throw new Error(raceState.narrationFailure);
        narrateCalls.push(input);
        const running = jobSnapshot("job-narration", "running", [{ kind: "audio", state: "running" }]);
        const completed = jobSnapshot("job-narration", "completed", [{ kind: "audio", state: "completed" }]);
        for (const snapshot of [running, completed]) {
          snapshot.job.resourceType = "map";
          snapshot.job.resourceId = input.mapId;
          snapshot.job.revisionId = input.revisionId;
          snapshot.stages[0].expectedRevisionId = input.revisionId;
        }
        generationJobs.set("job-narration", [running, completed]);
        return { jobId: "job-narration", assetId: null };
      }
      throw new Error(`unexpected_${action}`);
    },
  };
  raceContainer = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(raceContainer);
  raceRoot = createRoot(raceContainer);
  const raceSettle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
  const raceClick = async (text) => {
    const button = [...raceContainer.querySelectorAll("button")].find(item => item.textContent.trim() === text);
    assert.ok(button, `race button not found: ${text}`);
    await act(async () => { button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
    await raceSettle();
  };
  const raceEnter = async (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
    await act(async () => { setter.call(element, value); element.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  };
  const raceSelect = async (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value").set;
    await act(async () => { setter.call(element, value); element.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  };
  const raceLabeledControl = (text, scope = raceContainer) => {
    const label = [...scope.querySelectorAll("label")].find(item => item.textContent.trim().startsWith(text));
    assert.ok(label, `race label not found: ${text}`);
    const control = label.querySelector("input, select, textarea");
    assert.ok(control, `race control not found: ${text}`);
    return control;
  };

  const lateCapabilities = deferred();
  const uncheckedContext = { profileId: "late", connectionId: "late-connection", healthError: null, capabilities: [{ provider: "codex", text: false, image: false, reason: "native_not_checked" }, { provider: "claude", text: false, image: false, reason: "native_not_checked" }] };
  const readyLateContext = { ...uncheckedContext, capabilities: [{ provider: "codex", text: true, image: true, reason: null }, { provider: "claude", text: true, image: false, reason: null }] };
  const lateBridge = {
    getContext: async options => options?.refreshCapabilities ? lateCapabilities.promise : uncheckedContext,
    request: async (_context, action) => {
      if (action === "list") return { lessons: [], maps: [] };
      throw new Error(`unexpected_late_${action}`);
    },
  };
  let settingReads = 0;
  dom.window.__ENJOY_APP__ = { userSettings: { get: async () => { settingReads += 1; if (settingReads === 1) throw new Error("settings_not_ready"); return { name: "claude-acp" }; } } };
  lateContainer = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(lateContainer);
  lateRoot = createRoot(lateContainer);
  await act(async () => { lateRoot.render(React.createElement(LearningStudio, { bridge: lateBridge })); });
  await raceSettle();
  const lateNewMapButton = [...lateContainer.querySelectorAll("button")].find(button => button.textContent.trim() === "Mindmap mới");
  await act(async () => { lateNewMapButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  await raceSettle();
  const lateImageToggle = [...lateContainer.querySelectorAll("label")].find(label => label.textContent.trim().startsWith("Tạo hình minh họa"))?.querySelector("input");
  assert.equal(lateImageToggle?.disabled, true, "unchecked image capability keeps the option disabled without finalizing its default");
  assert.equal(lateImageToggle?.checked, false);
  await act(async () => { lateCapabilities.resolve(readyLateContext); await new Promise(resolve => setTimeout(resolve, 0)); });
  await raceSettle();
  assert.equal(lateImageToggle.disabled, false, "late capability refresh enables the illustration option");
  assert.equal(lateImageToggle.checked, true, "late image capability applies the untouched default");
  const lateProvider = [...lateContainer.querySelectorAll("label")].find(label => label.textContent.trim().startsWith("Dịch vụ AI"))?.querySelector("select");
  assert.equal(lateProvider?.value, "claude", "late capability refresh applies the configured ready ACP provider");
  await act(async () => { lateRoot.unmount(); });
  lateRoot = null;
  lateContainer.remove();
  lateContainer = null;
  delete dom.window.__ENJOY_APP__;

  await act(async () => { raceRoot.render(React.createElement(LearningStudio, { bridge: raceBridge })); });
  await raceSettle();
  await raceClick("Kết nối AI");
  assert.match(raceContainer.textContent, /Claude Code(Chữ và hình|Chữ)Có thể tạo nội dung/);
  await raceClick("Kiểm tra lại kết nối");
  assert.equal(getContextCalls, 2, "connection refresh probes the native capabilities again");
  await raceClick("Về thư viện");
  await raceClick("Lesson A");
  const claudeGenerate = [...raceContainer.querySelectorAll("button")].find(item => item.textContent.trim() === "Tạo bằng Claude Code");
  assert.equal(claudeGenerate?.disabled, false, "ready provider can be chosen explicitly");
  await raceClick("Tạo bằng Codex");
  assert.deepEqual(generationCalls[0], { provider: "codex", model: undefined, resourceType: "lesson", resourceId: "lesson-a", revisionId: "lesson-a-revision", requestKey: generationCalls[0].requestKey });
  assert.match(generationCalls[0].requestKey, /^[A-Za-z0-9._-]{1,128}$/);
  assert.match(raceContainer.textContent, /Đang tạo nội dung/);
  assert.match(raceContainer.textContent, /0\/1 bước đã nhận/);
  assert.match(raceContainer.textContent, /Nội dung bài/);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1_100)); });
  await raceSettle();
  assert.match(raceContainer.textContent, /Đã tạo xong nội dung/);
  assert.ok(jobCalls.filter(id => id === "job-1").length >= 2, "active job is polled until terminal");

  await raceClick("Lesson B");
  await raceClick("Tạo lại ảnh cảnh");
  assert.deepEqual(assetGenerationCalls[0], {
    context: { profileId: "race", connectionId: "race-connection" },
    input: { resourceType: "lesson", resourceId: "lesson-b", revisionId: "lesson-b-revision", slotId: "lesson-b-image-slot", requestKey: assetGenerationCalls[0].input.requestKey },
  });
  assert.match(assetGenerationCalls[0].input.requestKey, /^[A-Za-z0-9._-]{1,128}$/);
  assert.ok([...raceContainer.querySelectorAll("button")].some(button => button.textContent.trim() === "Dừng tạo"), "asset generation exposes cancellation while its stage is active");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1_100)); });
  await raceSettle();
  assert.match(raceContainer.querySelector('[data-testid="lesson-scene-image-scene-one"]')?.src ?? "", /lesson-b-image\.png$/, "completed asset polling refreshes the lesson bundle");
  await raceClick("Tạo lại audio đoạn");
  assert.deepEqual(assetGenerationCalls[1].input, { resourceType: "lesson", resourceId: "lesson-b", revisionId: "lesson-b-revision", slotId: "lesson-b-audio-slot", requestKey: assetGenerationCalls[1].input.requestKey });
  assert.match(raceContainer.querySelector('[role="alert"]')?.textContent ?? "", /chọn dịch vụ TTS trong Cài đặt/);

  raceState.pendingAssetGenerate = deferred();
  await raceClick("Tạo lại ảnh cảnh");
  await raceClick("Lesson A");
  generationJobs.set("job-asset-stale", [jobSnapshot("job-asset-stale", "running", [{ kind: "image", state: "running" }])]);
  raceState.pendingAssetGenerate.resolve({ jobId: "job-asset-stale" });
  await raceSettle();
  assert.equal(jobCalls.includes("job-asset-stale"), false, "navigation prevents polling a stale asset generation result");
  raceState.pendingAssetGenerate = null;

  await raceClick("Tạo bằng Codex");
  assert.match(raceContainer.textContent, /Đang bắt đầu tác vụ tạo nội dung/);
  listedJobs.set("lesson:lesson-a", [jobSnapshot("job-2", "running", [{ kind: "text", state: "running" }]).job]);
  await raceClick("Lesson B");
  await raceClick("Lesson A");
  assert.ok([...raceContainer.querySelectorAll("button")].some(button => button.textContent.trim() === "Dừng tạo"), "revisit restores an active job and keeps cancellation available");
  await raceClick("Dừng tạo");
  assert.deepEqual(cancelCalls, ["job-2"]);
  assert.match(raceContainer.textContent, /Đã dừng tạo nội dung/);
  await act(async () => { pendingJobPoll.resolve(jobSnapshot("job-2", "running", [{ kind: "text", state: "running" }])); await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.match(raceContainer.textContent, /Đã dừng tạo nội dung/, "late poll cannot overwrite cancellation result");
  listedJobs.delete("lesson:lesson-a");

  await raceClick("Lesson C");
  await raceClick("Tạo bằng Codex");
  assert.ok(raceState.pendingGenerate, "generation should be deferred");
  await raceClick("Map A");
  await act(async () => { raceState.pendingGenerate.resolve({ jobId: "stale-job" }); await new Promise(resolve => setTimeout(resolve, 0)); });
  await raceSettle();
  assert.equal(jobCalls.includes("stale-job"), false, "navigation prevents polling a stale generation result");
  assert.equal([...raceContainer.querySelectorAll("h2")].find(item => item.textContent === "Map A")?.textContent, "Map A");
  assert.equal([...raceContainer.querySelectorAll("button")].find(button => button.textContent.trim() === "Tạo bằng Codex")?.disabled, true, "ready revision cannot start immutable content generation");
  assert.match(raceContainer.textContent, /bản nháp mới/);
  const groupIllustration = raceContainer.querySelector('[data-testid="study-map-image-coffee-drinks"]');
  assert.ok(groupIllustration, "map view renders the study-group illustration slot");
  const selectedGroupImage = groupIllustration.querySelector("img");
  assert.ok(selectedGroupImage, `selected group image should render instead of: ${groupIllustration.textContent.trim()}`);
  assert.match(selectedGroupImage.src, /map-group-selected\.png$/, "map view resolves the selected group image from the displayed revision");
  assert.equal(selectedGroupImage.alt, "Một ly cà phê sữa ấm");
  const speakLatte = raceContainer.querySelector('[data-testid="mindmap-speak-node-latte"]');
  assert.ok(speakLatte, "mindmap study page exposes node narration");
  await act(async () => { speakLatte.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  await raceSettle();
  assert.deepEqual(narrateCalls[0], { mapId: "map-a", revisionId: "map-revision-a", nodeId: "latte", requestKey: narrateCalls[0].requestKey });
  assert.match(narrateCalls[0].requestKey, /^[A-Za-z0-9._-]{1,128}$/);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1_100)); });
  await raceSettle();
  const nodeAudio = raceContainer.querySelector('audio[aria-label="Nghe phát âm từ latte"]');
  assert.ok(nodeAudio);
  assert.match(nodeAudio.src, /node-audio\.mp3$/);
  await act(async () => { raceContainer.querySelector('[data-testid="mindmap-speak-node-latte"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
  await raceSettle();
  assert.equal(narrateCalls.length, 1, "selected node audio plays without creating another job");
  mapA.slots.length = 0;
  mapA.assets.length = 0;
  for (const [errorCode, expectedMessage] of [
    ["learning_speech_auth", /kiểm tra credential TTS trong Cài đặt/],
    ["learning_speech_network", /kiểm tra kết nối tới dịch vụ TTS/],
    ["learning_speech_quota", /đã hết hạn mức sử dụng/],
  ]) {
    raceState.narrationFailure = errorCode;
    await act(async () => { raceContainer.querySelector('[data-testid="mindmap-speak-node-latte"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
    await raceSettle();
    assert.match(raceContainer.querySelector('[role="alert"]')?.textContent ?? "", expectedMessage);
  }
  raceState.narrationFailure = null;

  const createCountBeforeMissingProvider = createMapCalls.length;
  raceContext.capabilities[0] = { provider: "codex", text: false, image: false, reason: "native_auth_unconfirmed" };
  raceContext.capabilities[1] = { provider: "claude", text: false, image: false, reason: "native_binary_missing" };
  await raceClick("Mindmap mới");
  const unavailableMapForm = raceContainer.querySelector('form[aria-label="Tạo trang sơ đồ học"]');
  assert.ok(unavailableMapForm, "the map form has a stable accessible name");
  const retainedTopic = raceLabeledControl("Chủ đề hoặc từ khóa", unavailableMapForm);
  await raceEnter(retainedTopic, "Travel without a provider");
  await act(async () => { unavailableMapForm.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
  await raceSettle();
  assert.equal(createMapCalls.length, createCountBeforeMissingProvider, "missing text capability does not create an unusable draft");
  assert.equal(retainedTopic.value, "Travel without a provider", "missing text capability retains the topic input");
  assert.match(raceContainer.querySelector('[role="alert"]')?.textContent ?? "", /Chưa có dịch vụ AI tạo chữ sẵn sàng/);
  raceContext.capabilities[0] = { provider: "codex", text: true, image: true, reason: null };
  raceContext.capabilities[1] = { provider: "claude", text: true, image: false, reason: null };
  await raceClick("Quay lại");

  raceState.immediateCreate = true;
  await raceClick("Mindmap mới");
  const mapForm = raceContainer.querySelector('form[aria-label="Tạo trang sơ đồ học"]');
  assert.ok(mapForm);
  assert.match(mapForm.textContent, /Trang sơ đồ minh họa/);
  assert.equal(raceLabeledControl("Trình độ", mapForm).value, "A2", "new map defaults to A2");
  assert.equal(raceLabeledControl("Tạo hình minh họa", mapForm).checked, true, "image-capable Codex enables illustrations by default");
  assert.equal(mapForm.querySelector("summary")?.textContent.trim(), "Tuỳ chọn nâng cao");
  assert.equal(raceLabeledControl("Dịch vụ AI", mapForm).value, "codex");
  await raceEnter(raceLabeledControl("Chủ đề hoặc từ khóa", mapForm), "Generated map");
  const creationOrderStart = mapCreationOrder.length;
  await act(async () => { mapForm.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
  await raceSettle();
  assert.deepEqual(createMapCalls.at(-1), { title: "Generated map", level: "A2", illustrations: true }, "one-submit map creation persists its brief");
  assert.deepEqual(mapCreationOrder.slice(creationOrderStart, creationOrderStart + 2), ["createMap", "generate"], "one submit creates the draft before starting generation");
  assert.equal([...raceContainer.querySelectorAll("h2")].find(item => item.textContent === "Generated map")?.textContent, "Generated map", "created draft opens while generation continues");
  assert.deepEqual(generationCalls[3], { provider: "codex", model: undefined, resourceType: "map", resourceId: "map-generated", revisionId: "map-revision-generated", requestKey: generationCalls[3].requestKey });
  await raceClick("Dừng tạo");
  assert.deepEqual(cancelCalls, ["job-2", "job-4"]);
  raceState.immediateCreate = false;

  await raceClick("Lesson A");
  await raceClick("Tạo bằng Codex");
  assert.match(raceContainer.querySelector('[role="alert"]')?.textContent ?? "", /Không thể tạo nội dung bằng AI/);
  const failedPollCount = jobCalls.filter(id => id === "job-5").length;
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1_100)); });
  assert.equal(jobCalls.filter(id => id === "job-5").length, failedPollCount, "failed stage waits for an explicit retry");
  assert.match(raceContainer.textContent, /Thử lại/);
  const retryProviderSelect = [...raceContainer.querySelectorAll("select")].find(select => select.closest("label")?.textContent.includes("Dịch vụ AI"));
  assert.ok(retryProviderSelect);
  await raceSelect(retryProviderSelect, "claude");
  await raceClick("Thử lại");
  assert.deepEqual(retryCalls[0], { jobId: "job-5", stageId: "job-5-stage-0", provider: "claude", model: undefined });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1_100)); });
  await raceSettle();
  assert.match(raceContainer.textContent, /Đã tạo xong nội dung/);

  const interrupted = jobSnapshot("job-interrupted", "interrupted", [{ kind: "text", state: "interrupted" }]);
  interrupted.job.resourceId = "lesson-b";
  interrupted.job.revisionId = "lesson-b-revision";
  interrupted.stages[0].expectedRevisionId = "lesson-b-revision";
  generationJobs.set("job-interrupted", [interrupted]);
  listedJobs.set("lesson:lesson-b", [interrupted.job]);
  await raceClick("Lesson B");
  assert.match(raceContainer.textContent, /bị gián đoạn.*[Tt]hử lại/);
  assert.doesNotMatch(raceContainer.textContent, /đang chờ khôi phục/);
  const interruptedPollCount = jobCalls.filter(id => id === "job-interrupted").length;
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1_100)); });
  assert.equal(jobCalls.filter(id => id === "job-interrupted").length, interruptedPollCount, "interrupted stage never retries implicitly");
  listedJobs.delete("lesson:lesson-b");

  const historical = jobSnapshot("job-historical", "interrupted", [{ kind: "text", state: "interrupted" }]);
  historical.job.resourceId = "lesson-b";
  historical.job.revisionId = "lesson-b-historical-revision";
  historical.stages[0].expectedRevisionId = "lesson-b-historical-revision";
  generationJobs.set("job-historical", [historical]);
  listedJobs.set("lesson:lesson-b", [historical.job]);
  await raceClick("Lesson B");
  assert.match(raceContainer.textContent, /Tác vụ này thuộc một phiên bản khác/);
  assert.equal([...raceContainer.querySelectorAll("button")].some(button => button.textContent.trim() === "Thử lại"), false, "historical generation cannot retry against the active revision");
  listedJobs.delete("lesson:lesson-b");

  const partial = jobSnapshot("job-partial", "partial", [{ kind: "text", state: "completed" }, { kind: "image", state: "failed" }, { kind: "audio", state: "failed" }]);
  partial.job.resourceType = "map";
  partial.job.resourceId = "map-a";
  partial.job.revisionId = "map-revision-a";
  for (const stage of partial.stages) stage.expectedRevisionId = "map-revision-a";
  partial.attempts.push({ id: "audio-attempt", profileId: "race", stageId: "job-partial-stage-2", ordinal: 1, state: "failed", provider: "codex", providerSessionId: null, providerItemIds: [], errorCode: "speech_not_configured", startedAt: new Date(), finishedAt: new Date(), metadata: {}, createdAt: new Date(), updatedAt: new Date() });
  generationJobs.set("job-partial", [partial]);
  listedJobs.set("map:map-a", [partial.job]);
  await raceClick("Map A");
  assert.match(raceContainer.textContent, /Đã nhận một phần.*[Tt]hử lại/);
  assert.match(raceContainer.textContent, /chọn dịch vụ TTS trong Cài đặt/);
  assert.match(raceContainer.textContent, /Dùng dịch vụ TTS đã cấu hình/);
  assert.match(raceContainer.textContent, /Tạo hình bằng Codex/);
  const partialPollCount = jobCalls.filter(id => id === "job-partial").length;
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1_100)); });
  assert.equal(jobCalls.filter(id => id === "job-partial").length, partialPollCount, "partial job without active stages waits for manual retry");
  await raceClick("Thử lại");
  assert.deepEqual(retryCalls[1], { jobId: "job-partial", stageId: "job-partial-stage-1", provider: "codex", model: undefined }, "image retry is always pinned to Codex");
  await raceClick("Dừng tạo");
  listedJobs.delete("map:map-a");

  await raceClick("Lesson A");
  await raceClick("Xoá bài học");
  await raceClick("Xoá khỏi thư viện");
  assert.ok(raceState.pendingDelete, "delete should be deferred");
  await raceClick("Lesson B");
  raceState.pendingDelete.resolve();
  await raceSettle();
  assert.equal(raceContainer.querySelector('[data-testid="lesson-reader-heading"]')?.textContent, "Lesson B", "deleting A must not clear the newly opened B");

  await raceClick("Mindmap mới");
  await raceEnter(raceContainer.querySelector('input[placeholder="Ví dụ: coffee, travel, work"]'), "new map");
  const deferredMapForm = raceContainer.querySelector('form[aria-label="Tạo trang sơ đồ học"]');
  const createCountBeforeDeferred = createMapCalls.length;
  await act(async () => {
    deferredMapForm.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    deferredMapForm.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  });
  assert.ok(raceState.pendingCreate, "map creation should be deferred");
  assert.equal(createMapCalls.length, createCountBeforeDeferred + 1, "an in-flight map submit cannot create duplicate drafts");
  await raceClick("Lesson B");
  raceState.pendingCreate.resolve({ ...mapA, map: { ...mapA.map, id: "map-created", title: "Created map" }, revisions: [{ ...mapA.revisions[0], id: "map-revision-created", mapId: "map-created" }] });
  await raceSettle();
  assert.equal(raceContainer.querySelector('[data-testid="lesson-reader-heading"]')?.textContent, "Lesson B", "late createMap must not replace the newly opened lesson");

  await raceClick("Luyện tập");
  await raceClick("Đọc & nghe");
  await raceClick("Sửa bài");
  await raceClick("Lưu thành bản mới");
  assert.ok(raceState.pendingRevise, "revision save should be deferred");
  await raceClick("Map A");
  raceState.pendingRevise.resolve();
  await raceSettle();
  assert.equal([...raceContainer.querySelectorAll("h2")].find(item => item.textContent === "Map A")?.textContent, "Map A", "late revision save must not replace the newly opened map");
  await raceClick("Lesson C");
  await raceClick("Xoá bài học");
  await raceClick("Xoá khỏi thư viện");
  await raceClick("Mindmap mới");
  await raceClick("Quay lại");
  raceState.pendingDelete.resolve();
  await raceSettle();
  assert.equal(raceContainer.querySelector('[data-testid="lesson-reader-heading"]') === null, true, "returning from another mode must not retain a deleted lesson");
  await raceClick("Lesson B");
  raceState.cleanupFailure = true;
  await raceClick("Xoá bài học");
  await raceClick("Xoá khỏi thư viện");
  raceState.pendingDelete.resolve();
  await raceSettle();
  assert.equal(raceContainer.querySelector('[data-testid="lesson-reader-heading"]') === null, true, "committed deletion must clear the removed lesson even if file cleanup fails");
  assert.ok(![...raceContainer.querySelectorAll("aside button")].some(button => button.textContent.trim() === "Lesson B"));
  assert.match(raceContainer.querySelector('[role="alert"]')?.textContent ?? "", /mở lại app để thử dọn tiếp/);
  console.log("PASS: Studio keeps false capabilities gated; create, generate, poll, progress, cancel, refresh, failure, and navigation races pass; real controller + SQLite draft flow and layout queue remain covered.");
} finally {
  if (reactRoot) { const { act } = await import("react"); await act(async () => reactRoot.unmount()); }
  if (briefRoot) { const { act } = await import("react"); await act(async () => briefRoot.unmount()); }
  if (raceRoot) { const { act } = await import("react"); await act(async () => raceRoot.unmount()); }
  if (lateRoot) { const { act } = await import("react"); await act(async () => lateRoot.unmount()); }
  briefContainer?.remove();
  raceContainer?.remove();
  lateContainer?.remove();
  dom?.window.close();
  await runtime?.close();
  await db?.close();
  await rm(temp, { recursive: true, force: true });
}
