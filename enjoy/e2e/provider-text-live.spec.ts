/* eslint-disable no-empty-pattern -- Electron tests receive TestInfo without creating a browser fixture. */
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
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
import {
  captureProviderNetwork,
  observedHostCount,
} from "./helpers/provider-network";

const runLive = process.env.ENJOY_RUN_PROVIDER_TEXT_LIVE === "1";
const snapshot = process.env.ENJOY_PROVIDER_SNAPSHOT?.trim() || "";
const requestedProvider =
  process.env.ENJOY_PROVIDER_TEXT_LIVE_PROVIDER?.trim().toLowerCase() || "";
const requestedModel =
  process.env.ENJOY_PROVIDER_TEXT_LIVE_MODEL?.trim() || "";
const profileId = process.env.ENJOY_LEGACY_PROFILE_ID?.trim() || "26015977";
const azureCredentialInput =
  process.env.ENJOY_AZURE_CREDENTIAL_FILE?.trim() || "";
const azureCase =
  requestedProvider === "azure-openai" && requestedModel === "configured";

const supportedCase =
  (requestedProvider === "openai" && requestedModel === "gpt-4o") ||
  (requestedProvider === "deepseek" &&
    ["configured", "deepseek-v4-flash"].includes(requestedModel)) ||
  (requestedProvider === "openrouter" &&
    requestedModel === "openai/gpt-4o-mini") ||
  azureCase;

test.use({ trace: "off" });

test.skip(
  !runLive,
  "Set ENJOY_RUN_PROVIDER_TEXT_LIVE=1 for a controlled paid live text run",
);
test.skip(
  !azureCase && !snapshot,
  "Set ENJOY_PROVIDER_SNAPSHOT to a copied provider profile for non-Azure providers",
);
test.skip(
  azureCase && !azureCredentialInput,
  "Set ENJOY_AZURE_CREDENTIAL_FILE to a private mode-0600 JSON file for Azure OpenAI",
);
test.skip(
  !supportedCase,
  "Select exactly one explicit case: openai/gpt-4o, deepseek/configured, deepseek/deepseek-v4-flash, openrouter/openai/gpt-4o-mini, or azure-openai/configured",
);

type AzureCredential = Readonly<{
  key: string;
  textEndpoint: string;
  deployment: string;
}>;

const readAzureCredential = async (): Promise<AzureCredential> => {
  const resolved = path.resolve(azureCredentialInput);
  const metadata = await stat(resolved);
  expect(metadata.isFile()).toBe(true);
  expect(metadata.mode & 0o777, "Azure credential file must have mode 0600").toBe(0o600);
  const parsed = JSON.parse(await readFile(resolved, "utf8")) as Record<string, unknown>;
  const key = typeof parsed.key === "string" ? parsed.key.trim() : "";
  const textEndpoint =
    typeof parsed.textEndpoint === "string" ? parsed.textEndpoint.trim() : "";
  const deployment =
    typeof parsed.deployment === "string" ? parsed.deployment.trim() : "";
  expect(key.length).toBeGreaterThan(0);
  expect(deployment.length).toBeGreaterThan(0);
  const endpoint = new URL(textEndpoint);
  expect(endpoint.protocol).toBe("https:");
  expect(endpoint.username || endpoint.password).toBe("");
  expect(endpoint.search || endpoint.hash).toBe("");
  expect(endpoint.pathname.replace(/\/+$/u, "")).toMatch(/\/openai\/v1$/u);
  return { key, textEndpoint, deployment };
};

const sha256File = async (filePath: string): Promise<string> =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const sanitizeProviderDiagnostic = (value: string, secret?: string): string => {
  const sanitized = sanitizeLocalDiagnostic(value)
    .replace(/sk-[A-Za-z0-9_-]+/gu, "<redacted>");
  return secret ? sanitized.replaceAll(secret, "<redacted>") : sanitized;
};

