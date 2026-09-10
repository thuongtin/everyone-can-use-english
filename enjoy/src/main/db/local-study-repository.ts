import { createHash } from "node:crypto";
import { Op, type Sequelize, type Transaction, type WhereOptions } from "sequelize";
import type {
  LocalMeaning,
  LocalStory,
  LocalStoryCreateInput,
  LocalStoryUpdateInput,
  LocalStudyExtraction,
  LocalStudyLookup,
  LocalStudyPage,
  LocalStudyProvenance,
  LocalStudyReview,
  LocalStudyReviewStatus,
} from "../../types/local-study-api";
import type { LocalStudyModels } from "./local-study-models";
import { isRetiredEnjoyUrl } from "../../lib/network-policy";

const BLOCKED_RESOURCE_LABEL = "[Tài nguyên Enjoy chưa có bản local]";
const URL_PATTERN = /https?:\/\/[^\s"'<>()[\]]+/giu;
const REVIEW_STATUSES = new Set<LocalStudyReviewStatus>(["new", "learning", "known"]);
const SQLITE_BUSY_RETRIES = 5;

const isSqliteBusy = (error: unknown): boolean => {
  const candidate = error as {
    name?: string;
    code?: string;
    parent?: { code?: string };
    original?: { code?: string };
  };
  return candidate?.code === "SQLITE_BUSY"
    || candidate?.parent?.code === "SQLITE_BUSY"
    || candidate?.original?.code === "SQLITE_BUSY";
};

const withTransactionRetry = async <T>(
  sequelize: Sequelize,
  action: (transaction: Transaction) => Promise<T>,
): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await sequelize.transaction(action);
    } catch (error) {
      if (!isSqliteBusy(error) || attempt >= SQLITE_BUSY_RETRIES - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
    }
  }
};

export class LocalStudyError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "LocalStudyError";
  }
}

const blockedUrlsIn = (value: string): string[] =>
  (value.match(URL_PATTERN) || []).filter(isRetiredEnjoyUrl);

const sanitizeText = (value: string, replacement: string): string =>
  value.replace(URL_PATTERN, (candidate) => isRetiredEnjoyUrl(candidate) ? replacement : candidate);

const normalizeExtraction = (
  extraction: Partial<LocalStudyExtraction> | null | undefined,
): LocalStudyExtraction | null => {
  if (!extraction) return null;
  const normalize = (values: unknown): string[] => Array.isArray(values)
    ? [...new Set(values.map((value) => String(value).trim()).filter(Boolean))]
    : [];
  return { words: normalize(extraction.words), idioms: normalize(extraction.idioms) };
};

const normalizeSourceKey = (value: string): string | null => {
  if (!value.trim()) return null;
  try {
    const url = new URL(value.trim());
    url.hash = "";
    if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
      url.port = "";
    }
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString();
  } catch {
    return value.trim();
  }
};

const pageParams = (params?: { page?: number; items?: number }) => ({
  page: Math.max(1, Math.trunc(params?.page || 1)),
  items: Math.min(100, Math.max(1, Math.trunc(params?.items || 20))),
});

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const makePage = <T extends object>(
  payload: T,
  count: number,
  page: number,
  items: number,
): LocalStudyPage<T> => {
  const last = Math.max(1, Math.ceil(count / items));
  return { ...payload, page, next: page < last ? page + 1 : null, last };
};

const sanitizeStory = (
  input: LocalStoryCreateInput | LocalStoryUpdateInput,
  current?: LocalStory,
) => {
  const url = String(input.url ?? current?.url ?? "").trim();
  const retiredSource = Boolean(url && isRetiredEnjoyUrl(url));
  const content = String(input.content ?? current?.content ?? "");
  const html = String(input.html ?? current?.html ?? "");
  const metadata = { ...(current?.metadata || {}), ...(input.metadata || {}) };
  const blockedResourceUrls = [
    ...(retiredSource ? [url] : []),
    ...blockedUrlsIn(content),
    ...blockedUrlsIn(html),
    ...Object.values(metadata).flatMap((value) => blockedUrlsIn(String(value))),
    ...(current?.provenance.blockedResourceUrls || []),
    ...(input.provenance?.blockedResourceUrls || []),
  ];
  for (const [key, value] of Object.entries(metadata)) {
    if (blockedUrlsIn(String(value)).length) delete metadata[key];
  }
  const source = input.provenance?.source || current?.provenance.source || (url.startsWith("file:") ? "file" : "website");
  const provenance: LocalStudyProvenance = {
    ...(current?.provenance || {}),
    ...(input.provenance || {}),
    source,
    ...(retiredSource && !input.provenance?.sourceUrl && !current?.provenance.sourceUrl
      ? { sourceUrl: url }
      : {}),
    ...(blockedResourceUrls.length
      ? {
          blockedResourceUrls: [...new Set(blockedResourceUrls)].sort(),
          rawSnapshot: current?.provenance.rawSnapshot || {
            content,
            html,
            metadata: { ...(input.metadata || current?.metadata || {}) },
          },
        }
      : {}),
  };
  return {
    title: String(input.title ?? current?.title ?? "").trim(),
    content: sanitizeText(content, BLOCKED_RESOURCE_LABEL),
    url: retiredSource ? "" : url,
    html: sanitizeText(html, ""),
    metadata,
    extraction: input.extraction === undefined
      ? current?.extraction || null
      : normalizeExtraction(input.extraction),
    extracted: input.extracted ?? current?.extracted ?? false,
    starred: input.starred ?? current?.starred ?? false,
    provenance,
    sourceKey: normalizeSourceKey(url),
  };
};

