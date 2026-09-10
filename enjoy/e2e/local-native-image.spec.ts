/* eslint-disable no-empty-pattern -- Electron fixtures do not use a browser fixture. */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

import {
  launchLocalApp,
  writeReceipt,
  type LocalApp,
} from "./helpers/local-app";
import { captureProviderNetwork } from "./helpers/provider-network";

const runLive = process.env.ENJOY_RUN_NATIVE_IMAGE_ACCEPTANCE === "1";

test.skip(!runLive, "Set ENJOY_RUN_NATIVE_IMAGE_ACCEPTANCE=1 for controlled native Codex image acceptance");
test.describe.configure({ mode: "serial", retries: 0 });

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

test("Codex generates and preserves one native lesson image through UI and MCP", async ({}, info) => {
  test.setTimeout(720_000);
  info.annotations.push({
    type: "native-inference",
    description: "Real Codex CLI image generation in a disposable local profile",
  });
  let fixture: LocalApp | undefined;
  let primaryError: unknown;
  const title = `A cup of tea, native image ${Date.now().toString(36)}`;
  const receipt: Record<string, unknown> = {
    candidate: process.env.ENJOY_E2E_APP_PATH || null,
    provider: "codex",
    requestedLesson: {
      level: "A2",
      length: "short",
      imageCount: 1,
      audio: false,
      target: { term: "cup", meaning: "a drinking container" },
    },
    startedAt: new Date().toISOString(),
  };

  try {
    fixture = await launchLocalApp({ offline: false });
    let page = fixture.page;
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 45_000 });

    const discovery = await page.evaluate(async () => {
      const [statuses, learning] = await Promise.all([
        window.__ENJOY_APP__.acp.status(),
        window.__ENJOY_APP__.learning.getContext({ refreshCapabilities: true }),
      ]);
      const codex = statuses.find(status => status.provider === "codex");
      const capability = learning.capabilities.find(item => item.provider === "codex");
      if (!codex || !capability) throw new Error("native_codex_discovery_missing");
      const modelIds = codex.models.map(model => model.id).filter(Boolean);
      const selectedModel = codex.currentModel && modelIds.includes(codex.currentModel)
        ? codex.currentModel
        : modelIds[0];
      if (!selectedModel) throw new Error("native_model_unavailable");
      await window.__ENJOY_APP__.userSettings.set("codex_acp", { model: selectedModel });
      return {
        available: codex.available,
        reason: codex.reason,
        currentModel: codex.currentModel,
        discoveredModelIds: modelIds,
        selectedModel,
        text: capability.text,
        image: capability.image,
      };
    });
    expect(discovery.available, discovery.reason || "Codex ACP unavailable").toBe(true);
    expect(discovery.text).toBe(true);
    expect(discovery.image).toBe(true);
    expect(discovery.discoveredModelIds).toContain(discovery.selectedModel);
    receipt.discovery = discovery;

    await page.getByTestId("sidebar-learning-studio").click();
    await expect(page.getByTestId("learning-studio")).toBeVisible();
    await page.getByRole("button", { name: "Bài học mới", exact: true }).click();
    const form = page.getByRole("form", { name: "Tạo bản nháp bài học" });
    await form.getByLabel("Chủ đề", { exact: false }).fill(title);
    await form.getByLabel("Trình độ").selectOption("A2");
    await form.getByText("Tuỳ chọn nâng cao", { exact: true }).click();
    await form.getByLabel(/^Độ dài/u).selectOption("short");
    await form.getByLabel("Số hình minh hoạ").selectOption("1");
    await form.getByLabel("Tạo giọng đọc cho bài học").uncheck();
    await form.getByRole("button", { name: /^Thêm mục học thủ công/u }).click();
    const target = form.getByRole("group", { name: "Mục nhập tay 1" });
    await target.getByLabel("Từ hoặc cụm từ", { exact: true }).fill("cup");
    await target.getByLabel("Nghĩa muốn học", { exact: true }).fill("a drinking container");
    await target.getByLabel("Giải thích bằng tiếng Anh").fill("A small container used for drinking.");
    await target.getByLabel("Nghĩa tiếng Việt").fill("cốc");
    await target.getByLabel("Câu ví dụ tiếng Anh").fill("I have a cup of tea.");
    await form.getByRole("button", { name: "Lưu bản nháp", exact: true }).click();

    const generate = page.getByRole("button", { name: "Tạo bằng Codex", exact: true });
    await expect(generate).toBeEnabled({ timeout: 45_000 });
    const lessonId = await page.evaluate(async (lessonTitle) => {
      const bridge = window.__ENJOY_APP__.learning;
      const context = await bridge.getContext();
      const library = await bridge.request(context, "list", {});
      const lesson = library.lessons.find(item => item.title === lessonTitle);
      if (!lesson) throw new Error("native_draft_missing");
      return lesson.id;
    }, title);

    const generationStarted = Date.now();
    await generate.click();
    await expect(page.getByRole("button", { name: "Dừng tạo", exact: true })).toBeVisible({ timeout: 45_000 });
    await expect.poll(
      async () => page.evaluate(async (id) => {
        const bridge = window.__ENJOY_APP__.learning;
        const context = await bridge.getContext();
        const jobs = await bridge.request(context, "listJobs", {
          resourceType: "lesson",
          resourceId: id,
        });
        if (!jobs[0]) return "missing";
        const snapshot = await bridge.request(context, "job", { id: jobs[0].id });
        if (["failed", "interrupted", "cancelled"].includes(snapshot.job.state)) {
          throw new Error(
            snapshot.attempts.map(attempt => attempt.errorCode).filter(Boolean).join(",") || snapshot.job.state,
          );
        }
        return snapshot.job.state;
      }, lessonId),
      { timeout: 650_000, intervals: [1_500, 3_000, 5_000] },
    ).toBe("completed");

    await expect(page.getByTestId("lesson-reader-heading")).toBeVisible();
    await expect(page.getByTestId("lesson-reader")).toContainText("cup");
    const image = page.getByTestId("lesson-reader").locator("img").first();
    await expect(image).toBeVisible({ timeout: 30_000 });
    await expect.poll(
      () => image.evaluate((node: HTMLImageElement) => node.naturalWidth),
      { timeout: 30_000 },
    ).toBeGreaterThan(0);
    const rendered = await image.evaluate(async (node: HTMLImageElement) => {
      const response = await fetch(node.src);
      return {
        bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
        contentType: response.headers.get("content-type"),
        naturalWidth: node.naturalWidth,
        naturalHeight: node.naturalHeight,
        alt: node.alt,
      };
    });
    const imageBytes = Uint8Array.from(rendered.bytes);
    const imageHash = sha256(imageBytes);
    expect(rendered.contentType).toBe("image/png");
    expect(rendered.naturalWidth).toBeGreaterThan(0);
    expect(rendered.naturalHeight).toBeGreaterThan(0);
    expect(imageBytes.byteLength).toBeGreaterThan(1_024);
    await writeFile(info.outputPath("codex-native-image.png"), imageBytes);
    await image.screenshot({ path: info.outputPath("codex-native-image-preview.png") });

    const evidence = await page.evaluate(async (id) => {
      const bridge = window.__ENJOY_APP__.learning;
      const context = await bridge.getContext();
      const lesson = await bridge.request(context, "getLesson", { id });
      const jobs = await bridge.request(context, "listJobs", {
        resourceType: "lesson",
        resourceId: id,
      });
      if (!jobs[0]) throw new Error("native_job_missing");
      return {
        lesson,
        job: await bridge.request(context, "job", { id: jobs[0].id }),
      };
    }, lessonId);
    const persistedTitle = evidence.lesson.lesson.title;
    const activeRevision = evidence.lesson.revisions.find(
      revision => revision.id === evidence.lesson.lesson.activeRevisionId,
    );
    expect(activeRevision?.status).toBe("ready");
    expect(activeRevision?.provenance).toMatchObject({ provider: "codex" });
    const imageSlot = evidence.lesson.slots.find(
      slot => slot.lessonRevisionId === activeRevision?.id && slot.kind === "image",
    );
    expect(imageSlot?.selectedAssetId).toBeTruthy();
    const asset = evidence.lesson.assets.find(item => item.id === imageSlot?.selectedAssetId);
    if (!asset) throw new Error("native_image_asset_missing");
    expect(asset.kind).toBe("image");
    expect(asset.mimeType).toBe("image/png");
    expect(asset.sha256).toBe(imageHash);
    expect(asset.sizeBytes).toBe(imageBytes.byteLength);
    expect(asset.width).toBe(rendered.naturalWidth);
    expect(asset.height).toBe(rendered.naturalHeight);
    expect(asset.provenance).toMatchObject({ provider: "codex", channel: "native" });
    const imageProvenance = asset.provenance as Record<string, unknown>;
    expect(typeof imageProvenance.model).toBe("string");
    expect(String(imageProvenance.model).trim()).not.toBe("");
    expect(typeof imageProvenance.providerItemId).toBe("string");
    expect(String(imageProvenance.providerItemId).trim()).not.toBe("");
    expect(evidence.job.stages.filter(stage => stage.kind === "text" && stage.state === "completed")).toHaveLength(1);
    expect(evidence.job.stages.filter(stage => stage.kind === "image" && stage.state === "completed")).toHaveLength(1);
    expect(evidence.job.stages.some(stage => stage.kind === "audio")).toBe(false);
    expect(evidence.job.attempts.filter(attempt => attempt.provider === "codex" && attempt.state === "completed")).toHaveLength(2);
    expect(activeRevision?.provenance).toMatchObject({
      provider: "codex",
      jobId: evidence.job.job.id,
    });

    receipt.generation = {
      elapsedMs: Date.now() - generationStarted,
      lessonId,
      persistedTitle,
      jobId: evidence.job.job.id,
      selectedTextModel: discovery.selectedModel,
      imageModel: imageProvenance.model,
      imageProviderItemIdPresent: true,
      image: {
        assetId: asset.id,
        relativePath: asset.relativePath,
        mimeType: asset.mimeType,
        sha256: asset.sha256,
        sizeBytes: asset.sizeBytes,
        width: asset.width,
        height: asset.height,
        renderedAlt: rendered.alt,
      },
      mcpCandidateAccepted: true,
      stages: evidence.job.stages.map(stage => ({ kind: stage.kind, state: stage.state })),
    };
    receipt.networkAfterGeneration = await captureProviderNetwork(page);
    await page.screenshot({ path: info.outputPath("codex-native-lesson.png"), fullPage: true });

    await fixture.restart({ offline: true });
    page = fixture.page;
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 45_000 });
    await page.getByTestId("sidebar-learning-studio").click();
    await expect(page.getByTestId("learning-studio")).toBeVisible();
    const matchingIndex = await page.evaluate(async ({ id, lessonTitle }) => {
      const bridge = window.__ENJOY_APP__.learning;
      const context = await bridge.getContext();
      const library = await bridge.request(context, "list", {});
      return library.lessons.filter(item => item.title === lessonTitle).findIndex(item => item.id === id);
    }, { id: lessonId, lessonTitle: persistedTitle });
    expect(matchingIndex).toBeGreaterThanOrEqual(0);
    await page.getByRole("button", { name: persistedTitle, exact: true }).nth(matchingIndex).click();
    await expect(page.getByTestId("lesson-reader-heading")).toHaveText(persistedTitle);
    const restoredImage = page.getByTestId("lesson-reader").locator("img").first();
    await expect(restoredImage).toBeVisible({ timeout: 30_000 });
    await expect.poll(
      () => restoredImage.evaluate((node: HTMLImageElement) => node.naturalWidth),
      { timeout: 30_000 },
    ).toBe(rendered.naturalWidth);
    const restoredBytes = Uint8Array.from(await restoredImage.evaluate(async (node: HTMLImageElement) =>
      Array.from(new Uint8Array(await (await fetch(node.src)).arrayBuffer())),
    ));
    expect(sha256(restoredBytes)).toBe(imageHash);
    receipt.offlineRestart = {
      pass: true,
      imageSha256: sha256(restoredBytes),
      renderedWidth: await restoredImage.evaluate((node: HTMLImageElement) => node.naturalWidth),
      renderedHeight: await restoredImage.evaluate((node: HTMLImageElement) => node.naturalHeight),
      network: await captureProviderNetwork(page),
    };
    receipt.runtime = fixture.runtimeDiagnostics();
    fixture.assertNoRuntimeIssues();
    receipt.completed = true;
  } catch (error) {
    primaryError = error;
    receipt.failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw error;
  } finally {
    receipt.finishedAt = new Date().toISOString();
    await writeReceipt(info, "local-native-image.json", receipt);
    await fixture?.close().catch(error => {
      if (!primaryError) throw error;
    });
  }
});
