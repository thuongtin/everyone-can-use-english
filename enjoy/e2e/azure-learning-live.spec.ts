/* eslint-disable no-empty-pattern -- Electron fixtures do not use a browser fixture. */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import {
  validateGeneratedMindmapGraph,
  validateLessonDraft,
} from "../src/lib/learning-schemas";
import type { LessonBrief, LessonDraft, MindmapGraph } from "../src/types/learning";
import {
  launchLocalApp,
  sanitizeLocalDiagnostic,
  writeReceipt,
  type LocalApp,
} from "./helpers/local-app";
import {
  captureProviderNetwork,
  observedHostCount,
  type ProviderNetworkCapture,
} from "./helpers/provider-network";

const runLive = process.env.ENJOY_RUN_AZURE_LEARNING_LIVE === "1";
const credentialInput = process.env.ENJOY_AZURE_CREDENTIAL_FILE?.trim() || "";
const azureProvider = "azure-openai" as const;
const mapTopicTitle = "Ordering drinks at a cafe";
const mapBrief = { level: "A2", illustrations: false } as const;
const genericMapTerms = new Set(["meaning", "synonyms", "antonyms", "examples", "collocations"]);
const commonCafeTerms = [
  "coffee",
  "tea",
  "cup",
  "menu",
  "waiter",
  "order",
  "bill",
  "water",
  "juice",
  "milk",
  "sugar",
] as const;

test.use({ trace: "off" });
test.describe.configure({ mode: "serial", retries: 0 });
test.skip(!runLive, "Set ENJOY_RUN_AZURE_LEARNING_LIVE=1 for controlled paid Azure Learning Studio calls");
test.skip(!credentialInput, "Set ENJOY_AZURE_CREDENTIAL_FILE to a private mode-0600 JSON file");

type AzureCredential = Readonly<{
  region: string;
  key: string;
  endpoint: string;
  textEndpoint: string;
  deployment: string;
}>;

type JobSnapshot = Awaited<ReturnType<typeof readJob>>;

const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const readCredential = async (): Promise<AzureCredential> => {
  const resolved = path.resolve(credentialInput);
  const metadata = await stat(resolved);
  expect(metadata.isFile()).toBe(true);
  expect(metadata.mode & 0o777, "Azure credential file must have mode 0600").toBe(0o600);
  const parsed = JSON.parse(await readFile(resolved, "utf8")) as Record<string, unknown>;
  const stringField = (key: keyof AzureCredential): string =>
    typeof parsed[key] === "string" ? String(parsed[key]).trim() : "";
  const credential = {
    region: stringField("region").toLowerCase(),
    key: stringField("key"),
    endpoint: stringField("endpoint"),
    textEndpoint: stringField("textEndpoint"),
    deployment: stringField("deployment"),
  };
  expect(credential.region).toMatch(/^[a-z0-9-]+$/u);
  expect(credential.key.length).toBeGreaterThan(0);
  expect(credential.deployment.length).toBeGreaterThan(0);
  const speechUrl = new URL(credential.endpoint);
  const textUrl = new URL(credential.textEndpoint);
  for (const url of [speechUrl, textUrl]) {
    expect(url.protocol).toBe("https:");
    expect(url.username || url.password).toBe("");
    expect(url.search || url.hash).toBe("");
  }
  expect(speechUrl.hostname).toMatch(/\.cognitiveservices\.azure\.com$/u);
  expect(textUrl.pathname.replace(/\/+$/u, "")).toMatch(/\/openai\/v1$/u);
  return credential;
};

const lessonBrief: LessonBrief = {
  topic: "Ordering tea at a quiet cafe",
  keywords: ["cup", "tea"],
  level: "A2",
  length: "short",
  imageCount: 0,
  audio: true,
  targets: [
    {
      id: "cup",
      term: "cup",
      sense: "a drinking container",
      definition: "A small container used for drinking.",
      translationVi: "cốc",
      example: "I have a cup of tea.",
    },
    {
      id: "tea",
      term: "tea",
      sense: "a hot drink",
      definition: "A drink made by adding hot water to tea leaves.",
      translationVi: "trà",
      example: "The tea is hot.",
    },
  ],
};

