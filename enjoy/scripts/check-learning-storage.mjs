import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { Sequelize } from "sequelize";
import { learningBrief, learningDraft, learningMap } from "./fixtures/learning-lesson.mjs";

const root = path.resolve(import.meta.dirname, "..");
const migrationPath = path.join(
  root,
  "src/main/db/migrations/1788701024340-create-learning-studio.js",
);
const mapBriefMigrationPath = path.join(
  root,
  "src/main/db/migrations/1788789600000-add-learning-map-brief.js",
);
const storagePath = path.join(root, "src/main/learning/storage.ts");
const modelsPath = path.join(root, "src/main/db/learning-models.ts");
const profileScopePath = path.join(root, "src/main/learning/profile-scope.ts");
const candidatePath = path.join(root, "src/main/learning/candidate.ts");
const temp = await mkdtemp(path.join(root, ".tmp-enjoy-learning-storage-"));

const tests = [];
const test = async (name, action) => {
  await action();
  tests.push(name);
};

const uuid = (seed) => {
  const value = String(seed).padStart(12, "0").slice(-12);
  return `00000000-0000-4000-8000-${value}`;
};

const brief = (overrides = {}) => structuredClone({ ...learningBrief, ...overrides });
const draft = (overrides = {}) => structuredClone({ ...learningDraft, ...overrides });
const graph = (overrides = {}) => structuredClone({ ...learningMap, ...overrides });

async function bundleEntry(entryPoint, outfile) {
  await build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    external: ["sequelize", "sequelize-typescript"],
    logLevel: "silent",
  });
}

async function openDatabase(databasePath, migration, mapBriefMigration) {
  const sequelize = new Sequelize({
    dialect: "sqlite",
    storage: databasePath,
    logging: false,
  });
  await sequelize.query(
    "CREATE TABLE stories (id TEXT PRIMARY KEY, title TEXT NOT NULL)",
  );
  await sequelize.query(
    "INSERT INTO stories (id, title) VALUES ('story-keep', 'Existing story')",
  );
  await migration.up({ context: sequelize.getQueryInterface() });
  await mapBriefMigration.up({ context: sequelize.getQueryInterface() });
  return sequelize;
}

let storageModule;
let modelsModule;
let scopeModule;
let candidateModule;
let migration;
let mapBriefMigration;
const databaseHandles = new Set();

