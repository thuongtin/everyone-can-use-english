/* eslint-disable no-empty-pattern -- Electron tests receive TestInfo without creating a browser fixture. */
import { expect, test } from "@playwright/test";
import { launchLocalApp, type LocalApp } from "./helpers/local-app";
import { createRequire } from "node:module";
const { learningDraft, learningMap } = createRequire(import.meta.url)("../scripts/fixtures/learning-lesson.mjs");

test.describe.configure({ mode: "serial" });
let fixture: LocalApp | undefined;
test.beforeAll(async () => { fixture = await launchLocalApp({ offline: true }); });
test.afterAll(async () => { await fixture?.close(); });
test.afterEach(async ({}, testInfo) => {
  if (fixture && testInfo.status !== testInfo.expectedStatus) {
    await fixture.page.screenshot({ path: testInfo.outputPath("learning-failure.png"), fullPage: true }).catch(() => undefined);
  }
});

test("local Studio uses packaged preload, SQLite, practice, graph and scoped audio across restart", async ({}, testInfo) => {
  test.setTimeout(180_000);
  testInfo.annotations.push({ type: "local-fixture", description: "Actual packaged local profile and SQLite; lesson and graph are hand-authored fixtures, audio is a generated tone; native inference and physical microphone are not covered" });
  let page = fixture!.page;
  await page.getByTestId("sidebar-learning-studio").click();
  await expect(page.getByTestId("learning-studio")).toBeVisible();
  await page.getByRole("button", { name: "Bài học mới", exact: true }).click();
  const form = page.getByRole("form", { name: "Tạo bản nháp bài học" });
  await form.getByLabel("Chủ đề", { exact: false }).fill("A cup of tea");
  await form.getByText("Tuỳ chọn nâng cao", { exact: true }).click();
  await form.getByLabel(/^Độ dài/).selectOption("short");
  await form.getByLabel("Số hình minh hoạ").selectOption("0");
  await form.getByLabel("Tạo giọng đọc cho bài học").uncheck();
  await form.getByRole("button", { name: /^Thêm mục học thủ công/ }).click();
  const manualTarget = form.getByRole("group", { name: "Mục nhập tay 1" });
  await manualTarget.getByLabel("Từ hoặc cụm từ", { exact: true }).fill("cup");
  await manualTarget.getByLabel("Nghĩa muốn học", { exact: true }).fill("a drinking container");
  await manualTarget.getByLabel("Giải thích bằng tiếng Anh").fill("A small container for a drink.");
  await manualTarget.getByLabel("Nghĩa tiếng Việt").fill("cốc");
  await manualTarget.getByLabel("Câu ví dụ tiếng Anh").fill("I have a cup of tea.");
  await form.getByRole("button", { name: "Lưu bản nháp", exact: true }).click();
  await expect(page.getByText("Đã lưu bản nháp và tập từ bạn chọn.", { exact: true }).last()).toBeVisible();

  const authored = structuredClone(learningDraft);
  const ids = await page.evaluate(async ({ content, graph }) => {
    const api = window.__ENJOY_APP__.learning;
    const context = await api.getContext();
    const library = await api.request(context, "list", {});
    const lessonId = library.lessons[0].id;
    const bundle = await api.request(context, "getLesson", { id: lessonId });
    const old = bundle.revisions[0];
    const targetId = (old.brief as { targets: { id: string }[] }).targets[0].id;
    for (const section of content.sections) section.targetIds = [targetId];
    for (const entry of content.glossary) entry.targetId = targetId;
    for (const exercise of content.exercises) exercise.targetIds = [targetId];
    const revised = await api.request(context, "reviseLesson", { lessonId, expectedRevisionId: old.id, brief: old.brief as never, content: content as never });
    const createdMap = await api.request(context, "createMap", { title: "Cup and tea", lessonRevisionId: revised.revision.id });
    const map = await api.request(context, "reviseMap", { mapId: createdMap.map.id, expectedRevisionId: createdMap.revision.id, content: graph as never });
    await api.request(context, "saveMapLayout", { mapRevisionId: map.revision.id, positions: [{ id: "cup", x: 121, y: 27 }, { id: "tea", x: 400, y: 190 }] });
    return { lessonId, revisionId: revised.revision.id, mapId: map.map.id, mapRevisionId: map.revision.id, context };
  }, { content: authored, graph: learningMap });
  await page.reload();
  await page.getByTestId("sidebar-learning-studio").click();
  await page.getByRole("button", { name: "A cup of tea", exact: true }).click();
  await expect(page.getByTestId("lesson-reader")).toContainText("My friend has a cup of coffee");
  await page.getByRole("button", { name: "Luyện tập", exact: true }).click();
  await page.getByTestId("practice-fill-input-fill-cup").fill("dog");
  await page.getByTestId("practice-submit-fill-cup").click();
  await expect(page.getByTestId("practice-feedback-fill-cup")).toContainText("Cần luyện thêm");
  await page.getByTestId("practice-fill-input-fill-cup").fill("cup");
  await page.getByTestId("practice-submit-fill-cup").click();
  await expect(page.getByTestId("practice-feedback-fill-cup")).toContainText("Đúng");
  await page.screenshot({ path: testInfo.outputPath("learning-practice.png"), fullPage: true });

  const audio = await page.evaluate(async ({ revisionId }) => {
    const api = window.__ENJOY_APP__.learning;
    const context = await api.getContext();
    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    const destination = audioContext.createMediaStreamDestination();
    const silentOutput = audioContext.createGain();
    silentOutput.gain.value = 0;
    oscillator.connect(destination);
    oscillator.connect(silentOutput); silentOutput.connect(audioContext.destination);
    await audioContext.resume();
    oscillator.start();
    const recorder = new MediaRecorder(destination.stream, { mimeType: "audio/webm;codecs=opus" });
    const chunks: BlobPart[] = [];
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 5000);
      recorder.ondataavailable = event => {
        if (event.data.size) {
          chunks.push(event.data);
          if (recorder.state === "recording") recorder.stop();
        }
      };
      recorder.onstop = () => {
        clearTimeout(timeout);
        if (chunks.length) resolve(); else reject(new Error("Chromium MediaRecorder produced no audio within five seconds"));
      };
      recorder.onerror = () => { clearTimeout(timeout); reject(new Error("Chromium MediaRecorder failed")); };
      recorder.start(100);
    });
    oscillator.stop(); oscillator.disconnect(); silentOutput.disconnect();
    destination.stream.getTracks().forEach(track => track.stop());
    await audioContext.close();
    const encoded = new Uint8Array(await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer());
    const audioOnly = await api.request(context, "practice", { lessonRevisionId: revisionId, questionId: "retell-cup", answer: "", recording: { bytes: encoded, mimeType: recorder.mimeType } }).catch(error => {
      throw new Error(`Recording submit failed (${recorder.mimeType}, ${encoded.byteLength} bytes): ${error.message}`);
    });
    if (audioOnly.grade.correct !== null || audioOnly.grade.feedbackCode !== "self_review") throw new Error("Audio-only retell grade is invalid");
    const bytes = new Uint8Array(44 + 16000);
    const view = new DataView(bytes.buffer);
    const put = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
    put(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); put(8, "WAVE"); put(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); put(36, "data"); view.setUint32(40, 16000, true);
    for (let i = 0; i < 8000; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 440 * i / 8000) * 2000), true);
    const saved = await api.request(context, "practice", { lessonRevisionId: revisionId, questionId: "retell-cup", answer: "I have a cup of tea.", recording: { bytes, mimeType: "audio/wav" } });
    const library = await api.request(context, "list", {});
    const bundle = await api.request(context, "getLesson", { id: library.lessons[0].id });
    const asset = bundle.assets.find(item => item.id === saved.attempt.recordingAssetId)!;
    const url = `enjoy://library/learning-assets/${context.connectionId}/${asset.relativePath}`;
    const response = await fetch(url, { headers: { Range: "bytes=0-43" } });
    const data = await response.arrayBuffer();
    return { url, status: response.status, contentType: response.headers.get("content-type"), size: data.byteLength, id: asset.id };
  }, ids);
  expect(audio.status).toBe(206);
  expect(audio.contentType).toBe("audio/wav");
  expect(audio.size).toBe(44);
  const playback = await page.evaluate(async (url) => {
    const player = new Audio(url);
    player.muted = true;
    await new Promise<void>((resolve, reject) => {
      player.onloadedmetadata = () => resolve();
      player.onerror = () => reject(new Error("Fixture audio did not decode"));
    });
    await player.play();
    await new Promise<void>(resolve => { player.ontimeupdate = () => { if (player.currentTime > 0) resolve(); }; });
    const result = { duration: player.duration, currentTime: player.currentTime };
    player.pause(); player.src = "";
    return result;
  }, audio.url);
  expect(playback.duration).toBeCloseTo(1, 1);
  expect(playback.currentTime).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Cup and tea", exact: true }).click();
  await expect(page.getByTestId("mindmap-list-node-cup")).toBeVisible();
  await page.getByTestId("mindmap-list-node-tea").click();
  await expect(page.getByTestId("mindmap-list-node-tea")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("mindmap-list-node-cup").focus();
  await page.getByTestId("mindmap-list-node-cup").press("Enter");
  await expect(page.getByTestId("mindmap-list-node-cup")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("study-map-page")).toBeVisible();
  await expect(page.getByTestId("mindmap-view").locator(".react-flow")).toHaveCount(0);
  const readLayout = () => page.evaluate(async (mapId) => {
    const api = window.__ENJOY_APP__.learning;
    const context = await api.getContext();
    const bundle = await api.request(context, "getMap", { id: mapId });
    return bundle.layouts[0]?.positions;
  }, ids.mapId);
  await expect.poll(readLayout).toHaveLength(2);
  const savedLayout = await readLayout();
  expect(savedLayout).toEqual([{ id: "cup", x: 121, y: 27 }, { id: "tea", x: 400, y: 190 }]);
  await page.screenshot({ path: testInfo.outputPath("learning-mindmap.png"), fullPage: true });

  await fixture!.restart();
  page = fixture!.page;
  await page.getByTestId("sidebar-learning-studio").click();
  await expect(page.getByRole("button", { name: "Cup and tea", exact: true })).toBeVisible();
  expect(await readLayout()).toEqual(savedLayout);
  const persisted = await page.evaluate(async ({ lessonId, oldContext, oldUrl }) => {
    const api = window.__ENJOY_APP__.learning;
    const context = await api.getContext();
    const bundle = await api.request(context, "getLesson", { id: lessonId });
    let staleDenied = false;
    try { await api.request(oldContext, "list", {}); } catch { staleDenied = true; }
    const response = await fetch(oldUrl);
    return { revisions: bundle.revisions.length, attempts: bundle.practiceAttempts.length, assets: bundle.assets.length, staleDenied, staleAssetStatus: response.status, connectionId: context.connectionId };
  }, { lessonId: ids.lessonId, oldContext: ids.context, oldUrl: audio.url });
  expect(persisted.revisions).toBe(2);
  expect(persisted.attempts).toBe(4);
  expect(persisted.assets).toBe(2);
  expect(persisted.staleDenied).toBe(true);
  expect(persisted.staleAssetStatus).toBe(403);
  expect(persisted.connectionId).not.toBe(ids.context.connectionId);
  // These exact errors are the expected evidence of the stale-session probes above.
  fixture!.consumeExpectedRuntimeError("Failed to load resource: the server responded with a status of 403 (Forbidden)");
  fixture!.consumeExpectedRuntimeError("Error occurred in handler for 'learning-request': Error: learning_context_denied");
  fixture!.assertNoRuntimeIssues();
});
