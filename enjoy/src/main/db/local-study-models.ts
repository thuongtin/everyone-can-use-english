import {
  DataTypes,
  Model,
  type ModelAttributes,
  type ModelCtor,
  type Optional,
  type Sequelize,
} from "sequelize";

type Timestamps = { createdAt: Date; updatedAt: Date };
type StudyIdentity = Timestamps & { id: string; profileId: string };

export type LocalStoryAttributes = StudyIdentity & {
  sourceKey: string | null;
  title: string;
  content: string;
  url: string;
  html: string;
  metadata: Record<string, string>;
  extraction: unknown | null;
  extracted: boolean;
  starred: boolean;
  provenance: Record<string, unknown>;
};
type LocalStoryCreation = Optional<LocalStoryAttributes, "id" | "sourceKey" | "url" | "html" | "metadata" | "extraction" | "extracted" | "starred" | "provenance" | "createdAt" | "updatedAt">;

export type LocalMeaningAttributes = StudyIdentity & {
  lookupKey: string;
  word: string;
  lemma: string | null;
  pronunciation: string | null;
  pos: string | null;
  definition: string;
  translation: string;
  lookups: unknown[];
};
type LocalMeaningCreation = Optional<LocalMeaningAttributes, "id" | "lemma" | "pronunciation" | "pos" | "definition" | "translation" | "lookups" | "createdAt" | "updatedAt">;

export type LocalStoryMeaningAttributes = StudyIdentity & { storyId: string; meaningId: string };
type LocalStoryMeaningCreation = Optional<LocalStoryMeaningAttributes, "id" | "createdAt" | "updatedAt">;

export type LocalReviewAttributes = StudyIdentity & {
  meaningId: string;
  status: "new" | "learning" | "known";
  dueAt: Date | null;
};
type LocalReviewCreation = Optional<LocalReviewAttributes, "id" | "status" | "dueAt" | "createdAt" | "updatedAt">;

type StudyModel<A extends object, C extends object> = ModelCtor<Model<A, C> & A>;
export type LocalStudyModels = {
  Story: StudyModel<LocalStoryAttributes, LocalStoryCreation>;
  Meaning: StudyModel<LocalMeaningAttributes, LocalMeaningCreation>;
  StoryMeaning: StudyModel<LocalStoryMeaningAttributes, LocalStoryMeaningCreation>;
  Review: StudyModel<LocalReviewAttributes, LocalReviewCreation>;
};

const identity = () => ({
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false, defaultValue: DataTypes.UUIDV4 },
  profileId: { type: DataTypes.STRING, allowNull: false },
  createdAt: { type: DataTypes.DATE, allowNull: false },
  updatedAt: { type: DataTypes.DATE, allowNull: false },
});

const define = <A extends object, C extends object>(
  sequelize: Sequelize,
  modelName: string,
  tableName: string,
  attributes: ModelAttributes<Model<A, C>, A>,
): StudyModel<A, C> => sequelize.define<Model<A, C>, A>(modelName, attributes, {
  modelName,
  tableName,
  underscored: true,
  timestamps: true,
}) as unknown as StudyModel<A, C>;

export const createLocalStudyModels = (sequelize: Sequelize): LocalStudyModels => ({
  Story: define<LocalStoryAttributes, LocalStoryCreation>(sequelize, "LocalStory", "local_stories", {
    ...identity(),
    sourceKey: { type: DataTypes.STRING, allowNull: true },
    title: { type: DataTypes.STRING, allowNull: false },
    content: { type: DataTypes.TEXT, allowNull: false },
    url: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    html: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    metadata: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    extraction: { type: DataTypes.JSON, allowNull: true },
    extracted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    starred: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    provenance: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  }),
  Meaning: define<LocalMeaningAttributes, LocalMeaningCreation>(sequelize, "LocalMeaning", "local_meanings", {
    ...identity(),
    lookupKey: { type: DataTypes.STRING, allowNull: false },
    word: { type: DataTypes.STRING, allowNull: false },
    lemma: { type: DataTypes.STRING, allowNull: true },
    pronunciation: { type: DataTypes.STRING, allowNull: true },
    pos: { type: DataTypes.STRING, allowNull: true },
    definition: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    translation: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    lookups: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  }),
  StoryMeaning: define<LocalStoryMeaningAttributes, LocalStoryMeaningCreation>(sequelize, "LocalStoryMeaning", "local_story_meanings", {
    ...identity(),
    storyId: { type: DataTypes.STRING, allowNull: false },
    meaningId: { type: DataTypes.STRING, allowNull: false },
  }),
  Review: define<LocalReviewAttributes, LocalReviewCreation>(sequelize, "LocalReview", "local_reviews", {
    ...identity(),
    meaningId: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "new" },
    dueAt: { type: DataTypes.DATE, allowNull: true },
  }),
});
