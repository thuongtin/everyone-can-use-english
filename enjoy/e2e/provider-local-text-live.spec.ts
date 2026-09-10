/* eslint-disable no-empty-pattern -- Electron tests receive TestInfo without creating a browser fixture. */
import { createHash, randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page, Request, Response } from "playwright";

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

const runLive = process.env.ENJOY_RUN_LOCAL_PROVIDER_TEXT_LIVE === "1";
const requestedProvider =
  process.env.ENJOY_LOCAL_PROVIDER?.trim().toLowerCase() || "";
const requestedModel =
  process.env.ENJOY_LOCAL_PROVIDER_MODEL?.trim() || "";
const requestedEndpoint =
  process.env.ENJOY_LOCAL_PROVIDER_BASE_URL?.trim() || "";
const supportedProvider = requestedProvider === "ollama" || requestedProvider === "lmstudio";

test.use({ trace: "off" });

test.skip(
  !runLive,
  "Set ENJOY_RUN_LOCAL_PROVIDER_TEXT_LIVE=1 for an explicit local-provider run",
);
test.skip(
  !supportedProvider || !requestedModel || !requestedEndpoint,
  "Set an explicit ollama/lmstudio provider, model, and loopback endpoint",
);

type PersistedStoryRow = {
  id: string;
  title: string;
  content: string;
  extraction: string;
  extracted: number;
};

type ProviderRequest = {
  origin: string;
  path: string;
  method: string;
  status?: number;
};

const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const sha256File = async (filePath: string): Promise<string> =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

const pathExists = async (filePath: string): Promise<boolean> =>
  access(filePath).then(() => true, () => false);

const normalizeEndpoint = (raw: string, provider: string): URL => {
  const endpoint = new URL(raw);
  expect(endpoint.protocol).toBe("http:");
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(endpoint.hostname);
  expect(endpoint.username || endpoint.password).toBe("");
  expect(endpoint.search || endpoint.hash).toBe("");
  const pathname = endpoint.pathname.replace(/\/+$/u, "");
  if (provider === "ollama") expect(pathname).toBe("");
  else expect(pathname).toBe("/v1");
  endpoint.pathname = pathname;
  return endpoint;
};

const navigateTo = async (page: Page, route: string): Promise<void> => {
  await page.evaluate((nextRoute) => {
    window.location.hash = nextRoute;
  }, route);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#${route}`);
};

const matchingRequest = (request: Request, endpoint: URL): ProviderRequest | null => {
  const url = new URL(request.url());
  if (url.origin !== endpoint.origin) return null;
  return { origin: url.origin, path: url.pathname, method: request.method() };
};

const matchingResponse = (response: Response, endpoint: URL): ProviderRequest | null => {
  const request = matchingRequest(response.request(), endpoint);
  return request ? { ...request, status: response.status() } : null;
};

