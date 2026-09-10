/* global globalThis:readonly */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import * as installedSdk from "microsoft-cognitiveservices-speech-sdk";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-direct-pronunciation-"));
const output = path.join(temp, "azure-sdk.mjs");

try {
  await build({
    stdin: {
      contents: `export * from "./src/main/azure-speech-sdk.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
    plugins: [{
      name: "direct-pronunciation-fixture",
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^microsoft-cognitiveservices-speech-sdk$/ }, () => ({ path: "sdk", namespace: "fixture" }));
        pluginBuild.onResolve({ filter: /^fs-extra$/ }, () => ({ path: "fs", namespace: "fixture" }));
        pluginBuild.onResolve({ filter: /^@main\/logger$/ }, () => ({ path: "logger", namespace: "fixture" }));
        pluginBuild.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          loader: "js",
          contents: args.path === "fs" ? `export default { readFileSync() { return Buffer.from("wav"); } };`
            : args.path === "logger" ? `export default { scope() { return { debug() {} }; } };`
            : `
              const fixture = () => globalThis.__directPronunciationFixture;
              export const ResultReason = { RecognizedSpeech: 1, NoMatch: 2, Canceled: 3 };
              export const CancellationReason = { Error: 1 };
              export const PronunciationAssessmentGradingSystem = { HundredMark: 1 };
              export const PronunciationAssessmentGranularity = { Phoneme: 1 };
              export const OutputFormat = { Detailed: 1 };
              export const PropertyId = { SpeechServiceResponse_JsonResult: 1 };
              export const SpeechConfig = {
                fromSubscription(key, region) {
                  fixture().subscriptions.push({ key, region });
                  return { requestWordLevelTimestamps() {} };
                },
              };
              export const AudioConfig = { fromWavFileInput() { return {}; } };
              export class PronunciationAssessmentConfig {
                constructor(reference) {
                  if (reference === undefined || reference === null) throw new Error("referenceText is required");
                  fixture().references.push(reference);
                }
                applyTo() {}
              }
              export const PronunciationAssessmentResult = {
                fromResult() { return fixture().assessmentResult; },
              };
              export const CancellationDetails = { fromResult() { return { reason: 1, errorDetails: "secret-provider-detail" }; } };
              export class SpeechRecognizer {
                constructor() { fixture().recognizers.push(this); }
                recognizeOnceAsync(completed) {
                  fixture().recognizeCalls += 1;
                  queueMicrotask(() => completed({ reason: fixture().reason }));
                }
                close() { fixture().closeCalls += 1; }
                stopContinuousRecognitionAsync() {}
                startContinuousRecognitionAsync() {}
              }
            `,
        }));
      },
    }],
  });

  const { AzureSpeechSdk } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
  const fixture = {
    subscriptions: [],
    references: [],
    recognizers: [],
    recognizeCalls: 0,
    closeCalls: 0,
    reason: 1,
    assessmentResult: {
      pronunciationScore: 82,
      accuracyScore: 80,
      completenessScore: 90,
      fluencyScore: 75,
      detailResult: { Words: [] },
    },
  };
  globalThis.__directPronunciationFixture = fixture;

  const installedUnscriptedConfig = new installedSdk.PronunciationAssessmentConfig(
    "",
    installedSdk.PronunciationAssessmentGradingSystem.HundredMark,
    installedSdk.PronunciationAssessmentGranularity.Phoneme,
    true,
  );
  assert.equal(installedUnscriptedConfig.referenceText, "");
  assert.equal("referenceText" in JSON.parse(installedUnscriptedConfig.toJSON()), false);

  const direct = new AzureSpeechSdk("direct-key", "eastus");
  const result = await direct.pronunciationAssessment({
    filePath: "/fixture.wav",
    reference: "Hello",
    language: "en-US",
  });
  assert.equal(result.pronunciationScore, 82);
  assert.deepEqual(fixture.subscriptions, [{ key: "direct-key", region: "eastus" }]);
  assert.deepEqual(fixture.references, ["Hello"]);
  assert.equal(fixture.closeCalls, 1);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    direct.pronunciationAssessment({ filePath: "/fixture.wav", signal: controller.signal }),
    /cancelled/,
  );
  assert.deepEqual(fixture.references, ["Hello", ""]);
  assert.equal(fixture.recognizeCalls, 1);

  fixture.reason = 3;
  await assert.rejects(
    direct.pronunciationAssessment({ filePath: "/fixture.wav" }),
    (error) => error.message === "Azure Speech request failed." && !error.message.includes("secret-provider-detail"),
  );

  const handlerSource = await readFile(
    path.join(root, "src/main/db/handlers/pronunciation-assessments-handler.ts"),
    "utf8",
  );
  const hookSource = await readFile(
    path.join(root, "src/renderer/hooks/use-pronunciation-assessments.tsx"),
    "utf8",
  );
  assert.match(handlerSource, /getAzureSpeechCredentials\(\)/);
  assert.match(handlerSource, /active profile changed during pronunciation assessment/i);
  assert.match(handlerSource, /database\.transaction/);
  assert.match(handlerSource, /continuousPronunciationAssessment/);
  assert.doesNotMatch(handlerSource, /EnjoyAI|generateSpeechToken|tokenId/);
  assert.match(hookSource, /pronunciationAssessments\.assess\(/);
  assert.doesNotMatch(hookSource, /microsoft-cognitiveservices|fromAuthorizationToken|Client/);
  console.info("check-direct-pronunciation: PASS (direct auth, cancellation, redaction and main-process routing)");
} finally {
  delete globalThis.__directPronunciationFixture;
  await rm(temp, { recursive: true, force: true });
}
