import {
  DataTypes,
  Model,
  type ModelAttributes,
  type ModelCtor,
  type Optional,
  type Sequelize,
} from "sequelize";

type JsonValue = unknown;

interface Timestamps {
  createdAt: Date;
  updatedAt: Date;
}

interface LearningIdentity extends Timestamps {
  id: string;
  profileId: string;
}

export interface LearningLessonAttributes extends LearningIdentity {
  title: string;
  activeRevisionId: string | null;
}

export type LearningLessonCreationAttributes = Optional<
  LearningLessonAttributes,
  "id" | "activeRevisionId" | "createdAt" | "updatedAt"
>;

export interface LessonRevisionAttributes extends LearningIdentity {
  lessonId: string;
  number: number;
  brief: JsonValue;
  content: JsonValue | null;
  status: "draft" | "ready";
  validation: JsonValue;
  provenance: JsonValue;
  sourceHash: string | null;
}

export type LessonRevisionCreationAttributes = Optional<
  LessonRevisionAttributes,
  | "id"
  | "content"
  | "validation"
  | "provenance"
  | "sourceHash"
  | "createdAt"
  | "updatedAt"
>;

export interface LearningMapAttributes extends LearningIdentity {
  title: string;
  lessonRevisionId: string | null;
  activeRevisionId: string | null;
}

export type LearningMapCreationAttributes = Optional<
  LearningMapAttributes,
  | "id"
  | "lessonRevisionId"
  | "activeRevisionId"
  | "createdAt"
  | "updatedAt"
>;

export interface LearningMapRevisionAttributes extends LearningIdentity {
  mapId: string;
  number: number;
  brief: JsonValue;
  content: JsonValue | null;
  status: "draft" | "ready";
  provenance: JsonValue;
}

export type LearningMapRevisionCreationAttributes = Optional<
  LearningMapRevisionAttributes,
  "id" | "brief" | "content" | "status" | "provenance" | "createdAt" | "updatedAt"
>;

export interface LearningMapLayoutAttributes extends LearningIdentity {
  mapRevisionId: string;
  positions: JsonValue;
}

export type LearningMapLayoutCreationAttributes = Optional<
  LearningMapLayoutAttributes,
  "id" | "positions" | "createdAt" | "updatedAt"
>;

export interface AssetSlotAttributes extends LearningIdentity {
  lessonRevisionId: string | null;
  mapRevisionId: string | null;
  sourceType: "scene" | "section" | "node" | "group" | "practice";
  sourceId: string;
  kind: "image" | "audio";
  sourceHash: string;
  slotKey: string;
  selectedAssetId: string | null;
}

export type AssetSlotCreationAttributes = Optional<
  AssetSlotAttributes,
  "id" | "selectedAssetId" | "createdAt" | "updatedAt"
>;

export interface GeneratedAssetAttributes extends LearningIdentity {
  slotId: string;
  relativePath: string;
  kind: "image" | "audio";
  mimeType: string;
  sha256: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  provenance: JsonValue;
}

export type GeneratedAssetCreationAttributes = Optional<
  GeneratedAssetAttributes,
  | "id"
  | "width"
  | "height"
  | "durationMs"
  | "provenance"
  | "createdAt"
  | "updatedAt"
>;

export interface GenerationJobAttributes extends LearningIdentity {
  resourceType: "lesson" | "map";
  resourceId: string;
  revisionId: string;
  requestKey: string;
  state:
    | "queued"
    | "running"
    | "partial"
    | "completed"
    | "cancelled"
    | "interrupted"
    | "failed";
  metadata: JsonValue;
}

export type GenerationJobCreationAttributes = Optional<
  GenerationJobAttributes,
  "id" | "metadata" | "createdAt" | "updatedAt"
>;

export interface GenerationStageAttributes extends LearningIdentity {
  jobId: string;
  key: string;
  kind: "text" | "map" | "image" | "audio" | "exercises";
  slotId: string | null;
  state:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "interrupted"
    | "cancelling"
    | "cancelled"
    | "reconciling"
    | "awaiting_retry";
  activeAttemptId: string | null;
  expectedRevisionId: string;
  committedHash: string | null;
}

export type GenerationStageCreationAttributes = Optional<
  GenerationStageAttributes,
  "id" | "slotId" | "activeAttemptId" | "committedHash" | "createdAt" | "updatedAt"
>;

export interface StageAttemptAttributes extends LearningIdentity {
  stageId: string;
  ordinal: number;
  state: "running" | "completed" | "failed" | "interrupted" | "cancelled";
  provider: string;
  providerSessionId: string | null;
  providerItemIds: JsonValue;
  errorCode: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  metadata: JsonValue;
}

export type StageAttemptCreationAttributes = Optional<
  StageAttemptAttributes,
  | "id"
  | "providerSessionId"
  | "providerItemIds"
  | "errorCode"
  | "finishedAt"
  | "metadata"
  | "createdAt"
  | "updatedAt"
>;

export interface PracticeAttemptAttributes extends LearningIdentity {
  lessonRevisionId: string;
  questionId: string;
  targetIds: JsonValue;
  kind: string;
  answer: JsonValue;
  result: JsonValue;
  recordingAssetId: string | null;
}

