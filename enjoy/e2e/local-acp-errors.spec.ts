/* eslint-disable no-empty-pattern -- Electron tests do not use Playwright's browser fixture. */
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import type { AcpConnectionStatus, AcpProvider } from "../src/types/acp-api";
import {
  backupLocalDatabase,
  launchLocalApp,
  sanitizeLocalDiagnostic,
  writeReceipt,
  type LocalApp,
} from "./helpers/local-app";

test.skip(
  process.env.ENJOY_RUN_ACP_ACCEPTANCE !== "1",
  "Explicit packaged ACP acceptance is required because this test uses existing local CLI subscriptions",
);
test.describe.configure({ mode: "serial", retries: 0 });

const expectedModelError = "Chưa tạo được gợi ý: Hãy chọn lại model trong Dịch vụ AI rồi thử lại.";

const suggestionUiName = (provider: AcpProvider): string =>
  provider === "codex" ? "Codex" : "Claude ACP";

async function openStudio(page: Page): Promise<void> {
  await expect.poll(
    () => page.evaluate(() => window.__ENJOY_APP__.appSettings.getUser()),
    { timeout: 30_000 },
  ).toMatchObject({ id: "local" });
  await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("sidebar-learning-studio").click();
  await expect(page.getByTestId("learning-studio")).toBeVisible({ timeout: 30_000 });
}

async function requireAuthenticatedCatalogs(page: Page): Promise<AcpConnectionStatus[]> {
  const statuses = await page.evaluate(() => window.__ENJOY_APP__.acp.status());
  for (const provider of ["codex", "claude"] as const) {
    const status = statuses.find(candidate => candidate.provider === provider);
    expect(status, `${provider} ACP status must be present`).toBeTruthy();
    expect(status?.available, `${provider} ACP must use an existing authenticated CLI session`).toBe(true);
    expect(status?.models.length, `${provider} ACP must publish its actual model catalog`).toBeGreaterThan(0);
  }
  return statuses;
}

async function persistInvalidModel(page: Page, provider: AcpProvider, model: string): Promise<void> {
  await page.evaluate(async ({ selectedProvider, invalidModel }) => {
    const providerKey = selectedProvider === "codex" ? "codex_acp" : "claude_acp";
    const providerName = `${selectedProvider}-acp`;
    const existing = await window.__ENJOY_APP__.userSettings.get(providerKey as never);
    await window.__ENJOY_APP__.userSettings.set(providerKey as never, {
      ...(existing && typeof existing === "object" ? existing : {}),
      name: providerName,
      model: invalidModel,
    });
    await window.__ENJOY_APP__.userSettings.set("gpt_engine" as never, {
      name: providerName,
      models: { default: invalidModel },
    });
  }, { selectedProvider: provider, invalidModel: model });
}

async function assertInvalidModelHydrated(page: Page, provider: AcpProvider, model: string): Promise<void> {
  const stored = await page.evaluate(async selectedProvider => {
    const providerKey = selectedProvider === "codex" ? "codex_acp" : "claude_acp";
    const [providerConfig, engine] = await Promise.all([
      window.__ENJOY_APP__.userSettings.get(providerKey as never),
      window.__ENJOY_APP__.userSettings.get("gpt_engine" as never),
    ]);
    return {
      providerModel: providerConfig?.model,
      engineName: engine?.name,
      engineModel: engine?.models?.default,
    };
  }, provider);
  expect(stored).toEqual({
    providerModel: model,
    engineName: `${provider}-acp`,
    engineModel: model,
  });
}

let fixture: LocalApp | undefined;

test.beforeAll(async () => {
  fixture = await launchLocalApp();
});

