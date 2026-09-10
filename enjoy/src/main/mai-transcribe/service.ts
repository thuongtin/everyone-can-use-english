import type {
  MaiTranscribeErrorCode,
  MaiTranscribeProgress,
  MaiTranscribeRequest,
  MaiTranscribeResult,
  MaiTranscribeSegment,
  MaiTranscribeWord,
} from "@/types/mai-transcribe";
import { createGuardedFetch } from "@/lib/network-policy";

export const MAI_TRANSCRIBE_MODEL = "microsoft/mai-transcribe-2" as const;
export const MAI_TRANSCRIBE_ENDPOINT =
  "https://openrouter.ai/api/v1/audio/transcriptions";
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_CHUNK_SECONDS = 60;
const MAX_JSON_REQUEST_BYTES = 8_000_000;
const MAX_JSON_RESPONSE_BYTES = 8 * 1024 * 1024;
const TIMESTAMP_ROUNDING_TOLERANCE_SECONDS = 0.25;

export class MaiTranscribeError extends Error {
  constructor(
    public readonly code: MaiTranscribeErrorCode,
    message: string
  ) {
    super(message);
    this.name = "MaiTranscribeError";
  }
}

type WavChunk = {
  bytes: Buffer;
  startTime: number;
  duration: number;
};

type NormalizedChunkResult = {
  transcript: string;
  language?: string;
  duration?: number;
  segments: MaiTranscribeSegment[];
  words: MaiTranscribeWord[];
  usage?: { seconds?: number; cost?: number };
};

type ServiceOptions = {
  credential: () => Promise<string | null | undefined>;
  readAudio: (audioUrl: string) => Promise<Buffer>;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
  maxChunkSeconds?: number;
};

type TranscribeOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: MaiTranscribeProgress) => void;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const cleanString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const optionalFinite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function parseTiming(
  value: unknown,
  label: "segment" | "word"
): { start: number; end: number; speaker?: string } {
  const item = asRecord(value);
  const start = optionalFinite(item?.start);
  const end = optionalFinite(item?.end);
  if (!item || start === undefined || end === undefined || start < 0 || end < start) {
    throw new MaiTranscribeError(
      "mai_invalid_response",
      `MAI Transcribe returned an invalid ${label} timestamp.`
    );
  }
  const speaker = cleanString(item.speaker);
  return { start, end, ...(speaker ? { speaker } : {}) };
}

export function normalizeMaiTranscribeResponse(
  response: unknown
): NormalizedChunkResult {
  const value = asRecord(response);
  const transcript = cleanString(value?.text);
  if (!value || typeof value.text !== "string") {
    throw new MaiTranscribeError(
      "mai_invalid_response",
      "MAI Transcribe returned an invalid text field."
    );
  }

  if (value.segments !== undefined && !Array.isArray(value.segments)) {
    throw new MaiTranscribeError(
      "mai_invalid_response",
      "MAI Transcribe returned invalid segments."
    );
  }
  const rawSegments: unknown[] = Array.isArray(value.segments) ? value.segments : [];
  const segments = rawSegments.map((raw: unknown) => {
    const item = asRecord(raw);
    const text = cleanString(item?.text);
    if (!text) {
      throw new MaiTranscribeError(
        "mai_invalid_response",
        "MAI Transcribe returned an invalid segment."
      );
    }
    return { text, ...parseTiming(raw, "segment") };
  });

  if (value.words !== undefined && !Array.isArray(value.words)) {
    throw new MaiTranscribeError(
      "mai_invalid_response",
      "MAI Transcribe returned invalid words."
    );
  }
  const rawWords: unknown[] = Array.isArray(value.words) ? value.words : [];
  const words = rawWords.map((raw: unknown) => {
    const item = asRecord(raw);
    const word = cleanString(item?.word);
    if (!word) {
      throw new MaiTranscribeError(
        "mai_invalid_response",
        "MAI Transcribe returned an invalid word."
      );
    }
    return { word, ...parseTiming(raw, "word") };
  });
  if (!transcript && (segments.length > 0 || words.length > 0)) {
    throw new MaiTranscribeError(
      "mai_invalid_response",
      "MAI Transcribe returned timestamps without transcript text."
    );
  }

  const duration = optionalFinite(value.duration);
  if (duration !== undefined && duration < 0) {
    throw new MaiTranscribeError(
      "mai_invalid_response",
      "MAI Transcribe returned an invalid duration."
    );
  }
  const language = cleanString(value.language);
  const rawUsage = asRecord(value.usage);
  const seconds = optionalFinite(rawUsage?.seconds);
  const cost = optionalFinite(rawUsage?.cost);
  const usage =
    seconds !== undefined || cost !== undefined
      ? { ...(seconds !== undefined ? { seconds } : {}), ...(cost !== undefined ? { cost } : {}) }
      : undefined;

  return {
    transcript,
    ...(language ? { language } : {}),
    ...(duration !== undefined ? { duration } : {}),
    segments,
    words,
    ...(usage ? { usage } : {}),
  };
}