export class LocalStudyRepository {
  constructor(private readonly options: {
    sequelize: Sequelize;
    models: LocalStudyModels;
    profileId: string;
  }) {
    if (!options.profileId) throw new LocalStudyError("profile_required", "A local profile is required");
  }

  private get profileId() {
    return this.options.profileId;
  }

  private toStory(record: any): LocalStory {
    const value = record.get({ plain: true });
    return {
      id: value.id,
      url: value.url || "",
      title: value.title,
      content: value.content,
      html: value.html || "",
      metadata: value.metadata || {},
      ...(value.extraction ? { extraction: normalizeExtraction(value.extraction) as LocalStudyExtraction } : {}),
      extracted: Boolean(value.extracted),
      starred: Boolean(value.starred),
      provenance: value.provenance || { source: "legacy" },
      createdAt: iso(value.createdAt),
      updatedAt: iso(value.updatedAt),
    };
  }

  private async requireStory(id: string, transaction?: Transaction) {
    const story = await this.options.models.Story.findOne({
      where: { id, profileId: this.profileId },
      transaction,
    });
    if (!story) throw new LocalStudyError("story_not_found", "Local story not found");
    return story;
  }

  async listStories(params: {
    page?: number;
    items?: number;
    query?: string;
    starred?: boolean;
  } = {}): Promise<LocalStudyPage<{ stories: LocalStory[] }>> {
    const { page, items } = pageParams(params);
    const where: WhereOptions = {
      profileId: this.profileId,
      ...(typeof params.starred === "boolean" ? { starred: params.starred } : {}),
      ...(params.query?.trim()
        ? { [Op.or]: [
            { title: { [Op.like]: `%${params.query.trim()}%` } },
            { content: { [Op.like]: `%${params.query.trim()}%` } },
          ] }
        : {}),
    };
    const { rows, count } = await this.options.models.Story.findAndCountAll({
      where,
      order: [["updatedAt", "DESC"], ["id", "ASC"]],
      limit: items,
      offset: (page - 1) * items,
    });
    return makePage({ stories: rows.map((story) => this.toStory(story)) }, count, page, items);
  }

  async getStory(id: string): Promise<LocalStory> {
    return this.toStory(await this.requireStory(id));
  }

  async createStory(input: LocalStoryCreateInput): Promise<LocalStory> {
    const sanitized = sanitizeStory(input);
    if (!sanitized.title || !sanitized.content) {
      throw new LocalStudyError("invalid_story", "A local story needs a title and content");
    }
    if (sanitized.sourceKey) {
      const existing = await this.options.models.Story.findOne({
        where: { profileId: this.profileId, sourceKey: sanitized.sourceKey },
      });
      if (existing) return this.toStory(existing);
    }
    const story = await this.options.models.Story.create({
      ...(input.id ? { id: input.id } : {}),
      profileId: this.profileId,
      ...sanitized,
    });
    return this.toStory(story);
  }

  async updateStory(id: string, input: LocalStoryUpdateInput): Promise<LocalStory> {
    const record = await this.requireStory(id);
    const sanitized = sanitizeStory(input, this.toStory(record));
    if (!sanitized.title || !sanitized.content) {
      throw new LocalStudyError("invalid_story", "A local story needs a title and content");
    }
    await record.update({
      ...sanitized,
      sourceKey: input.url === undefined ? record.get("sourceKey") : sanitized.sourceKey,
    });
    return this.toStory(record);
  }

  async setStoryStarred(id: string, starred: boolean): Promise<LocalStory> {
    const record = await this.requireStory(id);
    await record.update({ starred: Boolean(starred) });
    return this.toStory(record);
  }

