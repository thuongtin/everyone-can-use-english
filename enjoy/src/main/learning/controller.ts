import { randomUUID } from "node:crypto";
import type { Transaction } from "sequelize";
import { z } from "zod";

import {
  CefrLevelSchema,
  ContentIdSchema,
  ExerciseSchema,
  LessonBriefSchema,
  LessonDraftSchema,
  MindmapGraphSchema,
  ServiceResourceIdSchema,
  validateLessonDraft,
} from "../../lib/learning-schemas";
import { gradePractice, type PracticeGrade } from "../../lib/practice-grading";
import { canonicalPayloadHash } from "./candidate";
import { assertLearningContext } from "./ipc-guard";
import type { LearningAssetMetadata } from "./asset-store";
import type { LearningRuntime } from "./runtime";
import type { LearningContext, LearningOperationMap } from "../../types/learning-api";
import type { Exercise } from "../../types/learning";

const MAX_RECORDING_BYTES = 16 * 1024 * 1024;
type RecordingContainer = "audio/webm" | "audio/ogg" | "audio/wav";
const OGG_CODEC_TOKEN = "[a-z0-9][a-z0-9._-]{0,31}";
const OGG_CODECS_MIME_PATTERN = new RegExp(
  `^audio/ogg;codecs=${OGG_CODEC_TOKEN}(?:,${OGG_CODEC_TOKEN}){0,3}$`,
  "u",
);

function normalizeRecordingMimeType(value: unknown): RecordingContainer | null {
  if (typeof value !== "string") return null;
  if (value === "audio/wav") return "audio/wav";
  if (/^audio\/webm(?:;codecs=opus)?$/u.test(value)) return "audio/webm";
  if (value === "audio/ogg" || OGG_CODECS_MIME_PATTERN.test(value)) return "audio/ogg";
  return null;
}

const recordingMimeSchema = z.string()
  .refine((value) => normalizeRecordingMimeType(value) !== null, {
    message: "recording MIME must be audio/webm, audio/webm;codecs=opus, audio/ogg with bounded codecs, or audio/wav",
  })
  .transform((value) => normalizeRecordingMimeType(value)!);
const ACTIONS = new Set<keyof LearningOperationMap>([
  "generate",
  "retryGeneration",
  "generateAsset",
  "listJobs",
  "narrateMapNode",
  "list",
  "getLesson",
  "getMap",
  "createLesson",
  "createMap",
  "reviseLesson",
  "reviseMap",
  "saveMapLayout",
  "selectAsset",
  "deleteLesson",
  "deleteMap",
  "practice",
  "job",
  "cancelJob",
]);

const requestError = (details: unknown = undefined): never => {
  const error = new Error("learning_request_invalid");
  Object.assign(error, { code: "learning_request_invalid", details });
  throw error;
};

const operationError = (code: string, message = code, details: unknown = undefined): never => {
  const error = new Error(message);
  Object.assign(error, { code, details });
  throw error;
};

const titleSchema = z.string().max(200).refine((value) => value.trim().length > 0);
const idInputSchema = z.object({ id: ServiceResourceIdSchema }).strict();
const emptyInputSchema = z.object({}).strict();

const createLessonInputSchema = z.object({
  brief: LessonBriefSchema,
  title: titleSchema.optional(),
}).strict();

const createMapInputSchema = z.object({
  title: titleSchema,
  lessonRevisionId: ServiceResourceIdSchema.optional(),
  level: CefrLevelSchema.optional(),
  illustrations: z.boolean().optional(),
}).strict();

const reviseLessonInputSchema = z.object({
  lessonId: ServiceResourceIdSchema,
  expectedRevisionId: ServiceResourceIdSchema,
  brief: LessonBriefSchema,
  content: LessonDraftSchema,
}).strict();

const reviseMapInputSchema = z.object({
  mapId: ServiceResourceIdSchema,
  expectedRevisionId: ServiceResourceIdSchema,
  content: MindmapGraphSchema,
}).strict();

const mapPositionSchema = z.object({
  id: ContentIdSchema,
  x: z.number().finite(),
  y: z.number().finite(),
}).strict();

const saveMapLayoutInputSchema = z.object({
  mapRevisionId: ServiceResourceIdSchema,
  positions: z.array(mapPositionSchema).max(40),
}).strict();

const selectAssetInputSchema = z.object({
  slotId: ServiceResourceIdSchema,
  assetId: ServiceResourceIdSchema,
}).strict();