async function configureAzure(page: Page, credential: AzureCredential) {
  return page.evaluate(async (config) => {
    const speech = await window.__ENJOY_APP__.speeches.setAzureConfig({
      region: config.region,
      endpoint: config.endpoint,
      key: config.key,
    });
    await window.__ENJOY_APP__.userSettings.set("azure_openai", {
      name: "azure-openai",
      key: config.key,
      baseUrl: config.textEndpoint,
      models: config.deployment,
    });
    await window.__ENJOY_APP__.userSettings.set("gpt_engine", {
      name: "azure-openai",
      models: { default: config.deployment },
    });
    await window.__ENJOY_APP__.userSettings.set("tts_config", {
      engine: "azure",
      model: "azure/speech",
      voice: "en-US-JennyNeural",
    });
    const context = await window.__ENJOY_APP__.learning.getContext({
      refreshCapabilities: true,
    });
    const azure = context.capabilities.find((item) => item.provider === "azure-openai");
    return {
      speech,
      azure,
      profileId: context.profileId,
      connectionId: context.connectionId,
    };
  }, credential);
}

async function readJob(page: Page, jobId: string) {
  return page.evaluate(async (id) => {
    const bridge = window.__ENJOY_APP__.learning;
    return bridge.request(await bridge.getContext(), "job", { id });
  }, jobId);
}

