/* eslint-disable no-empty-pattern -- Electron tests do not use Playwright's browser fixture. */
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { captureProviderNetwork } from "./helpers/provider-network";

import type { AcpConnectionStatus, AcpProvider, AcpTextUpdate } from "../src/types/acp-api";
import type { LessonBrief, LessonDraft } from "../src/types/learning";
import { backupLocalDatabase, launchLocalApp, queryLocalDatabase, sanitizeLocalDiagnostic, writeReceipt, type LocalApp } from "./helpers/local-app";

test.skip(
  process.env.ENJOY_RUN_ACP_ACCEPTANCE !== "1",
  "Explicit packaged ACP acceptance is required because these tests use existing local CLI subscriptions",
);
test.describe.configure({ mode: "serial", retries: 0 });

type JobRow = {
  id: string;
  resource_id: string;
  revision_id: string;
  request_key: string;
  state: string;
  created_at: string;
  updated_at: string;
};

type StageRow = {
  id: string;
  job_id: string;
  key: string;
  kind: string;
  state: string;
  expected_revision_id: string;
  committed_hash: string | null;
};

type AttemptRow = {
  id: string;
  stage_id: string;
  ordinal: number;
  state: string;
  provider: string;
  error_code: string | null;
  started_at: string;
  finished_at: string | null;
};

type StreamReceipt = {
  requestIds: string[];
  total: number;
  started: number;
  text: number;
  completed: number;
  textCharacters: number;
};

type SelectedModel = {
  model: string | null;
  catalogCount: number;
  currentModel: string | null;
};

type LessonReceipt = Awaited<ReturnType<typeof getLesson>>;

const providerUiName = (provider: AcpProvider): string =>
  provider === "codex" ? "Codex" : "Claude Code";

const suggestionUiName = (provider: AcpProvider): string =>
  provider === "codex" ? "Codex" : "Claude ACP";

const pause = (milliseconds: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

async function openStudio(page: Page): Promise<void> {
  await expect.poll(
    () => page.evaluate(() => window.__ENJOY_APP__.appSettings.getUser()),
    { timeout: 30_000 },
  ).toMatchObject({ id: "local" });
  await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("sidebar-learning-studio").click();
  await expect(page.getByTestId("learning-studio")).toBeVisible({ timeout: 30_000 });
}

async function requireProvider(page: Page, provider: AcpProvider): Promise<AcpConnectionStatus> {
  const statuses = await page.evaluate(() => window.__ENJOY_APP__.acp.status());
  const status = statuses.find(candidate => candidate.provider === provider);
  expect(status, `${provider} ACP status must be present`).toBeTruthy();
  expect(status?.available, `${provider} ACP must use an existing authenticated CLI session`).toBe(true);
  return status as AcpConnectionStatus;
}

async function selectDiscoveredModel(page: Page, provider: AcpProvider): Promise<SelectedModel> {
  return page.evaluate(async selectedProvider => {
    const statuses = await window.__ENJOY_APP__.acp.status();
    const status = statuses.find(candidate => candidate.provider === selectedProvider);
    if (!status?.available) throw new Error(`${selectedProvider}_acp_unavailable`);
    const model = status.models.some(candidate => candidate.id === status.currentModel)
      ? status.currentModel
      : status.models[0]?.id ?? null;
    if (model) {
      const providerKey = selectedProvider === "codex" ? "codex_acp" : "claude_acp";
      const providerName = `${selectedProvider}-acp`;
      const existing = await window.__ENJOY_APP__.userSettings.get(providerKey as never);
      await window.__ENJOY_APP__.userSettings.set(providerKey as never, {
        ...(existing && typeof existing === "object" ? existing : {}),
        name: providerName,
        model,
      });
      await window.__ENJOY_APP__.userSettings.set("gpt_engine" as never, {
        name: providerName,
        models: { default: model },
      });
      const selected = await window.__ENJOY_APP__.userSettings.get("gpt_engine" as never);
      if (selected?.name !== providerName || selected?.models?.default !== model) {
        throw new Error("selected_model_not_persisted");
      }
    }
    return { model, catalogCount: status.models.length, currentModel: status.currentModel };
  }, provider);
}

async function beginStreamCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    type CaptureWindow = Window & typeof globalThis & {
      __ENJOY_ACP_UPDATES__?: Array<Pick<AcpTextUpdate, "requestId" | "type"> & { textLength: number }>;
      __ENJOY_STOP_ACP_UPDATES__?: () => void;
    };
    const target = window as CaptureWindow;
    target.__ENJOY_STOP_ACP_UPDATES__?.();
    target.__ENJOY_ACP_UPDATES__ = [];
    target.__ENJOY_STOP_ACP_UPDATES__ = window.__ENJOY_APP__.acp.onUpdate(update => {
      target.__ENJOY_ACP_UPDATES__?.push({
        requestId: update.requestId,
        type: update.type,
        textLength: update.text?.length ?? 0,
      });
    });
  });
}

