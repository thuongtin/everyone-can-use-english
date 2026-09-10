import { expect, test } from "@playwright/test";
import { launchIsolatedApp } from "./helpers/isolated-app";
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
const { learningDraft, learningBrief } = createRequire(import.meta.url)("../scripts/fixtures/learning-lesson.mjs");

test.skip(process.env.ENJOY_RUN_MICROPHONE_ACCEPTANCE !== "1", "Explicit physical microphone acceptance is required");
test.describe.configure({ retries: 0 });
test("physical microphone records, persists and replays through packaged practice UI", async ({}, info) => {
  test.setTimeout(120000);
  const fixture = await launchIsolatedApp();
  try {
    let page = fixture.page;
    await page.evaluate(() => window.__ENJOY_APP__.appSettings.setUser({ id: "99996666", name: "Microphone Acceptance" }));
    await page.reload();
    await page.getByTestId("sidebar-learning-studio").click();
    const permission = await fixture.electronApp.evaluate(({ systemPreferences }) => systemPreferences.getMediaAccessStatus("microphone"));
    await writeFile(info.outputPath("microphone-permission.json"), JSON.stringify({ permission, physicalDevice: true }));
    const created = await page.evaluate(async ({ brief, content }) => {
      const bridge = window.__ENJOY_APP__.learning; const context = await bridge.getContext();
      const created = await bridge.request(context, "createLesson", { title: "Microphone acceptance", brief });
      const revised = await bridge.request(context, "reviseLesson", { lessonId: created.lesson.id, expectedRevisionId: created.revision.id, brief, content });
      return { id: created.lesson.id, revisionId: revised.revision.id };
    }, { brief: learningBrief, content: learningDraft });
    await page.reload();
    await page.getByTestId("sidebar-learning-studio").click();
    await page.getByRole("button", { name: "A cup of tea", exact: true }).click();
    await page.getByRole("button", { name: "Luyện tập", exact: true }).click();
    await page.getByTestId("practice-recording-start-retell-cup").click();
    await expect(page.getByTestId("practice-recording-stop-retell-cup")).toBeEnabled({ timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.getByTestId("practice-recording-stop-retell-cup").click();
    const preview = page.getByTestId("practice-recording-preview-retell-cup");
    await expect(preview).toBeVisible();
    await page.getByTestId("practice-submit-retell-cup").click();
    await expect(page.getByTestId("practice-play-recording-retell-cup")).toBeVisible();
    const receipt = await page.evaluate(async id => {
      const bridge = window.__ENJOY_APP__.learning; const context = await bridge.getContext();
      const bundle = await bridge.request(context, "getLesson", { id });
      const slot = bundle.slots.find(slot => slot.sourceType === "practice" && slot.sourceId === "retell-cup");
      const recording = bundle.assets.find(asset => asset.slotId === slot?.id && asset.kind === "audio");
      if (!recording) throw new Error("physical_recording_asset_missing");
      return { assetId: recording.id, mimeType: recording.mimeType, bytes: recording.sizeBytes };
    }, created.id);
    await fixture.restart(); page = fixture.page;
    await page.getByTestId("sidebar-learning-studio").click();
    await page.getByRole("button", { name: "A cup of tea", exact: true }).click();
    await page.getByRole("button", { name: "Luyện tập", exact: true }).click();
    await page.getByTestId("practice-play-recording-retell-cup").click();
    const audio = page.locator("audio").last();
    await audio.evaluate((node: HTMLAudioElement) => { node.currentTime = 0; return node.play(); });
    await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime), { timeout: 10000 }).toBeGreaterThan(0.2);
    await writeFile(info.outputPath("physical-microphone.json"), JSON.stringify({ pass: true, actualMicrophone: true, fixtureLesson: true, captureMs: 3000, restart: true, playbackAdvanced: true, ...receipt }, null, 2));
    await page.getByTestId("practice-play-recording-retell-cup").scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("physical-microphone.png") });
    fixture.assertNoRuntimeIssues();
  } finally { await fixture.close(); }
});
