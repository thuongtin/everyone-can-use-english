import { randomUUID } from "node:crypto";
import { Op, type Sequelize, type Transaction } from "sequelize";

import {
  ContentIdSchema,
  LessonBriefSchema,
  MapBriefSchema,
  ServiceResourceIdSchema,
  validateLessonDraft,
  validateMindmapGraph,
} from "../../lib/learning-schemas";
import { evaluateLessonDraft } from "../../lib/learning-validator";
import { canonicalPayloadHash } from "./candidate";
import type {
  LessonBrief,
  LessonDraft,
  MapBrief,
  MindmapGraph,
  MindmapStudyGroup,
} from "../../types/learning";
import type {
  AssetSlotAttributes,
  GeneratedAssetAttributes,
  LearningLessonAttributes,
  LearningMapAttributes,
  LearningMapLayoutAttributes,
  LearningMapRevisionAttributes,
  LearningModels,
  LessonRevisionAttributes,
  PracticeAttemptAttributes,
} from "../db/learning-models";
import type {
  LearningProfileContext,
  LearningProfileScope,
} from "./profile-scope";

const MAX_LAYOUT_POSITIONS = 40;
const MAX_JSON_BYTES = 64 * 1024;
const BUSY_JOB_STATES = new Set([
  "queued",
  "running",
  "partial",
  "interrupted",
  "awaiting_retry",
  "reconciling",
  "cancelling",
]);

type PropertyMap = Record<PropertyKey, unknown>;

type QueryOptions = {
  where?: PropertyMap;
  transaction?: Transaction;
  order?: unknown;
};

type DatabaseRow = PropertyMap & {
  toJSON(): PropertyMap;
  update(values: PropertyMap, options?: QueryOptions): Promise<DatabaseRow>;
};

type DatabaseModel = {
  create(values: PropertyMap, options?: QueryOptions): Promise<DatabaseRow>;
  findOne(options: QueryOptions): Promise<DatabaseRow | null>;
  findAll(options: QueryOptions): Promise<DatabaseRow[]>;
  destroy(options: QueryOptions): Promise<number>;
  count(options: QueryOptions): Promise<number>;
};

type ResourceModelName = keyof LearningModels;

export type LearningStorageErrorCode =
  | "learning_not_found"
  | "learning_revision_conflict"
  | "resource_busy"
  | "invalid_id"
  | "invalid_content"
  | "invalid_reference"
  | "invalid_layout";

export class LearningStorageError extends Error {
  readonly code: LearningStorageErrorCode;
  readonly details: unknown;

  constructor(
    code: LearningStorageErrorCode,
    message: string = code,
    details: unknown = undefined,
  ) {
    super(message);
    this.name = "LearningStorageError";
    this.code = code;
    this.details = details;
  }
}

export type LearningStorageOptions = Readonly<{
  sequelize: Sequelize;
  models: LearningModels;
  scope: LearningProfileScope;
  isAttemptTracked?: (attemptId: string) => boolean;
}>;

export type LessonBundle = Readonly<{
  lesson: LearningLessonAttributes;
  revisions: LessonRevisionAttributes[];
  slots: AssetSlotAttributes[];
  assets: GeneratedAssetAttributes[];
  practiceAttempts: PracticeAttemptAttributes[];
}>;

export type MapBundle = Readonly<{
  map: LearningMapAttributes;
  revisions: LearningMapRevisionAttributes[];
  layouts: LearningMapLayoutAttributes[];
  slots: AssetSlotAttributes[];
  assets: GeneratedAssetAttributes[];
}>;

export type MapPosition = Readonly<{
  id: string;
  x: number;
  y: number;
}>;

export type RemovedAssetPaths = Readonly<{
  removedAssetPaths: string[];
}>;

const sharedWriteTails = new WeakMap<Sequelize, Promise<void>>();

function makeError(
  code: LearningStorageErrorCode,
  message: string,
  details?: unknown,
): LearningStorageError {
  return new LearningStorageError(code, message, details);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJson(value: unknown, field: string): unknown {
  const seen = new Set<object>();
  const visit = (candidate: unknown): void => {
    if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") {
      return;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) {
        throw makeError("invalid_content", `${field} must contain finite JSON numbers`);
      }
      return;
    }
    if (typeof candidate !== "object") {
      throw makeError("invalid_content", `${field} must be JSON serializable`);
    }
    if (seen.has(candidate)) {
      throw makeError("invalid_content", `${field} must not contain cycles`);
    }
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
    } else if (isPlainObject(candidate)) {
      Object.values(candidate).forEach(visit);
    } else {
      throw makeError("invalid_content", `${field} must contain plain JSON values`);
    }
    seen.delete(candidate);
  };

  visit(value);
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw makeError("invalid_content", `${field} must be JSON serializable`);
  }
  if (encoded === undefined) {
    throw makeError("invalid_content", `${field} must be JSON serializable`);
  }
  if (Buffer.byteLength(encoded, "utf8") > MAX_JSON_BYTES) {
    throw makeError("invalid_content", `${field} exceeds the JSON size bound`);
  }
  return JSON.parse(encoded) as unknown;
}

