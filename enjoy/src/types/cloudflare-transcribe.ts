export type CloudflareTranscribeErrorCode =
  | "cf_auth"
  | "cf_quota"
  | "cf_timeout"
  | "cf_invalid_audio"
  | "cf_no_speech"
  | "cf_invalid_response"
  | "cf_failed";

export type CloudflareTranscribeRequest = {
  jobId: string;
  audioUrl: string;
  language?: string;
};

export type CloudflareTranscribeSegment = {
  text: string;
  start: number;
  end: number;
};

export type CloudflareTranscribeResult = {
  engine: "cloudflare-workers-ai";
  model: "@cf/openai/whisper-large-v3-turbo";
  transcript: string;
  segments: CloudflareTranscribeSegment[];
};

export type CloudflareTranscribeProgress = {
  jobId: string;
  completedChunks: number;
  totalChunks: number;
  percent: number;
};

export type CloudflareTranscribeResponse =
  | { ok: true; result: CloudflareTranscribeResult }
  | { ok: false; error: { code: CloudflareTranscribeErrorCode; message: string } };

export type CloudflareTranscribeConfig = {
  baseUrl: string;
  configured: boolean;
};

export type CloudflareTranscribeConfigUpdate = {
  baseUrl: string;
  token?: string;
  clearToken?: boolean;
};

export type CloudflareTranscribeBridge = {
  getConfig: () => Promise<CloudflareTranscribeConfig>;
  setConfig: (update: CloudflareTranscribeConfigUpdate) => Promise<CloudflareTranscribeConfig>;
};
