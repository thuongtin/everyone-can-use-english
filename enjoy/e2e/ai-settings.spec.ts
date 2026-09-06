import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  launchIsolatedApp,
  MOCK_FIXTURE_LABEL,
  type IsolatedApp,
} from "./helpers/isolated-app";

declare global {
  interface Window {
    __ENJOY_APP__: any;
  }
}

const FAKE_USER = {
  id: 90817263,
  name: "AI settings E2E user",
};
const FAKE_PROFILE = {
  ...FAKE_USER,
  accessToken: null,
};
const OPENAI_KEY = "e2e-openai-key";
const GEMINI_KEY = "e2e-gemini-key";
const GEMINI_MODEL = "gemini-3.8-flash";
const OPENAI_DEFAULT_MODEL = "gpt-5.6-luna";
const NEW_TTS_MODEL = "gpt-4o-mini-tts";
const screenshotDirectory =
  process.env.ENJOY_E2E_SCREENSHOT_DIR ||
  (process.env.ENJOY_E2E_OUTPUT_DIR
    ? `${process.env.ENJOY_E2E_OUTPUT_DIR}-screenshots`
    : undefined);

test.describe.configure({ mode: "serial" });

let fixture: IsolatedApp | undefined;

const seedFakeAccount = async (app: IsolatedApp) => {
  await app.page.evaluate(async (user) => {
    await window.__ENJOY_APP__.appSettings.setUser(user);
  }, FAKE_USER);

  await app.restart();

  await expect
    .poll(
      () => app.page.evaluate(() => window.__ENJOY_APP__.appSettings.getUser()),
      { timeout: 30000 }
    )
    .toMatchObject(FAKE_USER);

  await expect
    .poll(
      () =>
        app.page.evaluate(async (profile) => {
          try {
            const connection = await window.__ENJOY_APP__.db.connect();
            if (connection?.state !== "connected") return false;
            await window.__ENJOY_APP__.userSettings.set("profile", profile);
            return true;
          } catch {
            return false;
          }
        }, FAKE_PROFILE),
      { timeout: 30000 }
    )
    .toBe(true);

  await expect
    .poll(
      () => app.page.evaluate(() => window.__ENJOY_APP__.userSettings.get("profile")),
      { timeout: 30000 }
    )
    .toMatchObject(FAKE_PROFILE);
  await expect(app.page.getByTestId("layout-home")).toBeVisible({ timeout: 30000 });
};

const openPreferences = async (page: IsolatedApp["page"]) => {
  const preferencesButton = page
    .getByRole("button", { name: /Cài đặt|Preferences/i })
    .first();
  await expect(preferencesButton).toBeVisible();
  await preferencesButton.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
};

const selectPreferencesTab = async (
  dialog: ReturnType<IsolatedApp["page"]["getByRole"]>,
  name: RegExp
) => {
  const tab = dialog.getByRole("button", { name }).first();
  await expect(tab).toBeVisible();
  await tab.click();
};

const closePreferences = async (page: IsolatedApp["page"]) => {
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
};

const providerFormFor = (dialog: any) =>
  dialog.getByRole("combobox").first().locator("xpath=ancestor::form[1]");

const providerSelectFor = (form: any) => form.getByRole("combobox").first();

const chooseOption = async (page: IsolatedApp["page"], name: string) => {
  const option = page.getByRole("option", { name, exact: true });
  await expect(option).toBeVisible();
  await option.click();
};

const chooseProvider = async (
  page: IsolatedApp["page"],
  form: any,
  providerName: string
) => {
  const providerSelect = providerSelectFor(form);
  if (await providerSelect.isDisabled()) {
    const cancelButton = form
      .getByRole("button", { name: /^Hủy$|^Cancel$/i })
      .first();
    await expect(cancelButton).toBeVisible();
    await cancelButton.click();
  }
  await providerSelect.click();
  await chooseOption(page, providerName);
};

const keyInputFor = async (form: any) => {
  const labeledInput = form.getByLabel(/API key|key/i).first();
  if (await labeledInput.count()) return labeledInput;

  const passwordInput = form.locator('input[type="password"]').first();
  await expect(passwordInput).toBeVisible();
  return passwordInput;
};

const enterEditMode = async (form: any) => {
  const editButton = form
    .getByRole("button", { name: /^Chỉnh sửa$|^Edit$/i })
    .first();
  if (await editButton.count()) await editButton.click();
};

const saveForm = async (form: any) => {
  const saveButton = form
    .getByRole("button", { name: /^Lưu$|^Save$/i })
    .first();
  await expect(saveButton).toBeVisible();
  await saveButton.click();
};

