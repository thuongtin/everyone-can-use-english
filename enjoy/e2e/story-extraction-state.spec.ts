/* eslint-disable no-empty-pattern -- Electron tests receive TestInfo without creating a browser fixture. */
import { expect, test, type Page } from "@playwright/test";

import {
  launchLocalApp,
  writeReceipt,
  type LocalApp,
} from "./helpers/local-app";
import { captureProviderNetwork } from "./helpers/provider-network";

const navigateTo = async (page: Page, path: string): Promise<void> => {
  await page.evaluate(nextPath => {
    window.location.hash = nextPath;
  }, path);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#${path}`);
};

test("an unconfigured provider leaves Story extraction idle and retryable after failure", async ({}, testInfo) => {
  test.setTimeout(120_000);
  let app: LocalApp | undefined;
  try {
    app = await launchLocalApp({ offline: true });
    const page = app.page;
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });

    const story = await page.evaluate(async () => {
      await window.__ENJOY_APP__.userSettings.set("gpt_engine" as never, {
        name: "needs-selection",
        models: { default: "" },
      });
      return window.__ENJOY_APP__.localStudy.stories.create({
        title: "Retryable vocabulary extraction",
        content: "Mina carries a thermos to the quiet station.",
        html: "<article><p>Mina carries a thermos to the quiet station.</p></article>",
        extracted: false,
        provenance: { source: "manual" },
      });
    });

    await page.reload();
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });
    await navigateTo(page, `/stories/${story.id}`);

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(".animate-spin")).toHaveCount(0);
    const extract = sheet.getByRole("button", {
      name: /^(?:Trích xuất từ vựng bằng AI|AI extract vocabulary)$/u,
    });
    await expect(extract).toBeVisible();
    const beforeNetwork = await captureProviderNetwork(page);

    await page.evaluate(() => {
      const target = window as typeof window & { __STORY_EXTRACTION_FAILURE_TOASTS__?: number };
      target.__STORY_EXTRACTION_FAILURE_TOASTS__ = 0;
      const seen = new WeakSet<Element>();
      const recordFailureToasts = () => {
        for (const toast of document.querySelectorAll("[data-sonner-toast]")) {
          if (seen.has(toast)) continue;
          seen.add(toast);
          if (/(?:Trích xuất không thành công|Extraction failed)/u.test(toast.textContent || "")) {
            target.__STORY_EXTRACTION_FAILURE_TOASTS__! += 1;
          }
        }
      };
      new MutationObserver(recordFailureToasts)
        .observe(document.body, { childList: true, subtree: true });
      recordFailureToasts();
    });

    await extract.click();
    const failure = sheet.getByText(
      /^(?:Trích xuất không thành công|Extraction failed)$/u,
      { exact: true },
    );
    await expect(failure).toBeVisible();
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & { __STORY_EXTRACTION_FAILURE_TOASTS__?: number })
        .__STORY_EXTRACTION_FAILURE_TOASTS__ || 0,
    )).toBe(1);
    const retry = sheet.getByRole("button", { name: /^(?:Thử lại|Retry)$/u });
    await expect(retry).toBeEnabled();
    const failureToastsBeforeRetry = await page.evaluate(() =>
      (window as typeof window & { __STORY_EXTRACTION_FAILURE_TOASTS__?: number })
        .__STORY_EXTRACTION_FAILURE_TOASTS__ || 0);
    await retry.click();
    await expect(failure).toBeVisible();
    await expect(retry).toBeEnabled();
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & { __STORY_EXTRACTION_FAILURE_TOASTS__?: number })
        .__STORY_EXTRACTION_FAILURE_TOASTS__ || 0,
    )).toBeGreaterThan(failureToastsBeforeRetry);
    await expect(sheet.locator('[data-testid="story-extraction-busy"]')).toHaveCount(0);

    const persisted = await page.evaluate(id =>
      window.__ENJOY_APP__.localStudy.stories.get(id), story.id);
    expect(persisted.extracted).toBe(false);
    expect(persisted.extraction).toBeUndefined();

    const afterNetwork = await captureProviderNetwork(page);
    expect(afterNetwork.main.legacyBackendOperationCount)
      .toBe(beforeNetwork.main.legacyBackendOperationCount);
    expect(afterNetwork.renderer.legacyBackendOperationCount)
      .toBe(beforeNetwork.renderer.legacyBackendOperationCount);

    app.assertNoRuntimeIssues();
    await writeReceipt(testInfo, "story-extraction-state.json", {
      packaged: true,
      offline: true,
      provider: "needs-selection",
      idleWithoutSpinner: true,
      failureIsGeneric: true,
      retryEnabled: true,
      persistedStoryUnchanged: true,
      retiredEnjoyNetworkCountersUnchanged: true,
      runtime: app.runtimeDiagnostics(),
    });
  } finally {
    await app?.close();
  }
});
