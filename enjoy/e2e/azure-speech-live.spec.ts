/* eslint-disable no-empty-pattern -- Electron fixtures do not use a browser fixture. */
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

import { launchLocalApp, writeReceipt, type LocalApp } from "./helpers/local-app";
import { captureProviderNetwork } from "./helpers/provider-network";

const runAcceptance = process.env.ENJOY_RUN_AZURE_SPEECH_ACCEPTANCE === "1";
const configFile = process.env.ENJOY_AZURE_CREDENTIAL_FILE?.trim() || "";
const reference = "Cup. I have a cup of tea.";
const voice = "en-US-JennyNeural";

test.skip(!runAcceptance, "Set ENJOY_RUN_AZURE_SPEECH_ACCEPTANCE=1 for controlled Azure Speech acceptance");
test.skip(!configFile, "Set ENJOY_AZURE_CREDENTIAL_FILE to a private mode-0600 JSON file");

type AzureConfig = Readonly<{ region: string; key: string }>;
type AzureWebSocketObservation = Readonly<{
  undiciUpgradeHosts: Readonly<Record<string, number>>;
  undiciOpenCount: number;
  httpUpgradeHosts: Readonly<Record<string, number>>;
}>;

const installAzureWebSocketObserver = (fixture: LocalApp): Promise<void> =>
  fixture.electronApp.evaluate(() => {
    const diagnostics = process.getBuiltinModule("node:diagnostics_channel");
    const scope = globalThis as typeof globalThis & {
      __ENJOY_AZURE_WS_TEST__?: {
        undiciUpgradeHosts: Record<string, number>;
        undiciOpenCount: number;
        httpUpgradeHosts: Record<string, number>;
      };
    };
    const observation = {
      undiciUpgradeHosts: {} as Record<string, number>,
      undiciOpenCount: 0,
      httpUpgradeHosts: {} as Record<string, number>,
    };
    scope.__ENJOY_AZURE_WS_TEST__ = observation;
    const hostname = (value: unknown): string => {
      try {
        return new URL(String(value)).hostname.toLowerCase();
      } catch {
        return "";
      }
    };
    const increment = (target: Record<string, number>, host: string): void => {
      if (/(?:^|\.)speech\.microsoft\.com$/iu.test(host)) {
        target[host] = (target[host] || 0) + 1;
      }
    };
    diagnostics.channel("undici:request:create").subscribe((message: unknown) => {
      const request = (message as { request?: { origin?: unknown; upgrade?: unknown } })?.request;
      if (String(request?.upgrade || "").toLowerCase() === "websocket") {
        increment(observation.undiciUpgradeHosts, hostname(request?.origin));
      }
    });
    diagnostics.channel("undici:websocket:open").subscribe(() => {
      observation.undiciOpenCount += 1;
    });
    diagnostics.channel("http.client.request.start").subscribe((message: unknown) => {
      const request = (message as { request?: {
        getHeader?: (name: string) => unknown;
        once?: (event: string, listener: (response: { statusCode?: number }) => void) => void;
      } })?.request;
      const host = String(request?.getHeader?.("host") || "").split(":")[0].toLowerCase();
      if (!/(?:^|\.)speech\.microsoft\.com$/iu.test(host)) return;
      request?.once?.("upgrade", (response) => {
        if (response?.statusCode === 101) increment(observation.httpUpgradeHosts, host);
      });
    });
  });

const readAzureWebSocketObservation = (fixture: LocalApp): Promise<AzureWebSocketObservation> =>
  fixture.electronApp.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      __ENJOY_AZURE_WS_TEST__?: AzureWebSocketObservation;
    };
    return scope.__ENJOY_AZURE_WS_TEST__ || {
      undiciUpgradeHosts: {},
      undiciOpenCount: 0,
      httpUpgradeHosts: {},
    };
  });

const readPrivateConfig = async (): Promise<AzureConfig> => {
  const resolved = path.resolve(configFile);
  const metadata = await stat(resolved);
  expect(metadata.isFile()).toBe(true);
  expect(metadata.mode & 0o077).toBe(0);
  const parsed = JSON.parse(await readFile(resolved, "utf8")) as Record<string, unknown>;
  const region = typeof parsed.region === "string" ? parsed.region.trim().toLowerCase() : "";
  const key = typeof parsed.key === "string" ? parsed.key.trim() : "";
  expect(region).toMatch(/^[a-z0-9-]+$/u);
  expect(key.length).toBeGreaterThan(0);
  return { region, key };
};

const azureObservedHosts = (capture: Awaited<ReturnType<typeof captureProviderNetwork>>): string[] =>
  Object.keys(capture.main.observedRequests)
    .map((entry) => entry.split("|").at(-1) || "")
    .filter((hostname) => /(?:^|\.)speech\.microsoft\.com$/iu.test(hostname));

