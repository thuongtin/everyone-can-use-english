/* eslint-disable no-empty-pattern -- Electron tests receive TestInfo without creating a browser fixture. */
import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import sqlitePackage from "sqlite3";

import {
  launchLocalApp,
  queryLocalDatabase,
  writeReceipt,
  type LocalApp,
} from "./helpers/local-app";
import { captureProviderNetwork } from "./helpers/provider-network";

// sqlite3 is CommonJS at runtime even though its declarations advertise named exports.
// eslint-disable-next-line import/no-named-as-default-member
const { Database: SqliteDatabase } = sqlitePackage;

const navigateTo = async (page: Page, route: string): Promise<void> => {
  await page.evaluate(path => {
    window.location.hash = path;
  }, route);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#${route}`);
};

const updateLegacyConversation = (
  databasePath: string,
  conversationId: string,
  configuration: Record<string, unknown>,
): Promise<void> => new Promise((resolve, reject) => {
  const database = new SqliteDatabase(databasePath, openError => {
    if (openError) {
      reject(openError);
      return;
    }
    database.configure("busyTimeout", 5_000);
    database.run(
      "UPDATE conversations SET engine = ?, configuration = ? WHERE id = ?",
      ["enjoyai", JSON.stringify(configuration), conversationId],
      function onUpdated(updateError) {
        const updatedRows = this.changes;
        database.close(closeError => {
          const failure = updateError || closeError;
          if (failure) reject(failure);
          else if (updatedRows !== 1) reject(new Error(`Expected one legacy conversation row, updated ${updatedRows}`));
          else resolve();
        });
      },
    );
  });
});

const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const readLegacyRows = async (databasePath: string, conversationId: string) => ({
  conversation: await queryLocalDatabase<Record<string, unknown>>(
    databasePath,
    "SELECT id, name, engine, configuration, created_at, updated_at FROM conversations WHERE id = ?",
    [conversationId],
  ),
  messages: await queryLocalDatabase<Record<string, unknown>>(
    databasePath,
    "SELECT id, conversation_id, role, content, created_at, updated_at FROM messages WHERE conversation_id = ? ORDER BY created_at, id",
    [conversationId],
  ),
});

