import { DataTypes } from "sequelize";

const migrationTables = [
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

const uuid = () => ({
  type: DataTypes.UUID,
  primaryKey: true,
  allowNull: false,
  defaultValue: DataTypes.UUIDV4,
});

const identity = () => ({
  id: uuid(),
  profile_id: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: false,
  },
});

const nullableUuid = () => ({
  type: DataTypes.UUID,
  allowNull: true,
});

const json = (defaultValue, allowNull = false) => ({
  type: DataTypes.JSON,
  allowNull,
  defaultValue,
});

const positiveInteger = {
  type: DataTypes.INTEGER,
  allowNull: false,
};

const nonNegativeInteger = {
  type: DataTypes.INTEGER,
  allowNull: false,
};

const string = (allowNull = false) => ({
  type: DataTypes.STRING,
  allowNull,
});

const createIndex = async (queryInterface, tableName, fields, options, transaction) => {
  await queryInterface.addIndex(tableName, fields, {
    ...options,
    transaction,
  });
};

async function up({ context: queryInterface }) {
  const transaction = await queryInterface.sequelize.transaction();

  try {
    await queryInterface.createTable(
      "learning_lessons",
      {
        ...identity(),
        title: string(),
        active_revision_id: nullableUuid(),
      },
      { transaction }
    );

    await queryInterface.createTable(
      "lesson_revisions",
      {
        ...identity(),
        lesson_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        number: positiveInteger,
        brief: json({}),
        content: json(null, true),
        status: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: "draft",
        },
        validation: json([]),
        provenance: json({}),
        source_hash: string(true),
      },
      { transaction }
    );
    await createIndex(
      queryInterface,
      "lesson_revisions",
      ["profile_id", "lesson_id", "number"],
      { unique: true, name: "uq_lesson_revisions_profile_lesson_number" },
      transaction
    );

    await queryInterface.createTable(
      "learning_maps",
      {
        ...identity(),
        title: string(),
        lesson_revision_id: nullableUuid(),
        active_revision_id: nullableUuid(),
      },
      { transaction }
    );

    await queryInterface.createTable(
      "learning_map_revisions",
      {
        ...identity(),
        map_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        number: positiveInteger,
        content: json(null, true),
        status: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: "draft",
        },
        provenance: json({}),
      },
      { transaction }
    );
    await createIndex(
      queryInterface,
      "learning_map_revisions",
      ["profile_id", "map_id", "number"],
      { unique: true, name: "uq_learning_map_revisions_profile_map_number" },
      transaction
    );

    await queryInterface.createTable(
      "learning_map_layouts",
      {
        ...identity(),
        map_revision_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        positions: json({}),
      },
      { transaction }
    );
    await createIndex(
      queryInterface,
      "learning_map_layouts",
      ["profile_id", "map_revision_id"],
      { unique: true, name: "uq_learning_map_layouts_profile_revision" },
      transaction
    );

    await queryInterface.createTable(
      "asset_slots",
      {
        ...identity(),
        lesson_revision_id: nullableUuid(),
        map_revision_id: nullableUuid(),
        source_type: string(),
        source_id: string(),
        kind: string(),
        source_hash: string(),
        slot_key: string(),
        selected_asset_id: nullableUuid(),
      },
      { transaction }
    );
    await createIndex(
      queryInterface,
      "asset_slots",
      ["profile_id", "slot_key"],
      { unique: true, name: "uq_asset_slots_profile_slot_key" },
      transaction
    );

    await queryInterface.createTable(
      "generated_assets",
      {
        ...identity(),
        slot_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        relative_path: string(),
        kind: string(),
        mime_type: string(),
        sha256: string(),
        size_bytes: nonNegativeInteger,
        width: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        height: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        duration_ms: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        provenance: json({}),
      },
      { transaction }
    );
    await createIndex(
      queryInterface,
      "generated_assets",
      ["profile_id", "relative_path"],
      { unique: true, name: "uq_generated_assets_profile_relative_path" },
      transaction
    );

    await queryInterface.createTable(
      "generation_jobs",
      {
        ...identity(),
        resource_type: string(),
        resource_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        revision_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        request_key: string(),
        state: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: "queued",
        },
        metadata: json({}),
      },
      { transaction }
    );
    await createIndex(
      queryInterface,
      "generation_jobs",
      ["profile_id", "resource_type", "resource_id", "request_key"],
      { unique: true, name: "uq_generation_jobs_profile_resource_request" },
      transaction
    );

    await queryInterface.createTable(
      "generation_stages",
      {
        ...identity(),
        job_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        key: string(),
        kind: string(),
        slot_id: nullableUuid(),
        state: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: "queued",
        },
        active_attempt_id: nullableUuid(),
        expected_revision_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        committed_hash: string(true),
      },
      { transaction }
    );
    await createIndex(
      queryInterface,
      "generation_stages",
      ["profile_id", "job_id", "key"],
      { unique: true, name: "uq_generation_stages_profile_job_key" },
      transaction
    );

    await queryInterface.createTable(
      "stage_attempts",
      {
        ...identity(),
        stage_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        ordinal: positiveInteger,
        state: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: "running",
        },
        provider: string(),
        provider_session_id: string(true),
        provider_item_ids: json([]),
        error_code: string(true),
        started_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        finished_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        metadata: json({}),
      },
      { transaction }
    );
    await createIndex(
      queryInterface,
      "stage_attempts",
      ["profile_id", "stage_id", "ordinal"],
      { unique: true, name: "uq_stage_attempts_profile_stage_ordinal" },
      transaction
    );

    await queryInterface.createTable(
      "practice_attempts",
      {
        ...identity(),
        lesson_revision_id: {
          type: DataTypes.UUID,
          allowNull: false,
        },
        question_id: string(),
        target_ids: json([]),
        kind: string(),
        answer: json({}),
        result: json({}),
        recording_asset_id: nullableUuid(),
      },
      { transaction }
    );

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function down({ context: queryInterface }) {
  const transaction = await queryInterface.sequelize.transaction();

  try {
    for (const tableName of [...migrationTables].reverse()) {
      await queryInterface.dropTable(tableName, { transaction });
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export { up, down };