async function waitForJob(page: Page, jobId: string): Promise<JobSnapshot> {
  let latest: JobSnapshot | undefined;
  const deadline = Date.now() + 1_080_000;
  while (Date.now() < deadline) {
    latest = await readJob(page, jobId);
    if (latest.job.state === "completed") return latest;
    if (["failed", "cancelled", "interrupted"].includes(latest.job.state)) {
      const codes = latest.attempts.map((attempt) => attempt.errorCode).filter(Boolean);
      throw new Error(`Azure learning job ${latest.job.state}: ${codes.join(",")}`);
    }
    if (
      latest.job.state === "partial" &&
      !latest.stages.some((stage) =>
        ["queued", "running", "validating", "cancelling"].includes(stage.state))
    ) {
      const codes = latest.attempts.map((attempt) => attempt.errorCode).filter(Boolean);
      throw new Error(`Azure learning job incomplete: ${codes.join(",")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(
    `Azure learning job timed out: ${sanitizeLocalDiagnostic(JSON.stringify(
      latest?.stages.map((stage) => ({ kind: stage.kind, state: stage.state })),
    ))}`,
  );
}

const azureSpeechHostCount = (capture: ProviderNetworkCapture): number =>
  Object.entries(capture.main.observedRequests).reduce((total, [key, count]) => {
    const hostname = key.split("|").at(-1) || "";
    return /(?:^|\.)speech\.microsoft\.com$/iu.test(hostname)
      ? total + count
      : total;
  }, 0);

async function openStudio(page: Page): Promise<void> {
  await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 45_000 });
  await page.getByTestId("sidebar-learning-studio").click();
  await expect(page.getByTestId("learning-studio")).toBeVisible({ timeout: 45_000 });
}

const casefoldWords = (value: string): string[] =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}]+/gu) || [];

const evaluateMapTopicQuality = (graph: MindmapGraph) => {
  const root = graph.nodes.find((node) => node.id === graph.rootNodeId);
  const nonRootNodes = graph.nodes.filter((node) => node.id !== graph.rootNodeId);
  const rootWords = new Set(casefoldWords(root?.term || ""));
  const matchedRootTopicWords = ["cafe", "drink", "drinks", "order", "ordering"]
    .filter((term) => rootWords.has(term));
  const genericNodeTerms = nonRootNodes
    .map((node) => ({ term: node.term, normalized: casefoldWords(node.term).join(" ") }))
    .filter(({ normalized }) => genericMapTerms.has(normalized))
    .map(({ term }) => term);
  const vocabularyWords = new Set(nonRootNodes.flatMap((node) => casefoldWords(node.term)));
  const matchedCommonTerms = commonCafeTerms.filter((term) => vocabularyWords.has(term));
  return {
    rootTerm: root?.term,
    matchedRootTopicWords,
    vocabularyNodeCount: nonRootNodes.length,
    vocabularyTerms: nonRootNodes.map((node) => node.term),
    genericNodeTerms,
    matchedCommonTerms,
  };
};

async function assertEveryMapNodeRendered(page: Page, graph: MindmapGraph): Promise<string[]> {
  const renderedNodeIds = new Set<string>();
  const previous = page.getByRole("button", { name: "Trang trước", exact: true });
  while (await previous.isEnabled().catch(() => false)) await previous.click();
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    await expect(page.getByTestId("study-map-page")).toBeVisible();
    const visibleNodeIds = await page.getByTestId("mindmap-view")
      .locator("[data-study-node-id]")
      .evaluateAll((nodes) => nodes
        .filter((node) => node.getClientRects().length > 0)
        .map((node) => (node as HTMLElement).dataset.studyNodeId || "")
        .filter(Boolean));
    for (const nodeId of visibleNodeIds) {
      renderedNodeIds.add(nodeId);
      await expect(page.getByTestId(`mindmap-list-node-${nodeId}`)).toBeVisible();
    }
    const next = page.getByRole("button", { name: "Trang tiếp", exact: true });
    if (!await next.isEnabled().catch(() => false)) break;
    await next.click();
  }
  expect(renderedNodeIds).toEqual(new Set(graph.nodes.map((node) => node.id)));
  return [...renderedNodeIds];
}

test("Azure generates a narrated lesson and a study map that reopen offline", async ({}, testInfo) => {
  test.setTimeout(1_500_000);
  testInfo.annotations.push({
    type: "paid-live-azure-learning",
    description:
      "Packaged Learning Studio, Azure OpenAI lesson and map generation, Azure Speech narration, disposable profile, SQLite persistence, and offline restart",
  });
  const credential = await readCredential();
  const textHost = new URL(credential.textEndpoint).hostname;
  let fixture: LocalApp | undefined;
  let primaryError: unknown;
  const receipt: Record<string, unknown> = {
    pass: false,
    packaged: true,
    profileSource: "fresh-disposable",
    provider: azureProvider,
    model: credential.deployment,
    startedAt: new Date().toISOString(),
  };

  try {
    fixture = await launchLocalApp({ offline: false });
    let page = fixture.page;
    await openStudio(page);
    const configured = await configureAzure(page, credential);
    expect(configured.speech.transcriptionConfigured).toBe(true);
    expect(configured.azure).toMatchObject({
      provider: azureProvider,
      text: true,
      image: false,
      reason: null,
    });
    receipt.profileContext = {
      profileId: configured.profileId,
      connectionId: configured.connectionId,
    };

    const baselineNetwork = await captureProviderNetwork(page);
    const lessonStarted = Date.now();
    const lessonCreated = await page.evaluate(async ({ brief, model }) => {
      const bridge = window.__ENJOY_APP__.learning;
      const context = await bridge.getContext();
      const created = await bridge.request(context, "createLesson", {
        title: "Azure live narrated lesson",
        brief,
      });
      const generation = await bridge.request(context, "generate", {
        provider: "azure-openai",
        model,
        resourceType: "lesson",
        resourceId: created.lesson.id,
        revisionId: created.revision.id,
        requestKey: crypto.randomUUID(),
      });
      return {
        lessonId: created.lesson.id,
        revisionId: created.revision.id,
        jobId: generation.jobId,
      };
    }, { brief: lessonBrief, model: credential.deployment });
    receipt.lessonCreated = lessonCreated;
    const lessonJob = await waitForJob(page, lessonCreated.jobId);
    const lessonElapsedMs = Date.now() - lessonStarted;
    const lesson = await page.evaluate(async (id) => {
      const bridge = window.__ENJOY_APP__.learning;
      return bridge.request(await bridge.getContext(), "getLesson", { id });
    }, lessonCreated.lessonId);
    const lessonRevision = lesson.revisions.find(
      (revision) => revision.id === lessonCreated.revisionId,
    );
    expect(lessonRevision?.status).toBe("ready");
    const lessonContent = lessonRevision?.content as LessonDraft;
    const lessonValidation = validateLessonDraft(lessonContent, lessonBrief);
    expect(lessonValidation.ok).toBe(true);
    expect(lessonContent.sections.length).toBeGreaterThan(0);
    expect(lessonContent.exercises.length).toBeGreaterThan(0);
    expect(lessonRevision?.provenance).toMatchObject({ provider: azureProvider });
    expect(lessonJob.stages.filter((stage) => stage.kind === "text")).toHaveLength(1);
    expect(lessonJob.stages.find((stage) => stage.kind === "text")?.state).toBe("completed");
    const audioStages = lessonJob.stages.filter((stage) => stage.kind === "audio");
    expect(audioStages).toHaveLength(lessonContent.sections.length);
    expect(audioStages.every((stage) => stage.state === "completed")).toBe(true);
    expect(
      lessonJob.attempts.some(
        (attempt) => attempt.provider === azureProvider && attempt.state === "completed",
      ),
    ).toBe(true);
    expect(
      lessonJob.attempts.filter((attempt) => attempt.provider === "speech")
        .every((attempt) => attempt.state === "completed"),
    ).toBe(true);
    const audioSlots = lesson.slots.filter((slot) => slot.kind === "audio");
    const audioAssets = audioSlots.map((slot) =>
      lesson.assets.find((asset) => asset.id === slot.selectedAssetId));
    expect(audioSlots).toHaveLength(lessonContent.sections.length);
    expect(audioAssets.every(Boolean)).toBe(true);
    for (const asset of audioAssets) {
      expect(asset?.mimeType).toMatch(/^audio\//u);
      expect(asset?.sizeBytes).toBeGreaterThan(44);
      expect(asset?.durationMs).toBeGreaterThan(0);
      expect(asset?.provenance).toMatchObject({
        provider: "azure",
        channel: "speech",
      });
    }

    const afterLessonNetwork = await captureProviderNetwork(page);
    const lessonTextRequests =
      observedHostCount(afterLessonNetwork.main, textHost) -
      observedHostCount(baselineNetwork.main, textHost);
    const lessonSpeechRequests =
      azureSpeechHostCount(afterLessonNetwork) - azureSpeechHostCount(baselineNetwork);
    expect(lessonTextRequests).toBeGreaterThan(0);
    expect(lessonSpeechRequests).toBeGreaterThan(0);

    const mapStarted = Date.now();
    const mapCreated = await page.evaluate(async (model) => {
      const bridge = window.__ENJOY_APP__.learning;
      const context = await bridge.getContext();
      const created = await bridge.request(context, "createMap", {
        title: "Azure live cafe vocabulary map",
        level: "A2",
        illustrations: false,
      });
      const generation = await bridge.request(context, "generate", {
        provider: "azure-openai",
        model,
        resourceType: "map",
        resourceId: created.map.id,
        revisionId: created.revision.id,
        requestKey: crypto.randomUUID(),
      });
      return {
        mapId: created.map.id,
        revisionId: created.revision.id,
        jobId: generation.jobId,
      };
    }, credential.deployment);
    receipt.mapCreated = mapCreated;
    const mapJob = await waitForJob(page, mapCreated.jobId);
    const mapElapsedMs = Date.now() - mapStarted;
    const map = await page.evaluate(async (id) => {
      const bridge = window.__ENJOY_APP__.learning;
      return bridge.request(await bridge.getContext(), "getMap", { id });
    }, mapCreated.mapId);
    const mapRevision = map.revisions.find(
      (revision) => revision.id === mapCreated.revisionId,
    );
    expect(mapRevision?.status).toBe("ready");
    expect(mapRevision?.brief).toEqual({ level: "A2", illustrations: false });
    const graph = mapRevision?.content as MindmapGraph;
    const mapValidation = validateGeneratedMindmapGraph(graph, mapRevision?.brief);
    expect(mapValidation.ok).toBe(true);
    expect(graph.nodes.length).toBeGreaterThan(1);
    expect(graph.studyGroups?.length).toBeGreaterThan(0);
    const groupedNodeIds = graph.studyGroups?.flatMap((group) => group.nodeIds) || [];
    expect(new Set(groupedNodeIds)).toEqual(
      new Set(graph.nodes.filter((node) => node.id !== graph.rootNodeId).map((node) => node.id)),
    );
    expect(mapRevision?.provenance).toMatchObject({ provider: azureProvider });
    expect(mapJob.stages).toHaveLength(1);
    expect(mapJob.stages[0]).toMatchObject({ kind: "map", state: "completed" });
    expect(
      mapJob.attempts.some(
        (attempt) => attempt.provider === azureProvider && attempt.state === "completed",
      ),
    ).toBe(true);
    expect(map.slots.filter((slot) => slot.kind === "image")).toHaveLength(0);

    const afterMapNetwork = await captureProviderNetwork(page);
    const mapTextRequests =
      observedHostCount(afterMapNetwork.main, textHost) -
      observedHostCount(afterLessonNetwork.main, textHost);
    expect(mapTextRequests).toBeGreaterThan(0);

    await fixture.restart({ offline: true });
    page = fixture.page;
    await openStudio(page);
    const persisted = await page.evaluate(async ({ lessonId, mapId }) => {
      const bridge = window.__ENJOY_APP__.learning;
      const context = await bridge.getContext();
      const [lessonBundle, mapBundle] = await Promise.all([
        bridge.request(context, "getLesson", { id: lessonId }),
        bridge.request(context, "getMap", { id: mapId }),
      ]);
      return { lesson: lessonBundle, map: mapBundle, context };
    }, { lessonId: lessonCreated.lessonId, mapId: mapCreated.mapId });
    const persistedLessonRevision = persisted.lesson.revisions.find(
      (revision) => revision.id === lessonCreated.revisionId,
    );
    const persistedMapRevision = persisted.map.revisions.find(
      (revision) => revision.id === mapCreated.revisionId,
    );
    expect(digest(persistedLessonRevision?.content)).toBe(digest(lessonContent));
    expect(digest(persistedMapRevision?.content)).toBe(digest(graph));
    expect(persisted.lesson.assets).toEqual(lesson.assets);

    await page.getByRole("button", { name: lesson.lesson.title, exact: true }).click();
    await expect(page.getByTestId("lesson-reader")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("lesson-reader")).toContainText(
      lessonContent.sections[0].text.slice(0, 24),
    );
    const readerAudio = [];
    for (const section of lessonContent.sections) {
      const slot = persisted.lesson.slots.find(
        (candidate) =>
          candidate.kind === "audio" &&
          candidate.sourceType === "section" &&
          candidate.sourceId === section.id,
      );
      const asset = persisted.lesson.assets.find(
        (candidate) => candidate.id === slot?.selectedAssetId,
      );
      expect(slot, `Missing narration slot for section ${section.id}`).toBeDefined();
      expect(asset, `Missing selected narration asset for section ${section.id}`).toBeDefined();
      const player = page.getByTestId(`lesson-section-audio-player-${section.id}`);
      await expect(player).toBeVisible();
      await expect.poll(
        () => player.evaluate((node: HTMLAudioElement) =>
          node.readyState >= 1 && Number.isFinite(node.duration) && node.duration > 0),
        { timeout: 30_000 },
      ).toBe(true);
      const decoded = await player.evaluate((node: HTMLAudioElement) => ({
        duration: node.duration,
        readyState: node.readyState,
        source: node.currentSrc || node.src,
      }));
      expect(decoded.readyState).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(decoded.duration)).toBe(true);
      expect(decoded.duration).toBeGreaterThan(0);
      expect(
        decodeURIComponent(new URL(decoded.source).pathname)
          .endsWith(`/${asset!.relativePath}`),
      ).toBe(true);
      readerAudio.push({
        sectionId: section.id,
        assetId: asset!.id,
        duration: decoded.duration,
        readyState: decoded.readyState,
      });
    }

    const persistedAudioReads = await page.evaluate(
      async ({ connectionId, assets }) => Promise.all(assets.map(async (asset) => {
        const url = `enjoy://library/learning-assets/${connectionId}/${asset.relativePath}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error("persisted_narration_read_failed");
        const bytes = new Uint8Array(await response.arrayBuffer());
        const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
        return {
          assetId: asset.id,
          status: response.status,
          contentType: response.headers.get("content-type"),
          byteCount: bytes.byteLength,
          sha256: Array.from(hash, (value) => value.toString(16).padStart(2, "0")).join(""),
        };
      })),
      {
        connectionId: persisted.context.connectionId,
        assets: persisted.lesson.assets.filter((asset) => asset.kind === "audio"),
      },
    );
    expect(persistedAudioReads).toHaveLength(audioAssets.length);
    for (const read of persistedAudioReads) {
      const asset = persisted.lesson.assets.find((candidate) => candidate.id === read.assetId);
      expect(asset).toBeDefined();
      expect(read.status).toBe(200);
      expect(read.contentType).toBe(asset!.mimeType);
      expect(read.byteCount).toBe(asset!.sizeBytes);
      expect(read.sha256).toBe(asset!.sha256);
    }

    await page.getByTestId("sidebar-learning-studio").click();
    await page.getByRole("button", { name: map.map.title, exact: true }).click();
    await expect(page.getByTestId("mindmap-view")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId(`mindmap-list-node-${graph.rootNodeId}`)).toBeVisible();

    const offlineNetwork = await captureProviderNetwork(page);
    expect(observedHostCount(offlineNetwork.main, textHost)).toBe(0);
    expect(azureSpeechHostCount(offlineNetwork)).toBe(0);
    fixture.assertNoRuntimeIssues();

    receipt.pass = true;
    receipt.capability = configured.azure;
    receipt.lesson = {
      elapsedMs: lessonElapsedMs,
      id: lessonCreated.lessonId,
      revisionId: lessonCreated.revisionId,
      revisionStatus: lessonRevision?.status,
      provenance: lessonRevision?.provenance,
      content: lessonContent,
      validation: lessonValidation,
      contentSha256: digest(lessonContent),
      audioAssets,
      job: lessonJob,
    };
    receipt.map = {
      elapsedMs: mapElapsedMs,
      id: mapCreated.mapId,
      revisionId: mapCreated.revisionId,
      revisionStatus: mapRevision?.status,
      provenance: mapRevision?.provenance,
      graph,
      validation: mapValidation,
      graphSha256: digest(graph),
      job: mapJob,
    };
    receipt.network = {
      textHost,
      lessonTextRequests,
      mapTextRequests,
      lessonSpeechRequests,
      afterLesson: afterLessonNetwork,
      afterMap: afterMapNetwork,
      afterOfflineRestart: offlineNetwork,
    };
    receipt.persistence = {
      lessonContentSha256: digest(persistedLessonRevision?.content),
      mapContentSha256: digest(persistedMapRevision?.content),
      audioAssetsStable: true,
      narrationAssetProtocolReads: persistedAudioReads,
      readerAudioMetadata: readerAudio,
      narrationBytesHashMatched: true,
      narrationDecodedAfterOfflineRestart: true,
      renderedLesson: true,
      renderedMap: true,
      offlineRestartVerified: true,
    };
    receipt.runtime = fixture.runtimeDiagnostics();
  } catch (error) {
    primaryError = error;
    if (fixture) {
      receipt.failedResources = await fixture.page.evaluate(async (created) => {
        const bridge = window.__ENJOY_APP__.learning;
        const context = await bridge.getContext();
        const result: Record<string, unknown> = {};
        if (created.lesson) {
          result.lesson = await bridge.request(context, "getLesson", { id: created.lesson.lessonId });
          result.lessonJob = await bridge.request(context, "job", { id: created.lesson.jobId });
        }
        if (created.map) {
          result.map = await bridge.request(context, "getMap", { id: created.map.mapId });
          result.mapJob = await bridge.request(context, "job", { id: created.map.jobId });
        }
        return result;
      }, {
        lesson: receipt.lessonCreated as { lessonId: string; jobId: string } | undefined,
        map: receipt.mapCreated as { mapId: string; jobId: string } | undefined,
      }).catch(() => ({ diagnosticsUnavailable: true }));
    }
    receipt.failure = sanitizeLocalDiagnostic(
      error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    ).replaceAll(credential.key, "<redacted>");
    throw error;
  } finally {
    receipt.finishedAt = new Date().toISOString();
    await writeReceipt(testInfo, "azure-learning-live.json", receipt);
    await fixture?.close().catch((error) => {
      if (!primaryError) throw error;
    });
  }
});

