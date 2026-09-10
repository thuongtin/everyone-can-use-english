import type { z } from "zod";
import type {
  CefrLevelSchema,
  ContractIssue,
  AssetCandidatePayloadSchema,
  AudioAssetPayloadSchema,
  ContentIdSchema,
  EntityDescriptionSchema,
  EntityResourceIdSchema,
  ExerciseSchema,
  ExerciseKindSchema,
  EvidenceSchema,
  EvidenceStatusSchema,
  FillExerciseSchema,
  GenerationStageSchema,
  GenerationKindSchema,
  GenerationStageStateSchema,
  GenerationStageStatusSchema,
  ImageAssetPayloadSchema,
  LessonBriefSchema,
  LessonDraftSchema,
  LessonGlossaryEntrySchema,
  LessonLengthSchema,
  LessonSceneSchema,
  LessonSectionSchema,
  LearningTargetSchema,
  MapBriefSchema,
  MindmapEdgeSchema,
  MindmapEdgeKindSchema,
  MindmapGraphSchema,
  MindmapIllustrationSchema,
  MindmapNodeSchema,
  MindmapStudyGroupSchema,
  MeaningExerciseSchema,
  RawBriefInputSchema,
  RetellExerciseSchema,
  OrderExerciseSchema,
  PayloadHashSchema,
  ServiceResourceIdSchema,
  StageAttemptSchema,
  StageAttemptStateSchema,
  StageAttemptStatusSchema,
  StageCandidateEnvelopeSchema,
  ValidationFailure,
  ValidationResult,
  ValidationSuccess,
  validateLessonDraft,
  validateGeneratedMindmapGraph,
  validateMindmapGraph,
} from "../lib/learning-schemas";

export type CefrLevel = z.infer<typeof CefrLevelSchema>;
export type ContentId = z.infer<typeof ContentIdSchema>;
export type ServiceResourceId = z.infer<typeof ServiceResourceIdSchema>;
export type EntityResourceId = z.infer<typeof EntityResourceIdSchema>;
export type PayloadHash = z.infer<typeof PayloadHashSchema>;
export type LessonLength = z.infer<typeof LessonLengthSchema>;
export type GenerationKind = z.infer<typeof GenerationKindSchema>;
export type ExerciseKind = z.infer<typeof ExerciseKindSchema>;
export type MindmapEdgeKind = z.infer<typeof MindmapEdgeKindSchema>;
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type GenerationStageStatus = z.infer<typeof GenerationStageStatusSchema>;
export type StageAttemptStatus = z.infer<typeof StageAttemptStatusSchema>;
export type GenerationStageState = z.infer<typeof GenerationStageStateSchema>;
export type StageAttemptState = z.infer<typeof StageAttemptStateSchema>;
export type AssetCandidatePayload = z.infer<typeof AssetCandidatePayloadSchema>;
export type ImageAssetPayload = z.infer<typeof ImageAssetPayloadSchema>;
export type AudioAssetPayload = z.infer<typeof AudioAssetPayloadSchema>;
export type RawBriefInput = z.infer<typeof RawBriefInputSchema>;
export type LearningTarget = z.infer<typeof LearningTargetSchema>;
export type MapBrief = z.infer<typeof MapBriefSchema>;
export type LessonBrief = z.infer<typeof LessonBriefSchema>;
export type LessonSection = z.infer<typeof LessonSectionSchema>;
export type LessonGlossaryEntry = z.infer<typeof LessonGlossaryEntrySchema>;
export type LessonScene = z.infer<typeof LessonSceneSchema>;
export type EntityDescription = z.infer<typeof EntityDescriptionSchema>;
export type Exercise = z.infer<typeof ExerciseSchema>;
export type MeaningExercise = z.infer<typeof MeaningExerciseSchema>;
export type FillExercise = z.infer<typeof FillExerciseSchema>;
export type OrderExercise = z.infer<typeof OrderExerciseSchema>;
export type RetellExercise = z.infer<typeof RetellExerciseSchema>;
export type LessonDraft = z.infer<typeof LessonDraftSchema>;
export type MindmapNode = z.infer<typeof MindmapNodeSchema>;
export type MindmapEdge = z.infer<typeof MindmapEdgeSchema>;
export type MindmapIllustration = z.infer<typeof MindmapIllustrationSchema>;
export type MindmapStudyGroup = z.infer<typeof MindmapStudyGroupSchema>;
export type MindmapGraph = z.infer<typeof MindmapGraphSchema>;
export type GenerationStage = z.infer<typeof GenerationStageSchema>;
export type StageAttempt = z.infer<typeof StageAttemptSchema>;
export type StageCandidateEnvelope = z.infer<typeof StageCandidateEnvelopeSchema>;
export type ContractValidationIssue = ContractIssue;
export type ContractValidationFailure = ValidationFailure;
export type ContractValidationSuccess<T> = ValidationSuccess<T>;
export type ContractValidationResult<T> = ValidationResult<T>;

export type LessonDraftValidator = typeof validateLessonDraft;
export type MindmapGraphValidator = typeof validateMindmapGraph;
export type GeneratedMindmapGraphValidator = typeof validateGeneratedMindmapGraph;