test("legacy EnjoyAI history stays readable and blocked until that conversation is explicitly rebound", async ({}, testInfo) => {
  test.setTimeout(120_000);
  let app: LocalApp | undefined;
  try {
    app = await launchLocalApp({ offline: true });
    let page = app.page;
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });

    const fixture = await page.evaluate(async ({ conversationId, userMessageId, assistantMessageId }) => {
      const bridge = window.__ENJOY_APP__;
      const conversation = await bridge.conversations.create({
        id: conversationId,
        name: "Legacy EnjoyAI history",
        engine: "openai",
        configuration: {
          type: "gpt",
          model: "gpt-4o-mini",
          roleDefinition: "Preserved legacy role",
          historyBufferSize: 10,
          legacyProvenance: "imported-enjoyai-history",
        },
      });
      await bridge.messages.createInBatch([
        {
          id: userMessageId,
          conversationId: conversation.id,
          role: "user",
          content: "Historical learner question",
        },
        {
          id: assistantMessageId,
          conversationId: conversation.id,
          role: "assistant",
          content: "Historical EnjoyAI answer",
        },
      ]);
      await bridge.userSettings.set("gpt_engine" as never, {
        name: "enjoyai",
        models: { default: "gpt-4o" },
      });
      await bridge.userSettings.set("provider_selection_migration_v1" as never, null);
      return { conversationId: conversation.id };
    }, {
      conversationId: randomUUID(),
      userMessageId: randomUUID(),
      assistantMessageId: randomUUID(),
    });

    const legacyConfiguration = {
      type: "gpt",
      model: "gpt-4o",
      roleDefinition: "Preserved legacy role",
      historyBufferSize: 10,
      legacyProvenance: "imported-enjoyai-history",
    };
    await updateLegacyConversation(app.databasePath, fixture.conversationId, legacyConfiguration);
    await app.restart({ offline: true });
    page = app.page;
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });

    const migratedSetting = await page.evaluate(() =>
      window.__ENJOY_APP__.userSettings.get("gpt_engine" as never));
    expect(migratedSetting).toEqual({ name: "needs-selection", models: { default: "" } });

    const legacyBefore = await readLegacyRows(app.databasePath, fixture.conversationId);
    expect(legacyBefore.conversation).toHaveLength(1);
    expect(legacyBefore.messages).toHaveLength(2);
    const legacyRowDigest = digest(legacyBefore);
    const legacyMessageDigest = digest(legacyBefore.messages);
    const beforeNetwork = await captureProviderNetwork(page);

    const rejectedRebind = await page.evaluate(async id => {
      try {
        await window.__ENJOY_APP__.conversations.update(id, {
          name: "Rejected retired provider update",
          engine: "enjoyai",
          configuration: {
            type: "gpt",
            model: "gpt-4o",
            baseUrl: "https://api.enjoy.bot/v1",
          },
        });
        return { rejected: false, message: "" };
      } catch (error) {
        return {
          rejected: true,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }, fixture.conversationId);
    expect(rejectedRebind.rejected).toBe(true);
    expect(rejectedRebind.message).toContain("provider_selection_required");
    expect(digest(await readLegacyRows(app.databasePath, fixture.conversationId)))
      .toBe(legacyRowDigest);
    const expectedRejectedUpdateErrors = app.consumeExpectedRuntimeError(
      "Error occurred in handler for 'conversations-update': Error: provider_selection_required",
    );
    expect(expectedRejectedUpdateErrors).toBeGreaterThanOrEqual(1);

    await navigateTo(page, `/conversations/${fixture.conversationId}`);
    await expect(page.getByTestId("conversation-page")).toBeVisible();
    await expect(page.getByText("Historical learner question", { exact: true })).toBeVisible();
    await expect(page.getByText("Historical EnjoyAI answer", { exact: true })).toBeVisible();
    await expect(page.getByText("enjoyai", { exact: true })).toBeVisible();

    const blockedMessage = `Blocked legacy send ${randomUUID()}`;
    await page.getByTestId("conversation-page-input").fill(blockedMessage);
    await page.getByTestId("conversation-page-submit").click();
    const blockedBubble = page.getByText(blockedMessage, { exact: true })
      .locator("xpath=ancestor::div[starts-with(@id, 'message-')]");
    await expect(blockedBubble).toBeVisible();
    await expect(blockedBubble.locator(".text-ej-bad")).toBeVisible();
    await expect(blockedBubble.locator(".animate-spin")).toHaveCount(0);
    await expect.poll(async () =>
      (await readLegacyRows(app!.databasePath, fixture.conversationId)).messages.length,
    ).toBe(2);

    expect(await page.evaluate(() =>
      window.__ENJOY_APP__.userSettings.get("gpt_engine" as never)))
      .toEqual({ name: "needs-selection", models: { default: "" } });

    await page.getByRole("button", {
      name: /^(?:Thiết lập cuộc trò chuyện|Conversation settings)$/u,
    }).click();
    const form = page.getByTestId("conversation-form");
    await expect(form).toBeVisible();
    const providerSelect = form.locator('button[role="combobox"]').nth(0);
    await expect(providerSelect).toBeEnabled();
    await providerSelect.click();
    await page.getByRole("option", { name: "OpenAI", exact: true }).click();
    await form.locator('button[role="combobox"]').nth(1).click();
    await page.getByRole("option", { name: "gpt-4o-mini", exact: true }).click();
    await form.getByTestId("conversation-form-submit").click();

    await expect(form).toBeHidden();
    await expect(page.getByText("openai", { exact: true })).toBeVisible();
    await expect(page.getByRole("banner").getByText("gpt-4o-mini", { exact: true })).toBeVisible();
    const compatibleUpdate = await page.evaluate(id =>
      window.__ENJOY_APP__.conversations.update(id, {
        name: "Legacy EnjoyAI history",
        configuration: { type: "gpt", model: "gpt-4o-mini" },
      }), fixture.conversationId);
    expect(compatibleUpdate.engine).toBe("openai");
    const savedBinding = await page.evaluate(id =>
      window.__ENJOY_APP__.conversations.findOne({ id }), fixture.conversationId);
    expect(savedBinding.id).toBe(fixture.conversationId);
    expect(savedBinding.engine).toBe("openai");
    expect(savedBinding.configuration.model).toBe("gpt-4o-mini");
    expect(savedBinding.configuration).toMatchObject({
      type: "gpt",
      roleDefinition: legacyConfiguration.roleDefinition,
      historyBufferSize: legacyConfiguration.historyBufferSize,
      legacyProvenance: legacyConfiguration.legacyProvenance,
    });

    const legacyAfter = await readLegacyRows(app.databasePath, fixture.conversationId);
    expect(digest(legacyAfter.messages)).toBe(legacyMessageDigest);
    expect(legacyAfter.conversation[0]).toMatchObject({
      id: legacyBefore.conversation[0].id,
      name: legacyBefore.conversation[0].name,
      created_at: legacyBefore.conversation[0].created_at,
      engine: "openai",
    });
    const persistedConfiguration = JSON.parse(String(legacyAfter.conversation[0].configuration));
    expect(persistedConfiguration).toMatchObject({
      type: "gpt",
      model: "gpt-4o-mini",
      roleDefinition: legacyConfiguration.roleDefinition,
      historyBufferSize: legacyConfiguration.historyBufferSize,
      legacyProvenance: legacyConfiguration.legacyProvenance,
    });
    const afterNetwork = await captureProviderNetwork(page);
    expect(afterNetwork.main.legacyBackendOperationCount)
      .toBe(beforeNetwork.main.legacyBackendOperationCount);
    expect(afterNetwork.renderer.legacyBackendOperationCount)
      .toBe(beforeNetwork.renderer.legacyBackendOperationCount);

    app.assertNoRuntimeIssues();
    await writeReceipt(testInfo, "legacy-conversation-provider.json", {
      packaged: true,
      offline: true,
      legacyConversationId: fixture.conversationId,
      migratedDefaultBinding: migratedSetting,
      historyVisible: true,
      blockedSendNotPersisted: true,
      rejectedRetiredRebindUnchanged: true,
      expectedRejectedUpdateErrors,
      explicitRebinding: {
        conversationId: savedBinding.id,
        provider: savedBinding.engine,
        model: savedBinding.configuration.model,
      },
      legacyMessageDigestBefore: legacyMessageDigest,
      legacyMessageDigestAfter: digest(legacyAfter.messages),
      legacyHistoryUnchanged: true,
      legacyProvenancePreserved: true,
      retiredEnjoyNetworkCountersUnchanged: true,
      inferenceCalled: false,
      runtime: app.runtimeDiagnostics(),
    });
  } finally {
    await app?.close();
  }
});
