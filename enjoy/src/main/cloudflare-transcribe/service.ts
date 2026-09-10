import type {
  CloudflareTranscribeErrorCode,
  CloudflareTranscribeProgress,
  CloudflareTranscribeRequest,
  CloudflareTranscribeResult,
  CloudflareTranscribeSegment,
} from "@/types/cloudflare-transcribe";
import { createGuardedFetch } from "@/lib/network-policy";

export const CLOUDFLARE_TRANSCRIBE_MODEL =
  "@cf/openai/whisper-large-v3-turbo" as const;
export const MAX_CLOUDFLARE_AUDIO_BYTES = 30_000_000;
export const MAX_CLOUDFLARE_RESPONSE_BYTES = 2_000_000;
export const MAX_CLOUDFLARE_AUDIO_SECONDS = 3_601;
export const DEFAULT_CLOUDFLARE_REQUEST_TIMEOUT_MS = 16 * 60_000;

export class CloudflareTranscribeError extends Error {
  constructor(
    public readonly code: CloudflareTranscribeErrorCode,
    message: string
  ) {
    super(message);
    this.name = "CloudflareTranscribeError";
  }
}

export type CloudflarePreparedAudio = Readonly<{
  audio: Buffer;
  format: "mp3";
  duration: number;
}>;

type ServiceOptions = {
  config: () => Promise<{ baseUrl: string; token: string | null }>;
  prepareAudio: (
    audioUrl: string,
    runtime: { signal?: AbortSignal }
  ) => Promise<CloudflarePreparedAudio>;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
};

const cleanString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function normalizeCloudflareBaseUrl(value: unknown): string {
  const raw = cleanString(value);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CloudflareTranscribeError(
      "cf_failed",
      "Enter a valid Cloudflare Worker URL."
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    !hostname.endsWith(".workers.dev") ||
    hostname === ".workers.dev" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new CloudflareTranscribeError(
      "cf_failed",
      "Use the HTTPS root URL of a workers.dev Worker."
    );
  }
  return `https://${hostname}`;
}

function normalizeSegments(value: unknown): CloudflareTranscribeSegment[] {
  if (!Array.isArray(value)) return [];
  const segments: CloudflareTranscribeSegment[] = [];
  for (const raw of value) {
    const item = asRecord(raw);
    const text = cleanString(item?.text);
    const start = item?.start;
    const end = item?.end;
    if (
      !text ||
      typeof start !== "number" ||
      !Number.isFinite(start) ||
      typeof end !== "number" ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start
    ) {
      return [];
    }
    segments.push({ text, start, end });
  }
  return segments;
}

export function normalizeCloudflareTranscribeResponse(
  value: unknown
): Pick<CloudflareTranscribeResult, "transcript" | "segments"> {
  const envelope = asRecord(value);
  const response = asRecord(envelope?.result);
  const transcript = cleanString(response?.text);
  if (!envelope || envelope.ok !== true || !response || !transcript) {
    throw new CloudflareTranscribeError(
      "cf_invalid_response",
      "The Cloudflare Worker returned an invalid transcript."
    );
  }
  return { transcript, segments: normalizeSegments(response.segments) };
}

function statusError(status: number): CloudflareTranscribeError {
  if (status === 401 || status === 403) {
    return new CloudflareTranscribeError(
      "cf_auth",
      "The Cloudflare Worker rejected the app token."
    );
  }
  if (status === 429) {
    return new CloudflareTranscribeError(
      "cf_quota",
      "The Cloudflare Worker is rate limited or out of quota."
    );
  }
  if (status === 400) {
    return new CloudflareTranscribeError(
      "cf_invalid_audio",
      "The Cloudflare Worker rejected the audio."
    );
  }
  if (status === 504) {
    return new CloudflareTranscribeError(
      "cf_timeout",
      "The Cloudflare Worker timed out."
    );
  }
  if (status === 502) {
    return new CloudflareTranscribeError(
      "cf_failed",
      "Cloudflare Workers AI could not transcribe the audio."
    );
  }
  return new CloudflareTranscribeError(
    "cf_failed",
    `The Cloudflare Worker request failed (${status}).`
  );
}

function responseError(value: unknown, status: number): CloudflareTranscribeError {
  const envelope = asRecord(value);
  const error = asRecord(envelope?.error);
  const code = cleanString(error?.code) as CloudflareTranscribeErrorCode;
  const supported: CloudflareTranscribeErrorCode[] = [
    "cf_auth",
    "cf_quota",
    "cf_timeout",
    "cf_invalid_audio",
    "cf_no_speech",
    "cf_invalid_response",
    "cf_failed",
  ];
  return supported.includes(code)
    ? new CloudflareTranscribeError(
        code,
        cleanString(error?.message) || "Cloudflare transcription failed."
      )
    : statusError(status);
}