  private validateLookup(lookup: LocalStudyLookup): void {
    if (!lookup?.word?.trim() || !lookup?.context?.trim() || !lookup.meaning || typeof lookup.meaning !== "object") {
      throw new LocalStudyError("invalid_meaning", "A lookup with a provider meaning is required");
    }
  }

  private lookupKey(lookup: LocalStudyLookup): string {
    return createHash("sha256")
      .update(`${lookup.word.trim().toLocaleLowerCase()}\n${lookup.context.trim()}`)
      .digest("hex");
  }

  private async upsertMeaningRecord(
    lookup: LocalStudyLookup,
    storyId: string | undefined,
    transaction: Transaction,
  ) {
    this.validateLookup(lookup);
    if (storyId) await this.requireStory(storyId, transaction);
    const lookupKey = this.lookupKey(lookup);
    const meaningInput = lookup.meaning!;
    const savedLookup: LocalStudyLookup = {
      ...(lookup.id ? { id: lookup.id } : {}),
      word: lookup.word,
      context: lookup.context,
      ...(lookup.contextTranslation
        ? { contextTranslation: lookup.contextTranslation }
        : {}),
      ...(lookup.status ? { status: lookup.status } : {}),
      ...(lookup.createdAt ? { createdAt: lookup.createdAt } : {}),
      ...(lookup.updatedAt ? { updatedAt: lookup.updatedAt } : {}),
    };
    const values = {
      profileId: this.profileId,
      lookupKey,
      word: String(meaningInput.word || lookup.word).trim(),
      lemma: meaningInput.lemma?.trim() || null,
      pronunciation: meaningInput.pronunciation?.trim() || null,
      pos: meaningInput.pos?.trim() || null,
      definition: meaningInput.definition?.trim() || "",
      translation: meaningInput.translation?.trim() || "",
      lookups: [savedLookup],
    };
    let meaning = await this.options.models.Meaning.findOne({
      where: { profileId: this.profileId, lookupKey },
      transaction,
    });
    if (meaning) {
      await meaning.update(values, { transaction });
    } else {
      meaning = await this.options.models.Meaning.create({
        ...(meaningInput.id ? { id: meaningInput.id } : {}),
        ...values,
      }, { transaction });
    }
    if (storyId) {
      await this.options.models.StoryMeaning.findOrCreate({
        where: { profileId: this.profileId, storyId, meaningId: meaning.id },
        defaults: { profileId: this.profileId, storyId, meaningId: meaning.id },
        transaction,
      });
    }
    return meaning;
  }

  private async toMeaning(record: any, transaction?: Transaction): Promise<LocalMeaning> {
    const value = record.get({ plain: true });
    const reviewRecord = await this.options.models.Review.findOne({
      where: { profileId: this.profileId, meaningId: value.id },
      transaction,
    });
    const reviewValue: any = reviewRecord?.get({ plain: true });
    return {
      id: value.id,
      word: value.word,
      ...(value.lemma ? { lemma: value.lemma } : {}),
      ...(value.pronunciation ? { pronunciation: value.pronunciation } : {}),
      ...(value.pos ? { pos: value.pos } : {}),
      definition: value.definition || "",
      translation: value.translation || "",
      lookups: value.lookups || [],
      review: reviewValue
        ? { status: reviewValue.status, dueAt: reviewValue.dueAt ? iso(reviewValue.dueAt) : null, updatedAt: iso(reviewValue.updatedAt) }
        : { status: "new", dueAt: null, updatedAt: iso(value.createdAt) },
      createdAt: iso(value.createdAt),
      updatedAt: iso(value.updatedAt),
    };
  }

  async upsertMeaning(input: { storyId?: string; lookup: LocalStudyLookup }): Promise<LocalMeaning> {
    return withTransactionRetry(this.options.sequelize, async (transaction) => {
      const meaning = await this.upsertMeaningRecord(input.lookup, input.storyId, transaction);
      return this.toMeaning(meaning, transaction);
    });
  }

  async replaceStoryMeanings(
    storyId: string,
    input: { extraction: LocalStudyExtraction; lookups: LocalStudyLookup[] },
  ): Promise<{ story: LocalStory; meanings: LocalMeaning[] }> {
    input.lookups.forEach((lookup) => this.validateLookup(lookup));
    return withTransactionRetry(this.options.sequelize, async (transaction) => {
      const story = await this.requireStory(storyId, transaction);
      const meaningRecords = [];
      for (const lookup of input.lookups) {
        meaningRecords.push(await this.upsertMeaningRecord(lookup, storyId, transaction));
      }
      const meaningIds = meaningRecords.map((meaning) => meaning.id);
      await this.options.models.StoryMeaning.destroy({
        where: {
          profileId: this.profileId,
          storyId,
          ...(meaningIds.length ? { meaningId: { [Op.notIn]: meaningIds } } : {}),
        },
        transaction,
      });
      await story.update({
        extraction: normalizeExtraction(input.extraction),
        extracted: true,
      }, { transaction });
      const meanings = [];
      for (const record of meaningRecords) meanings.push(await this.toMeaning(record, transaction));
      return { story: this.toStory(story), meanings };
    });
  }