const recordingBytesSchema = z.custom<Uint8Array>(
  (value): value is Uint8Array => value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= MAX_RECORDING_BYTES,
  { message: `recording bytes must be a Uint8Array of at most ${MAX_RECORDING_BYTES} bytes` },
);

const recordingSchema = z.object({
  bytes: recordingBytesSchema,
  mimeType: recordingMimeSchema,
}).strict();

const practiceInputSchema = z.object({
  lessonRevisionId: ServiceResourceIdSchema,
  questionId: ContentIdSchema,
  answer: z.unknown(),
  recording: recordingSchema.optional(),
}).strict().superRefine((value, context) => {
  if (!Object.prototype.hasOwnProperty.call(value, "answer")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["answer"], message: "answer is required" });
  }
});

const schemas = {
  narrateMapNode: z.object({ mapId: ServiceResourceIdSchema, revisionId: ServiceResourceIdSchema, nodeId: ContentIdSchema, requestKey: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/) }).strict(),
  listJobs: z.object({ resourceType: z.enum(["lesson", "map"]), resourceId: ServiceResourceIdSchema }).strict(),
  retryGeneration: z.object({ jobId: ServiceResourceIdSchema, stageId: ServiceResourceIdSchema, provider: z.enum(["codex", "claude", "azure-openai"]), model: z.string().trim().min(1).max(200).optional() }).strict(),
  generateAsset: z.object({ resourceType: z.enum(["lesson", "map"]), resourceId: ServiceResourceIdSchema, revisionId: ServiceResourceIdSchema, slotId: ServiceResourceIdSchema, requestKey: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/) }).strict(),
  generate: z.object({
    provider: z.enum(["codex", "claude", "azure-openai"]), resourceType: z.enum(["lesson", "map"]),
    model: z.string().trim().min(1).max(200).optional(),
    resourceId: ServiceResourceIdSchema, revisionId: ServiceResourceIdSchema,
    requestKey: z.string().min(1).max(200),
  }).strict(),
  list: emptyInputSchema,
  getLesson: idInputSchema,
  getMap: idInputSchema,
  createLesson: createLessonInputSchema,
  createMap: createMapInputSchema,
  reviseLesson: reviseLessonInputSchema,
  reviseMap: reviseMapInputSchema,
  saveMapLayout: saveMapLayoutInputSchema,
  selectAsset: selectAssetInputSchema,
  deleteLesson: idInputSchema,
  deleteMap: idInputSchema,
  practice: practiceInputSchema,
  job: idInputSchema,
  cancelJob: idInputSchema,
} as const;

type Operation = keyof LearningOperationMap;
type ParsedPracticeInput = z.infer<typeof practiceInputSchema>;

function parseInput<K extends Operation>(action: K, input: unknown): LearningOperationMap[K]["input"] {
  if (!ACTIONS.has(action)) return requestError({ action });
  const result = schemas[action].safeParse(input);
  if (!result.success) return requestError(result.error.issues);
  return result.data as LearningOperationMap[K]["input"];
}

function plain<T>(row: { get(options?: { plain?: boolean }): unknown }): T {
  return row.get({ plain: true }) as T;
}

function gradeAnswer(exercise: Exercise, answer: unknown, hasRecording: boolean): PracticeGrade {
  if (hasRecording && exercise.kind === "retell" && typeof answer === "string" && answer.trim().length === 0) {
    return {
      kind: "retell",
      correct: null,
      normalizedAnswer: "",
      expectedAnswer: null,
      feedbackCode: "self_review",
      targetIds: [...exercise.targetIds],
    };
  }
  return gradePractice(exercise, answer);
}

function assertReadyLessonRevision(revision: {
  status: unknown;
  brief: unknown;
  content: unknown;
}): { content: z.infer<typeof LessonDraftSchema> } {
  if (revision.status !== "ready" || revision.content === null || revision.content === undefined) {
    return operationError("invalid_reference", "practice requires a ready lesson revision");
  }
  const brief = LessonBriefSchema.safeParse(revision.brief);
  const draft = LessonDraftSchema.safeParse(revision.content);
  const validation = brief.success && draft.success
    ? validateLessonDraft(draft.data, brief.data)
    : { ok: false as const, issues: [...(brief.success ? [] : brief.error.issues), ...(draft.success ? [] : draft.error.issues)] };
  if (!validation.ok) {
    return operationError("invalid_reference", "lesson revision content is invalid", validation.issues);
  }
  if (!draft.success) return operationError("invalid_reference", "lesson revision content is invalid");
  return { content: draft.data };
}