export async function readBoundedCloudflareResponse(
  response: Response
): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const declaredLength = Number(declared);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > MAX_CLOUDFLARE_RESPONSE_BYTES
    ) {
      throw new CloudflareTranscribeError(
        "cf_invalid_response",
        "The Cloudflare Worker returned an oversized response."
      );
    }
  }
  if (!response.body) {
    throw new CloudflareTranscribeError(
      "cf_invalid_response",
      "The Cloudflare Worker returned an empty response."
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalLength += value.byteLength;
      if (totalLength > MAX_CLOUDFLARE_RESPONSE_BYTES) {
        await reader.cancel("response too large");
        throw new CloudflareTranscribeError(
          "cf_invalid_response",
          "The Cloudflare Worker returned an oversized response."
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CloudflareTranscribeError(
      "cf_invalid_response",
      "The Cloudflare Worker returned invalid UTF-8."
    );
  }
}

export function createCloudflareTranscribeService(options: ServiceOptions) {
  const fetchImpl = createGuardedFetch(options.fetch || fetch, {
    transport: "main-fetch",
    operation: "asr.cloudflare-worker-legacy-service",
  });
  const timeoutMs = options.requestTimeoutMs || DEFAULT_CLOUDFLARE_REQUEST_TIMEOUT_MS;

  return {
    async transcribe(
      request: CloudflareTranscribeRequest,
      runtime: {
        signal?: AbortSignal;
        onProgress?: (progress: CloudflareTranscribeProgress) => void;
      } = {}
    ): Promise<CloudflareTranscribeResult> {
      const { baseUrl: rawBaseUrl, token: rawToken } = await options.config();
      const baseUrl = normalizeCloudflareBaseUrl(rawBaseUrl);
      const token = cleanString(rawToken);
      if (!token) {
        throw new CloudflareTranscribeError(
          "cf_auth",
          "Configure an app token for the Cloudflare Worker."
        );
      }
      if (runtime.signal?.aborted) {
        throw new CloudflareTranscribeError(
          "cf_failed",
          "Transcription was cancelled."
        );
      }

      let prepared: CloudflarePreparedAudio;
      try {
        prepared = await options.prepareAudio(request.audioUrl, {
          signal: runtime.signal,
        });
      } catch (error) {
        if (error instanceof CloudflareTranscribeError) throw error;
        throw new CloudflareTranscribeError(
          "cf_invalid_audio",
          "The audio file could not be read."
        );
      }
      if (
        !Buffer.isBuffer(prepared.audio) ||
        prepared.audio.length === 0 ||
        prepared.audio.length > MAX_CLOUDFLARE_AUDIO_BYTES ||
        prepared.format !== "mp3" ||
        !Number.isFinite(prepared.duration) ||
        prepared.duration <= 0 ||
        prepared.duration > MAX_CLOUDFLARE_AUDIO_SECONDS
      ) {
        throw new CloudflareTranscribeError(
          "cf_invalid_audio",
          "The prepared audio is invalid."
        );
      }
      if (runtime.signal?.aborted) {
        throw new CloudflareTranscribeError(
          "cf_failed",
          "Transcription was cancelled."
        );
      }
      const languageCode = cleanString(request.language).split("-")[0];
      runtime.onProgress?.({
        jobId: request.jobId,
        completedChunks: 0,
        totalChunks: 1,
        percent: 0,
      });

      const controller = new AbortController();
      let timedOut = false;
      const abortFromCaller = () => controller.abort();
      runtime.signal?.addEventListener("abort", abortFromCaller, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        const response = await fetchImpl(`${baseUrl}/v1/transcriptions`, {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "audio/mpeg",
            ...(languageCode ? { "X-Audio-Language": languageCode } : {}),
          },
          body: prepared.audio,
          signal: controller.signal,
        });
        const responseText = await readBoundedCloudflareResponse(response);
        let parsed: unknown;
        try {
          parsed = JSON.parse(responseText);
        } catch {
          if (!response.ok) throw statusError(response.status);
          throw new CloudflareTranscribeError(
            "cf_invalid_response",
            "The Cloudflare Worker returned invalid JSON."
          );
        }
        if (!response.ok) throw responseError(parsed, response.status);
        const normalized = normalizeCloudflareTranscribeResponse(parsed);
        runtime.onProgress?.({
          jobId: request.jobId,
          completedChunks: 1,
          totalChunks: 1,
          percent: 100,
        });
        return {
          engine: "cloudflare-workers-ai",
          model: CLOUDFLARE_TRANSCRIBE_MODEL,
          ...normalized,
        };
      } catch (error) {
        if (error instanceof CloudflareTranscribeError) throw error;
        if (timedOut) {
          throw new CloudflareTranscribeError(
            "cf_timeout",
            "The request timed out."
          );
        }
        if (runtime.signal?.aborted) {
          throw new CloudflareTranscribeError(
            "cf_failed",
            "Transcription was cancelled."
          );
        }
        throw new CloudflareTranscribeError(
          "cf_failed",
          "Could not connect to the Cloudflare Worker."
        );
      } finally {
        clearTimeout(timer);
        runtime.signal?.removeEventListener("abort", abortFromCaller);
      }
    },
  };
}