function clonePlain<T>(row: DatabaseRow): T {
  return structuredClone(row.toJSON()) as T;
}

function clonePlainList<T>(rows: DatabaseRow[]): T[] {
  return rows.map((row) => clonePlain<T>(row));
}

function assertResourceId(value: unknown, field: string): string {
  const parsed = ServiceResourceIdSchema.safeParse(value);
  if (!parsed.success) {
    throw makeError("invalid_id", `${field} must be a service-owned UUID`);
  }
  return parsed.data;
}

function assertContentId(value: unknown, field: string): string {
  const parsed = ContentIdSchema.safeParse(value);
  if (!parsed.success) {
    throw makeError("invalid_reference", `${field} must be a safe content ID`);
  }
  return parsed.data;
}

function assertTitle(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw makeError("invalid_content", `${field} must be a non-empty title`);
  }
  const title = value.trim();
  if (title.length === 0 || title.length > 200) {
    throw makeError("invalid_content", `${field} must contain 1-200 characters`);
  }
  return title;
}

function assertBrief(value: unknown): LessonBrief {
  const result = LessonBriefSchema.safeParse(value);
  if (!result.success) {
    throw makeError("invalid_content", "brief does not satisfy the lesson contract", result.error.issues);
  }
  const ids = new Set<string>();
  for (const target of result.data.targets) {
    if (ids.has(target.id)) {
      throw makeError("invalid_content", `brief contains duplicate target ID: ${target.id}`);
    }
    ids.add(target.id);
  }
  return structuredClone(result.data);
}

function assertDraft(value: unknown, brief: LessonBrief): LessonDraft {
  const result = validateLessonDraft(value, brief);
  if (!result.ok) {
    throw makeError("invalid_content", "lesson draft does not satisfy the lesson contract", result.issues);
  }
  return structuredClone(result.data);
}

function assertGraph(value: unknown): MindmapGraph {
  const result = validateMindmapGraph(value);
  if (!result.ok) {
    throw makeError("invalid_content", "mindmap graph does not satisfy the graph contract", result.issues);
  }
  return structuredClone(result.data);
}

function assertMapBrief(value: unknown): MapBrief {
  const result = MapBriefSchema.safeParse(value);
  if (!result.success) {
    throw makeError("invalid_content", "brief does not satisfy the map contract", result.error.issues);
  }
  return structuredClone(result.data);
}

export function mapGroupAssetSource(
  graph: MindmapGraph,
  group: MindmapStudyGroup,
): { group: MindmapStudyGroup; nodes: MindmapGraph["nodes"] } {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  return {
    group: structuredClone(group),
    nodes: group.nodeIds.flatMap((nodeId) => {
      const node = nodesById.get(nodeId);
      return node ? [structuredClone(node)] : [];
    }),
  };
}

function assertPositions(value: unknown): MapPosition[] {
  if (!Array.isArray(value) || value.length > MAX_LAYOUT_POSITIONS) {
    throw makeError("invalid_layout", `positions must contain at most ${MAX_LAYOUT_POSITIONS} entries`);
  }
  const ids = new Set<string>();
  const positions: MapPosition[] = [];
  for (const [index, position] of value.entries()) {
    if (!isPlainObject(position)) {
      throw makeError("invalid_layout", `positions[${index}] must be an object`);
    }
    const id = assertContentId(position.id, `positions[${index}].id`);
    if (ids.has(id)) {
      throw makeError("invalid_layout", `positions contains duplicate node ID: ${id}`);
    }
    if (typeof position.x !== "number" || !Number.isFinite(position.x)) {
      throw makeError("invalid_layout", `positions[${index}].x must be finite`);
    }
    if (typeof position.y !== "number" || !Number.isFinite(position.y)) {
      throw makeError("invalid_layout", `positions[${index}].y must be finite`);
    }
    ids.add(id);
    positions.push({ id, x: position.x, y: position.y });
  }
  positions.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return positions;
}

function idsIn(rows: DatabaseRow[]): string[] {
  return rows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string");
}

export class LearningStorage {
  public readonly sequelize: Sequelize;
  public readonly models: LearningModels;
  public readonly scope: LearningProfileScope;

  constructor(options: LearningStorageOptions) {
    if (!options || !options.sequelize || !options.models || !options.scope) {
      throw new TypeError("sequelize, models, and scope are required");
    }
    this.sequelize = options.sequelize;
    this.models = Object.freeze(options.models);
    this.scope = options.scope;
    this.isAttemptTracked = options.isAttemptTracked ?? (() => false);
  }

