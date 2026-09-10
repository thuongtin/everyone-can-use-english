/* eslint-disable no-empty-pattern -- Electron tests receive TestInfo without creating a browser fixture. */
import { createHash } from "node:crypto";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "playwright";

import {
  launchLocalApp,
  queryLocalDatabase,
  sanitizeLocalDiagnostic,
  writeReceipt,
  type LocalApp,
} from "./helpers/local-app";
import { resolveE2EAppPath } from "./helpers/isolated-app";
import { captureProviderNetwork } from "./helpers/provider-network";

const runLive = process.env.ENJOY_RUN_AZURE_PHYSICAL_MICROPHONE === "1";
const acousticLoopReady = process.env.ENJOY_PHYSICAL_ACOUSTIC_LOOP_READY === "1";
const configFile = process.env.ENJOY_AZURE_CREDENTIAL_FILE?.trim() || "";
const expectedDeviceLabel = process.env.ENJOY_PHYSICAL_MIC_DEVICE_LABEL?.trim() || "";
const coordinationDirectory = process.env.ENJOY_PHYSICAL_MIC_COORDINATION_DIR?.trim() || "";
const coordinationRunId = process.env.ENJOY_PHYSICAL_MIC_RUN_ID?.trim() || "";
const expectedAppAsarSha256 = process.env.ENJOY_PHYSICAL_EXPECTED_ASAR_SHA256?.trim().toLowerCase() || "";
const reference = "Cup. I have a cup of tea.";
const sourceSpeech = "previously generated TTS played through physical Android speaker and captured through XVF3800 USB microphone";
const countdownSeconds = 5;
const captureMs = 12_000;
const playbackStartDeadlineMs = 4_000;

test.describe.configure({ retries: 0 });
test.use({ trace: "off", screenshot: "off", video: "off" });

test.skip(!runLive, "Set ENJOY_RUN_AZURE_PHYSICAL_MICROPHONE=1 for a controlled physical-microphone run");
test.skip(!acousticLoopReady, "Set ENJOY_PHYSICAL_ACOUSTIC_LOOP_READY=1 only after the Android-to-XVF3800 acoustic loop is ready");
test.skip(!configFile, "Set ENJOY_AZURE_CREDENTIAL_FILE to a private mode-0600 JSON file");
test.skip(!expectedDeviceLabel, "Set ENJOY_PHYSICAL_MIC_DEVICE_LABEL to the expected physical input label");
test.skip(!coordinationDirectory, "Set ENJOY_PHYSICAL_MIC_COORDINATION_DIR for the adb playback handshake");
test.skip(!coordinationRunId, "Set a unique ENJOY_PHYSICAL_MIC_RUN_ID for the adb playback handshake");
test.skip(!expectedAppAsarSha256, "Set ENJOY_PHYSICAL_EXPECTED_ASAR_SHA256 to lock the packaged payload");

type AzureConfig = Readonly<{ region: string; key: string }>;
type MicrophoneObservation = Readonly<{
  source: "production-getUserMedia";
  callCount: number;
  requestedAudio: boolean;
  requestedVideo: boolean;
  label: string;
  labelMatches: boolean;
  deviceIdPresent: boolean;
  deviceIdSha256: string;
  groupIdSha256: string | null;
  channelCount: number | null;
  sampleRate: number | null;
  sampleSize: number | null;
}>;

const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

const sha256File = async (filePath: string): Promise<string> => sha256(await readFile(filePath));

const digest = (value: unknown): string => sha256(JSON.stringify(value));

const pathExists = async (filePath: string): Promise<boolean> =>
  access(filePath).then(() => true, () => false);

const coordinationPaths = (): Readonly<{ captureReady: string; playbackStarted: string }> => {
  expect(coordinationRunId).toMatch(/^[a-zA-Z0-9._-]+$/u);
  const directory = path.resolve(coordinationDirectory);
  return {
    captureReady: path.join(directory, `${coordinationRunId}.capture-ready.json`),
    playbackStarted: path.join(directory, `${coordinationRunId}.playback-started.json`),
  };
};

const readPrivateConfig = async (): Promise<AzureConfig> => {
  const resolved = path.resolve(configFile);
  const metadata = await stat(resolved);
  expect(metadata.isFile()).toBe(true);
  expect(metadata.mode & 0o777, "Azure credential file must have mode 0600").toBe(0o600);
  const parsed = JSON.parse(await readFile(resolved, "utf8")) as Record<string, unknown>;
  const region = typeof parsed.region === "string" ? parsed.region.trim().toLowerCase() : "";
  const key = typeof parsed.key === "string" ? parsed.key.trim() : "";
  expect(region).toMatch(/^[a-z0-9-]+$/u);
  expect(key.length).toBeGreaterThan(0);
  return { region, key };
};