async function finishStreamCapture(page: Page): Promise<StreamReceipt> {
  return page.evaluate(() => {
    type CapturedUpdate = Pick<AcpTextUpdate, "requestId" | "type"> & { textLength: number };
    type CaptureWindow = Window & typeof globalThis & {
      __ENJOY_ACP_UPDATES__?: CapturedUpdate[];
      __ENJOY_STOP_ACP_UPDATES__?: () => void;
    };
    const target = window as CaptureWindow;
    target.__ENJOY_STOP_ACP_UPDATES__?.();
    target.__ENJOY_STOP_ACP_UPDATES__ = undefined;
    const updates = target.__ENJOY_ACP_UPDATES__ ?? [];
    return {
      requestIds: [...new Set(updates.map(update => update.requestId))],
      total: updates.length,
      started: updates.filter(update => update.type === "started").length,
      text: updates.filter(update => update.type === "text").length,
      completed: updates.filter(update => update.type === "completed").length,
      textCharacters: updates.reduce((total, update) => total + update.textLength, 0),
    };
  });
}

async function waitForFirstStreamText(page: Page, timeoutMs = 120_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const requestId = await page.evaluate(() => {
      type CaptureWindow = Window & typeof globalThis & {
        __ENJOY_ACP_UPDATES__?: Array<Pick<AcpTextUpdate, "requestId" | "type"> & { textLength: number }>;
      };
      return (window as CaptureWindow).__ENJOY_ACP_UPDATES__
        ?.find(update => update.type === "text" && update.textLength > 0)?.requestId ?? null;
    });
    if (requestId) return requestId;
    await pause(50);
  }
  throw new Error("Timed out waiting for the first ACP suggestion text update");
}

async function getLesson(page: Page, id: string) {
  return page.evaluate(async lessonId => {
    const bridge = window.__ENJOY_APP__.learning;
    const context = await bridge.getContext();
    return bridge.request(context, "getLesson", { id: lessonId });
  }, id);
}

async function newestCreatedLessonId(page: Page, previousIds: readonly string[]): Promise<string> {
  return page.evaluate(async knownIds => {
    const bridge = window.__ENJOY_APP__.learning;
    const context = await bridge.getContext();
    const library = await bridge.request(context, "list", {});
    const created = library.lessons.filter(lesson => !knownIds.includes(lesson.id));
    if (created.length !== 1) throw new Error(`expected_one_created_lesson_found_${created.length}`);
    return created[0].id;
  }, [...previousIds]);
}

