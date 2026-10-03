/* eslint-disable no-empty-pattern -- Packaged acceptance uses its own application fixture. */
import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { launchLocalApp, type LocalApp } from "./helpers/local-app";
import { lexicalUnits } from "../src/main/learning-asr/text";

test.use({ trace: "off", video: "off" });
test.skip(process.env.ENJOY_RUN_CLIP_RECOVERY !== "1", "Explicit current-clip recovery acceptance required");

test("the selected pending clip transcribes through the packaged UI and survives an offline restart", async ({}, info) => {
  test.setTimeout(1_200_000);
  const snapshot = process.env.ENJOY_CLIP_PROFILE_SNAPSHOT;
  const source = process.env.ENJOY_CLIP_SOURCE;
  const videoId = process.env.ENJOY_CLIP_VIDEO_ID;
  const profileId = process.env.ENJOY_CLIP_PROFILE_ID;
  const evidencePath = process.env.ENJOY_CLIP_EVIDENCE;
  if (!snapshot || !source || !videoId || !profileId || !evidencePath) {
    throw new Error("Explicit snapshot, clip source, IDs and evidence directory are required");
  }
  if (!path.isAbsolute(snapshot) || !path.isAbsolute(source) || !path.isAbsolute(evidencePath)) {
    throw new Error("Clip fixture paths must be absolute");
  }
  await mkdir(evidencePath, { recursive: true, mode: 0o700 });
  const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
  const snapshotHash = hash(await readFile(snapshot));
  const sourceHash = hash(await readFile(source));
  const receipt: Record<string, unknown> = {
    startedAt: new Date().toISOString(), appPath: process.env.ENJOY_E2E_APP_PATH,
    videoId, sourceSha256: sourceHash, snapshotSha256: snapshotHash,
    library: "isolated-copy", providerResponseFixture: false,
  };
  const save = () => writeFile(path.join(evidencePath, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  let app: LocalApp | undefined;
  let failure: unknown;
  try {
    app = await launchLocalApp({ seed: { databasePath: snapshot, profileId, assets: [] } });
    const profileRoot = path.dirname(app.databasePath);
    await mkdir(path.join(profileRoot, "videos"), { recursive: true });
    await copyFile(source, path.join(profileRoot, "videos", path.basename(source)));
    const checkpointSeed = process.env.ENJOY_CLIP_CHECKPOINT_SEED;
    if (checkpointSeed) {
      await cp(checkpointSeed, path.join(profileRoot, "learning-asr-work"), { recursive: true, force: false });
    }
    await expect(app.page.getByTestId("layout-home")).toBeVisible({ timeout: 60_000 });
    const configuration = await app.page.evaluate(() => window.__ENJOY_APP__.speeches.getAzureConfig());
    expect(configuration.transcriptionConfigured).toBe(true);
    receipt.azureConfiguration = { configured: configuration.transcriptionConfigured, endpoint: configuration.endpoint };
    await app.page.evaluate((id) => { window.location.hash = `/videos/${id}`; }, videoId);
    const submit = app.page.getByTestId("transcribe-continue-button");
    await expect(submit).toBeVisible({ timeout: 60_000 });
    await expect(app.page.getByRole("heading", { name: "Chép lời", exact: true })).toBeVisible();
    await app.page.getByTestId("transcription-service-select").click();
    const providerLabel = process.env.ENJOY_CLIP_PROVIDER === "azure_mai" ? "Azure MAI-Transcribe-2" : "Azure Speech Fast Transcription";
    await app.page.getByRole("option", { name: providerLabel, exact: true }).click();
    receipt.provider = providerLabel;
    await app.page.evaluate(() => {
      const state = window as typeof window & { __CLIP_PROGRESS__?: unknown };
      window.__ENJOY_APP__.learningAsr.onProgress((_event, value) => { state.__CLIP_PROGRESS__ = value; });
    });
    receipt.phase = "submitted-through-ui";
    await save();
    await submit.click();
    let transcription: TranscriptionType | undefined;
    for (let attempt = 0; attempt < 210; attempt++) {
      await app.page.waitForTimeout(5_000);
      transcription = await app.page.evaluate((id) => window.__ENJOY_APP__.transcriptions.findOrCreate({ targetId: id, targetType: "Video" }), videoId);
      receipt.progress = await app.page.evaluate(() => (window as typeof window & { __CLIP_PROGRESS__?: unknown }).__CLIP_PROGRESS__ || null);
      receipt.state = transcription?.state;
      const failure = app.page.getByRole("alert");
      if (await failure.count()) {
        receipt.failure = await failure.allTextContents();
        await save();
        throw new Error("Clip transcription reported a persistent failure; see receipt");
      }
      await save();
      if (transcription?.state === "finished" && transcription.result?.timeline?.length) break;
    }
    expect(transcription?.state).toBe("finished");
    const result = transcription!.result;
    expect(result.validation?.sourceCoverage).toBe("complete");
    const expectReview = process.env.ENJOY_CLIP_EXPECT_REVIEW === "1";
    if (expectReview) {
      expect(result.validation?.speechGapCheck).toBe("review-required");
      const gaps = result.validation.speechGaps;
      expect(gaps.length).toBeGreaterThan(0);
      for (const gap of gaps) {
        expect(gap.startTime).toBeGreaterThanOrEqual(0);
        expect(gap.endTime).toBeGreaterThan(gap.startTime);
        expect(gap.endTime).toBeLessThanOrEqual(2_302.571);
      }
      await expect(app.page.getByTestId("transcription-review-notice")).toBeVisible();
    } else {
      expect(result.validation?.speechGapCheck).toBe("passed");
      expect(result.validation?.speechGaps).toBeUndefined();
    }
    const words = result.timeline.flatMap(sentence => sentence.timeline.filter(entry => entry.type === "word"));
    expect(words.length).toBeGreaterThan(5_000);
    expect(lexicalUnits(words.map(word => word.text).join(" "))).toEqual(lexicalUnits(result.transcript));
    let previousEnd = 0;
    for (const word of words) {
      expect(word.startTime).toBeGreaterThanOrEqual(previousEnd - 1e-6);
      expect(word.endTime).toBeGreaterThan(word.startTime);
      previousEnd = word.endTime;
    }
    expect(previousEnd).toBeGreaterThan(2_300);
    const resultHash = hash(JSON.stringify(result));
    receipt.result = { words: words.length, sentences: result.timeline.length, lastWordEnd: previousEnd, sha256: resultHash, validation: result.validation };
    await writeFile(path.join(evidencePath, "transcription.json"), JSON.stringify(transcription), { mode: 0o600 });
    await expect(submit).not.toBeVisible();
    const media = app.page.locator("video");
    await expect.poll(() => media.evaluate((video: HTMLVideoElement) => video.readyState), {timeout: 30_000}).toBeGreaterThanOrEqual(2);
    expect(await media.evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
    expect(await media.evaluate((video: HTMLVideoElement) => video.error?.message || null)).toBeNull();
    if (expectReview) {
      await app.page.getByTestId("transcription-review-notice").locator("summary").click();
      const ranges = app.page.getByTestId("transcription-review-range");
      await expect(ranges).toHaveCount(result.validation.speechGaps.length);
      await ranges.first().click();
      const expectedStart = Math.max(0, result.validation.speechGaps[0].startTime - 0.5);
      await expect.poll(() => media.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(expectedStart, 1);
      receipt.reviewSeek = true;
    }
    await media.evaluate(async (video: HTMLVideoElement) => { video.muted = true; await video.play(); });
    const before = await media.evaluate((video: HTMLVideoElement) => video.currentTime);
    await expect.poll(() => media.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(before + 0.2);
    await media.evaluate((video: HTMLVideoElement) => video.pause());
    receipt.videoPlayback = true;
    // Chromium can log this codec probe before selecting a working decoder.
    // It is expected only after this exact source demonstrably decoded and played.
    receipt.decoderProbeMessages = app.consumeExpectedRuntimeError("Unsupported pixel format: -1");
    await app.page.screenshot({ path: path.join(evidencePath, "clip-finished.png") });
    await app.restart({ offline: true });
    await expect(app.page.getByTestId("layout-home")).toBeVisible({ timeout: 60_000 });
    await app.page.evaluate((id) => { window.location.hash = `/videos/${id}`; }, videoId);
    await expect(app.page.getByTestId("media-player-container")).toBeVisible({ timeout: 60_000 });
    const restored = await app.page.evaluate((id) => window.__ENJOY_APP__.transcriptions.findOrCreate({ targetId: id, targetType: "Video" }), videoId);
    expect(restored.state).toBe("finished");
    expect(hash(JSON.stringify(restored.result))).toBe(resultHash);
    if (expectReview) {
      await expect(app.page.getByTestId("transcription-review-notice")).toBeVisible();
      await app.page.getByTestId("transcription-review-notice").locator("summary").click();
      await expect(app.page.getByTestId("transcription-review-range")).toHaveCount(result.validation.speechGaps.length);
      receipt.reviewPersisted = true;
    }
    await expect.poll(() => app!.page.locator("video").evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
    expect(await app.page.locator("video").evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
    app.consumeExpectedRuntimeError("Unsupported pixel format: -1");
    receipt.offlineRestart = true;
    receipt.pass = true;
  } catch (error) {
    receipt.pass = false;
    receipt.failureReason = error instanceof Error ? error.message : "Unknown recovery failure";
    failure = error;
  } finally {
    if (app) {
      const checkpoints = path.join(path.dirname(app.databasePath), "learning-asr-work");
      if (await stat(checkpoints).catch(() => null)) await cp(checkpoints, path.join(evidencePath, "learning-asr-work"), { recursive: true });
      receipt.runtimeDiagnostics = app.runtimeDiagnostics();
      await save();
      try { await app.close(); } catch (error) {
        receipt.closeFailure = error instanceof Error ? error.message : "Unknown close failure";
        await save();
        failure ??= error;
        receipt.pass = false;
      }
    }
  }
    expect(hash(await readFile(snapshot))).toBe(snapshotHash);
    expect(hash(await readFile(source))).toBe(sourceHash);
    receipt.finishedAt = new Date().toISOString();
    await save();
    await info.attach("clip-recovery-receipt", { path: path.join(evidencePath, "receipt.json"), contentType: "application/json" });
    if (failure) throw failure;
});