const redactCredential = (value: unknown, credential: string): unknown => {
  if (typeof value === "string") return value.replaceAll(credential, "<redacted>");
  if (Array.isArray(value)) return value.map(item => redactCredential(item, credential));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactCredential(item, credential)]),
    );
  }
  return value;
};

const navigateTo = async (page: Page, route: string): Promise<void> => {
  await page.evaluate((nextRoute) => {
    window.location.hash = nextRoute;
  }, route);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#${route}`);
};

const installMicrophoneObserver = async (page: Page): Promise<void> => {
  await page.evaluate(({ expectedLabel }) => {
    const mediaDevices = navigator.mediaDevices;
    const original = mediaDevices.getUserMedia.bind(mediaDevices);
    const scope = window as typeof window & {
      __PHYSICAL_MIC_OBSERVATION__?: MicrophoneObservation;
    };
    let callCount = 0;
    const hash = async (value: string): Promise<string> => {
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
      return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
    };
    mediaDevices.getUserMedia = async (constraints): Promise<MediaStream> => {
      callCount += 1;
      const stream = await original(constraints);
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error("physical_microphone_audio_track_missing");
      const settings = track.getSettings();
      const deviceId = settings.deviceId || "";
      const groupId = settings.groupId || "";
      scope.__PHYSICAL_MIC_OBSERVATION__ = {
        source: "production-getUserMedia",
        callCount,
        requestedAudio: Boolean(constraints?.audio),
        requestedVideo: Boolean(constraints?.video),
        label: track.label,
        labelMatches: track.label.toLocaleLowerCase().includes(expectedLabel.toLocaleLowerCase()),
        deviceIdPresent: deviceId.length > 0,
        deviceIdSha256: await hash(deviceId),
        groupIdSha256: groupId ? await hash(groupId) : null,
        channelCount: settings.channelCount ?? null,
        sampleRate: settings.sampleRate ?? null,
        sampleSize: settings.sampleSize ?? null,
      };
      return stream;
    };
  }, { expectedLabel: expectedDeviceLabel });
};

const showCountdown = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ seconds, text }) => {
    const overlay = document.createElement("div");
    overlay.id = "physical-microphone-countdown";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "24px 24px auto 24px",
      zIndex: "2147483647",
      padding: "20px",
      borderRadius: "14px",
      background: "#10213d",
      color: "white",
      fontSize: "24px",
      fontWeight: "700",
      textAlign: "center",
      pointerEvents: "none",
    });
    document.body.append(overlay);
    for (let remaining = seconds; remaining > 0; remaining -= 1) {
      overlay.textContent = `Bắt đầu thu âm từ loa Pixel sau ${remaining} giây. Không nói vào microphone.`;
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
    overlay.textContent = `ĐANG THU: chờ Pixel phát TTS qua loa. Không nói vào microphone. Nội dung: ${text}`;
  }, { seconds: countdownSeconds, text: reference });
};

const replayRecording = async (page: Page, recordingId: string): Promise<{
  bytes: number[];
  byteCount: number;
  sha256: string;
  duration: number;
  currentTime: number;
}> => page.evaluate(async (id) => {
  const recording = await window.__ENJOY_APP__.recordings.findOne({ id });
  const response = await fetch(recording.src);
  if (!response.ok) throw new Error("physical_recording_read_failed");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const blob = new Blob([bytes], { type: "audio/mpeg" });
  const url = URL.createObjectURL(blob);
  const audio = document.createElement("audio");
  audio.muted = true;
  audio.src = url;
  document.body.append(audio);
  try {
    await new Promise<void>((resolve, reject) => {
      audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
      audio.addEventListener("error", () => reject(new Error("physical_recording_decode_failed")), { once: true });
      audio.load();
    });
    await audio.play();
    await new Promise(resolve => setTimeout(resolve, 350));
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return {
      bytes: Array.from(bytes),
      byteCount: bytes.byteLength,
      sha256: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join(""),
      duration: audio.duration,
      currentTime: audio.currentTime,
    };
  } finally {
    audio.pause();
    audio.remove();
    URL.revokeObjectURL(url);
  }
}, recordingId);

