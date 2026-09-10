/* eslint-disable no-empty-pattern -- Electron owns the packaged fixture. */
import { expect, test } from "@playwright/test";
import { chmod, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { launchLocalApp, writeReceipt, type LocalApp } from "./helpers/local-app";

test("records sanitized packaged native provider status without inference", async ({}, testInfo) => {
  test.setTimeout(90_000);
  let app: LocalApp | undefined;
  let closeError: unknown;
  try {
    app = await launchLocalApp();
    await expect(app.page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });
    const statuses = await app.page.evaluate(() => window.__ENJOY_APP__.acp.status());
    const sanitized = statuses.map(({ provider, available, reason, models, currentModel }) => ({
      provider,
      available,
      reason,
      models: models.map(({ id, name }) => ({ id, name })),
      currentModel,
    }));
    expect(sanitized.map(({ provider }) => provider).sort()).toEqual(["claude", "codex"]);
    const receiptPath = await writeReceipt(testInfo, "native-provider-status.json", {
      scope: "Packaged acp.status metadata only; no inference or authentication mutation",
      statuses: sanitized,
      runtime: app.runtimeDiagnostics(),
    });
    if (process.env.ENJOY_NATIVE_STATUS_RECEIPT) {
      const stableReceipt = path.resolve(process.env.ENJOY_NATIVE_STATUS_RECEIPT);
      await mkdir(path.dirname(stableReceipt), { recursive: true });
      await copyFile(receiptPath, stableReceipt);
      await chmod(stableReceipt, 0o600);
    }
    app.assertNoRuntimeIssues();
  } finally {
    if (app) await app.close().catch(error => { closeError = error; });
  }
  if (closeError) throw closeError;
});
