import { DataTypes } from "sequelize";

const timestamps = {
  created_at: { type: DataTypes.DATE, allowNull: false },
  updated_at: { type: DataTypes.DATE, allowNull: false },
};

async function up({ context: queryInterface }) {
  const transaction = await queryInterface.sequelize.transaction();
  try {
    await queryInterface.createTable("local_stories", {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      profile_id: { type: DataTypes.STRING, allowNull: false },
      source_key: { type: DataTypes.STRING, allowNull: true },
      title: { type: DataTypes.STRING, allowNull: false },
      content: { type: DataTypes.TEXT, allowNull: false },
      url: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
      html: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
      metadata: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
      extraction: { type: DataTypes.JSON, allowNull: true },
      extracted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      starred: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      provenance: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
      ...timestamps,
    }, { transaction });
    await queryInterface.addIndex("local_stories", ["profile_id", "source_key"], {
      unique: true,
      name: "uq_local_stories_profile_source",
      transaction,
    });

    await queryInterface.createTable("local_meanings", {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      profile_id: { type: DataTypes.STRING, allowNull: false },
      lookup_key: { type: DataTypes.STRING, allowNull: false },
      word: { type: DataTypes.STRING, allowNull: false },
      lemma: { type: DataTypes.STRING, allowNull: true },
      pronunciation: { type: DataTypes.STRING, allowNull: true },
      pos: { type: DataTypes.STRING, allowNull: true },
      definition: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
      translation: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
      lookups: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
      ...timestamps,
    }, { transaction });
    await queryInterface.addIndex("local_meanings", ["profile_id", "lookup_key"], {
      unique: true,
      name: "uq_local_meanings_profile_lookup",
      transaction,
    });

    await queryInterface.createTable("local_story_meanings", {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      profile_id: { type: DataTypes.STRING, allowNull: false },
      story_id: { type: DataTypes.STRING, allowNull: false },
      meaning_id: { type: DataTypes.STRING, allowNull: false },
      ...timestamps,
    }, { transaction });
    await queryInterface.addIndex("local_story_meanings", ["profile_id", "story_id", "meaning_id"], {
      unique: true,
      name: "uq_local_story_meanings_relation",
      transaction,
    });

    await queryInterface.createTable("local_reviews", {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      profile_id: { type: DataTypes.STRING, allowNull: false },
      meaning_id: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: "new" },
      due_at: { type: DataTypes.DATE, allowNull: true },
      ...timestamps,
    }, { transaction });
    await queryInterface.addIndex("local_reviews", ["profile_id", "meaning_id"], {
      unique: true,
      name: "uq_local_reviews_profile_meaning",
      transaction,
    });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function down({ context: queryInterface }) {
  const transaction = await queryInterface.sequelize.transaction();
  try {
    for (const table of ["local_reviews", "local_story_meanings", "local_meanings", "local_stories"]) {
      await queryInterface.dropTable(table, { transaction });
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export { up, down };
