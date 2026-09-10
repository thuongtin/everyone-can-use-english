/* eslint-disable no-empty-pattern -- Electron tests receive TestInfo without creating a browser fixture. */
import { createHash, randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
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
import {
  captureProviderNetwork,
  observedHostCount,
  type ProviderNetworkCapture,
} from "./helpers/provider-network";

const runLive = process.env.ENJOY_RUN_GEMINI_TEXT_LIVE === "1";
const requestedModel = process.env.ENJOY_GEMINI_TEXT_MODEL?.trim() || "";
const credentialSource = process.env.ENJOY_GEMINI_CREDENTIAL_SOURCE?.trim() || "";
const supportedModels = new Set(["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
const supportedCredentialSources = new Set(["GEMINI_API_KEY", "GOOGLE_API_KEY"]);
const providerHost = "generativelanguage.googleapis.com";
const providerPath = "/v1beta/openai/chat/completions";
const providerBaseUrl = `https://${providerHost}/v1beta/openai`;
const expectedWords = [
  "meticulous",
  "botanist",
  "catalogued",
  "resilient",
  "alpine",
  "orchid",
] as const;

test.describe.configure({ retries: 0 });
test.use({ trace: "off", screenshot: "off", video: "off" });

test.skip(
  !runLive,
  "Set ENJOY_RUN_GEMINI_TEXT_LIVE=1 for an explicit Gemini live run",
);
test.skip(
  !supportedModels.has(requestedModel),
  "Set ENJOY_GEMINI_TEXT_MODEL to gemini-3.8-flash or gemini-3.5-flash-lite",
);
test.skip(
  !supportedCredentialSources.has(credentialSource),
  "Set ENJOY_GEMINI_CREDENTIAL_SOURCE to GEMINI_API_KEY or GOOGLE_API_KEY",
);

type PersistedStoryRow = {
  id: string;
  title: string;
  content: string;
  extraction: string;
  extracted: number;
};

type SafeProviderResponse = {
  host: string;
  path: string;
  method: string;
  status: number;
  model: string | null;
  queryAbsent: boolean;
};

const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const sha256File = async (filePath: string): Promise<string> =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

const pathExists = async (filePath: string): Promise<boolean> =>
  access(filePath).then(() => true, () => false);

const sanitizeGeminiDiagnostic = (value: unknown, credential: string): string =>
  sanitizeLocalDiagnostic(value instanceof Error ? value.message : String(value))
    .replaceAll(credential, "<redacted>");

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

test("packaged Story extraction uses Gemini and persists its exact output offline", async ({}, testInfo) => {
  test.setTimeout(240_000);
  testInfo.annotations.push({
    type: "paid-live-gemini",
    description:
      "Actual packaged renderer Gemini request, fresh disposable profile, exact extraction contract, SQLite persistence, and offline restart",
  });

  // Read the selected secret only after every explicit live-run gate above passed.
  const credential = process.env[credentialSource]?.trim() || "";
  test.skip(!credential, `The selected ${credentialSource} environment variable is empty`);

  const appPath = resolveE2EAppPath();
  const appAsarPath = path.join(appPath, "Contents", "Resources", "app.asar");
  const executablePath = path.join(appPath, "Contents", "MacOS", "enjoy");
  const [appAsarSha256, executableSha256, testSourceSha256] = await Promise.all([
    sha256File(appAsarPath),
    sha256File(executablePath),
    sha256File(import.meta.filename),
  ]);
  const providerResponses: SafeProviderResponse[] = [];
  let admittedInferenceRequests = 0;
  let blockedExtraInferenceRequests = 0;
  const offlineProviderRequests: { host: string; path: string; method: string }[] = [];
  const networkEvidence: {
    afterProvider?: ProviderNetworkCapture;
    afterRestart?: ProviderNetworkCapture;
  } = {};
  let fixture: LocalApp | undefined;
  let primaryError: unknown;

  try {
    fixture = await launchLocalApp();
    // Bound the authorized live run even if the production SDK retries.
    await fixture.electronApp.context().route(`https://${providerHost}/**`, async route => {
      const request = route.request();
      if (request.method() === "POST") {
        if (admittedInferenceRequests >= 1) {
          blockedExtraInferenceRequests += 1;
          await route.abort("blockedbyclient");
          return;
        }
        admittedInferenceRequests += 1;
      }
      await route.continue();
    });
    let page = fixture.page;
    page.on("response", response => {
      const url = new URL(response.url());
      if (url.hostname !== providerHost) return;
      const request = response.request();
      let model: string | null = null;
      try {
        const body = request.postDataJSON() as { model?: unknown };
        if (typeof body.model === "string") model = body.model;
      } catch {
        model = null;
      }
      providerResponses.push({
        host: url.hostname,
        path: url.pathname,
        method: request.method(),
        status: response.status(),
        model,
        queryAbsent: !url.search && !url.hash,
      });
    });
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });

    const configured = await page.evaluate(
      async ({ key, model, baseUrl }) => {
        await window.__ENJOY_APP__.userSettings.set("gemini", {
          name: "gemini",
          key,
          baseUrl,
          models: model,
        });
        await window.__ENJOY_APP__.userSettings.set("gpt_engine", {
          name: "gemini",
          models: { default: model, extractStory: model },
        });
        const [provider, engine] = await Promise.all([
          window.__ENJOY_APP__.userSettings.get("gemini"),
          window.__ENJOY_APP__.userSettings.get("gpt_engine"),
        ]);
        return {
          provider: provider?.name,
          baseUrl: provider?.baseUrl,
          model: engine?.models?.extractStory,
          credentialConfigured: Boolean(provider?.key),
        };
      },
      { key: credential, model: requestedModel, baseUrl: providerBaseUrl },
    );
    expect(configured).toEqual({
      provider: "gemini",
      baseUrl: providerBaseUrl,
      model: requestedModel,
      credentialConfigured: true,
    });

    await page.reload();
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => page.evaluate(async () => {
      const [provider, engine] = await Promise.all([
        window.__ENJOY_APP__.userSettings.get("gemini"),
        window.__ENJOY_APP__.userSettings.get("gpt_engine"),
      ]);
      return {
        provider: engine?.name,
        model: engine?.models?.extractStory,
        baseUrl: provider?.baseUrl,
        credentialConfigured: Boolean(provider?.key),
      };
    })).toEqual({
      provider: "gemini",
      model: requestedModel,
      baseUrl: providerBaseUrl,
      credentialConfigured: true,
    });

    await page.locator("#preferences-button").click();
    const preferences = page.getByRole("dialog");
    await expect(preferences).toBeVisible();
    await expect(preferences.getByText("Gemini", { exact: true }).first()).toBeVisible();
    await expect(preferences.getByText(requestedModel, { exact: true }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(preferences).toBeHidden();

    const storyId = randomUUID();
    const storyTitle = `Gemini persistence ${storyId.slice(0, 8)}`;
    const storyContent = "The meticulous botanist catalogued a resilient alpine orchid.";
    await page.evaluate(
      ({ id, title, content }) => window.__ENJOY_APP__.localStudy.stories.create({
        id,
        title,
        content,
        html: `<article><p>${content}</p></article>`,
        extracted: false,
        provenance: { source: "manual" },
      }),
      { id: storyId, title: storyTitle, content: storyContent },
    );

    const storyRoute = `/stories/${storyId}`;
    await navigateTo(page, storyRoute);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("heading", { name: storyTitle })).toBeVisible();
    await page.getByTitle(/^(?:Từ vựng chính|key vocabulary)$/iu).click();

    await expect.poll(
      () => page.evaluate(async (id) => {
        const story = await window.__ENJOY_APP__.localStudy.stories.get(id);
        return story.extracted
          ? { words: [...story.extraction.words].sort(), idioms: story.extraction.idioms }
          : null;
      }, storyId),
      { timeout: 90_000 },
    ).toEqual({ words: [...expectedWords].sort(), idioms: [] });

    const beforeRestart = await page.evaluate(
      (id) => window.__ENJOY_APP__.localStudy.stories.get(id),
      storyId,
    );
    expect([...beforeRestart.extraction.words].sort()).toEqual([...expectedWords].sort());
    expect(beforeRestart.extraction.idioms).toEqual([]);
    for (const word of expectedWords) {
      await expect(page.getByText(word, { exact: true }).first()).toBeVisible();
    }

    const rowsBeforeRestart = await queryLocalDatabase<PersistedStoryRow>(
      fixture.databasePath,
      "SELECT id, title, content, extraction, extracted FROM local_stories WHERE id = ?",
      [storyId],
    );
    expect(rowsBeforeRestart).toHaveLength(1);
    expect(rowsBeforeRestart[0].extracted).toBe(1);
    const persistedExtraction = JSON.parse(rowsBeforeRestart[0].extraction) as unknown;
    expect(persistedExtraction).toMatchObject({ idioms: [] });
    expect([...(persistedExtraction as { words: string[] }).words].sort())
      .toEqual([...expectedWords].sort());
    const extractionDigest = digest(beforeRestart.extraction);
    const sqliteRowDigest = digest(rowsBeforeRestart[0]);

    const afterProviderNetwork = await captureProviderNetwork(page);
    networkEvidence.afterProvider = afterProviderNetwork;
    const successfulInferenceResponses = providerResponses.filter(response =>
      response.host === providerHost &&
      response.path === providerPath &&
      response.method === "POST" &&
      response.status === 200 &&
      response.model === requestedModel &&
      response.queryAbsent,
    );
    expect(successfulInferenceResponses.length).toBeGreaterThan(0);
    expect(admittedInferenceRequests).toBe(1);
    expect(blockedExtraInferenceRequests).toBe(0);
    const nodeObservedProviderHostCount =
      observedHostCount(afterProviderNetwork.main, providerHost) +
      observedHostCount(afterProviderNetwork.renderer, providerHost);

    await fixture.restart({ offline: true });
    page = fixture.page;
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.hostname !== providerHost) return;
      offlineProviderRequests.push({
        host: url.hostname,
        path: url.pathname,
        method: request.method(),
      });
    });
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });
    await navigateTo(page, storyRoute);
    await expect(page.getByRole("heading", { name: storyTitle })).toBeVisible();
    await page.getByTitle(/^(?:Từ vựng chính|key vocabulary)$/iu).click();
    for (const word of expectedWords) {
      await expect(page.getByText(word, { exact: true }).first()).toBeVisible();
    }

    const afterRestart = await page.evaluate(async (id) => {
      const [story, provider, engine] = await Promise.all([
        window.__ENJOY_APP__.localStudy.stories.get(id),
        window.__ENJOY_APP__.userSettings.get("gemini"),
        window.__ENJOY_APP__.userSettings.get("gpt_engine"),
      ]);
      return {
        story,
        provider: engine?.name,
        model: engine?.models?.extractStory,
        baseUrl: provider?.baseUrl,
        credentialConfigured: Boolean(provider?.key),
      };
    }, storyId);
    expect(afterRestart).toMatchObject({
      provider: "gemini",
      model: requestedModel,
      baseUrl: providerBaseUrl,
      credentialConfigured: true,
    });
    expect(digest(afterRestart.story.extraction)).toBe(extractionDigest);

    const rowsAfterRestart = await queryLocalDatabase<PersistedStoryRow>(
      fixture.databasePath,
      "SELECT id, title, content, extraction, extracted FROM local_stories WHERE id = ?",
      [storyId],
    );
    expect(rowsAfterRestart).toHaveLength(1);
    expect(digest(rowsAfterRestart[0])).toBe(sqliteRowDigest);
    expect(offlineProviderRequests.filter(request => request.method === "POST")).toEqual([]);

    const afterRestartNetwork = await captureProviderNetwork(page);
    networkEvidence.afterRestart = afterRestartNetwork;
    expect(observedHostCount(afterRestartNetwork.main, providerHost)).toBe(0);
    expect(observedHostCount(afterRestartNetwork.renderer, providerHost)).toBe(0);
    fixture.assertNoRuntimeIssues();

    const runtime = fixture.runtimeDiagnostics();
    const directories = fixture.directories;
    await fixture.close();
    fixture = undefined;
    const cleanup = {
      settingsRemoved: !(await pathExists(directories.settings)),
      libraryRemoved: !(await pathExists(directories.library)),
      chromiumRemoved: !(await pathExists(directories.chromium)),
    };
    expect(cleanup).toEqual({
      settingsRemoved: true,
      libraryRemoved: true,
      chromiumRemoved: true,
    });

    await writeReceipt(testInfo, "provider-gemini-text-live.json", redactCredential({
      packaged: true,
      appPath,
      appAsarSha256,
      executableSha256,
      testSourceSha256,
      provider: "gemini",
      model: requestedModel,
      credentialSource,
      credentialPresent: true,
      credentialValueRecorded: false,
      trace: "off",
      screenshots: false,
      endpoint: { scheme: "https", host: providerHost, path: providerPath, queryAbsent: true },
      profileSource: "fresh-disposable",
      storyId,
      sourceText: storyContent,
      extraction: beforeRestart.extraction,
      extractionDigest,
      extractedWordCount: beforeRestart.extraction.words.length,
      extractedIdiomCount: beforeRestart.extraction.idioms.length,
      providerResponses,
      successfulInferenceResponseCount: successfulInferenceResponses.length,
      authorizedInferenceRequestLimit: 1,
      admittedInferenceRequests,
      blockedExtraInferenceRequests,
      providerTransportEvidence: "playwright-renderer-response",
      observedCountersScope: "Node HTTP and Undici diagnostics only",
      nodeObservedProviderHostCount,
      nodeObservedCountRequiredForRendererFetch: false,
      network: networkEvidence,
      zeroBlockedNetworkOperations: [afterProviderNetwork, afterRestartNetwork].every(network =>
        network.main.blockedAttemptCount === 0 && network.renderer.blockedAttemptCount === 0),
      zeroEnjoyBackendOperations: [afterProviderNetwork, afterRestartNetwork].every(network =>
        network.main.legacyBackendOperationCount === 0 &&
        network.renderer.legacyBackendOperationCount === 0),
      offlineProviderRequests,
      offlineInferenceRequestCount: offlineProviderRequests.filter(request => request.method === "POST").length,
      sqliteRowDigestBeforeRestart: sqliteRowDigest,
      sqliteRowDigestAfterRestart: digest(rowsAfterRestart[0]),
      bridgeOutputStableAfterRestart: true,
      runtime,
      cleanup,
    }, credential));
  } catch (error) {
    primaryError = error;
    if (fixture) {
      await writeReceipt(testInfo, "provider-gemini-text-live-failure.json", redactCredential({
        provider: "gemini",
        model: requestedModel,
        credentialSource,
        credentialPresent: true,
        credentialValueRecorded: false,
        providerResponses,
        authorizedInferenceRequestLimit: 1,
        admittedInferenceRequests,
        blockedExtraInferenceRequests,
        offlineProviderRequests,
        network: networkEvidence,
        runtime: fixture.runtimeDiagnostics(),
        errorClassification: sanitizeGeminiDiagnostic(error, credential),
      }, credential));
    }
    throw new Error("Gemini packaged live acceptance failed; inspect the sanitized receipt", {
      cause: error instanceof Error ? undefined : new Error("non-error failure"),
    });
  } finally {
    await fixture?.close().catch(() => {
      if (!primaryError) throw new Error("Gemini fixture cleanup failed");
    });
  }
});
