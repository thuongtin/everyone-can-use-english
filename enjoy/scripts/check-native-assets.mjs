import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

import { build } from "esbuild";
import { Sequelize } from "sequelize";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(root, ".tmp-native-assets-"));
let database;
let runtime;

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function makePng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = [];
  for (let row = 0; row < height; row += 1) {
    pixels.push(Buffer.from([0]));
    for (let column = 0; column < width; column += 1) pixels.push(Buffer.from([42, 112, 201, 255]));
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(pixels))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const imageBytes = makePng(3, 2);
const brief = {
  topic: "Ordering tea at a cafe",
  level: "A2",
  length: "short",
  imageCount: 1,
  audio: true,
  targets: [{
    id: "tea",
    term: "tea",
    sense: "a hot drink",
    definition: "A drink made with tea leaves.",
    translationVi: "trà",
    example: "May I have some tea?",
  }],
};
const content = {
  title: "Tea at the cafe",
  sections: [{
    id: "section-cafe",
    text: "Mia walks into a quiet cafe and asks for a warm cup of tea.",
    targetIds: ["tea"],
  }],
  glossary: [{
    targetId: "tea",
    definition: "A drink made with tea leaves.",
    translationVi: "trà",
    example: "May I have some tea?",
  }],
  scenes: [{
    id: "scene-cafe",
    description: "Mia orders tea at a sunlit wooden cafe counter.",
    sectionIds: ["section-cafe"],
    targetIds: ["tea"],
    entityDescriptionIds: ["mia"],
  }],
  exercises: [],
  entityDescriptions: [{ id: "mia", description: "Mia is a young adult with short black hair and a blue jacket." }],
};
const mapGraph = {
  rootNodeId: "tea",
  nodes: [{
    id: "tea",
    term: "tea",
    sense: "a hot drink",
    definition: "A drink made by adding hot water to tea leaves.",
    translationVi: "trà",
    partOfSpeech: "noun",
    example: "Mia orders tea at the cafe.",
    evidence: { status: "unverified" },
  }, {
    id: "cup",
    term: "cup",
    sense: "a drinking container",
    definition: "A small container used for drinks.",
    translationVi: "cốc",
    partOfSpeech: "noun",
    ipa: "/kʌp/",
    example: "The tea is in a cup.",
    evidence: { status: "unverified" },
  }],
  edges: [],
  studyGroups: [{
    id: "tea-things",
    title: "Tea things",
    translationVi: "Đồ dùng uống trà",
    nodeIds: ["cup"],
    example: "The cup is ready for tea.",
    exampleTranslationVi: "Chiếc cốc đã sẵn sàng để uống trà.",
    illustration: {
      prompt: "A ceramic cup beside a warm teapot on a cafe table",
      alt: "A ceramic cup beside a teapot",
    },
  }],
};

