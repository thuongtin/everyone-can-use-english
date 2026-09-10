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

const runLive = process.env.ENJOY_RUN_VERTEX_TEXT_LIVE === "1";
const requestedModel = process.env.ENJOY_VERTEX_TEXT_MODEL?.trim() || "";
const credentialSource = "VERTEX_API_KEY";
const modelSlugPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/u;
const providerHost = "aiplatform.googleapis.com";
const providerBaseUrl = `https://${providerHost}/v1`;
const storyContent = "The meticulous botanist catalogued a resilient alpine orchid.";
const extractionInstructionMarker = "Return exactly one valid JSON object";
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
  "Set ENJOY_RUN_VERTEX_TEXT_LIVE=1 for an explicit Vertex AI Express live run",
);
test.skip(
  !modelSlugPattern.test(requestedModel),
  "Set ENJOY_VERTEX_TEXT_MODEL to one explicit Vertex publisher model slug",
);
type PersistedStoryRow = {
  id: string;
  title: string;
  content: string;
  extraction: string;
  extracted: number;
};

type SafeVertexResponse = {
  host: string;
  path: string;
  method: string;
  status: number;
  modelFromPath: string | null;
  queryAbsent: boolean;
  apiKeyHeaderPresent: boolean;
  authorizationHeaderAbsent: boolean;
  contentsValid: boolean;
  flattenedPromptIncludesSourceArticle: boolean;
  flattenedPromptIncludesExtractionInstructions: boolean;
  systemInstructionPresent: boolean;
  systemInstructionAbsentOrTextValid: boolean;
  responseMimeType: string | null;
  responseJsonSchemaValid: boolean;
};

const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const sha256File = async (filePath: string): Promise<string> =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

const pathExists = async (filePath: string): Promise<boolean> =>
  access(filePath).then(() => true, () => false);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const hasTextPart = (value: unknown): boolean => {
  const record = asRecord(value);
  const parts = record?.parts;
  return Array.isArray(parts) && parts.some(part => {
    const text = asRecord(part)?.text;
    return typeof text === "string" && text.trim().length > 0;
  });
};

const responseJsonSchemaIsExtraction = (value: unknown): boolean => {
  const schema = asRecord(value);
  const properties = asRecord(schema?.properties);
  const words = asRecord(properties?.words);
  const idioms = asRecord(properties?.idioms);
  const wordItems = asRecord(words?.items);
  const idiomItems = asRecord(idioms?.items);
  const required = Array.isArray(schema?.required)
    ? schema.required.filter(item => typeof item === "string").sort()
    : [];
  return schema?.type === "object" &&
    words?.type === "array" && wordItems?.type === "string" &&
    idioms?.type === "array" && idiomItems?.type === "string" &&
    JSON.stringify(required) === JSON.stringify(["idioms", "words"]);
};