export function buildMaiTranscribeRequest(audio: Buffer, language?: string) {
  const languageCode = cleanString(language).split("-")[0];
  return {
    model: MAI_TRANSCRIBE_MODEL,
    input_audio: { data: audio.toString("base64"), format: "wav" as const },
    ...(languageCode ? { language: languageCode } : {}),
    response_format: "verbose_json" as const,
    timestamp_granularities: ["segment", "word"] as const,
    provider: { options: { azure: { diarization: { enabled: true } } } },
  };
}

function boundChunkTimings(
  result: NormalizedChunkResult,
  chunkDuration: number
): NormalizedChunkResult {
  const bound = <T extends MaiTranscribeSegment | MaiTranscribeWord>(
    timing: T,
    label: "segment" | "word"
  ): T => {
    if (
      timing.start > chunkDuration + TIMESTAMP_ROUNDING_TOLERANCE_SECONDS ||
      timing.end > chunkDuration + TIMESTAMP_ROUNDING_TOLERANCE_SECONDS
    ) {
      throw new MaiTranscribeError(
        "mai_invalid_response",
        `MAI Transcribe returned a ${label} timestamp outside its audio chunk.`
      );
    }
    const start = Math.min(timing.start, chunkDuration);
    const end = Math.min(timing.end, chunkDuration);
    if (label === "segment" && end <= start) {
      throw new MaiTranscribeError(
        "mai_invalid_response",
        "MAI Transcribe returned an empty segment timestamp."
      );
    }
    return { ...timing, start, end };
  };
  return {
    ...result,
    segments: result.segments.map((item) => bound(item, "segment")),
    words: result.words.map((item) => bound(item, "word")),
  };
}

function findWavChunk(bytes: Buffer, name: string): { offset: number; size: number } | null {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkName = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + size > bytes.length) return null;
    if (chunkName === name) return { offset: dataOffset, size };
    offset = dataOffset + size + (size % 2);
  }
  return null;
}

function buildPcmWav(
  data: Buffer,
  format: { channels: number; sampleRate: number; byteRate: number; blockAlign: number; bitsPerSample: number }
): Buffer {
  const output = Buffer.allocUnsafe(44 + data.length);
  output.write("RIFF", 0);
  output.writeUInt32LE(36 + data.length, 4);
  output.write("WAVEfmt ", 8);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(format.channels, 22);
  output.writeUInt32LE(format.sampleRate, 24);
  output.writeUInt32LE(format.byteRate, 28);
  output.writeUInt16LE(format.blockAlign, 32);
  output.writeUInt16LE(format.bitsPerSample, 34);
  output.write("data", 36);
  output.writeUInt32LE(data.length, 40);
  data.copy(output, 44);
  return output;
}

