import { DataTypes, QueryTypes } from "sequelize";

const DEFAULT_MAP_BRIEF = Object.freeze({ level: "A2", illustrations: false });
const CEFR_LEVELS = new Set(["A1", "A2", "B1", "B2", "C1", "C2"]);

function parseJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function up({ context: queryInterface }) {
  const transaction = await queryInterface.sequelize.transaction();
  try {
    await queryInterface.addColumn(
      "learning_map_revisions",
      "brief",
      {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: DEFAULT_MAP_BRIEF,
      },
      { transaction },
    );

    const revisions = await queryInterface.sequelize.query(
      `SELECT revisions.id, revisions.profile_id, lessons.brief AS lesson_brief
       FROM learning_map_revisions AS revisions
       JOIN learning_maps AS maps
         ON maps.id = revisions.map_id AND maps.profile_id = revisions.profile_id
       LEFT JOIN lesson_revisions AS lessons
         ON lessons.id = maps.lesson_revision_id AND lessons.profile_id = maps.profile_id`,
      { type: QueryTypes.SELECT, transaction },
    );
    for (const revision of revisions) {
      const linkedBrief = parseJson(revision.lesson_brief);
      const level = linkedBrief && CEFR_LEVELS.has(linkedBrief.level)
        ? linkedBrief.level
        : DEFAULT_MAP_BRIEF.level;
      await queryInterface.sequelize.query(
        "UPDATE learning_map_revisions SET brief = $brief WHERE id = $id AND profile_id = $profileId",
        {
          bind: {
            brief: JSON.stringify({ level, illustrations: false }),
            id: revision.id,
            profileId: revision.profile_id,
          },
          transaction,
        },
      );
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function down({ context: queryInterface }) {
  const transaction = await queryInterface.sequelize.transaction();
  try {
    await queryInterface.sequelize.query(
      "ALTER TABLE learning_map_revisions DROP COLUMN brief",
      { transaction },
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export { down, up };
