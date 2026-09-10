import { expect, test } from "@playwright/test";
import { launchIsolatedApp, MOCK_FIXTURE_LABEL, type IsolatedApp } from "./helpers/isolated-app";

declare global {
  interface Window {
    __ENJOY_APP__: any;
  }
}

test.describe.configure({ mode: "serial" });

let fixture: IsolatedApp | undefined;

const DICTIONARY_LINK = "Mở từ điển song ngữ (không cần hồ sơ)";

const openDictionary = async () => {
  const page = fixture!.page;
  await expect(page.getByRole("link", { name: DICTIONARY_LINK })).toBeVisible();
  await page.getByRole("link", { name: DICTIONARY_LINK }).click();
  await expect(page.getByTestId("bilingual-panel")).toBeVisible();
};

test.beforeAll(async () => {
  fixture = await launchIsolatedApp();
  console.info(`[${MOCK_FIXTURE_LABEL}] Offline dictionary fixture uses bundled SQLite and a local mock origin`);
});

test.afterAll(async () => {
  await fixture?.close();
});

test.afterEach(() => {
  fixture?.assertNoRuntimeIssues();
});

// Playwright requires the first callback argument to use destructuring.
// eslint-disable-next-line no-empty-pattern
test("looks up English and Vietnamese entries and persists direction after relaunch", async ({}, testInfo) => {
  testInfo.annotations.push({
    type: "mock-fixture",
    description: MOCK_FIXTURE_LABEL,
  });
  test.setTimeout(120000);

  const page = fixture!.page;
  await openDictionary();

  const enViTab = page.getByRole("tab", { name: "Anh - Việt" });
  const viEnTab = page.getByRole("tab", { name: "Việt - Anh" });
  const query = page.getByLabel("Từ hoặc cụm từ");
  const search = page.getByRole("button", { name: "Tra", exact: true });

  const englishEntries = await page.evaluate(() =>
    window.__ENJOY_APP__.bilingual.lookup("en-vi", "learn")
  );
  expect(englishEntries.length).toBeGreaterThan(0);
  expect(JSON.stringify(englishEntries)).toContain("Học");

  await enViTab.click();
  await query.fill("learn");
  await search.click();
  await expect(page.getByTestId("bilingual-result")).toContainText("learn");
  await expect(page.getByTestId("bilingual-result")).toContainText("Học");

  const vietnameseEntries = await page.evaluate(() =>
    window.__ENJOY_APP__.bilingual.lookup("vi-en", "học")
  );
  expect(vietnameseEntries.length).toBeGreaterThan(0);
  expect(JSON.stringify(vietnameseEntries)).toContain("to study; to learn");

  await viEnTab.click();
  await query.fill("học");
  await search.click();
  await expect(page.getByTestId("bilingual-result")).toContainText("học");
  await expect(page.getByTestId("bilingual-result")).toContainText("to study; to learn");
  await expect(viEnTab).toHaveAttribute("aria-selected", "true");

  await fixture!.restart();
  await openDictionary();
  const relaunchedPage = fixture!.page;
  await expect(
    relaunchedPage.getByRole("tab", { name: "Việt - Anh" })
  ).toHaveAttribute("aria-selected", "true");

  await relaunchedPage.getByLabel("Từ hoặc cụm từ").fill("học");
  await relaunchedPage.getByRole("button", { name: "Tra", exact: true }).click();
  await expect(relaunchedPage.getByTestId("bilingual-result")).toContainText("to study; to learn");
  await relaunchedPage.screenshot({ path: testInfo.outputPath("offline-dictionary.png") });
});