test("[azure-map-topic] Azure creates a concrete cafe vocabulary map and reopens it offline", async ({}, testInfo) => {
  test.setTimeout(1_200_000);
  testInfo.annotations.push({
    type: "paid-live-azure-map-topic",
    description:
      "Packaged Learning Studio, Azure OpenAI map generation, topic-specific vocabulary, disposable profile, SQLite persistence, and offline restart",
  });
  const credential = await readCredential();
  const textHost = new URL(credential.textEndpoint).hostname;
  let fixture: LocalApp | undefined;
  let primaryError: unknown;
  const receipt: Record<string, unknown> = {
    pass: false,
    packaged: true,
    profileSource: "fresh-disposable",
    provider: azureProvider,
    model: credential.deployment,
    title: mapTopicTitle,
    brief: mapBrief,
    startedAt: new Date().toISOString(),
  };

  try {
    fixture = await launchLocalApp({ offline: false });
    let page = fixture.page;
    await openStudio(page);
    const configured = await configureAzure(page, credential);
    expect(configured.azure).toMatchObject({
      provider: azureProvider,
      text: true,
      image: false,
      reason: null,
    });
    receipt.profileContext = {
      profileId: configured.profileId,
      connectionId: configured.connectionId,
    };
    receipt.capability = configured.azure;

    const baselineNetwork = await captureProviderNetwork(page);
    expect(baselineNetwork.main.legacyBackendOperationCount).toBe(0);
    expect(baselineNetwork.renderer.legacyBackendOperationCount).toBe(0);
    const started = Date.now();
    const created = await page.evaluate(async ({ title, brief, model }) => {
      const bridge = window.__ENJOY_APP__.learning;
      const context = await bridge.getContext();
      const map = await bridge.request(context, "createMap", { title, ...brief });
      const generation = await bridge.request(context, "generate", {
        provider: "azure-openai",
        model,
        resourceType: "map",
        resourceId: map.map.id,
        revisionId: map.revision.id,
        requestKey: crypto.randomUUID(),
      });
      return {
        mapId: map.map.id,
        revisionId: map.revision.id,
        jobId: generation.jobId,
      };
    }, { title: mapTopicTitle, brief: mapBrief, model: credential.deployment });
    receipt.created = created;

    const job = await waitForJob(page, created.jobId);
    expect(job.job.state).toBe("completed");
    expect(job.stages).toHaveLength(1);
    expect(job.stages[0]).toMatchObject({ kind: "map", state: "completed" });
    expect(job.stages.filter((stage) => stage.kind === "image")).toHaveLength(0);
    expect(job.stages.filter((stage) => stage.kind === "audio")).toHaveLength(0);
    expect(job.attempts.some(
      (attempt) => attempt.provider === azureProvider && attempt.state === "completed",
    )).toBe(true);
    expect(job.attempts.filter((attempt) => attempt.provider === "speech")).toHaveLength(0);

    const map = await page.evaluate(async (id) => {
      const bridge = window.__ENJOY_APP__.learning;
      return bridge.request(await bridge.getContext(), "getMap", { id });
    }, created.mapId);
    expect(map.map.title).toBe(mapTopicTitle);
    const revision = map.revisions.find((item) => item.id === created.revisionId);
    expect(revision?.status).toBe("ready");
    expect(revision?.brief).toEqual(mapBrief);
    expect(revision?.provenance).toMatchObject({ provider: azureProvider });
    const graph = revision?.content as MindmapGraph;
    const validation = validateGeneratedMindmapGraph(graph, revision?.brief);
    expect(validation.ok).toBe(true);
    const topicQuality = evaluateMapTopicQuality(graph);
    expect(topicQuality.matchedRootTopicWords.length).toBeGreaterThan(0);
    expect(topicQuality.vocabularyNodeCount).toBeGreaterThanOrEqual(6);
    expect(topicQuality.genericNodeTerms).toEqual([]);
    expect(topicQuality.matchedCommonTerms.length).toBeGreaterThanOrEqual(3);
    expect(map.slots.filter((slot) => slot.kind === "image")).toHaveLength(0);
    const graphSha256 = digest(graph);

    const afterProviderNetwork = await captureProviderNetwork(page);
    const azureTextRequestCount =
      observedHostCount(afterProviderNetwork.main, textHost) -
      observedHostCount(baselineNetwork.main, textHost);
    const azureSpeechRequestCount =
      azureSpeechHostCount(afterProviderNetwork) - azureSpeechHostCount(baselineNetwork);
    expect(azureTextRequestCount).toBeGreaterThan(0);
    expect(azureSpeechRequestCount).toBe(0);
    expect(afterProviderNetwork.main.legacyBackendOperationCount).toBe(0);
    expect(afterProviderNetwork.renderer.legacyBackendOperationCount).toBe(0);

    await fixture.restart({ offline: true });
    page = fixture.page;
    await openStudio(page);
    const persisted = await page.evaluate(async (id) => {
      const bridge = window.__ENJOY_APP__.learning;
      return bridge.request(await bridge.getContext(), "getMap", { id });
    }, created.mapId);
    const persistedRevision = persisted.revisions.find(
      (item) => item.id === created.revisionId,
    );
    expect(persisted.map.title).toBe(mapTopicTitle);
    expect(persistedRevision?.brief).toEqual(mapBrief);
    expect(digest(persistedRevision?.content)).toBe(graphSha256);
    await page.getByRole("button", { name: mapTopicTitle, exact: true }).click();
    await expect(page.getByTestId("mindmap-view")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId(`mindmap-list-node-${graph.rootNodeId}`)).toBeVisible();
    const renderedNodeIds = await assertEveryMapNodeRendered(page, graph);

    const offlineNetwork = await captureProviderNetwork(page);
    expect(observedHostCount(offlineNetwork.main, textHost)).toBe(0);
    expect(azureSpeechHostCount(offlineNetwork)).toBe(0);
    expect(offlineNetwork.main.legacyBackendOperationCount).toBe(0);
    expect(offlineNetwork.renderer.legacyBackendOperationCount).toBe(0);
    fixture.assertNoRuntimeIssues();

    receipt.pass = true;
    receipt.elapsedMs = Date.now() - started;
    receipt.map = {
      id: created.mapId,
      revisionId: created.revisionId,
      title: map.map.title,
      brief: revision?.brief,
      revisionStatus: revision?.status,
      provenance: revision?.provenance,
      graph,
      validation,
      graphSha256,
      job,
    };
    receipt.topicQuality = topicQuality;
    receipt.network = {
      textHost,
      azureTextRequestCount,
      azureSpeechRequestCount,
      imageStageCount: 0,
      zeroEnjoyBackendOperations: true,
      baseline: baselineNetwork,
      afterProvider: afterProviderNetwork,
      afterOfflineRestart: offlineNetwork,
    };
    receipt.persistence = {
      title: persisted.map.title,
      brief: persistedRevision?.brief,
      graphSha256: digest(persistedRevision?.content),
      renderedNodeIds,
      offlineRestartVerified: true,
    };
    receipt.runtime = fixture.runtimeDiagnostics();
  } catch (error) {
    primaryError = error;
    if (fixture) {
      receipt.failedResource = await fixture.page.evaluate(async (created) => {
        if (!created) return undefined;
        const bridge = window.__ENJOY_APP__.learning;
        const context = await bridge.getContext();
        const [map, job] = await Promise.all([
          bridge.request(context, "getMap", { id: created.mapId }),
          bridge.request(context, "job", { id: created.jobId }),
        ]);
        return { map, job };
      }, receipt.created as { mapId: string; jobId: string } | undefined)
        .catch(() => ({ diagnosticsUnavailable: true }));
    }
    receipt.failure = sanitizeLocalDiagnostic(
      error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    ).replaceAll(credential.key, "<redacted>");
    throw error;
  } finally {
    receipt.finishedAt = new Date().toISOString();
    await writeReceipt(testInfo, "azure-map-topic-live.json", receipt);
    await fixture?.close().catch((error) => {
      if (!primaryError) throw error;
    });
  }
});
