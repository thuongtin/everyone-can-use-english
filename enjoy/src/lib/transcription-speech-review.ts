import type { LearningAsrValidation } from "../types/learning-asr";

export type SpeechReviewEvidence = {
  sourceSha256: string;
  speechGaps: { startTime: number; endTime: number }[];
};

type TranscriptionQuality = {
  validation?: LearningAsrValidation;
  speechReview?: SpeechReviewEvidence;
};

export function transcriptionSpeechReview(result?: TranscriptionQuality | null): SpeechReviewEvidence | undefined {
  if (result?.validation?.speechGapCheck === "passed") return undefined;
  if (result?.validation?.speechGapCheck === "review-required" && result.validation.speechGaps?.length) {
    return { sourceSha256: result.validation.sourceSha256, speechGaps: result.validation.speechGaps.map(gap => ({ ...gap })) };
  }
  return result?.speechReview;
}

/** Editing text does not rerun acoustic coverage or resolve source review ranges. */
export function transcriptionQualityMetadata(validation?: LearningAsrValidation, previous?: TranscriptionQuality | null): TranscriptionQuality {
  if (validation) return { validation };
  const speechReview = transcriptionSpeechReview(previous);
  return speechReview ? { speechReview } : {};
}
