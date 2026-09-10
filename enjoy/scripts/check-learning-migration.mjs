import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { Sequelize } from "sequelize";
import { Sequelize as SequelizeTypescript } from "sequelize-typescript";
import { SequelizeStorage, Umzug } from "umzug";

const root = path.resolve(import.meta.dirname, "..");
const migrationName = "1788701024340-create-learning-studio.js";
const migrationPath = path.join(root, "src/main/db/migrations", migrationName);
const mapBriefMigrationName = "1788789600000-add-learning-map-brief.js";
const mapBriefMigrationPath = path.join(root, "src/main/db/migrations", mapBriefMigrationName);
const temp = await mkdtemp(path.join(root, ".tmp-enjoy-learning-migration-"));
const modelOutput = path.join(temp, "learning-models.mjs");
const databasePath = path.join(temp, "learning.sqlite");

const tests = [];
const test = async (name, callback) => {
  await callback();
  tests.push(name);
};

const modelNames = [
  "LearningLesson",
  "LessonRevision",
  "LearningMap",
  "LearningMapRevision",
  "LearningMapLayout",
  "AssetSlot",
  "GeneratedAsset",
  "GenerationJob",
  "GenerationStage",
  "StageAttempt",
  "PracticeAttempt",
];

const tableNames = [
  "learning_lessons",
  "lesson_revisions",
  "learning_maps",
  "learning_map_revisions",
  "learning_map_layouts",
  "asset_slots",
  "generated_assets",
  "generation_jobs",
  "generation_stages",
  "stage_attempts",
  "practice_attempts",
];

const uuid = "11111111-1111-4111-8111-111111111111";
const uuid2 = "22222222-2222-4222-8222-222222222222";
const silentLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};
const jsonValue = (value) => typeof value === "string" ? JSON.parse(value) : value;

let modelModule;
let migration;
let mapBriefMigration;
let sequelize;
let models;

