/* eslint-disable no-empty-pattern -- Electron fixtures do not use a browser fixture. */
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import {
  launchLocalApp,
  writeReceipt,
  type LocalApp,
} from "./helpers/local-app";
import type {
  LearningAsrEngine,
  LearningAsrResult,
} from "../src/types/learning-asr";
import {
  captureProviderNetwork,
  observedHostCount,
} from "./helpers/provider-network";

const runLive = process.env.ENJOY_RUN_PROVIDER_ASR_LIVE === "1";
const snapshot = process.env.ENJOY_PROVIDER_SNAPSHOT?.trim() || "";
const audioInput = process.env.ENJOY_ASR_AUDIO_PATH?.trim() || "";
const selectedService = process.env.ENJOY_ASR_SERVICE?.trim().toLowerCase() || "";
const profileId = process.env.ENJOY_LEGACY_PROFILE_ID?.trim() || "26015977";
const referenceInput = process.env.ENJOY_ASR_REFERENCE_PATH?.trim() || "";
const requireLong = process.env.ENJOY_ASR_REQUIRE_LONG === "1";
const openAiModel = process.env.ENJOY_ASR_OPENAI_MODEL?.trim().toLowerCase() || "configured";
const captureCheckpoints = process.env.ENJOY_ASR_CAPTURE_CHECKPOINTS === "1";
const checkpointCaptureInput = process.env.ENJOY_ASR_CHECKPOINT_CAPTURE_DIR?.trim() || "";
const supportedServices = new Set<LearningAsrEngine>([
  "cloudflare_workers_ai",
  "openai",
  "mai_transcribe",
]);
const supportedOpenAiModels = new Set(["configured", "whisper-1", "gpt-transcribe"]);

test.skip(!runLive, "Set ENJOY_RUN_PROVIDER_ASR_LIVE=1 for a controlled paid live ASR run");
test.skip(!snapshot, "Set ENJOY_PROVIDER_SNAPSHOT to a copied provider profile");
test.skip(!audioInput, "Set ENJOY_ASR_AUDIO_PATH to one explicit short or long source file");
test.skip(
  !supportedServices.has(selectedService as LearningAsrEngine),
  "Set ENJOY_ASR_SERVICE explicitly to cloudflare_workers_ai, openai, or mai_transcribe",
);
test.skip(
  selectedService === "openai" && !supportedOpenAiModels.has(openAiModel),
  "ENJOY_ASR_OPENAI_MODEL must be configured, whisper-1, or gpt-transcribe",
);

const sha256File = async (filePath: string): Promise<string> =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

type CheckpointCaptureManifest = Readonly<{
  state: "captured" | "source-missing";
  rootStatePath: "learning-asr-work";
  directoryCount: number;
  fileCount: number;
  totalBytes: number;
  treeSha256: string;
  files: readonly Readonly<{
    statePath: string;
    size: number;
    sha256: string;
  }>[];
}>;

const checkpointName = /^[a-f0-9]{64}$/u;
const checkpointFileName = /^[a-f0-9]{64}\.json$/u;

async function privateCheckpointCaptureRoot(): Promise<string | undefined> {
  if (!captureCheckpoints) return undefined;
  if (!checkpointCaptureInput || !path.isAbsolute(checkpointCaptureInput)) {
    throw new Error("ENJOY_ASR_CHECKPOINT_CAPTURE_DIR must be one absolute private directory");
  }
  const root = path.resolve(checkpointCaptureInput);
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700) {
    throw new Error("ENJOY_ASR_CHECKPOINT_CAPTURE_DIR must be a non-symlink directory with mode 0700");
  }
  if ((await readdir(root)).length !== 0) {
    throw new Error("ENJOY_ASR_CHECKPOINT_CAPTURE_DIR must be empty before the run");
  }
  return root;
}

