import { z } from "zod";

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export const LESSON_LENGTHS = ["short", "medium", "long"] as const;
export const GENERATION_KINDS = ["text", "map", "image", "audio", "exercises"] as const;
export const EXERCISE_KINDS = ["meaning", "fill", "order", "retell"] as const;
export const MINDMAP_EDGE_KINDS = [
  "category",
  "synonym",
  "antonym",
  "word-family",
  "collocation",
  "situation",
  "related-concept",
] as const;
export const EVIDENCE_STATUSES = ["dictionary", "user", "unverified"] as const;
export const GENERATION_STAGE_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "interrupted",
  "reconciling",
  "awaiting_retry",
  "cancelling",
  "cancelled",
] as const;
export const STAGE_ATTEMPT_STATUSES = [
  "running",
  "completed",
  "failed",
  "interrupted",
  "cancelled",
] as const;

export const GENERATION_STAGE_STATES = GENERATION_STAGE_STATUSES;
export const STAGE_ATTEMPT_STATES = STAGE_ATTEMPT_STATUSES;

export const MAX_LESSON_TARGETS = 12;
export const MAX_LESSON_SCENES = 4;
export const MAX_LESSON_WORDS = 1_200;
export const MAX_MINDMAP_NODES = 40;
export const MAX_MINDMAP_EDGES = 120;
export const MAX_MINDMAP_STUDY_GROUPS = 8;
export const MAX_ASSET_SIZE_BYTES = 64 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 16_384;
export const MAX_AUDIO_DURATION_MS = 2 * 60 * 60 * 1_000;

const CONTENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const PAYLOAD_HASH_PATTERN = /^[a-f0-9]{64}$/u;

export const CefrLevelSchema = z.enum(CEFR_LEVELS);
export const LessonLengthSchema = z.enum(LESSON_LENGTHS);
export const GenerationKindSchema = z.enum(GENERATION_KINDS);
export const ExerciseKindSchema = z.enum(EXERCISE_KINDS);
export const MindmapEdgeKindSchema = z.enum(MINDMAP_EDGE_KINDS);
export const EvidenceStatusSchema = z.enum(EVIDENCE_STATUSES);
export const GenerationStageStatusSchema = z.enum(GENERATION_STAGE_STATUSES);
export const StageAttemptStatusSchema = z.enum(STAGE_ATTEMPT_STATUSES);
export const GenerationStageStateSchema = GenerationStageStatusSchema;
export const StageAttemptStateSchema = StageAttemptStatusSchema;

export const ContentIdSchema = z.string().regex(CONTENT_ID_PATTERN, {
  message: "must be a bounded safe content ID",
});

export const ServiceResourceIdSchema = z.string().uuid({
  message: "must be a service-owned UUID",
});

export const EntityResourceIdSchema = ServiceResourceIdSchema;

export const PayloadHashSchema = z.string().regex(PAYLOAD_HASH_PATTERN, {
  message: "must be a lowercase SHA-256 hexadecimal hash",
});

const boundedText = (max: number) => z.string().max(max).refine(
  (value) => value.trim().length > 0,
  { message: "must not be empty" },
);

const lessonText = z.string().max(24_000).refine(
  (value) => value.trim().length > 0,
  { message: "must not be empty" },
).refine(
  (value) => countWords(value) <= MAX_LESSON_WORDS,
  { message: `must contain at most ${MAX_LESSON_WORDS} words` },
);

const keywordText = boundedText(80);

export const EvidenceSchema = z.object({
  status: EvidenceStatusSchema,
  source: boundedText(300).optional(),
}).strict();

export const LearningTargetSchema = z.object({
  id: ContentIdSchema,
  term: boundedText(80),
  sense: boundedText(500),
  definition: boundedText(600),
  translationVi: boundedText(600),
  example: boundedText(600),
  inflections: z.array(keywordText).max(12).optional(),
  evidence: EvidenceSchema.optional(),
}).strict();