try {
  await build({
    stdin: {
      contents: `export { createLearningModels } from "./src/main/db/learning-models.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: modelOutput,
    external: ["sequelize"],
    logLevel: "silent",
  });

  modelModule = await import(`${pathToFileURL(modelOutput).href}?test=${Date.now()}`);
  migration = await import(
    `${pathToFileURL(migrationPath).href}?test=${Date.now()}`
  );
  mapBriefMigration = await import(
    `${pathToFileURL(mapBriefMigrationPath).href}?test=${Date.now()}`
  );

  await test("exports the complete learning model factory", async () => {
    assert.equal(typeof modelModule.createLearningModels, "function");
    sequelize = new Sequelize({
      dialect: "sqlite",
      storage: databasePath,
      logging: false,
    });
    models = modelModule.createLearningModels(sequelize);
    assert.deepEqual(Object.keys(models).sort(), [...modelNames].sort());
  });

  await sequelize.query(
    "CREATE TABLE stories (id TEXT PRIMARY KEY, title TEXT NOT NULL)"
  );
  await sequelize.query(
    "CREATE TABLE youtube_videos (id TEXT PRIMARY KEY, title TEXT NOT NULL)"
  );
  await sequelize.query(
    "CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
  );
  await sequelize.query(
    "INSERT INTO stories (id, title) VALUES ('story-1', 'Existing story')"
  );
  await sequelize.query(
    "INSERT INTO youtube_videos (id, title) VALUES ('youtube-1', 'Existing video')"
  );
  await sequelize.query(
    "INSERT INTO app_settings (key, value) VALUES ('theme', 'dark')"
  );

  let umzug = new Umzug({
    migrations: [
      {
        name: migrationName,
        up: migration.up,
        down: migration.down,
      },
      {
        name: mapBriefMigrationName,
        up: mapBriefMigration.up,
        down: mapBriefMigration.down,
      },
    ],
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger: silentLogger,
  });

  await test("runs the migration against SQLite and preserves existing tables", async () => {
    await umzug.up({ to: migrationName });
    const tables = await sequelize
      .getQueryInterface()
      .showAllTables();
    for (const tableName of tableNames) {
      assert.ok(tables.includes(tableName), `missing table ${tableName}`);
    }
    assert.ok(tables.includes("stories"));
    assert.ok(tables.includes("youtube_videos"));
    assert.ok(tables.includes("app_settings"));
    assert.deepEqual(
      (await sequelize.query("SELECT * FROM stories"))[0],
      [{ id: "story-1", title: "Existing story" }]
    );
    assert.deepEqual(
      (await sequelize.query("SELECT * FROM youtube_videos"))[0],
      [{ id: "youtube-1", title: "Existing video" }]
    );
    assert.deepEqual(
      (await sequelize.query("SELECT * FROM app_settings"))[0],
      [{ key: "theme", value: "dark" }]
    );

    const now = new Date().toISOString();
    await sequelize.getQueryInterface().bulkInsert("learning_lessons", [{
      id: "16161616-1616-4161-8161-161616161616",
      profile_id: "profile-a",
      title: "Linked lesson",
      active_revision_id: "17171717-1717-4171-8171-171717171717",
      created_at: now,
      updated_at: now,
    }]);
    await sequelize.query(
      `INSERT INTO lesson_revisions
       (id, profile_id, lesson_id, number, brief, content, status, validation, provenance, source_hash, created_at, updated_at)
       VALUES ($id, $profileId, $lessonId, 1, $brief, NULL, 'draft', $validation, $provenance, NULL, $createdAt, $updatedAt)`,
      { bind: {
        id: "17171717-1717-4171-8171-171717171717",
        profileId: "profile-a",
        lessonId: "16161616-1616-4161-8161-161616161616",
        brief: JSON.stringify({ level: "B1" }),
        validation: JSON.stringify([]),
        provenance: JSON.stringify({}),
        createdAt: now,
        updatedAt: now,
      } },
    );
    await sequelize.getQueryInterface().bulkInsert("learning_maps", [{
      id: "18181818-1818-4181-8181-181818181818",
      profile_id: "profile-a",
      title: "Legacy map",
      lesson_revision_id: "17171717-1717-4171-8171-171717171717",
      active_revision_id: "19191919-1919-4191-8191-191919191919",
      created_at: now,
      updated_at: now,
    }]);
    const legacyContent = { rootNodeId: "root", nodes: [{ id: "root" }], edges: [] };
    await sequelize.query(
      `INSERT INTO learning_map_revisions
       (id, profile_id, map_id, number, content, status, provenance, created_at, updated_at)
       VALUES ($id, $profileId, $mapId, 1, $content, 'ready', $provenance, $createdAt, $updatedAt)`,
      { bind: {
        id: "19191919-1919-4191-8191-191919191919",
        profileId: "profile-a",
        mapId: "18181818-1818-4181-8181-181818181818",
        content: JSON.stringify(legacyContent),
        provenance: JSON.stringify({ source: "legacy" }),
        createdAt: now,
        updatedAt: now,
      } },
    );
    const legacyPositions = [{ id: "root", x: 10, y: 20 }];
    await sequelize.query(
      `INSERT INTO learning_map_layouts
       (id, profile_id, map_revision_id, positions, created_at, updated_at)
       VALUES ($id, $profileId, $revisionId, $positions, $createdAt, $updatedAt)`,
      { bind: {
        id: "20202020-2020-4202-8202-202020202020",
        profileId: "profile-a",
        revisionId: "19191919-1919-4191-8191-191919191919",
        positions: JSON.stringify(legacyPositions),
        createdAt: now,
        updatedAt: now,
      } },
    );
    await sequelize.query(
      `INSERT INTO asset_slots
       (id, profile_id, lesson_revision_id, map_revision_id, source_type, source_id, kind, source_hash, slot_key, selected_asset_id, created_at, updated_at)
       VALUES ($id, $profileId, NULL, $revisionId, 'node', 'root', 'audio', $sourceHash, $slotKey, NULL, $createdAt, $updatedAt)`,
      { bind: {
        id: "21212121-2121-4212-8212-212121212121",
        profileId: "profile-a",
        revisionId: "19191919-1919-4191-8191-191919191919",
        sourceHash: "legacy-source-hash",
        slotKey: "legacy-map:audio:root",
        createdAt: now,
        updatedAt: now,
      } },
    );

    await umzug.up();
    const [legacyRows] = await sequelize.query(
      "SELECT brief, content, provenance FROM learning_map_revisions WHERE id = '19191919-1919-4191-8191-191919191919'"
    );
    assert.deepEqual(jsonValue(legacyRows[0].brief), { level: "B1", illustrations: false });
    assert.deepEqual(jsonValue(legacyRows[0].content), legacyContent);
    assert.deepEqual(jsonValue(legacyRows[0].provenance), { source: "legacy" });
    const [legacyLayouts] = await sequelize.query(
      "SELECT positions FROM learning_map_layouts WHERE id = '20202020-2020-4202-8202-202020202020'"
    );
    assert.deepEqual(jsonValue(legacyLayouts[0].positions), legacyPositions);
    const [legacySlots] = await sequelize.query(
      "SELECT source_type, source_id, source_hash, slot_key FROM asset_slots WHERE id = '21212121-2121-4212-8212-212121212121'"
    );
    assert.deepEqual(legacySlots, [{
      source_type: "node",
      source_id: "root",
      source_hash: "legacy-source-hash",
      slot_key: "legacy-map:audio:root",
    }]);
  });

  await test("re-running Umzug is a no-op", async () => {
    assert.deepEqual(await umzug.pending(), []);
    assert.deepEqual((await umzug.up()).map(({ name }) => name), []);
  });

  await test("keeps every model attribute mapped to a migrated SQLite column", async () => {
    const queryInterface = sequelize.getQueryInterface();
    for (const [modelName, model] of Object.entries(models)) {
      const description = await queryInterface.describeTable(model.getTableName());
      for (const [attributeName, attribute] of Object.entries(model.rawAttributes)) {
        const fieldName = attribute.field ?? attributeName;
        assert.ok(
          description[fieldName],
          `${modelName}.${attributeName} is missing ${fieldName}`
        );
      }
    }
  });

  await test("persists a map revision from draft without content to ready with content", async () => {
    const draftRevision = await models.LearningMapRevision.create({
      id: "15151515-1515-4151-8151-151515151515",
      profileId: "profile-a",
      mapId: "77777777-7777-4777-8777-777777777777",
      number: 2,
    });
    assert.equal(draftRevision.status, "draft");
    assert.equal(draftRevision.content, null);

    await draftRevision.update({
      status: "ready",
      content: { nodes: [{ id: "node-coffee" }] },
    });
    const readyRevision = await models.LearningMapRevision.findByPk(
      draftRevision.id
    );
    assert.equal(readyRevision.status, "ready");
    assert.deepEqual(readyRevision.content, {
      nodes: [{ id: "node-coffee" }],
    });
  });

  await test("persists JSON fields and timestamps through model instances", async () => {
    const lesson = await models.LearningLesson.create({
      id: uuid,
      profileId: "profile-a",
      title: "Coffee",
      activeRevisionId: null,
    });
    const revision = await models.LessonRevision.create({
      id: uuid2,
      profileId: "profile-a",
      lessonId: lesson.id,
      number: 1,
      brief: { topic: "Ordering coffee", level: "A2" },
      content: { sections: [{ id: "section-1", text: "Coffee, please." }] },
      status: "ready",
      sourceHash: "source-hash",
    });
    assert.ok(lesson.createdAt instanceof Date);
    assert.ok(lesson.updatedAt instanceof Date);
    assert.deepEqual(revision.brief, { topic: "Ordering coffee", level: "A2" });
    assert.deepEqual(revision.validation, []);
    assert.deepEqual(revision.provenance, {});
    await sequelize.close();

    sequelize = new Sequelize({
      dialect: "sqlite",
      storage: databasePath,
      logging: false,
    });
    models = modelModule.createLearningModels(sequelize);
    umzug = new Umzug({
      migrations: [
        {
          name: migrationName,
          up: migration.up,
          down: migration.down,
        },
        {
          name: mapBriefMigrationName,
          up: mapBriefMigration.up,
          down: mapBriefMigration.down,
        },
      ],
      context: sequelize.getQueryInterface(),
      storage: new SequelizeStorage({ sequelize }),
      logger: silentLogger,
    });
    const reopened = await models.LessonRevision.findByPk(uuid2);
    assert.deepEqual(reopened.toJSON().content, {
      sections: [{ id: "section-1", text: "Coffee, please." }],
    });
  });

  await test("enforces profile-scoped identity indexes", async () => {
    await assert.rejects(
      models.LessonRevision.create({
        id: "33333333-3333-4333-8333-333333333333",
        profileId: "profile-a",
        lessonId: uuid,
        number: 1,
        brief: {},
        status: "draft",
      })
    );
    await models.LessonRevision.create({
      id: "44444444-4444-4444-8444-444444444444",
      profileId: "profile-b",
      lessonId: uuid,
      number: 1,
      brief: {},
      status: "draft",
    });
    await models.AssetSlot.create({
      id: "55555555-5555-4555-8555-555555555555",
      profileId: "profile-a",
      lessonRevisionId: uuid2,
      sourceType: "scene",
      sourceId: "scene-1",
      kind: "image",
      sourceHash: "hash-1",
      slotKey: "lesson-revision:source:scene-1:image",
    });
    await assert.rejects(
      models.AssetSlot.create({
        id: "66666666-6666-4666-8666-666666666666",
        profileId: "profile-a",
        lessonRevisionId: uuid2,
        sourceType: "scene",
        sourceId: "scene-1",
        kind: "image",
        sourceHash: "hash-1",
        slotKey: "lesson-revision:source:scene-1:image",
      })
    );
  });

  await test("enforces job, stage, attempt, map, layout, and asset path identities", async () => {
    const mapId = "77777777-7777-4777-8777-777777777777";
    const mapRevisionId = "88888888-8888-4888-8888-888888888888";
    const layoutId = "99999999-9999-4999-8999-999999999999";
    const jobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const stageId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const generatedAssetId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    await models.LearningMap.create({
      id: mapId,
      profileId: "profile-a",
      title: "Coffee map",
    });
    await models.LearningMapRevision.create({
      id: mapRevisionId,
      profileId: "profile-a",
      mapId,
      number: 1,
      content: { nodes: [] },
    });
    await models.LearningMapLayout.create({
      id: layoutId,
      profileId: "profile-a",
      mapRevisionId,
      positions: {},
    });
    await assert.rejects(
      models.LearningMapLayout.create({
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        profileId: "profile-a",
        mapRevisionId,
        positions: {},
      })
    );

    await models.GenerationJob.create({
      id: jobId,
      profileId: "profile-a",
      resourceType: "lesson",
      resourceId: uuid,
      revisionId: uuid2,
      requestKey: "request-1",
    });
    await assert.rejects(
      models.GenerationJob.create({
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        profileId: "profile-a",
        resourceType: "lesson",
        resourceId: uuid,
        revisionId: uuid2,
        requestKey: "request-1",
      })
    );
    await models.GenerationStage.create({
      id: stageId,
      profileId: "profile-a",
      jobId,
      key: "text",
      kind: "text",
      expectedRevisionId: uuid2,
    });
    await assert.rejects(
      models.GenerationStage.create({
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        profileId: "profile-a",
        jobId,
        key: "text",
        kind: "text",
        expectedRevisionId: uuid2,
      })
    );
    await models.StageAttempt.create({
      id: "12121212-1212-4121-8121-121212121212",
      profileId: "profile-a",
      stageId,
      ordinal: 1,
      provider: "fixture",
      startedAt: new Date(),
    });
    await assert.rejects(
      models.StageAttempt.create({
        id: "13131313-1313-4131-8131-131313131313",
        profileId: "profile-a",
        stageId,
        ordinal: 1,
        provider: "fixture",
        startedAt: new Date(),
      })
    );
    await models.GeneratedAsset.create({
      id: generatedAssetId,
      profileId: "profile-a",
      slotId: "55555555-5555-4555-8555-555555555555",
      relativePath: "assets/one.png",
      kind: "image",
      mimeType: "image/png",
      sha256: "hash",
      sizeBytes: 1,
    });
    await assert.rejects(
      models.GeneratedAsset.create({
        id: "14141414-1414-4141-8141-141414141414",
        profileId: "profile-a",
        slotId: "55555555-5555-4555-8555-555555555555",
        relativePath: "assets/one.png",
        kind: "image",
        mimeType: "image/png",
        sha256: "hash-2",
        sizeBytes: 2,
      })
    );
  });

  await test("supports two independent model factories on separate connections", async () => {
    const secondDatabasePath = path.join(temp, "learning-second.sqlite");
    const second = new SequelizeTypescript({
      dialect: "sqlite",
      storage: secondDatabasePath,
      logging: false,
    });
    const secondModels = modelModule.createLearningModels(second);
    await second.authenticate();
    assert.notEqual(models.LearningLesson.sequelize, secondModels.LearningLesson.sequelize);
    await second.close();
  });

  await test("rolls back a failed migration without leaving partial learning tables", async () => {
    const rollbackDatabasePath = path.join(temp, "rollback.sqlite");
    const rollbackSequelize = new Sequelize({
      dialect: "sqlite",
      storage: rollbackDatabasePath,
      logging: false,
    });
    const queryInterface = rollbackSequelize.getQueryInterface();
    const failingContext = new Proxy(queryInterface, {
      get(target, property, receiver) {
        if (property === "createTable") {
          return async (tableName, ...args) => {
            if (tableName === "generation_stages") {
              throw new Error("expected migration failure");
            }
            return Reflect.get(target, property, receiver).call(target, tableName, ...args);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    await assert.rejects(
      migration.up({ context: failingContext }),
      /expected migration failure/
    );
    const rollbackTables = await rollbackSequelize
      .getQueryInterface()
      .showAllTables();
    assert.deepEqual(
      rollbackTables.filter((name) => tableNames.includes(name)),
      []
    );
    await rollbackSequelize.close();
  });

  await test("rolls down only the learning tables in reverse dependency order", async () => {
    await umzug.down();
    await umzug.down();
    const tables = await sequelize.getQueryInterface().showAllTables();
    for (const tableName of tableNames) {
      assert.equal(tables.includes(tableName), false, `table remains ${tableName}`);
    }
    assert.ok(tables.includes("stories"));
    assert.ok(tables.includes("youtube_videos"));
    assert.ok(tables.includes("app_settings"));
  });

  console.info(`check-learning-migration: PASS (${tests.length} SQLite model and migration cases)`);
} finally {
  await sequelize?.close().catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