  async listMeanings(params: {
    page?: number;
    items?: number;
    query?: string;
    storyId?: string;
    status?: LocalStudyReviewStatus;
    dueBefore?: string;
  } = {}): Promise<LocalStudyPage<{ meanings: LocalMeaning[] }>> {
    const { page, items } = pageParams(params);
    const filters: WhereOptions[] = [{ profileId: this.profileId }];
    if (params.query?.trim()) {
      filters.push({ [Op.or]: [
        { word: { [Op.like]: `%${params.query.trim()}%` } },
        { translation: { [Op.like]: `%${params.query.trim()}%` } },
        { definition: { [Op.like]: `%${params.query.trim()}%` } },
      ] });
    }
    if (params.storyId) {
      const relations = await this.options.models.StoryMeaning.findAll({
        where: { profileId: this.profileId, storyId: params.storyId },
        attributes: ["meaningId"],
      });
      const ids = relations.map((relation) => relation.meaningId);
      if (!ids.length) return makePage({ meanings: [] }, 0, page, items);
      filters.push({ id: { [Op.in]: ids } });
    }
    if (params.status || params.dueBefore) {
      const reviewWhere: WhereOptions = {
        profileId: this.profileId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.dueBefore ? { dueAt: { [Op.lte]: new Date(params.dueBefore) } } : {}),
      };
      const reviews = await this.options.models.Review.findAll({ where: reviewWhere, attributes: ["meaningId"] });
      const ids = reviews.map((review) => review.meaningId);
      if (!ids.length) return makePage({ meanings: [] }, 0, page, items);
      filters.push({ id: { [Op.in]: ids } });
    }
    const { rows, count } = await this.options.models.Meaning.findAndCountAll({
      where: { [Op.and]: filters },
      order: [["updatedAt", "DESC"], ["id", "ASC"]],
      limit: items,
      offset: (page - 1) * items,
    });
    const meanings = [];
    for (const row of rows) meanings.push(await this.toMeaning(row));
    return makePage({ meanings }, count, page, items);
  }

  async setReview(
    meaningId: string,
    input: { status: LocalStudyReviewStatus; dueAt: string | null },
  ): Promise<LocalStudyReview> {
    if (!REVIEW_STATUSES.has(input.status)) {
      throw new LocalStudyError("invalid_review", "Review status is invalid");
    }
    const meaning = await this.options.models.Meaning.findOne({
      where: { id: meaningId, profileId: this.profileId },
    });
    if (!meaning) throw new LocalStudyError("meaning_not_found", "Local meaning not found");
    const dueAt = input.dueAt ? new Date(input.dueAt) : null;
    if (dueAt && Number.isNaN(dueAt.valueOf())) {
      throw new LocalStudyError("invalid_review", "Review due date is invalid");
    }
    const [review] = await this.options.models.Review.findOrCreate({
      where: { profileId: this.profileId, meaningId },
      defaults: { profileId: this.profileId, meaningId, status: input.status, dueAt },
    });
    await review.update({ status: input.status, dueAt });
    return { status: review.status, dueAt: review.dueAt ? iso(review.dueAt) : null, updatedAt: iso(review.updatedAt) };
  }

  async destroyStory(id: string): Promise<void> {
    await withTransactionRetry(this.options.sequelize, async (transaction) => {
      const story = await this.requireStory(id, transaction);
      const relations = await this.options.models.StoryMeaning.findAll({
        where: { profileId: this.profileId, storyId: id },
        transaction,
      });
      await this.options.models.StoryMeaning.destroy({
        where: { profileId: this.profileId, storyId: id },
        transaction,
      });
      await story.destroy({ transaction });
      for (const relation of relations) {
        const remaining = await this.options.models.StoryMeaning.count({
          where: { profileId: this.profileId, meaningId: relation.meaningId },
          transaction,
        });
        if (remaining === 0) {
          await this.options.models.Review.destroy({
            where: { profileId: this.profileId, meaningId: relation.meaningId },
            transaction,
          });
          await this.options.models.Meaning.destroy({
            where: { profileId: this.profileId, id: relation.meaningId },
            transaction,
          });
        }
      }
    });
  }
}