test.afterEach(async ({}, testInfo: TestInfo) => {
  if (!fixture) return;
  const diagnostics = fixture.runtimeDiagnostics();
  let runtimeError: Error | null = null;
  try {
    fixture.assertNoRuntimeIssues();
  } catch (error) {
    runtimeError = error instanceof Error ? error : new Error(String(error));
  }
  const failed = testInfo.status !== testInfo.expectedStatus || runtimeError !== null;
  if (diagnostics.expected.length > 0 || diagnostics.externalPages.length > 0 || runtimeError) {
    await writeReceipt(testInfo, "runtime-diagnostics.json", {
      pass: !failed,
      runtimeVerified: runtimeError === null,
      externalNetworkVerified: false,
      diagnostics,
    });
  }
  if (failed) {
    await fixture.page.screenshot({
      path: testInfo.outputPath("local-acp-errors-failure.png"),
      fullPage: true,
    }).catch(() => undefined);
    await backupLocalDatabase(fixture.databasePath, testInfo.outputPath("failed-local-profile.sqlite"));
    await writeReceipt(testInfo, "failed-runtime-receipt.json", {
      pass: false,
      runtimeVerified: false,
      status: testInfo.status,
      expectedStatus: testInfo.expectedStatus,
      error: sanitizeLocalDiagnostic(testInfo.error?.message || runtimeError?.message || "unknown_test_failure"),
      sqliteBackup: "failed-local-profile.sqlite",
      diagnostics,
    });
  }
  if (runtimeError) throw runtimeError;
});

test.afterAll(async () => {
  await fixture?.close();
});

test("the packaged UI reports unavailable models for both authenticated ACP providers", async ({}, testInfo: TestInfo) => {
  test.setTimeout(360_000);
  if (!fixture) throw new Error("Local ACP fixture did not launch");
  const page = fixture.page;
  await openStudio(page);
  const initialStatuses = await requireAuthenticatedCatalogs(page);
  const receipts = [];

  for (const provider of ["codex", "claude"] as const) {
    const status = initialStatuses.find(candidate => candidate.provider === provider);
    if (!status) throw new Error(`${provider}_acp_status_missing`);
    const invalidModel = `enjoy-invalid-ui-model-${provider}-${crypto.randomUUID()}`;
    expect(status.models.some(model => model.id === invalidModel)).toBe(false);

    await persistInvalidModel(page, provider, invalidModel);
    await page.reload();
    await openStudio(page);
    await assertInvalidModelHydrated(page, provider, invalidModel);
    await page.getByRole("button", { name: "Bài học mới", exact: true }).click();

    const form = page.getByRole("form", { name: "Tạo bản nháp bài học" });
    const topicInput = form.getByLabel("Chủ đề", { exact: false });
    const keywordInput = form.getByLabel("Từ hoặc cụm từ", { exact: false });
    const topic = provider === "codex" ? "Ordering coffee politely with a colleague" : "";
    const keywords = provider === "claude" ? "return ticket, platform announcement" : "";
    if (topic) await topicInput.fill(topic);
    if (keywords) await keywordInput.fill(keywords);
    await form.getByRole("radiogroup", { name: "Dịch vụ AI dùng để gợi ý" })
      .getByLabel(suggestionUiName(provider), { exact: true })
      .check();

    const suggestButton = form.getByRole("button", { name: "Gợi ý mục học", exact: true });
    await expect(suggestButton).toBeEnabled();
    await suggestButton.click();
    await expect(form.getByRole("alert")).toHaveText(expectedModelError, { timeout: 120_000 });
    await expect(topicInput).toHaveValue(topic);
    await expect(keywordInput).toHaveValue(keywords);
    await expect(suggestButton).toBeEnabled();
    await expect(form.locator('section[aria-labelledby="target-review-heading"]')).toHaveCount(0);

    const consumedExpectedErrors = fixture.consumeExpectedRuntimeError("native_model_unavailable");
    const receipt = {
      provider,
      packaged: true,
      authenticated: status.available,
      catalogCount: status.models.length,
      invalidModelAbsentFromCatalog: true,
      inputMode: provider === "codex" ? "topic-only" : "keywords-only",
      rawTopic: topic,
      rawKeywords: keywords,
      vietnameseError: expectedModelError,
      inputsPreserved: true,
      retryEnabled: true,
      noTargets: true,
      consumedExpectedErrors,
    };
    receipts.push(receipt);
    await writeReceipt(testInfo, `${provider}-ui-model-unavailable.json`, receipt);
  }

  await writeReceipt(testInfo, "ui-model-unavailable-receipt.json", {
    providersRequired: ["codex", "claude"],
    providersTested: receipts.map(receipt => receipt.provider),
    receipts,
  });
});
