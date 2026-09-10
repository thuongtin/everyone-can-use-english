/* eslint-disable no-empty-pattern -- Electron acceptance uses an isolated application fixture. */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { MindmapGraph } from "../src/types/learning";
import {
  backupLocalDatabase,
  launchLocalApp,
  queryLocalDatabase,
  sanitizeLocalDiagnostic,
  writeReceipt,
  type LocalApp,
} from "./helpers/local-app";

let fixture: LocalApp;
test.describe.configure({ mode: "serial", retries: 0 });
test.beforeEach(async ({}, info) => {
  const seedDirectory = info.title.startsWith("saved actual") ? process.env.ENJOY_STUDY_MAP_REOPEN_DIR : undefined;
  const seed = seedDirectory ? await loadSavedStudyMap(seedDirectory) : undefined;
  fixture = await launchLocalApp({ offline: Boolean(seed) || info.title.includes("legacy"), seed });
});
test.afterEach(async ({}, info) => {
  if (!fixture) return;
  let runtimeFailure: unknown;
  try { fixture.assertNoRuntimeIssues(); } catch (error) { runtimeFailure = error; }
  const pass = info.status === info.expectedStatus && !runtimeFailure;
  await writeReceipt(info, "runtime-diagnostics.json", { pass, diagnostics: fixture.runtimeDiagnostics() });
  if (!pass) {
    await fixture.page.screenshot({ path: info.outputPath("failure.png"), fullPage: true }).catch(() => undefined);
    await backupLocalDatabase(fixture.databasePath, info.outputPath("failed-profile.sqlite"));
  }
  let closeFailure: unknown;
  try { await fixture.close(); } catch (error) { closeFailure = error; }
  if (runtimeFailure && closeFailure) throw new AggregateError([runtimeFailure, closeFailure], "Runtime and application cleanup failed");
  if (runtimeFailure) throw runtimeFailure;
  if (closeFailure) throw closeFailure;
});

async function openStudio(page: Page): Promise<void> {
  await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("sidebar-learning-studio").click();
  await expect(page.getByTestId("learning-studio")).toBeVisible({ timeout: 30_000 });
}

async function readMap(page: Page, id: string) {
  return page.evaluate(async mapId => {
    const bridge = window.__ENJOY_APP__.learning;
    return bridge.request(await bridge.getContext(), "getMap", { id: mapId });
  }, id);
}

async function configureProvider(page: Page, provider: "codex" | "claude") {
  return page.evaluate(async selectedProvider => {
    const statuses = await window.__ENJOY_APP__.acp.status();
    const status = statuses.find(value => value.provider === selectedProvider);
    if (!status?.available) throw new Error(`${selectedProvider}_actual_acp_unavailable`);
    const preferredModel = selectedProvider === "codex" ? "gpt-5.6-sol" : "sonnet";
    const model = status.models.find(value => value.id === preferredModel)?.id
      ?? status.models.find(value => value.id === status.currentModel)?.id
      ?? status.models[0]?.id;
    if (!model) throw new Error(`${selectedProvider}_model_catalog_empty`);
    const settings = window.__ENJOY_APP__.userSettings;
    const providerKey = selectedProvider === "codex" ? "codex_acp" : "claude_acp";
    const name = `${selectedProvider}-acp`;
    await settings.set(providerKey as never, { name, model });
    await settings.set("gpt_engine" as never, { name, models: { default: model } });
    return { provider: selectedProvider, model, catalogCount: status.models.length };
  }, provider);
}