test("signed packaged Story extraction uses the selected local provider and persists offline", async ({}, testInfo) => {
  test.setTimeout(240_000);
  testInfo.annotations.push({
    type: "local-live-provider",
    description:
      "Actual signed packaged renderer provider, explicit loopback endpoint, fresh disposable profile, persistence, and offline restart",
  });

  const endpoint = normalizeEndpoint(requestedEndpoint, requestedProvider);
  const appPath = resolveE2EAppPath();
  const appAsarPath = path.join(appPath, "Contents", "Resources", "app.asar");
  const executablePath = path.join(appPath, "Contents", "MacOS", "enjoy");
  const [appAsarSha256, executableSha256, testSourceSha256] = await Promise.all([
    sha256File(appAsarPath),
    sha256File(executablePath),
    sha256File(import.meta.filename),
  ]);
  const providerResponses: ProviderRequest[] = [];
  const offlineProviderRequests: ProviderRequest[] = [];
  let outputEvidence: unknown;
  const networkEvidence: {
    afterProvider?: ProviderNetworkCapture;
    afterRestart?: ProviderNetworkCapture;
  } = {};
  let offlineDiscoveryEvidence: unknown;
  let fixture: LocalApp | undefined;
  let primaryError: unknown;

  try {
    fixture = await launchLocalApp();
    let page = fixture.page;
    page.on("response", response => {
      const observed = matchingResponse(response, endpoint);
      if (observed) providerResponses.push(observed);
    });
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });

    const configured = await page.evaluate(
      async ({ provider, model, baseUrl }) => {
        await window.__ENJOY_APP__.userSettings.set(provider, {
          name: provider,
          baseUrl,
          models: model,
        });
        await window.__ENJOY_APP__.userSettings.set("gpt_engine", {
          name: provider,
          models: { default: model, extractStory: model },
        });
        return {
          providerConfig: await window.__ENJOY_APP__.userSettings.get(provider),
          engine: await window.__ENJOY_APP__.userSettings.get("gpt_engine"),
        };
      },
      {
        provider: requestedProvider,
        model: requestedModel,
        baseUrl: endpoint.toString(),
      },
    );
    expect(configured).toMatchObject({
      providerConfig: {
        name: requestedProvider,
        baseUrl: endpoint.toString(),
        models: requestedModel,
      },
      engine: {
        name: requestedProvider,
        models: { default: requestedModel, extractStory: requestedModel },
      },
    });
    expect(configured.providerConfig?.key).toBeUndefined();

    await page.reload();
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => page.evaluate(async (provider) => {
        const [config, engine] = await Promise.all([
          window.__ENJOY_APP__.userSettings.get(provider),
          window.__ENJOY_APP__.userSettings.get("gpt_engine"),
        ]);
        return {
          provider: engine?.name,
          model: engine?.models?.extractStory,
          baseUrl: config?.baseUrl,
          keyConfigured: Boolean(config?.key),
        };
      }, requestedProvider))
      .toEqual({
        provider: requestedProvider,
        model: requestedModel,
        baseUrl: endpoint.toString(),
        keyConfigured: false,
      });

    await page.locator("#preferences-button").click();
    const preferences = page.getByRole("dialog");
    await expect(preferences).toBeVisible();
    await expect(
      preferences.getByText(requestedProvider === "ollama" ? "Ollama" : "LM Studio", { exact: true }).first(),
    ).toBeVisible();
    await expect(preferences.getByText(requestedModel, { exact: true }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(preferences).toBeHidden();

    const storyId = randomUUID();
    const storyTitle = `Local provider persistence ${storyId.slice(0, 8)}`;
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
        return { extracted: story.extracted, extraction: story.extraction };
      }, storyId),
      { timeout: 90_000 },
    ).toMatchObject({ extracted: true });

    const beforeRestart = await page.evaluate(
      (id) => window.__ENJOY_APP__.localStudy.stories.get(id),
      storyId,
    );
    expect(beforeRestart.extraction).toBeDefined();
    const extractedTerms = [
      ...beforeRestart.extraction.words,
      ...beforeRestart.extraction.idioms,
    ];
    expect(extractedTerms.length).toBeGreaterThan(0);
    const renderedTerm = extractedTerms.find(term =>
      storyContent.toLocaleLowerCase().includes(term.toLocaleLowerCase()),
    );
    expect(renderedTerm, "Local-provider output must contain a term from the Story text").toBeTruthy();
    await expect(page.getByText(renderedTerm!, { exact: true }).first()).toBeVisible();

    const rowsBeforeRestart = await queryLocalDatabase<PersistedStoryRow>(
      fixture.databasePath,
      "SELECT id, title, content, extraction, extracted FROM local_stories WHERE id = ?",
      [storyId],
    );
    expect(rowsBeforeRestart).toHaveLength(1);
    expect(rowsBeforeRestart[0].extracted).toBe(1);
    const extractionDigest = digest(beforeRestart.extraction);
    const rowDigest = digest(rowsBeforeRestart[0]);
    const afterProviderNetwork = await captureProviderNetwork(page);
    networkEvidence.afterProvider = afterProviderNetwork;
    const successfulInferenceResponses = providerResponses.filter(response =>
      response.method === "POST" &&
      response.status !== undefined &&
      response.status >= 200 &&
      response.status < 300 &&
      (requestedProvider === "ollama"
        ? response.path === "/api/chat"
        : response.path === "/v1/chat/completions"),
    );
    expect(successfulInferenceResponses.length).toBeGreaterThan(0);
    const policyObservedHostCount =
      observedHostCount(afterProviderNetwork.main, endpoint.hostname) +
      observedHostCount(afterProviderNetwork.renderer, endpoint.hostname);
    outputEvidence = {
      sourceText: storyContent,
      extraction: beforeRestart.extraction,
      extractedTerms,
      renderedTerm,
      extractionDigest,
      sqliteRowDigestBeforeRestart: rowDigest,
    };

    await fixture.restart({ offline: true });
    page = fixture.page;
    page.on("request", request => {
      const observed = matchingRequest(request, endpoint);
      if (observed) offlineProviderRequests.push(observed);
    });
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });
    await navigateTo(page, storyRoute);
    await expect(page.getByRole("heading", { name: storyTitle })).toBeVisible();
    await page.getByTitle(/^(?:Từ vựng chính|key vocabulary)$/iu).click();
    await expect(page.getByText(renderedTerm!, { exact: true }).first()).toBeVisible();

    const afterRestart = await page.evaluate(
      async ({ id, provider }) => {
        const [story, config, engine] = await Promise.all([
          window.__ENJOY_APP__.localStudy.stories.get(id),
          window.__ENJOY_APP__.userSettings.get(provider),
          window.__ENJOY_APP__.userSettings.get("gpt_engine"),
        ]);
        return { story, config, engine };
      },
      { id: storyId, provider: requestedProvider },
    );
    expect(afterRestart.config).toMatchObject({
      name: requestedProvider,
      baseUrl: endpoint.toString(),
      models: requestedModel,
    });
    expect(afterRestart.config?.key).toBeUndefined();
    expect(afterRestart.engine).toMatchObject({
      name: requestedProvider,
      models: { default: requestedModel, extractStory: requestedModel },
    });
    expect(digest(afterRestart.story.extraction)).toBe(extractionDigest);
    expect(offlineProviderRequests.filter(request => request.method === "POST")).toEqual([]);

    const rowsAfterRestart = await queryLocalDatabase<PersistedStoryRow>(
      fixture.databasePath,
      "SELECT id, title, content, extraction, extracted FROM local_stories WHERE id = ?",
      [storyId],
    );
    expect(digest(rowsAfterRestart[0])).toBe(rowDigest);
    const afterRestartNetwork = await captureProviderNetwork(page);
    networkEvidence.afterRestart = afterRestartNetwork;
    const zeroBlockedNetworkOperations = [afterProviderNetwork, afterRestartNetwork]
      .every(network =>
        network.main.blockedAttemptCount === 0 &&
        network.renderer.blockedAttemptCount === 0,
      );
    const zeroEnjoyBackendOperations = [afterProviderNetwork, afterRestartNetwork]
      .every(network =>
        network.main.legacyBackendOperationCount === 0 &&
        network.renderer.legacyBackendOperationCount === 0,
      );
    expect(zeroBlockedNetworkOperations).toBe(true);
    expect(zeroEnjoyBackendOperations).toBe(true);

    const discoveryPath = requestedProvider === "ollama" ? "/api/tags" : "/v1/models";
    const discoveryUrl = `${endpoint.origin}${discoveryPath}`;
    const expectedOfflineDiscoveryError =
      `Failed to load resource: net::ERR_INTERNET_DISCONNECTED\n${discoveryUrl}:0:0`;
    const diagnosticsBeforeConsumption = fixture.runtimeDiagnostics();
    expect(diagnosticsBeforeConsumption.unexpected.pageErrors).toEqual([]);
    expect(diagnosticsBeforeConsumption.unexpected.mainConsoleErrors).toEqual([]);
    expect(diagnosticsBeforeConsumption.unexpected.mainStderrErrors).toEqual([]);
    expect(
      diagnosticsBeforeConsumption.unexpected.pageConsoleErrors.every(
        message => message === expectedOfflineDiscoveryError,
      ),
    ).toBe(true);
    expect(diagnosticsBeforeConsumption.unexpected.pageConsoleErrors.length).toBeLessThanOrEqual(1);
    const offlineDiscoveryErrorCount = diagnosticsBeforeConsumption.unexpected.pageConsoleErrors.length;
    const consumedOfflineDiscoveryErrorCount = offlineDiscoveryErrorCount === 1
      ? fixture.consumeExpectedRuntimeError(expectedOfflineDiscoveryError)
      : 0;
    expect(consumedOfflineDiscoveryErrorCount).toBe(offlineDiscoveryErrorCount);
    offlineDiscoveryEvidence = {
      request: { method: "GET", url: discoveryUrl },
      expectedBecause: "The configured local model discovery probe ran during an intentionally offline restart",
      observedErrorCount: offlineDiscoveryErrorCount,
      consumedErrorCount: consumedOfflineDiscoveryErrorCount,
    };
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

    await writeReceipt(testInfo, "provider-local-text-live.json", {
      packaged: true,
      appPath,
      appAsarSha256,
      executableSha256,
      testSourceSha256,
      provider: requestedProvider,
      model: requestedModel,
      endpoint: endpoint.toString(),
      keyConfigured: false,
      profileSource: "fresh-disposable",
      storyId,
      sourceText: storyContent,
      extraction: beforeRestart.extraction,
      extractionDigest,
      extractedWordCount: beforeRestart.extraction.words.length,
      extractedIdiomCount: beforeRestart.extraction.idioms.length,
      renderedTerm,
      providerResponses,
      successfulInferenceResponses,
      policyObservedHostCount,
      trafficProof:
        "Playwright renderer response matched the exact configured origin, inference path, POST method, and successful status",
      zeroBlockedNetworkOperations,
      zeroEnjoyBackendOperations,
      network: networkEvidence,
      offlineProviderRequests,
      offlineInferenceRequestCount: offlineProviderRequests.filter(request => request.method === "POST").length,
      offlineDiscoveryEvidence,
      sqliteRowDigestBeforeRestart: rowDigest,
      sqliteRowDigestAfterRestart: digest(rowsAfterRestart[0]),
      runtime,
      cleanup,
    });
  } catch (error) {
    primaryError = error;
    if (fixture) {
      await writeReceipt(testInfo, "provider-local-text-failure.json", {
        provider: requestedProvider,
        model: requestedModel,
        endpointOrigin: endpoint.origin,
        providerResponses,
        offlineProviderRequests,
        outputEvidence,
        network: networkEvidence,
        offlineDiscoveryEvidence,
        runtime: fixture.runtimeDiagnostics(),
        error: sanitizeLocalDiagnostic(error instanceof Error ? error.message : String(error)),
      });
    }
    throw error;
  } finally {
    await fixture?.close().catch((error) => {
      if (!primaryError) throw error;
    });
  }
});
