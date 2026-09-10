/* eslint-disable no-empty-pattern -- Electron bootstrap has no browser fixture. */
import { expect, test } from "@playwright/test";
import { launchLocalApp, writeReceipt } from "./helpers/local-app";

test.skip(process.env.ENJOY_RUN_ACP_ACCEPTANCE !== "1", "Explicit packaged acceptance required");
test("local packaged bootstrap and offline restart", async ({}, info) => {
  test.setTimeout(90_000);
  const app = await launchLocalApp();
  try {
    await expect(app.page.getByTestId("layout-home")).toBeVisible();
    await expect(app.page.getByRole("button", { name: "Hiển thị đề xuất trực tuyến", exact: true })).toBeVisible();
    await app.page.waitForTimeout(8_000);
    app.assertNoRuntimeIssues();
    expect(await app.electronApp.evaluate(({ webContents }) => webContents.getAllWebContents()
      .filter(contents => /^https?:\/\//u.test(contents.getURL())).length)).toBe(0);
    await app.restart({ offline: true });
    await expect(app.page.getByTestId("layout-home")).toBeVisible();
    await expect(app.page.getByRole("button", { name: "Hiển thị đề xuất trực tuyến", exact: true })).toBeVisible();
    await app.page.waitForTimeout(8_000);
    app.assertNoRuntimeIssues();
    await writeReceipt(info, "bootstrap.json", { online: true, offlineRestart: true, automaticRemoteSuggestions: false });
  } finally {
    await writeReceipt(info, "runtime-diagnostics.json", app.runtimeDiagnostics());
    await app.close();
  }
});