  private readonly isAttemptTracked: (attemptId: string) => boolean;

  private model(name: ResourceModelName): DatabaseModel {
    return this.models[name] as unknown as DatabaseModel;
  }

  private where(context: LearningProfileContext, values: PropertyMap = {}): PropertyMap {
    return { ...values, profileId: context.profileId };
  }

  private async read<T>(operation: (context: LearningProfileContext) => Promise<T>): Promise<T> {
    return this.scope.run(async (context) => {
      this.scope.assertOpen(context);
      return operation(context);
    });
  }

  private async transaction<T>(
    operation: (context: LearningProfileContext, transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    return this.scope.run(async (context) => {
      const previous = sharedWriteTails.get(this.sequelize) ?? Promise.resolve();
      const current: Promise<T> = previous.catch((): undefined => undefined).then(async (): Promise<T> => {
        this.scope.assertOpen(context);
        const transaction = await this.sequelize.transaction();
        try {
          const result = await operation(context, transaction);
          await transaction.commit();
          return result;
        } catch (error) {
          await transaction.rollback().catch((): undefined => undefined);
          throw error;
        }
      });
      sharedWriteTails.set(this.sequelize, current.then((): undefined => undefined, (): undefined => undefined));
      return current;
    });
  }

  /** Runs a caller-owned write on this storage's fixed connection and profile scope. */
  public async write<T>(operation: (transaction: Transaction) => Promise<T>): Promise<T> {
    if (typeof operation !== "function") {
      throw new TypeError("write operation must be a function");
    }
    return this.transaction((_context, transaction) => operation(transaction));
  }

  public async createLesson(input: {
    brief: LessonBrief;
    title?: string;
  }): Promise<{
    lesson: LearningLessonAttributes;
    revision: LessonRevisionAttributes;
  }> {
    return this.transaction(async (context, transaction) => {
      const parsedBrief = assertBrief(input?.brief);
      const title = input?.title === undefined
        ? assertTitle(parsedBrief.topic?.trim() || parsedBrief.targets[0]?.term || "Untitled lesson", "title")
        : assertTitle(input.title, "title");
      const lessonId = randomUUID();
      const revisionId = randomUUID();
      const lesson = await this.model("LearningLesson").create({
        id: lessonId,
        profileId: context.profileId,
        title,
        activeRevisionId: revisionId,
      }, { transaction });
      const revision = await this.model("LessonRevision").create({
        id: revisionId,
        profileId: context.profileId,
        lessonId,
        number: 1,
        brief: parsedBrief,
        content: null,
        status: "draft",
        validation: [],
        provenance: {},
        sourceHash: null,
      }, { transaction });
      return {
        lesson: clonePlain<LearningLessonAttributes>(lesson),
        revision: clonePlain<LessonRevisionAttributes>(revision),
      };
    });
  }

  public async createMap(input: {
    title: string;
    lessonRevisionId?: string;
    level?: MapBrief["level"];
    illustrations?: boolean;
  }): Promise<{
    map: LearningMapAttributes;
    revision: LearningMapRevisionAttributes;
  }> {
    return this.transaction(async (context, transaction) => {
      const title = assertTitle(input?.title, "title");
      const lessonRevisionId = input?.lessonRevisionId === undefined
        ? null
        : assertResourceId(input.lessonRevisionId, "lessonRevisionId");
      let linkedLessonLevel: MapBrief["level"] | undefined;
      if (lessonRevisionId) {
        const lessonRevision = await this.model("LessonRevision").findOne({
          where: this.where(context, { id: lessonRevisionId }),
          transaction,
        });
        if (!lessonRevision) {
          throw makeError("learning_not_found", "lesson revision was not found");
        }
        const lessonBrief = LessonBriefSchema.safeParse(lessonRevision.brief);
        if (lessonBrief.success) linkedLessonLevel = lessonBrief.data.level;
      }
      const brief = assertMapBrief({
        level: input?.level ?? linkedLessonLevel ?? "A2",
        illustrations: input?.illustrations ?? false,
      });
      const mapId = randomUUID();
      const revisionId = randomUUID();
      const map = await this.model("LearningMap").create({
        id: mapId,
        profileId: context.profileId,
        title,
        lessonRevisionId,
        activeRevisionId: revisionId,
      }, { transaction });
      const revision = await this.model("LearningMapRevision").create({
        id: revisionId,
        profileId: context.profileId,
        mapId,
        number: 1,
        brief,
        content: null,
        status: "draft",
        provenance: {},
      }, { transaction });
      return {
        map: clonePlain<LearningMapAttributes>(map),
        revision: clonePlain<LearningMapRevisionAttributes>(revision),
      };
    });
  }

  public async getLesson(id: string): Promise<LessonBundle> {
    return this.transaction(async (context, transaction) => {
      const lessonId = assertResourceId(id, "lessonId");
      const lesson = await this.model("LearningLesson").findOne({
        where: this.where(context, { id: lessonId }),
        transaction,
      });
      if (!lesson) throw makeError("learning_not_found", "lesson was not found");
      const revisions = await this.model("LessonRevision").findAll({
        where: this.where(context, { lessonId }),
        order: [["number", "ASC"]],
        transaction,
      });
      const revisionIds = idsIn(revisions);
      const slots = revisionIds.length === 0 ? [] : await this.model("AssetSlot").findAll({
        where: this.where(context, { lessonRevisionId: { [Op.in]: revisionIds } }),
        order: [["createdAt", "ASC"]],
        transaction,
      });
      const slotIds = idsIn(slots);
      const assets = slotIds.length === 0 ? [] : await this.model("GeneratedAsset").findAll({
        where: this.where(context, { slotId: { [Op.in]: slotIds } }),
        order: [["createdAt", "ASC"]],
        transaction,
      });
      const practiceAttempts = revisionIds.length === 0 ? [] : await this.model("PracticeAttempt").findAll({
        where: this.where(context, { lessonRevisionId: { [Op.in]: revisionIds } }),
        order: [["createdAt", "ASC"]],
        transaction,
      });
      return {
        lesson: clonePlain<LearningLessonAttributes>(lesson),
        revisions: clonePlainList<LessonRevisionAttributes>(revisions),
        slots: clonePlainList<AssetSlotAttributes>(slots),
        assets: clonePlainList<GeneratedAssetAttributes>(assets),
        practiceAttempts: clonePlainList<PracticeAttemptAttributes>(practiceAttempts),
      };
    });
  }

  public async getMap(id: string): Promise<MapBundle> {
    return this.transaction(async (context, transaction) => {
      const mapId = assertResourceId(id, "mapId");
      const map = await this.model("LearningMap").findOne({
        where: this.where(context, { id: mapId }),
        transaction,
      });
      if (!map) throw makeError("learning_not_found", "map was not found");
      const revisions = await this.model("LearningMapRevision").findAll({
        where: this.where(context, { mapId }),
        order: [["number", "ASC"]],
        transaction,
      });
      const revisionIds = idsIn(revisions);
      const layouts = revisionIds.length === 0 ? [] : await this.model("LearningMapLayout").findAll({
        where: this.where(context, { mapRevisionId: { [Op.in]: revisionIds } }),
        order: [["createdAt", "ASC"]],
        transaction,
      });
      const slots = revisionIds.length === 0 ? [] : await this.model("AssetSlot").findAll({
        where: this.where(context, { mapRevisionId: { [Op.in]: revisionIds } }),
        order: [["createdAt", "ASC"]],
        transaction,
      });
      const slotIds = idsIn(slots);
      const assets = slotIds.length === 0 ? [] : await this.model("GeneratedAsset").findAll({
        where: this.where(context, { slotId: { [Op.in]: slotIds } }),
        order: [["createdAt", "ASC"]],
        transaction,
      });
      return {
        map: clonePlain<LearningMapAttributes>(map),
        revisions: clonePlainList<LearningMapRevisionAttributes>(revisions),
        layouts: clonePlainList<LearningMapLayoutAttributes>(layouts),
        slots: clonePlainList<AssetSlotAttributes>(slots),
        assets: clonePlainList<GeneratedAssetAttributes>(assets),
      };
    });
  }

  public async listLessons(): Promise<LearningLessonAttributes[]> {
    return this.read(async (context) => clonePlainList<LearningLessonAttributes>(
      await this.model("LearningLesson").findAll({
        where: this.where(context),
        order: [["createdAt", "ASC"]],
      }),
    ));
  }

  public async listMaps(): Promise<LearningMapAttributes[]> {
    return this.read(async (context) => clonePlainList<LearningMapAttributes>(
      await this.model("LearningMap").findAll({
        where: this.where(context),
        order: [["createdAt", "ASC"]],
      }),
    ));
  }

  public async reviseLesson(input: {
    lessonId: string;
    expectedRevisionId: string;
    brief: LessonBrief;
    content: LessonDraft;
  }): Promise<{
    lesson: LearningLessonAttributes;
    revision: LessonRevisionAttributes;
  }> {
    return this.transaction(async (context, transaction) => {
      const lessonId = assertResourceId(input?.lessonId, "lessonId");
      const expectedRevisionId = assertResourceId(input?.expectedRevisionId, "expectedRevisionId");
      const parsedBrief = assertBrief(input?.brief);
      const parsedContent = assertDraft(input?.content, parsedBrief);
      const evaluation = evaluateLessonDraft(parsedContent, parsedBrief);
      if (!evaluation.ok) {
        throw makeError(
          "invalid_content",
          "lesson draft does not pass the ready lesson validator",
          evaluation.issues,
        );
      }
      const lesson = await this.model("LearningLesson").findOne({
        where: this.where(context, { id: lessonId }),
        transaction,
      });
      if (!lesson) throw makeError("learning_not_found", "lesson was not found");
      const revisions = await this.model("LessonRevision").findAll({
        where: this.where(context, { lessonId }),
        order: [["number", "DESC"]],
        transaction,
      });
      const currentRevisionId = typeof lesson.activeRevisionId === "string"
        ? lesson.activeRevisionId
        : revisions[0]?.id;
      if (!currentRevisionId || currentRevisionId !== expectedRevisionId) {
        throw makeError("learning_revision_conflict", "lesson revision is stale");
      }
      const revisionId = randomUUID();
      const revision = await this.model("LessonRevision").create({
        id: revisionId,
        profileId: context.profileId,
        lessonId,
        number: Number(revisions[0]?.number ?? 0) + 1,
        brief: parsedBrief,
        content: parsedContent,
        status: "ready",
        validation: evaluation.warnings,
        provenance: { source: "user_edit" },
        sourceHash: canonicalPayloadHash(parsedContent),
      }, { transaction });
      const updatedLesson = await lesson.update({
        activeRevisionId: revisionId,
        title: parsedContent.title,
      }, { transaction });
      await this.createLessonAssetSlots(
        context.profileId,
        revisionId,
        parsedBrief,
        parsedContent,
        transaction,
      );
      return {
        lesson: clonePlain<LearningLessonAttributes>(updatedLesson),
        revision: clonePlain<LessonRevisionAttributes>(revision),
      };
    });
  }

  private async createLessonAssetSlots(
    profileId: string,
    revisionId: string,
    brief: LessonBrief,
    content: LessonDraft,
    transaction: Transaction,
  ): Promise<void> {
    const sources = [
      ...content.scenes.map((scene) => ({ sourceType: "scene" as const, kind: "image" as const, source: scene })),
      ...(brief.audio ? content.sections.map((section) => ({ sourceType: "section" as const, kind: "audio" as const, source: section })) : []),
    ];
    for (const { sourceType, kind, source } of sources) {
      await this.model("AssetSlot").create({
        id: randomUUID(),
        profileId,
        lessonRevisionId: revisionId,
        mapRevisionId: null,
        sourceType,
        sourceId: source.id,
        kind,
        sourceHash: canonicalPayloadHash(source),
        slotKey: `${revisionId}:${kind}:${source.id}`,
      }, { transaction });
    }
  }

  public async reviseMap(input: {
    mapId: string;
    expectedRevisionId: string;
    content: MindmapGraph;
  }): Promise<{
    map: LearningMapAttributes;
    revision: LearningMapRevisionAttributes;
  }> {
    return this.transaction(async (context, transaction) => {
      const mapId = assertResourceId(input?.mapId, "mapId");
      const expectedRevisionId = assertResourceId(input?.expectedRevisionId, "expectedRevisionId");
      const parsedContent = assertGraph(input?.content);
      const map = await this.model("LearningMap").findOne({
        where: this.where(context, { id: mapId }),
        transaction,
      });
      if (!map) throw makeError("learning_not_found", "map was not found");
      const revisions = await this.model("LearningMapRevision").findAll({
        where: this.where(context, { mapId }),
        order: [["number", "DESC"]],
        transaction,
      });
      const currentRevisionId = typeof map.activeRevisionId === "string"
        ? map.activeRevisionId
        : revisions[0]?.id;
      if (!currentRevisionId || currentRevisionId !== expectedRevisionId) {
        throw makeError("learning_revision_conflict", "map revision is stale");
      }
      const currentRevision = revisions.find((candidate) => candidate.id === currentRevisionId);
      if (!currentRevision) {
        throw makeError("learning_not_found", "active map revision was not found");
      }
      const brief = assertMapBrief(currentRevision.brief);
      const revisionId = randomUUID();
      const revision = await this.model("LearningMapRevision").create({
        id: revisionId,
        profileId: context.profileId,
        mapId,
        number: Number(revisions[0]?.number ?? 0) + 1,
        brief,
        content: parsedContent,
        status: "ready",
        provenance: {},
      }, { transaction });
      const updatedMap = await map.update({ activeRevisionId: revisionId }, { transaction });
      await this.createMapAssetSlots(
        context.profileId,
        revisionId,
        brief,
        parsedContent,
        transaction,
      );
      return {
        map: clonePlain<LearningMapAttributes>(updatedMap),
        revision: clonePlain<LearningMapRevisionAttributes>(revision),
      };
    });
  }

  private async createMapAssetSlots(
    profileId: string,
    revisionId: string,
    brief: MapBrief,
    content: MindmapGraph,
    transaction: Transaction,
  ): Promise<void> {
    if (!brief.illustrations) return;
    for (const group of content.studyGroups ?? []) {
      if (!group.illustration) continue;
      const source = mapGroupAssetSource(content, group);
      await this.model("AssetSlot").create({
        id: randomUUID(),
        profileId,
        lessonRevisionId: null,
        mapRevisionId: revisionId,
        sourceType: "group",
        sourceId: group.id,
        kind: "image",
        sourceHash: canonicalPayloadHash(source),
        slotKey: `${revisionId}:image:${group.id}`,
      }, { transaction });
    }
  }

  public async saveMapLayout(input: {
    mapRevisionId: string;
    positions: Array<{ id: string; x: number; y: number }>;
  }): Promise<LearningMapLayoutAttributes> {
    return this.transaction(async (context, transaction) => {
      const mapRevisionId = assertResourceId(input?.mapRevisionId, "mapRevisionId");
      const positions = assertPositions(input?.positions);
      const revision = await this.model("LearningMapRevision").findOne({
        where: this.where(context, { id: mapRevisionId }),
        transaction,
      });
      if (!revision) throw makeError("learning_not_found", "map revision was not found");
      const parsedContent = assertGraph(revision.content);
      const knownNodeIds = new Set(parsedContent.nodes.map((node) => node.id));
      for (const position of positions) {
        if (!knownNodeIds.has(position.id)) {
          throw makeError("invalid_reference", `layout references unknown node: ${position.id}`);
        }
      }
      const layoutModel = this.model("LearningMapLayout");
      const existing = await layoutModel.findOne({
        where: this.where(context, { mapRevisionId }),
        transaction,
      });
      const layout = existing
        ? await existing.update({ positions }, { transaction })
        : await layoutModel.create({
          id: randomUUID(),
          profileId: context.profileId,
          mapRevisionId,
          positions,
        }, { transaction });
      return clonePlain<LearningMapLayoutAttributes>(layout);
    });
  }

  public async selectAsset(input: {
    slotId: string;
    assetId: string;
  }): Promise<AssetSlotAttributes> {
    return this.transaction(async (context, transaction) => {
      const slotId = assertResourceId(input?.slotId, "slotId");
      const assetId = assertResourceId(input?.assetId, "assetId");
      const slot = await this.model("AssetSlot").findOne({
        where: this.where(context, { id: slotId }),
        transaction,
      });
      if (!slot) throw makeError("learning_not_found", "asset slot was not found");
      const asset = await this.model("GeneratedAsset").findOne({
        where: this.where(context, { id: assetId }),
        transaction,
      });
      if (!asset || asset.slotId !== slotId || asset.kind !== slot.kind) {
        throw makeError("invalid_reference", "asset does not belong to the selected slot");
      }
      const lessonRevisionId = typeof slot.lessonRevisionId === "string" ? slot.lessonRevisionId : null;
      const mapRevisionId = typeof slot.mapRevisionId === "string" ? slot.mapRevisionId : null;
      if ((lessonRevisionId ? 1 : 0) + (mapRevisionId ? 1 : 0) !== 1) {
        throw makeError("invalid_reference", "asset slot must belong to exactly one revision");
      }
      const revisionModel = lessonRevisionId ? this.model("LessonRevision") : this.model("LearningMapRevision");
      const revisionId = lessonRevisionId ?? mapRevisionId;
      const revision = await revisionModel.findOne({
        where: this.where(context, { id: revisionId }),
        transaction,
      });
      if (!revision) throw makeError("invalid_reference", "asset slot revision was not found");
      const updatedSlot = await slot.update({ selectedAssetId: assetId }, { transaction });
      return clonePlain<AssetSlotAttributes>(updatedSlot);
    });
  }

  public async recordPractice(input: {
    lessonRevisionId: string;
    questionId: string;
    answer: unknown;
    result: unknown;
    recordingAssetId?: string;
  }): Promise<PracticeAttemptAttributes> {
    return this.transaction(async (context, transaction) => {
      const lessonRevisionId = assertResourceId(input?.lessonRevisionId, "lessonRevisionId");
      const questionId = assertContentId(input?.questionId, "questionId");
      const answer = cloneJson(input?.answer, "answer");
      const result = cloneJson(input?.result, "result");
      const recordingAssetId = input?.recordingAssetId === undefined
        ? null
        : assertResourceId(input.recordingAssetId, "recordingAssetId");
      const revision = await this.model("LessonRevision").findOne({
        where: this.where(context, { id: lessonRevisionId }),
        transaction,
      });
      if (!revision) throw makeError("learning_not_found", "lesson revision was not found");
      if (revision.status !== "ready" || revision.content === null || revision.content === undefined) {
        throw makeError("invalid_reference", "practice requires a ready lesson revision");
      }
      const parsedContent = assertDraft(revision.content, revision.brief);
      const exercise = parsedContent.exercises.find((candidate) => candidate.id === questionId);
      if (!exercise) throw makeError("invalid_reference", `unknown exercise question: ${questionId}`);
      if (recordingAssetId) {
        const asset = await this.model("GeneratedAsset").findOne({
          where: this.where(context, { id: recordingAssetId }),
          transaction,
        });
        if (!asset || asset.kind !== "audio") {
          throw makeError("invalid_reference", "recording asset was not found");
        }
        const slot = await this.model("AssetSlot").findOne({
          where: this.where(context, { id: asset.slotId }),
          transaction,
        });
        if (
          !slot
          || slot.kind !== "audio"
          || slot.lessonRevisionId !== lessonRevisionId
          || typeof slot.mapRevisionId === "string"
          || slot.sourceType !== "practice"
          || slot.sourceId !== questionId
        ) {
          throw makeError("invalid_reference", "recording asset does not belong to the exact lesson revision");
        }
      }
      const attempt = await this.model("PracticeAttempt").create({
        id: randomUUID(),
        profileId: context.profileId,
        lessonRevisionId,
        questionId,
        targetIds: structuredClone(exercise.targetIds),
        kind: exercise.kind,
        answer,
        result,
        recordingAssetId,
      }, { transaction });
      return clonePlain<PracticeAttemptAttributes>(attempt);
    });
  }

  private async jobsForResource(
    context: LearningProfileContext,
    resourceType: "lesson" | "map",
    resourceId: string,
    revisionIds: string[],
    transaction: Transaction,
  ): Promise<DatabaseRow[]> {
    const resourceMatch: PropertyMap = { resourceType, resourceId };
    const where = revisionIds.length > 0
      ? { [Op.or]: [resourceMatch, { revisionId: { [Op.in]: revisionIds } }] }
      : resourceMatch;
    return this.model("GenerationJob").findAll({
      where: this.where(context, where),
      transaction,
    });
  }

  private async deleteJobs(
    context: LearningProfileContext,
    resourceType: "lesson" | "map",
    resourceId: string,
    revisionIds: string[],
    transaction: Transaction,
  ): Promise<void> {
    const jobs = await this.jobsForResource(context, resourceType, resourceId, revisionIds, transaction);
    const active = jobs.find((job) => BUSY_JOB_STATES.has(String(job.state)));
    if (active) {
      throw makeError("resource_busy", `${resourceType} has an active generation job`);
    }
    const jobIds = idsIn(jobs);
    if (jobIds.length === 0) return;
    const stages = await this.model("GenerationStage").findAll({
      where: this.where(context, { jobId: { [Op.in]: jobIds } }),
      transaction,
    });
    if (stages.some((stage) => BUSY_JOB_STATES.has(String(stage.state)))) {
      throw makeError("resource_busy", `${resourceType} has an active generation stage`);
    }
    const stageIds = idsIn(stages);
    if (stageIds.length > 0) {
      const attempts = await this.model("StageAttempt").findAll({
        where: this.where(context, { stageId: { [Op.in]: stageIds } }),
        transaction,
      });
      if (attempts.some(attempt => this.isAttemptTracked(String(attempt.id)))) {
        throw makeError("resource_busy", `${resourceType} has provider cleanup in progress`);
      }
      await this.model("StageAttempt").destroy({
        where: this.where(context, { stageId: { [Op.in]: stageIds } }),
        transaction,
      });
      await this.model("GenerationStage").destroy({
        where: this.where(context, { id: { [Op.in]: stageIds } }),
        transaction,
      });
    }
    await this.model("GenerationJob").destroy({
      where: this.where(context, { id: { [Op.in]: jobIds } }),
      transaction,
    });
  }

  private async deleteSlotsAndAssets(
    context: LearningProfileContext,
    slots: DatabaseRow[],
    deletedRevisionIds: string[],
    transaction: Transaction,
  ): Promise<string[]> {
    const slotIds = idsIn(slots);
    if (slotIds.length === 0) return [];
    const assets = await this.model("GeneratedAsset").findAll({
      where: this.where(context, { slotId: { [Op.in]: slotIds } }),
      transaction,
    });
    const assetIds = idsIn(assets);
    if (assetIds.length > 0) {
      const externalSelections = await this.model("AssetSlot").findAll({
        where: this.where(context, {
          id: { [Op.notIn]: slotIds },
          selectedAssetId: { [Op.in]: assetIds },
        }),
        transaction,
      });
      if (externalSelections.length > 0) {
        throw makeError(
          "invalid_reference",
          "cannot delete an asset selected by another resource",
        );
      }
      const externalPracticeWhere: PropertyMap = {
        recordingAssetId: { [Op.in]: assetIds },
      };
      if (deletedRevisionIds.length > 0) {
        externalPracticeWhere.lessonRevisionId = { [Op.notIn]: deletedRevisionIds };
      }
      const externalPractice = await this.model("PracticeAttempt").findAll({
        where: this.where(context, externalPracticeWhere),
        transaction,
      });
      if (externalPractice.length > 0) {
        throw makeError(
          "invalid_reference",
          "cannot delete an asset referenced by another practice attempt",
        );
      }
    }
    const removableSlotIds = slotIds;
    const removableAssetIds = assets
      .filter((asset) => typeof asset.slotId === "string")
      .map((asset) => asset.id)
      .filter((id): id is string => typeof id === "string");
    const removedAssetPaths = assets
      .filter((asset) => typeof asset.id === "string" && removableAssetIds.includes(asset.id))
      .map((asset) => asset.relativePath)
      .filter((relativePath): relativePath is string => typeof relativePath === "string");
    if (removableAssetIds.length > 0) {
      await this.model("GeneratedAsset").destroy({
        where: this.where(context, { id: { [Op.in]: removableAssetIds } }),
        transaction,
      });
    }
    if (removableSlotIds.length > 0) {
      await this.model("AssetSlot").destroy({
        where: this.where(context, { id: { [Op.in]: removableSlotIds } }),
        transaction,
      });
    }
    return removedAssetPaths;
  }

  public async deleteLesson(id: string): Promise<RemovedAssetPaths> {
    return this.transaction(async (context, transaction) => {
      const lessonId = assertResourceId(id, "lessonId");
      const lesson = await this.model("LearningLesson").findOne({
        where: this.where(context, { id: lessonId }),
        transaction,
      });
      if (!lesson) throw makeError("learning_not_found", "lesson was not found");
      const revisions = await this.model("LessonRevision").findAll({
        where: this.where(context, { lessonId }),
        order: [["number", "ASC"]],
        transaction,
      });
      const revisionIds = idsIn(revisions);
      await this.deleteJobs(context, "lesson", lessonId, revisionIds, transaction);
      const linkedMaps = revisionIds.length === 0 ? [] : await this.model("LearningMap").findAll({
        where: this.where(context, { lessonRevisionId: { [Op.in]: revisionIds } }),
        transaction,
      });
      const slots = revisionIds.length === 0 ? [] : await this.model("AssetSlot").findAll({
        where: this.where(context, { lessonRevisionId: { [Op.in]: revisionIds } }),
        transaction,
      });
      const removedAssetPaths = await this.deleteSlotsAndAssets(
        context,
        slots,
        revisionIds,
        transaction,
      );
      if (revisionIds.length > 0) {
        await this.model("PracticeAttempt").destroy({
          where: this.where(context, { lessonRevisionId: { [Op.in]: revisionIds } }),
          transaction,
        });
      }
      for (const map of linkedMaps) {
        await map.update({ lessonRevisionId: null }, { transaction });
      }
      if (revisionIds.length > 0) {
        await this.model("LessonRevision").destroy({
          where: this.where(context, { id: { [Op.in]: revisionIds } }),
          transaction,
        });
      }
      await this.model("LearningLesson").destroy({
        where: this.where(context, { id: lessonId }),
        transaction,
      });
      return { removedAssetPaths };
    });
  }

  public async deleteMap(id: string): Promise<RemovedAssetPaths> {
    return this.transaction(async (context, transaction) => {
      const mapId = assertResourceId(id, "mapId");
      const map = await this.model("LearningMap").findOne({
        where: this.where(context, { id: mapId }),
        transaction,
      });
      if (!map) throw makeError("learning_not_found", "map was not found");
      const revisions = await this.model("LearningMapRevision").findAll({
        where: this.where(context, { mapId }),
        order: [["number", "ASC"]],
        transaction,
      });
      const revisionIds = idsIn(revisions);
      await this.deleteJobs(context, "map", mapId, revisionIds, transaction);
      const slots = revisionIds.length === 0 ? [] : await this.model("AssetSlot").findAll({
        where: this.where(context, { mapRevisionId: { [Op.in]: revisionIds } }),
        transaction,
      });
      const removedAssetPaths = await this.deleteSlotsAndAssets(
        context,
        slots,
        [],
        transaction,
      );
      if (revisionIds.length > 0) {
        await this.model("LearningMapLayout").destroy({
          where: this.where(context, { mapRevisionId: { [Op.in]: revisionIds } }),
          transaction,
        });
        await this.model("LearningMapRevision").destroy({
          where: this.where(context, { id: { [Op.in]: revisionIds } }),
          transaction,
        });
      }
      await this.model("LearningMap").destroy({
        where: this.where(context, { id: mapId }),
        transaction,
      });
      return { removedAssetPaths };
    });
  }
}