try {
  const storageOutput = path.join(temp, "storage.mjs");
  const modelsOutput = path.join(temp, "learning-models.mjs");
  const scopeOutput = path.join(temp, "profile-scope.mjs");
  const candidateOutput = path.join(temp, "candidate.mjs");

  await bundleEntry(storagePath, storageOutput);
  await bundleEntry(modelsPath, modelsOutput);
  await bundleEntry(profileScopePath, scopeOutput);
  await bundleEntry(candidatePath, candidateOutput);

  storageModule = await import(`${pathToFileURL(storageOutput).href}?test=${Date.now()}`);
  modelsModule = await import(`${pathToFileURL(modelsOutput).href}?test=${Date.now()}`);
  scopeModule = await import(`${pathToFileURL(scopeOutput).href}?test=${Date.now()}`);
  candidateModule = await import(`${pathToFileURL(candidateOutput).href}?test=${Date.now()}`);
  migration = await import(`${pathToFileURL(migrationPath).href}?test=${Date.now()}`);
  mapBriefMigration = await import(`${pathToFileURL(mapBriefMigrationPath).href}?test=${Date.now()}`);

  const { LearningStorage, LearningStorageError } = storageModule;
  const { createLearningModels } = modelsModule;
  const { LearningProfileScope } = scopeModule;
  const { canonicalPayloadHash } = candidateModule;

  await test("creates a draft lesson and map in one SQLite transaction", async () => {
    const databasePath = path.join(temp, "create.sqlite");
    const sequelize = await openDatabase(databasePath, migration, mapBriefMigration);
    databaseHandles.add(sequelize);
    const models = createLearningModels(sequelize);
    const scope = new LearningProfileScope("profile-a", path.join(temp, "assets-a"));
    const storage = new LearningStorage({ sequelize, models, scope });

    const createdLesson = await storage.createLesson({
      brief: brief(),
      title: "Coffee practice",
    });
    assert.equal(createdLesson.lesson.profileId, "profile-a");
    assert.equal(createdLesson.lesson.title, "Coffee practice");
    assert.equal(createdLesson.revision.status, "draft");
    assert.equal(createdLesson.revision.content, null);
    assert.equal(createdLesson.lesson.activeRevisionId, createdLesson.revision.id);

    const createdMap = await storage.createMap({
      title: "Coffee relationships",
      lessonRevisionId: createdLesson.revision.id,
    });
    assert.equal(createdMap.map.lessonRevisionId, createdLesson.revision.id);
    assert.equal(createdMap.map.activeRevisionId, createdMap.revision.id);
    assert.equal(createdMap.revision.status, "draft");
    assert.equal(createdMap.revision.content, null);
    assert.deepEqual(createdMap.revision.brief, { level: "A2", illustrations: false });

    const explicitMap = await storage.createMap({
      title: "Advanced coffee relationships",
      level: "B2",
      illustrations: true,
    });
    assert.deepEqual(explicitMap.revision.brief, { level: "B2", illustrations: true });

    await scope.quiesce();
  });

  await test("validates brief and stores an immutable ready lesson revision", async () => {
    const databasePath = path.join(temp, "revision.sqlite");
    const sequelize = await openDatabase(databasePath, migration, mapBriefMigration);
    databaseHandles.add(sequelize);
    const models = createLearningModels(sequelize);
    const scope = new LearningProfileScope("profile-a", path.join(temp, "assets-revision"));
    const storage = new LearningStorage({ sequelize, models, scope });
    const created = await storage.createLesson({ brief: brief() });

    const missingTarget = draft();
    missingTarget.sections[0].text = "I am at a cafe with my friend.";
    await assert.rejects(
      storage.reviseLesson({
        lessonId: created.lesson.id,
        expectedRevisionId: created.revision.id,
        brief: brief(),
        content: missingTarget,
      }),
      (error) => error instanceof LearningStorageError && error.code === "invalid_content",
    );
    await assert.rejects(
      storage.reviseLesson({
        lessonId: created.lesson.id,
        expectedRevisionId: created.revision.id,
        brief: brief({ targets: [] }),
        content: draft(),
      }),
      (error) => error instanceof LearningStorageError && error.code === "invalid_content",
    );

    const ready = await storage.reviseLesson({
      lessonId: created.lesson.id,
      expectedRevisionId: created.revision.id,
      brief: brief(),
      content: draft(),
    });
    assert.equal(ready.revision.status, "ready");
    assert.equal(ready.revision.number, 2);
    assert.equal(ready.lesson.activeRevisionId, ready.revision.id);
    assert.deepEqual(ready.revision.content, draft());
    assert.ok(Array.isArray(ready.revision.validation));
    assert.ok(ready.revision.validation.some((warning) => warning.code === "cefr_length_outside_rubric"));
    assert.deepEqual(ready.revision.provenance, { source: "user_edit" });
    assert.equal(ready.revision.sourceHash, canonicalPayloadHash(draft()));

    const bundle = await storage.getLesson(created.lesson.id);
    assert.equal(bundle.revisions.length, 2);
    assert.equal(bundle.revisions[0].content, null);
    assert.deepEqual(bundle.revisions[1].content, draft());

    await scope.quiesce();
  });

  await test("materializes revision-scoped image and audio asset slots atomically", async () => {
    const databasePath = path.join(temp, "revision-asset-slots.sqlite");
    const sequelize = await openDatabase(databasePath, migration, mapBriefMigration);
    databaseHandles.add(sequelize);
    const models = createLearningModels(sequelize);
    const scope = new LearningProfileScope("profile-a", path.join(temp, "assets-revision-slots"));
    const storage = new LearningStorage({ sequelize, models, scope });
    const assetBrief = brief({ imageCount: 2, audio: true });
    const makeAssetDraft = (title, marker) => {
      const base = draft();
      return {
        ...base,
        title,
        sections: [
          {
            ...base.sections[0],
            text: `I am at a ${marker} cafe with my friend. I ask for a cup of tea.`,
          },
          {
            id: "section-two",
            text: `My friend has a cup of coffee at the ${marker} cafe.`,
            targetIds: ["cup"],
          },
        ],
        scenes: [
          {
            id: "scene-one",
            description: `A cup rests on a table in the ${marker} cafe.`,
            sectionIds: ["section-one"],
            targetIds: ["cup"],
          },
          {
            id: "scene-two",
            description: `A friend holds a warm cup in the ${marker} cafe.`,
            sectionIds: ["section-two"],
            targetIds: ["cup"],
          },
        ],
      };
    };

    const created = await storage.createLesson({ brief: assetBrief });
    const draftBundle = await storage.getLesson(created.lesson.id);
    assert.equal(created.revision.status, "draft");
    assert.equal(created.revision.content, null);
    assert.equal(draftBundle.slots.length, 0);

    const invalidContent = makeAssetDraft("Invalid lesson", "invalid");
    invalidContent.scenes.pop();
    await assert.rejects(
      storage.reviseLesson({
        lessonId: created.lesson.id,
        expectedRevisionId: created.revision.id,
        brief: assetBrief,
        content: invalidContent,
      }),
      (error) => error instanceof LearningStorageError && error.code === "invalid_content",
    );
    const afterInvalid = await storage.getLesson(created.lesson.id);
    assert.equal(afterInvalid.revisions.length, 1);
    assert.equal(afterInvalid.lesson.activeRevisionId, created.revision.id);
    assert.equal(afterInvalid.slots.length, 0);

    const firstContent = makeAssetDraft("First lesson", "first");
    const first = await storage.reviseLesson({
      lessonId: created.lesson.id,
      expectedRevisionId: created.revision.id,
      brief: assetBrief,
      content: firstContent,
    });
    const firstBundle = await storage.getLesson(created.lesson.id);
    const firstSlots = firstBundle.slots.filter((slot) => slot.lessonRevisionId === first.revision.id);
    assert.equal(firstSlots.length, 4);
    assert.deepEqual(
      firstSlots.map((slot) => ({
        profileId: slot.profileId,
        lessonRevisionId: slot.lessonRevisionId,
        sourceType: slot.sourceType,
        sourceId: slot.sourceId,
        kind: slot.kind,
        sourceHash: slot.sourceHash,
        slotKey: slot.slotKey,
        selectedAssetId: slot.selectedAssetId,
      })).sort((left, right) => left.slotKey.localeCompare(right.slotKey)),
      [
        ...firstContent.scenes.map((scene) => ({
          profileId: "profile-a",
          lessonRevisionId: first.revision.id,
          sourceType: "scene",
          sourceId: scene.id,
          kind: "image",
          sourceHash: canonicalPayloadHash(scene),
          slotKey: `${first.revision.id}:image:${scene.id}`,
          selectedAssetId: null,
        })),
        ...firstContent.sections.map((section) => ({
          profileId: "profile-a",
          lessonRevisionId: first.revision.id,
          sourceType: "section",
          sourceId: section.id,
          kind: "audio",
          sourceHash: canonicalPayloadHash(section),
          slotKey: `${first.revision.id}:audio:${section.id}`,
          selectedAssetId: null,
        })),
      ].sort((left, right) => left.slotKey.localeCompare(right.slotKey)),
    );

    const oldImageSlot = firstSlots.find((slot) => slot.kind === "image");
    const oldAudioSlot = firstSlots.find((slot) => slot.kind === "audio");
    assert.ok(oldImageSlot);
    assert.ok(oldAudioSlot);
    const oldImageAssetId = uuid(901);
    const oldAudioAssetId = uuid(902);
    await models.GeneratedAsset.create({
      id: oldImageAssetId,
      profileId: "profile-a",
      slotId: oldImageSlot.id,
      relativePath: `${oldImageAssetId}.png`,
      kind: "image",
      mimeType: "image/png",
      sha256: "old-image-hash",
      sizeBytes: 20,
      width: 10,
      height: 10,
    });
    await models.GeneratedAsset.create({
      id: oldAudioAssetId,
      profileId: "profile-a",
      slotId: oldAudioSlot.id,
      relativePath: `${oldAudioAssetId}.wav`,
      kind: "audio",
      mimeType: "audio/wav",
      sha256: "old-audio-hash",
      sizeBytes: 20,
      durationMs: 400,
    });
    await storage.selectAsset({ slotId: oldImageSlot.id, assetId: oldImageAssetId });
    await storage.selectAsset({ slotId: oldAudioSlot.id, assetId: oldAudioAssetId });
    const oldSlotSnapshot = firstSlots.map((slot) => ({
      id: slot.id,
      lessonRevisionId: slot.lessonRevisionId,
      sourceType: slot.sourceType,
      sourceId: slot.sourceId,
      kind: slot.kind,
      sourceHash: slot.sourceHash,
      slotKey: slot.slotKey,
      selectedAssetId: slot.id === oldImageSlot.id ? oldImageAssetId : slot.id === oldAudioSlot.id ? oldAudioAssetId : null,
    }));

    const secondContent = makeAssetDraft("Second lesson", "second");
    const second = await storage.reviseLesson({
      lessonId: created.lesson.id,
      expectedRevisionId: first.revision.id,
      brief: assetBrief,
      content: secondContent,
    });
    const secondBundle = await storage.getLesson(created.lesson.id);
    const secondSlots = secondBundle.slots.filter((slot) => slot.lessonRevisionId === second.revision.id);
    assert.equal(second.revision.number, 3);
    assert.equal(secondSlots.length, 4);
    assert.equal(secondBundle.slots.length, 8);
    assert.equal(secondBundle.assets.length, 2);
    assert.deepEqual(
      secondBundle.slots
        .filter((slot) => slot.lessonRevisionId === first.revision.id)
        .map((slot) => ({
          id: slot.id,
          lessonRevisionId: slot.lessonRevisionId,
          sourceType: slot.sourceType,
          sourceId: slot.sourceId,
          kind: slot.kind,
          sourceHash: slot.sourceHash,
          slotKey: slot.slotKey,
          selectedAssetId: slot.selectedAssetId,
        })),
      oldSlotSnapshot,
    );
    assert.deepEqual(
      secondSlots.map((slot) => ({
        profileId: slot.profileId,
        lessonRevisionId: slot.lessonRevisionId,
        sourceType: slot.sourceType,
        sourceId: slot.sourceId,
        kind: slot.kind,
        sourceHash: slot.sourceHash,
        slotKey: slot.slotKey,
        selectedAssetId: slot.selectedAssetId,
      })).sort((left, right) => left.slotKey.localeCompare(right.slotKey)),
      [
        ...secondContent.scenes.map((scene) => ({
          profileId: "profile-a",
          lessonRevisionId: second.revision.id,
          sourceType: "scene",
          sourceId: scene.id,
          kind: "image",
          sourceHash: canonicalPayloadHash(scene),
          slotKey: `${second.revision.id}:image:${scene.id}`,
          selectedAssetId: null,
        })),
        ...secondContent.sections.map((section) => ({
          profileId: "profile-a",
          lessonRevisionId: second.revision.id,
          sourceType: "section",
          sourceId: section.id,
          kind: "audio",
          sourceHash: canonicalPayloadHash(section),
          slotKey: `${second.revision.id}:audio:${section.id}`,
          selectedAssetId: null,
        })),
      ].sort((left, right) => left.slotKey.localeCompare(right.slotKey)),
    );

    const invalidAfterReady = makeAssetDraft("Invalid after ready", "invalid-again");
    invalidAfterReady.scenes = [];
    await assert.rejects(
      storage.reviseLesson({
        lessonId: created.lesson.id,
        expectedRevisionId: second.revision.id,
        brief: assetBrief,
        content: invalidAfterReady,
      }),
      (error) => error instanceof LearningStorageError && error.code === "invalid_content",
    );
    const afterSecondInvalid = await storage.getLesson(created.lesson.id);
    assert.equal(afterSecondInvalid.revisions.length, 3);
    assert.equal(afterSecondInvalid.lesson.activeRevisionId, second.revision.id);
    assert.equal(afterSecondInvalid.slots.length, 8);

    await scope.quiesce();
  });

  await test("reopens persisted bundles and isolates every read by profile", async () => {
    const databasePath = path.join(temp, "profiles.sqlite");
    let sequelize = await openDatabase(databasePath, migration, mapBriefMigration);
    databaseHandles.add(sequelize);
    let models = createLearningModels(sequelize);
    let scope = new LearningProfileScope("profile-a", path.join(temp, "assets-profile-a"));
    let storage = new LearningStorage({ sequelize, models, scope });
    const created = await storage.createLesson({ brief: brief() });
    const ready = await storage.reviseLesson({
      lessonId: created.lesson.id,
      expectedRevisionId: created.revision.id,
      brief: brief(),
      content: draft(),
    });
    await scope.quiesce();
    await sequelize.close();
    databaseHandles.delete(sequelize);

    sequelize = new Sequelize({ dialect: "sqlite", storage: databasePath, logging: false });
    databaseHandles.add(sequelize);
    models = createLearningModels(sequelize);
    scope = new LearningProfileScope("profile-a", path.join(temp, "assets-profile-a"));
    storage = new LearningStorage({ sequelize, models, scope });
    const reopened = await storage.getLesson(created.lesson.id);
    assert.equal(reopened.lesson.activeRevisionId, ready.revision.id);
    assert.deepEqual(reopened.revisions[1].content, draft());
    assert.deepEqual(await storage.listLessons(), [reopened.lesson]);

    const otherScope = new LearningProfileScope("profile-b", path.join(temp, "assets-profile-b"));
    const otherStorage = new LearningStorage({
      sequelize,
      models: createLearningModels(sequelize),
      scope: otherScope,
    });
    assert.deepEqual(await otherStorage.listLessons(), []);
    await assert.rejects(
      otherStorage.getLesson(created.lesson.id),
      (error) => error instanceof LearningStorageError && error.code === "learning_not_found",
    );
    await Promise.all([scope.quiesce(), otherScope.quiesce()]);
  });

  await test("serializes concurrent same-profile CAS writes so exactly one revision wins", async () => {
    const databasePath = path.join(temp, "cas.sqlite");
    const sequelize = await openDatabase(databasePath, migration, mapBriefMigration);
    databaseHandles.add(sequelize);
    const models = createLearningModels(sequelize);
    const scope = new LearningProfileScope("profile-a", path.join(temp, "assets-cas"));
    const storage = new LearningStorage({ sequelize, models, scope });
    const created = await storage.createLesson({ brief: brief() });
    const first = await storage.reviseLesson({
      lessonId: created.lesson.id,
      expectedRevisionId: created.revision.id,
      brief: brief(),
      content: draft(),
    });
    const makeRequest = (suffix) => storage.reviseLesson({
      lessonId: created.lesson.id,
      expectedRevisionId: first.revision.id,
      brief: brief(),
      content: draft({ title: `Coffee ${suffix}` }),
    });
    const outcomes = await Promise.allSettled([makeRequest("one"), makeRequest("two")]);
    assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(outcomes.filter(({ status }) => status === "rejected").length, 1);
    const conflict = outcomes.find(({ status }) => status === "rejected")?.reason;
    assert.equal(conflict.code, "learning_revision_conflict");
    const after = await storage.getLesson(created.lesson.id);
    assert.equal(after.revisions.length, 3);
    assert.equal(after.revisions.filter((revision) => revision.status === "ready").length, 2);
    assert.equal(after.lesson.activeRevisionId, after.revisions[2].id);

    await scope.quiesce();
  });

  await test("coordinates concurrent writes from profiles sharing one connection", async () => {
    const databasePath = path.join(temp, "shared-queue.sqlite");
    const sequelize = await openDatabase(databasePath, migration, mapBriefMigration);
    databaseHandles.add(sequelize);
    const modelsA = createLearningModels(sequelize);
    const modelsB = createLearningModels(sequelize);
    const scopeA = new LearningProfileScope("profile-a", path.join(temp, "assets-queue-a"));
    const scopeB = new LearningProfileScope("profile-b", path.join(temp, "assets-queue-b"));
    const storageA = new LearningStorage({ sequelize, models: modelsA, scope: scopeA });
    const storageB = new LearningStorage({ sequelize, models: modelsB, scope: scopeB });
    const outcomes = await Promise.all([
      ...Array.from({ length: 4 }, () => storageA.createLesson({ brief: brief() })),
      ...Array.from({ length: 4 }, () => storageB.createLesson({ brief: brief() })),
    ]);
    assert.equal(outcomes.length, 8);
    assert.equal((await storageA.listLessons()).length, 4);
    assert.equal((await storageB.listLessons()).length, 4);
    await Promise.all([scopeA.quiesce(), scopeB.quiesce()]);
  });

  await test("stores map revisions and layouts independently with stable validated positions", async () => {
    const databasePath = path.join(temp, "map.sqlite");
    const sequelize = await openDatabase(databasePath, migration, mapBriefMigration);
    databaseHandles.add(sequelize);
    const models = createLearningModels(sequelize);
    const scope = new LearningProfileScope("profile-a", path.join(temp, "assets-map"));
    const storage = new LearningStorage({ sequelize, models, scope });
    const created = await storage.createMap({ title: "Coffee map", level: "B1", illustrations: true });
    const illustratedGraph = graph();
    illustratedGraph.studyGroups[0].illustration = {
      prompt: "A cup of tea on a quiet cafe table",
      alt: "A cup of tea on a cafe table",
    };
    const ready = await storage.reviseMap({
      mapId: created.map.id,
      expectedRevisionId: created.revision.id,
      content: illustratedGraph,
    });
    const layout = await storage.saveMapLayout({
      mapRevisionId: ready.revision.id,
      positions: [
        { id: "cup", x: 25, y: -10 },
        { id: "tea", x: 0, y: 40 },
      ],
    });
    assert.deepEqual(layout.positions, [
      { id: "cup", x: 25, y: -10 },
      { id: "tea", x: 0, y: 40 },
    ]);
    await assert.rejects(
      storage.saveMapLayout({
        mapRevisionId: ready.revision.id,
        positions: [{ id: "node-missing", x: 0, y: 0 }],
      }),
      (error) => error instanceof LearningStorageError && error.code === "invalid_reference",
    );
    await assert.rejects(
      storage.saveMapLayout({
        mapRevisionId: ready.revision.id,
        positions: [{ id: "cup", x: Number.NaN, y: 0 }],
      }),
      (error) => error instanceof LearningStorageError && error.code === "invalid_layout",
    );
    const mapBundle = await storage.getMap(created.map.id);
    assert.equal(mapBundle.revisions[0].content, null);
    assert.deepEqual(mapBundle.revisions[0].brief, { level: "B1", illustrations: true });
    assert.deepEqual(mapBundle.revisions[1].brief, { level: "B1", illustrations: true });
    assert.deepEqual(mapBundle.revisions[1].content, illustratedGraph);
    assert.equal(mapBundle.slots.length, 1);
    assert.deepEqual(
      mapBundle.slots[0],
      {
        ...mapBundle.slots[0],
        sourceType: "group",
        sourceId: "drink-words",
        kind: "image",
        sourceHash: canonicalPayloadHash({
          group: illustratedGraph.studyGroups[0],
          nodes: [illustratedGraph.nodes[1]],
        }),
        slotKey: `${ready.revision.id}:image:drink-words`,
      },
    );
    const originalSlot = await models.AssetSlot.findByPk(mapBundle.slots[0].id);
    const originalAssetId = uuid(901);
    await models.GeneratedAsset.create({
      id: originalAssetId,
      profileId: "profile-a",
      slotId: originalSlot.id,
      relativePath: `${originalAssetId}.png`,
      kind: "image",
      mimeType: "image/png",
      sha256: "a".repeat(64),
      sizeBytes: 16,
      width: 2,
      height: 2,
    });
    await originalSlot.update({ selectedAssetId: originalAssetId });
    const revisedGraph = structuredClone(illustratedGraph);
    revisedGraph.nodes[1].example = "I drink warm tea from this cup.";
    const second = await storage.reviseMap({
      mapId: created.map.id,
      expectedRevisionId: ready.revision.id,
      content: revisedGraph,
    });
    const revisedBundle = await storage.getMap(created.map.id);
    assert.deepEqual(second.revision.brief, { level: "B1", illustrations: true });
    assert.equal(revisedBundle.slots.length, 2);
    assert.equal(revisedBundle.assets.length, 1);
    assert.equal(revisedBundle.assets[0].id, originalAssetId);
    const preservedSlot = revisedBundle.slots.find((slot) => slot.id === originalSlot.id);
    const replacementSlot = revisedBundle.slots.find((slot) => slot.mapRevisionId === second.revision.id);
    assert.equal(preservedSlot.selectedAssetId, originalAssetId);
    assert.notEqual(replacementSlot.sourceHash, preservedSlot.sourceHash);
    assert.equal(mapBundle.layouts.length, 1);
    assert.deepEqual(mapBundle.layouts[0].positions, layout.positions);
    await scope.quiesce();
  });

  await test("selects only own-slot assets and records practice from immutable exercise definitions", async () => {
    const databasePath = path.join(temp, "assets-practice.sqlite");
    const sequelize = await openDatabase(databasePath, migration, mapBriefMigration);
    databaseHandles.add(sequelize);
    const models = createLearningModels(sequelize);
    const scope = new LearningProfileScope("profile-a", path.join(temp, "assets-practice"));
    const storage = new LearningStorage({ sequelize, models, scope });
    const created = await storage.createLesson({ brief: brief() });
    const ready = await storage.reviseLesson({
      lessonId: created.lesson.id,
      expectedRevisionId: created.revision.id,
      brief: brief(),
      content: draft(),
    });
    const slotId = uuid(401);
    const assetId = uuid(402);
    const otherSlotId = uuid(403);
    const otherAssetId = uuid(404);
    await models.AssetSlot.create({
      id: slotId,
      profileId: "profile-a",
      lessonRevisionId: ready.revision.id,
      sourceType: "practice",
      sourceId: "meaning-cup",
      kind: "audio",
      sourceHash: "source-hash",
      slotKey: `lesson-revision:${ready.revision.id}:practice:meaning-cup`,
    });
    await models.GeneratedAsset.create({
      id: assetId,
      profileId: "profile-a",
      slotId,
      relativePath: `${assetId}.wav`,
      kind: "audio",
      mimeType: "audio/wav",
      sha256: "asset-hash",
      sizeBytes: 10,
      durationMs: 400,
    });
    await models.AssetSlot.create({
      id: otherSlotId,
      profileId: "profile-a",
      lessonRevisionId: ready.revision.id,
      sourceType: "practice",
      sourceId: "fill-cup",
      kind: "audio",
      sourceHash: "source-hash",
      slotKey: `lesson-revision:${ready.revision.id}:practice:fill-cup`,
    });
    await models.GeneratedAsset.create({
      id: otherAssetId,
      profileId: "profile-a",
      slotId: otherSlotId,
      relativePath: `${otherAssetId}.wav`,
      kind: "audio",
      mimeType: "audio/wav",
      sha256: "other-hash",
      sizeBytes: 10,
      durationMs: 400,
    });
    const selected = await storage.selectAsset({ slotId, assetId });
    assert.equal(selected.selectedAssetId, assetId);
    await assert.rejects(
      storage.selectAsset({ slotId, assetId: otherAssetId }),
      (error) => error instanceof LearningStorageError && error.code === "invalid_reference",
    );
    const attempt = await storage.recordPractice({
      lessonRevisionId: ready.revision.id,
      questionId: "meaning-cup",
      answer: { choiceId: "choice-workmate" },
      result: { correct: true },
      recordingAssetId: assetId,
    });
    assert.equal(attempt.kind, "meaning");
    assert.deepEqual(attempt.targetIds, ["cup"]);
    assert.equal(attempt.recordingAssetId, assetId);
    await models.AssetSlot.update(
      { sourceType: "section" },
      { where: { id: slotId, profileId: "profile-a" } },
    );
    await assert.rejects(
      storage.recordPractice({
        lessonRevisionId: ready.revision.id,
        questionId: "meaning-cup",
        answer: { choiceId: "container" },
        result: { correct: true },
        recordingAssetId: assetId,
      }),
      (error) => error instanceof LearningStorageError && error.code === "invalid_reference",
    );
    await models.AssetSlot.update(
      { sourceType: "practice", sourceId: "fill-cup" },
      { where: { id: slotId, profileId: "profile-a" } },
    );
    await assert.rejects(
      storage.recordPractice({
        lessonRevisionId: ready.revision.id,
        questionId: "meaning-cup",
        answer: { choiceId: "container" },
        result: { correct: true },
        recordingAssetId: assetId,
      }),
      (error) => error instanceof LearningStorageError && error.code === "invalid_reference",
    );
    await assert.rejects(
      storage.recordPractice({
        lessonRevisionId: ready.revision.id,
        questionId: "question-missing",
        answer: "x",
        result: {},
      }),
      (error) => error instanceof LearningStorageError && error.code === "invalid_reference",
    );
    await assert.rejects(
      storage.recordPractice({
        lessonRevisionId: ready.revision.id,
        questionId: "fill-cup",
        answer: "x",
        result: {},
        recordingAssetId: uuid(405),
      }),
      (error) => error instanceof LearningStorageError && error.code === "invalid_reference",
    );
    await scope.quiesce();
  });

  await test("rejects deletion of externally referenced assets and rolls back the transaction", async () => {
    const databasePath = path.join(temp, "delete-references.sqlite");
    const sequelize = await openDatabase(databasePath, migration, mapBriefMigration);
    databaseHandles.add(sequelize);
    const models = createLearningModels(sequelize);
    const scope = new LearningProfileScope("profile-a", path.join(temp, "assets-delete-references"));
    const storage = new LearningStorage({ sequelize, models, scope });
    const owner = await storage.createLesson({ brief: brief(), title: "Asset owner" });
    const ownerReady = await storage.reviseLesson({
      lessonId: owner.lesson.id,
      expectedRevisionId: owner.revision.id,
      brief: brief(),
      content: draft(),
    });
    const consumer = await storage.createLesson({ brief: brief(), title: "Asset consumer" });
    const consumerReady = await storage.reviseLesson({
      lessonId: consumer.lesson.id,
      expectedRevisionId: consumer.revision.id,
      brief: brief(),
      content: draft(),
    });
    const slotId = uuid(801);
    const assetId = uuid(802);
    await models.AssetSlot.create({
      id: slotId,
      profileId: "profile-a",
      lessonRevisionId: ownerReady.revision.id,
      sourceType: "practice",
      sourceId: "meaning-cup",
      kind: "audio",
      sourceHash: "owner-hash",
      slotKey: `lesson-revision:${ownerReady.revision.id}:practice:meaning-cup`,
    });
    await models.GeneratedAsset.create({
      id: assetId,
      profileId: "profile-a",
      slotId,
      relativePath: `${assetId}.wav`,
      kind: "audio",
      mimeType: "audio/wav",
      sha256: "owner-asset-hash",
      sizeBytes: 10,
      durationMs: 400,
    });
    const map = await storage.createMap({ title: "Asset consumer map" });
    const mapReady = await storage.reviseMap({
      mapId: map.map.id,
      expectedRevisionId: map.revision.id,
      content: graph(),
    });
    const externalSlot = await models.AssetSlot.create({
      id: uuid(803),
      profileId: "profile-a",
      mapRevisionId: mapReady.revision.id,
      sourceType: "node",
      sourceId: "cup",
      kind: "audio",
      sourceHash: "consumer-hash",
      slotKey: `map-revision:${mapReady.revision.id}:node:cup:audio`,
      selectedAssetId: assetId,
    });
    await assert.rejects(
      storage.deleteLesson(owner.lesson.id),
      (error) => error instanceof LearningStorageError && error.code === "invalid_reference",
    );
    assert.equal(await models.LearningLesson.count({ where: { profileId: "profile-a", id: owner.lesson.id } }), 1);
    assert.equal(await models.AssetSlot.count({ where: { profileId: "profile-a", id: slotId } }), 1);
    assert.equal(await models.GeneratedAsset.count({ where: { profileId: "profile-a", id: assetId } }), 1);
    assert.equal((await externalSlot.reload()).selectedAssetId, assetId);

    await externalSlot.update({ selectedAssetId: null });
    await models.PracticeAttempt.create({
      id: uuid(804),
      profileId: "profile-a",
      lessonRevisionId: consumerReady.revision.id,
      questionId: "meaning-cup",
      targetIds: ["cup"],
      kind: "meaning",
      answer: { choiceId: "container" },
      result: { correct: true },
      recordingAssetId: assetId,
    });
    await assert.rejects(
      storage.deleteLesson(owner.lesson.id),
      (error) => error instanceof LearningStorageError && error.code === "invalid_reference",
    );
    assert.equal(await models.LearningLesson.count({ where: { profileId: "profile-a", id: owner.lesson.id } }), 1);
    assert.equal(await models.AssetSlot.count({ where: { profileId: "profile-a", id: slotId } }), 1);
    assert.equal(await models.GeneratedAsset.count({ where: { profileId: "profile-a", id: assetId } }), 1);
    assert.equal(await models.PracticeAttempt.count({ where: { profileId: "profile-a", recordingAssetId: assetId } }), 1);
    await scope.quiesce();
  });

  await test("rejects busy deletion and cascades owned records while preserving linked maps", async () => {
    const databasePath = path.join(temp, "delete.sqlite");
    const sequelize = await openDatabase(databasePath, migration, mapBriefMigration);
    databaseHandles.add(sequelize);
    const models = createLearningModels(sequelize);
    const scope = new LearningProfileScope("profile-a", path.join(temp, "assets-delete"));
    const storage = new LearningStorage({ sequelize, models, scope });
    const created = await storage.createLesson({ brief: brief(), title: "Delete me" });
    const ready = await storage.reviseLesson({
      lessonId: created.lesson.id,
      expectedRevisionId: created.revision.id,
      brief: brief(),
      content: draft(),
    });
    const linkedMap = await storage.createMap({
      title: "Snapshot map",
      lessonRevisionId: ready.revision.id,
    });
    const job = await models.GenerationJob.create({
      id: uuid(501),
      profileId: "profile-a",
      resourceType: "lesson",
      resourceId: created.lesson.id,
      revisionId: ready.revision.id,
      requestKey: "busy-request",
      state: "running",
    });
    await assert.rejects(
      storage.deleteLesson(created.lesson.id),
      (error) => error instanceof LearningStorageError && error.code === "resource_busy",
    );
    await job.update({ state: "completed" });

    const slotId = uuid(502);
    const assetId = uuid(503);
    await models.AssetSlot.create({
      id: slotId,
      profileId: "profile-a",
      lessonRevisionId: ready.revision.id,
      sourceType: "scene",
      sourceId: "section-one",
      kind: "image",
      sourceHash: "source-hash",
      slotKey: `lesson-revision:${ready.revision.id}:scene:section-one:image`,
    });
    await models.GeneratedAsset.create({
      id: assetId,
      profileId: "profile-a",
      slotId,
      relativePath: `${assetId}.png`,
      kind: "image",
      mimeType: "image/png",
      sha256: "image-hash",
      sizeBytes: 20,
      width: 10,
      height: 10,
    });
    await models.GenerationStage.create({
      id: uuid(504),
      profileId: "profile-a",
      jobId: job.id,
      key: "text",
      kind: "text",
      expectedRevisionId: ready.revision.id,
      state: "completed",
    });
    const removed = await storage.deleteLesson(created.lesson.id);
    assert.deepEqual(removed.removedAssetPaths, [`${assetId}.png`]);
    await assert.rejects(
      storage.getLesson(created.lesson.id),
      (error) => error instanceof LearningStorageError && error.code === "learning_not_found",
    );
    const preservedMap = await storage.getMap(linkedMap.map.id);
    assert.equal(preservedMap.map.lessonRevisionId, null);
    assert.equal(await models.GeneratedAsset.count({ where: { profileId: "profile-a", id: assetId } }), 0);
    assert.equal(await models.GenerationJob.count({ where: { profileId: "profile-a", id: job.id } }), 0);
    assert.equal(await models.GenerationStage.count({ where: { profileId: "profile-a", id: uuid(504) } }), 0);
    await scope.quiesce();
  });

  await test("deleteMap removes map-owned records and returns only deleted asset paths", async () => {
    const databasePath = path.join(temp, "delete-map.sqlite");
    const sequelize = await openDatabase(databasePath, migration, mapBriefMigration);
    databaseHandles.add(sequelize);
    const models = createLearningModels(sequelize);
    const scope = new LearningProfileScope("profile-a", path.join(temp, "assets-delete-map"));
    const storage = new LearningStorage({ sequelize, models, scope });
    const created = await storage.createMap({ title: "Delete map" });
    const ready = await storage.reviseMap({
      mapId: created.map.id,
      expectedRevisionId: created.revision.id,
      content: graph(),
    });
    const slotId = uuid(601);
    const assetId = uuid(602);
    await models.AssetSlot.create({
      id: slotId,
      profileId: "profile-a",
      mapRevisionId: ready.revision.id,
      sourceType: "node",
      sourceId: "node-coffee",
      kind: "image",
      sourceHash: "map-hash",
      slotKey: `map-revision:${ready.revision.id}:node:node-coffee:image`,
    });
    await models.GeneratedAsset.create({
      id: assetId,
      profileId: "profile-a",
      slotId,
      relativePath: `${assetId}.png`,
      kind: "image",
      mimeType: "image/png",
      sha256: "map-asset-hash",
      sizeBytes: 20,
      width: 10,
      height: 10,
    });
    const removed = await storage.deleteMap(created.map.id);
    assert.deepEqual(removed.removedAssetPaths, [`${assetId}.png`]);
    await assert.rejects(
      storage.getMap(created.map.id),
      (error) => error instanceof LearningStorageError && error.code === "learning_not_found",
    );
    assert.equal(await models.AssetSlot.count({ where: { profileId: "profile-a", id: slotId } }), 0);
    assert.equal(await models.GeneratedAsset.count({ where: { profileId: "profile-a", id: assetId } }), 0);
    await scope.quiesce();
  });

  await test("rejects malformed resource references before opening a transaction", async () => {
    const databasePath = path.join(temp, "strict-ids.sqlite");
    const sequelize = await openDatabase(databasePath, migration, mapBriefMigration);
    databaseHandles.add(sequelize);
    const models = createLearningModels(sequelize);
    const scope = new LearningProfileScope("profile-a", path.join(temp, "assets-strict"));
    const storage = new LearningStorage({ sequelize, models, scope });
    await assert.rejects(
      storage.getLesson("lesson-1"),
      (error) => error instanceof LearningStorageError && error.code === "invalid_id",
    );
    await assert.rejects(
      storage.createMap({ title: "Map", lessonRevisionId: "revision-1" }),
      (error) => error instanceof LearningStorageError && error.code === "invalid_id",
    );
    await scope.quiesce();
  });

  await test("exposes a serialized transaction boundary with rollback for root services", async () => {
    const databasePath = path.join(temp, "write-boundary.sqlite");
    const sequelize = await openDatabase(databasePath, migration, mapBriefMigration);
    databaseHandles.add(sequelize);
    const models = createLearningModels(sequelize);
    const scope = new LearningProfileScope("profile-a", path.join(temp, "assets-write"));
    const storage = new LearningStorage({ sequelize, models, scope });
    const committedId = uuid(701);
    const rolledBackId = uuid(702);
    await storage.write(async (transaction) => {
      await models.LearningLesson.create({
        id: committedId,
        profileId: "profile-a",
        title: "Committed by root",
        activeRevisionId: null,
      }, { transaction });
    });
    await assert.rejects(storage.write(async (transaction) => {
      await models.LearningLesson.create({
        id: rolledBackId,
        profileId: "profile-a",
        title: "Rolled back",
        activeRevisionId: null,
      }, { transaction });
      throw new Error("expected root transaction failure");
    }), /expected root transaction failure/);
    assert.equal(await models.LearningLesson.count({ where: { profileId: "profile-a", id: committedId } }), 1);
    assert.equal(await models.LearningLesson.count({ where: { profileId: "profile-a", id: rolledBackId } }), 0);
    await scope.quiesce();
  });

  console.info(`check-learning-storage: PASS (${tests.length} SQLite storage cases)`);
} finally {
  for (const sequelize of databaseHandles) {
    await sequelize.close().catch(() => {});
  }
  await rm(temp, { recursive: true, force: true });
}