const navigateTo = async (page: Page, route: string): Promise<void> => {
  await page.evaluate((nextRoute) => {
    window.location.hash = nextRoute;
  }, route);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#${route}`);
};

const openPreferences = async (page: Page) => {
  await page.locator("#preferences-button").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
};

const closePreferences = async (page: Page): Promise<void> => {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
};

type PersistedStoryRow = {
  id: string;
  title: string;
  content: string;
  extraction: string;
  extracted: number;
};

type PersistedUserSettingRow = {
  value: string;
};

test("packaged Story AI extraction persists the selected live provider output across restart", async ({}, testInfo) => {
  test.setTimeout(240_000);
  testInfo.annotations.push({
    type: "paid-live-provider",
    description:
      "Actual packaged renderer provider factory, disposable SQLite profile, live Story extraction, local persistence, and restart",
  });

  const azureCredential = azureCase ? await readAzureCredential() : undefined;
  const sourcePath = azureCase ? undefined : path.resolve(snapshot);
  const sourceHashBefore = sourcePath ? await sha256File(sourcePath) : undefined;
  let fixture: LocalApp | undefined;
  let primaryError: unknown;
  const providerResponses: { host: string; path: string; method: string; status: number }[] = [];
  const offlineProviderRequests: { host: string; path: string; method: string }[] = [];
  let azureSecretAtRest: {
    rawKeyAbsent: boolean;
    encryptedKeyPresent: boolean;
    plaintextAbsent: boolean;
  } | undefined;

  try {
    fixture = sourcePath
      ? await launchLocalApp({
          seed: { databasePath: sourcePath, profileId, assets: [] },
        })
      : await launchLocalApp();
    let page = fixture.page;
    const providerHost = azureCredential
      ? new URL(azureCredential.textEndpoint).hostname
      : { openai: "api.openai.com", deepseek: "api.deepseek.com", openrouter: "openrouter.ai" }[requestedProvider]!;
    page.on("response", response => {
      const url = new URL(response.url());
      if (url.hostname === providerHost) providerResponses.push({ host: url.hostname, path: url.pathname, method: response.request().method(), status: response.status() });
    });
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });
    if (sourcePath) expect(path.resolve(fixture.databasePath)).not.toBe(sourcePath);

    const configured = await page.evaluate(
      async ({ provider, modelRequest, azure }) => {
        const settingKey = provider === "azure-openai" ? "azure_openai" : provider;
        if (provider === "azure-openai") {
          if (!azure?.key || !azure.baseUrl || !azure.deployment) {
            throw new Error("azure_private_config_invalid");
          }
          await window.__ENJOY_APP__.userSettings.set(settingKey, {
            name: provider,
            key: azure.key,
            baseUrl: azure.baseUrl,
            models: azure.deployment,
          });
        }
        const providerConfig = await window.__ENJOY_APP__.userSettings.get(settingKey);
        if (!providerConfig?.key) {
          return { ready: false as const, reason: "snapshot-credential-missing" as const };
        }

        let model = provider === "azure-openai" ? azure!.deployment : modelRequest;
        if (provider === "deepseek" && modelRequest === "configured") {
          const current = await window.__ENJOY_APP__.userSettings.get("gpt_engine");
          if (current?.name !== "deepseek") {
            return { ready: false as const, reason: "deepseek-not-selected" as const };
          }
          model = current?.models?.extractStory || current?.models?.default || "";
          if (!model) {
            return { ready: false as const, reason: "configured-model-missing" as const };
          }
        }

        await window.__ENJOY_APP__.userSettings.set("gpt_engine", {
          name: provider,
          models: { default: model, extractStory: model },
        });
        return { ready: true as const, provider, model };
      },
      {
        provider: requestedProvider,
        modelRequest: requestedModel,
        azure: azureCredential
          ? {
              key: azureCredential.key,
              baseUrl: azureCredential.textEndpoint,
              deployment: azureCredential.deployment,
            }
          : undefined,
      },
    );

    if (!configured.ready) {
      if (azureCase) throw new Error(configured.reason);
      test.skip(true, configured.reason);
    }
    const selectedModel = configured.model;
    if (azureCredential) {
      const rows = await queryLocalDatabase<PersistedUserSettingRow>(
        fixture.databasePath,
        "SELECT value FROM user_settings WHERE key = ?",
        ["azure_openai"],
      );
      expect(rows).toHaveLength(1);
      const raw = JSON.parse(rows[0].value) as Record<string, unknown>;
      azureSecretAtRest = {
        rawKeyAbsent: !Object.hasOwn(raw, "key"),
        encryptedKeyPresent:
          typeof raw.encryptedKey === "string" && raw.encryptedKey.length > 0,
        plaintextAbsent: !rows[0].value.includes(azureCredential.key),
      };
      expect(azureSecretAtRest).toEqual({
        rawKeyAbsent: true,
        encryptedKeyPresent: true,
        plaintextAbsent: true,
      });
    }
    await page.reload();
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });

    await expect
      .poll(
        () =>
          page.evaluate(async (provider) => {
            const settingKey = provider === "azure-openai" ? "azure_openai" : provider;
            const [selection, config] = await Promise.all([
              window.__ENJOY_APP__.userSettings.get("gpt_engine"),
              window.__ENJOY_APP__.userSettings.get(settingKey),
            ]);
            return {
              provider: selection?.name,
              defaultModel: selection?.models?.default,
              extractionModel: selection?.models?.extractStory,
              credentialConfigured: Boolean(config?.key),
            };
          }, requestedProvider),
        { timeout: 30_000 },
      )
      .toEqual({
        provider: requestedProvider,
        defaultModel: selectedModel,
        extractionModel: selectedModel,
        credentialConfigured: true,
      });

    const providerLabel = {
      openai: "OpenAI",
      "azure-openai": "Azure OpenAI",
      deepseek: "DeepSeek",
      openrouter: "OpenRouter",
    }[requestedProvider]!;
    const preferences = await openPreferences(page);
    await expect(preferences.getByText(providerLabel, { exact: true }).first()).toBeVisible();
    await expect(preferences.getByText(selectedModel, { exact: true }).first()).toBeVisible();
    await closePreferences(page);

    const storyId = randomUUID();
    const storyTitle = `Live provider persistence ${storyId.slice(0, 8)}`;
    const storyContent =
      "The meticulous botanist catalogued a resilient alpine orchid.";
    await page.evaluate(
      ({ id, title, content }) =>
        window.__ENJOY_APP__.localStudy.stories.create({
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
    // A new Story opens its vocabulary sheet before the user starts extraction.
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByRole("heading", { name: storyTitle })).toBeVisible();
    const extractButton = page.getByTitle(/^(?:Từ vựng chính|key vocabulary)$/iu);
    await expect(extractButton).toBeVisible();
    await page.evaluate(() => {
      const target = window as typeof window & { __PROVIDER_TEST_ALERTS__?: string[] };
      target.__PROVIDER_TEST_ALERTS__ = [];
      new MutationObserver(() => {
        for (const toast of document.querySelectorAll('[data-sonner-toast]')) {
          const message = toast.textContent || "";
          if (message && !target.__PROVIDER_TEST_ALERTS__!.includes(message)) target.__PROVIDER_TEST_ALERTS__!.push(message);
        }
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    await extractButton.click();

    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const story = await window.__ENJOY_APP__.localStudy.stories.get(id);
            return {
              extracted: story.extracted,
              words: story.extraction?.words || [],
              idioms: story.extraction?.idioms || [],
            };
          }, storyId),
        { timeout: 90_000 },
      )
      .toMatchObject({ extracted: true });

    const beforeRestart = await page.evaluate(
      (id) => window.__ENJOY_APP__.localStudy.stories.get(id),
      storyId,
    );
    const extraction = beforeRestart.extraction;
    expect(extraction).toBeDefined();
    const extractedTerms = [...extraction.words, ...extraction.idioms];
    expect(extractedTerms.length).toBeGreaterThan(0);
    const renderedTerm = extractedTerms.find((term) =>
      storyContent.toLocaleLowerCase().includes(term.toLocaleLowerCase()),
    );
    expect(renderedTerm, "Provider output must contain a term rendered from the Story text").toBeTruthy();
    await expect(page.getByText(renderedTerm!, { exact: true }).first()).toBeVisible();

    const rowsBeforeRestart = await queryLocalDatabase<PersistedStoryRow>(
      fixture.databasePath,
      "SELECT id, title, content, extraction, extracted FROM local_stories WHERE id = ?",
      [storyId],
    );
    expect(rowsBeforeRestart).toHaveLength(1);
    expect(rowsBeforeRestart[0].extracted).toBe(1);
    const outputDigest = digest(extraction);
    const rowDigest = digest(rowsBeforeRestart[0]);
    const afterProviderNetwork = await captureProviderNetwork(page);
    const successfulProviderResponses = providerResponses.filter(
      response =>
        response.host === providerHost &&
        response.method === "POST" &&
        response.status === 200 &&
        (!azureCase || response.path === "/openai/v1/chat/completions"),
    );
    expect(successfulProviderResponses.length).toBeGreaterThan(0);
    expect(afterProviderNetwork.main.blockedAttemptCount).toBe(0);
    expect(afterProviderNetwork.renderer.blockedAttemptCount).toBe(0);
    expect(afterProviderNetwork.main.legacyBackendOperationCount).toBe(0);
    expect(afterProviderNetwork.renderer.legacyBackendOperationCount).toBe(0);
    const nodeObservedProviderHostCount = observedHostCount(
      afterProviderNetwork.main,
      providerHost,
    ) + observedHostCount(afterProviderNetwork.renderer, providerHost);

    await fixture.restart({ offline: azureCase });
    page = fixture.page;
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.hostname === providerHost) {
        offlineProviderRequests.push({
          host: url.hostname,
          path: url.pathname,
          method: request.method(),
        });
      }
    });
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });
    await navigateTo(page, storyRoute);
    await expect(page.getByRole("heading", { name: storyTitle })).toBeVisible();
    await page.getByTitle(/^(?:Từ vựng chính|key vocabulary)$/iu).click();
    await expect(page.getByText(renderedTerm!, { exact: true }).first()).toBeVisible();

    const afterRestart = await page.evaluate(
      async ({ id, provider }) => {
        const settingKey = provider === "azure-openai" ? "azure_openai" : provider;
        const [story, selection, config] = await Promise.all([
          window.__ENJOY_APP__.localStudy.stories.get(id),
          window.__ENJOY_APP__.userSettings.get("gpt_engine"),
          window.__ENJOY_APP__.userSettings.get(settingKey),
        ]);
        return {
          story,
          provider: selection?.name,
          model: selection?.models?.extractStory || selection?.models?.default,
          credentialConfigured: Boolean(config?.key),
        };
      },
      { id: storyId, provider: requestedProvider },
    );
    expect(afterRestart.provider).toBe(requestedProvider);
    expect(afterRestart.model).toBe(selectedModel);
    expect(afterRestart.credentialConfigured).toBe(true);
    expect(digest(afterRestart.story.extraction)).toBe(outputDigest);

    const rowsAfterRestart = await queryLocalDatabase<PersistedStoryRow>(
      fixture.databasePath,
      "SELECT id, title, content, extraction, extracted FROM local_stories WHERE id = ?",
      [storyId],
    );
    expect(digest(rowsAfterRestart[0])).toBe(rowDigest);

    const sourceHashAfter = sourcePath ? await sha256File(sourcePath) : undefined;
    const afterRestartNetwork = await captureProviderNetwork(page);
    if (sourcePath) expect(sourceHashAfter).toBe(sourceHashBefore);
    if (azureCase) {
      expect(offlineProviderRequests).toEqual([]);
      expect(observedHostCount(afterRestartNetwork.main, providerHost)).toBe(0);
      expect(observedHostCount(afterRestartNetwork.renderer, providerHost)).toBe(0);
      expect(afterRestartNetwork.main.blockedAttemptCount).toBe(0);
      expect(afterRestartNetwork.renderer.blockedAttemptCount).toBe(0);
      expect(afterRestartNetwork.main.legacyBackendOperationCount).toBe(0);
      expect(afterRestartNetwork.renderer.legacyBackendOperationCount).toBe(0);
      const rows = await queryLocalDatabase<PersistedUserSettingRow>(
        fixture.databasePath,
        "SELECT value FROM user_settings WHERE key = ?",
        ["azure_openai"],
      );
      expect(rows).toHaveLength(1);
      const raw = JSON.parse(rows[0].value) as Record<string, unknown>;
      expect(Object.hasOwn(raw, "key")).toBe(false);
      expect(typeof raw.encryptedKey).toBe("string");
      expect(String(raw.encryptedKey).length).toBeGreaterThan(0);
    }
    fixture.assertNoRuntimeIssues();
    await writeReceipt(testInfo, "provider-text-live-persistence.json", {
      packaged: true,
      provider: requestedProvider,
      model: selectedModel,
      route: storyRoute,
      action: "StoryToolbar key vocabulary button",
      profileSource: azureCase ? "fresh-disposable" : "copied-snapshot",
      sourceSnapshotHashBefore: sourceHashBefore || null,
      sourceSnapshotHashAfter: sourceHashAfter || null,
      sourceSnapshotUnchanged: sourcePath ? sourceHashAfter === sourceHashBefore : null,
      disposableDatabase: true,
      azureSecretAtRest: azureSecretAtRest || null,
      storyId,
      sourceText: storyContent,
      extraction,
      extractionDigest: outputDigest,
      extractedWordCount: extraction.words.length,
      extractedIdiomCount: extraction.idioms.length,
      renderedTerm,
      providerResponses,
      rendererProviderResponseCount: successfulProviderResponses.length,
      providerHost,
      nodeObservedProviderHostCount,
      providerTransportEvidence: "playwright-renderer-response",
      zeroEnjoyBackendOperations:
        afterProviderNetwork.main.legacyBackendOperationCount === 0 &&
        afterProviderNetwork.renderer.legacyBackendOperationCount === 0,
      offlineProviderRequests,
      network: { afterProvider: afterProviderNetwork, afterRestart: afterRestartNetwork },
      sqliteRowDigestBeforeRestart: rowDigest,
      sqliteRowDigestAfterRestart: digest(rowsAfterRestart[0]),
      bridgeOutputStableAfterRestart: true,
      runtime: fixture.runtimeDiagnostics(),
    });
  } catch (error) {
    primaryError = error;
    if (fixture) {
      await writeReceipt(testInfo, "provider-text-failure.json", {
        runtime: fixture.runtimeDiagnostics(),
        providerResponses,
        offlineProviderRequests,
        alerts: (await fixture.page.evaluate(() => (window as typeof window & { __PROVIDER_TEST_ALERTS__?: string[] }).__PROVIDER_TEST_ALERTS__ || []).catch(() => []))
          .map(value => sanitizeProviderDiagnostic(value, azureCredential?.key)),
      });
      if (!azureCase) {
        await fixture.page.screenshot({ path: testInfo.outputPath("provider-text-failure.png") }).catch(() => undefined);
      }
    }
    throw error;
  } finally {
    await fixture?.close().catch((error) => {
      if (!primaryError) throw error;
    });
  }
});