async function waitForCompletedJob(fixture: LocalApp, lessonId: string, timeoutMs = 720_000): Promise<JobRow> {
  const deadline = Date.now() + timeoutMs;
  let lastState = "missing";
  while (Date.now() < deadline) {
    try {
      const [job] = await queryLocalDatabase<JobRow>(fixture.databasePath, `
        SELECT id, resource_id, revision_id, request_key, state, created_at, updated_at
        FROM generation_jobs
        WHERE resource_type = 'lesson' AND resource_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `, [lessonId]);
      if (job) {
        lastState = job.state;
        if (job.state === "completed") return job;
        if (["failed", "interrupted", "cancelled"].includes(job.state)) {
          const attempts = await queryLocalDatabase<AttemptRow>(fixture.databasePath, `
            SELECT a.id, a.stage_id, a.ordinal, a.state, a.provider, a.error_code, a.started_at, a.finished_at
            FROM stage_attempts a
            INNER JOIN generation_stages s ON s.id = a.stage_id
            WHERE s.job_id = ?
            ORDER BY a.started_at ASC
          `, [job.id]);
          throw new Error(`ACP generation ended as ${job.state}: ${attempts.map(attempt => attempt.error_code).filter(Boolean).join(",") || "no_error_code"}`);
        }
      }
    } catch (error) {
      if (!(error instanceof Error) || !/SQLITE_BUSY|SQLITE_LOCKED/iu.test(error.message)) throw error;
    }
    await pause(2_000);
  }
  throw new Error(`Timed out waiting for ACP generation; last SQLite state was ${lastState}`);
}

async function sanitizedSqliteReceipt(fixture: LocalApp, job: JobRow) {
  const stages = await queryLocalDatabase<StageRow>(fixture.databasePath, `
    SELECT id, job_id, key, kind, state, expected_revision_id, committed_hash
    FROM generation_stages
    WHERE job_id = ?
    ORDER BY created_at ASC
  `, [job.id]);
  const attempts = await queryLocalDatabase<AttemptRow>(fixture.databasePath, `
    SELECT a.id, a.stage_id, a.ordinal, a.state, a.provider, a.error_code, a.started_at, a.finished_at
    FROM stage_attempts a
    INNER JOIN generation_stages s ON s.id = a.stage_id
    WHERE s.job_id = ?
    ORDER BY a.started_at ASC
  `, [job.id]);
  return {
    job: {
      id: job.id,
      resourceId: job.resource_id,
      revisionId: job.revision_id,
      requestKey: job.request_key,
      state: job.state,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    },
    stages: stages.map(stage => ({
      id: stage.id,
      key: stage.key,
      kind: stage.kind,
      state: stage.state,
      expectedRevisionId: stage.expected_revision_id,
      committedHash: stage.committed_hash,
    })),
    attempts: attempts.map(attempt => ({
      id: attempt.id,
      stageId: attempt.stage_id,
      ordinal: attempt.ordinal,
      state: attempt.state,
      provider: attempt.provider,
      errorCode: attempt.error_code,
      startedAt: attempt.started_at,
      finishedAt: attempt.finished_at,
    })),
  };
}

function sanitizedLessonReceipt(bundle: LessonReceipt) {
  return {
    lesson: {
      id: bundle.lesson.id,
      profileId: bundle.lesson.profileId,
      title: bundle.lesson.title,
      activeRevisionId: bundle.lesson.activeRevisionId,
    },
    revisions: bundle.revisions.map(revision => ({
      id: revision.id,
      number: revision.number,
      status: revision.status,
      brief: revision.brief,
      content: revision.content,
      validation: revision.validation,
      sourceHash: revision.sourceHash,
    })),
  };
}

async function exerciseFillQuestion(page: Page, content: LessonDraft): Promise<void> {
  const fill = content.exercises.find(exercise => exercise.kind === "fill");
  if (!fill || fill.kind !== "fill" || !fill.acceptedAnswers[0]) {
    throw new Error("generated_lesson_missing_fill_exercise");
  }
  let wrongAnswer = "definitely-not-the-generated-answer";
  while (fill.acceptedAnswers.some(answer => answer.trim().toLocaleLowerCase("en") === wrongAnswer.toLocaleLowerCase("en"))) {
    wrongAnswer += "-wrong";
  }
  await page.getByTestId(`practice-fill-input-${fill.id}`).fill(wrongAnswer);
  await page.getByTestId(`practice-submit-${fill.id}`).click();
  await expect(page.getByTestId(`practice-feedback-${fill.id}`)).toContainText("Cần luyện thêm");
  await page.getByTestId(`practice-fill-input-${fill.id}`).fill(fill.acceptedAnswers[0]);
  await page.getByTestId(`practice-submit-${fill.id}`).click();
  await expect(page.getByTestId(`practice-feedback-${fill.id}`)).toContainText("Đúng");
}