const readUserSettings = async (page: IsolatedApp["page"]) =>
  page.evaluate(async () => ({
    openai: await window.__ENJOY_APP__.userSettings.get("openai"),
    gemini: await window.__ENJOY_APP__.userSettings.get("gemini"),
    sttEngine: await window.__ENJOY_APP__.userSettings.get("stt_engine"),
    gptEngine: await window.__ENJOY_APP__.userSettings.get("gpt_engine"),
    ttsConfig: await window.__ENJOY_APP__.userSettings.get("tts_config"),
  }));

const captureScreenshot = async (page: IsolatedApp["page"], filename: string) => {
  if (!screenshotDirectory) return;
  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: path.join(screenshotDirectory, filename),
    animations: "disabled",
  });
};

const seedLegacyOpenAiBootstrap = async (app: IsolatedApp) => {
  await expect
    .poll(
      () =>
        app.page.evaluate(async (config) => {
          try {
            const connection = await window.__ENJOY_APP__.db.connect();
            if (connection?.state !== "connected") return false;
            await window.__ENJOY_APP__.userSettings.set("openai", config);
            return true;
          } catch {
            return false;
          }
        }, { name: "openai", key: OPENAI_KEY, models: "" }),
      { timeout: 30000 }
    )
    .toBe(true);

  await expect
    .poll(() => readUserSettings(app.page))
    .toMatchObject({
      openai: { name: "openai", key: OPENAI_KEY },
      gptEngine: null,
    });

  await app.restart();
  const page = app.page;
  await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30000 });
  await expect
    .poll(() => readUserSettings(page), { timeout: 30000 })
    .toMatchObject({
      openai: { name: "openai", key: OPENAI_KEY },
      gptEngine: { name: "openai" },
    });

  const dialog = await openPreferences(page);
  await selectPreferencesTab(dialog, /Cơ bản|Basic/i);
  const defaultTitle = dialog.getByText(/Dịch vụ AI mặc định|Default AI engine/i).first();
  const defaultForm = defaultTitle.locator("xpath=ancestor::form[1]");
  await expect(defaultForm.getByRole("combobox").nth(0)).toContainText("OpenAI");
  await closePreferences(page);
};

test.beforeAll(async () => {
  fixture = await launchIsolatedApp();
  await seedFakeAccount(fixture);
  await seedLegacyOpenAiBootstrap(fixture);
  console.info(
    `[${MOCK_FIXTURE_LABEL}] AI settings fixture uses a fake account, isolated SQLite settings, and loopback-only mock transport`
  );
});

test.afterEach(() => {
  fixture?.assertNoRuntimeIssues();
});

test.afterAll(async () => {
  await fixture?.close();
});

// Playwright requires the first callback argument to use destructuring.
// eslint-disable-next-line no-empty-pattern
test("keeps provider keys isolated across the provider settings form", async ({}, testInfo) => {
  testInfo.annotations.push({
    type: "mock-fixture",
    description: MOCK_FIXTURE_LABEL,
  });

  const page = fixture!.page;
  const dialog = await openPreferences(page);
  await selectPreferencesTab(dialog, /Nâng cao|Advanced/i);

  const providerForm = providerFormFor(dialog);
  await expect(providerSelectFor(providerForm)).toBeVisible();

  await providerSelectFor(providerForm).click();
  for (const providerName of [
    "EnjoyAI",
    "OpenAI",
    "Gemini",
    "DeepSeek",
    "OpenRouter",
    "Ollama",
    "LM Studio",
  ]) {
    await expect(page.getByRole("option", { name: providerName, exact: true })).toBeVisible();
  }
  await captureScreenshot(page, "ai-provider-options.png");
  await page.keyboard.press("Escape");

  await chooseProvider(page, providerForm, "OpenAI");
  await enterEditMode(providerForm);
  const openAiKey = await keyInputFor(providerForm);
  await openAiKey.fill(OPENAI_KEY);
  await captureScreenshot(page, "ai-provider-openai-settings.png");
  await saveForm(providerForm);

  await expect
    .poll(() => readUserSettings(page))
    .toMatchObject({ openai: { name: "openai", key: OPENAI_KEY } });

  await chooseProvider(page, providerForm, "Gemini");
  await enterEditMode(providerForm);
  const geminiKey = await keyInputFor(providerForm);
  await expect(geminiKey).toHaveValue("");
  await geminiKey.fill(GEMINI_KEY);
  await saveForm(providerForm);

  await expect
    .poll(() => readUserSettings(page))
    .toMatchObject({
      openai: { name: "openai", key: OPENAI_KEY },
      gemini: { name: "gemini", key: GEMINI_KEY },
    });

  await chooseProvider(page, providerForm, "OpenAI");
  await enterEditMode(providerForm);
  await expect(await keyInputFor(providerForm)).toHaveValue(OPENAI_KEY);
  await chooseProvider(page, providerForm, "Gemini");
  await enterEditMode(providerForm);
  await expect(await keyInputFor(providerForm)).toHaveValue(GEMINI_KEY);

  await closePreferences(page);
  const reopenedDialog = await openPreferences(page);
  await selectPreferencesTab(reopenedDialog, /Nâng cao|Advanced/i);
  const reopenedProviderForm = providerFormFor(reopenedDialog);
  await chooseProvider(page, reopenedProviderForm, "OpenAI");
  await enterEditMode(reopenedProviderForm);
  await expect(await keyInputFor(reopenedProviderForm)).toHaveValue(OPENAI_KEY);
  await chooseProvider(page, reopenedProviderForm, "Gemini");
  await enterEditMode(reopenedProviderForm);
  await expect(await keyInputFor(reopenedProviderForm)).toHaveValue(GEMINI_KEY);

  await closePreferences(page);
});