export const RawBriefInputSchema = z.object({
  topic: z.string().max(500).optional(),
  keywords: z.array(keywordText).max(12),
  level: CefrLevelSchema,
  length: LessonLengthSchema,
  imageCount: z.number().int().min(0).max(MAX_LESSON_SCENES),
  audio: z.boolean(),
}).strict().superRefine((input, context) => {
  const hasTopic = typeof input.topic === "string" && input.topic.trim().length > 0;
  if (!hasTopic && input.keywords.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["topic"],
      message: "topic or at least one keyword is required",
    });
  }
});

export const LessonBriefSchema = z.object({
  topic: z.string().max(500).optional(),
  keywords: z.array(keywordText).max(12).optional(),
  level: CefrLevelSchema,
  length: LessonLengthSchema,
  imageCount: z.number().int().min(0).max(MAX_LESSON_SCENES),
  audio: z.boolean(),
  targets: z.array(LearningTargetSchema).min(1).max(MAX_LESSON_TARGETS),
}).strict();

const TargetIdArraySchema = z.array(ContentIdSchema).max(MAX_LESSON_TARGETS);

export const LessonSectionSchema = z.object({
  id: ContentIdSchema,
  text: lessonText,
  targetIds: TargetIdArraySchema,
}).strict();

export const LessonGlossaryEntrySchema = z.object({
  targetId: ContentIdSchema,
  definition: boundedText(600),
  translationVi: boundedText(600),
  example: boundedText(600),
}).strict();

export const EntityDescriptionSchema = z.object({
  id: ContentIdSchema,
  description: lessonText,
  entityResourceId: ServiceResourceIdSchema.optional(),
}).strict();

export const LessonSceneSchema = z.object({
  id: ContentIdSchema,
  description: lessonText,
  sectionIds: z.array(ContentIdSchema).max(12),
  targetIds: TargetIdArraySchema,
  entityDescriptionIds: z.array(ContentIdSchema).max(24).optional(),
}).strict();

const ExerciseBaseShape = {
  id: ContentIdSchema,
  prompt: boundedText(1_200),
  targetIds: TargetIdArraySchema.min(1),
};

const MeaningChoiceSchema = z.object({
  id: ContentIdSchema,
  text: boundedText(300),
}).strict();

export const MeaningExerciseSchema = z.object({
  kind: z.literal("meaning"),
  ...ExerciseBaseShape,
  choices: z.array(MeaningChoiceSchema).min(2).max(8),
  answerChoiceIds: z.array(ContentIdSchema).min(1).max(8),
}).strict();

const addMeaningExerciseIssues = (
  exercise: z.infer<typeof MeaningExerciseSchema>,
  context: z.RefinementCtx,
) => {
  const choiceIds = new Set<string>();
  const choiceTexts = new Set<string>();
  for (const [index, choice] of exercise.choices.entries()) {
    if (choiceIds.has(choice.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["choices", index, "id"],
        message: "choice ID must be unique",
      });
    }
    choiceIds.add(choice.id);
    if (choiceTexts.has(choice.text)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["choices", index, "text"],
        message: "choice text must be unique",
      });
    }
    choiceTexts.add(choice.text);
  }
  const answerIds = new Set<string>();
  for (const [index, answerId] of exercise.answerChoiceIds.entries()) {
    if (answerIds.has(answerId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["answerChoiceIds", index],
        message: "answer choice IDs must be unique",
      });
    }
    answerIds.add(answerId);
    if (!choiceIds.has(answerId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["answerChoiceIds", index],
        message: "answer choice must reference a choice in the exercise",
      });
    }
  }
};

export const FillExerciseSchema = z.object({
  kind: z.literal("fill"),
  ...ExerciseBaseShape,
  acceptedAnswers: z.array(boundedText(300)).min(1).max(8),
}).strict();

const OrderTokenSchema = z.object({
  id: ContentIdSchema,
  text: boundedText(120),
}).strict();

export const OrderExerciseSchema = z.object({
  kind: z.literal("order"),
  ...ExerciseBaseShape,
  tokens: z.array(OrderTokenSchema).min(2).max(32),
  acceptedOrders: z.array(z.array(ContentIdSchema).min(2).max(32)).min(1).max(8),
}).strict();