let fixture: LocalApp;

test.beforeAll(async () => {
  fixture = await launchLocalApp();
  await openStudio(fixture.page);
});

test.afterEach(async ({}, testInfo: TestInfo) => {
  if (!fixture) return;
  const diagnostics = fixture.runtimeDiagnostics();
  let runtimeError: Error | null = null;
  try {
    fixture.assertNoRuntimeIssues();
  } catch (error) {
    runtimeError = error instanceof Error ? error : new Error(String(error));
  }
  const testFailed = testInfo.status !== testInfo.expectedStatus;
  const hasExpectedOrExternalDiagnostics = diagnostics.expected.length > 0 || diagnostics.externalPages.length > 0;
  const diagnosticsReceipt = {
    pass: !testFailed && runtimeError === null,
    runtimeVerified: runtimeError === null,
    externalNetworkVerified: false,
    limitation: "External WebContents network behavior is recorded for provenance but is outside local ACP acceptance coverage.",
    diagnostics,
  };

  if (hasExpectedOrExternalDiagnostics || runtimeError) {
    await writeReceipt(testInfo, "runtime-diagnostics.json", diagnosticsReceipt);
  }
  if (testFailed || runtimeError) {
    await fixture.page.screenshot({
      path: testInfo.outputPath("local-acp-failure.png"),
      fullPage: true,
    }).catch(() => undefined);
    await backupLocalDatabase(fixture.databasePath, testInfo.outputPath("failed-local-profile.sqlite"));
    await writeReceipt(testInfo, "failed-runtime-receipt.json", {
      pass: false,
      runtimeVerified: false,
      status: testInfo.status,
      expectedStatus: testInfo.expectedStatus,
      error: sanitizeLocalDiagnostic(testInfo.error?.message || runtimeError?.message || "unknown_test_failure"),
      sqliteBackup: "failed-local-profile.sqlite",
      externalNetworkVerified: false,
      diagnostics,
    });
  }
  if (runtimeError) throw runtimeError;
  fixture.clearRuntimeDiagnostics();
  if (fixture.offline) {
    await fixture.restart();
    await openStudio(fixture.page);
  }
});

test.afterAll(async () => {
  await fixture?.close();
});

