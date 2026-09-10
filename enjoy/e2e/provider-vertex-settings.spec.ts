/* eslint-disable no-empty-pattern -- Electron tests use a disposable app fixture. */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "playwright";
import { launchLocalApp, queryLocalDatabase, writeReceipt } from "./helpers/local-app";
import { resolveE2EAppPath } from "./helpers/isolated-app";
import { captureProviderNetwork, observedHostCount } from "./helpers/provider-network";

test.skip(process.env.ENJOY_RUN_ACP_ACCEPTANCE !== "1", "Explicit packaged acceptance required");
test.describe.configure({ retries: 0 });
test.use({ trace: "off", screenshot: "off", video: "off" });

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const gemini = {
  name: "gemini",
  key: "fixture-gemini-key-not-a-real-credential",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  models: "gemini-custom-preserved",
};
const vertexModel = "gemini-explicit-fixture";
const vertexKey = "fixture-vertex-key-not-a-real-credential";

const openProviderSettings = async (page: Page) => {
  await page.locator("#preferences-button").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Nâng cao", exact: true }).click();
  await dialog.getByRole("button", { name: /Cấu hình chi tiết dịch vụ/ }).click();
  await expect(page.getByTestId("ai-provider-select")).toBeVisible();
  return dialog;
};

test("Vertex settings remain separate from Gemini and persist with explicit model selection", async ({}, info) => {
  test.setTimeout(150_000);
  const appPath = resolveE2EAppPath();
  const appAsarSha256 = createHash("sha256").update(await readFile(
    path.join(appPath, "Contents/Resources/app.asar"),
  )).digest("hex");
  const app = await launchLocalApp({ offline: true });
  const conversationId = randomUUID();
  try {
    let page = app.page;
    await expect(page.getByTestId("layout-home")).toBeVisible();
    await page.evaluate(async ({ config, id }) => {
      const bridge = window.__ENJOY_APP__;
      await bridge.userSettings.set("gemini", config);
      await bridge.userSettings.set("gpt_engine", {
        name: "gemini", models: { default: config.models, extractStory: config.models },
      });
      await bridge.conversations.create({
        id, name: "Preserved Gemini conversation", engine: "gemini",
        configuration: {
          type: "gpt", model: config.models, roleDefinition: "Preserve this custom prompt.",
          historyBufferSize: 10,
        },
      });
      await bridge.messages.createInBatch([{
        id: crypto.randomUUID(), conversationId: id, role: "user", content: "Preserve this message.",
      }]);
    }, { config: gemini, id: conversationId });
    const preservedRows = async () => ({
      gemini: await queryLocalDatabase(app.databasePath,
        "SELECT * FROM user_settings WHERE key = ?", ["gemini"]),
      conversation: await queryLocalDatabase(app.databasePath,
        "SELECT * FROM conversations WHERE id = ?", [conversationId]),
      messages: await queryLocalDatabase(app.databasePath,
        "SELECT * FROM messages WHERE conversation_id = ? ORDER BY id", [conversationId]),
    });
    const beforeDigest = digest(await preservedRows());
    const originalEngine = await page.evaluate(() => window.__ENJOY_APP__.userSettings.get("gpt_engine"));
    await page.reload();
    await expect(page.getByTestId("layout-home")).toBeVisible();
    let dialog = await openProviderSettings(page);
    await page.getByTestId("ai-provider-select").click();
    await page.getByRole("option", { name: "Vertex AI Express", exact: true }).click();
    await expect(page.getByTestId("provider-models-input")).toHaveValue("");
    await expect(page.getByTestId("provider-api-key-input")).toHaveValue("");
    await expect(page.getByTestId("provider-fixed-base-url")).toContainText("https://aiplatform.googleapis.com/v1");
    const providerForm = dialog.locator("form").filter({ has: page.getByTestId("ai-provider-select") });
    await expect(providerForm.locator("input")).toHaveCount(2);
    await page.getByTestId("provider-edit-button").click();
    await page.getByTestId("provider-api-key-input").fill(vertexKey);
    await page.getByTestId("provider-models-input").fill(vertexModel);
    await page.getByTestId("provider-save-button").click();
    await expect(page.getByTestId("provider-api-key-input")).toBeDisabled();
    const vertex = await page.evaluate(() => window.__ENJOY_APP__.userSettings.get("vertex_express"));
    expect(vertex).toMatchObject({ name: "vertex-express", key: vertexKey, models: vertexModel });
    expect(vertex.baseUrl).toBe("https://aiplatform.googleapis.com/v1");
    expect(await page.evaluate(() => window.__ENJOY_APP__.userSettings.get("gpt_engine"))).toEqual(originalEngine);
    expect(digest(await preservedRows())).toBe(beforeDigest);

    // Selecting the default engine is a separate explicit UI action.
    const defaultForm = dialog.locator("form").filter({ has: page.getByText("Dịch vụ AI mặc định", { exact: true }) });
    await defaultForm.getByRole("button", { name: "Chỉnh sửa", exact: true }).click();
    await defaultForm.getByRole("combobox").nth(0).click();
    await page.getByRole("option", { name: "Vertex AI Express", exact: true }).click();
    await defaultForm.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: vertexModel, exact: true }).click();
    await defaultForm.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__ENJOY_APP__.userSettings.get("gpt_engine")))
      .toEqual({ name: "vertex-express", models: { default: vertexModel } });
    await page.keyboard.press("Escape");
    const afterSave = await captureProviderNetwork(page);
    await app.restart({ offline: true });
    page = app.page;
    await expect(page.getByTestId("layout-home")).toBeVisible();
    expect(digest(await preservedRows())).toBe(beforeDigest);
    const restartedSettings = await page.evaluate(async () => ({
      gemini: await window.__ENJOY_APP__.userSettings.get("gemini"),
      vertex: await window.__ENJOY_APP__.userSettings.get("vertex_express"),
      engine: await window.__ENJOY_APP__.userSettings.get("gpt_engine"),
    }));
    expect(restartedSettings.gemini).toEqual(gemini);
    expect(restartedSettings.vertex).toEqual(vertex);
    expect(restartedSettings.engine).toEqual({ name: "vertex-express", models: { default: vertexModel } });
    dialog = await openProviderSettings(page);
    await page.getByTestId("ai-provider-select").click();
    await page.getByRole("option", { name: "Vertex AI Express", exact: true }).click();
    await expect(page.getByTestId("provider-models-input")).toHaveValue(vertexModel);
    await expect(page.getByTestId("provider-api-key-input")).toHaveValue(vertexKey);
    await page.getByTestId("ai-provider-select").click();
    await page.getByRole("option", { name: "Gemini", exact: true }).click();
    await expect(page.getByTestId("provider-models-input")).toHaveValue(gemini.models);
    await expect(page.getByTestId("provider-api-key-input")).toHaveValue(gemini.key);
    const afterRestart = await captureProviderNetwork(page);
    for (const network of [afterSave, afterRestart]) {
      for (const host of ["aiplatform.googleapis.com", "generativelanguage.googleapis.com"]) {
        expect(observedHostCount(network.main, host) + observedHostCount(network.renderer, host)).toBe(0);
      }
    }
    app.assertNoRuntimeIssues();
    await writeReceipt(info, "provider-vertex-settings.json", {
      packaged: true, appPath, appAsarSha256, fixtureCredentialsOnly: true,
      actualInference: false, providerNetworkRequests: 0, explicitModelSelection: true,
      geminiSettingsConversationMessagesDigestBefore: beforeDigest,
      geminiSettingsConversationMessagesDigestAfter: digest(await preservedRows()),
      vertexSettingsPersisted: true, defaultSelectionPersisted: true, offlineRestart: true,
      network: { afterSave, afterRestart }, runtime: app.runtimeDiagnostics(),
    });
  } finally {
    await writeReceipt(info, "runtime-diagnostics.json", app.runtimeDiagnostics());
    await app.close();
  }
});