type RevisionRow = {
  id: string;
  profileId: string;
  status: unknown;
  brief: unknown;
  content: unknown;
};

type ModelRow = {
  id: string;
  profileId: string;
  [key: string]: unknown;
  get(options?: { plain?: boolean }): unknown;
  update(values: Record<string, unknown>, options?: { transaction?: Transaction }): Promise<ModelRow>;
};

/** Main-process boundary for the renderer's profile-scoped LearningBridge. */
export class LearningController {
  constructor(private readonly runtime: LearningRuntime) {
    if (!runtime?.scope || !runtime.storage || !runtime.assets || !runtime.application) {
      throw new TypeError("A complete learning runtime is required");
    }
  }

  async request<K extends keyof LearningOperationMap>(
    context: LearningContext,
    action: K,
    input: LearningOperationMap[K]["input"],
  ): Promise<LearningOperationMap[K]["output"]> {
    assertLearningContext(this.runtime.scope.context, context);
    return this.runtime.scope.run(async (scopeContext) => {
      this.runtime.scope.assertOpen(scopeContext);
      const parsed = parseInput(action, input);
      return this.dispatch(action, parsed) as Promise<LearningOperationMap[K]["output"]>;
    });
  }

  private async dispatch(action: Operation, input: unknown): Promise<unknown> {
    switch (action) {
      case "list":
        return {
          lessons: await this.runtime.storage.listLessons(),
          maps: await this.runtime.storage.listMaps(),
        };
      case "generate":
        return this.runtime.generation.generate(input as LearningOperationMap["generate"]["input"]);
      case "retryGeneration":
        return this.runtime.generation.retry(input as LearningOperationMap["retryGeneration"]["input"]);
      case "generateAsset":
        return this.runtime.generation.generateAsset(input as LearningOperationMap["generateAsset"]["input"]);
      case "narrateMapNode":
        return this.runtime.generation.narrateMapNode(input as LearningOperationMap["narrateMapNode"]["input"]);
      case "listJobs": {
        const query = input as LearningOperationMap["listJobs"]["input"];
        const rows = await this.runtime.storage.models.GenerationJob.findAll({ where: { ...query, profileId: this.runtime.scope.context.profileId }, order: [["createdAt", "DESC"]], limit: 20 });
        return rows.map((row) => row.get({ plain: true }));
      }
      case "getLesson":
        return this.runtime.storage.getLesson((input as { id: string }).id);
      case "getMap":
        return this.runtime.storage.getMap((input as { id: string }).id);
      case "createLesson":
        return this.runtime.storage.createLesson(input as Parameters<typeof this.runtime.storage.createLesson>[0]);
      case "createMap":
        return this.runtime.storage.createMap(input as Parameters<typeof this.runtime.storage.createMap>[0]);
      case "reviseLesson":
        return this.runtime.storage.reviseLesson(input as Parameters<typeof this.runtime.storage.reviseLesson>[0]);
      case "reviseMap":
        return this.runtime.storage.reviseMap(input as Parameters<typeof this.runtime.storage.reviseMap>[0]);
      case "saveMapLayout":
        return this.runtime.storage.saveMapLayout(input as Parameters<typeof this.runtime.storage.saveMapLayout>[0]);
      case "selectAsset":
        return this.runtime.storage.selectAsset(input as Parameters<typeof this.runtime.storage.selectAsset>[0]);
      case "deleteLesson":
        return this.deleteResource("lesson", (input as { id: string }).id);
      case "deleteMap":
        return this.deleteResource("map", (input as { id: string }).id);
      case "practice":
        return this.practice(input as ParsedPracticeInput);
      case "job":
        return this.runtime.application.jobs.get((input as { id: string }).id);
      case "cancelJob":
        return this.cancelJob((input as { id: string }).id);
      default:
        return requestError({ action });
    }
  }

  private async deleteResource(kind: "lesson" | "map", id: string): Promise<{ deleted: true }> {
    const removed = kind === "lesson"
      ? await this.runtime.storage.deleteLesson(id)
      : await this.runtime.storage.deleteMap(id);
    for (const relativePath of removed.removedAssetPaths) {
      try { await this.runtime.assets.remove(relativePath); }
      catch { operationError("learning_asset_cleanup_failed"); }
    }
    return { deleted: true };
  }

  private async cancelJob(id: string): Promise<{ cancelled: true }> {
    // Capture the owned attempts in the same transaction that cancels the job.
    const attempts = await this.runtime.application.jobs.cancel(id);
    const ownerConnectionId = this.runtime.scope.context.connectionId;
    for (const attempt of attempts) {
      const metadata = attempt.metadata;
      const owner = metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? (metadata as { ownerConnectionId?: unknown }).ownerConnectionId
        : undefined;
      if (owner === ownerConnectionId) {
        await this.runtime.cancelAttempt(attempt.id);
      }
    }
    return { cancelled: true };
  }

