import { expect, test } from "@playwright/test";
import { launchIsolatedApp, MOCK_FIXTURE_LABEL, type IsolatedApp } from "./helpers/isolated-app";

declare global {
  interface Window {
    __ENJOY_APP__: any;
  }
}

let fixture: IsolatedApp | undefined;

test.beforeAll(async () => {
  fixture = await launchIsolatedApp();
  console.info(`[${MOCK_FIXTURE_LABEL}] Renderer fixture has no account or credential data`);
});

test.afterAll(async () => {
  await fixture?.close();
});

test.afterEach(() => {
  fixture?.assertNoRuntimeIssues();
});

// Playwright requires the first callback argument to use destructuring.
// eslint-disable-next-line no-empty-pattern
test("opens the packaged app without login", async ({}, testInfo) => {
  testInfo.annotations.push({
    type: "mock-fixture",
    description: MOCK_FIXTURE_LABEL,
  });

  const page = fixture!.page;
  await expect(page.getByText("Chào mừng đến với")).toBeVisible();
  await expect(page.getByRole("link", { name: "Mở từ điển offline" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bắt đầu" })).toBeVisible();
  await expect(page.evaluate(() => window.__ENJOY_APP__.appSettings.getUser())).resolves.toBeFalsy();
  await expect(page.evaluate(() => window.__ENJOY_APP__.app.apiUrl())).resolves.toBe(
    fixture!.mockHttpOrigin
  );
  await page.screenshot({ path: testInfo.outputPath("landing.png") });
});

// Playwright requires the first callback argument to use destructuring.
// eslint-disable-next-line no-empty-pattern
test("accepts a safe keydown before hotkeys are loaded", async ({}, testInfo) => {
  testInfo.annotations.push({
    type: "mock-fixture",
    description: MOCK_FIXTURE_LABEL,
  });

  const page = fixture!.page;
  await expect(page.getByText("Chào mừng đến với")).toBeVisible();
  await page.keyboard.press("Escape");
});