const inspectVertexResponse = (response: Response): SafeVertexResponse | null => {
  const url = new URL(response.url());
  if (url.hostname !== providerHost) return null;
  const request = response.request();
  const pathMatch = url.pathname.match(
    /^\/v1\/publishers\/google\/models\/([A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?):generateContent$/u,
  );
  const headers = request.headers();
  let contentsValid = false;
  let flattenedPromptIncludesSourceArticle = false;
  let flattenedPromptIncludesExtractionInstructions = false;
  let systemInstructionPresent = false;
  let systemInstructionAbsentOrTextValid = false;
  let responseMimeType: string | null = null;
  let responseJsonSchemaValid = false;
  try {
    const body = asRecord(request.postDataJSON());
    const contents = body?.contents;
    const generationConfig = asRecord(body?.generationConfig);
    contentsValid = Array.isArray(contents) && contents.length > 0 && contents.every(hasTextPart);
    const flattenedText = Array.isArray(contents)
      ? contents.flatMap(content => {
          const parts = asRecord(content)?.parts;
          return Array.isArray(parts)
            ? parts.map(part => asRecord(part)?.text).filter((text): text is string =>
                typeof text === "string")
            : [];
        }).join("\n")
      : "";
    flattenedPromptIncludesSourceArticle = flattenedText.includes(storyContent);
    flattenedPromptIncludesExtractionInstructions = flattenedText.includes(
      extractionInstructionMarker,
    );
    systemInstructionPresent = body?.systemInstruction !== undefined;
    systemInstructionAbsentOrTextValid = !systemInstructionPresent || hasTextPart(
      body?.systemInstruction,
    );
    responseMimeType = typeof generationConfig?.responseMimeType === "string"
      ? generationConfig.responseMimeType
      : null;
    responseJsonSchemaValid = responseJsonSchemaIsExtraction(
      generationConfig?.responseJsonSchema,
    );
  } catch {
    // Safe booleans remain false when the native request body is unavailable.
  }
  return {
    host: url.hostname,
    path: url.pathname,
    method: request.method(),
    status: response.status(),
    modelFromPath: pathMatch?.[1] || null,
    queryAbsent: !url.search && !url.hash,
    apiKeyHeaderPresent: Boolean(headers["x-goog-api-key"]),
    authorizationHeaderAbsent: !headers.authorization,
    contentsValid,
    flattenedPromptIncludesSourceArticle,
    flattenedPromptIncludesExtractionInstructions,
    systemInstructionPresent,
    systemInstructionAbsentOrTextValid,
    responseMimeType,
    responseJsonSchemaValid,
  };
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

test("packaged Story extraction uses native Vertex AI Express and persists offline", async ({}, testInfo) => {
  test.setTimeout(240_000);
  testInfo.annotations.push({
    type: "paid-live-vertex-express",
    description:
      "Actual packaged native Vertex Express request, fresh disposable profile, exact extraction contract, SQLite persistence, and offline restart",
  });

  // Read the credential only after the explicit run, model, and source gates passed.
  const credential = process.env.VERTEX_API_KEY?.trim() || "";
  test.skip(!credential, "The selected VERTEX_API_KEY environment variable is empty");

  const appPath = resolveE2EAppPath();
  const [appAsarSha256, executableSha256, testSourceSha256] = await Promise.all([
    sha256File(path.join(appPath, "Contents", "Resources", "app.asar")),
    sha256File(path.join(appPath, "Contents", "MacOS", "enjoy")),
    sha256File(import.meta.filename),
  ]);
  const providerResponses: SafeVertexResponse[] = [];
  const offlineProviderRequests: { host: string; path: string; method: string }[] = [];
  const networkEvidence: {
    afterProvider?: ProviderNetworkCapture;
    afterRestart?: ProviderNetworkCapture;
  } = {};
  let fixture: LocalApp | undefined;
  let primaryError: unknown;

  try {
    fixture = await launchLocalApp();
    let page = fixture.page;
    page.on("response", response => {
      const observed = inspectVertexResponse(response);
      if (observed) providerResponses.push(observed);
    });
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });

    const configured = await page.evaluate(async ({ key, model, baseUrl }) => {
      await window.__ENJOY_APP__.userSettings.set("vertex_express", {
        name: "vertex-express",
        key,
        baseUrl,
        models: model,
      });
      await window.__ENJOY_APP__.userSettings.set("gpt_engine", {
        name: "vertex-express",
        models: { default: model, extractStory: model },
      });
      const [provider, engine] = await Promise.all([
        window.__ENJOY_APP__.userSettings.get("vertex_express"),
        window.__ENJOY_APP__.userSettings.get("gpt_engine"),
      ]);
      return {
        provider: engine?.name,
        model: engine?.models?.extractStory,
        baseUrl: provider?.baseUrl,
        credentialConfigured: Boolean(provider?.key),
      };
    }, { key: credential, model: requestedModel, baseUrl: providerBaseUrl });
    expect(configured).toEqual({
      provider: "vertex-express",
      model: requestedModel,
      baseUrl: providerBaseUrl,
      credentialConfigured: true,
    });

    await page.reload();
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => page.evaluate(async () => {
      const [provider, engine] = await Promise.all([
        window.__ENJOY_APP__.userSettings.get("vertex_express"),
        window.__ENJOY_APP__.userSettings.get("gpt_engine"),
      ]);
      return {
        provider: engine?.name,
        model: engine?.models?.extractStory,
        baseUrl: provider?.baseUrl,
        credentialConfigured: Boolean(provider?.key),
      };
    })).toEqual(configured);

    await page.locator("#preferences-button").click();
    const preferences = page.getByRole("dialog");
    await expect(preferences).toBeVisible();
    await expect(preferences.getByText("Vertex AI Express", { exact: true }).first()).toBeVisible();
    await expect(preferences.getByText(requestedModel, { exact: true }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(preferences).toBeHidden();

    const storyId = randomUUID();
    const storyTitle = `Vertex Express persistence ${storyId.slice(0, 8)}`;
    await page.evaluate(({ id, title, content }) =>
      window.__ENJOY_APP__.localStudy.stories.create({
        id,
        title,
        content,
        html: `<article><p>${content}</p></article>`,
        extracted: false,
        provenance: { source: "manual" },
      }), { id: storyId, title: storyTitle, content: storyContent });

    const storyRoute = `/stories/${storyId}`;
    await navigateTo(page, storyRoute);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("heading", { name: storyTitle })).toBeVisible();
    await page.getByTitle(/^(?:Từ vựng chính|key vocabulary)$/iu).click();

    await expect.poll(() => page.evaluate(async (id) => {
      const story = await window.__ENJOY_APP__.localStudy.stories.get(id);
      return story.extracted
        ? { words: [...story.extraction.words].sort(), idioms: story.extraction.idioms }
        : null;
    }, storyId), { timeout: 90_000 })
      .toEqual({ words: [...expectedWords].sort(), idioms: [] });

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
    const persistedExtraction = JSON.parse(rowsBeforeRestart[0].extraction) as {
      words: string[];
      idioms: string[];
    };
    expect([...persistedExtraction.words].sort()).toEqual([...expectedWords].sort());
    expect(persistedExtraction.idioms).toEqual([]);
    const extractionDigest = digest(beforeRestart.extraction);
    const sqliteRowDigest = digest(rowsBeforeRestart[0]);

    const afterProviderNetwork = await captureProviderNetwork(page);
    networkEvidence.afterProvider = afterProviderNetwork;
    const successfulResponses = providerResponses.filter(response =>
      response.host === providerHost &&
      response.method === "POST" && response.status === 200 &&
      response.modelFromPath === requestedModel && response.queryAbsent &&
      response.apiKeyHeaderPresent && response.authorizationHeaderAbsent &&
      response.contentsValid && response.flattenedPromptIncludesSourceArticle &&
      response.flattenedPromptIncludesExtractionInstructions &&
      response.systemInstructionAbsentOrTextValid &&
      response.responseMimeType === "application/json" &&
      response.responseJsonSchemaValid,
    );
    expect(successfulResponses.length).toBeGreaterThan(0);
    const nodeObservedProviderHostCount =
      observedHostCount(afterProviderNetwork.main, providerHost) +
      observedHostCount(afterProviderNetwork.renderer, providerHost);

    await fixture.restart({ offline: true });
    page = fixture.page;
    page.on("request", (request: Request) => {
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
        window.__ENJOY_APP__.userSettings.get("vertex_express"),
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
    expect(afterRestart).toMatchObject(configured);
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

    await writeReceipt(testInfo, "provider-vertex-text-live.json", redactCredential({
      packaged: true,
      appPath,
      appAsarSha256,
      executableSha256,
      testSourceSha256,
      provider: "vertex-express",
      model: requestedModel,
      credentialSource,
      credentialPresent: true,
      credentialValueRecorded: false,
      trace: "off",
      screenshots: false,
      video: false,
      endpoint: {
        scheme: "https",
        host: providerHost,
        path: `/v1/publishers/google/models/${requestedModel}:generateContent`,
        queryAbsent: true,
        credentialTransport: "x-goog-api-key header",
      },
      requestInspection: {
        retainedHeaders: false,
        retainedBody: false,
        safeFieldsOnly: true,
      },
      profileSource: "fresh-disposable",
      storyId,
      sourceText: storyContent,
      extraction: beforeRestart.extraction,
      extractionDigest,
      extractedWordCount: beforeRestart.extraction.words.length,
      extractedIdiomCount: beforeRestart.extraction.idioms.length,
      providerResponses,
      successfulInferenceResponseCount: successfulResponses.length,
      providerTransportEvidence: "playwright-renderer-response",
      observedCountersScope: "Node HTTP and Undici diagnostics only",
      nodeObservedProviderHostCount,
      nodeObservedCountRequiredForRendererNativeFetch: false,
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
      await writeReceipt(testInfo, "provider-vertex-text-live-failure.json", redactCredential({
        provider: "vertex-express",
        model: requestedModel,
        credentialSource,
        credentialPresent: true,
        credentialValueRecorded: false,
        providerResponses,
        offlineProviderRequests,
        network: networkEvidence,
        runtime: fixture.runtimeDiagnostics(),
        errorClassification: sanitizeLocalDiagnostic(
          error instanceof Error ? error.message : String(error),
        ).replaceAll(credential, "<redacted>"),
      }, credential));
    }
    throw new Error("Vertex Express packaged live acceptance failed; inspect the sanitized receipt");
  } finally {
    await fixture?.close().catch(() => {
      if (!primaryError) throw new Error("Vertex Express fixture cleanup failed");
    });
  }
});