try {
  const output = path.join(temp, "native-assets.mjs");
  await build({
    stdin: {
      contents: [
        "export { runNativeAssetStage } from './src/main/learning/native-assets';",
        "export { LearningAssetStore } from './src/main/learning/asset-store';",
        "export { LearningStorage } from './src/main/learning/storage';",
        "export { LearningProfileScope } from './src/main/learning/profile-scope';",
        "export { LearningApplication } from './src/main/learning/service';",
        "export { createLearningModels } from './src/main/db/learning-models';",
        "export { canonicalPayloadHash } from './src/main/learning/candidate';",
      ].join("\n"),
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    packages: "external",
    logLevel: "silent",
  });
  const {
    LearningApplication,
    LearningAssetStore,
    LearningProfileScope,
    LearningStorage,
    canonicalPayloadHash,
    createLearningModels,
    runNativeAssetStage,
  } = await import(pathToFileURL(output).href);
  database = new Sequelize({ dialect: "sqlite", storage: path.join(temp, "native-assets.sqlite"), logging: false });
  const migration = await import(pathToFileURL(path.join(root, "src/main/db/migrations/1788701024340-create-learning-studio.js")).href);
  await migration.up({ context: database.getQueryInterface() });
  const mapBriefMigration = await import(pathToFileURL(path.join(root, "src/main/db/migrations/1788789600000-add-learning-map-brief.js")).href);
  await mapBriefMigration.up({ context: database.getQueryInterface() });
  const scope = new LearningProfileScope("native-assets-check", path.join(temp, "assets"));
  const storage = new LearningStorage({ sequelize: database, models: createLearningModels(database), scope });
  const assets = new LearningAssetStore(scope.context.assetRoot);
  await assets.initialize();
  const application = new LearningApplication(storage);
  runtime = { scope, storage, assets, application, close: () => scope.quiesce() };
  const created = await runtime.storage.createLesson({ brief, title: content.title });
  await runtime.storage.write(async (transaction) => {
    const revision = await runtime.storage.models.LessonRevision.findByPk(created.revision.id, { transaction });
    await revision.update({ content, status: "ready", sourceHash: canonicalPayloadHash(content) }, { transaction });
  });
  const createdMap = await runtime.storage.createMap({ title: "Cafe words", lessonRevisionId: created.revision.id });
  await runtime.storage.write(async (transaction) => {
    const revision = await runtime.storage.models.LearningMapRevision.findByPk(createdMap.revision.id, { transaction });
    await revision.update({ content: mapGraph, status: "ready" }, { transaction });
  });

  const createSlot = (kind, source, suffix) => runtime.storage.models.AssetSlot.create({
    id: randomUUID(),
    profileId: runtime.scope.context.profileId,
    lessonRevisionId: created.revision.id,
    mapRevisionId: null,
    sourceType: kind === "image" ? "scene" : "section",
    sourceId: source.id,
    kind,
    sourceHash: canonicalPayloadHash(source),
    slotKey: `${created.revision.id}:${kind}:${source.id}:${suffix}`,
  });
  const createMapSlot = (source, suffix, sourceHash = canonicalPayloadHash(source)) => runtime.storage.models.AssetSlot.create({
    id: randomUUID(),
    profileId: runtime.scope.context.profileId,
    lessonRevisionId: null,
    mapRevisionId: createdMap.revision.id,
    sourceType: "node",
    sourceId: source.id,
    kind: "audio",
    sourceHash,
    slotKey: `${createdMap.revision.id}:audio:${source.id}:${suffix}`,
  });
  const createMapImageSlot = (group, suffix, sourceHash = canonicalPayloadHash({ group, nodes: [mapGraph.nodes[1]] })) => runtime.storage.models.AssetSlot.create({
    id: randomUUID(),
    profileId: runtime.scope.context.profileId,
    lessonRevisionId: null,
    mapRevisionId: createdMap.revision.id,
    sourceType: "group",
    sourceId: group.id,
    kind: "image",
    sourceHash,
    slotKey: `${createdMap.revision.id}:image:${group.id}:${suffix}`,
  });

  const imageSlot = await createSlot("image", content.scenes[0], "success");
  const audioSlot = await createSlot("audio", content.sections[0], "success");
  const generated = await runtime.application.jobs.create({
    resourceType: "lesson",
    resourceId: created.lesson.id,
    revisionId: created.revision.id,
    requestKey: randomUUID(),
    stages: [
      { key: "image.scene-cafe", kind: "image", slotId: imageSlot.id },
      { key: "audio.section-cafe", kind: "audio", slotId: audioSlot.id },
    ],
  });
  const imageStage = generated.stages.find((stage) => stage.kind === "image");
  const audioStage = generated.stages.find((stage) => stage.kind === "audio");
  const imageAttempt = await runtime.application.jobs.startAttempt(imageStage.id, "codex");
  const executable = { path: "/fixture/codex", realpath: "/fixture/codex", sha256: "a".repeat(64), size: 1, mtimeMs: 1 };
  const probe = async (provider, options) => {
    assert.equal(provider, "codex");
    assert.equal(options.cwd, path.join(temp, "workspace"));
    return { provider, executable, version: "fixture", authenticated: true, text: true, image: true, reason: null };
  };
  let imageRequests = 0;
  const adapter = {
    async run(request) {
      imageRequests += 1;
      assert.equal(request.image, true);
      assert.equal(request.timeoutMs, 600_000);
      assert.equal("mcp" in request, false);
      if (request.prompt.includes("Study group context")) {
        assert.match(request.prompt, /ceramic cup/);
        assert.match(request.prompt, /tea-things/);
        assert.ok(request.prompt.includes('"ipa":"/kʌp/"'));
      } else {
        assert.match(request.prompt, /scene-cafe/);
        assert.match(request.prompt, /short black hair/);
      }
      return {
        provider: "codex",
        text: "",
        images: [{ bytes: imageBytes, mimeType: "image/png", providerItemId: "native-image-1" }],
        model: "gpt-image-fixture",
      };
    },
  };
  const openSignal = new AbortController().signal;
  await runNativeAssetStage({
    runtime,
    job: generated.job,
    stage: imageStage,
    attempt: imageAttempt,
    workspace: path.join(temp, "workspace"),
    privateHome: path.join(temp, "private-home"),
    signal: openSignal,
    adapter,
    probe,
  });
  assert.equal(imageRequests, 1);
  const imageAsset = await runtime.storage.models.GeneratedAsset.findOne({ where: { slotId: imageSlot.id } });
  assert.ok(imageAsset);
  assert.equal(imageAsset.mimeType, "image/png");
  assert.equal(imageAsset.width, 3);
  assert.equal(imageAsset.height, 2);
  assert.equal(imageAsset.provenance.provider, "codex");
  assert.equal(imageAsset.provenance.channel, "native");
  assert.equal(imageAsset.provenance.providerItemId, "native-image-1");
  assert.equal((await imageSlot.reload()).selectedAssetId, imageAsset.id);
  assert.deepEqual(await runtime.assets.read(imageAsset.relativePath), imageBytes);

  const speechBytes = await readFile(path.join(root, "samples", "speech.mp3"));
  let spokenText = null;
  const speechProvider = {
    id: "bounded-fixture",
    model: "fixture-model",
    voice: "fixture-voice",
    async synthesize(text, options) {
      assert.ok(options.signal && !options.signal.aborted);
      spokenText = text;
      return {
        bytes: speechBytes,
        mimeType: "audio/mpeg",
        engine: "openai",
        model: this.model,
        voice: this.voice,
      };
    },
  };
  const audioAttempt = await runtime.application.jobs.startAttempt(audioStage.id, speechProvider.id);
  await runNativeAssetStage({
    runtime,
    job: generated.job,
    stage: audioStage,
    attempt: audioAttempt,
    workspace: path.join(temp, "workspace"),
    privateHome: path.join(temp, "private-home"),
    signal: openSignal,
    speechProvider,
  });
  assert.equal(spokenText, content.sections[0].text);
  const audioAsset = await runtime.storage.models.GeneratedAsset.findOne({ where: { slotId: audioSlot.id } });
  assert.ok(audioAsset);
  assert.equal(audioAsset.mimeType, "audio/mpeg");
  assert.ok(audioAsset.durationMs > 0);
  assert.equal(audioAsset.provenance.provider, "bounded-fixture");
  assert.equal(audioAsset.provenance.channel, "speech");
  assert.equal((await audioSlot.reload()).selectedAssetId, audioAsset.id);

  const imageVariantJob = await runtime.application.jobs.create({
    resourceType: "lesson",
    resourceId: created.lesson.id,
    revisionId: created.revision.id,
    requestKey: randomUUID(),
    stages: [{ key: "image.scene-cafe.variant", kind: "image", slotId: imageSlot.id }],
  });
  const imageVariantStage = imageVariantJob.stages[0];
  const imageVariantAttempt = await runtime.application.jobs.startAttempt(imageVariantStage.id, "codex");
  await runNativeAssetStage({
    runtime,
    job: imageVariantJob.job,
    stage: imageVariantStage,
    attempt: imageVariantAttempt,
    workspace: path.join(temp, "workspace"),
    privateHome: path.join(temp, "private-home"),
    signal: openSignal,
    adapter,
    probe,
  });
  const imageVariants = await runtime.storage.models.GeneratedAsset.findAll({ where: { slotId: imageSlot.id }, order: [["createdAt", "ASC"]] });
  assert.equal(imageVariants.length, 2);
  assert.equal(imageVariants.some((asset) => asset.id === imageAsset.id), true);
  const selectedImageVariantId = (await imageSlot.reload()).selectedAssetId;
  assert.notEqual(selectedImageVariantId, imageAsset.id);
  assert.equal(imageVariants.some((asset) => asset.id === selectedImageVariantId), true);
  assert.deepEqual(await runtime.assets.read(imageAsset.relativePath), imageBytes);
  assert.deepEqual(await runtime.assets.read(imageVariants.find((asset) => asset.id === selectedImageVariantId).relativePath), imageBytes);
  const imageVariantState = await runtime.application.jobs.get(imageVariantJob.job.id);
  assert.equal(imageVariantState.job.state, "completed");
  assert.equal(imageVariantState.stages[0].state, "completed");
  assert.equal(imageVariantState.attempts[0].state, "completed");

  const audioVariantJob = await runtime.application.jobs.create({
    resourceType: "lesson",
    resourceId: created.lesson.id,
    revisionId: created.revision.id,
    requestKey: randomUUID(),
    stages: [{ key: "audio.section-cafe.variant", kind: "audio", slotId: audioSlot.id }],
  });
  const audioVariantStage = audioVariantJob.stages[0];
  const audioVariantAttempt = await runtime.application.jobs.startAttempt(audioVariantStage.id, speechProvider.id);
  await runNativeAssetStage({
    runtime,
    job: audioVariantJob.job,
    stage: audioVariantStage,
    attempt: audioVariantAttempt,
    workspace: path.join(temp, "workspace"),
    privateHome: path.join(temp, "private-home"),
    signal: openSignal,
    speechProvider,
  });
  const audioVariants = await runtime.storage.models.GeneratedAsset.findAll({ where: { slotId: audioSlot.id }, order: [["createdAt", "ASC"]] });
  assert.equal(audioVariants.length, 2);
  assert.equal(audioVariants.some((asset) => asset.id === audioAsset.id), true);
  const selectedAudioVariantId = (await audioSlot.reload()).selectedAssetId;
  assert.notEqual(selectedAudioVariantId, audioAsset.id);
  assert.equal(audioVariants.some((asset) => asset.id === selectedAudioVariantId), true);
  assert.deepEqual(await runtime.assets.read(audioAsset.relativePath), speechBytes);
  assert.deepEqual(await runtime.assets.read(audioVariants.find((asset) => asset.id === selectedAudioVariantId).relativePath), speechBytes);
  const audioVariantState = await runtime.application.jobs.get(audioVariantJob.job.id);
  assert.equal(audioVariantState.job.state, "completed");
  assert.equal(audioVariantState.stages[0].state, "completed");
  assert.equal(audioVariantState.attempts[0].state, "completed");

  const mapSlot = await createMapSlot(mapGraph.nodes[0], "success");
  const mapJob = await runtime.application.jobs.create({
    resourceType: "map",
    resourceId: createdMap.map.id,
    revisionId: createdMap.revision.id,
    requestKey: randomUUID(),
    stages: [{ key: "audio.tea", kind: "audio", slotId: mapSlot.id }],
  });
  const mapStage = mapJob.stages[0];
  const mapAttempt = await runtime.application.jobs.startAttempt(mapStage.id, speechProvider.id);
  spokenText = null;
  await runNativeAssetStage({
    runtime,
    job: mapJob.job,
    stage: mapStage,
    attempt: mapAttempt,
    workspace: path.join(temp, "workspace"),
    privateHome: path.join(temp, "private-home"),
    signal: openSignal,
    speechProvider,
  });
  assert.equal(spokenText, "tea. Mia orders tea at the cafe.");
  const mapAsset = await runtime.storage.models.GeneratedAsset.findOne({ where: { slotId: mapSlot.id } });
  assert.ok(mapAsset);
  assert.equal(mapAsset.mimeType, "audio/mpeg");
  assert.equal((await mapSlot.reload()).selectedAssetId, mapAsset.id);

  const mapImageSlot = await createMapImageSlot(mapGraph.studyGroups[0], "success");
  const mapImageJob = await runtime.application.jobs.create({
    resourceType: "map",
    resourceId: createdMap.map.id,
    revisionId: createdMap.revision.id,
    requestKey: randomUUID(),
    stages: [{ key: "image.tea-things", kind: "image", slotId: mapImageSlot.id }],
  });
  const mapImageStage = mapImageJob.stages[0];
  const mapImageAttempt = await runtime.application.jobs.startAttempt(mapImageStage.id, "codex");
  await runNativeAssetStage({
    runtime,
    job: mapImageJob.job,
    stage: mapImageStage,
    attempt: mapImageAttempt,
    workspace: path.join(temp, "workspace"),
    privateHome: path.join(temp, "private-home"),
    signal: openSignal,
    adapter,
    probe,
  });
  const mapImageAsset = await runtime.storage.models.GeneratedAsset.findOne({ where: { slotId: mapImageSlot.id } });
  assert.ok(mapImageAsset);
  assert.equal((await mapImageSlot.reload()).selectedAssetId, mapImageAsset.id);

  const wrongScopeSlot = await createMapSlot(mapGraph.nodes[0], "wrong-scope", "0".repeat(64));
  const wrongScopeJob = await runtime.application.jobs.create({
    resourceType: "map",
    resourceId: createdMap.map.id,
    revisionId: createdMap.revision.id,
    requestKey: randomUUID(),
    stages: [{ key: "audio.tea.wrong-scope", kind: "audio", slotId: wrongScopeSlot.id }],
  });
  const wrongScopeStage = wrongScopeJob.stages[0];
  const wrongScopeAttempt = await runtime.application.jobs.startAttempt(wrongScopeStage.id, speechProvider.id);
  const spokenBeforeWrongScope = spokenText;
  await assert.rejects(runNativeAssetStage({
    runtime,
    job: wrongScopeJob.job,
    stage: wrongScopeStage,
    attempt: wrongScopeAttempt,
    workspace: path.join(temp, "workspace"),
    privateHome: path.join(temp, "private-home"),
    signal: openSignal,
    speechProvider,
  }), { code: "learning_slot_mismatch" });
  assert.equal(spokenText, spokenBeforeWrongScope);
  assert.equal(await runtime.storage.models.GeneratedAsset.count({ where: { slotId: wrongScopeSlot.id } }), 0);
  await runtime.application.jobs.failAttempt(wrongScopeAttempt.id, "learning_slot_mismatch");

  const committedAbortSlot = await createSlot("image", content.scenes[0], "committed-abort");
  const committedAbortJob = await runtime.application.jobs.create({
    resourceType: "lesson",
    resourceId: created.lesson.id,
    revisionId: created.revision.id,
    requestKey: randomUUID(),
    stages: [{ key: "image.scene-cafe.committed-abort", kind: "image", slotId: committedAbortSlot.id }],
  });
  const committedAbortStage = committedAbortJob.stages[0];
  const committedAbortAttempt = await runtime.application.jobs.startAttempt(committedAbortStage.id, "codex");
  const committedAbortController = new AbortController();
  const commit = runtime.application.jobs.commit.bind(runtime.application.jobs);
  runtime.application.jobs.commit = async (...arguments_) => {
    const result = await commit(...arguments_);
    committedAbortController.abort();
    return result;
  };
  try {
    await runNativeAssetStage({
      runtime,
      job: committedAbortJob.job,
      stage: committedAbortStage,
      attempt: committedAbortAttempt,
      workspace: path.join(temp, "workspace"),
      privateHome: path.join(temp, "private-home"),
      signal: committedAbortController.signal,
      adapter,
      probe,
    });
  } finally {
    runtime.application.jobs.commit = commit;
  }
  assert.equal(committedAbortController.signal.aborted, true);
  const committedAbortAsset = await runtime.storage.models.GeneratedAsset.findOne({ where: { slotId: committedAbortSlot.id } });
  assert.ok(committedAbortAsset);
  assert.equal((await committedAbortSlot.reload()).selectedAssetId, committedAbortAsset.id);
  assert.deepEqual(await runtime.assets.read(committedAbortAsset.relativePath), imageBytes);

  const expiredSlot = await createSlot("image", content.scenes[0], "expired");
  const expiredJob = await runtime.application.jobs.create({
    resourceType: "lesson",
    resourceId: created.lesson.id,
    revisionId: created.revision.id,
    requestKey: randomUUID(),
    stages: [{ key: "image.scene-cafe.expired", kind: "image", slotId: expiredSlot.id }],
  });
  const expiredStage = expiredJob.stages[0];
  const expiredAttempt = await runtime.application.jobs.startAttempt(expiredStage.id, "codex");
  await runtime.storage.models.StageAttempt.update({
    metadata: {
      ...expiredAttempt.metadata,
      ownerConnectionId: runtime.scope.context.connectionId,
      leaseExpiresAt: Date.now() - 1,
    },
  }, { where: { id: expiredAttempt.id, profileId: runtime.scope.context.profileId } });
  const callsBeforeExpiredLease = imageRequests;
  await assert.rejects(runNativeAssetStage({
    runtime,
    job: expiredJob.job,
    stage: expiredStage,
    attempt: expiredAttempt,
    workspace: path.join(temp, "workspace"),
    privateHome: path.join(temp, "private-home"),
    signal: openSignal,
    adapter,
    probe,
  }), { code: "learning_lease_expired" });
  assert.equal(imageRequests, callsBeforeExpiredLease);
  assert.equal(await runtime.storage.models.GeneratedAsset.count({ where: { slotId: expiredSlot.id } }), 0);
  await runtime.application.jobs.failAttempt(expiredAttempt.id, "learning_lease_expired");

  const unconfiguredSlot = await createSlot("audio", content.sections[0], "unconfigured");
  const unconfiguredJob = await runtime.application.jobs.create({
    resourceType: "lesson",
    resourceId: created.lesson.id,
    revisionId: created.revision.id,
    requestKey: randomUUID(),
    stages: [{ key: "audio.section-cafe.unconfigured", kind: "audio", slotId: unconfiguredSlot.id }],
  });
  const unconfiguredStage = unconfiguredJob.stages[0];
  const unconfiguredAttempt = await runtime.application.jobs.startAttempt(unconfiguredStage.id, "speech");
  await assert.rejects(runNativeAssetStage({
    runtime,
    job: unconfiguredJob.job,
    stage: unconfiguredStage,
    attempt: unconfiguredAttempt,
    workspace: path.join(temp, "workspace"),
    privateHome: path.join(temp, "private-home"),
    signal: openSignal,
  }), { code: "speech_not_configured" });
  assert.equal(await runtime.storage.models.GeneratedAsset.count({ where: { slotId: unconfiguredSlot.id } }), 0);
  await runtime.application.jobs.failAttempt(unconfiguredAttempt.id, "speech_not_configured");

  const staleSlot = mapSlot;
  const selectedMapAssetId = (await mapSlot.reload()).selectedAssetId;
  const selectedMapAssetPath = mapAsset.relativePath;
  const staleJob = await runtime.application.jobs.create({
    resourceType: "map",
    resourceId: createdMap.map.id,
    revisionId: createdMap.revision.id,
    requestKey: randomUUID(),
    stages: [{ key: "audio.tea.stale", kind: "audio", slotId: staleSlot.id }],
  });
  const staleStage = staleJob.stages[0];
  const staleAttempt = await runtime.application.jobs.startAttempt(staleStage.id, speechProvider.id);
  const importBytes = runtime.assets.importBytes.bind(runtime.assets);
  let rejectedRelativePath = null;
  let replacementAttempt = null;
  runtime.assets.importBytes = async (input) => {
    const imported = await importBytes(input);
    rejectedRelativePath = imported.relativePath;
    await runtime.application.jobs.failAttempt(staleAttempt.id, "provider_failed");
    replacementAttempt = await runtime.application.jobs.retryAttempt(staleStage.id, speechProvider.id);
    return imported;
  };
  try {
    await assert.rejects(runNativeAssetStage({
      runtime,
      job: staleJob.job,
      stage: staleStage,
      attempt: staleAttempt,
      workspace: path.join(temp, "workspace"),
      privateHome: path.join(temp, "private-home"),
      signal: openSignal,
      speechProvider,
    }), { code: "learning_attempt_stale" });
  } finally {
    runtime.assets.importBytes = importBytes;
  }
  assert.ok(rejectedRelativePath);
  assert.equal(await runtime.storage.models.GeneratedAsset.count({ where: { slotId: staleSlot.id } }), 1);
  assert.equal((await staleSlot.reload()).selectedAssetId, selectedMapAssetId);
  assert.deepEqual(await runtime.assets.read(selectedMapAssetPath), speechBytes);
  await assert.rejects(access(runtime.assets.resolve(rejectedRelativePath)), { code: "ENOENT" });
  await runtime.application.jobs.cancel(staleJob.job.id);
  const staleState = await runtime.application.jobs.get(staleJob.job.id);
  assert.equal(staleState.job.state, "cancelled");
  assert.equal(staleState.stages[0].state, "cancelled");
  assert.equal(staleState.attempts.find((attempt) => attempt.id === staleAttempt.id).state, "failed");
  assert.equal(staleState.attempts.find((attempt) => attempt.id === replacementAttempt.id).state, "cancelled");

  console.log("PASS: native asset variants preserve history, switch selection atomically, honor leases, and reject stale or late-cancelled publication.");
} finally {
  await runtime?.close().catch(() => undefined);
  await database?.close().catch(() => undefined);
  await rm(temp, { recursive: true, force: true });
}