  private async practice(input: ParsedPracticeInput): Promise<LearningOperationMap["practice"]["output"]> {
    let imported: LearningAssetMetadata | undefined;
    try {
      return await this.runtime.storage.write(async (transaction) => {
        const context = this.runtime.scope.context;
        this.runtime.scope.assertOpen(context);
        const revision = await this.runtime.storage.models.LessonRevision.findOne({
          where: { id: input.lessonRevisionId, profileId: context.profileId },
          transaction,
        }) as unknown as RevisionRow | null;
        if (!revision) return operationError("learning_not_found", "lesson revision was not found");
        const ready = assertReadyLessonRevision(revision);
        const candidate = ready.content.exercises.find((exercise) => exercise.id === input.questionId);
        if (!candidate) return operationError("invalid_reference", `unknown exercise question: ${input.questionId}`);
        const exerciseResult = ExerciseSchema.safeParse(candidate);
        if (!exerciseResult.success) return operationError("invalid_exercise", "exercise does not satisfy ExerciseSchema", exerciseResult.error.issues);
        const exercise = exerciseResult.data;
        if (input.recording && exercise.kind !== "retell") {
          return operationError("invalid_audio", "recordings are accepted only for retell exercises");
        }
        const grade = gradeAnswer(exercise, input.answer, Boolean(input.recording));
        let recordingAssetId: string | null = null;
        if (input.recording) {
          this.runtime.scope.assertOpen(context);
          imported = await this.runtime.assets.importBytes({
            id: randomUUID(),
            kind: "audio",
            bytes: Buffer.from(input.recording.bytes),
          });
          this.runtime.scope.assertOpen(context);
          recordingAssetId = imported.id;
          const sourceHash = canonicalPayloadHash(exercise);
          const slotKey = `lesson-revision:${input.lessonRevisionId}:practice:${input.questionId}`;
          const existing = await this.runtime.storage.models.AssetSlot.findOne({
            where: { profileId: context.profileId, slotKey },
            transaction,
          }) as unknown as ModelRow | null;
          let slot: ModelRow;
          if (existing) {
            if (
              existing.lessonRevisionId !== input.lessonRevisionId ||
              existing.mapRevisionId !== null ||
              existing.sourceType !== "practice" ||
              existing.sourceId !== input.questionId ||
              existing.kind !== "audio"
            ) {
              return operationError("invalid_reference", "practice asset slot does not belong to this lesson revision");
            }
            slot = await existing.update({ sourceHash }, { transaction });
          } else {
            slot = await this.runtime.storage.models.AssetSlot.create({
              id: randomUUID(),
              profileId: context.profileId,
              lessonRevisionId: input.lessonRevisionId,
              mapRevisionId: null,
              sourceType: "practice",
              sourceId: input.questionId,
              kind: "audio",
              sourceHash,
              slotKey,
            }, { transaction }) as unknown as ModelRow;
          }
          await this.runtime.storage.models.GeneratedAsset.create({
            id: imported.id,
            profileId: context.profileId,
            slotId: slot.id,
            relativePath: imported.relativePath,
            kind: imported.kind,
            mimeType: imported.mimeType,
            sha256: imported.sha256,
            sizeBytes: imported.sizeBytes,
            width: imported.width,
            height: imported.height,
            durationMs: imported.durationMs,
            provenance: { source: "practice_recording" },
          }, { transaction });
        }
        this.runtime.scope.assertOpen(context);
        const attempt = await this.runtime.storage.models.PracticeAttempt.create({
          id: randomUUID(),
          profileId: context.profileId,
          lessonRevisionId: input.lessonRevisionId,
          questionId: input.questionId,
          targetIds: [...exercise.targetIds],
          kind: exercise.kind,
          answer: grade.normalizedAnswer,
          result: grade,
          recordingAssetId,
        }, { transaction });
        this.runtime.scope.assertOpen(context);
        return { attempt: plain(attempt), grade };
      });
    } catch (error) {
      if (imported) {
        try {
          await this.runtime.assets.remove(imported.relativePath);
        } catch (cleanupError) {
          return operationError("learning_asset_cleanup_failed", "imported practice asset cleanup failed", { cause: cleanupError, original: error });
        }
      }
      throw error;
    }
  }
}
