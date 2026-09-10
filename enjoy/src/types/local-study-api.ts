export type LocalStudyReviewStatus = "new" | "learning" | "known";

export type LocalStudyReview = {
  status: LocalStudyReviewStatus;
  dueAt: string | null;
  updatedAt: string;
};

export type LocalStudyLookup = {
  id?: string;
  word: string;
  context: string;
  contextTranslation?: string;
  status?: "pending" | "completed" | "failed";
  meaning?: {
    id?: string;
    word?: string;
    lemma?: string;
    pronunciation?: string;
    pos?: string;
    definition?: string;
    translation?: string;
  };
  createdAt?: string;
  updatedAt?: string;
};

export type LocalStudyExtraction = {
  words: string[];
  idioms: string[];
};

export type LocalStudyProvenance = {
  source: "file" | "website" | "import" | "legacy" | "manual";
  sourceId?: string;
  sourceUrl?: string;
  blockedResourceUrls?: string[];
  importedAt?: string;
  rawSnapshot?: {
    content: string;
    html: string;
    metadata: Record<string, string>;
  };
};

export type LocalStory = {
  id: string;
  url: string;
  title: string;
  content: string;
  html: string;
  metadata: Record<string, string>;
  extraction?: LocalStudyExtraction;
  extracted: boolean;
  starred: boolean;
  provenance: LocalStudyProvenance;
  createdAt: string;
  updatedAt: string;
};

export type LocalMeaning = {
  id: string;
  word: string;
  lemma?: string;
  pronunciation?: string;
  pos?: string;
  definition: string;
  translation: string;
  lookups: LocalStudyLookup[];
  review: LocalStudyReview;
  createdAt: string;
  updatedAt: string;
};

export type LocalStoryCreateInput = {
  id?: string;
  title: string;
  content: string;
  url?: string;
  html?: string;
  metadata?: Record<string, string>;
  extraction?: Partial<LocalStudyExtraction>;
  extracted?: boolean;
  starred?: boolean;
  provenance?: Partial<LocalStudyProvenance>;
};

export type LocalStoryUpdateInput = Partial<
  Omit<LocalStoryCreateInput, "id" | "provenance">
> & {
  provenance?: Partial<LocalStudyProvenance>;
};

export type LocalStudyPage<T> = {
  page: number;
  next: number | null;
  last: number;
} & T;

export type LocalStudyBridge = {
  stories: {
    list: (params?: {
      page?: number;
      items?: number;
      query?: string;
      starred?: boolean;
    }) => Promise<LocalStudyPage<{ stories: LocalStory[] }>>;
    get: (id: string) => Promise<LocalStory>;
    create: (input: LocalStoryCreateInput) => Promise<LocalStory>;
    update: (id: string, input: LocalStoryUpdateInput) => Promise<LocalStory>;
    destroy: (id: string) => Promise<void>;
    setStarred: (id: string, starred: boolean) => Promise<LocalStory>;
  };
  meanings: {
    list: (params?: {
      page?: number;
      items?: number;
      query?: string;
      storyId?: string;
      status?: LocalStudyReviewStatus;
      dueBefore?: string;
    }) => Promise<LocalStudyPage<{ meanings: LocalMeaning[] }>>;
    upsert: (input: {
      storyId?: string;
      lookup: LocalStudyLookup;
    }) => Promise<LocalMeaning>;
    replaceStory: (
      storyId: string,
      input: {
        extraction: LocalStudyExtraction;
        lookups: LocalStudyLookup[];
      },
    ) => Promise<{ story: LocalStory; meanings: LocalMeaning[] }>;
  };
  reviews: {
    set: (
      meaningId: string,
      input: { status: LocalStudyReviewStatus; dueAt: string | null },
    ) => Promise<LocalStudyReview>;
  };
};
