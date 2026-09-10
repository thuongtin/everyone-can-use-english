import assert from "node:assert/strict";
import { access, mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";
import { Sequelize } from "sequelize";

import { learningBrief, learningDraft, learningMap } from "./fixtures/learning-lesson.mjs";
import {
  acceptingAdapter,
  blockingAdapter,
  failingAdapter,
  proseOnlyAdapter,
  retryableCleanupAdapter,
} from "./fixtures/native-generation-adapter.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(root, ".tmp-native-generation-"));
const output = path.join(temp, "subject.mjs");
let db;
let runtime;

const testPlugins = [{
  name: "node-test-electron",
  setup(builder) {
    builder.onResolve({ filter: /db\/models\/user-setting$/ }, () => ({ path: "user-setting", namespace: "user-setting-test" }));
    builder.onLoad({ filter: /.*/, namespace: "user-setting-test" }, () => ({
      contents: "export class UserSetting { static async get() { return null; } }",
      loader: "js",
    }));
    builder.onResolve({ filter: /^lodash\/[^.]+$/ }, (args) => ({ path: `${args.path}.js`, external: true }));
    builder.onResolve({ filter: /^dayjs\/(?:locale|plugin)\/[^.]+$/ }, (args) => ({ path: `${args.path}.js`, external: true }));
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "electron-test" }));
    builder.onLoad({ filter: /.*/, namespace: "electron-test" }, () => ({
      contents: `
        export class BrowserWindow { static getAllWindows() { return []; } }
        export class WebContentsView {}
        export class Menu {}
        export const app = { getPath() { return ""; }, isPackaged: false };
        export const autoUpdater = {};
        export const dialog = {};
        export const ipcMain = { handle() {}, removeHandler() {}, on() {} };
        export const protocol = {};
        export const safeStorage = {
          isEncryptionAvailable() { return true; },
          encryptString(value) { return Buffer.from(value); },
          decryptString(value) { return Buffer.from(value).toString("utf8"); },
        };
        export const session = {};
        export const shell = {};
        export const systemPreferences = {};
      `,
      loader: "js",
    }));
    builder.onResolve({ filter: /^electron-log\/main$/ }, () => ({ path: "electron-log/main.js", external: true }));
  },
}];

const observations = () => ({ runs: 0, requests: [], abortObserved: false });
const pin = Object.freeze({
  path: process.execPath,
  realpath: process.execPath,
  sha256: "0".repeat(64),
  size: 1,
  mtimeMs: 1,
});
const readyProbe = async (provider) => ({
  provider,
  executable: pin,
  version: "fixture",
  authenticated: true,
  text: true,
  image: provider === "codex",
  reason: null,
});

async function waitFor(read, accept, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`${label}: ${JSON.stringify(value)}`);
}

async function expectMissing(target) {
  await assert.rejects(access(target), (error) => error?.code === "ENOENT");
}

async function waitForMissing(target, label) {
  await waitFor(
    async () => access(target).then(() => false, (error) => error?.code === "ENOENT"),
    Boolean,
    label,
  );
}