test("Azure TTS and pronunciation assessment persist with playable WAV and phonemes", async ({}, info) => {
  test.setTimeout(180_000);
  const secureConfig = await readPrivateConfig();
  let fixture: LocalApp | undefined;
  let speechId: string | undefined;
  let recordingId: string | undefined;

  try {
    fixture = await launchLocalApp({ offline: false });
    await installAzureWebSocketObserver(fixture);
    let page = fixture.page;
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 45_000 });

    const generated = await page.evaluate(
      async ({ config, text, selectedVoice, sourceId }) => {
        const saved = await window.__ENJOY_APP__.speeches.setAzureConfig(config);
        if (!saved.configured) throw new Error("azure_config_not_persisted");
        const speech = await window.__ENJOY_APP__.speeches.generate({
          sourceId,
          sourceType: "None",
          text,
          configuration: { engine: "azure", model: "azure/speech", voice: selectedVoice },
        });
        const response = await fetch(speech.src);
        if (!response.ok) throw new Error("azure_speech_read_failed");
        return {
          config: saved,
          speech,
          bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
        };
      },
      { config: secureConfig, text: reference, selectedVoice: voice, sourceId: randomUUID() },
    );
    speechId = generated.speech.id;
    const audioBytes = Buffer.from(generated.bytes);
    expect(audioBytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(audioBytes.subarray(8, 12).toString("ascii")).toBe("WAVE");

    const playback = await page.evaluate(async ({ bytes, text }) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      const audio = document.createElement("audio");
      audio.muted = true;
      audio.src = url;
      document.body.append(audio);
      try {
        await new Promise<void>((resolve, reject) => {
          audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
          audio.addEventListener("error", () => reject(new Error("azure_wav_decode_failed")), { once: true });
          audio.load();
        });
        await audio.play();
        await new Promise((resolve) => setTimeout(resolve, 350));
        const currentTime = audio.currentTime;
        const duration = audio.duration;
        audio.pause();
        const recording = await window.__ENJOY_APP__.recordings.create({
          language: "en-US",
          referenceText: text,
          duration: Math.max(1, Math.round(duration * 1_000)),
          blob: { type: "audio/wav", arrayBuffer: await blob.arrayBuffer() },
        });
        return { currentTime, duration, recording };
      } finally {
        audio.remove();
        URL.revokeObjectURL(url);
      }
    }, { bytes: generated.bytes, text: reference });
    expect(playback.duration).toBeGreaterThan(0);
    expect(playback.currentTime).toBeGreaterThan(0.1);
    recordingId = playback.recording.id;

    const assessment = await page.evaluate(
      ({ id, text }) => window.__ENJOY_APP__.pronunciationAssessments.assess({
        recordingId: id,
        language: "en-US",
        reference: text,
      }),
      { id: recordingId, text: reference },
    );
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
    expect(assessment.result?.provider).toBe("azure");
    const words = Array.isArray(assessment.result?.words) ? assessment.result.words : [];
    const phonemes = words.flatMap((word: { phonemes?: unknown[] }) => word.phonemes || []);
    expect(words.length).toBeGreaterThan(0);
    expect(phonemes.length).toBeGreaterThan(0);
    const assessmentResultHash = createHash("sha256")
      .update(JSON.stringify(assessment.result))
      .digest("hex");

    const network = await captureProviderNetwork(page);
    const observedAzureHosts = azureObservedHosts(network);
    const websocket = await readAzureWebSocketObservation(fixture);
    const directlyObservedWebSocket =
      Object.keys(websocket.httpUpgradeHosts).length > 0 ||
      (Object.keys(websocket.undiciUpgradeHosts).length > 0 && websocket.undiciOpenCount > 0);
    await page.getByTestId("sidebar-pronunciation-assessments").click();
    await expect(page.getByTestId(`pronunciation-assessment-card-${assessment.id}`)).toBeVisible();
    await page.screenshot({ path: info.outputPath("azure-pronunciation.png"), fullPage: true });

    await fixture.restart({ offline: true });
    page = fixture.page;
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 45_000 });
    const persisted = await page.evaluate(async ({ assessmentId, persistedSpeechId }) => {
      const speech = await window.__ENJOY_APP__.speeches.findOne({ id: persistedSpeechId });
      const response = await fetch(speech.src);
      if (!response.ok) throw new Error("persisted_azure_speech_read_failed");
      const bytes = Array.from(new Uint8Array(await response.arrayBuffer()));
      const blob = new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      const audio = document.createElement("audio");
      audio.muted = true;
      audio.src = url;
      document.body.append(audio);
      try {
        await new Promise<void>((resolve, reject) => {
          audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
          audio.addEventListener("error", () => reject(new Error("persisted_azure_wav_decode_failed")), { once: true });
          audio.load();
        });
        await audio.play();
        await new Promise((resolve) => setTimeout(resolve, 350));
        return {
          config: await window.__ENJOY_APP__.speeches.getAzureConfig(),
          assessment: await window.__ENJOY_APP__.pronunciationAssessments.findOne({ id: assessmentId }),
          bytes,
          duration: audio.duration,
          currentTime: audio.currentTime,
        };
      } finally {
        audio.pause();
        audio.remove();
        URL.revokeObjectURL(url);
      }
    }, { assessmentId: assessment.id, persistedSpeechId: speechId });
    expect(persisted.config).toEqual({ region: secureConfig.region, endpoint: "", configured: true, transcriptionConfigured: false });
    expect(persisted.assessment.id).toBe(assessment.id);
    expect(persisted.assessment.result?.provider).toBe("azure");
    expect(createHash("sha256").update(Buffer.from(persisted.bytes)).digest("hex"))
      .toBe(createHash("sha256").update(audioBytes).digest("hex"));
    expect(persisted.duration).toBeGreaterThan(0);
    expect(persisted.currentTime).toBeGreaterThan(0.1);
    expect(createHash("sha256").update(JSON.stringify(persisted.assessment.result)).digest("hex"))
      .toBe(assessmentResultHash);
    await page.getByTestId("sidebar-pronunciation-assessments").click({ timeout: 45_000 });
    await expect(page.getByTestId(`pronunciation-assessment-card-${assessment.id}`)).toBeVisible();
    const afterOfflineRestartNetwork = await captureProviderNetwork(page);
    expect(observedAzureHosts.length, "main process did not observe Azure Speech requests").toBeGreaterThan(0);
    expect(directlyObservedWebSocket, "main process did not directly observe an Azure Speech WebSocket upgrade").toBe(true);
    fixture.assertNoRuntimeIssues();

    const receipt = {
      pass: true,
      actualAzureTts: true,
      actualAzurePronunciation: true,
      reference,
      voice,
      region: secureConfig.region,
      configured: generated.config.configured,
      speechId,
      recordingId,
      assessmentId: assessment.id,
      wav: {
        byteCount: audioBytes.length,
        sha256: createHash("sha256").update(audioBytes).digest("hex"),
        duration: playback.duration,
        htmlPlaybackAdvanced: playback.currentTime > 0.1,
      },
      scores: {
        pronunciation: assessment.pronunciationScore,
        accuracy: assessment.accuracyScore,
        completeness: assessment.completenessScore,
        fluency: assessment.fluencyScore,
        prosody: assessment.prosodyScore,
      },
      wordCount: words.length,
      phonemeCount: phonemes.length,
      assessmentDetail: assessment.result,
      persistedAcrossRestart: true,
      persistence: {
        audioSha256: createHash("sha256").update(Buffer.from(persisted.bytes)).digest("hex"),
        assessmentResultSha256: assessmentResultHash,
        htmlPlaybackAdvancedAfterOfflineRestart: persisted.currentTime > 0.1,
      },
      observedAzureHosts,
      mainSdkAzureHostObserved: observedAzureHosts.length > 0,
      websocketObservation: {
        directlyObserved: directlyObservedWebSocket,
        inferredFromAzureSpeechSdkCall: !directlyObservedWebSocket && observedAzureHosts.length > 0,
        ...websocket,
      },
      network: { afterProviderCalls: network, afterOfflineRestart: afterOfflineRestartNetwork },
      runtime: fixture.runtimeDiagnostics(),
    };
    await writeFile(info.outputPath("azure-tts.wav"), audioBytes, { mode: 0o600 });
    await writeReceipt(info, "azure-speech-live.json", receipt);
  } catch (error) {
    if (fixture) {
      await writeReceipt(info, "azure-failure-diagnostics.json", {
        runtime: fixture.runtimeDiagnostics(),
        websocket: await readAzureWebSocketObservation(fixture).catch(() => null),
        policies: await fixture.page.evaluate(async () => ({
          main: await window.__ENJOY_APP__.app.networkPolicyDiagnostics(),
          renderer: window.__ENJOY_RENDERER_NETWORK_POLICY__(),
          azure: await window.__ENJOY_APP__.speeches.getAzureConfig(),
        })).catch(() => null),
      });
    }
    throw error;
  } finally {
    if (fixture) {
      const page = fixture.page;
      if (recordingId) await page.evaluate((id) => window.__ENJOY_APP__.recordings.destroy(id), recordingId).catch(() => undefined);
      if (speechId) await page.evaluate((id) => window.__ENJOY_APP__.speeches.delete(id), speechId).catch(() => undefined);
      await fixture.close();
    }
  }
});