export function chunkPcmWav(
  bytes: Buffer,
  options?: { maxChunkSeconds?: number }
): WavChunk[] {
  if (
    bytes.length < 44 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new MaiTranscribeError("mai_invalid_audio", "MAI Transcribe requires WAV audio.");
  }
  const fmt = findWavChunk(bytes, "fmt ");
  const data = findWavChunk(bytes, "data");
  if (!fmt || fmt.size < 16 || !data) {
    throw new MaiTranscribeError("mai_invalid_audio", "The WAV audio is malformed.");
  }
  const audioFormat = bytes.readUInt16LE(fmt.offset);
  const channels = bytes.readUInt16LE(fmt.offset + 2);
  const sampleRate = bytes.readUInt32LE(fmt.offset + 4);
  const byteRate = bytes.readUInt32LE(fmt.offset + 8);
  const blockAlign = bytes.readUInt16LE(fmt.offset + 12);
  const bitsPerSample = bytes.readUInt16LE(fmt.offset + 14);
  if (
    audioFormat !== 1 ||
    channels < 1 ||
    sampleRate < 1 ||
    byteRate < 1 ||
    blockAlign < 1 ||
    bitsPerSample !== 16 ||
    blockAlign !== channels * (bitsPerSample / 8) ||
    byteRate !== sampleRate * blockAlign ||
    data.size === 0 ||
    data.size % blockAlign !== 0
  ) {
    throw new MaiTranscribeError(
      "mai_invalid_audio",
      "MAI Transcribe requires non-empty 16-bit PCM WAV audio."
    );
  }

  const maxChunkSeconds = options?.maxChunkSeconds || DEFAULT_MAX_CHUNK_SECONDS;
  const maxRawByJson = Math.floor((MAX_JSON_REQUEST_BYTES - 4096) * 0.75) - 44;
  const durationBytes = Math.floor((byteRate * maxChunkSeconds) / blockAlign) * blockAlign;
  const maxDataBytes = Math.max(
    blockAlign,
    Math.floor(Math.min(maxRawByJson, durationBytes) / blockAlign) * blockAlign
  );
  const chunks: WavChunk[] = [];
  for (let cursor = 0; cursor < data.size; cursor += maxDataBytes) {
    const length = Math.min(maxDataBytes, data.size - cursor);
    const chunkData = bytes.subarray(data.offset + cursor, data.offset + cursor + length);
    const startTime = cursor / byteRate;
    chunks.push({
      bytes: buildPcmWav(chunkData, {
        channels,
        sampleRate,
        byteRate,
        blockAlign,
        bitsPerSample,
      }),
      startTime,
      duration: length / byteRate,
    });
  }
  return chunks;
}

function statusError(status: number): MaiTranscribeError {
  if (status === 401 || status === 403) {
    return new MaiTranscribeError("mai_auth", "OpenRouter rejected the API key.");
  }
  if (status === 402 || status === 429) {
    return new MaiTranscribeError("mai_quota", "OpenRouter quota is unavailable.");
  }
  return new MaiTranscribeError("mai_failed", `OpenRouter request failed (${status}).`);
}

function offsetSegment(segment: MaiTranscribeSegment, offset: number): MaiTranscribeSegment {
  return { ...segment, start: segment.start + offset, end: segment.end + offset };
}

function offsetWord(word: MaiTranscribeWord, offset: number): MaiTranscribeWord {
  return { ...word, start: word.start + offset, end: word.end + offset };
}