const addOrderExerciseIssues = (
  exercise: z.infer<typeof OrderExerciseSchema>,
  context: z.RefinementCtx,
) => {
  const tokenIds = new Set<string>();
  for (const [index, token] of exercise.tokens.entries()) {
    if (tokenIds.has(token.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tokens", index, "id"],
        message: "token ID must be unique",
      });
    }
    tokenIds.add(token.id);
  }
  for (const [orderIndex, order] of exercise.acceptedOrders.entries()) {
    if (order.length !== tokenIds.size || new Set(order).size !== tokenIds.size) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acceptedOrders", orderIndex],
        message: "accepted order must contain every token exactly once",
      });
      continue;
    }
    for (const [tokenIndex, tokenId] of order.entries()) {
      if (!tokenIds.has(tokenId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["acceptedOrders", orderIndex, tokenIndex],
          message: "accepted order must reference a token in the exercise",
        });
      }
    }
  }
};

export const RetellExerciseSchema = z.object({
  kind: z.literal("retell"),
  ...ExerciseBaseShape,
  hints: z.array(boundedText(300)).max(8).optional(),
}).strict();

export const ExerciseSchema = z.discriminatedUnion("kind", [
  MeaningExerciseSchema,
  FillExerciseSchema,
  OrderExerciseSchema,
  RetellExerciseSchema,
]).superRefine((exercise, context) => {
  if (exercise.kind === "meaning") addMeaningExerciseIssues(exercise, context);
  if (exercise.kind === "fill") {
    const answerSet = new Set<string>();
    for (const [index, answer] of exercise.acceptedAnswers.entries()) {
      if (answerSet.has(answer)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["acceptedAnswers", index],
          message: "accepted answers must be unique",
        });
      }
      answerSet.add(answer);
    }
  }
  if (exercise.kind === "order") addOrderExerciseIssues(exercise, context);
});

export const LessonDraftSchema = z.object({
  title: boundedText(200),
  sections: z.array(LessonSectionSchema).min(1).max(12),
  glossary: z.array(LessonGlossaryEntrySchema).min(1).max(MAX_LESSON_TARGETS),
  scenes: z.array(LessonSceneSchema).max(MAX_LESSON_SCENES),
  exercises: z.array(ExerciseSchema).max(48),
  entityDescriptions: z.array(EntityDescriptionSchema).max(24),
}).strict().superRefine((draft, context) => {
  const totalWords = draft.sections.reduce((total, section) => total + countWords(section.text), 0);
  if (totalWords > MAX_LESSON_WORDS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sections"],
      message: `lesson must contain at most ${MAX_LESSON_WORDS} words`,
    });
  }
});

export const MindmapNodeSchema = z.object({
  id: ContentIdSchema,
  term: boundedText(80),
  sense: boundedText(500),
  definition: boundedText(600),
  translationVi: boundedText(600),
  partOfSpeech: boundedText(40).optional(),
  ipa: boundedText(120).optional(),
  example: boundedText(600),
  evidence: EvidenceSchema,
}).strict();

export const MindmapEdgeSchema = z.object({
  id: ContentIdSchema,
  source: ContentIdSchema,
  target: ContentIdSchema,
  kind: MindmapEdgeKindSchema,
  evidence: EvidenceSchema,
}).strict();

export const MindmapIllustrationSchema = z.object({
  prompt: boundedText(1_200),
  alt: boundedText(500),
}).strict();

export const MindmapStudyGroupSchema = z.object({
  id: ContentIdSchema,
  title: boundedText(120),
  translationVi: boundedText(300),
  nodeIds: z.array(ContentIdSchema).min(1).max(6),
  example: boundedText(600),
  exampleTranslationVi: boundedText(600),
  illustration: MindmapIllustrationSchema.optional(),
}).strict();

export const MapBriefSchema = z.object({
  level: CefrLevelSchema,
  illustrations: z.boolean(),
}).strict();

export const MindmapGraphSchema = z.object({
  rootNodeId: ContentIdSchema,
  nodes: z.array(MindmapNodeSchema).min(1).max(MAX_MINDMAP_NODES),
  edges: z.array(MindmapEdgeSchema).max(MAX_MINDMAP_EDGES),
  studyGroups: z.array(MindmapStudyGroupSchema).min(1).max(MAX_MINDMAP_STUDY_GROUPS).optional(),
}).strict();

