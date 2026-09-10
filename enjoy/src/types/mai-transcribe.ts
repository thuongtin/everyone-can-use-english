export type MaiTranscribeErrorCode =
  | "mai_key_required"
  | "mai_auth"
  | "mai_quota"
  | "mai_timeout"
  | "mai_cancelled"
  | "mai_network"
  | "mai_invalid_audio"
  | "mai_invalid_response"
  | "mai_no_speech"
  | "mai_failed";

export type MaiTranscribeRequest = {
  jobId: string;
  audioUrl: string;
  language?: string;
};

export type MaiTranscribeSegment = {
  text: string;
  start: number;
  end: number;
  speaker?: string;
};

export type MaiTranscribeWord = {
  word: string;
  start: number;
  end: number;
  speaker?: string;
};

export type MaiTranscribeResult = {
  engine: "openrouter";
  model: "microsoft/mai-transcribe-2";
  transcript: string;
  language?: string;
  duration: number;
  segments: MaiTranscribeSegment[];
  words: MaiTranscribeWord[];
  usage?: { seconds?: number; cost?: number };
};

export type MaiTranscribeProgress = {
  jobId: string;
  completedChunks: number;
  totalChunks: number;
  percent: number;
};

export type MaiTranscribeResponse =
  | { ok: true; result: MaiTranscribeResult }
  | {
      ok: false;
      error: { code: MaiTranscribeErrorCode; message: string };
    };
