import type { LearningStorage } from "../main/learning/storage";
import type { PracticeGrade } from "../lib/practice-grading";
import type { GenerationJobAttributes, GenerationStageAttributes, StageAttemptAttributes, PracticeAttemptAttributes } from "../main/db/learning-models";

export type LearningContext = Readonly<{ profileId: string; connectionId: string }>;
export type LearningGenerationProvider = "codex" | "claude" | "azure-openai";
export type LearningNativeCapability = Readonly<{
  provider: LearningGenerationProvider;
  text: boolean;
  image: boolean;
  reason: string | null;
}>;
export type LearningSession = LearningContext & {
  capabilities: LearningNativeCapability[];
  healthError: string | null;
};

type Input<K extends keyof LearningStorage> = LearningStorage[K] extends (input: infer I) => unknown ? I : never;
type Output<K extends keyof LearningStorage> = LearningStorage[K] extends (...args: never[]) => infer O ? Awaited<O> : never;

export type LearningOperationMap = {
  generate: { input: { provider: LearningGenerationProvider; model?: string; resourceType: "lesson" | "map"; resourceId: string; revisionId: string; requestKey: string }; output: { jobId: string } };
  generateAsset: { input: { resourceType: "lesson" | "map"; resourceId: string; revisionId: string; slotId: string; requestKey: string }; output: { jobId: string } };
  retryGeneration: { input: { jobId: string; stageId: string; provider: LearningGenerationProvider; model?: string }; output: { jobId: string } };
  listJobs: { input: { resourceType: "lesson" | "map"; resourceId: string }; output: GenerationJobAttributes[] };
  narrateMapNode: { input: { mapId: string; revisionId: string; nodeId: string; requestKey: string }; output: { jobId: string | null; assetId: string | null } };
  list: { input: Record<string, never>; output: { lessons: Output<"listLessons">; maps: Output<"listMaps"> } };
  getLesson: { input: { id: string }; output: Output<"getLesson"> };
  getMap: { input: { id: string }; output: Output<"getMap"> };
  createLesson: { input: Input<"createLesson">; output: Output<"createLesson"> };
  createMap: { input: Input<"createMap">; output: Output<"createMap"> };
  reviseLesson: { input: Input<"reviseLesson">; output: Output<"reviseLesson"> };
  reviseMap: { input: Input<"reviseMap">; output: Output<"reviseMap"> };
  saveMapLayout: { input: Input<"saveMapLayout">; output: Output<"saveMapLayout"> };
  selectAsset: { input: Input<"selectAsset">; output: Output<"selectAsset"> };
  deleteLesson: { input: { id: string }; output: { deleted: true } };
  deleteMap: { input: { id: string }; output: { deleted: true } };
  practice: {
    input: { lessonRevisionId: string; questionId: string; answer: unknown; recording?: { bytes: Uint8Array; mimeType: string } };
    output: { attempt: PracticeAttemptAttributes; grade: PracticeGrade };
  };
  job: { input: { id: string }; output: { job: GenerationJobAttributes; stages: GenerationStageAttributes[]; attempts: StageAttemptAttributes[] } };
  cancelJob: { input: { id: string }; output: { cancelled: true } };
};

export interface LearningBridge {
  getContext(options?: { refreshCapabilities?: boolean }): Promise<LearningSession>;
  request<K extends keyof LearningOperationMap>(context: LearningContext, action: K, input: LearningOperationMap[K]["input"]): Promise<LearningOperationMap[K]["output"]>;
}