const StageIdentityShape = {
  jobId: ServiceResourceIdSchema,
  stageId: ServiceResourceIdSchema,
  attemptId: ServiceResourceIdSchema,
  expectedRevisionId: ServiceResourceIdSchema,
};

export const GenerationStageSchema = z.object({
  id: ServiceResourceIdSchema,
  jobId: ServiceResourceIdSchema,
  kind: GenerationKindSchema,
  expectedRevisionId: ServiceResourceIdSchema,
  state: GenerationStageStateSchema,
  activeAttemptId: ServiceResourceIdSchema.nullable().optional(),
}).strict();

export const StageAttemptSchema = z.object({
  id: ServiceResourceIdSchema,
  jobId: ServiceResourceIdSchema,
  stageId: ServiceResourceIdSchema,
  ordinal: z.number().int().safe().min(1),
  state: StageAttemptStateSchema,
}).strict();

const RelativeAssetFilenamePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9]{1,8}$/iu;

export const RelativeAssetFilenameSchema = z.string().regex(RelativeAssetFilenamePattern, {
  message: "must be a UUID filename with an extension",
});

export const ImageMimeTypeSchema = z.enum(["image/png", "image/jpeg", "image/webp"]);
export const AudioMimeTypeSchema = z.enum([
  "audio/wav",
  "audio/mpeg",
  "audio/ogg",
  "audio/webm",
]);
export const AssetSourceTypeSchema = z.enum(["section", "node", "group", "practice"]);

const AssetCandidatePayloadShape = {
  assetId: ServiceResourceIdSchema,
  slotId: ServiceResourceIdSchema,
  sourceId: ContentIdSchema,
  sourceHash: PayloadHashSchema,
  relativePath: RelativeAssetFilenameSchema,
  sha256: PayloadHashSchema,
  sizeBytes: z.number().int().safe().min(1).max(MAX_ASSET_SIZE_BYTES),
};

export const AssetCandidatePayloadSchema = z.object(AssetCandidatePayloadShape).strict();

export const ImageAssetPayloadSchema = AssetCandidatePayloadSchema.extend({
  mimeType: ImageMimeTypeSchema,
  width: z.number().int().safe().min(1).max(MAX_IMAGE_DIMENSION),
  height: z.number().int().safe().min(1).max(MAX_IMAGE_DIMENSION),
}).strict();

export const AudioAssetPayloadSchema = AssetCandidatePayloadSchema.extend({
  mimeType: AudioMimeTypeSchema,
  durationMs: z.number().int().safe().min(1).max(MAX_AUDIO_DURATION_MS),
  sourceType: AssetSourceTypeSchema,
}).strict();

export const ImageCandidatePayloadSchema = ImageAssetPayloadSchema;
export const AudioCandidatePayloadSchema = AudioAssetPayloadSchema;

const ExercisesCandidatePayloadSchema = z.object({
  exercises: z.array(ExerciseSchema).max(48),
}).strict();

export const StageCandidateEnvelopeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    ...StageIdentityShape,
    schemaVersion: z.literal(1),
    payloadHash: PayloadHashSchema,
    payload: LessonDraftSchema,
  }).strict(),
  z.object({
    kind: z.literal("map"),
    ...StageIdentityShape,
    schemaVersion: z.literal(1),
    payloadHash: PayloadHashSchema,
    payload: MindmapGraphSchema,
  }).strict(),
  z.object({
    kind: z.literal("image"),
    ...StageIdentityShape,
    schemaVersion: z.literal(1),
    payloadHash: PayloadHashSchema,
    payload: ImageAssetPayloadSchema,
  }).strict(),
  z.object({
    kind: z.literal("audio"),
    ...StageIdentityShape,
    schemaVersion: z.literal(1),
    payloadHash: PayloadHashSchema,
    payload: AudioAssetPayloadSchema,
  }).strict(),
  z.object({
    kind: z.literal("exercises"),
    ...StageIdentityShape,
    schemaVersion: z.literal(1),
    payloadHash: PayloadHashSchema,
    payload: ExercisesCandidatePayloadSchema,
  }).strict(),
]);

export type ContractIssue = {
  code: string;
  path: Array<string | number>;
  message: string;
};

export type ValidationSuccess<T> = {
  ok: true;
  data: T;
  issues: [];
};

