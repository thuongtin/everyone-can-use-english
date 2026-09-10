/* eslint-disable no-empty-pattern -- Electron acceptance uses an isolated application fixture. */
import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

import {
  retiredAssetUrls,
  seedLegacyCloudAssets,
  type LegacyCloudAssetSeed,
} from "./helpers/legacy-cloud-assets";
import { launchLocalApp, writeReceipt, type LocalApp } from "./helpers/local-app";

const retiredHostnames = new Set([
  "enjoy.bot",
  "assets.enjoy.bot",
  "cdn.enjoy.bot",
  "api.getenjoyapp.com",
  "enjoy-storage.baizhiheizi.com",
]);

const openRoute = async (page: Page, route: string): Promise<void> => {
  await page.evaluate(nextRoute => {
    window.location.hash = nextRoute;
  }, route);
  await page.waitForFunction(nextRoute => window.location.hash === nextRoute, route);
};

const fetchSha256 = (page: Page, url: string): Promise<string> => page.evaluate(async resourceUrl => {
  const response = await fetch(resourceUrl);
  if (!response.ok) throw new Error(`Local asset returned ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}, url);

const sourceHash = (value: string): string => createHash("sha256").update(value).digest("hex");

test("legacy cloud resources stay local, visible and non-fetching after restart", async ({}, info) => {
  test.skip(
    process.env.ENJOY_RUN_LEGACY_CLOUD_ASSETS_ACCEPTANCE !== "1",
    "Explicit packaged legacy-cloud acceptance required",
  );
  test.setTimeout(180_000);
  let app: LocalApp | undefined;
  let seed: LegacyCloudAssetSeed | undefined;
  const retiredRequests: string[] = [];
  let primaryError: unknown;
  try {
    app = await launchLocalApp({ offline: true });
    await expect(app.page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });
    seed = await seedLegacyCloudAssets(app);
    await app.restart({ offline: true });
    const page = app.page;
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });
    page.on("request", request => {
      try {
        if (retiredHostnames.has(new URL(request.url()).hostname)) retiredRequests.push(request.url());
      } catch {
        // Non-URL requests are irrelevant to the retired-host assertion.
      }
    });

    const records = await page.evaluate(async ids => ({
      localAudio: await window.__ENJOY_APP__.audios.findOne({ id: ids.localAudioId }),
      missingAudio: await window.__ENJOY_APP__.audios.findOne({ id: ids.missingAudioId }),
      localVideo: await window.__ENJOY_APP__.videos.findOne({ id: ids.localVideoId }),
      missingVideo: await window.__ENJOY_APP__.videos.findOne({ id: ids.missingVideoId }),
      localDocument: await window.__ENJOY_APP__.documents.findOne({ id: ids.localDocumentId }),
      missingDocument: await window.__ENJOY_APP__.documents.findOne({ id: ids.missingDocumentId }),
    }), seed);

    expect(records.localAudio.src).toMatch(/^enjoy:\/\/library\/audios\//u);
    expect(records.localVideo.src).toMatch(/^enjoy:\/\/library\/videos\//u);
    expect(records.localDocument.src).toMatch(/^enjoy:\/\/library\/documents\//u);
    expect(records.missingAudio.src).toBeNull();
    expect(records.missingVideo.src).toBeNull();
    expect(records.missingDocument.src).toBeNull();
    expect(records.localAudio.source).toBe(retiredAssetUrls.audioSource);
    expect(records.localVideo.source).toBe(retiredAssetUrls.videoSource);
    expect(records.localDocument.source).toBe(retiredAssetUrls.documentSource);
    expect(new Date(records.localAudio.syncedAt).toISOString()).toBe(seed.historicalTimestamp);
    expect(new Date(records.localDocument.uploadedAt).toISOString()).toBe(seed.historicalTimestamp);
    expect(await fetchSha256(page, records.localAudio.src)).toBe(seed.localAudioSha256);
    expect(await fetchSha256(page, records.localVideo.src)).toBe(seed.localVideoSha256);

    await openRoute(page, "#/audios");
    await expect(page.getByText("Legacy local audio", { exact: true })).toBeVisible();
    await expect(page.getByText("Legacy missing audio", { exact: true })).toBeVisible();
    await expect(page.getByText("Không tìm thấy tệp nguồn", { exact: true })).toBeVisible();
    await expect(page.locator('img[src*="enjoy.bot"], img[src*="getenjoyapp.com"], img[src*="baizhiheizi.com"]')).toHaveCount(0);

    await openRoute(page, "#/videos");
    await expect(page.getByText("Legacy local video", { exact: true })).toBeVisible();
    await expect(page.getByText("Legacy missing video", { exact: true })).toBeVisible();
    await expect(page.getByText("Không tìm thấy tệp nguồn", { exact: true })).toBeVisible();

    await openRoute(page, "#/documents");
    await expect(page.getByRole("link", { name: "Legacy missing document", exact: true })).toBeVisible();
    await expect(page.getByText("Không tìm thấy tệp nguồn", { exact: false })).toBeVisible();
    await page.getByRole("link", { name: "Legacy local document", exact: true }).click();
    await expect(page.getByText(seed.markdownMarker, { exact: true })).toBeVisible();
    await expect(page.locator("[data-retired-resource]")).toHaveCount(2);

    await openRoute(page, "#/profile");
    await expect(page.getByText("Legacy local learner", { exact: true })).toBeVisible();
    await expect(page.locator(`img[src="${retiredAssetUrls.avatar}"]`)).toHaveCount(0);

    await openRoute(page, "#/chats");
    await page.getByText("Legacy local history", { exact: true }).click();
    await expect(page.getByText("History marker", { exact: true })).toBeVisible();
    await expect(page.locator("[data-retired-resource]")).toHaveCount(1);

    await page.waitForTimeout(1_000);
    const [rendererPolicy, mainPolicy] = await page.evaluate(async () => [
      window.__ENJOY_RENDERER_NETWORK_POLICY__(),
      await window.__ENJOY_APP__.app.networkPolicyDiagnostics(),
    ] as const);
    expect(rendererPolicy.blockedAttemptCount).toBe(0);
    expect(rendererPolicy.legacyBackendOperationCount).toBe(0);
    expect(mainPolicy.blockedAttemptCount).toBe(0);
    expect(mainPolicy.legacyBackendOperationCount).toBe(0);
    expect(retiredRequests).toEqual([]);
    expect(await app.electronApp.evaluate(({ webContents }) => webContents.getAllWebContents()
      .filter(contents => /^https?:\/\//u.test(contents.getURL())).length)).toBe(0);
    app.assertNoRuntimeIssues();

    await writeReceipt(info, "legacy-cloud-assets.json", {
      pass: true,
      profile: "isolated-local",
      offlineRestart: true,
      retainedTimestamps: {
        expected: seed.historicalTimestamp,
        audioSyncedAt: new Date(records.localAudio.syncedAt).toISOString(),
        documentUploadedAt: new Date(records.localDocument.uploadedAt).toISOString(),
      },
      retainedProvenanceHashes: {
        audioSource: sourceHash(records.localAudio.source),
        videoSource: sourceHash(records.localVideo.source),
        documentSource: sourceHash(records.localDocument.source),
      },
      localByteHashes: { audio: seed.localAudioSha256, video: seed.localVideoSha256 },
      missingResourceIds: [seed.missingAudioId, seed.missingVideoId, seed.missingDocumentId],
      networkPolicy: { renderer: rendererPolicy, main: mainPolicy },
      retiredRequestCount: retiredRequests.length,
    });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (app) {
      await writeReceipt(info, "runtime-diagnostics.json", app.runtimeDiagnostics()).catch(() => undefined);
      await app.close().catch(error => { if (!primaryError) throw error; });
    }
  }
});
