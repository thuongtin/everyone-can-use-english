/* eslint-disable no-empty-pattern -- Electron acceptance uses a packaged application fixture. */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type TestInfo } from "@playwright/test";

import type { LearningAsrResult } from "../src/types/learning-asr";
import {
  BUILD8_SPEECH_COVERAGE_SHA256,
  BUILD9_ASAR_SHA256,
  BUILD9_SERVICE_SHA256,
  JFK_REFERENCE,
  JFK_SOURCE_SHA256,
  PROVIDER_BOUNDARY_LABEL,
  SOURCE_CAPTURE_SHA256,
  YAMNET_MODEL_SHA256,
  configureFixtureProvider,
  createComposedAsrFixture,
  createPipelineManifest,
  flattenWords,
  installProviderBoundary,
  launchPackagedFixtureApp,
  providerBoundaryObservation,
  readPipelineWav,
  startLearningAsr,
  verifyBuild9Identity,
  type ProviderResponseFixture,
} from "./helpers/packaged-asr-offline-fixture";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "..");
const repositoryRoot = path.resolve(projectRoot, "..");
const evidenceRoot = path.join(repositoryRoot, ".superpowers/sdd/2026-09-10-azure-models");
const jfkPath = path.join(projectRoot, "samples/jfk.wav");
const sourceCapturePath = path.join(projectRoot, "tmp/asr-learning-quality-2026-09-09/native12diagnostic/source-1788917632924.wav");
const build9AppPath = path.join(projectRoot, "out/local-signed-build9/Enjoy-darwin-arm64/Enjoy.app");
const build9FfmpegPath = path.join(build9AppPath, "Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg");
const sha256 = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex");

type CaseMode = "whole-success" | "fallback-prefix";