export type PracticeAttemptCreationAttributes = Optional<
  PracticeAttemptAttributes,
  "id" | "recordingAssetId" | "createdAt" | "updatedAt"
>;

type LearningModel<Attributes extends object, CreationAttributes extends object> =
  ModelCtor<Model<Attributes, CreationAttributes> & Attributes>;

export interface LearningModels {
  LearningLesson: LearningModel<
    LearningLessonAttributes,
    LearningLessonCreationAttributes
  >;
  LessonRevision: LearningModel<
    LessonRevisionAttributes,
    LessonRevisionCreationAttributes
  >;
  LearningMap: LearningModel<LearningMapAttributes, LearningMapCreationAttributes>;
  LearningMapRevision: LearningModel<
    LearningMapRevisionAttributes,
    LearningMapRevisionCreationAttributes
  >;
  LearningMapLayout: LearningModel<
    LearningMapLayoutAttributes,
    LearningMapLayoutCreationAttributes
  >;
  AssetSlot: LearningModel<AssetSlotAttributes, AssetSlotCreationAttributes>;
  GeneratedAsset: LearningModel<
    GeneratedAssetAttributes,
    GeneratedAssetCreationAttributes
  >;
  GenerationJob: LearningModel<
    GenerationJobAttributes,
    GenerationJobCreationAttributes
  >;
  GenerationStage: LearningModel<
    GenerationStageAttributes,
    GenerationStageCreationAttributes
  >;
  StageAttempt: LearningModel<
    StageAttemptAttributes,
    StageAttemptCreationAttributes
  >;
  PracticeAttempt: LearningModel<
    PracticeAttemptAttributes,
    PracticeAttemptCreationAttributes
  >;
}

const uuid = () => ({
  type: DataTypes.UUID,
  primaryKey: true,
  allowNull: false,
  defaultValue: DataTypes.UUIDV4,
});

const identity = () => ({
  id: uuid(),
  profileId: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  updatedAt: {
    type: DataTypes.DATE,
    allowNull: false,
  },
});

const positiveInteger = () => ({
  type: DataTypes.INTEGER,
  allowNull: false,
  validate: { min: 1 },
});

const nonNegativeInteger = () => ({
  type: DataTypes.INTEGER,
  allowNull: false,
  validate: { min: 0 },
});

const nullableUuid = () => ({
  type: DataTypes.UUID,
  allowNull: true,
});

const json = (defaultValue: JsonValue, allowNull = false) => ({
  type: DataTypes.JSON,
  allowNull,
  defaultValue,
});

const enumString = (values: readonly string[], defaultValue?: string) => ({
  type: DataTypes.STRING,
  allowNull: false,
  ...(defaultValue === undefined ? {} : { defaultValue }),
  validate: { isIn: [values] },
});

const defineLearningModel = <
  Attributes extends object,
  CreationAttributes extends object,
>(
  sequelize: Sequelize,
  modelName: string,
  tableName: string,
  attributes: ModelAttributes<Model<Attributes, CreationAttributes>, Attributes>
): LearningModel<Attributes, CreationAttributes> =>
  sequelize.define<Model<Attributes, CreationAttributes>, Attributes>(
    modelName,
    attributes,
    {
      modelName,
      tableName,
      underscored: true,
      timestamps: true,
    }
  ) as unknown as LearningModel<Attributes, CreationAttributes>;

