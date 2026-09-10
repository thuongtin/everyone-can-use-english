/* eslint-disable no-empty-pattern -- Electron fixtures do not use a browser fixture. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import {
  launchLocalApp,
  queryLocalDatabase,
  writeReceipt,
  type LocalApp,
} from "./helpers/local-app";
import { captureProviderNetwork, observedHostCount } from "./helpers/provider-network";

const { learningMap } = createRequire(import.meta.url)(
  "../scripts/fixtures/learning-lesson.mjs"
);

const runAcceptance =
  process.env.ENJOY_RUN_CONFIGURED_SPEECH_ACCEPTANCE === "1";
const snapshot = process.env.ENJOY_PROVIDER_SNAPSHOT?.trim() || "";
const service = process.env.ENJOY_SPEECH_SERVICE?.trim().toLowerCase() || "";
const model =
  process.env.ENJOY_SPEECH_MODEL?.trim().toLowerCase() ||
  "gpt-4o-mini-tts";
const voice = process.env.ENJOY_SPEECH_VOICE?.trim().toLowerCase() || "alloy";
const profileId = process.env.ENJOY_LEGACY_PROFILE_ID?.trim() || "26015977";
const supportedModels = new Set(["tts-1", "tts-1-hd", "gpt-4o-mini-tts"]);
const supportedVoices = new Set([
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
]);

test.skip(
  !runAcceptance,
  "Set ENJOY_RUN_CONFIGURED_SPEECH_ACCEPTANCE=1 for controlled live speech acceptance"
);
test.skip(!snapshot, "Set ENJOY_PROVIDER_SNAPSHOT to a copied provider profile");
test.skip(service !== "openai", "Set ENJOY_SPEECH_SERVICE=openai explicitly");
test.skip(!supportedModels.has(model), "Select an OpenAI TTS model from the app catalog");
test.skip(!supportedVoices.has(voice), "Select an OpenAI TTS voice from the app catalog");

const sha256File = async (filePath: string): Promise<string> =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

test("configured OpenAI speech narrates and persists a playable map-node asset", async ({}, info) => {
  test.setTimeout(180_000);
  const snapshotPath = path.resolve(snapshot);
  const sourceHashBefore = await sha256File(snapshotPath);
  let fixture: LocalApp | undefined;
  let mapId: string | undefined;
  let cleanup: "not-started" | "pending" | "completed" | "failed" =
    "not-started";

  try {
    fixture = await launchLocalApp({
      offline: false,
      seed: { databasePath: snapshotPath, profileId, assets: [] },
    });
    expect(path.resolve(fixture.databasePath)).not.toBe(snapshotPath);

    let page = fixture.page;
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 45_000 });
    const providerState = await page.evaluate(
      async ({ selectedModel, selectedVoice }) => {
        const before = await window.__ENJOY_APP__.userSettings.get("tts_config");
        const openai = await window.__ENJOY_APP__.userSettings.get("openai");
        const keyConfigured =
          typeof openai?.key === "string" && openai.key.trim().length > 0;
        await window.__ENJOY_APP__.userSettings.set("tts_config", {
          engine: "openai",
          model: selectedModel,
          voice: selectedVoice,
        });
        return {
          migratedEngine:
            before && typeof before === "object" && typeof before.engine === "string"
              ? before.engine
              : null,
          keyConfigured,
        };
      },
      { selectedModel: model, selectedVoice: voice }
    );
    expect(providerState.migratedEngine).toBe("needs-selection");
    expect(providerState.keyConfigured).toBe(true);

    await page.reload();
    await page.getByTestId("sidebar-learning-studio").click({ timeout: 45_000 });
    await expect(page.getByTestId("learning-studio")).toBeVisible();
    const created = await page.evaluate(async () => {
      const bridge = window.__ENJOY_APP__.learning;
      const context = await bridge.getContext();
      const result = await bridge.request(context, "createMap", {
        title: "Temporary speech acceptance",
      });
      return { mapId: result.map.id, revisionId: result.revision.id };
    });
    mapId = created.mapId;
    cleanup = "pending";
    await writeFile(
      info.outputPath("owned-map.json"),
      JSON.stringify({ mapId, cleanup }),
      { encoding: "utf8", mode: 0o600 }
    );

    created.revisionId = await page.evaluate(
      async ({ current, graph }) => {
        const bridge = window.__ENJOY_APP__.learning;
        const context = await bridge.getContext();
        const revised = await bridge.request(context, "reviseMap", {
          mapId: current.mapId,
          expectedRevisionId: current.revisionId,
          content: graph,
        });
        return revised.revision.id;
      },
      { current: created, graph: learningMap }
    );
    await page.reload();
    await page.getByTestId("sidebar-learning-studio").click();
    await page
      .getByRole("button", { name: "Temporary speech acceptance", exact: true })
      .click();
    await page.getByTestId("mindmap-speak-node-cup").first().click();

    await expect
      .poll(
        async () =>
          page.evaluate(async (id) => {
            const bridge = window.__ENJOY_APP__.learning;
            const context = await bridge.getContext();
            const jobs = await bridge.request(context, "listJobs", {
              resourceType: "map",
              resourceId: id,
            });
            if (!jobs[0]) return "missing";
            const currentJob = await bridge.request(context, "job", {
              id: jobs[0].id,
            });
            if (currentJob.job.state === "failed") {
              throw new Error(
                currentJob.attempts
                  .map((attempt) => attempt.errorCode)
                  .filter(Boolean)
                  .join(",")
              );
            }
            return currentJob.job.state;
          }, mapId!),
        { timeout: 100_000, intervals: [1_000, 2_000, 5_000] }
      )
      .toBe("completed");

    const assertPlayback = async (): Promise<number> => {
      const audio = page.locator("audio").last();
      await expect(audio).toBeVisible();
      await expect
        .poll(
          () =>
            audio.evaluate((node: HTMLAudioElement) =>
              Number.isFinite(node.duration) ? node.duration : 0
            ),
          { timeout: 10_000 }
        )
        .toBeGreaterThan(0);
      await audio.evaluate((node: HTMLAudioElement) => {
        node.currentTime = 0;
        return node.play();
      });
      await expect
        .poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime), {
          timeout: 10_000,
        })
        .toBeGreaterThan(0.2);
      return audio.evaluate((node: HTMLAudioElement) => node.duration);
    };

    const firstDuration = await assertPlayback();
    const accepted = await page.evaluate(
      async ({ id, revisionId }) => {
        const bridge = window.__ENJOY_APP__.learning;
        const context = await bridge.getContext();
        const bundle = await bridge.request(context, "getMap", { id });
        const slot = bundle.slots.find(
          (candidate) =>
            candidate.mapRevisionId === revisionId &&
            candidate.sourceType === "node" &&
            candidate.sourceId === "cup"
        );
        const asset = bundle.assets.find(
          (candidate) => candidate.id === slot?.selectedAssetId
        );
        if (!asset) throw new Error("speech_asset_missing");
        const response = await fetch(
          `enjoy://library/learning-assets/${encodeURIComponent(
            context.connectionId
          )}/${encodeURIComponent(asset.relativePath)}`
        );
        if (!response.ok) throw new Error("speech_asset_read_failed");
        return {
          asset,
          bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
        };
      },
      { id: mapId, revisionId: created.revisionId }
    );
    const audioBytes = Buffer.from(accepted.bytes);
    const audioHash = createHash("sha256").update(audioBytes).digest("hex");
    const extension = accepted.asset.mimeType === "audio/wav" ? "wav" : "mp3";
    await writeFile(
      info.outputPath(`configured-node-speech.${extension}`),
      audioBytes,
      { mode: 0o600 }
    );

    const afterProviderNetwork = await captureProviderNetwork(page);
    expect(observedHostCount(afterProviderNetwork.main, "api.openai.com")).toBeGreaterThan(0);
    await fixture.restart({ offline: false });
    page = fixture.page;
    await page.getByTestId("sidebar-learning-studio").click({ timeout: 45_000 });
    await page
      .getByRole("button", { name: "Temporary speech acceptance", exact: true })
      .click();
    // Reopen the persisted audio through the normal node playback action.
    await page.getByTestId("mindmap-speak-node-cup").first().click();
    const persistedDuration = await assertPlayback();
    const afterRestartNetwork = await captureProviderNetwork(page);
    const persisted = await page.evaluate(
      async ({ id, revisionId }) => {
        const bridge = window.__ENJOY_APP__.learning;
        const context = await bridge.getContext();
        const bundle = await bridge.request(context, "getMap", { id });
        const slot = bundle.slots.find(
          (candidate) =>
            candidate.mapRevisionId === revisionId &&
            candidate.sourceType === "node" &&
            candidate.sourceId === "cup"
        );
        const asset = bundle.assets.find(
          (candidate) => candidate.id === slot?.selectedAssetId
        );
        if (!asset) throw new Error("persisted_speech_asset_missing");
        const response = await fetch(
          `enjoy://library/learning-assets/${encodeURIComponent(
            context.connectionId
          )}/${encodeURIComponent(asset.relativePath)}`
        );
        if (!response.ok) throw new Error("persisted_speech_asset_read_failed");
        return {
          assetId: asset.id,
          bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
        };
      },
      { id: mapId, revisionId: created.revisionId }
    );
    expect(persisted.assetId).toBe(accepted.asset.id);
    expect(
      createHash("sha256").update(Buffer.from(persisted.bytes)).digest("hex")
    ).toBe(audioHash);

    const [speechRow] = await queryLocalDatabase<{
      engine: string;
      model: string;
      voice: string;
      mimeType: string;
    }>(
      fixture.databasePath,
      `SELECT
         json_extract(ga.provenance, '$.engine') AS engine,
         json_extract(ga.provenance, '$.model') AS model,
         json_extract(ga.provenance, '$.voice') AS voice,
         ga.mime_type AS mimeType
       FROM generated_assets ga
       WHERE ga.id = ?`,
      [accepted.asset.id]
    );
    expect(speechRow).toBeTruthy();
    expect(speechRow.engine).toBe(service);
    expect(speechRow.model).toBe(model);
    expect(speechRow.voice).toBe(voice);

    await writeReceipt(info, "configured-node-speech.json", {
      pass: true,
      fixtureText: true,
      actualSpeechProvider: true,
      service,
      selectedModel: model,
      selectedVoice: voice,
      expectedText: "cup. I have a cup of tea.",
      assetId: accepted.asset.id,
      mimeType: accepted.asset.mimeType,
      byteCount: audioBytes.length,
      audioHash,
      firstDuration,
      persistedDuration,
      persistedAcrossRestart: true,
      sqliteProvider: speechRow,
      copiedDatabase: fixture.databasePath,
      sourceSnapshot: snapshotPath,
      sourceHashBefore,
      network: { afterProvider: afterProviderNetwork, afterRestart: afterRestartNetwork },
      runtime: fixture.runtimeDiagnostics(),
    });
    await page.screenshot({
      path: info.outputPath("configured-node-speech.png"),
      fullPage: true,
    });
    fixture.assertNoRuntimeIssues();
  } finally {
    try {
      if (fixture && mapId) {
        const page = fixture.page;
        await page.evaluate(async (id) => {
          const bridge = window.__ENJOY_APP__.learning;
          const context = await bridge.getContext();
          for (const job of await bridge.request(context, "listJobs", {
            resourceType: "map",
            resourceId: id,
          })) {
            if (job.state !== "completed") {
              await bridge.request(context, "cancelJob", { id: job.id });
            }
          }
          await bridge.request(context, "deleteMap", { id });
        }, mapId);
        cleanup = "completed";
        await writeFile(
          info.outputPath("owned-map.json"),
          JSON.stringify({ mapId, cleanup }),
          { encoding: "utf8", mode: 0o600 }
        );
      }
    } catch {
      cleanup = "failed";
      await writeFile(
        info.outputPath("cleanup-failed.json"),
        JSON.stringify({ mapId, cleanup }),
        { encoding: "utf8", mode: 0o600 }
      );
      throw new Error("temporary_speech_map_cleanup_failed");
    } finally {
      try {
        await fixture?.close();
      } finally {
        expect(await sha256File(snapshotPath)).toBe(sourceHashBefore);
      }
    }
  }
});
