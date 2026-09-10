/* eslint-disable no-empty-pattern -- Electron fixtures do not use a browser fixture. */
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

import {
  launchLocalApp,
  sanitizeLocalDiagnostic,
  writeReceipt,
  type LocalApp,
} from "./helpers/local-app";
import {
  captureProviderNetwork,
  observedHostCount,
} from "./helpers/provider-network";
import type {
  LearningAsrEngine,
  LearningAsrResult,
} from "../src/types/learning-asr";

test.use({ trace: "off" });

const runLive = process.env.ENJOY_RUN_AZURE_MODELS_LIVE === "1";
const credentialInput = process.env.ENJOY_AZURE_CREDENTIAL_FILE?.trim() || "";
const customAudioInput = process.env.ENJOY_AZURE_ASR_AUDIO_PATH?.trim() || "";
const customReferenceInput = process.env.ENJOY_AZURE_ASR_REFERENCE_PATH?.trim() || "";
const requireLongSource = process.env.ENJOY_AZURE_ASR_REQUIRE_LONG === "1";
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const audioPath = path.resolve(testDirectory, "../samples/jfk.wav");
const reference =
  "And so, my fellow Americans, ask not what your country can do for you, ask what you can do for your country.";
const minimumLongDurationSeconds = 600;
const asrSourceLabel = customAudioInput ? "custom source" : "JFK";

if (Boolean(customAudioInput) !== Boolean(customReferenceInput)) {
  throw new Error(
    "ENJOY_AZURE_ASR_AUDIO_PATH and ENJOY_AZURE_ASR_REFERENCE_PATH must be set together",
  );
}

if (requireLongSource && !customAudioInput) {
  throw new Error(
    "ENJOY_AZURE_ASR_REQUIRE_LONG=1 requires ENJOY_AZURE_ASR_AUDIO_PATH and ENJOY_AZURE_ASR_REFERENCE_PATH",
  );
}

type AzureCredential = Readonly<{
  region: string;
  key: string;
  endpoint: string;
  textEndpoint?: string;
  deployment?: string;
}>;

type AzureEngineCase = Readonly<{
  engine: Extract<LearningAsrEngine, "azure_mai" | "azure_speech">;
  expectedModel: string;
}>;

type AsrSource = Readonly<{
  audioPath: string;
  audioBasename: string;
  audioSha256: string;
  reference: string;
  referenceBasename?: string;
  referenceSha256: string;
  referenceTokenCount: number;
  mode: "jfk-short" | "custom" | "custom-long-required";
}>;

const engineCases: readonly AzureEngineCase[] = [
  { engine: "azure_mai", expectedModel: "MAI-Transcribe-2" },
  { engine: "azure_speech", expectedModel: "azure-speech-fast" },
];

const sha256 = (value: Buffer | string): string =>
  createHash("sha256").update(value).digest("hex");

const resultDigest = (value: unknown): string =>
  sha256(JSON.stringify(value));

const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[’‘]/gu, "'")
    .match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) || [];