export type ValidationFailure = {
  ok: false;
  issues: ContractIssue[];
};

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export function countWords(value: string): number {
  return value.trim() ? value.trim().split(/\s+/u).length : 0;
}

function schemaIssues(error: z.ZodError, prefix: Array<string | number>): ContractIssue[] {
  return error.issues.map((issue) => ({
    code: "schema_invalid",
    path: [...prefix, ...issue.path],
    message: issue.message,
  }));
}

function duplicateIdIssues(
  values: Array<{ id?: string }>,
  path: Array<string | number>,
): ContractIssue[] {
  const seen = new Set<string>();
  const issues: ContractIssue[] = [];
  for (const [index, value] of values.entries()) {
    if (typeof value.id !== "string") continue;
    if (seen.has(value.id)) {
      issues.push({
        code: "duplicate_id",
        path: [...path, index, "id"],
        message: `duplicate ID: ${value.id}`,
      });
    }
    seen.add(value.id);
  }
  return issues;
}

function targetReferenceIssues(
  targetIds: string[],
  briefTargetIds: Set<string>,
  path: Array<string | number>,
): ContractIssue[] {
  return targetIds.flatMap((targetId, index) => briefTargetIds.has(targetId) ? [] : [{
    code: "target_out_of_scope",
    path: [...path, index],
    message: `target ID is outside the finalized brief: ${targetId}`,
  }]);
}

function duplicateReferenceIssues(
  values: string[],
  path: Array<string | number>,
): ContractIssue[] {
  const seen = new Set<string>();
  const issues: ContractIssue[] = [];
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      issues.push({
        code: "duplicate_reference",
        path: [...path, index],
        message: `duplicate reference: ${value}`,
      });
    }
    seen.add(value);
  }
  return issues;
}