async function captureCheckpointState(
  sourceRoot: string,
  captureRoot: string,
): Promise<CheckpointCaptureManifest> {
  const rootStatePath = "learning-asr-work" as const;
  const destinationRoot = path.join(captureRoot, rootStatePath);
  try {
    const sourceInfo = await lstat(sourceRoot);
    if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
      throw new Error("Learning ASR checkpoint root is not a plain directory");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      state: "source-missing",
      rootStatePath,
      directoryCount: 0,
      fileCount: 0,
      totalBytes: 0,
      treeSha256: digest([]),
      files: [],
    };
  }

  await mkdir(destinationRoot, { mode: 0o700 });
  await chmod(destinationRoot, 0o700);
  const files: Array<{ statePath: string; size: number; sha256: string }> = [];
  let directoryCount = 1;
  const providerDirectories = await readdir(sourceRoot, { withFileTypes: true });
  for (const providerDirectory of providerDirectories.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!providerDirectory.isDirectory() || providerDirectory.isSymbolicLink() || !checkpointName.test(providerDirectory.name)) {
      throw new Error("Learning ASR checkpoint root contains an unexpected entry");
    }
    const sourceProvider = path.join(sourceRoot, providerDirectory.name);
    const destinationProvider = path.join(destinationRoot, providerDirectory.name);
    await mkdir(destinationProvider, { mode: 0o700 });
    await chmod(destinationProvider, 0o700);
    directoryCount += 1;
    const checkpointFiles = await readdir(sourceProvider, { withFileTypes: true });
    for (const checkpointFile of checkpointFiles.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!checkpointFile.isFile() || checkpointFile.isSymbolicLink() || !checkpointFileName.test(checkpointFile.name)) {
        throw new Error("Learning ASR checkpoint directory contains an unexpected entry");
      }
      const sourceFile = path.join(sourceProvider, checkpointFile.name);
      const bytes = await readFile(sourceFile);
      if (bytes.byteLength > 16_000_000) throw new Error("Learning ASR checkpoint exceeds the supported size");
      const destinationFile = path.join(destinationProvider, checkpointFile.name);
      await copyFile(sourceFile, destinationFile);
      await chmod(destinationFile, 0o600);
      files.push({
        statePath: path.posix.join(rootStatePath, providerDirectory.name, checkpointFile.name),
        size: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  return {
    state: "captured",
    rootStatePath,
    directoryCount,
    fileCount: files.length,
    totalBytes,
    treeSha256: digest(files),
    files,
  };
}

const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[’‘]/gu, "'")
    .match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) || [];

