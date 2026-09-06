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
  console.info(`[${MOCK_FIXTURE_LABEL}] Main-process fixture has no account or credential data`);
});

test.afterAll(async () => {
  await fixture?.close();
});

test.afterEach(() => {
  fixture?.assertNoRuntimeIssues();
});

// Playwright requires the first callback argument to use destructuring.
// eslint-disable-next-line no-empty-pattern
test("launches the packaged app with isolated settings and library paths", async ({}, testInfo) => {
  testInfo.annotations.push({
    type: "mock-fixture",
    description: MOCK_FIXTURE_LABEL,
  });

  const page = fixture!.page;
  await expect(page.getByText("Chào mừng đến với")).toBeVisible();
  await expect(page.evaluate(() => window.__ENJOY_APP__.app.isPackaged())).resolves.toBe(true);
  await expect(page.evaluate(() => window.__ENJOY_APP__.appSettings.getUser())).resolves.toBeFalsy();
  await expect(page.evaluate(() => window.__ENJOY_APP__.appSettings.getLibrary())).resolves.toBe(
    `${fixture!.directories.library}/EnjoyLibrary`
  );
});

test("runs the packaged ffmpeg command", async () => {
  const result = await fixture!.page.evaluate(() => window.__ENJOY_APP__.ffmpeg.check());
  expect(result).toBeTruthy();
});

test("creates the default library inside the isolated fixture", async () => {
  const library = await fixture!.page.evaluate(() => window.__ENJOY_APP__.appSettings.getLibrary());
  expect(library).toBe(`${fixture!.directories.library}/EnjoyLibrary`);
});

test.describe("native model checks", () => {
  test.skip(
    process.env.ENJOY_E2E_NATIVE !== "1",
    "Set ENJOY_E2E_NATIVE=1 to run the explicit native model suite"
  );

  test("validates echogarden recognition by whisper", async () => {
    const result = await fixture!.page.evaluate(() =>
      window.__ENJOY_APP__.echogarden.check({
        engine: "whisper",
        whisper: {
          model: "tiny.en",
          language: "en",
          encoderProvider: "cpu",
          decoderProvider: "cpu",
        },
      })
    );
    console.info(result.log);
    expect(result.success).toBeTruthy();
  });

  test("validates echogarden recognition by whisper.cpp", async () => {
    const result = await fixture!.page.evaluate(() =>
      window.__ENJOY_APP__.echogarden.check({
        engine: "whisper.cpp",
        whisperCpp: {
          model: "tiny.en",
          language: "en",
        },
      })
    );
    console.info(result.log);
    expect(result.success).toBeTruthy();
  });

  test("validates echogarden alignment", async () => {
    const result = await fixture!.page.evaluate(() => window.__ENJOY_APP__.echogarden.checkAlign());
    console.info(result.log);
    expect(result.success).toBeTruthy();
  });
});