export function createMaiTranscribeService(options: ServiceOptions) {
  const fetchImpl = createGuardedFetch(options.fetch || fetch, {
    transport: "main-fetch",
    operation: "asr.mai-openrouter-legacy-service",
  });
  const timeoutMs = options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;

  const requestChunk = async (
    chunk: WavChunk,
    key: string,
    language: string | undefined,
    signal: AbortSignal | undefined
  ): Promise<NormalizedChunkResult> => {
    if (signal?.aborted) {
      throw new MaiTranscribeError("mai_cancelled", "MAI Transcribe was cancelled.");
    }
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const body = JSON.stringify(buildMaiTranscribeRequest(chunk.bytes, language));
      if (Buffer.byteLength(body) > MAX_JSON_REQUEST_BYTES) {
        throw new MaiTranscribeError(
          "mai_invalid_audio",
          "A MAI Transcribe audio chunk exceeds the 8 MB safety limit."
        );
      }
      const response = await fetchImpl(MAI_TRANSCRIBE_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body,
        signal: controller.signal,
      });
      if (!response.ok) throw statusError(response.status);
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_RESPONSE_BYTES) {
        throw new MaiTranscribeError(
          "mai_invalid_response",
          "MAI Transcribe returned an oversized response."
        );
      }
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_JSON_RESPONSE_BYTES) {
        throw new MaiTranscribeError(
          "mai_invalid_response",
          "MAI Transcribe returned an oversized response."
        );
      }
      try {
        return boundChunkTimings(
          normalizeMaiTranscribeResponse(JSON.parse(text)),
          chunk.duration
        );
      } catch (error) {
        if (error instanceof MaiTranscribeError) throw error;
        throw new MaiTranscribeError(
          "mai_invalid_response",
          "MAI Transcribe returned invalid JSON."
        );
      }
    } catch (error) {
      if (error instanceof MaiTranscribeError) throw error;
      if (timedOut) {
        throw new MaiTranscribeError("mai_timeout", "MAI Transcribe timed out.");
      }
      if (signal?.aborted) {
        throw new MaiTranscribeError("mai_cancelled", "MAI Transcribe was cancelled.");
      }
      throw new MaiTranscribeError(
        "mai_network",
        "Could not connect to OpenRouter for transcription."
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  };

  return {
    async transcribe(
      request: MaiTranscribeRequest,
      runtime: TranscribeOptions = {}
    ): Promise<MaiTranscribeResult> {
      const key = cleanString(await options.credential());
      if (!key) {
        throw new MaiTranscribeError(
          "mai_key_required",
          "An OpenRouter API key is required for MAI Transcribe."
        );
      }
      if (runtime.signal?.aborted) {
        throw new MaiTranscribeError("mai_cancelled", "MAI Transcribe was cancelled.");
      }
      let audio: Buffer;
      try {
        audio = await options.readAudio(request.audioUrl);
      } catch {
        throw new MaiTranscribeError(
          "mai_invalid_audio",
          "The audio file could not be read for MAI Transcribe."
        );
      }
      const chunks = chunkPcmWav(audio, {
        maxChunkSeconds: options.maxChunkSeconds,
      });
      const transcripts: string[] = [];
      const segments: MaiTranscribeSegment[] = [];
      const words: MaiTranscribeWord[] = [];
      let language: string | undefined;
      let usageSeconds = 0;
      let usageCost = 0;
      let hasUsageSeconds = false;
      let hasUsageCost = false;

      runtime.onProgress?.({
        jobId: request.jobId,
        completedChunks: 0,
        totalChunks: chunks.length,
        percent: 0,
      });
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        const result = await requestChunk(
          chunk,
          key,
          request.language,
          runtime.signal
        );
        if (result.transcript) transcripts.push(result.transcript);
        language ||= result.language;
        if (result.transcript && result.segments.length) {
          segments.push(...result.segments.map((item) => offsetSegment(item, chunk.startTime)));
        } else if (result.transcript) {
          segments.push({
            text: result.transcript,
            start: chunk.startTime,
            end: chunk.startTime + chunk.duration,
          });
        }
        words.push(...result.words.map((item) => offsetWord(item, chunk.startTime)));
        if (result.usage?.seconds !== undefined) {
          hasUsageSeconds = true;
          usageSeconds += result.usage.seconds;
        }
        if (result.usage?.cost !== undefined) {
          hasUsageCost = true;
          usageCost += result.usage.cost;
        }
        const completedChunks = index + 1;
        runtime.onProgress?.({
          jobId: request.jobId,
          completedChunks,
          totalChunks: chunks.length,
          percent: Math.round((completedChunks / chunks.length) * 100),
        });
      }

      const transcript = transcripts.join(" ").trim();
      if (!transcript) {
        throw new MaiTranscribeError(
          "mai_no_speech",
          "MAI Transcribe detected no speech in this audio."
        );
      }

      return {
        engine: "openrouter",
        model: MAI_TRANSCRIBE_MODEL,
        transcript,
        ...(language ? { language } : {}),
        duration: chunks.reduce((total, chunk) => total + chunk.duration, 0),
        segments,
        words,
        ...(hasUsageSeconds || hasUsageCost
          ? {
              usage: {
                ...(hasUsageSeconds ? { seconds: usageSeconds } : {}),
                ...(hasUsageCost ? { cost: usageCost } : {}),
              },
            }
          : {}),
      };
    },
  };
}