export function createLearningModels(sequelize: Sequelize): LearningModels {
  const LearningLesson = defineLearningModel<
    LearningLessonAttributes,
    LearningLessonCreationAttributes
  >(sequelize, "LearningLesson", "learning_lessons", {
    ...identity(),
    title: { type: DataTypes.STRING, allowNull: false },
    activeRevisionId: nullableUuid(),
  });

  const LessonRevision = defineLearningModel<
    LessonRevisionAttributes,
    LessonRevisionCreationAttributes
  >(sequelize, "LessonRevision", "lesson_revisions", {
    ...identity(),
    lessonId: { type: DataTypes.UUID, allowNull: false },
    number: positiveInteger(),
    brief: json({}, false),
    content: json(null, true),
    status: enumString(["draft", "ready"], "draft"),
    validation: json([]),
    provenance: json({}),
    sourceHash: { type: DataTypes.STRING, allowNull: true },
  });

  const LearningMap = defineLearningModel<
    LearningMapAttributes,
    LearningMapCreationAttributes
  >(sequelize, "LearningMap", "learning_maps", {
    ...identity(),
    title: { type: DataTypes.STRING, allowNull: false },
    lessonRevisionId: nullableUuid(),
    activeRevisionId: nullableUuid(),
  });

  const LearningMapRevision = defineLearningModel<
    LearningMapRevisionAttributes,
    LearningMapRevisionCreationAttributes
  >(sequelize, "LearningMapRevision", "learning_map_revisions", {
    ...identity(),
    mapId: { type: DataTypes.UUID, allowNull: false },
    number: positiveInteger(),
    brief: json({ level: "A2", illustrations: false }, false),
    content: json(null, true),
    status: enumString(["draft", "ready"], "draft"),
    provenance: json({}),
  });

  const LearningMapLayout = defineLearningModel<
    LearningMapLayoutAttributes,
    LearningMapLayoutCreationAttributes
  >(sequelize, "LearningMapLayout", "learning_map_layouts", {
    ...identity(),
    mapRevisionId: { type: DataTypes.UUID, allowNull: false },
    positions: json({}),
  });

  const AssetSlot = defineLearningModel<
    AssetSlotAttributes,
    AssetSlotCreationAttributes
  >(sequelize, "AssetSlot", "asset_slots", {
    ...identity(),
    lessonRevisionId: nullableUuid(),
    mapRevisionId: nullableUuid(),
    sourceType: enumString(["scene", "section", "node", "group", "practice"]),
    sourceId: { type: DataTypes.STRING, allowNull: false },
    kind: enumString(["image", "audio"]),
    sourceHash: { type: DataTypes.STRING, allowNull: false },
    slotKey: { type: DataTypes.STRING, allowNull: false },
    selectedAssetId: nullableUuid(),
  });

  const GeneratedAsset = defineLearningModel<
    GeneratedAssetAttributes,
    GeneratedAssetCreationAttributes
  >(sequelize, "GeneratedAsset", "generated_assets", {
    ...identity(),
    slotId: { type: DataTypes.UUID, allowNull: false },
    relativePath: { type: DataTypes.STRING, allowNull: false },
    kind: enumString(["image", "audio"]),
    mimeType: { type: DataTypes.STRING, allowNull: false },
    sha256: { type: DataTypes.STRING, allowNull: false },
    sizeBytes: nonNegativeInteger(),
    width: { type: DataTypes.INTEGER, allowNull: true },
    height: { type: DataTypes.INTEGER, allowNull: true },
    durationMs: { type: DataTypes.INTEGER, allowNull: true },
    provenance: json({}),
  });

  const GenerationJob = defineLearningModel<
    GenerationJobAttributes,
    GenerationJobCreationAttributes
  >(sequelize, "GenerationJob", "generation_jobs", {
    ...identity(),
    resourceType: enumString(["lesson", "map"]),
    resourceId: { type: DataTypes.UUID, allowNull: false },
    revisionId: { type: DataTypes.UUID, allowNull: false },
    requestKey: { type: DataTypes.STRING, allowNull: false },
    state: enumString(
      [
        "queued",
        "running",
        "partial",
        "completed",
        "cancelled",
        "interrupted",
        "failed",
      ],
      "queued"
    ),
    metadata: json({}),
  });

  const GenerationStage = defineLearningModel<
    GenerationStageAttributes,
    GenerationStageCreationAttributes
  >(sequelize, "GenerationStage", "generation_stages", {
    ...identity(),
    jobId: { type: DataTypes.UUID, allowNull: false },
    key: { type: DataTypes.STRING, allowNull: false },
    kind: enumString(["text", "map", "image", "audio", "exercises"]),
    slotId: nullableUuid(),
    state: enumString([
      "queued",
      "running",
      "completed",
      "failed",
      "interrupted",
      "cancelling",
      "cancelled",
      "reconciling",
      "awaiting_retry",
    ], "queued"),
    activeAttemptId: nullableUuid(),
    expectedRevisionId: { type: DataTypes.UUID, allowNull: false },
    committedHash: { type: DataTypes.STRING, allowNull: true },
  });

  const StageAttempt = defineLearningModel<
    StageAttemptAttributes,
    StageAttemptCreationAttributes
  >(sequelize, "StageAttempt", "stage_attempts", {
    ...identity(),
    stageId: { type: DataTypes.UUID, allowNull: false },
    ordinal: positiveInteger(),
    state: enumString([
      "running",
      "completed",
      "failed",
      "interrupted",
      "cancelled",
    ], "running"),
    provider: { type: DataTypes.STRING, allowNull: false },
    providerSessionId: { type: DataTypes.STRING, allowNull: true },
    providerItemIds: json([]),
    errorCode: { type: DataTypes.STRING, allowNull: true },
    startedAt: { type: DataTypes.DATE, allowNull: false },
    finishedAt: { type: DataTypes.DATE, allowNull: true },
    metadata: json({}),
  });

  const PracticeAttempt = defineLearningModel<
    PracticeAttemptAttributes,
    PracticeAttemptCreationAttributes
  >(sequelize, "PracticeAttempt", "practice_attempts", {
    ...identity(),
    lessonRevisionId: { type: DataTypes.UUID, allowNull: false },
    questionId: { type: DataTypes.STRING, allowNull: false },
    targetIds: json([], false),
    kind: { type: DataTypes.STRING, allowNull: false },
    answer: json({}, false),
    result: json({}, false),
    recordingAssetId: nullableUuid(),
  });

  return {
    LearningLesson,
    LessonRevision,
    LearningMap,
    LearningMapRevision,
    LearningMapLayout,
    AssetSlot,
    GeneratedAsset,
    GenerationJob,
    GenerationStage,
    StageAttempt,
    PracticeAttempt,
  };
}
