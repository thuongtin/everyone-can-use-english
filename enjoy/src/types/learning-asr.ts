export type LearningAsrEngine = "cloudflare_workers_ai" | "mai_transcribe" | "openai" | "azure_mai" | "azure_speech";

export type StudyTimelineEntry = {
  type: "sentence" | "word" | "token" | "phone";
  text: string;
  startTime: number;
  endTime: number;
  timeline: StudyTimelineEntry[];
};

export type InstrumentalMusicEvidence = {
  startTime: number;
  endTime: number;
  modelSha256: string;
  musicMean: number;
  vocalMax: number;
  analyzedWindows: number;
};

export type LearningAsrValidation = {
  version: 1;
  sourceSha256: string;
  sourceSamples: number;
  sampleRate: number;
  transport: "whole" | "windows";
  requestWindows: number;
  resumedWindows: number;
  retries: number;
  repairedSeams: number;
  repairedSpeechGaps: number;
  repairedAlignmentWindows: number;
  omittedPhoneTimings: number;
  sourceCoverage: "complete";
  textCoverage: "matched";
  timestampChecks: "passed";
  speechGapCheck: "passed";
  recognitionAccuracy: "not-measured";
  instrumentalMusic?: InstrumentalMusicEvidence[];
};

export type LearningAsrResult = {
  engine: string;
  model: string;
  transcript: string;
  language: string;
  duration: number;
  timeline: StudyTimelineEntry[];
  validation: LearningAsrValidation;
};

export type LearningAsrRequest = {
  jobId: string;
  profileId: string;
  connectionId: string;
  audioUrl: string;
  service: LearningAsrEngine;
  language: string;
};

export type LearningAsrProgress = {
  jobId: string;
  stage: "preparing" | "recognizing" | "aligning" | "repairing" | "validating";
  completed: number;
  total: number;
  percent: number;
  resumed: number;
};

export type LearningAsrErrorCode =
  | "asr_auth"
  | "asr_quota"
  | "asr_rate_limit"
  | "asr_timeout"
  | "asr_cancelled"
  | "asr_network"
  | "asr_invalid_audio"
  | "asr_invalid_response"
  | "asr_no_speech"
  | "asr_model_unsupported"
  | "asr_review_required"
  | "asr_failed";

export type LearningAsrResponse =
  | { ok: true; result: LearningAsrResult }
  | { ok: false; error: { code: LearningAsrErrorCode; startTime?: number; endTime?: number } };

export type LearningAsrBridge = {
  start: (request: LearningAsrRequest) => Promise<LearningAsrResponse>;
  cancel: (jobId: string) => Promise<boolean>;
  onProgress: (callback: (event: Electron.IpcRendererEvent, progress: LearningAsrProgress) => void) => () => void;
};