async function waitForMapJob(app: LocalApp, mapId: string) {
  let snapshot: Awaited<ReturnType<typeof readJob>> | undefined;
  async function readJob() {
    return app.page.evaluate(async id => {
      const bridge = window.__ENJOY_APP__.learning;
      const context = await bridge.getContext();
      const jobs = await bridge.request(context, "listJobs", { resourceType: "map", resourceId: id });
      const job = jobs[0];
      return job ? bridge.request(context, "job", { id: job.id }) : undefined;
    }, mapId);
  }
  const deadline = Date.now() + 1_080_000;
  while (Date.now() < deadline) {
    snapshot = await readJob();
    if (snapshot?.job.state === "completed") return snapshot;
    if (snapshot && ["failed", "cancelled", "interrupted"].includes(snapshot.job.state)) {
      throw new Error(`Actual map generation ${snapshot.job.state}: ${snapshot.attempts.map(attempt => attempt.errorCode).filter(Boolean).join(", ")}`);
    }
    if (snapshot?.job.state === "partial" && !snapshot.stages.some(stage => ["queued", "running", "validating", "cancelling"].includes(stage.state))) {
      throw new Error(`Actual map generation incomplete: ${snapshot.attempts.map(attempt => attempt.errorCode).filter(Boolean).join(", ")}`);
    }
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  throw new Error(`Actual map generation timed out: ${sanitizeLocalDiagnostic(JSON.stringify(snapshot?.stages.map(stage => ({ kind: stage.kind, state: stage.state }))))}`);
}

async function pageGeometry(page: Page) {
  return page.getByTestId("mindmap-view").evaluate(element => {
    const outer = element.getBoundingClientRect();
    const words = Array.from(element.querySelectorAll<HTMLElement>("[data-study-node-id]"))
      .filter(node => node.getClientRects().length > 0)
      .map(node => {
        const rect = node.getBoundingClientRect();
        return { id: node.dataset.studyNodeId, x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          fontSize: Number.parseFloat(getComputedStyle(node).fontSize), overflow: node.scrollWidth > node.clientWidth + 2 };
      });
    const collisions: string[] = [];
    for (let left = 0; left < words.length; left += 1) for (let right = left + 1; right < words.length; right += 1) {
      const a = words[left]; const b = words[right];
      const dx = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const dy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (dx > 2 && dy > 2) collisions.push(`${a.id}:${b.id}`);
    }
    return {
      containerWidth: outer.width,
      wordIds: words.map(word => word.id),
      collisions,
      horizontalOverflow: words.filter(word => word.overflow || word.x < outer.left - 2 || word.x + word.width > outer.right + 2).map(word => word.id),
      words,
      learningText: Array.from(element.querySelectorAll<HTMLElement>(".mindmap-study__term, .mindmap-study__ipa, .mindmap-study__meaning, .mindmap-study__detail-body, .mindmap-study__group-example"))
        .filter(node => node.getClientRects().length > 0)
        .map(node => ({ className: node.className, fontSize: Number.parseFloat(getComputedStyle(node).fontSize) })),
    };
  });
}

async function inspectEveryPage(page: Page, info: TestInfo, prefix: string) {
  const snapshots = [];
  const previous = page.getByRole("button", { name: "Trang trước", exact: true });
  while (await previous.isEnabled().catch(() => false)) await previous.click();
  for (let index = 0; index < 20; index += 1) {
    await expect(page.getByTestId("study-map-page")).toBeVisible();
    await page.getByTestId("mindmap-view").scrollIntoViewIfNeeded();
    const pageImages = page.getByTestId("study-map-page").locator("img");
    await expect.poll(() => pageImages.evaluateAll(nodes => nodes.every(node => (node as HTMLImageElement).naturalWidth > 0)), { timeout: 30_000 }).toBe(true);
    const geometry = await pageGeometry(page);
    expect(geometry.collisions).toEqual([]);
    expect(geometry.horizontalOverflow).toEqual([]);
    expect(geometry.words.every(word => word.width > 0 && word.height > 0)).toBe(true);
    expect(geometry.learningText.every(text => text.fontSize >= 14)).toBe(true);
    snapshots.push(geometry);
    const wordsOnPage = page.getByTestId("study-map-page").locator("[data-study-node-id]");
    for (const word of await wordsOnPage.all()) {
      await word.scrollIntoViewIfNeeded();
      await expect(word).toBeInViewport();
    }
    await page.screenshot({ path: info.outputPath(`${prefix}-page-${index + 1}-bottom.png`) });
    await page.getByTestId("study-map-page").locator(".mindmap-study__page-heading").evaluate(node => node.scrollIntoView({ block: "start", inline: "nearest" }));
    await page.screenshot({ path: info.outputPath(`${prefix}-page-${index + 1}.png`) });
    const sheet = page.getByTestId("study-map-page");
    const sheetBounds = await sheet.boundingBox();
    if (sheetBounds && sheetBounds.height < (page.viewportSize()?.height ?? 0) - 40) {
      await sheet.screenshot({ path: info.outputPath(`${prefix}-page-${index + 1}-sheet.png`) });
    }
    const next = page.getByRole("button", { name: "Trang tiếp", exact: true });
    if (!await next.isEnabled().catch(() => false)) break;
    await next.click();
  }
  return snapshots;
}

function legacyGraph(): MindmapGraph {
  const nodes = Array.from({ length: 40 }, (_, index) => ({
    id: `legacy-${index}`,
    term: index === 0 ? "Everyday life" : `everyday expression ${index}`,
    sense: "an expression used in everyday conversation",
    definition: "A phrase that is useful when talking about familiar activities and ordinary situations.",
    translationVi: index === 0 ? "Cuộc sống thường ngày" : `Cụm từ số ${index}: dùng trong những tình huống quen thuộc, diễn đạt một ý cụ thể khi giao tiếp hằng ngày.`,
    example: "We use this expression when we talk about a familiar activity.",
    evidence: { status: "unverified" as const },
  }));
  return { rootNodeId: nodes[0].id, nodes, edges: [
    { id: "legacy-edge-1", source: nodes[0].id, target: nodes[1].id, kind: "situation", evidence: { status: "unverified" } },
    { id: "legacy-edge-2", source: nodes[1].id, target: nodes[2].id, kind: "related-concept", evidence: { status: "unverified" } },
    { id: "legacy-edge-3", source: nodes[2].id, target: nodes[0].id, kind: "related-concept", evidence: { status: "unverified" } },
  ] };
}

test("legacy maps automatically reflow all 40 words without writing manual positions", async ({}, info) => {
  test.setTimeout(180_000);
  info.annotations.push({ type: "fixture", description: "Hand-authored legacy graph, actual packaged UI and SQLite; no inference claim" });
  const page = fixture.page;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openStudio(page);
  const graph = legacyGraph();
  const result = await page.evaluate(async content => {
    const bridge = window.__ENJOY_APP__.learning;
    const context = await bridge.getContext();
    const created = await bridge.request(context, "createMap", { title: "Legacy 40 words" });
    const updated = await bridge.request(context, "reviseMap", { mapId: created.map.id, expectedRevisionId: created.revision.id, content });
    const positions = content.nodes.map((node, index) => ({ id: node.id, x: index * 20, y: -index * 10 }));
    await bridge.request(context, "saveMapLayout", { mapRevisionId: updated.revision.id, positions });
    const stored = await bridge.request(context, "getMap", { id: created.map.id });
    return { mapId: created.map.id, positions: stored.layouts[0].positions };
  }, graph);
  await page.reload();
  await openStudio(page);
  await page.getByRole("button", { name: "Legacy 40 words", exact: true }).click();
  const wide = await inspectEveryPage(page, info, "legacy-wide");
  const nonRoot = wide.flatMap(snapshot => snapshot.wordIds).filter(id => id !== graph.rootNodeId);
  expect(nonRoot).toHaveLength(39);
  expect(new Set(nonRoot).size).toBe(39);
  expect(new Set(nonRoot)).toEqual(new Set(graph.nodes.slice(1).map(node => node.id)));
  await page.setViewportSize({ width: 720, height: 1000 });
  const narrow = await inspectEveryPage(page, info, "legacy-narrow");
  expect(narrow.flatMap(snapshot => snapshot.wordIds).filter(id => id !== graph.rootNodeId)).toEqual(nonRoot);
  const saved = await readMap(page, result.mapId);
  expect(saved.layouts[0].positions).toEqual(result.positions);
  expect(saved.revisions.find(revision => revision.id === saved.map.activeRevisionId)?.content).toEqual(graph);
  await writeReceipt(info, "legacy-layout-receipt.json", { graph, wide, narrow, originalPositionsPreserved: true, actualInference: false });
});

for (const provider of ["codex", "claude"] as const) {
  test(`${provider} creates a complete study map in one submit and reopens it offline`, async ({}, info) => {
    test.skip(process.env.ENJOY_RUN_STUDY_MAP_ACCEPTANCE !== "1", "Actual ACP and native image generation require explicit acceptance opt-in");
    test.setTimeout(1_200_000);
    info.annotations.push({ type: "actual-inference", description: "Packaged UI, real ACP text, real native Codex images when requested, isolated local profile and SQLite" });
    let page = fixture.page;
    await page.setViewportSize({ width: 1440, height: 1100 });
    await openStudio(page);
    const selected = await configureProvider(page, provider);
    await page.reload();
    await openStudio(page);
    await page.getByRole("button", { name: "Mindmap mới", exact: true }).click();
    const form = page.getByRole("form", { name: "Tạo trang sơ đồ học", exact: true });
    await expect(form.getByLabel("Trình độ", { exact: true })).toHaveValue("A2");
    const title = provider === "codex" ? "Body parts: head, face, arm, hand, torso" : "At a train station: ticket, platform, return";
    await form.getByLabel("Chủ đề hoặc từ khóa", { exact: true }).fill(title);
    await form.getByText("Tuỳ chọn nâng cao", { exact: true }).click();
    await expect(form.getByLabel("Dịch vụ AI", { exact: true })).toHaveValue(provider);
    const includeImages = form.getByLabel("Tạo hình minh họa", { exact: true });
    if (provider === "codex") await expect(includeImages).toBeChecked();
    else await includeImages.uncheck();
    await form.getByRole("button", { name: "Tạo trang học", exact: true }).click();
    await expect.poll(async () => {
      const maps = await queryLocalDatabase<{ id: string }>(fixture.databasePath, "SELECT id FROM learning_maps");
      return maps[0]?.id;
    }, { timeout: 30_000 }).toBeTruthy();
    const mapId = (await queryLocalDatabase<{ id: string }>(fixture.databasePath, "SELECT id FROM learning_maps"))[0].id;
    const job = await waitForMapJob(fixture, mapId);
    const bundle = await readMap(page, mapId);
    const revision = bundle.revisions.find(value => value.id === bundle.map.activeRevisionId)!;
    const graph = revision.content as MindmapGraph;
    expect(revision.status).toBe("ready");
    expect(revision.brief).toMatchObject({ level: "A2", illustrations: provider === "codex" });
    expect(graph.studyGroups?.length).toBeGreaterThan(0);
    expect(graph.nodes.filter(node => node.id !== graph.rootNodeId).every(node => Boolean(node.ipa))).toBe(true);
    const members = graph.studyGroups!.flatMap(group => group.nodeIds);
    expect(new Set(members)).toEqual(new Set(graph.nodes.filter(node => node.id !== graph.rootNodeId).map(node => node.id)));
    expect(members.length).toBe(new Set(members).size);
    expect(job.attempts.some(attempt => attempt.provider === provider && attempt.state === "completed")).toBe(true);
    const jobs = await queryLocalDatabase<{ count: number }>(fixture.databasePath, "SELECT count(*) AS count FROM generation_jobs WHERE resource_id = ?", [mapId]);
    expect(jobs[0].count).toBe(1);
    const imageSlots = bundle.slots.filter(slot => slot.kind === "image" && slot.mapRevisionId === revision.id);
    const selectedImages = imageSlots.map(slot => bundle.assets.find(asset => asset.id === slot.selectedAssetId)).filter(asset => asset !== undefined);
    if (provider === "codex") {
      expect(selectedImages).toHaveLength(graph.studyGroups!.length);
      expect(selectedImages.every(asset => asset.sizeBytes > 1000 && Number(asset.width) > 0 && Number(asset.height) > 0)).toBe(true);
      expect(job.stages.filter(stage => stage.kind === "image").every(stage => stage.state === "completed")).toBe(true);
    } else expect(selectedImages).toHaveLength(0);
    await expect(page.getByTestId("mindmap-view")).toBeVisible({ timeout: 30_000 });
    const wide = await inspectEveryPage(page, info, `${provider}-wide`);
    const images = [];
    for (const slot of imageSlots) {
      const asset = bundle.assets.find(value => value.id === slot.selectedAssetId);
      if (!asset) continue;
      const bytes = await page.evaluate(async relativePath => {
        const context = await window.__ENJOY_APP__.learning.getContext();
        const response = await fetch(`enjoy://library/learning-assets/${context.connectionId}/${relativePath}`);
        if (!response.ok) throw new Error("Stored map image is not readable");
        return Array.from(new Uint8Array(await response.arrayBuffer()));
      }, asset.relativePath);
      const buffer = Buffer.from(bytes);
      expect(createHash("sha256").update(buffer).digest("hex")).toBe(asset.sha256);
      const filename = `group-${slot.sourceId}.${asset.mimeType === "image/jpeg" ? "jpg" : asset.mimeType === "image/webp" ? "webp" : "png"}`;
      await writeFile(info.outputPath(filename), buffer);
      images.push({ groupId: slot.sourceId, assetId: asset.id, filename, sha256: asset.sha256, bytes: buffer.length, width: asset.width, height: asset.height });
    }
    await fixture.restart({ offline: true });
    page = fixture.page;
    await page.setViewportSize({ width: 720, height: 1100 });
    await openStudio(page);
    await page.getByRole("button", { name: bundle.map.title, exact: true }).click();
    const reloaded = await readMap(page, mapId);
    expect(reloaded.revisions.find(value => value.id === revision.id)?.content).toEqual(graph);
    expect(reloaded.assets).toEqual(bundle.assets);
    const narrow = await inspectEveryPage(page, info, `${provider}-offline-narrow`);
    const lastVisibleImage = page.getByTestId("mindmap-view").locator("img");
    if (provider === "codex") {
      expect(await lastVisibleImage.count()).toBeGreaterThan(0);
      await expect.poll(() => lastVisibleImage.evaluateAll(nodes => nodes.every(node => (node as HTMLImageElement).naturalWidth > 0))).toBe(true);
    }
    const reveal = page.getByRole("button", { name: "Ẩn nghĩa", exact: true });
    await reveal.click();
    await expect(page.getByRole("button", { name: "Hiện nghĩa", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Hiện nghĩa", exact: true }).click();
    const backupName = `${provider}-study-map.sqlite`;
    await backupLocalDatabase(fixture.databasePath, info.outputPath(backupName));
    expect(await queryLocalDatabase(info.outputPath(backupName), "PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
    await writeReceipt(info, `${provider}-study-map-receipt.json`, {
      pass: true, packaged: true, actualTextInference: true, actualImageInference: provider === "codex", selected,
      input: { title, level: "A2", illustrations: provider === "codex" }, oneSubmit: true,
      mapId, revisionId: revision.id, brief: revision.brief, graph, images,
      job: { id: job.job.id, state: job.job.state, stages: job.stages.map(stage => ({ kind: stage.kind, state: stage.state, hash: stage.committedHash })), attempts: job.attempts.map(attempt => ({ provider: attempt.provider, state: attempt.state, errorCode: attempt.errorCode })) },
      wide, narrow, coldRestartOffline: true, sqliteBackup: backupName,
    });
  });
}

async function loadSavedStudyMap(directory: string) {
  const receipt = JSON.parse(await readFile(path.join(directory, "codex-study-map-receipt.json"), "utf8")) as {
    sqliteBackup: string;
    images: { assetId: string; filename: string }[];
  };
  const databasePath = path.join(directory, receipt.sqliteBackup);
  const stored = await queryLocalDatabase<{ id: string; relative_path: string }>(databasePath, "SELECT id,relative_path FROM generated_assets WHERE kind = 'image'");
  return {
    databasePath,
    assets: receipt.images.map(image => {
      const asset = stored.find(candidate => candidate.id === image.assetId);
      if (!asset) throw new Error("Saved image receipt does not match its SQLite backup");
      return { sourcePath: path.join(directory, image.filename), relativePath: asset.relative_path };
    }),
  };
}

test("saved actual study map retains complete illustrations on the final package", async ({}, info) => {
  const directory = process.env.ENJOY_STUDY_MAP_REOPEN_DIR;
  test.skip(!directory, "A previously verified actual generation artifact is required");
  test.setTimeout(180_000);
  info.annotations.push({ type: "reused-actual-output", description: "Previously generated Codex content and image bytes, restored into an isolated profile; no new inference" });
  const receipt = JSON.parse(await readFile(path.join(directory!, "codex-study-map-receipt.json"), "utf8")) as { mapId: string; graph: MindmapGraph; images: { assetId: string; sha256: string }[] };
  const page = fixture.page;
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openStudio(page);
  const bundle = await readMap(page, receipt.mapId);
  await page.getByRole("button", { name: bundle.map.title, exact: true }).click();
  expect(bundle.revisions.find(revision => revision.id === bundle.map.activeRevisionId)?.content).toEqual(receipt.graph);
  for (const image of receipt.images) expect(bundle.assets.find(asset => asset.id === image.assetId)?.sha256).toBe(image.sha256);
  const wide = await inspectEveryPage(page, info, "restored-wide");
  await page.setViewportSize({ width: 720, height: 1100 });
  const narrow = await inspectEveryPage(page, info, "restored-narrow");
  const imageGeometry = await page.getByTestId("mindmap-view").locator("img").evaluateAll(nodes => nodes.map(node => {
    const image = node as HTMLImageElement;
    const rect = image.getBoundingClientRect();
    return { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, width: rect.width, height: rect.height, objectFit: getComputedStyle(image).objectFit };
  }));
  expect(imageGeometry.length).toBeGreaterThan(0);
  expect(imageGeometry.every(image => image.naturalWidth > 0 && (image.objectFit === "contain" || Math.abs(image.width / image.height - image.naturalWidth / image.naturalHeight) < 0.01))).toBe(true);
  await writeReceipt(info, "restored-actual-receipt.json", { pass: true, sourceDirectory: directory, actualOutputReused: true, newInference: false, graphPreserved: true, imageHashesPreserved: true, offline: true, wide, narrow, imageGeometry });
});