test("physical Android-speaker to XVF3800 recording is assessed by Azure and persists offline", async ({}, testInfo) => {
  test.setTimeout(240_000);
  const appPath = resolveE2EAppPath();
  const appAsarPath = path.join(appPath, "Contents", "Resources", "app.asar");
  const [appAsarSha256, testSourceSha256] = await Promise.all([
    sha256File(appAsarPath),
    sha256File(import.meta.filename),
  ]);
  expect(expectedAppAsarSha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(appAsarSha256, "Packaged app.asar must match the explicitly expected payload")
    .toBe(expectedAppAsarSha256);
  const secureConfig = await readPrivateConfig();
  const markers = coordinationPaths();
  expect(await pathExists(markers.captureReady), "capture-ready marker must not be stale").toBe(false);
  expect(await pathExists(markers.playbackStarted), "playback-started marker must not be stale").toBe(false);
  let fixture: LocalApp | undefined;
  let primaryError: unknown;

  try {
    fixture = await launchLocalApp();
    let page = fixture.page;
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 45_000 });
    const runtime = await fixture.electronApp.evaluate(({ systemPreferences }) => ({
      permission: systemPreferences.getMediaAccessStatus("microphone"),
      fakeMediaFlagsPresent: process.argv.some(argument =>
        /use-fake-device-for-media-stream|use-file-for-fake-audio-capture/iu.test(argument)),
    }));
    expect(runtime.permission).toBe("granted");
    expect(runtime.fakeMediaFlagsPresent).toBe(false);

    const configured = await page.evaluate(
      (config) => window.__ENJOY_APP__.speeches.setAzureConfig(config),
      secureConfig,
    );
    expect(configured.configured).toBe(true);
    await page.reload();
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 45_000 });
    await installMicrophoneObserver(page);
    await navigateTo(page, "/pronunciation_assessments/new");
    await expect(page.getByRole("heading")).toBeVisible();
    await page.locator("textarea").fill(reference);

    await showCountdown(page);
    await page.locator("form button.size-16").click();
    await expect.poll(() => page.evaluate(() =>
      Boolean((window as typeof window & { __PHYSICAL_MIC_OBSERVATION__?: unknown })
        .__PHYSICAL_MIC_OBSERVATION__))).toBe(true);
    const microphone = await page.evaluate(() =>
      (window as typeof window & { __PHYSICAL_MIC_OBSERVATION__: MicrophoneObservation })
        .__PHYSICAL_MIC_OBSERVATION__);
    expect(microphone).toMatchObject({
      source: "production-getUserMedia",
      callCount: 1,
      requestedAudio: true,
      requestedVideo: false,
      labelMatches: true,
      deviceIdPresent: true,
    });
    await expect(page.locator("form button.size-11"), "Production stop control must confirm recording state")
      .toBeVisible();
    const captureStartedAt = Date.now();
    await writeFile(markers.captureReady, JSON.stringify({
      schemaVersion: 1,
      runId: coordinationRunId,
      state: "capture-ready",
      createdAt: new Date().toISOString(),
      reference,
      sourceSpeech,
    }, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 });
    await expect.poll(() => pathExists(markers.playbackStarted), {
      message: "Parent must start Pixel speaker playback and create playback-started marker within four seconds",
      timeout: playbackStartDeadlineMs,
      intervals: [50, 100, 200],
    }).toBe(true);
    const acknowledgementReadAt = Date.now();
    const acknowledgement = JSON.parse(await readFile(markers.playbackStarted, "utf8")) as Record<string, unknown>;
    expect(acknowledgement.runId).toBe(coordinationRunId);
    expect(acknowledgement.state).toBe("play-command-accepted");
    expect(typeof acknowledgement.createdAt).toBe("string");
    const playbackStartedAt = Date.parse(acknowledgement.createdAt as string);
    expect(Number.isFinite(playbackStartedAt)).toBe(true);
    expect(playbackStartedAt).toBeGreaterThanOrEqual(captureStartedAt);
    expect(playbackStartedAt).toBeLessThanOrEqual(acknowledgementReadAt);
    const playbackStartedAfterCaptureMs = playbackStartedAt - captureStartedAt;
    expect(playbackStartedAfterCaptureMs).toBeLessThanOrEqual(playbackStartDeadlineMs);
    await page.waitForTimeout(Math.max(0, captureMs - playbackStartedAfterCaptureMs));
    await page.locator("form button.size-11").click();
    await page.evaluate(() => document.querySelector("#physical-microphone-countdown")?.remove());
    await expect(page.locator("form audio")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("conversation-form-submit").click();

    const assessment = await expect.poll(() => page.evaluate(async (text) => {
      const records = await window.__ENJOY_APP__.pronunciationAssessments.findAll({
        where: { referenceText: text },
        order: [["createdAt", "DESC"]],
        limit: 1,
      });
      return records[0] || null;
    }, reference), { timeout: 90_000 }).not.toBeNull().then(async () =>
      page.evaluate(async (text) => {
        const records = await window.__ENJOY_APP__.pronunciationAssessments.findAll({
          where: { referenceText: text }, order: [["createdAt", "DESC"]], limit: 1,
        });
        return records[0];
      }, reference));

    expect(assessment.result?.provider).toBe("azure");
    const scores = [
      assessment.pronunciationScore,
      assessment.accuracyScore,
      assessment.completenessScore,
      assessment.fluencyScore,
    ];
    for (const score of scores) {
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
    const words = Array.isArray(assessment.result?.words) ? assessment.result.words : [];
    const phonemes = words.flatMap((word: { phonemes?: unknown[] }) => word.phonemes || []);
    expect(assessment.result?.display?.trim().length).toBeGreaterThan(0);
    expect(assessment.result?.lexical?.trim().length).toBeGreaterThan(0);
    expect(words.length).toBeGreaterThan(0);
    expect(phonemes.length).toBeGreaterThan(0);
    const assessmentDetail = {
      display: assessment.result.display,
      lexical: assessment.result.lexical,
      words: words.map((word: PronunciationAssessmentWordResultType) => ({
        word: word.word,
        offset: word.offset,
        duration: word.duration,
        pronunciationAssessment: word.pronunciationAssessment,
        phonemes: word.phonemes.map(phoneme => ({
          phoneme: phoneme.phoneme,
          offset: phoneme.offset,
          duration: phoneme.duration,
          pronunciationAssessment: phoneme.pronunciationAssessment,
        })),
      })),
    };
    const recordingId = assessment.targetId;
    expect(typeof recordingId).toBe("string");
    const onlineReplay = await replayRecording(page, recordingId);
    const { bytes: physicalRecordingBytes, ...onlineReplayEvidence } = onlineReplay;
    expect(onlineReplayEvidence.byteCount).toBeGreaterThan(0);
    expect(onlineReplayEvidence.duration).toBeGreaterThan(0);
    expect(onlineReplayEvidence.currentTime).toBeGreaterThan(0.1);
    const physicalRecordingPath = testInfo.outputPath("physical-recording.mp3");
    const physicalRecordingBuffer = Buffer.from(physicalRecordingBytes);
    await writeFile(physicalRecordingPath, physicalRecordingBuffer, { mode: 0o600 });
    const physicalRecordingSha256 = sha256(physicalRecordingBuffer);
    expect(physicalRecordingSha256).toBe(onlineReplayEvidence.sha256);
    await expect(page.getByTestId(`pronunciation-assessment-card-${assessment.id}`)).toBeVisible();

    const [recordingRowsBefore, assessmentRowsBefore] = await Promise.all([
      queryLocalDatabase<Record<string, unknown>>(
        fixture.databasePath, "SELECT * FROM recordings WHERE id = ?", [recordingId],
      ),
      queryLocalDatabase<Record<string, unknown>>(
        fixture.databasePath, "SELECT * FROM pronunciation_assessments WHERE id = ?", [assessment.id],
      ),
    ]);
    expect(recordingRowsBefore).toHaveLength(1);
    expect(assessmentRowsBefore).toHaveLength(1);
    const recordingRowDigest = digest(recordingRowsBefore[0]);
    const assessmentRowDigest = digest(assessmentRowsBefore[0]);
    const assessmentResultDigest = digest(assessment.result);
    const afterAssessmentNetwork = await captureProviderNetwork(page);
    const azureHosts = Object.keys(afterAssessmentNetwork.main.observedRequests)
      .map(key => key.split("|").at(-1) || "")
      .filter(host => /(?:^|\.)speech\.microsoft\.com$/iu.test(host));
    expect(azureHosts.length).toBeGreaterThan(0);

    await fixture.restart({ offline: true });
    page = fixture.page;
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 45_000 });
    await navigateTo(page, "/pronunciation_assessments");
    await expect(page.getByTestId(`pronunciation-assessment-card-${assessment.id}`)).toBeVisible();
    const persisted = await page.evaluate(
      (id) => window.__ENJOY_APP__.pronunciationAssessments.findOne({ id }),
      assessment.id,
    );
    expect(digest(persisted.result)).toBe(assessmentResultDigest);
    const offlineReplay = await replayRecording(page, recordingId);
    const { bytes: offlineRecordingBytes, ...offlineReplayEvidence } = offlineReplay;
    expect(offlineReplayEvidence.sha256).toBe(onlineReplayEvidence.sha256);
    expect(sha256(Buffer.from(offlineRecordingBytes))).toBe(physicalRecordingSha256);
    expect(offlineReplayEvidence.currentTime).toBeGreaterThan(0.1);
    const [recordingRowsAfter, assessmentRowsAfter] = await Promise.all([
      queryLocalDatabase<Record<string, unknown>>(
        fixture.databasePath, "SELECT * FROM recordings WHERE id = ?", [recordingId],
      ),
      queryLocalDatabase<Record<string, unknown>>(
        fixture.databasePath, "SELECT * FROM pronunciation_assessments WHERE id = ?", [assessment.id],
      ),
    ]);
    expect(digest(recordingRowsAfter[0])).toBe(recordingRowDigest);
    expect(digest(assessmentRowsAfter[0])).toBe(assessmentRowDigest);
    const afterOfflineRestartNetwork = await captureProviderNetwork(page);
    expect(afterOfflineRestartNetwork.main.observedRequestCount).toBe(0);
    expect(afterOfflineRestartNetwork.renderer.observedRequestCount).toBe(0);
    fixture.assertNoRuntimeIssues();

    const diagnostics = fixture.runtimeDiagnostics();
    const directories = fixture.directories;
    await fixture.close();
    fixture = undefined;
    const cleanup = {
      settingsRemoved: !(await pathExists(directories.settings)),
      libraryRemoved: !(await pathExists(directories.library)),
      chromiumRemoved: !(await pathExists(directories.chromium)),
    };
    expect(cleanup).toEqual({ settingsRemoved: true, libraryRemoved: true, chromiumRemoved: true });
    await writeReceipt(testInfo, "azure-physical-microphone.json", redactCredential({
      pass: true,
      packaged: true,
      appPath,
      appAsarSha256,
      expectedAppAsarSha256,
      testSourceSha256,
      actualPhysicalMicrophone: true,
      requiresParentDeviceEvidence: true,
      captureSource: "production PronunciationAssessmentForm RecorderButton",
      sourceSpeech,
      mediaRecorderImplementedBy: "react-audio-voice-recorder production hook",
      fakeMediaFlagsPresent: false,
      acousticLoopReady: true,
      coordination: {
        runId: coordinationRunId,
        captureReadyMarker: path.basename(markers.captureReady),
        playbackStartedMarker: path.basename(markers.playbackStarted),
        acknowledgementValidated: true,
        playbackStartedAt: new Date(playbackStartedAt).toISOString(),
        playbackStartedAfterCaptureMs,
      },
      countdownSeconds,
      captureMs,
      reference,
      expectedDeviceLabel,
      microphone,
      azure: { region: secureConfig.region, configured: true, credentialValueRecorded: false },
      assessmentId: assessment.id,
      recordingId,
      scores: {
        pronunciation: assessment.pronunciationScore,
        accuracy: assessment.accuracyScore,
        completeness: assessment.completenessScore,
        fluency: assessment.fluencyScore,
        prosody: assessment.prosodyScore,
      },
      wordCount: words.length,
      phonemeCount: phonemes.length,
      assessmentDetail,
      physicalRecording: {
        path: physicalRecordingPath,
        byteCount: physicalRecordingBuffer.byteLength,
        sha256: physicalRecordingSha256,
      },
      recordingSha256: physicalRecordingSha256,
      assessmentResultSha256: assessmentResultDigest,
      sqlite: {
        recordingRowDigestBefore: recordingRowDigest,
        recordingRowDigestAfter: digest(recordingRowsAfter[0]),
        assessmentRowDigestBefore: assessmentRowDigest,
        assessmentRowDigestAfter: digest(assessmentRowsAfter[0]),
      },
      replay: { online: onlineReplayEvidence, offline: offlineReplayEvidence },
      scoreThresholdApplied: false,
      persistedAcrossOfflineRestart: true,
      azureHosts,
      network: { afterAssessment: afterAssessmentNetwork, afterOfflineRestart: afterOfflineRestartNetwork },
      diagnostics,
      cleanup,
    }, secureConfig.key));
  } catch (error) {
    primaryError = error;
    if (fixture) {
      await writeReceipt(testInfo, "azure-physical-microphone-failure.json", redactCredential({
        runtime: fixture.runtimeDiagnostics(),
        error: sanitizeLocalDiagnostic(error instanceof Error ? error.message : String(error))
          .replaceAll(secureConfig.key, "<redacted>"),
      }, secureConfig.key));
    }
    throw new Error("Physical microphone Azure assessment failed; inspect the sanitized receipt");
  } finally {
    await fixture?.close().catch(() => {
      if (!primaryError) throw new Error("Physical microphone fixture cleanup failed");
    });
  }
});
