/* eslint-disable no-empty-pattern -- Electron tests receive TestInfo without creating a browser fixture. */
import { expect, test } from "@playwright/test";
import { launchIsolatedApp, type IsolatedApp } from "./helpers/isolated-app";
import { writeFile } from "node:fs/promises";
import type { LessonDraft } from "../src/types/learning";

// Opt-in: these cases use the owner's existing native CLI subscriptions.
// Only Enjoy's account/library shell is isolated with the local mock server.
test.skip(process.env.ENJOY_RUN_NATIVE_ACCEPTANCE !== "1", "Explicit native inference acceptance is required");
test.describe.configure({ mode: "serial", retries: 0 });
let fixture: IsolatedApp;
test.beforeAll(async () => {
  fixture = await launchIsolatedApp();
  await fixture.page.evaluate(() => window.__ENJOY_APP__.appSettings.setUser({ id: "99997777", name: "Native Learning Acceptance" }));
  await fixture.page.reload();
});
test.afterAll(async () => { await fixture?.close(); });
test.afterEach(async ({}, info) => {
  if (fixture && info.status !== info.expectedStatus) await fixture.page.screenshot({ path: info.outputPath("native-failure.png"), fullPage: true }).catch(() => undefined);
});

for (const provider of ["codex", "claude"] as const) {
  test(`${provider} generates a real lesson through packaged UI, MCP and SQLite`, async ({}, info) => {
    test.setTimeout(720000);
    info.annotations.push({ type: "native-inference", description: "Real native CLI and MCP; isolated local account/library; no generated-content fixture" });
    let page = fixture.page;
    await page.getByTestId("sidebar-learning-studio").click();
    await expect(page.getByTestId("learning-studio")).toBeVisible();
    await page.getByRole("button", { name: "Bài học mới", exact: true }).click();
    const form = page.getByRole("form", { name: "Tạo bản nháp bài học" });
    const draftTitle = `A cup of tea with a friend (${provider})`;
    await form.getByLabel("Chủ đề", { exact: false }).fill(draftTitle);
    await form.getByText("Tuỳ chọn nâng cao", { exact: true }).click();
    await form.getByLabel(/^Độ dài/).selectOption("short");
    await form.getByLabel("Số hình minh hoạ").selectOption(provider === "codex" ? "1" : "0");
    await form.getByLabel("Tạo giọng đọc cho bài học").uncheck();
    await form.getByRole("button", { name: /^Thêm mục học thủ công/ }).click();
    const manualTarget = form.getByRole("group", { name: "Mục nhập tay 1" });
    await manualTarget.getByLabel("Từ hoặc cụm từ", { exact: true }).fill("cup");
    await manualTarget.getByLabel("Nghĩa muốn học", { exact: true }).fill("a drinking container");
    await manualTarget.getByLabel("Giải thích bằng tiếng Anh").fill("A small container for a drink.");
    await manualTarget.getByLabel("Nghĩa tiếng Việt").fill("cốc");
    await manualTarget.getByLabel("Câu ví dụ tiếng Anh").fill("I have a cup of tea.");
    await form.getByRole("button", { name: "Lưu bản nháp", exact: true }).click();
    const button = page.getByRole("button", { name: `Tạo bằng ${provider === "codex" ? "Codex" : "Claude Code"}`, exact: true });
    await expect(button).toBeEnabled({ timeout: 30000 });
    const lessonId = await page.evaluate(async title => {
      const bridge = window.__ENJOY_APP__.learning; const context = await bridge.getContext();
      const library = await bridge.request(context, "list", {});
      const lesson = library.lessons.find(item => item.title === title);
      if (!lesson) throw new Error("native_draft_missing");
      return lesson.id;
    }, draftTitle);
    const started = Date.now();
    await button.click();
    await expect(page.getByRole("button", { name: "Dừng tạo", exact: true })).toBeVisible({ timeout: 30000 });
    await expect.poll(async () => page.evaluate(async id => {
      const bridge = window.__ENJOY_APP__.learning;
      const context = await bridge.getContext();
      const jobs = await bridge.request(context, "listJobs", { resourceType: "lesson", resourceId: id });
      if (!jobs[0]) return "missing";
      const snapshot = await bridge.request(context, "job", { id: jobs[0].id });
      if (snapshot.job.state === "failed" || snapshot.job.state === "interrupted") throw new Error(snapshot.attempts.map(a => a.errorCode).filter(Boolean).join(","));
      return snapshot.job.state;
    }, lessonId), { timeout: 650000, intervals: [1500, 3000, 5000] }).toBe("completed");
    await expect(page.getByTestId("lesson-reader-heading")).toBeVisible();
    await expect(page.getByTestId("lesson-reader")).toContainText("cup");
    if (provider === "codex") {
      const image = page.getByTestId("lesson-reader").locator("img").first();
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth), { timeout: 10000 }).toBeGreaterThan(0);
      const bytes = await image.evaluate(async (node: HTMLImageElement) => Array.from(new Uint8Array(await (await fetch(node.src)).arrayBuffer())));
      await writeFile(info.outputPath("codex-native-image.png"), Buffer.from(bytes));
      await image.scrollIntoViewIfNeeded();
      await image.screenshot({ path: info.outputPath("codex-native-image-preview.png") });
    }
    await page.getByTestId("lesson-reader-heading").scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`${provider}-native-lesson.png`), fullPage: true });
    const evidence = await page.evaluate(async id => {
      const bridge = window.__ENJOY_APP__.learning; const context = await bridge.getContext();
      const lesson = await bridge.request(context, "getLesson", { id });
      const jobs = await bridge.request(context, "listJobs", { resourceType: "lesson", resourceId: lesson.lesson.id });
      return { lesson, job: await bridge.request(context, "job", { id: jobs[0].id }) };
    }, lessonId);
    await writeFile(info.outputPath(`${provider}-native-generation-receipt.json`), JSON.stringify({ ...evidence, generationCompleted: true, packaged: true }, null, 2));
    expect(evidence.lesson.revisions[0].status).toBe("ready");
    expect(evidence.job.attempts.some(attempt => attempt.provider === provider && attempt.state === "completed")).toBe(true);
    let variantEvidence: unknown = null;
    if (provider === "codex") {
      const imageSlot = evidence.lesson.slots.find(slot => slot.kind === "image");
      if (!imageSlot?.selectedAssetId) throw new Error("native_image_slot_missing");
      const originalAssetId = imageSlot.selectedAssetId;
      await page.getByTestId(`lesson-generate-image-${imageSlot.id}`).first().click();
      await expect.poll(async () => page.evaluate(async ({ id, previousJobId }) => {
        const bridge = window.__ENJOY_APP__.learning; const context = await bridge.getContext();
        const jobs = await bridge.request(context, "listJobs", { resourceType: "lesson", resourceId: id });
        const job = jobs.find(job => job.id !== previousJobId);
        if (!job) return "missing";
        if (["failed", "interrupted"].includes(job.state)) throw new Error("native_variant_failed");
        return job.state;
      }, { id: lessonId, previousJobId: evidence.job.job.id }), { timeout: 300000, intervals: [1000, 3000, 5000] }).toBe("completed");
      await expect(page.getByTestId(`lesson-select-asset-${originalAssetId}`).first()).toBeVisible();
      await page.getByTestId(`lesson-select-asset-${originalAssetId}`).first().click();
      await expect(page.getByTestId(`lesson-select-asset-${originalAssetId}`).first()).toHaveAttribute("aria-pressed", "true");
      const variants = await page.evaluate(async id => {
        const bridge = window.__ENJOY_APP__.learning; const context = await bridge.getContext();
        return bridge.request(context, "getLesson", { id });
      }, lessonId);
      expect(variants.assets.filter(asset => asset.slotId === imageSlot.id)).toHaveLength(2);
      expect(variants.slots.find(slot => slot.id === imageSlot.id)?.selectedAssetId).toBe(originalAssetId);
      variantEvidence = { pass: true, slotId: imageSlot.id, originalAssetId, assets: variants.assets, oldVariantReselected: true };
    }
    const originalTitle = evidence.lesson.lesson.title;
    await fixture.restart();
    page = fixture.page;
    await page.getByTestId("sidebar-learning-studio").click();
    await page.waitForLoadState("networkidle");
    await page.context().setOffline(true);
    const matchingIndex = await page.evaluate(async ({ id, title }) => {
      const bridge = window.__ENJOY_APP__.learning; const context = await bridge.getContext();
      const library = await bridge.request(context, "list", {});
      return library.lessons.filter(lesson => lesson.title === title).findIndex(lesson => lesson.id === id);
    }, { id: lessonId, title: originalTitle });
    expect(matchingIndex).toBeGreaterThanOrEqual(0);
    await page.getByRole("button", { name: originalTitle, exact: true }).nth(matchingIndex).click();
    await expect(page.getByTestId("lesson-reader-heading")).toHaveText(originalTitle);
    if (provider === "codex") await expect.poll(() => page.getByTestId("lesson-reader").locator("img").first().evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
    await expect(page.getByText("Đã tạo xong nội dung", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Luyện tập", exact: true }).click();
    await expect(page.getByTestId("lesson-reader-heading")).not.toBeVisible();
    const content = evidence.lesson.revisions[0].content as unknown as LessonDraft;
    const fill = content.exercises.find(exercise => exercise.kind === "fill");
    if (!fill || fill.kind !== "fill") throw new Error("native_fill_exercise_missing");
    await page.getByTestId(`practice-fill-input-${fill.id}`).fill("incorrect-fixture-answer");
    await page.getByTestId(`practice-submit-${fill.id}`).click();
    await expect(page.getByTestId(`practice-feedback-${fill.id}`)).toContainText("Cần luyện thêm");
    await page.getByTestId(`practice-fill-input-${fill.id}`).fill(fill.acceptedAnswers[0]);
    await page.getByTestId(`practice-submit-${fill.id}`).click();
    await expect(page.getByTestId(`practice-feedback-${fill.id}`)).toContainText("Đúng");
    await page.getByTestId(`practice-feedback-${fill.id}`).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`${provider}-native-offline-practice.png`) });
    await page.context().setOffline(false);
    fixture.assertNoRuntimeIssues();
    await writeFile(info.outputPath(`${provider}-native-evidence.json`), JSON.stringify({ ...evidence, variantEvidence, elapsedMs: Date.now() - started, pass: true, packaged: true, fullRestart: true, offlineReopen: true, fixedExerciseWrongThenCorrect: true }, null, 2));
  });
}
