/* eslint-disable no-empty-pattern -- Electron tests receive TestInfo without creating a browser fixture. */
import { expect, test } from "@playwright/test";
import type { Page } from "playwright";
import {
  launchLocalApp,
  queryLocalDatabase,
  writeReceipt,
  type LocalApp,
} from "./helpers/local-app";

test.describe.configure({ mode: "serial" });

let fixture: LocalApp | undefined;

const navigateTo = async (page: Page, path: string) => {
  await page.evaluate((nextPath) => {
    window.location.hash = nextPath;
  }, path);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#${path}`);
};

test.beforeAll(async () => {
  fixture = await launchLocalApp({ offline: true });
});

test.afterAll(async () => {
  await fixture?.close();
});

test.afterEach(async ({}, testInfo) => {
  if (fixture && testInfo.status !== testInfo.expectedStatus) {
    await fixture.page
      .screenshot({ path: testInfo.outputPath("local-study-failure.png"), fullPage: true })
      .catch(() => undefined);
  }
});

test("packaged Stories and Vocabulary persist locally across an offline restart", async ({}, testInfo) => {
  test.setTimeout(120_000);
  testInfo.annotations.push({
    type: "local-fixture",
    description:
      "Actual packaged preload and SQLite in an isolated profile; Story and provider lookup output are hand-authored fixtures",
  });

  let page = fixture!.page;
  await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });
  await navigateTo(page, "/stories");
  const seeded = await page.evaluate(async () => {
    const story = await window.__ENJOY_APP__.localStudy.stories.create({
      title: "Coffee at the quiet station",
      content:
        "Mina carries a thermos to the station. She shares coffee with a friend.",
      html:
        '<article><p>Mina shares coffee.</p><img src="https://storage.enjoy.bot/private-cover.png"></article>',
      url: "https://enjoy.bot/posts/coffee-at-the-station",
      metadata: {
        image: "https://storage.enjoy.bot/private-cover.png",
        favicon: "https://enjoy.bot/favicon.ico",
      },
      extraction: { words: ["coffee"], idioms: [] },
      extracted: true,
      provenance: { source: "file", sourceUrl: "file:///tmp/coffee-at-the-station.html" },
    });
    const meaning = await window.__ENJOY_APP__.localStudy.meanings.upsert({
      storyId: story.id,
      lookup: {
        word: "coffee",
        context: "She shares coffee with a friend.",
        contextTranslation: "Cô ấy chia sẻ cà phê với một người bạn.",
        status: "completed",
        meaning: {
          word: "coffee",
          lemma: "coffee",
          pronunciation: "ˈkɒfi",
          pos: "noun",
          definition: "A drink made from roasted beans.",
          translation: "cà phê",
        },
      },
    });
    return { storyId: story.id, meaningId: meaning.id };
  });

  await page.reload();
  await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });
  await navigateTo(page, "/stories");
  await expect(page.getByText("Coffee at the quiet station", { exact: true })).toBeVisible();
  await expect(page.locator('img[src*="enjoy.bot"]')).toHaveCount(0);
  await page.getByText("Coffee at the quiet station", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Coffee at the quiet station" })).toBeVisible();
  await expect(page.locator('img[src*="enjoy.bot"]')).toHaveCount(0);

  await navigateTo(page, "/vocabulary");
  await expect(page.getByTestId("vocabulary-page")).toBeVisible();
  await expect(page.getByText("coffee", { exact: true }).first()).toBeVisible();
  await page
    .getByRole("button", { name: /^(?:Đã nhớ · ôn sau 4 ngày|Known · review in 4 days)$/u })
    .click();
  await expect(page.getByText(/^(?:Đã nhớ|Known)$/u).first()).toBeVisible();

  const beforeRestart = await page.evaluate(async ({ storyId, meaningId }) => {
    const story = await window.__ENJOY_APP__.localStudy.stories.get(storyId);
    const meanings = await window.__ENJOY_APP__.localStudy.meanings.list({
      page: 1,
      items: 10,
      storyId,
    });
    return {
      story,
      meaning: meanings.meanings.find((item) => item.id === meaningId),
    };
  }, seeded);
  expect(beforeRestart.story.provenance.blockedResourceUrls).toEqual(
    expect.arrayContaining([
      "https://storage.enjoy.bot/private-cover.png",
      "https://enjoy.bot/favicon.ico",
    ]),
  );
  expect(beforeRestart.story.url).toBe("");
  expect(beforeRestart.story.provenance.sourceUrl).toBe("file:///tmp/coffee-at-the-station.html");
  expect(beforeRestart.story.provenance.blockedResourceUrls).toContain("https://enjoy.bot/posts/coffee-at-the-station");
  expect(beforeRestart.story.metadata.image).toBeUndefined();
  expect(beforeRestart.meaning?.review.status).toBe("known");
  expect(Date.parse(beforeRestart.meaning?.review.dueAt || "")).toBeGreaterThan(Date.now());

  const sqliteBeforeRestart = await queryLocalDatabase<{
    story_count: number;
    review_count: number;
  }>(fixture!.databasePath, `
    SELECT
      (SELECT count(*) FROM local_stories WHERE id = ?) AS story_count,
      (SELECT count(*) FROM local_reviews WHERE meaning_id = ? AND status = 'known') AS review_count
  `, [seeded.storyId, seeded.meaningId]);
  expect(sqliteBeforeRestart).toEqual([{ story_count: 1, review_count: 1 }]);

  await fixture!.restart({ offline: true });
  page = fixture!.page;
  await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });
  await navigateTo(page, "/stories");
  await expect(page.getByText("Coffee at the quiet station", { exact: true })).toBeVisible();
  await navigateTo(page, "/vocabulary");
  await expect(page.getByTestId("vocabulary-page")).toBeVisible();
  await expect(page.getByText(/^(?:Đã nhớ|Known)$/u).first()).toBeVisible();

  await navigateTo(page, "/stories");
  await page.getByText("Coffee at the quiet station", { exact: true }).click();
  await page.getByTitle(/^(?:Xóa|Delete)$/u).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: /^(?:Xóa|Delete)$/u }).click();
  await expect(page.getByText("Coffee at the quiet station", { exact: true })).toHaveCount(0);

  const afterDelete = await page.evaluate(async () => {
    const [stories, meanings] = await Promise.all([
      window.__ENJOY_APP__.localStudy.stories.list({ page: 1, items: 10 }),
      window.__ENJOY_APP__.localStudy.meanings.list({ page: 1, items: 10 }),
    ]);
    return { stories: stories.stories.length, meanings: meanings.meanings.length };
  });
  expect(afterDelete).toEqual({ stories: 0, meanings: 0 });

  fixture!.assertNoRuntimeIssues();
  await writeReceipt(testInfo, "local-stories-vocabulary.json", {
    packaged: true,
    isolatedProfile: true,
    offlineRestart: true,
    sqlitePersistence: true,
    retiredResourceBlockedFromRender: true,
    reviewPersisted: true,
    orphanMeaningDeleted: true,
  });
});