try {
  await build({
    entryPoints: [path.join(root, "src/main/learning/native-generation.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    packages: "external",
    plugins: testPlugins,
    logLevel: "silent",
  });
  const [{ NativeLearningGeneration }, { LearningRuntime }] = await Promise.all([
    import(`${pathToFileURL(output).href}?native=${Date.now()}`),
    (async () => {
      const runtimeOutput = path.join(temp, "runtime.mjs");
      await build({
        entryPoints: [path.join(root, "src/main/learning/runtime.ts")],
        bundle: true,
        platform: "node",
        format: "esm",
        outfile: runtimeOutput,
        packages: "external",
        plugins: testPlugins,
        logLevel: "silent",
      });
      return import(`${pathToFileURL(runtimeOutput).href}?runtime=${Date.now()}`);
    })(),
  ]);
  const migration = await import(pathToFileURL(path.join(root, "src/main/db/migrations/1788701024340-create-learning-studio.js")).href);
  db = new Sequelize({ dialect: "sqlite", storage: path.join(temp, "learning.sqlite"), logging: false });
  await migration.up({ context: db.getQueryInterface() });
  const mapBriefMigration = await import(pathToFileURL(path.join(root, "src/main/db/migrations/1788789600000-add-learning-map-brief.js")).href);
  await mapBriefMigration.up({ context: db.getQueryInterface() });
  runtime = await LearningRuntime.open({
    sequelize: db,
    profileId: "native-generation-profile",
    assetRoot: path.join(temp, "profile", "assets"),
    watchdogMs: 0,
  });

  const capabilityDispatcher = new NativeLearningGeneration(runtime, {
    imageProbe: readyProbe,
    probe: async (provider) => provider === "codex"
      ? readyProbe(provider)
      : { provider, executable: null, version: null, authenticated: false, text: false, image: false, reason: "native_auth_unconfirmed" },
    adapters: {},
  });
  assert.deepEqual(await capabilityDispatcher.capabilities(), [
    { provider: "codex", text: true, image: true, reason: null },
    { provider: "claude", text: false, image: false, reason: "native_auth_unconfirmed" },
    { provider: "azure-openai", text: false, image: false, reason: "azure_text_not_configured" },
  ]);
  let resolveStaleAzureConfig;
  const staleAzureConfig = new Promise((resolve) => { resolveStaleAzureConfig = resolve; });
  let azureConfigReads = 0;
  const capabilityRefreshDispatcher = new NativeLearningGeneration(runtime, {
    probe: readyProbe,
    imageProbe: readyProbe,
    azureTextConfigFactory: async () => {
      azureConfigReads += 1;
      return azureConfigReads === 1 ? staleAzureConfig : {
        key: "fresh-key",
        baseUrl: "https://fixture.openai.azure.com/openai/v1",
        modelName: "fresh-deployment",
      };
    },
  });
  const staleCapabilities = capabilityRefreshDispatcher.capabilities();
  const freshCapabilities = capabilityRefreshDispatcher.capabilities({ fresh: true });
  assert.equal((await freshCapabilities).find(item => item.provider === "azure-openai")?.text, true);
  resolveStaleAzureConfig(null);
  assert.equal((await staleCapabilities).find(item => item.provider === "azure-openai")?.text, false);
  assert.equal(azureConfigReads, 2, "explicit capability refresh must not reuse a pre-configuration probe");
  const unavailableLesson = await runtime.storage.createLesson({ brief: learningBrief });
  const jobsBeforeUnavailable = await runtime.storage.models.GenerationJob.count();
  await assert.rejects(capabilityDispatcher.generate({
    provider: "claude",
    resourceType: "lesson",
    resourceId: unavailableLesson.lesson.id,
    revisionId: unavailableLesson.revision.id,
    requestKey: "unavailable-provider",
  }), { code: "native_auth_unconfirmed" });
  assert.equal(await runtime.storage.models.GenerationJob.count(), jobsBeforeUnavailable);

  const acceptedLesson = await runtime.storage.createLesson({ brief: learningBrief });
  const acceptedObservations = observations();
  const acceptedDispatcher = new NativeLearningGeneration(runtime, {
    probe: readyProbe,
    imageProbe: readyProbe,
    adapters: { codex: acceptingAdapter("codex", learningDraft, acceptedObservations) },
  });
  const acceptedInput = {
    provider: "codex",
    resourceType: "lesson",
    resourceId: acceptedLesson.lesson.id,
    revisionId: acceptedLesson.revision.id,
    requestKey: "accepted-lesson",
  };
  const acceptedJob = await acceptedDispatcher.generate(acceptedInput);
  const acceptedState = await waitFor(
    () => runtime.application.jobs.get(acceptedJob.jobId),
    (state) => state.job.state === "completed",
    "MCP accepted lesson did not complete",
  );
  assert.equal(acceptedState.stages[0].state, "completed");
  assert.equal(acceptedState.attempts[0].state, "completed");
  assert.deepEqual((await runtime.storage.getLesson(acceptedLesson.lesson.id)).revisions[0].content, learningDraft);
  assert.equal(acceptedObservations.runs, 1);
  assert.match(acceptedObservations.requests[0].prompt, /enjoy\.get_job_context/u);
  assert.match(acceptedObservations.requests[0].prompt, /enjoy\.submit_lesson_draft/u);
  assert.equal(acceptedObservations.requests[0].timeoutMs, 600_000);
  const acceptedRoot = path.dirname(acceptedObservations.requests[0].workspace);
  assert.equal(path.dirname(acceptedObservations.requests[0].privateHome), acceptedRoot);
  assert.equal((await stat(path.dirname(acceptedRoot))).mode & 0o777, 0o700);
  await waitForMissing(acceptedRoot, "accepted attempt workspace was not removed");
  await assert.rejects(fetch(acceptedObservations.requests[0].mcp.url));
  assert.deepEqual(await acceptedDispatcher.generate(acceptedInput), acceptedJob);
  assert.equal(acceptedObservations.runs, 1, "duplicate requestKey relaunched a completed attempt");

  const azureConfig = {
    key: "fixture-key",
    baseUrl: "https://fixture.openai.azure.com/openai/v1",
    modelName: "fixture-deployment",
    maxTokens: 12_000,
  };
  const azureLesson = await runtime.storage.createLesson({ brief: learningBrief });
  const azureRequests = [];
  const azureDispatcher = new NativeLearningGeneration(runtime, {
    azureTextConfigFactory: async () => azureConfig,
    azureTextRunner: async (request) => {
      azureRequests.push({ ...request, signalWasAborted: request.signal.aborted });
      await request.application.submitTrustedCandidate(request.identity, "text", learningDraft);
    },
  });
  assert.deepEqual((await azureDispatcher.capabilities()).at(-1), {
    provider: "azure-openai",
    text: true,
    image: false,
    reason: null,
  });
  const azureJob = await azureDispatcher.generate({
    provider: "azure-openai",
    model: "override-deployment",
    resourceType: "lesson",
    resourceId: azureLesson.lesson.id,
    revisionId: azureLesson.revision.id,
    requestKey: "accepted-azure-lesson",
  });
  const azureState = await waitFor(
    () => runtime.application.jobs.get(azureJob.jobId),
    (state) => state.job.state === "completed",
    "Azure accepted lesson did not complete",
  );
  assert.equal(azureState.attempts[0].provider, "azure-openai");
  assert.equal(azureRequests.length, 1);
  assert.equal(azureRequests[0].config.modelName, "override-deployment");
  assert.equal(azureRequests[0].resourceType, "lesson");
  assert.equal(azureRequests[0].signalWasAborted, false);
  const azureBundle = await runtime.storage.getLesson(azureLesson.lesson.id);
  assert.deepEqual(azureBundle.revisions[0].content, learningDraft);
  assert.equal(azureBundle.revisions[0].provenance.provider, "azure-openai");

  const azureRetryLesson = await runtime.storage.createLesson({ brief: learningBrief });
  let azureRetryRuns = 0;
  const azureRetryDispatcher = new NativeLearningGeneration(runtime, {
    azureTextConfigFactory: async () => azureConfig,
    azureTextRunner: async (request) => {
      azureRetryRuns += 1;
      if (azureRetryRuns === 1) throw Object.assign(new Error("fixture invalid"), { code: "azure_text_invalid" });
      await request.application.submitTrustedCandidate(request.identity, "text", learningDraft);
    },
  });
  const azureRetryJob = await azureRetryDispatcher.generate({
    provider: "azure-openai",
    resourceType: "lesson",
    resourceId: azureRetryLesson.lesson.id,
    revisionId: azureRetryLesson.revision.id,
    requestKey: "azure-retry",
  });
  const azureFailedState = await waitFor(
    () => runtime.application.jobs.get(azureRetryJob.jobId),
    (state) => state.job.state === "failed",
    "Azure invalid result did not fail",
  );
  assert.equal(azureFailedState.attempts[0].errorCode, "azure_text_invalid");
  await azureRetryDispatcher.retry({
    jobId: azureRetryJob.jobId,
    stageId: azureFailedState.stages[0].id,
    provider: "azure-openai",
  });
  const azureRetriedState = await waitFor(
    () => runtime.application.jobs.get(azureRetryJob.jobId),
    (state) => state.job.state === "completed",
    "Azure retry did not complete",
  );
  assert.deepEqual(azureRetriedState.attempts.map((attempt) => attempt.provider), ["azure-openai", "azure-openai"]);

  const acceptedMap = await runtime.storage.createMap({ title: "Tea map" });
  const mapObservations = observations();
  const mapDispatcher = new NativeLearningGeneration(runtime, {
    probe: readyProbe,
    imageProbe: readyProbe,
    adapters: { claude: acceptingAdapter("claude", learningMap, mapObservations) },
  });
  const mapJob = await mapDispatcher.generate({
    provider: "claude",
    resourceType: "map",
    resourceId: acceptedMap.map.id,
    revisionId: acceptedMap.revision.id,
    requestKey: "accepted-map",
  });
  const mapState = await waitFor(
    () => runtime.application.jobs.get(mapJob.jobId),
    (state) => state.job.state === "completed",
    "MCP accepted map did not complete",
  );
  assert.equal(mapState.stages[0].kind, "map");
  assert.deepEqual((await runtime.storage.getMap(acceptedMap.map.id)).revisions[0].content, learningMap);
  assert.match(mapObservations.requests[0].prompt, /enjoy\.submit_mindmap/u);

  const assetBrief = { ...learningBrief, imageCount: 1, audio: true };
  const assetDraft = {
    ...learningDraft,
    scenes: [{
      id: "scene-one",
      description: "A learner drinks tea from a cup in a warm cafe.",
      sectionIds: ["section-one"],
      targetIds: ["cup"],
    }],
  };
  const assetLesson = await runtime.storage.createLesson({ brief: assetBrief });
  const assetTextObservations = observations();
  const assetEvents = [];
  const imageAdapter = proseOnlyAdapter("codex", observations());
  const speechProvider = { id: "fixture-speech", model: "fixture", voice: "fixture", synthesize: async () => assert.fail("dispatcher fixture runner owns synthesis") };
  let activeAssets = 0;
  let maxActiveAssets = 0;
  let speechFactoryCalls = 0;
  const commitAssetStage = async (input) => {
    await input.runtime.storage.write(async (transaction) => {
      const profileId = input.runtime.scope.context.profileId;
      const stageRow = await input.runtime.storage.models.GenerationStage.findOne({ where: { id: input.stage.id, profileId }, transaction });
      const attemptRow = await input.runtime.storage.models.StageAttempt.findOne({ where: { id: input.attempt.id, profileId }, transaction });
      const jobRow = await input.runtime.storage.models.GenerationJob.findOne({ where: { id: input.job.id, profileId }, transaction });
      assert.ok(stageRow && attemptRow && jobRow);
      await stageRow.update({ state: "completed" }, { transaction });
      await attemptRow.update({ state: "completed", finishedAt: new Date() }, { transaction });
      const stages = await input.runtime.storage.models.GenerationStage.findAll({ where: { jobId: input.job.id, profileId }, transaction });
      await jobRow.update({ state: stages.every((candidate) => candidate.state === "completed") ? "completed" : "partial" }, { transaction });
    });
  };
  const mapNarrationAssetId = "10000000-0000-4000-8000-000000000001";
  const mapNarrationEvents = [];
  let markMapNarrationStarted;
  const mapNarrationStarted = new Promise((resolve) => { markMapNarrationStarted = resolve; });
  let releaseMapNarration;
  const mapNarrationGate = new Promise((resolve) => { releaseMapNarration = resolve; });
  const mapNarrationSpeech = {
    id: "fixture-map-speech",
    model: "fixture-map-model",
    voice: "fixture-map-voice",
    synthesize: async () => assert.fail("dispatcher fixture runner owns map narration synthesis"),
  };
  const mapNarrationDispatcher = new NativeLearningGeneration(runtime, {
    assetRunner: async (input) => {
      mapNarrationEvents.push({ kind: input.stage.kind, provider: input.attempt.provider, speechProvider: input.speechProvider });
      markMapNarrationStarted();
      await mapNarrationGate;
      await input.runtime.storage.write(async (transaction) => {
        const profileId = input.runtime.scope.context.profileId;
        const slot = await input.runtime.storage.models.AssetSlot.findOne({
          where: { id: input.stage.slotId, profileId },
          transaction,
        });
        assert.ok(slot);
        await input.runtime.storage.models.GeneratedAsset.create({
          id: mapNarrationAssetId,
          profileId,
          slotId: slot.id,
          relativePath: `${mapNarrationAssetId}.wav`,
          kind: "audio",
          mimeType: "audio/wav",
          sha256: "1".repeat(64),
          sizeBytes: 44,
          width: null,
          height: null,
          durationMs: 1,
          provenance: { provider: "fixture-map-speech" },
        }, { transaction });
        await slot.update({ selectedAssetId: mapNarrationAssetId }, { transaction });
      });
      await commitAssetStage(input);
    },
    speechProviderFactory: async () => mapNarrationSpeech,
  });
  const mapNarrationInput = {
    mapId: acceptedMap.map.id,
    revisionId: acceptedMap.revision.id,
    nodeId: learningMap.rootNodeId,
    requestKey: "narrate-map-root",
  };
  const mapNarrationJob = await mapNarrationDispatcher.narrateMapNode(mapNarrationInput);
  assert.ok(mapNarrationJob.jobId);
  assert.equal(mapNarrationJob.assetId, null);
  await mapNarrationStarted;
  let duplicateMapNarration;
  try {
    duplicateMapNarration = await mapNarrationDispatcher.narrateMapNode(mapNarrationInput);
  } finally {
    releaseMapNarration();
  }
  assert.deepEqual(duplicateMapNarration, mapNarrationJob);
  assert.equal(mapNarrationEvents.length, 1, "duplicate map narration request relaunched speech");
  const mapNarrationState = await waitFor(
    () => runtime.application.jobs.get(mapNarrationJob.jobId),
    (state) => state.job.state === "completed",
    "map node narration did not complete",
  );
  assert.equal(mapNarrationState.job.resourceType, "map");
  assert.equal(mapNarrationState.stages[0].kind, "audio");
  assert.equal(mapNarrationState.attempts[0].provider, "speech");
  assert.equal(mapNarrationEvents.length, 1);
  assert.equal(mapNarrationEvents[0].speechProvider, mapNarrationSpeech);
  const narratedMap = await runtime.storage.getMap(acceptedMap.map.id);
  const narrationSlot = narratedMap.slots.find((slot) => slot.sourceId === learningMap.rootNodeId && slot.kind === "audio");
  assert.ok(narrationSlot);
  assert.equal(narrationSlot.slotKey, `${acceptedMap.revision.id}:audio:${learningMap.rootNodeId}`);
  assert.equal(narrationSlot.selectedAssetId, mapNarrationAssetId);
  assert.deepEqual(await mapNarrationDispatcher.narrateMapNode(mapNarrationInput), {
    jobId: null,
    assetId: mapNarrationAssetId,
  });
  assert.equal(mapNarrationEvents.length, 1, "selected map narration was regenerated");

  const alternateMapNode = learningMap.nodes.find((node) => node.id !== learningMap.rootNodeId);
  assert.ok(alternateMapNode);
  const slotsBeforeConflictingRequest = await runtime.storage.models.AssetSlot.count({
    where: { mapRevisionId: acceptedMap.revision.id },
  });
  await assert.rejects(mapNarrationDispatcher.narrateMapNode({
    ...mapNarrationInput,
    nodeId: alternateMapNode.id,
  }), { code: "learning_request_conflict" });
  assert.equal(await runtime.storage.models.AssetSlot.count({
    where: { mapRevisionId: acceptedMap.revision.id },
  }), slotsBeforeConflictingRequest, "failed job creation left an empty map narration slot");
  assert.equal(await runtime.storage.models.AssetSlot.count({
    where: {
      mapRevisionId: acceptedMap.revision.id,
      sourceType: "node",
      sourceId: alternateMapNode.id,
      kind: "audio",
    },
  }), 0);

  const draftMap = await runtime.storage.createMap({ title: "Draft narration map" });
  await assert.rejects(mapNarrationDispatcher.narrateMapNode({
    mapId: draftMap.map.id,
    revisionId: draftMap.revision.id,
    nodeId: learningMap.rootNodeId,
    requestKey: "narrate-draft-map",
  }), { code: "learning_revision_conflict" });
  assert.equal(await runtime.storage.models.AssetSlot.count({ where: { mapRevisionId: draftMap.revision.id } }), 0);

  const assetRunner = async (input) => {
    activeAssets++;
    maxActiveAssets = Math.max(maxActiveAssets, activeAssets);
    try {
      assetEvents.push({
        kind: input.stage.kind,
        provider: input.attempt.provider,
        root: path.dirname(input.workspace),
        imageAdapter: input.adapter,
        speechProvider: input.speechProvider,
      });
      assert.equal(path.dirname(input.privateHome), path.dirname(input.workspace));
      await new Promise((resolve) => setTimeout(resolve, 5));
      await commitAssetStage(input);
    } finally {
      activeAssets--;
    }
  };
  const assetDispatcher = new NativeLearningGeneration(runtime, {
    imageAdapter,
    probe: readyProbe,
    imageProbe: readyProbe,
    adapters: {
      claude: acceptingAdapter("claude", assetDraft, assetTextObservations),
      codex: imageAdapter,
    },
    assetRunner,
    speechProviderFactory: async () => {
      speechFactoryCalls++;
      return speechProvider;
    },
  });
  const assetJob = await assetDispatcher.generate({
    provider: "claude",
    resourceType: "lesson",
    resourceId: assetLesson.lesson.id,
    revisionId: assetLesson.revision.id,
    requestKey: "sequential-assets",
  });
  const assetState = await waitFor(
    () => runtime.application.jobs.get(assetJob.jobId),
    (state) => state.job.state === "completed" && state.stages.length === 3,
    "queued assets did not drain after accepted text",
  );
  assert.deepEqual(new Set(assetEvents.map((event) => event.kind)), new Set(["image", "audio"]));
  assert.equal(maxActiveAssets, 1);
  assert.equal(assetEvents.find((event) => event.kind === "image").provider, "codex");
  assert.equal(assetEvents.find((event) => event.kind === "image").imageAdapter, imageAdapter);
  assert.equal(assetEvents.find((event) => event.kind === "audio").provider, "speech");
  assert.equal(assetEvents.find((event) => event.kind === "audio").speechProvider, speechProvider);
  assert.equal(speechFactoryCalls, 1);
  assert.equal(assetState.attempts.length, 3);
  for (const event of assetEvents) await waitForMissing(event.root, `${event.kind} workspace was not removed`);

  const assetBundleBeforeVariant = await runtime.storage.getLesson(assetLesson.lesson.id);
  const variantSlot = assetBundleBeforeVariant.slots.find((slot) => slot.kind === "image");
  assert.ok(variantSlot);
  const oldVariantAssetId = "20000000-0000-4000-8000-000000000001";
  const newVariantAssetId = "20000000-0000-4000-8000-000000000002";
  await runtime.storage.write(async (transaction) => {
    await runtime.storage.models.GeneratedAsset.create({
      id: oldVariantAssetId,
      profileId: runtime.scope.context.profileId,
      slotId: variantSlot.id,
      relativePath: `${oldVariantAssetId}.png`,
      kind: "image",
      mimeType: "image/png",
      sha256: "2".repeat(64),
      sizeBytes: 100,
      width: 10,
      height: 10,
      durationMs: null,
      provenance: { provider: "fixture-old-image" },
    }, { transaction });
    await runtime.storage.models.AssetSlot.update(
      { selectedAssetId: oldVariantAssetId },
      { where: { id: variantSlot.id, profileId: runtime.scope.context.profileId }, transaction },
    );
  });

  const variantEvents = [];
  let markVariantStarted;
  const variantStarted = new Promise((resolve) => { markVariantStarted = resolve; });
  let releaseVariant;
  const variantGate = new Promise((resolve) => { releaseVariant = resolve; });
  const variantDispatcher = new NativeLearningGeneration(runtime, {
    imageAdapter,
    probe: readyProbe,
    imageProbe: readyProbe,
    adapters: { codex: imageAdapter },
    assetRunner: async (input) => {
      variantEvents.push({ provider: input.attempt.provider, adapter: input.adapter, slotId: input.stage.slotId });
      markVariantStarted();
      await variantGate;
      await input.runtime.storage.write(async (transaction) => {
        const profileId = input.runtime.scope.context.profileId;
        const slot = await input.runtime.storage.models.AssetSlot.findOne({
          where: { id: input.stage.slotId, profileId },
          transaction,
        });
        assert.ok(slot);
        assert.equal(slot.selectedAssetId, oldVariantAssetId);
        await input.runtime.storage.models.GeneratedAsset.create({
          id: newVariantAssetId,
          profileId,
          slotId: slot.id,
          relativePath: `${newVariantAssetId}.png`,
          kind: "image",
          mimeType: "image/png",
          sha256: "3".repeat(64),
          sizeBytes: 120,
          width: 12,
          height: 10,
          durationMs: null,
          provenance: { provider: "fixture-new-image" },
        }, { transaction });
        await slot.update({ selectedAssetId: newVariantAssetId }, { transaction });
      });
      await commitAssetStage(input);
    },
  });
  const variantJobsBeforeValidation = await runtime.storage.models.GenerationJob.count();
  await assert.rejects(variantDispatcher.generateAsset({
    resourceType: "lesson",
    resourceId: acceptedLesson.lesson.id,
    revisionId: acceptedLesson.revision.id,
    slotId: variantSlot.id,
    requestKey: "variant-wrong-scope",
  }), { code: "learning_slot_mismatch" });
  await assert.rejects(variantDispatcher.generateAsset({
    resourceType: "lesson",
    resourceId: assetLesson.lesson.id,
    revisionId: acceptedLesson.revision.id,
    slotId: variantSlot.id,
    requestKey: "variant-stale-revision",
  }), { code: "learning_revision_conflict" });
  await runtime.storage.models.AssetSlot.update(
    { sourceHash: "0".repeat(64) },
    { where: { id: variantSlot.id, profileId: runtime.scope.context.profileId } },
  );
  try {
    await assert.rejects(variantDispatcher.generateAsset({
      resourceType: "lesson",
      resourceId: assetLesson.lesson.id,
      revisionId: assetLesson.revision.id,
      slotId: variantSlot.id,
      requestKey: "variant-stale-source",
    }), { code: "learning_slot_mismatch" });
  } finally {
    await runtime.storage.models.AssetSlot.update(
      { sourceHash: variantSlot.sourceHash },
      { where: { id: variantSlot.id, profileId: runtime.scope.context.profileId } },
    );
  }
  assert.equal(await runtime.storage.models.GenerationJob.count(), variantJobsBeforeValidation);
  assert.equal(variantEvents.length, 0, "invalid asset regeneration reached the provider");

  const variantInput = {
    resourceType: "lesson",
    resourceId: assetLesson.lesson.id,
    revisionId: assetLesson.revision.id,
    slotId: variantSlot.id,
    requestKey: "regenerate-selected-image",
  };
  const variantJob = await variantDispatcher.generateAsset(variantInput);
  await variantStarted;
  let duplicateVariantJob;
  try {
    duplicateVariantJob = await variantDispatcher.generateAsset(variantInput);
  } finally {
    releaseVariant();
  }
  assert.deepEqual(duplicateVariantJob, variantJob);
  assert.equal(variantEvents.length, 1, "duplicate asset request relaunched the provider");
  const variantState = await waitFor(
    () => runtime.application.jobs.get(variantJob.jobId),
    (state) => state.job.state === "completed",
    "selected asset regeneration did not complete",
  );
  assert.equal(variantState.stages.length, 1);
  assert.equal(variantState.stages[0].slotId, variantSlot.id);
  assert.equal(variantState.attempts[0].provider, "codex");
  assert.equal(variantEvents[0].adapter, imageAdapter);
  const assetBundleAfterVariant = await runtime.storage.getLesson(assetLesson.lesson.id);
  assert.equal(assetBundleAfterVariant.slots.find((slot) => slot.id === variantSlot.id)?.selectedAssetId, newVariantAssetId);
  assert.deepEqual(
    assetBundleAfterVariant.assets.filter((asset) => asset.slotId === variantSlot.id).map((asset) => asset.id).sort(),
    [newVariantAssetId, oldVariantAssetId].sort(),
  );

  const originalStartAttempt = runtime.application.jobs.startAttempt.bind(runtime.application.jobs);
  const rejectNextStart = async (action) => {
    let calls = 0;
    runtime.application.jobs.startAttempt = async () => {
      calls++;
      throw Object.assign(new Error("fixture start failure"), { code: "learning_revision_conflict" });
    };
    try {
      await assert.rejects(action(), { code: "learning_revision_conflict" });
    } finally {
      runtime.application.jobs.startAttempt = originalStartAttempt;
    }
    assert.equal(calls, 1);
  };

  const failedStartLesson = await runtime.storage.createLesson({ brief: learningBrief });
  const failedStartDispatcher = new NativeLearningGeneration(runtime, {
    probe: readyProbe,
    imageProbe: readyProbe,
    adapters: { codex: acceptingAdapter("codex", learningDraft, observations()) },
  });
  await rejectNextStart(() => failedStartDispatcher.generate({
    provider: "codex",
    resourceType: "lesson",
    resourceId: failedStartLesson.lesson.id,
    revisionId: failedStartLesson.revision.id,
    requestKey: "failed-start-generate",
  }));
  const failedGenerateJob = await runtime.storage.models.GenerationJob.findOne({
    where: { requestKey: "failed-start-generate", profileId: runtime.scope.context.profileId },
  });
  assert.equal(failedGenerateJob?.state, "failed", "generate left an unstarted queued job");
  const recoveredGenerate = await failedStartDispatcher.generate({
    provider: "codex",
    resourceType: "lesson",
    resourceId: failedStartLesson.lesson.id,
    revisionId: failedStartLesson.revision.id,
    requestKey: "recovered-after-failed-start",
  });
  await waitFor(
    () => runtime.application.jobs.get(recoveredGenerate.jobId),
    (state) => state.job.state === "completed",
    "failed generate start kept the resource blocked",
  );

  const failedNarrationDispatcher = new NativeLearningGeneration(runtime, {
    assetRunner: commitAssetStage,
    speechProviderFactory: async () => mapNarrationSpeech,
  });
  await rejectNextStart(() => failedNarrationDispatcher.narrateMapNode({
    mapId: acceptedMap.map.id,
    revisionId: acceptedMap.revision.id,
    nodeId: alternateMapNode.id,
    requestKey: "failed-start-narration",
  }));
  const failedNarrationJob = await runtime.storage.models.GenerationJob.findOne({
    where: { requestKey: "failed-start-narration", profileId: runtime.scope.context.profileId },
  });
  assert.equal(failedNarrationJob?.state, "failed", "narration left an unstarted queued job");
  const recoveredNarration = await failedNarrationDispatcher.narrateMapNode({
    mapId: acceptedMap.map.id,
    revisionId: acceptedMap.revision.id,
    nodeId: alternateMapNode.id,
    requestKey: "recovered-after-failed-narration-start",
  });
  await waitFor(
    () => runtime.application.jobs.get(recoveredNarration.jobId),
    (state) => state.job.state === "completed",
    "failed narration start kept the resource blocked",
  );

  const failedAssetStartDispatcher = new NativeLearningGeneration(runtime, { assetRunner: commitAssetStage });
  await rejectNextStart(() => failedAssetStartDispatcher.generateAsset({
    ...variantInput,
    requestKey: "failed-start-asset",
  }));
  const failedAssetJob = await runtime.storage.models.GenerationJob.findOne({
    where: { requestKey: "failed-start-asset", profileId: runtime.scope.context.profileId },
  });
  assert.equal(failedAssetJob?.state, "failed", "asset generation left an unstarted queued job");
  const recoveredAsset = await failedAssetStartDispatcher.generateAsset({
    ...variantInput,
    requestKey: "recovered-after-failed-asset-start",
  });
  await waitFor(
    () => runtime.application.jobs.get(recoveredAsset.jobId),
    (state) => state.job.state === "completed",
    "failed asset start kept the resource blocked",
  );

  const concurrentlyClaimedLesson = await runtime.storage.createLesson({ brief: learningBrief });
  const concurrentlyClaimedDispatcher = new NativeLearningGeneration(runtime, {
    probe: readyProbe,
    imageProbe: readyProbe,
    adapters: { codex: acceptingAdapter("codex", learningDraft, observations()) },
  });
  let concurrentlyClaimedAttempt;
  runtime.application.jobs.startAttempt = async (...args) => {
    concurrentlyClaimedAttempt = await originalStartAttempt(...args);
    throw Object.assign(new Error("fixture concurrent claim"), { code: "learning_stage_busy" });
  };
  let concurrentlyClaimedJob;
  try {
    concurrentlyClaimedJob = await concurrentlyClaimedDispatcher.generate({
      provider: "codex",
      resourceType: "lesson",
      resourceId: concurrentlyClaimedLesson.lesson.id,
      revisionId: concurrentlyClaimedLesson.revision.id,
      requestKey: "concurrently-claimed-start",
    });
  } finally {
    runtime.application.jobs.startAttempt = originalStartAttempt;
  }
  assert.ok(concurrentlyClaimedAttempt);
  const concurrentlyClaimedState = await runtime.application.jobs.get(concurrentlyClaimedJob.jobId);
  assert.equal(concurrentlyClaimedState.job.state, "running");
  assert.equal(concurrentlyClaimedState.stages[0].state, "running");
  assert.equal(concurrentlyClaimedState.attempts[0].state, "running");
  await runtime.application.jobs.cancel(concurrentlyClaimedJob.jobId);

  const retryAssetLesson = await runtime.storage.createLesson({ brief: assetBrief });
  const retryAssetEvents = [];
  let failFirstImage = true;
  const retryAssetRunner = async (input) => {
    retryAssetEvents.push({ kind: input.stage.kind, provider: input.attempt.provider });
    if (input.stage.kind === "image" && failFirstImage) {
      failFirstImage = false;
      throw Object.assign(new Error("fixture image failure"), { code: "native_image_invalid" });
    }
    await commitAssetStage(input);
  };
  const retryAssetDispatcher = new NativeLearningGeneration(runtime, {
    imageAdapter,
    probe: readyProbe,
    imageProbe: readyProbe,
    adapters: {
      claude: acceptingAdapter("claude", assetDraft, observations()),
      codex: imageAdapter,
    },
    assetRunner: retryAssetRunner,
    speechProviderFactory: async () => speechProvider,
  });
  const retryAssetJob = await retryAssetDispatcher.generate({
    provider: "claude",
    resourceType: "lesson",
    resourceId: retryAssetLesson.lesson.id,
    revisionId: retryAssetLesson.revision.id,
    requestKey: "failed-image-retry",
  });
  const partialAssetState = await waitFor(
    () => runtime.application.jobs.get(retryAssetJob.jobId),
    (state) => state.stages.some((stage) => stage.kind === "image" && stage.state === "failed")
      && state.stages.some((stage) => stage.kind === "audio" && stage.state === "completed"),
    "asset drain did not continue after one image failure",
  );
  const failedImageStage = partialAssetState.stages.find((stage) => stage.kind === "image");
  assert.ok(failedImageStage);
  await retryAssetDispatcher.retry({
    jobId: retryAssetJob.jobId,
    stageId: failedImageStage.id,
    provider: "claude",
  });
  const completedAssetRetry = await waitFor(
    () => runtime.application.jobs.get(retryAssetJob.jobId),
    (state) => state.job.state === "completed",
    "explicit image retry did not complete",
  );
  const imageAttempts = completedAssetRetry.attempts.filter((attempt) => attempt.stageId === failedImageStage.id);
  assert.equal(imageAttempts.length, 2);
  assert.deepEqual(imageAttempts.map((attempt) => attempt.provider), ["codex", "codex"]);
  assert.deepEqual(retryAssetEvents.filter((event) => event.kind === "image").map((event) => event.provider), ["codex", "codex"]);

  const noSpeechBrief = { ...learningBrief, audio: true };
  const noSpeechLesson = await runtime.storage.createLesson({ brief: noSpeechBrief });
  const noSpeechDispatcher = new NativeLearningGeneration(runtime, {
    probe: readyProbe,
    imageProbe: readyProbe,
    adapters: { claude: acceptingAdapter("claude", learningDraft, observations()) },
    assetRunner: async (input) => {
      assert.equal(input.stage.kind, "audio");
      assert.equal(input.speechProvider, undefined);
      throw Object.assign(new Error("speech is not configured"), { code: "speech_not_configured" });
    },
  });
  const noSpeechJob = await noSpeechDispatcher.generate({
    provider: "claude",
    resourceType: "lesson",
    resourceId: noSpeechLesson.lesson.id,
    revisionId: noSpeechLesson.revision.id,
    requestKey: "no-speech-fallback",
  });
  const noSpeechState = await waitFor(
    () => runtime.application.jobs.get(noSpeechJob.jobId),
    (state) => state.stages.some((stage) => stage.kind === "audio" && stage.state === "failed"),
    "unconfigured speech stage did not fail",
  );
  const noSpeechAttempt = noSpeechState.attempts.find((attempt) =>
    attempt.stageId === noSpeechState.stages.find((stage) => stage.kind === "audio")?.id);
  assert.equal(noSpeechAttempt?.errorCode, "speech_not_configured");

  const proseLesson = await runtime.storage.createLesson({ brief: learningBrief });
  const proseObservations = observations();
  const proseDispatcher = new NativeLearningGeneration(runtime, {
    probe: readyProbe,
    imageProbe: readyProbe,
    adapters: { claude: proseOnlyAdapter("claude", proseObservations) },
  });
  const proseJob = await proseDispatcher.generate({
    provider: "claude",
    resourceType: "lesson",
    resourceId: proseLesson.lesson.id,
    revisionId: proseLesson.revision.id,
    requestKey: "prose-is-not-a-commit",
  });
  const proseState = await waitFor(
    () => runtime.application.jobs.get(proseJob.jobId),
    (state) => state.job.state === "failed",
    "prose-only result did not fail",
  );
  assert.equal(proseState.attempts[0].errorCode, "native_submission_missing");
  assert.equal((await runtime.storage.getLesson(proseLesson.lesson.id)).revisions[0].content, null);
  const retryObservations = observations();
  const retryDispatcher = new NativeLearningGeneration(runtime, {
    probe: readyProbe,
    imageProbe: readyProbe,
    adapters: { claude: acceptingAdapter("claude", learningDraft, retryObservations) },
  });
  assert.deepEqual(await retryDispatcher.retry({
    jobId: proseJob.jobId,
    stageId: proseState.stages[0].id,
    provider: "claude",
  }), { jobId: proseJob.jobId });
  const retryState = await waitFor(
    () => runtime.application.jobs.get(proseJob.jobId),
    (state) => state.job.state === "completed",
    "explicit text retry did not complete",
  );
  assert.equal(retryState.attempts.length, 2);
  await assert.rejects(retryDispatcher.retry({
    jobId: proseJob.jobId,
    stageId: proseState.stages[0].id,
    provider: "claude",
  }), { code: "learning_stage_busy" });
  await assert.rejects(retryDispatcher.retry({
    jobId: proseJob.jobId,
    stageId: mapState.stages[0].id,
    provider: "claude",
  }), { code: "learning_not_found" });

  const failedLesson = await runtime.storage.createLesson({ brief: learningBrief });
  const failureObservations = observations();
  const failureDispatcher = new NativeLearningGeneration(runtime, {
    probe: readyProbe,
    imageProbe: readyProbe,
    adapters: { codex: failingAdapter("native_timeout", failureObservations) },
  });
  const failedJob = await failureDispatcher.generate({
    provider: "codex",
    resourceType: "lesson",
    resourceId: failedLesson.lesson.id,
    revisionId: failedLesson.revision.id,
    requestKey: "timeout-outcome-unknown",
  });
  const failedState = await waitFor(
    () => runtime.application.jobs.get(failedJob.jobId),
    (state) => state.job.state === "interrupted",
    "timeout did not enter interrupted state",
  );
  assert.equal(failedState.stages[0].state, "awaiting_retry");
  assert.equal(failedState.attempts[0].state, "interrupted");
  assert.equal(failedState.attempts[0].errorCode, "native_timeout");

  const unsafeErrorLesson = await runtime.storage.createLesson({ brief: learningBrief });
  const unsafeErrorObservations = observations();
  const unsafeErrorDispatcher = new NativeLearningGeneration(runtime, {
    probe: readyProbe,
    imageProbe: readyProbe,
    adapters: { claude: failingAdapter("secret/path and details", unsafeErrorObservations) },
  });
  const unsafeErrorJob = await unsafeErrorDispatcher.generate({
    provider: "claude",
    resourceType: "lesson",
    resourceId: unsafeErrorLesson.lesson.id,
    revisionId: unsafeErrorLesson.revision.id,
    requestKey: "safe-error-code",
  });
  const unsafeErrorState = await waitFor(
    () => runtime.application.jobs.get(unsafeErrorJob.jobId),
    (state) => state.job.state === "failed",
    "unsafe provider error did not fail",
  );
  assert.equal(unsafeErrorState.attempts[0].errorCode, "native_error");

  const cleanupLesson = await runtime.storage.createLesson({ brief: learningBrief });
  const cleanupObservations = observations();
  const retryable = retryableCleanupAdapter(cleanupObservations);
  const cleanupDispatcher = new NativeLearningGeneration(runtime, {
    probe: readyProbe,
    imageProbe: readyProbe,
    adapters: { codex: retryable.adapter },
  });
  const cleanupJob = await cleanupDispatcher.generate({
    provider: "codex",
    resourceType: "lesson",
    resourceId: cleanupLesson.lesson.id,
    revisionId: cleanupLesson.revision.id,
    requestKey: "retryable-cleanup",
  });
  await waitFor(
    async () => cleanupObservations.runs,
    Boolean,
    "retryable cleanup adapter did not start",
  );
  const cleanupRoot = path.dirname(cleanupObservations.requests[0].workspace);
  const cleanupState = await waitFor(
    () => runtime.application.jobs.get(cleanupJob.jobId),
    (state) => state.job.state === "interrupted",
    "cleanup failure did not preserve an unknown outcome",
  );
  assert.equal(cleanupState.attempts[0].errorCode, "native_cleanup_failed");
  await access(cleanupRoot);
  assert.equal(cleanupObservations.cleanupCalls, 1);
  retryable.allowCleanup();
  await runtime.tick();
  assert.equal(cleanupObservations.cleanupCalls, 2);
  await expectMissing(cleanupRoot);

  const cancelledLesson = await runtime.storage.createLesson({ brief: learningBrief });
  const cancelObservations = observations();
  const blocked = blockingAdapter("claude", cancelObservations);
  const cancelDispatcher = new NativeLearningGeneration(runtime, {
    probe: readyProbe,
    imageProbe: readyProbe,
    adapters: { claude: blocked.adapter },
  });
  const cancelledJob = await cancelDispatcher.generate({
    provider: "claude",
    resourceType: "lesson",
    resourceId: cancelledLesson.lesson.id,
    revisionId: cancelledLesson.revision.id,
    requestKey: "cancel-race",
  });
  const runningState = await waitFor(
    () => runtime.application.jobs.get(cancelledJob.jobId),
    (state) => state.job.state === "running" && cancelObservations.runs === 1,
    "blocking attempt did not start",
  );
  const cancelRoot = path.dirname(cancelObservations.requests[0].workspace);
  const ownedAttempt = runningState.attempts[0];
  await runtime.application.jobs.cancel(cancelledJob.jobId);
  const cleanup = runtime.cancelAttempt(ownedAttempt.id);
  await waitFor(
    async () => cancelObservations.abortObserved,
    Boolean,
    "adapter did not observe cancellation",
  );
  await access(cancelRoot);
  let cleanupSettled = false;
  void cleanup.finally(() => { cleanupSettled = true; });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(cleanupSettled, false, "cleanup released MCP before native run settled");
  blocked.release();
  await cleanup;
  await expectMissing(cancelRoot);
  const cancelledState = await runtime.application.jobs.get(cancelledJob.jobId);
  assert.equal(cancelledState.job.state, "cancelled");
  assert.equal(cancelledState.attempts[0].state, "cancelled");

  const azureCancelledLesson = await runtime.storage.createLesson({ brief: learningBrief });
  let markAzureStarted;
  const azureStarted = new Promise((resolve) => { markAzureStarted = resolve; });
  let azureAbortObserved = false;
  const azureCancelDispatcher = new NativeLearningGeneration(runtime, {
    azureTextConfigFactory: async () => azureConfig,
    azureTextRunner: async ({ signal }) => {
      markAzureStarted();
      await new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          azureAbortObserved = true;
          reject(Object.assign(new Error("cancelled"), { code: "azure_text_cancelled" }));
        }, { once: true });
      });
    },
  });
  const azureCancelledJob = await azureCancelDispatcher.generate({
    provider: "azure-openai",
    resourceType: "lesson",
    resourceId: azureCancelledLesson.lesson.id,
    revisionId: azureCancelledLesson.revision.id,
    requestKey: "azure-cancel",
  });
  await azureStarted;
  const azureRunningState = await runtime.application.jobs.get(azureCancelledJob.jobId);
  const azureOwnedAttempt = azureRunningState.attempts[0];
  await runtime.application.jobs.cancel(azureCancelledJob.jobId);
  await runtime.cancelAttempt(azureOwnedAttempt.id);
  assert.equal(azureAbortObserved, true, "Azure runner did not observe cancellation");
  const azureCancelledState = await runtime.application.jobs.get(azureCancelledJob.jobId);
  assert.equal(azureCancelledState.job.state, "cancelled");
  assert.equal(azureCancelledState.attempts[0].state, "cancelled");

  const closingLesson = await runtime.storage.createLesson({ brief: learningBrief });
  const closingObservations = observations();
  const closingBlocked = blockingAdapter("codex", closingObservations);
  const closingDispatcher = new NativeLearningGeneration(runtime, {
    probe: readyProbe,
    imageProbe: readyProbe,
    adapters: { codex: closingBlocked.adapter },
  });
  const closingJob = await closingDispatcher.generate({
    provider: "codex",
    resourceType: "lesson",
    resourceId: closingLesson.lesson.id,
    revisionId: closingLesson.revision.id,
    requestKey: "profile-close-race",
  });
  await waitFor(
    async () => closingObservations.runs,
    Boolean,
    "profile-close adapter did not start",
  );
  const closingRoot = path.dirname(closingObservations.requests[0].workspace);
  let closeSettled = false;
  const closeRuntime = runtime.close().finally(() => { closeSettled = true; });
  await waitFor(
    async () => closingObservations.abortObserved,
    Boolean,
    "profile close did not abort the adapter",
  );
  await access(closingRoot);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(closeSettled, false, "profile close untracked native work before it settled");
  closingBlocked.release();
  await closeRuntime;
  await expectMissing(closingRoot);
  runtime = await LearningRuntime.open({
    sequelize: db,
    profileId: "native-generation-profile",
    assetRoot: path.join(temp, "profile", "assets"),
    watchdogMs: 0,
  });
  const recoveredClosingState = await runtime.application.jobs.get(closingJob.jobId);
  assert.equal(recoveredClosingState.job.state, "interrupted");
  assert.equal(recoveredClosingState.attempts.at(-1).state, "interrupted");
  assert.equal(recoveredClosingState.attempts.at(-1).errorCode, "app_interrupted");

  console.log("PASS: native generation MCP acceptance, asset variants, map narration, failed-start recovery, sequential assets, explicit retries, idempotency, timeout, retryable cleanup, cancellation/profile drains and release ordering.");
} finally {
  await runtime?.close().catch(() => undefined);
  await db?.close().catch(() => undefined);
  await rm(temp, { recursive: true, force: true });
}