async function writeEvidence(info: TestInfo, mode: CaseMode, value: unknown): Promise<string> {
  await mkdir(evidenceRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const target = path.join(evidenceRoot, `packaged-fallback-${mode}-${stamp}.json`);
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(target, body, { mode: 0o600, flag: "wx" });
  await info.attach(path.basename(target), { body, contentType: "application/json" });
  return target;
}

function assertTimeline(result: LearningAsrResult): { sentences: number; words: number; wordsSha256: string } {
  expect(result.validation.sourceCoverage).toBe("complete");
  expect(result.validation.textCoverage).toBe("matched");
  expect(result.validation.timestampChecks).toBe("passed");
  expect(result.validation.speechGapCheck).toBe("passed");
  let previousSentenceEnd = 0;
  const words = flattenWords(result);
  for (const sentence of result.timeline) {
    expect(sentence.type).toBe("sentence");
    expect(sentence.startTime).toBeGreaterThanOrEqual(previousSentenceEnd - 1e-6);
    expect(sentence.endTime).toBeGreaterThan(sentence.startTime);
    let previousWordEnd = sentence.startTime;
    for (const word of sentence.timeline.filter(entry => entry.type === "word")) {
      expect(word.text.trim()).not.toBe("");
      expect(word.startTime).toBeGreaterThanOrEqual(previousWordEnd - 1e-6);
      expect(word.endTime).toBeGreaterThan(word.startTime);
      expect(word.endTime).toBeLessThanOrEqual(sentence.endTime + 1e-6);
      previousWordEnd = word.endTime;
    }
    previousSentenceEnd = sentence.endTime;
  }
  expect(words.length).toBeGreaterThan(0);
  return { sentences: result.timeline.length, words: words.length, wordsSha256: sha256(JSON.stringify(words)) };
}

function assertInstrumentalEvidence(result: LearningAsrResult): void {
  const evidence = result.validation.instrumentalMusic;
  expect(evidence?.length).toBeGreaterThan(0);
  const intro = evidence!.find(item => item.startTime < 3.7 && item.endTime > 0.09);
  expect(intro).toBeDefined();
  expect(intro!.modelSha256).toBe(YAMNET_MODEL_SHA256);
  expect(intro!.musicMean).toBeGreaterThanOrEqual(0.5);
  expect(intro!.vocalMax).toBeLessThanOrEqual(0.1);
  expect(intro!.analyzedWindows).toBeGreaterThan(0);
}

async function runCase(mode: CaseMode, info: TestInfo): Promise<void> {
  test.setTimeout(360_000);
  const previousAppPath = process.env.ENJOY_E2E_APP_PATH;
  process.env.ENJOY_E2E_APP_PATH = build9AppPath;
  let fixtureAudio: Awaited<ReturnType<typeof createComposedAsrFixture>> | undefined;
  let app: Awaited<ReturnType<typeof launchPackagedFixtureApp>> | undefined;
  let appCloseObserved = false;
  let primaryError: unknown;
  const cleanupErrors: string[] = [];
  let receipt: Record<string, unknown> = {
    pass: false,
    mode,
    providerBoundaryFixture: true,
    actualProviderInference: false,
    syntheticComposition: true,
    fixtureLabel: PROVIDER_BOUNDARY_LABEL,
    build9AppPath,
    expectedBuild9AsarSha256: BUILD9_ASAR_SHA256,
    expectedBuild9ServiceSha256: BUILD9_SERVICE_SHA256,
    expectedSpeechCoverageSha256: BUILD8_SPEECH_COVERAGE_SHA256,
    publicJfkTextSha256: sha256(JFK_REFERENCE),
    sourceSeeds: {
      jfkSha256: JFK_SOURCE_SHA256,
      instrumentalCaptureSha256: SOURCE_CAPTURE_SHA256,
    },
    networkObservationScope: {
      launchControls: "offline-context-and-loopback-proxy-from-launch",
      classifierPhase: "context-online-after-loopback-only-route-and-exact-main-fetch-guard",
      requestDiagnostics: "provider-boundary-install-to-result",
      preHookMainHttpDiagnostics: "not-observed",
      providerTransport: "main-fetch-fixture-before-network-transport",
    },
    startedAt: new Date().toISOString(),
  };
  try {
    const buildIdentity = await verifyBuild9Identity({ appPath: build9AppPath, repositoryRoot });
    receipt.buildIdentity = buildIdentity;
    fixtureAudio = await createComposedAsrFixture({ jfkPath, sourceCapturePath });
    receipt.sourceCompositionSha256 = fixtureAudio.sourceSha256;
    receipt.sourceComposition = {
      introSeconds: fixtureAudio.introSeconds,
      silenceSeconds: fixtureAudio.silenceSeconds,
      separatorSeconds: fixtureAudio.separatorSeconds,
      tailSeconds: fixtureAudio.tailSeconds,
      repeatCount: fixtureAudio.repeatCount,
      repeatStarts: fixtureAudio.repeatStarts,
    };
    app = await launchPackagedFixtureApp();
    app.electronApp.once("close", () => { appCloseObserved = true; });
    expect(await app.page.evaluate(() => window.__ENJOY_APP__.app.isPackaged())).toBe(true);
    const pipeline = await readPipelineWav(app.page, fixtureAudio.sourcePath);
    const whole = mode === "fallback-prefix" ? fixtureAudio.wholeFallback : fixtureAudio.wholeSuccess;
    const manifest = await createPipelineManifest({
      wav: pipeline.wav,
      directory: fixtureAudio.directory,
      ffmpegPath: build9FfmpegPath,
      repeatStarts: fixtureAudio.repeatStarts,
      wholeTranscript: whole,
    });
    const wholeFixture: ProviderResponseFixture = {
      id: mode,
      format: "mp3",
      audioSha256: manifest.wholeMp3Sha256,
      response: whole,
      maximumCalls: 1,
    };
    const allowedWindows = mode === "whole-success"
      ? []
      : manifest.windowFixtures.filter(item => item.id === `window-${manifest.expectedResumeIndex}`);
    await installProviderBoundary(app, [wholeFixture, ...allowedWindows], pipeline.wav);
    await configureFixtureProvider(app.page);
    const run = await startLearningAsr(app.page, pipeline.audioUrl);
    const observation = await providerBoundaryObservation(app);
    receipt = {
      ...receipt,
      pipelineSourceSha256: manifest.sourceSha256,
      sourceToPipeline: {
        composedSourceSha256: fixtureAudio.sourceSha256,
        transcodedPipelineSha256: manifest.sourceSha256,
        relation: "production-echogarden-transcode",
        trustedAudioUrl: /^enjoy:\/\/library\/cache\/[^/?#]+\.wav$/u.test(pipeline.audioUrl),
      },
      sourceSamples: manifest.sourceSamples,
      sampleRate: manifest.sampleRate,
      duration: manifest.duration,
      wholeMp3Sha256: manifest.wholeMp3Sha256,
      wholeMp3Bytes: manifest.wholeMp3Bytes,
      plannedWindows: manifest.windows,
      expectedResumeIndex: manifest.expectedResumeIndex,
      expectedPrefixEndSample: manifest.expectedPrefixEndSample,
      expectedSeam: manifest.expectedSeam,
      windowTranscriptGeometry: manifest.windowTranscriptGeometry,
      progress: run.progress,
      responseError: run.response.ok ? null : { ...run.response.error },
      providerBoundary: observation,
    };

    expect(observation.rejectedUrls).toEqual([]);
    expect(observation.undiciNetworkRequests).toEqual([]);
    expect(observation.nodeHttpRequests.filter(host => host && !/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/u.test(host))).toEqual([]);
    expect(observation.requests[0]?.format).toBe("mp3");
    expect(observation.requests[0]?.audioSha256).toBe(manifest.wholeMp3Sha256);
    expect(/^enjoy:\/\/library\/cache\/[^/?#]+\.wav$/u.test(pipeline.audioUrl)).toBe(true);
    expect(run.response.ok, JSON.stringify(run.response.ok ? {} : run.response.error)).toBe(true);
    if (!run.response.ok) throw new Error(run.response.error.code);
    const result = run.response.result;
    const geometry = assertTimeline(result);
    assertInstrumentalEvidence(result);
    receipt.result = {
      engine: result.engine,
      model: result.model,
      transcriptSha256: sha256(result.transcript),
      transcriptTokenCount: result.transcript.split(/\s+/u).filter(Boolean).length,
      timelineSha256: sha256(JSON.stringify(result.timeline)),
      validation: result.validation,
      geometry,
    };

    if (mode === "whole-success") {
      expect(result.validation.transport).toBe("whole");
      expect(observation.requests.map(item => item.format)).toEqual(["mp3"]);
      expect(result.transcript).toBe(fixtureAudio.wholeSuccess.transcript);
    } else if (mode === "fallback-prefix") {
      expect(result.validation.transport).toBe("windows");
      expect(manifest.expectedResumeIndex).toBeGreaterThan(0);
      expect(observation.requests.map(item => item.responseId)).toEqual([mode, `window-${manifest.expectedResumeIndex}`]);
      for (let index = 0; index < manifest.expectedResumeIndex; index += 1) {
        expect(observation.requests.some(item => item.responseId === `window-${index}`)).toBe(false);
      }
      const expectedText = Array.from({ length: fixtureAudio.repeatCount }, () => JFK_REFERENCE).join(" ");
      expect(result.transcript).toBe(expectedText);
    }
    app.assertNoRuntimeIssues();
    receipt.runtimeAssertionsPassed = true;
  } catch (error) {
    primaryError = error;
    receipt.failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  } finally {
    receipt.finishedAt = new Date().toISOString();
    let appClosed: boolean | null = app ? false : null;
    let appCloseCheckPassed: boolean | null = app ? false : null;
    let fixtureRemoved: boolean | null = fixtureAudio ? false : null;
    if (app) {
      try {
        await app.close();
        appCloseCheckPassed = true;
      } catch (error) {
        cleanupErrors.push(`app:${error instanceof Error ? error.message : String(error)}`);
      }
      appClosed = appCloseObserved;
    }
    if (fixtureAudio) {
      try {
        await fixtureAudio.cleanup();
        fixtureRemoved = true;
      } catch (error) {
        cleanupErrors.push(`fixture:${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (previousAppPath === undefined) delete process.env.ENJOY_E2E_APP_PATH;
    else process.env.ENJOY_E2E_APP_PATH = previousAppPath;
    const envRestored = process.env.ENJOY_E2E_APP_PATH === previousAppPath;
    if (!envRestored) cleanupErrors.push("environment:ENJOY_E2E_APP_PATH_restore_failed");
    receipt.cleanup = { appClosed, appCloseCheckPassed, fixtureRemoved, envRestored, errors: cleanupErrors };
    receipt.pass = primaryError === undefined && cleanupErrors.length === 0 && envRestored;
    try {
      await writeEvidence(info, mode, receipt);
    } catch (error) {
      cleanupErrors.push(`evidence:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (primaryError && cleanupErrors.length) {
    throw new AggregateError([primaryError, ...cleanupErrors.map(message => new Error(message))], "packaged_fixture_run_and_cleanup_failed");
  }
  if (primaryError) throw primaryError;
  if (cleanupErrors.length) throw new Error(`packaged_fixture_cleanup_failed:${cleanupErrors.join("|")}`);
}

test("packaged whole success uses real alignment and music-aware coverage", async ({}, info) => {
  await runCase("whole-success", info);
});

test("packaged fallback resumes from a real whole-aligned prefix", async ({}, info) => {
  await runCase("fallback-prefix", info);
});