const wordErrorRate = (reference: string, hypothesis: string) => {
  const expected = tokens(reference);
  const actual = tokens(hypothesis);
  let row = Array.from({ length: actual.length + 1 }, (_, index) => index);
  for (let expectedIndex = 1; expectedIndex <= expected.length; expectedIndex += 1) {
    const next = [expectedIndex];
    for (let actualIndex = 1; actualIndex <= actual.length; actualIndex += 1) {
      next[actualIndex] = Math.min(
        next[actualIndex - 1] + 1,
        row[actualIndex] + 1,
        row[actualIndex - 1] + (expected[expectedIndex - 1] === actual[actualIndex - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return {
    referenceWords: expected.length,
    hypothesisWords: actual.length,
    edits: row[actual.length],
    wer: expected.length ? row[actual.length] / expected.length : null,
  };
};

const existingFile = async (candidate: string): Promise<string | undefined> => {
  try {
    await access(candidate);
    return candidate;
  } catch {
    return undefined;
  }
};

async function loadReference(audioPath: string): Promise<{
  source: "explicit" | "sidecar" | "known-jfk";
  text: string;
} | undefined> {
  if (referenceInput) {
    const referencePath = path.resolve(referenceInput);
    return { source: "explicit", text: (await readFile(referencePath, "utf8")).trim() };
  }
  const sidecar = await existingFile(audioPath.replace(path.extname(audioPath), ".txt"));
  if (sidecar) return { source: "sidecar", text: (await readFile(sidecar, "utf8")).trim() };
  if (path.basename(audioPath).toLowerCase() === "jfk.wav") {
    return {
      source: "known-jfk",
      text: "And so, my fellow Americans, ask not what your country can do for you, ask what you can do for your country.",
    };
  }
  return undefined;
}

function validateTimeline(result: LearningAsrResult): { sentences: number; words: number } {
  expect(result.validation.timestampChecks).toBe("passed");
  expect(result.validation.sourceCoverage).toBe("complete");
  expect(result.validation.textCoverage).toBe("matched");
  expect(result.duration).toBeGreaterThan(0);
  let previousSentenceEnd = 0;
  let wordCount = 0;
  for (const sentence of result.timeline) {
    expect(sentence.type).toBe("sentence");
    expect(sentence.startTime).toBeGreaterThanOrEqual(previousSentenceEnd - 1e-6);
    expect(sentence.endTime).toBeGreaterThan(sentence.startTime);
    expect(sentence.endTime).toBeLessThanOrEqual(result.duration + 1e-6);
    let previousWordEnd = sentence.startTime;
    for (const word of sentence.timeline) {
      expect(["word", "token"]).toContain(word.type);
      expect(word.text.trim()).not.toBe("");
      expect(word.startTime).toBeGreaterThanOrEqual(previousWordEnd - 1e-6);
      expect(word.startTime).toBeGreaterThanOrEqual(sentence.startTime - 1e-6);
      expect(word.endTime).toBeGreaterThan(word.startTime);
      expect(word.endTime).toBeLessThanOrEqual(sentence.endTime + 1e-6);
      previousWordEnd = word.endTime;
      wordCount += 1;
    }
    previousSentenceEnd = sentence.endTime;
  }
  expect(result.timeline.length).toBeGreaterThan(0);
  expect(wordCount).toBeGreaterThan(0);
  return { sentences: result.timeline.length, words: wordCount };
}

async function validateRenderedTimeline(
  page: Page,
  result: LearningAsrResult,
): Promise<{ sentencesVisited: number; renderedWords: number; wordsPerSentence: number[] }> {
  const wordsPerSentence: number[] = [];
  let renderedWords = 0;
  const nextSentence = page.locator([
    'button[data-tooltip-content="Phát đoạn tiếp theo"]',
    'button[data-tooltip-content="play next segment"]',
  ].join(", ")).first();
  for (const [sentenceIndex, sentence] of result.timeline.entries()) {
    if (sentenceIndex > 0) {
      await page.mouse.move(1, 1);
      await page.keyboard.press("Escape");
      await expect(page.locator("[data-radix-popper-content-wrapper]:visible")).toHaveCount(0);
      await expect(nextSentence).toBeEnabled();
      await nextSentence.click();
    }
    const words = page.locator(`[id^="word-${sentenceIndex}-"]`);
    await expect(words.first()).toBeVisible();
    await expect.poll(() => words.count()).toBe(sentence.timeline.length);
    const renderedTexts = await words.evaluateAll((nodes) => nodes.map((node) =>
      node.querySelector("span")?.textContent?.trim() || ""));
    expect(renderedTexts.every(Boolean)).toBe(true);
    wordsPerSentence.push(renderedTexts.length);
    renderedWords += renderedTexts.length;
  }
  await expect(nextSentence).toBeDisabled();
  return {
    sentencesVisited: wordsPerSentence.length,
    renderedWords,
    wordsPerSentence,
  };
}

test("configured provider ASR transcribes, renders, and survives restart", async ({}, testInfo) => {
  test.setTimeout(900_000);
  const snapshotPath = path.resolve(snapshot);
  const audioPath = path.resolve(audioInput);
  const [snapshotHashBefore, audioHashBefore, reference] = await Promise.all([
    sha256File(snapshotPath),
    sha256File(audioPath),
    loadReference(audioPath),
  ]);
  const service = selectedService as LearningAsrEngine;
  const checkpointCaptureRoot = await privateCheckpointCaptureRoot();
  let fixture: LocalApp | undefined;
  let jobId: string | undefined;
  let completed = false;
  let primaryError: unknown;
  let checkpointCaptureFailure: unknown;
  const receipt: Record<string, unknown> = {
    candidate: process.env.ENJOY_E2E_APP_PATH || null,
    service,
    expectedCloudflareModel:
      service === "cloudflare_workers_ai"
        ? "@cf/openai/whisper-large-v3-turbo"
        : null,
    requestedOpenAiModel: service === "openai" ? openAiModel : null,
    expectedMaiModel: service === "mai_transcribe" ? "microsoft/mai-transcribe-2" : null,
    profileId,
    sourcePath: audioPath,
    sourceSha256: audioHashBefore,
    referenceSource: reference?.source || null,
    referenceSha256: reference ? createHash("sha256").update(reference.text).digest("hex") : null,
    requireLong,
    phase: "initialized",
    checkpointCapture: {
      state: checkpointCaptureRoot ? "pending" : "disabled",
      rootStatePath: "learning-asr-work",
    },
    startedAt: new Date().toISOString(),
  };

  try {
    fixture = await launchLocalApp({
      offline: false,
      seed: { databasePath: snapshotPath, profileId, assets: [] },
    });
    expect(path.resolve(fixture.databasePath)).not.toBe(snapshotPath);
    let page = fixture.page;
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 45_000 });
    receipt.phase = "app-ready";

    const providerHostname = await page.evaluate(async (requestedService) => {
      if (requestedService === "mai_transcribe") return "openrouter.ai";
      if (requestedService === "cloudflare_workers_ai") {
        const config = await window.__ENJOY_APP__.cloudflareTranscribe.getConfig();
        if (!config.configured) {
          throw new Error("Copied Cloudflare configuration is incomplete");
        }
        return new URL(config.baseUrl).hostname;
      }
      const value = await window.__ENJOY_APP__.userSettings.get("openai");
      const configured = typeof value?.baseUrl === "string" ? value.baseUrl.trim() : "";
      return new URL(configured || "https://api.openai.com/v1").hostname;
    }, service);
    receipt.phase = "provider-ready";

    if (service === "openai" && openAiModel !== "configured") {
      const configured = await page.evaluate(async (model) => {
        const value = await window.__ENJOY_APP__.userSettings.get("openai");
        const keyConfigured = typeof value?.key === "string" && value.key.trim().length > 0;
        await window.__ENJOY_APP__.userSettings.set("openai", {
          ...value,
          transcriptionModel: model,
        });
        return { keyConfigured };
      }, openAiModel);
      expect(configured.keyConfigured, "Copied OpenAI setting must contain a configured key").toBe(true);
    }

    const audioUrl = await page.evaluate(
      (source) => window.__ENJOY_APP__.echogarden.transcode(source),
      audioPath,
    );
    expect(audioUrl).toMatch(/^enjoy:\/\/library\/cache\/.+\.wav$/u);
    receipt.phase = "audio-transcoded";
    jobId = randomUUID();
    const started = Date.now();
    const live = await page.evaluate(
      async ({ audioUrl: trustedAudioUrl, requestedService, requestedJobId }) => {
        const api = window.__ENJOY_APP__;
        const context = await api.learning.getContext();
        const progress = {
          events: 0,
          maximumPercent: 0,
          stages: [] as string[],
        };
        const unsubscribe = api.learningAsr.onProgress((_event, update) => {
          if (update.jobId !== requestedJobId) return;
          progress.events += 1;
          progress.maximumPercent = Math.max(progress.maximumPercent, update.percent);
          if (!progress.stages.includes(update.stage)) progress.stages.push(update.stage);
        });
        try {
          const response = await api.learningAsr.start({
            jobId: requestedJobId,
            profileId: context.profileId,
            connectionId: context.connectionId,
            audioUrl: trustedAudioUrl,
            service: requestedService,
            language: "en-US",
          });
          return { response, progress, context };
        } catch (error) {
          await api.learningAsr.cancel(requestedJobId).catch(() => false);
          throw error;
        } finally {
          unsubscribe();
        }
      },
      { audioUrl, requestedService: service, requestedJobId: jobId },
    );
    completed = true;
    receipt.elapsedMs = Date.now() - started;
    receipt.progress = live.progress;
    receipt.profileContext = live.context;
    receipt.pipelineResponse = live.response.ok
      ? {
          ok: true,
          engine: live.response.result.engine,
          model: live.response.result.model,
          duration: live.response.result.duration,
          transcriptSha256: createHash("sha256").update(live.response.result.transcript).digest("hex"),
          transcriptBytes: Buffer.byteLength(live.response.result.transcript),
          transcriptWords: tokens(live.response.result.transcript).length,
          validation: live.response.result.validation,
          timelineSentences: live.response.result.timeline.length,
        }
      : { ok: false, error: live.response.error };
    receipt.phase = "asr-finished";
    expect(live.progress.events).toBeGreaterThan(0);
    expect(live.progress.maximumPercent).toBeGreaterThan(0);
    expect(live.response.ok, JSON.stringify(live.response.ok ? {} : live.response.error)).toBe(true);
    if (!live.response.ok) throw new Error(live.response.error.code);

    const afterProviderNetwork = await captureProviderNetwork(page);
    const providerHostRequestCount = observedHostCount(
      afterProviderNetwork.main,
      providerHostname,
    );
    expect(providerHostRequestCount).toBeGreaterThan(0);
    receipt.network = {
      providerHostname,
      providerHostRequestCount,
      providerHostObserved: providerHostRequestCount > 0,
      afterProvider: afterProviderNetwork,
    };
    receipt.phase = "provider-network-verified";

    const result = live.response.result;
    const geometry = validateTimeline(result);
    if (requireLong) {
      expect(result.duration).toBeGreaterThanOrEqual(600);
      expect(reference, "Long ASR acceptance requires an independent reference").toBeDefined();
    }
    expect(result.engine).toBe(service);
    if (service === "cloudflare_workers_ai") {
      expect(result.model).toBe("@cf/openai/whisper-large-v3-turbo");
    }
    if (service === "mai_transcribe") expect(result.model).toBe("microsoft/mai-transcribe-2");
    if (service === "openai") {
      expect(["whisper-1", "gpt-transcribe"]).toContain(result.model);
      if (openAiModel !== "configured") expect(result.model).toBe(openAiModel);
    }
    const accuracy = reference ? wordErrorRate(reference.text, result.transcript) : null;
    if (reference) expect(accuracy?.wer).toBeLessThanOrEqual(0.2);
    receipt.result = {
      engine: result.engine,
      model: result.model,
      transcriptSha256: createHash("sha256").update(result.transcript).digest("hex"),
      transcriptBytes: Buffer.byteLength(result.transcript),
      transcriptWords: tokens(result.transcript).length,
      duration: result.duration,
      validation: result.validation,
      geometry,
      accuracy,
    };
    receipt.phase = "timeline-validated";

    const persisted = await page.evaluate(
      async ({ source, asrResult }) => {
        const api = window.__ENJOY_APP__;
        const audio = await api.audios.create(source, {
          name: "Provider ASR live acceptance",
          compressing: false,
        });
        const transcription = await api.transcriptions.findOrCreate({
          targetId: audio.id,
          targetType: "Audio",
        });
        await api.transcriptions.update(transcription.id, {
          state: "finished",
          engine: asrResult.engine,
          model: asrResult.model,
          language: asrResult.language,
          result: {
            timeline: asrResult.timeline,
            transcript: asrResult.transcript,
            validation: asrResult.validation,
          },
        });
        return { audioId: audio.id, transcriptionId: transcription.id };
      },
      { source: audioPath, asrResult: result },
    );
    receipt.persisted = persisted;
    receipt.phase = "persisted";
    const expectedResultDigest = digest({
      timeline: result.timeline,
      transcript: result.transcript,
      validation: result.validation,
    });

    await fixture.restart({ offline: true });
    page = fixture.page;
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 45_000 });
    const afterRestartNetwork = await captureProviderNetwork(page);
    receipt.network = {
      ...(receipt.network as Record<string, unknown>),
      afterRestart: afterRestartNetwork,
    };
    const restored = await page.evaluate(async ({ audioId }) => {
      const transcription = await window.__ENJOY_APP__.transcriptions.findOrCreate({
        targetId: audioId,
        targetType: "Audio",
      });
      window.location.hash = `/audios/${audioId}`;
      return transcription;
    }, persisted);
    expect(restored.id).toBe(persisted.transcriptionId);
    expect(restored.state).toBe("finished");
    expect(restored.engine).toBe(result.engine);
    expect(restored.model).toBe(result.model);
    expect(digest(restored.result)).toBe(expectedResultDigest);

    await expect(page.getByTestId("media-player-container")).toBeVisible({ timeout: 60_000 });
    receipt.restartPersistence = {
      resultSha256: expectedResultDigest,
      offlineRestartVerified: true,
    };
    receipt.phase = "offline-content-verified";
    const renderedTimeline = await validateRenderedTimeline(page, result);
    expect(renderedTimeline.sentencesVisited).toBe(geometry.sentences);
    expect(renderedTimeline.renderedWords).toBe(geometry.words);
    receipt.restartPersistence = {
      ...(receipt.restartPersistence as Record<string, unknown>),
      renderedTimeline,
    };
    receipt.originalSnapshotUnchanged = (await sha256File(snapshotPath)) === snapshotHashBefore;
    receipt.originalAudioUnchanged = (await sha256File(audioPath)) === audioHashBefore;
    expect(receipt.originalSnapshotUnchanged).toBe(true);
    expect(receipt.originalAudioUnchanged).toBe(true);
    receipt.runtime = fixture.runtimeDiagnostics();
    fixture.assertNoRuntimeIssues();
    receipt.phase = "restart-verified";
    receipt.completed = true;
  } catch (error) {
    primaryError = error;
    receipt.failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw error;
  } finally {
    if (fixture && jobId && !completed) {
      await fixture.page.evaluate(
        (activeJobId) => window.__ENJOY_APP__.learningAsr.cancel(activeJobId),
        jobId,
      ).catch(() => false);
    }
    if (fixture) {
      receipt.runtime = fixture.runtimeDiagnostics();
      if (!receipt.network) {
        receipt.failureNetwork = await captureProviderNetwork(fixture.page).catch(() => null);
      }
      if (checkpointCaptureRoot) {
        try {
          receipt.checkpointCapture = await captureCheckpointState(
            path.join(path.dirname(fixture.databasePath), "learning-asr-work"),
            checkpointCaptureRoot,
          );
        } catch (error) {
          checkpointCaptureFailure = error;
          receipt.checkpointCapture = {
            state: "capture-failed",
            rootStatePath: "learning-asr-work",
          };
        }
      }
    }
    receipt.finishedAt = new Date().toISOString();
    await writeReceipt(testInfo, "provider-asr-live.json", receipt);
    await fixture?.close().catch((error) => {
      if (!primaryError) throw error;
    });
    if (!primaryError) {
      expect(checkpointCaptureFailure, "Opt-in checkpoint capture must complete").toBeUndefined();
    }
  }
});