const wordErrorRate = (expectedText: string, actualText: string) => {
  const expected = tokens(expectedText);
  const actual = tokens(actualText);
  let row = Array.from({ length: actual.length + 1 }, (_, index) => index);
  for (let expectedIndex = 1; expectedIndex <= expected.length; expectedIndex += 1) {
    const next = [expectedIndex];
    for (let actualIndex = 1; actualIndex <= actual.length; actualIndex += 1) {
      next[actualIndex] = Math.min(
        next[actualIndex - 1] + 1,
        row[actualIndex] + 1,
        row[actualIndex - 1] +
          (expected[expectedIndex - 1] === actual[actualIndex - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return {
    referenceWords: expected.length,
    hypothesisWords: actual.length,
    edits: row[actual.length],
    wer: row[actual.length] / expected.length,
  };
};

const resolveAsrSource = async (): Promise<AsrSource> => {
  if (!customAudioInput) {
    const audio = await readFile(audioPath);
    return {
      audioPath,
      audioBasename: path.basename(audioPath),
      audioSha256: sha256(audio),
      reference,
      referenceSha256: sha256(reference),
      referenceTokenCount: tokens(reference).length,
      mode: "jfk-short",
    };
  }

  const resolvedAudioPath = path.resolve(customAudioInput);
  const resolvedReferencePath = path.resolve(customReferenceInput);
  const [audioMetadata, referenceMetadata, audio, referenceBytes] = await Promise.all([
    stat(resolvedAudioPath),
    stat(resolvedReferencePath),
    readFile(resolvedAudioPath),
    readFile(resolvedReferencePath),
  ]);
  expect(audioMetadata.isFile(), "Custom ASR audio path must point to a file").toBe(true);
  expect(referenceMetadata.isFile(), "Custom ASR reference path must point to a file").toBe(true);
  const customReference = referenceBytes.toString("utf8").trim();
  const referenceTokenCount = tokens(customReference).length;
  expect(referenceTokenCount, "Custom ASR reference must contain tokens").toBeGreaterThan(0);
  return {
    audioPath: resolvedAudioPath,
    audioBasename: path.basename(resolvedAudioPath),
    audioSha256: sha256(audio),
    reference: customReference,
    referenceBasename: path.basename(resolvedReferencePath),
    referenceSha256: sha256(referenceBytes),
    referenceTokenCount,
    mode: requireLongSource ? "custom-long-required" : "custom",
  };
};

const requireHttpsUrl = (value: unknown, field: string): string => {
  expect(typeof value, `${field} must be a string`).toBe("string");
  const cleaned = String(value).trim();
  const parsed = new URL(cleaned);
  expect(parsed.protocol, `${field} must use HTTPS`).toBe("https:");
  expect(parsed.username || parsed.password, `${field} must not contain credentials`).toBe("");
  return cleaned;
};

const readPrivateCredential = async (): Promise<AzureCredential> => {
  const resolved = path.resolve(credentialInput);
  const metadata = await stat(resolved);
  expect(metadata.isFile()).toBe(true);
  expect(metadata.mode & 0o777, "Azure credential file must have mode 0600").toBe(0o600);
  const parsed = JSON.parse(await readFile(resolved, "utf8")) as Record<string, unknown>;
  const region = typeof parsed.region === "string" ? parsed.region.trim().toLowerCase() : "";
  const key = typeof parsed.key === "string" ? parsed.key.trim() : "";
  const endpoint = requireHttpsUrl(parsed.endpoint, "endpoint");
  const textEndpoint = parsed.textEndpoint === undefined
    ? undefined
    : requireHttpsUrl(parsed.textEndpoint, "textEndpoint");
  const deployment = typeof parsed.deployment === "string" ? parsed.deployment.trim() : "";
  expect(region).toMatch(/^[a-z0-9-]+$/u);
  expect(key.length).toBeGreaterThan(0);
  expect(new URL(endpoint).hostname).toMatch(/\.cognitiveservices\.azure\.com$/u);
  return {
    region,
    key,
    endpoint,
    ...(textEndpoint ? { textEndpoint } : {}),
    ...(deployment ? { deployment } : {}),
  };
};

const openPreferences = async (page: Page) => {
  const button = page.getByRole("button", { name: /Cài đặt|Preferences/i }).first();
  await expect(button).toBeVisible();
  await button.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
};

const choosePreferencesTab = async (dialog: ReturnType<Page["getByRole"]>, name: RegExp) => {
  const tab = dialog.getByRole("button", { name }).first();
  await expect(tab).toBeVisible();
  await tab.click();
};

const closePreferences = async (page: Page) => {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
};

async function assertAzureSettingsOptions(page: Page): Promise<void> {
  const dialog = await openPreferences(page);
  await choosePreferencesTab(dialog, /Nâng cao|Advanced/i);
  const detailedServices = dialog.getByRole("button", {
    name: /Cấu hình chi tiết dịch vụ|Detailed service configuration/i,
  });
  await expect(detailedServices).toBeVisible();
  await detailedServices.click();
  await expect(detailedServices).toHaveAttribute("aria-expanded", "true");

  const providerForm = dialog
    .getByText(/^(?:Dịch vụ AI mặc định|Default AI engine)$/iu)
    .locator("xpath=ancestor::form[1]");
  await providerForm.getByRole("button", { name: /^(?:Sửa|Chỉnh sửa|Edit)$/iu }).click();
  const providerSelect = providerForm.getByRole("combobox").first();
  await expect(providerSelect).toBeVisible();
  await expect(providerSelect).toBeEnabled();
  await providerSelect.click();
  await expect(page.getByRole("option", { name: "Azure OpenAI", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  const sttSelect = dialog.getByTestId("stt-engine-select");
  await expect(sttSelect).toBeVisible();
  await sttSelect.click();
  await expect(page.getByTestId("stt-engine-azure-mai")).toBeVisible();
  await expect(page.getByTestId("stt-engine-azure-speech")).toBeVisible();
  await page.keyboard.press("Escape");
  await closePreferences(page);
}

async function assertAzureSourceOptions(page: Page, source: string): Promise<string> {
  const audio = await page.evaluate(
    (input) => window.__ENJOY_APP__.audios.create(input, {
      name: "Azure models live acceptance",
      compressing: false,
    }),
    source,
  );
  await page.evaluate((audioId) => {
    window.location.hash = `/audios/${audioId}`;
  }, audio.id);
  await expect(page.getByTestId("media-player-container")).toBeVisible({ timeout: 60_000 });
  // A newly imported audio opens the transcription setup automatically.
  const service = page.getByTestId("transcription-service-select");
  await expect(service).toBeVisible({ timeout: 60_000 });
  await service.click();
  await expect(page.getByTestId("stt-engine-azure-mai")).toBeVisible();
  await expect(page.getByTestId("stt-engine-azure-speech")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog").getByRole("button", { name: /Hủy|Cancel/i }).click();
  return audio.id;
}

function validateTimeline(result: LearningAsrResult): { sentences: number; words: number } {
  expect(result.validation.timestampChecks).toBe("passed");
  expect(result.validation.sourceCoverage).toBe("complete");
  expect(result.validation.textCoverage).toBe("matched");
  expect(result.validation.speechGapCheck).toBe("passed");
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

test("packaged UI exposes Azure OpenAI and both Azure transcription sources", async ({}) => {
  const fixture = await launchLocalApp({ offline: true });
  try {
    await expect(fixture.page.getByTestId("layout-home")).toBeVisible({ timeout: 45_000 });
    await assertAzureSettingsOptions(fixture.page);
    const audioId = await assertAzureSourceOptions(fixture.page, audioPath);
    expect(audioId).not.toBe("");
    fixture.assertNoRuntimeIssues();
  } finally {
    await fixture.close();
  }
});

test.describe("paid Azure model acceptance", () => {
  test.skip(!runLive, "Set ENJOY_RUN_AZURE_MODELS_LIVE=1 for controlled paid Azure calls");
  test.skip(!credentialInput, "Set ENJOY_AZURE_CREDENTIAL_FILE to a private mode-0600 JSON file");

  for (const { engine, expectedModel } of engineCases) {
    test(`[azure-asr] ${engine} transcribes ${asrSourceLabel} through the packaged pipeline and persists offline`, async ({}, testInfo) => {
      test.setTimeout(900_000);
      const asrSource = await resolveAsrSource();
      const credential = await readPrivateCredential();
      const providerHostname = new URL(credential.endpoint).hostname;
      let fixture: LocalApp | undefined;
      let jobId: string | undefined;
      let completed = false;
      let primaryError: unknown;
      const receipt: Record<string, unknown> = {
        pass: false,
        engine,
        expectedModel,
        sourceMode: asrSource.mode,
        sourceBasename: asrSource.audioBasename,
        sourceFileSha256: asrSource.audioSha256,
        referenceBasename: asrSource.referenceBasename,
        referenceSha256: asrSource.referenceSha256,
        referenceTokenCount: asrSource.referenceTokenCount,
        ...(asrSource.mode === "jfk-short" ? { reference: asrSource.reference } : {}),
        longRequirement: {
          required: requireLongSource,
          minimumDurationSeconds: requireLongSource ? minimumLongDurationSeconds : null,
        },
        region: credential.region,
        providerHostname,
        startedAt: new Date().toISOString(),
      };

      try {
        fixture = await launchLocalApp({ offline: false });
        let page = fixture.page;
        await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 45_000 });
        await assertAzureSettingsOptions(page);
        const audioId = await assertAzureSourceOptions(page, asrSource.audioPath);

        const configured = await page.evaluate(
          async ({ config, selectedEngine }) => {
            const saved = await window.__ENJOY_APP__.speeches.setAzureConfig(config);
            await window.__ENJOY_APP__.userSettings.set("stt_engine", selectedEngine);
            return {
              saved,
              selected: await window.__ENJOY_APP__.userSettings.get("stt_engine"),
            };
          },
          {
            config: {
              region: credential.region,
              key: credential.key,
              endpoint: credential.endpoint,
            },
            selectedEngine: engine,
          },
        );
        expect(configured.saved.transcriptionConfigured).toBe(true);
        expect(configured.selected).toBe(engine);

        const transcoded = await page.evaluate(async (source) => {
          const audioUrl = await window.__ENJOY_APP__.echogarden.transcode(source);
          const response = await fetch(audioUrl);
          if (!response.ok) throw new Error("transcoded_audio_read_failed");
          const bytes = await response.arrayBuffer();
          const view = new DataView(bytes);
          const chunkId = (offset: number): string =>
            String.fromCharCode(...new Uint8Array(bytes, offset, 4));
          if (bytes.byteLength < 12 || chunkId(0) !== "RIFF" || chunkId(8) !== "WAVE") {
            throw new Error("transcoded_audio_invalid_wav");
          }
          let byteRate = 0;
          let dataBytes = 0;
          for (let offset = 12; offset + 8 <= bytes.byteLength;) {
            const id = chunkId(offset);
            const size = view.getUint32(offset + 4, true);
            const dataOffset = offset + 8;
            if (dataOffset + size > bytes.byteLength) {
              throw new Error(`transcoded_audio_invalid_${id.trim() || "unknown"}_chunk`);
            }
            if (id === "fmt ") {
              if (size < 16) throw new Error("transcoded_audio_invalid_fmt_chunk");
              byteRate = view.getUint32(dataOffset + 8, true);
            } else if (id === "data") {
              dataBytes += size;
            }
            offset = dataOffset + size + (size % 2);
          }
          if (byteRate <= 0 || dataBytes <= 0) {
            throw new Error("transcoded_audio_missing_wav_metadata");
          }
          const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
          return {
            audioUrl,
            sha256: Array.from(hash, (value) => value.toString(16).padStart(2, "0")).join(""),
            durationSeconds: dataBytes / byteRate,
          };
        }, asrSource.audioPath);
        expect(transcoded.audioUrl).toMatch(/^enjoy:\/\/library\/cache\/.+\.wav$/u);
        const pipelineSourceSha256 = transcoded.sha256;
        const sourceDurationSeconds = transcoded.durationSeconds;
        receipt.sourceDurationSeconds = sourceDurationSeconds;
        if (requireLongSource) {
          expect(
            sourceDurationSeconds,
            `Long ASR source must be at least ${minimumLongDurationSeconds} seconds`,
          ).toBeGreaterThanOrEqual(minimumLongDurationSeconds);
        }
        jobId = randomUUID();
        const started = Date.now();
        const live = await page.evaluate(
          async ({ audioUrl, requestedEngine, requestedJobId }) => {
            const api = window.__ENJOY_APP__;
            const context = await api.learning.getContext();
            const progress = { events: 0, maximumPercent: 0, stages: [] as string[] };
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
                audioUrl,
                service: requestedEngine,
                language: "en-US",
              });
              return { context, progress, response };
            } finally {
              unsubscribe();
            }
          },
          { audioUrl: transcoded.audioUrl, requestedEngine: engine, requestedJobId: jobId },
        );
        completed = true;
        expect(live.progress.events).toBeGreaterThan(0);
        expect(live.progress.maximumPercent).toBeGreaterThan(0);
        expect(live.response.ok, JSON.stringify(live.response.ok ? {} : live.response.error)).toBe(true);
        if (!live.response.ok) throw new Error(live.response.error.code);

        const result = live.response.result;
        receipt.elapsedMs = Date.now() - started;
        receipt.profileContext = live.context;
        receipt.progress = live.progress;
        receipt.result = {
          engine: result.engine,
          model: result.model,
          language: result.language,
          transcriptSha256: sha256(result.transcript),
          transcriptBytes: Buffer.byteLength(result.transcript, "utf8"),
          transcriptTokenCount: tokens(result.transcript).length,
          duration: result.duration,
          validation: result.validation,
        };
        receipt.pipelineSourceSha256 = pipelineSourceSha256;
        const geometry = validateTimeline(result);
        receipt.result = { ...(receipt.result as Record<string, unknown>), geometry };
        const accuracy = wordErrorRate(asrSource.reference, result.transcript);
        receipt.result = { ...(receipt.result as Record<string, unknown>), accuracy };
        receipt.hypothesisTokenCount = accuracy.hypothesisWords;
        expect(result.engine).toBe(engine);
        expect(result.model).toBe(expectedModel);
        expect(result.validation.sourceSha256).toBe(pipelineSourceSha256);
        expect(accuracy.wer).toBeLessThanOrEqual(0.2);
        if (requireLongSource) {
          expect(
            result.duration,
            `Long ASR result must cover at least ${minimumLongDurationSeconds} seconds`,
          ).toBeGreaterThanOrEqual(minimumLongDurationSeconds);
        }

        const network = await captureProviderNetwork(page);
        const providerHostRequestCount = observedHostCount(network.main, providerHostname);
        expect(providerHostRequestCount).toBeGreaterThan(0);
        expect(network.main.legacyBackendOperationCount).toBe(0);
        expect(network.renderer.legacyBackendOperationCount).toBe(0);
        receipt.network = {
          actualAzureRequest: true,
          providerHostRequestCount,
          zeroEnjoyBackendOperations: true,
          afterProvider: network,
        };

        const persisted = await page.evaluate(
          async ({ persistedAudioId, asrResult }) => {
            const api = window.__ENJOY_APP__;
            const transcription = await api.transcriptions.findOrCreate({
              targetId: persistedAudioId,
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
            return { audioId: persistedAudioId, transcriptionId: transcription.id };
          },
          { persistedAudioId: audioId, asrResult: result },
        );
        const expectedDigest = resultDigest({
          timeline: result.timeline,
          transcript: result.transcript,
          validation: result.validation,
        });
        receipt.persistence = {
          ...persisted,
          resultSha256: expectedDigest,
          storedBeforeRestart: true,
        };

        await fixture.restart({ offline: true });
        page = fixture.page;
        await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 45_000 });
        const restored = await page.evaluate(async ({ audioId: restoredAudioId }) => {
          const transcription = await window.__ENJOY_APP__.transcriptions.findOrCreate({
            targetId: restoredAudioId,
            targetType: "Audio",
          });
          window.location.hash = `/audios/${restoredAudioId}`;
          return transcription;
        }, persisted);
        expect(restored.id).toBe(persisted.transcriptionId);
        expect(restored.state).toBe("finished");
        expect(restored.engine).toBe(engine);
        expect(restored.model).toBe(expectedModel);
        expect(resultDigest(restored.result)).toBe(expectedDigest);
        await expect(page.getByTestId("media-player-container")).toBeVisible({ timeout: 60_000 });
        const renderedTimeline = await validateRenderedTimeline(page, result);
        expect(renderedTimeline.sentencesVisited).toBe(geometry.sentences);
        expect(renderedTimeline.renderedWords).toBe(geometry.words);
        const offlineNetwork = await captureProviderNetwork(page);
        expect(observedHostCount(offlineNetwork.main, providerHostname)).toBe(0);
        expect(sha256(await readFile(asrSource.audioPath))).toBe(asrSource.audioSha256);
        fixture.assertNoRuntimeIssues();

        receipt.pass = true;
        receipt.network = {
          ...(receipt.network as Record<string, unknown>),
          afterOfflineRestart: offlineNetwork,
        };
        receipt.persistence = {
          ...(receipt.persistence as Record<string, unknown>),
          renderedTimeline,
          offlineRestartVerified: true,
        };
      } catch (error) {
        primaryError = error;
        receipt.failure = sanitizeLocalDiagnostic(
          error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        );
        throw error;
      } finally {
        if (fixture && jobId && !completed) {
          await fixture.page.evaluate(
            (activeJobId) => window.__ENJOY_APP__.learningAsr.cancel(activeJobId),
            jobId,
          ).catch(() => false);
        }
        receipt.finishedAt = new Date().toISOString();
        await writeReceipt(testInfo, `azure-models-${engine}.json`, receipt);
        await fixture?.close().catch((error) => {
          if (!primaryError) throw error;
        });
      }
    });
  }
});