// Playwright requires the first callback argument to use destructuring.
// eslint-disable-next-line no-empty-pattern
test("persists provider default, OpenAI TTS, and transcription models", async ({}, testInfo) => {
  testInfo.annotations.push({
    type: "mock-fixture",
    description: MOCK_FIXTURE_LABEL,
  });

  const page = fixture!.page;
  const dialog = await openPreferences(page);
  await selectPreferencesTab(dialog, /Cơ bản|Basic/i);

  const defaultTitle = dialog.getByText(/Dịch vụ AI mặc định|Default AI engine/i).first();
  const defaultForm = defaultTitle.locator("xpath=ancestor::form[1]");
  await enterEditMode(defaultForm);

  const defaultSelects = defaultForm.getByRole("combobox");
  await defaultSelects.nth(0).click();
  await chooseOption(page, "Gemini");
  await defaultSelects.nth(1).click();
  await expect(page.getByRole("option", { name: GEMINI_MODEL, exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: OPENAI_DEFAULT_MODEL, exact: true })).toHaveCount(0);
  await captureScreenshot(page, "ai-default-gemini-model-options.png");
  await chooseOption(page, GEMINI_MODEL);

  await defaultSelects.nth(0).click();
  await chooseOption(page, "OpenAI");
  await defaultSelects.nth(1).click();
  await expect(page.getByRole("option", { name: OPENAI_DEFAULT_MODEL, exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: GEMINI_MODEL, exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await defaultSelects.nth(0).click();
  await chooseOption(page, "Gemini");
  await defaultSelects.nth(1).click();
  await chooseOption(page, GEMINI_MODEL);
  await saveForm(defaultForm);

  await expect
    .poll(() => readUserSettings(page))
    .toMatchObject({ gptEngine: { name: "gemini", models: { default: GEMINI_MODEL } } });

  const ttsTitle = dialog
    .getByText(/Dịch vụ chuyển văn bản thành giọng nói|Text to Speech Service/i)
    .first();
  const ttsForm = ttsTitle.locator("xpath=ancestor::form[1]");
  await enterEditMode(ttsForm);

  const ttsSelects = ttsForm.getByRole("combobox");
  await ttsSelects.nth(0).click();
  await chooseOption(page, "OpenAI");
  await ttsSelects.nth(1).click();
  await expect(page.getByRole("option", { name: NEW_TTS_MODEL, exact: true })).toBeVisible();
  await captureScreenshot(page, "ai-tts-openai-model-options.png");
  await chooseOption(page, NEW_TTS_MODEL);
  await captureScreenshot(page, "ai-tts-openai-settings.png");
  await saveForm(ttsForm);

  await expect
    .poll(() => readUserSettings(page))
    .toMatchObject({
      gptEngine: { name: "gemini", models: { default: GEMINI_MODEL } },
      ttsConfig: { engine: "openai", model: NEW_TTS_MODEL },
    });

  const sttTitle = dialog.getByText(/Dịch vụ AI chép lời|STT AI service/i).first();
  const sttSection = sttTitle.locator(
    "xpath=ancestor::div[contains(@class,'items-start')][1]"
  );
  const sttEngineSelect = sttSection.getByRole("combobox").last();
  await sttEngineSelect.click();
  await chooseOption(page, "OpenAI");
  const transcriptionModelRow = dialog
    .getByText(/Mô hình chép lời OpenAI|OpenAI transcription model/i)
    .first()
    .locator("xpath=ancestor::div[contains(@class,'items-center')][1]");
  const transcriptionModelSelect = transcriptionModelRow.getByRole("combobox");
  await expect(transcriptionModelSelect).toBeVisible();
  await transcriptionModelSelect.click();
  await captureScreenshot(page, "ai-stt-openai-model-options.png");
  console.info(
    `[${MOCK_FIXTURE_LABEL}] STT model options: ${(await page.getByRole("option").allTextContents()).join(", ")}`
  );
  await chooseOption(page, "gpt-transcribe");
  await expect
    .poll(() => readUserSettings(page))
    .toMatchObject({
      openai: {
        name: "openai",
        key: OPENAI_KEY,
        transcriptionModel: "gpt-transcribe",
      },
      gptEngine: { name: "gemini", models: { default: GEMINI_MODEL } },
      ttsConfig: { engine: "openai", model: NEW_TTS_MODEL },
    });

  await closePreferences(page);
  const reopenedDialog = await openPreferences(page);
  await selectPreferencesTab(reopenedDialog, /Cơ bản|Basic/i);
  const reopenedTtsTitle = reopenedDialog
    .getByText(/Dịch vụ chuyển văn bản thành giọng nói|Text to Speech Service/i)
    .first();
  const reopenedTtsForm = reopenedTtsTitle.locator("xpath=ancestor::form[1]");
  await enterEditMode(reopenedTtsForm);
  await expect(reopenedTtsForm.getByRole("combobox").nth(1)).toContainText(NEW_TTS_MODEL);
  await closePreferences(page);

  await fixture!.restart();
  const relaunchedPage = fixture!.page;
  await expect(relaunchedPage.getByTestId("layout-home")).toBeVisible({
    timeout: 30000,
  });
  await expect
    .poll(() => readUserSettings(relaunchedPage), { timeout: 30000 })
    .toMatchObject({
      openai: { name: "openai", key: OPENAI_KEY },
      gemini: { name: "gemini", key: GEMINI_KEY },
      sttEngine: "openai",
      gptEngine: { name: "gemini", models: { default: GEMINI_MODEL } },
      ttsConfig: { engine: "openai", model: NEW_TTS_MODEL },
    });

  const relaunchedAdvancedDialog = await openPreferences(relaunchedPage);
  await selectPreferencesTab(relaunchedAdvancedDialog, /Nâng cao|Advanced/i);
  const relaunchedProviderForm = providerFormFor(relaunchedAdvancedDialog);
  await chooseProvider(relaunchedPage, relaunchedProviderForm, "OpenAI");
  await enterEditMode(relaunchedProviderForm);
  await expect(await keyInputFor(relaunchedProviderForm)).toHaveValue(OPENAI_KEY);
  await chooseProvider(relaunchedPage, relaunchedProviderForm, "Gemini");
  await enterEditMode(relaunchedProviderForm);
  await expect(await keyInputFor(relaunchedProviderForm)).toHaveValue(GEMINI_KEY);
  await closePreferences(relaunchedPage);

  const relaunchedBasicDialog = await openPreferences(relaunchedPage);
  await selectPreferencesTab(relaunchedBasicDialog, /Cơ bản|Basic/i);
  const relaunchedDefaultTitle = relaunchedBasicDialog
    .getByText(/Dịch vụ AI mặc định|Default AI engine/i)
    .first();
  const relaunchedDefaultForm = relaunchedDefaultTitle.locator("xpath=ancestor::form[1]");
  await expect(relaunchedDefaultForm.getByRole("combobox").nth(0)).toContainText("Gemini");
  await expect(relaunchedDefaultForm.getByRole("combobox").nth(1)).toContainText(GEMINI_MODEL);

  const relaunchedSttTitle = relaunchedBasicDialog
    .getByText(/Dịch vụ AI chép lời|STT AI service/i)
    .first();
  const relaunchedSttSection = relaunchedSttTitle.locator(
    "xpath=ancestor::div[contains(@class,'items-start')][1]"
  );
  await expect(relaunchedSttSection.getByRole("combobox").last()).toContainText("OpenAI");
  const relaunchedTranscriptionModelRow = relaunchedBasicDialog
    .getByText(/Mô hình chép lời OpenAI|OpenAI transcription model/i)
    .first()
    .locator("xpath=ancestor::div[contains(@class,'items-center')][1]");
  await expect(relaunchedTranscriptionModelRow.getByRole("combobox")).toContainText(
    "gpt-transcribe"
  );

  const relaunchedTtsTitle = relaunchedBasicDialog
    .getByText(/Dịch vụ chuyển văn bản thành giọng nói|Text to Speech Service/i)
    .first();
  const relaunchedTtsForm = relaunchedTtsTitle.locator("xpath=ancestor::form[1]");
  await enterEditMode(relaunchedTtsForm);
  await expect(relaunchedTtsForm.getByRole("combobox").nth(0)).toContainText("OpenAI");
  await expect(relaunchedTtsForm.getByRole("combobox").nth(1)).toContainText(NEW_TTS_MODEL);
  await closePreferences(relaunchedPage);
});