export function validateLessonDraft(
  draftInput: unknown,
  briefInput: unknown,
): ValidationResult<z.infer<typeof LessonDraftSchema>> {
  const briefResult = LessonBriefSchema.safeParse(briefInput);
  const draftResult = LessonDraftSchema.safeParse(draftInput);
  const issues: ContractIssue[] = [];
  if (!briefResult.success) issues.push(...schemaIssues(briefResult.error, ["brief"]));
  if (!draftResult.success) issues.push(...schemaIssues(draftResult.error, ["draft"]));
  if (issues.length > 0) return { ok: false, issues };

  const brief = briefResult.data;
  const draft = draftResult.data;
  const briefTargetIds = new Set(brief.targets.map((target) => target.id));
  if (draft.scenes.length > brief.imageCount) {
    issues.push({
      code: "scene_count_exceeds_brief",
      path: ["draft", "scenes"],
      message: `draft contains ${draft.scenes.length} scenes but brief allows ${brief.imageCount}`,
    });
  }
  issues.push(...duplicateIdIssues(brief.targets, ["brief", "targets"]));
  issues.push(...duplicateIdIssues(draft.sections, ["draft", "sections"]));
  issues.push(...duplicateIdIssues(draft.scenes, ["draft", "scenes"]));
  issues.push(...duplicateIdIssues(draft.exercises, ["draft", "exercises"]));
  issues.push(...duplicateIdIssues(draft.entityDescriptions, ["draft", "entityDescriptions"]));

  const sectionIds = new Set(draft.sections.map((section) => section.id));
  const entityDescriptionIds = new Set(draft.entityDescriptions.map((entity) => entity.id));
  const sectionTargetIds = new Set<string>();
  for (const [index, section] of draft.sections.entries()) {
    section.targetIds.forEach((targetId) => sectionTargetIds.add(targetId));
    issues.push(...duplicateReferenceIssues(
      section.targetIds,
      ["draft", "sections", index, "targetIds"],
    ));
    issues.push(...targetReferenceIssues(
      section.targetIds,
      briefTargetIds,
      ["draft", "sections", index, "targetIds"],
    ));
  }
  for (const [index, scene] of draft.scenes.entries()) {
    issues.push(...duplicateReferenceIssues(
      scene.targetIds,
      ["draft", "scenes", index, "targetIds"],
    ));
    issues.push(...duplicateReferenceIssues(
      scene.sectionIds,
      ["draft", "scenes", index, "sectionIds"],
    ));
    issues.push(...targetReferenceIssues(
      scene.targetIds,
      briefTargetIds,
      ["draft", "scenes", index, "targetIds"],
    ));
    for (const [sectionIndex, sectionId] of scene.sectionIds.entries()) {
      if (!sectionIds.has(sectionId)) {
        issues.push({
          code: "dangling_reference",
          path: ["draft", "scenes", index, "sectionIds", sectionIndex],
          message: `scene references missing section ID: ${sectionId}`,
        });
      }
    }
    for (const [entityIndex, entityId] of (scene.entityDescriptionIds ?? []).entries()) {
      if (!entityDescriptionIds.has(entityId)) {
        issues.push({
          code: "dangling_reference",
          path: ["draft", "scenes", index, "entityDescriptionIds", entityIndex],
          message: `scene references missing entity description ID: ${entityId}`,
        });
      }
    }
    issues.push(...duplicateReferenceIssues(
      scene.entityDescriptionIds ?? [],
      ["draft", "scenes", index, "entityDescriptionIds"],
    ));
  }
  for (const [index, glossaryEntry] of draft.glossary.entries()) {
    if (!briefTargetIds.has(glossaryEntry.targetId)) {
      issues.push({
        code: "target_out_of_scope",
        path: ["draft", "glossary", index, "targetId"],
        message: `glossary target ID is outside the finalized brief: ${glossaryEntry.targetId}`,
      });
    }
  }
  for (const [index, exercise] of draft.exercises.entries()) {
    issues.push(...duplicateReferenceIssues(
      exercise.targetIds,
      ["draft", "exercises", index, "targetIds"],
    ));
    issues.push(...targetReferenceIssues(
      exercise.targetIds,
      briefTargetIds,
      ["draft", "exercises", index, "targetIds"],
    ));
  }

  for (const target of brief.targets) {
    if (!sectionTargetIds.has(target.id)) {
      issues.push({
        code: "target_missing_from_sections",
        path: ["brief", "targets", target.id],
        message: `target is not used in any lesson section: ${target.id}`,
      });
    }
    const glossaryEntries = draft.glossary.filter((entry) => entry.targetId === target.id);
    if (glossaryEntries.length === 0) {
      issues.push({
        code: "missing_glossary_entry",
        path: ["draft", "glossary"],
        message: `target is missing a glossary entry: ${target.id}`,
      });
    } else if (glossaryEntries.length > 1) {
      issues.push({
        code: "duplicate_id",
        path: ["draft", "glossary"],
        message: `target has multiple glossary entries: ${target.id}`,
      });
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, data: draft, issues: [] };
}

export function validateMindmapGraph(
  graphInput: unknown,
): ValidationResult<z.infer<typeof MindmapGraphSchema>> {
  const graphResult = MindmapGraphSchema.safeParse(graphInput);
  if (!graphResult.success) return { ok: false, issues: schemaIssues(graphResult.error, ["graph"]) };

  const graph = graphResult.data;
  const issues: ContractIssue[] = [];
  issues.push(...duplicateIdIssues(graph.nodes, ["graph", "nodes"]));
  issues.push(...duplicateIdIssues(graph.edges, ["graph", "edges"]));
  const graphEntityIds = new Set<string>();
  for (const [index, entity] of graph.nodes.entries()) {
    if (graphEntityIds.has(entity.id)) {
      issues.push({
        code: "duplicate_id",
        path: ["graph", "nodes", index],
        message: `duplicate graph entity ID: ${entity.id}`,
      });
    }
    graphEntityIds.add(entity.id);
  }
  for (const [index, entity] of graph.edges.entries()) {
    if (graphEntityIds.has(entity.id)) {
      issues.push({
        code: "duplicate_id",
        path: ["graph", "edges", index],
        message: `duplicate graph entity ID: ${entity.id}`,
      });
    }
    graphEntityIds.add(entity.id);
  }
  for (const [index, group] of (graph.studyGroups ?? []).entries()) {
    if (graphEntityIds.has(group.id)) {
      issues.push({
        code: "duplicate_id",
        path: ["graph", "studyGroups", index, "id"],
        message: `duplicate graph entity ID: ${group.id}`,
      });
    }
    graphEntityIds.add(group.id);
  }
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  if (!nodeIds.has(graph.rootNodeId)) {
    issues.push({
      code: "dangling_reference",
      path: ["graph", "rootNodeId"],
      message: `root node ID does not exist: ${graph.rootNodeId}`,
    });
  }
  const relationKeys = new Set<string>();
  for (const [index, edge] of graph.edges.entries()) {
    if (!nodeIds.has(edge.source)) {
      issues.push({
        code: "dangling_reference",
        path: ["graph", "edges", index, "source"],
        message: `edge source ID does not exist: ${edge.source}`,
      });
    }
    if (!nodeIds.has(edge.target)) {
      issues.push({
        code: "dangling_reference",
        path: ["graph", "edges", index, "target"],
        message: `edge target ID does not exist: ${edge.target}`,
      });
    }
    if (edge.source === edge.target) {
      issues.push({
        code: "self_edge",
        path: ["graph", "edges", index],
        message: "graph edges cannot connect a node to itself",
      });
    }
    const relationKey = `${edge.source}\u0000${edge.target}\u0000${edge.kind}`;
    if (relationKeys.has(relationKey)) {
      issues.push({
        code: "duplicate_edge",
        path: ["graph", "edges", index],
        message: "duplicate graph relation",
      });
    }
    relationKeys.add(relationKey);
  }
  if (graph.studyGroups) {
    const assignedNodeIds = new Set<string>();
    for (const [groupIndex, group] of graph.studyGroups.entries()) {
      for (const [nodeIndex, nodeId] of group.nodeIds.entries()) {
        const path = ["graph", "studyGroups", groupIndex, "nodeIds", nodeIndex];
        if (nodeId === graph.rootNodeId) {
          issues.push({
            code: "root_in_study_group",
            path,
            message: "study groups cannot contain the root node",
          });
        } else if (!nodeIds.has(nodeId)) {
          issues.push({
            code: "dangling_reference",
            path,
            message: `study group references missing node ID: ${nodeId}`,
          });
        }
        if (assignedNodeIds.has(nodeId)) {
          issues.push({
            code: "duplicate_reference",
            path,
            message: `study group node is assigned more than once: ${nodeId}`,
          });
        }
        assignedNodeIds.add(nodeId);
      }
    }
    for (const node of graph.nodes) {
      if (node.id !== graph.rootNodeId && !assignedNodeIds.has(node.id)) {
        issues.push({
          code: "missing_study_group_member",
          path: ["graph", "studyGroups"],
          message: `nonroot node is missing from study groups: ${node.id}`,
        });
      }
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, data: graph, issues: [] };
}

export function validateGeneratedMindmapGraph(
  graphInput: unknown,
  briefInput: unknown,
): ValidationResult<z.infer<typeof MindmapGraphSchema>> {
  const graphResult = validateMindmapGraph(graphInput);
  const briefResult = MapBriefSchema.safeParse(briefInput);
  const issues: ContractIssue[] = [];
  if (!graphResult.ok) issues.push(...graphResult.issues);
  if (!briefResult.success) issues.push(...schemaIssues(briefResult.error, ["brief"]));
  if (!graphResult.ok || !briefResult.success) return { ok: false, issues };

  const graph = graphResult.data;
  const brief = briefResult.data;
  if (!graph.studyGroups) {
    issues.push({
      code: "missing_study_groups",
      path: ["graph", "studyGroups"],
      message: "newly generated mindmaps require study groups",
    });
  }
  for (const [index, node] of graph.nodes.entries()) {
    if (node.id !== graph.rootNodeId && !node.ipa) {
      issues.push({
        code: "missing_ipa",
        path: ["graph", "nodes", index, "ipa"],
        message: `newly generated nonroot node requires IPA: ${node.id}`,
      });
    }
  }
  if (brief.illustrations) {
    for (const [index, group] of (graph.studyGroups ?? []).entries()) {
      if (!group.illustration) {
        issues.push({
          code: "missing_illustration",
          path: ["graph", "studyGroups", index, "illustration"],
          message: `illustrated map group requires an illustration: ${group.id}`,
        });
      }
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, data: graph, issues: [] };
}