for (const provider of ["codex", "claude"] as const) {
  test(`${provider} completes the packaged local ACP lesson flow`, async ({}, testInfo: TestInfo) => {
    test.setTimeout(1_200_000);
    testInfo.annotations.push({
      type: "acceptance",
      description: `Packaged app, actual ${provider} ACP adapter, existing CLI auth, real MCP writes and local SQLite`,
    });

    const page = fixture.page;
    await requireProvider(page, provider);
    const selectedModel = await selectDiscoveredModel(page, provider);
    await page.reload();
    await openStudio(page);
    const previousLessonIds = await page.evaluate(async () => {
      const bridge = window.__ENJOY_APP__.learning;
      const context = await bridge.getContext();
      return (await bridge.request(context, "list", {})).lessons.map(lesson => lesson.id);
    });

    await page.getByRole("button", { name: "Bài học mới", exact: true }).click();
    const form = page.getByRole("form", { name: "Tạo bản nháp bài học" });
    await expect(form.getByLabel("Trình độ")).toHaveValue("A2");
    await expect(form.getByLabel("Số hình minh hoạ")).toHaveValue("0");
    await expect(form.getByLabel("Tạo giọng đọc cho bài học")).not.toBeChecked();

    if (provider === "codex") {
      await form.getByLabel("Chủ đề", { exact: false }).fill("Ordering coffee politely");
    } else {
      await form.getByLabel("Từ hoặc cụm từ", { exact: false }).fill("ticket, platform, return");
    }
    await form.getByRole("radiogroup", { name: "Dịch vụ AI dùng để gợi ý" })
      .getByLabel(suggestionUiName(provider), { exact: true })
      .check();

    await beginStreamCapture(page);
    await form.getByRole("button", { name: "Gợi ý mục học", exact: true }).click();
    const targetReview = form.locator('section[aria-labelledby="target-review-heading"]');
    await expect(targetReview).toBeVisible({ timeout: 360_000 });
    const terms = await targetReview.getByLabel("Từ hoặc cụm từ", { exact: true })
      .evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value));
    expect(terms.length).toBeGreaterThan(0);
    if (provider === "claude") {
      const normalizedTerms = new Set(terms.map(term => term.toLocaleLowerCase("en")));
      expect(["ticket", "platform", "return"].every(keyword => normalizedTerms.has(keyword))).toBe(true);
    }
    const firstSuggestion = targetReview.locator("details").first();
    await firstSuggestion.locator("summary").click();
    const translationInput = firstSuggestion.getByLabel("Nghĩa tiếng Việt", { exact: true });
    const originalTranslation = (await translationInput.inputValue()).trim();
    expect(originalTranslation.length).toBeGreaterThan(0);
    const editedTranslation = `${originalTranslation} (ngữ cảnh bài học)`;
    await translationInput.fill(editedTranslation);
    await expect(translationInput).toHaveValue(editedTranslation);
    await expect(firstSuggestion).toContainText("Bạn đã xác nhận");
    const stream = await finishStreamCapture(page);
    expect(stream.started).toBeGreaterThanOrEqual(1);
    expect(stream.text).toBeGreaterThanOrEqual(1);
    expect(stream.completed).toBeGreaterThanOrEqual(1);
    expect(stream.textCharacters).toBeGreaterThan(0);

    await form.getByRole("button", { name: "Lưu bản nháp", exact: true }).click();
    await expect(page.getByText("Bản nháp đang chờ nội dung", { exact: true })).toBeVisible({ timeout: 30_000 });
    const lessonId = await newestCreatedLessonId(page, previousLessonIds);
    const draftBundle = await getLesson(page, lessonId);
    const draftRevision = draftBundle.revisions.find(revision => revision.id === draftBundle.lesson.activeRevisionId);
    expect(draftRevision?.status).toBe("draft");
    expect(draftRevision?.content).toBeNull();
    expect((draftRevision?.brief as LessonBrief).targets[0].translationVi).toBe(editedTranslation);

    const generationButton = page.getByRole("button", {
      name: `Tạo bằng ${providerUiName(provider)}`,
      exact: true,
    });
    await expect(generationButton).toBeEnabled({ timeout: 30_000 });
    await generationButton.click();
    const job = await waitForCompletedJob(fixture, lessonId);
    const generatedBundle = await getLesson(page, lessonId);
    const generatedRevision = generatedBundle.revisions.find(revision => revision.id === generatedBundle.lesson.activeRevisionId);
    const sqlite = await sanitizedSqliteReceipt(fixture, job);
    await writeReceipt(testInfo, `${provider}-generation-completion.json`, {
        provider,
        packaged: true,
        selectedModel,
        stream,
        sqlite,
        lesson: sanitizedLessonReceipt(generatedBundle),
    });
    expect(job.request_key).toMatch(new RegExp(`^studio-${provider}-`));
    await expect(page.getByText("Đã tạo xong nội dung", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("lesson-reader-heading")).toBeVisible({ timeout: 60_000 });
    expect(generatedRevision?.status).toBe("ready");
    expect(generatedRevision?.content).toBeTruthy();
    const content = generatedRevision?.content as LessonDraft;
    expect(content.sections.length).toBeGreaterThan(0);
    expect(content.exercises.length).toBeGreaterThan(0);
    expect(sqlite.stages.length).toBeGreaterThan(0);
    expect(sqlite.stages.every(stage => stage.state === "completed")).toBe(true);
    expect(sqlite.stages.every(stage => Boolean(stage.committedHash))).toBe(true);
    expect(sqlite.attempts.some(attempt => attempt.provider === provider && attempt.state === "completed")).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${provider}-lesson.png`), fullPage: true });

    const networkAfterGeneration = await captureProviderNetwork(page);
    await fixture.restart({ offline: true });
    const offlinePage = fixture.page;
    await openStudio(offlinePage);
    const offlineBundle = await getLesson(offlinePage, lessonId);
    const offlineRevision = offlineBundle.revisions.find(revision => revision.id === offlineBundle.lesson.activeRevisionId);
    expect(offlineRevision?.status).toBe("ready");
    expect(offlineRevision?.content).toEqual(generatedRevision?.content);
    await offlinePage.getByRole("button", { name: generatedBundle.lesson.title, exact: true }).click();
    await expect(offlinePage.getByTestId("lesson-reader")).toContainText(terms[0]);
    await offlinePage.getByRole("button", { name: "Luyện tập", exact: true }).click();
    await expect(offlinePage.getByTestId("practice-panel")).toBeVisible();
    await exerciseFillQuestion(offlinePage, content);

    await writeReceipt(testInfo, `${provider}-local-acp-receipt.json`, {
        provider,
        packaged: true,
        profileId: "local",
        inputMode: provider === "codex" ? "topic-only" : "keywords-only",
        defaults: { level: "A2", imageCount: 0, audio: false },
        selectedModel,
        stream,
        sqlite,
        lesson: sanitizedLessonReceipt(offlineBundle),
        network: {
          afterGeneration: networkAfterGeneration,
          afterOfflineRestart: await captureProviderNetwork(offlinePage),
          scope: "Main and renderer policy counters only; native CLI egress has a separate controlled proxy receipt.",
        },
        offlineColdRestart: true,
        wrongThenCorrectPractice: true,
    });
    const backupName = `${provider}-completed-local-profile.sqlite`;
    const backupPath = testInfo.outputPath(backupName);
    await backupLocalDatabase(fixture.databasePath, backupPath);
    const integrity = await queryLocalDatabase<{ integrity_check: string }>(backupPath, "PRAGMA integrity_check");
    expect(integrity).toEqual([{ integrity_check: "ok" }]);
    const practiceRows = await queryLocalDatabase<{ count: number }>(backupPath, "SELECT count(*) AS count FROM practice_attempts");
    expect(practiceRows[0]?.count).toBeGreaterThanOrEqual(2);
    await writeReceipt(testInfo, `${provider}-sqlite-backup.json`, {
      backupName,
      integrity: "ok",
      practiceAttempts: practiceRows[0].count,
    });
  });
}

test("the packaged UI cancels active suggestions for both ACP providers", async ({}, testInfo: TestInfo) => {
  test.setTimeout(480_000);
  const page = fixture.page;
  const keywords = [
    "return ticket",
    "platform announcement",
    "customer service desk",
    "missed connection",
    "departure board",
    "travel refund",
    "replacement service",
    "delay compensation",
    "ticket inspector",
    "station entrance",
    "journey planner",
    "passenger assistance",
  ];
  const keywordText = keywords.join(", ");
  const receipts = [];

  for (const provider of ["codex", "claude"] as const) {
    await requireProvider(page, provider);
    await page.getByRole("button", { name: "Bài học mới", exact: true }).click();
    const form = page.getByRole("form", { name: "Tạo bản nháp bài học" });
    const keywordInput = form.getByLabel("Từ hoặc cụm từ", { exact: false });
    await keywordInput.fill(keywordText);
    await form.getByRole("radiogroup", { name: "Dịch vụ AI dùng để gợi ý" })
      .getByLabel(suggestionUiName(provider), { exact: true })
      .check();

    await beginStreamCapture(page);
    await form.getByRole("button", { name: "Gợi ý mục học", exact: true }).click();
    const stopButton = form.getByRole("button", { name: "Dừng gợi ý", exact: true });
    await expect(stopButton).toBeVisible({ timeout: 30_000 });
    const requestId = await waitForFirstStreamText(page);
    await stopButton.click();
    await page.evaluate(id => window.__ENJOY_APP__.acp.cancel(id), requestId);

    await expect(keywordInput).toHaveValue(keywordText);
    await expect(form.getByRole("button", { name: "Gợi ý mục học", exact: true })).toBeEnabled();
    const targetReview = form.locator('section[aria-labelledby="target-review-heading"]');
    await expect(targetReview).toHaveCount(0);
    await pause(1_000);
    await expect(targetReview).toHaveCount(0);
    const stream = await finishStreamCapture(page);
    expect(stream.requestIds).toContain(requestId);
    expect(stream.text).toBeGreaterThanOrEqual(1);
    expect(stream.textCharacters).toBeGreaterThan(0);
    expect(stream.completed).toBe(0);
    fixture.consumeExpectedRuntimeError("native_cancelled");
    const receipt = {
      provider,
      requestId,
      stream,
      inputMode: "twelve-keywords",
      inputsPreserved: true,
      noLateTargets: true,
      secondCancelCompleted: true,
    };
    receipts.push(receipt);
    await writeReceipt(testInfo, `${provider}-suggestion-cancellation.json`, receipt);

    await form.getByRole("button", { name: "Quay lại", exact: true }).click();
    await expect(form).toHaveCount(0);
  }

  await writeReceipt(testInfo, "suggestion-cancellation-receipt.json", receipts);
});

test("unavailable models are rejected through each actual ACP bridge", async ({}, testInfo: TestInfo) => {
  test.setTimeout(300_000);
  const page = fixture.page;
  const statuses = await page.evaluate(() => window.__ENJOY_APP__.acp.status());
  const selectableProviders = statuses.filter(candidate => candidate.available && candidate.models.length > 0);
  expect(selectableProviders.map(candidate => candidate.provider).sort()).toEqual(["claude", "codex"]);
  const receipts = [];
  for (const status of selectableProviders) {
    const invalidModel = `enjoy-invalid-model-${status.provider}-${crypto.randomUUID()}`;
    expect(status.models.some(model => model.id === invalidModel)).toBe(false);
    const result = await page.evaluate(async ({ provider, model }) => {
      const updates: AcpTextUpdate[] = [];
      const requestId = crypto.randomUUID();
      const unsubscribe = window.__ENJOY_APP__.acp.onUpdate(update => updates.push(update));
      try {
        await window.__ENJOY_APP__.acp.invoke({
          requestId,
          provider,
          model,
          messages: [{ role: "user", content: "Return the word unavailable." }],
        });
        return { rejected: false, error: "", updateTypes: updates.map(update => update.type) };
      } catch (error) {
        return {
          rejected: true,
          error: error instanceof Error ? error.message : String(error),
          updateTypes: updates.map(update => update.type),
        };
      } finally {
        unsubscribe();
      }
    }, { provider: status.provider, model: invalidModel });
    expect(result.rejected).toBe(true);
    expect(result.error).toContain("native_model_unavailable");
    expect(result.updateTypes).not.toContain("completed");
    fixture.consumeExpectedRuntimeError("native_model_unavailable");
    receipts.push({
      provider: status.provider,
      catalogCount: status.models.length,
      invalidModelWasAbsent: true,
      rejected: result.rejected,
      errorCode: "native_model_unavailable",
      updateTypes: result.updateTypes,
    });
  }
  await writeReceipt(testInfo, "invalid-model-receipt.json", receipts);
});
