/* eslint-disable no-empty-pattern -- Electron tests receive TestInfo without creating a browser fixture. */
import { expect, test } from "@playwright/test";
import { launchIsolatedApp } from "./helpers/isolated-app";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import type { UserSettingKeyEnum } from "../src/types/enums";
const { learningDraft, learningBrief } = createRequire(import.meta.url)("../scripts/fixtures/learning-lesson.mjs");
const execute = promisify(execFile);

test.describe.configure({ retries: 0 });
test("packaged narration pipeline creates variants and plays ordered section audio", async ({}, info) => {
  test.setTimeout(180000);
  info.annotations.push({ type: "speech-fixture", description: "Loopback TTS returns synthetic MP3 tones; real packaged dispatch, decoding, storage and playback; no actual speech inference" });
  const mp3Path = info.outputPath("synthetic-playlist-tone.mp3");
  await execute("/opt/homebrew/bin/ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=550:duration=1.2", "-codec:a", "libmp3lame", "-q:a", "7", mp3Path]);
  const tone = await readFile(mp3Path);
  const inputs: string[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    inputs.push(body.input);
    response.writeHead(200, { "content-type": "audio/mpeg", "content-length": tone.length });
    response.end(tone);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture_speech_address_missing");
  const fixture = await launchIsolatedApp();
  try {
    let page = fixture.page;
    await page.evaluate(() => window.__ENJOY_APP__.appSettings.setUser({ id: "99995555", name: "Audio Playlist Fixture" }));
    await page.reload();
    await page.getByTestId("sidebar-learning-studio").click();
    await page.evaluate(async ({ baseURL, keys }) => {
      await window.__ENJOY_APP__.userSettings.set(keys.OPENAI, { key: "fixture-loopback-only", baseUrl: baseURL });
      await window.__ENJOY_APP__.userSettings.set(keys.TTS_CONFIG, { engine: "openai", model: "openai/tts-1", voice: "alloy" });
    }, { baseURL: `http://127.0.0.1:${address.port}/v1`, keys: { OPENAI: "openai" as UserSettingKeyEnum, TTS_CONFIG: "tts_config" as UserSettingKeyEnum } });
    const content = structuredClone(learningDraft);
    content.sections.push({ id: "section-two", text: "Later, I wash my cup. The cup is clean. I put the cup on a shelf.", targetIds: ["cup"] });
    const created = await page.evaluate(async ({ brief, content }) => {
      const bridge = window.__ENJOY_APP__.learning; const context = await bridge.getContext();
      const created = await bridge.request(context, "createLesson", { title: content.title, brief });
      const revised = await bridge.request(context, "reviseLesson", { lessonId: created.lesson.id, expectedRevisionId: created.revision.id, brief, content });
      const lesson = await bridge.request(context, "getLesson", { id: created.lesson.id });
      return { id: created.lesson.id, revisionId: revised.revision.id, slots: lesson.slots };
    }, { brief: { ...learningBrief, audio: true }, content });
    expect(created.slots.filter(slot => slot.kind === "audio")).toHaveLength(2);
    await page.reload();
    await page.getByTestId("sidebar-learning-studio").click();
    await page.getByRole("button", { name: content.title, exact: true }).click();
    for (const section of content.sections) {
      const slot = created.slots.find(slot => slot.sourceId === section.id)!;
      await page.getByTestId(`lesson-generate-audio-${slot.id}`).click();
      await expect(page.getByTestId(`lesson-section-audio-player-${section.id}`)).toBeVisible({ timeout: 30000 });
    }
    await expect(page.getByTestId("lesson-audio-coverage")).toHaveText("Nghe toàn bài");
    const player = page.getByTestId("lesson-full-audio");
    await player.evaluate((node: HTMLAudioElement) => { node.muted = true; });
    const firstUrl = await player.getAttribute("src");
    await page.getByTestId("lesson-audio-playback-rate").selectOption("1.5");
    await page.getByTestId("lesson-audio-start").click();
    await expect.poll(() => player.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(0.1);
    await expect.poll(() => player.getAttribute("src"), { timeout: 10000 }).not.toBe(firstUrl);
    expect(await player.evaluate((node: HTMLAudioElement) => node.playbackRate)).toBe(1.5);
    await expect.poll(() => player.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(0.1);
    await player.evaluate((node: HTMLAudioElement) => node.pause());
    const firstSlot = created.slots.find(slot => slot.sourceId === content.sections[0].id)!;
    await page.getByTestId(`lesson-generate-audio-${firstSlot.id}`).click();
    await expect.poll(async () => page.evaluate(async ({ id, slotId }) => {
      const bridge = window.__ENJOY_APP__.learning; const context = await bridge.getContext();
      const lesson = await bridge.request(context, "getLesson", { id });
      return lesson.assets.filter(asset => asset.slotId === slotId).length;
    }, { id: created.id, slotId: firstSlot.id }), { timeout: 30000 }).toBe(2);
    expect(inputs).toEqual([content.sections[0].text, content.sections[1].text, content.sections[0].text]);
    await fixture.restart(); page = fixture.page;
    await page.getByTestId("sidebar-learning-studio").click();
    await page.waitForLoadState("networkidle");
    await page.context().setOffline(true);
    await page.getByRole("button", { name: content.title, exact: true }).click();
    await expect(page.getByTestId("lesson-audio-coverage")).toHaveText("Nghe toàn bài");
    await page.getByTestId("lesson-full-audio").evaluate((node: HTMLAudioElement) => { node.muted = true; });
    await page.getByTestId("lesson-audio-start").click();
    await expect.poll(() => page.getByTestId("lesson-full-audio").evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(0.1);
    await page.getByTestId("lesson-full-audio-player").scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("audio-playlist.png") });
    fixture.assertNoRuntimeIssues();
    await writeFile(info.outputPath("audio-playlist.json"), JSON.stringify({ pass: true, syntheticTone: true, actualSpeechInference: false, packaged: true, generatedSectionAssets: 2, newVariantPreservesOld: true, requestTextMatchesRevision: true, automaticAdvance: true, speed: 1.5, restart: true, offlinePlayback: true }, null, 2));
  } finally {
    try { await fixture.close(); }
    finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
});
