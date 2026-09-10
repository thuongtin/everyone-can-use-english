import { createHash } from "node:crypto";
import {
  buildOpenAiTranscriptionRequest,
  normalizeOpenAiTranscriptionModel,
} from "../../lib/speech-models";
import {
  assertAllowedNetworkUrl,
  createGuardedFetch,
} from "../../lib/network-policy";
import type { LearningAsrEngine } from "../../lib/learning-asr-models";
import { assertActive, LearningAsrError } from "./errors";

export type ProviderTranscript = {
  transcript: string;
  segments: Array<{ text: string; start: number; end: number }>;
};

export type LearningAsrProvider = {
  engine: string;
  model: string;
  identity: string;
  preferWhole: boolean;
  maxWholeRequestBytes?: number;
  minRequestIntervalMs: number;
  transcribe: (
    audio: Buffer,
    options: {
      format: "wav" | "mp3";
      language: string;
      duration: number;
      signal?: AbortSignal;
    },
  ) => Promise<ProviderTranscript>;
};

export type LearningAsrProviderConfig = {
  cloudflare?: { baseUrl: string; token: string | null };
  mai?: { key: string };
  openai?: { key: string; baseUrl?: string; model: string };
  azure?: { key: string; endpoint: string; region?: string };
};

const CLOUDFLARE_MODEL = "@cf/openai/whisper-large-v3-turbo";
const MAI_MODEL = "microsoft/mai-transcribe-2";
const MAI_ENDPOINT = "https://openrouter.ai/api/v1/audio/transcriptions";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const AZURE_MAI_MODEL = "MAI-Transcribe-2";
const AZURE_SPEECH_MODEL = "azure-speech-fast";
const AZURE_TRANSCRIBE_PATH = "/speechtotext/transcriptions:transcribe?api-version=2025-10-15";
const RESPONSE_LIMIT_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 16 * 60_000;
const MAX_RETRY_AFTER_MS = 120_000;
const MAX_CLOUDFLARE_MP3_BYTES = 30_000_000;
const MAX_CLOUDFLARE_JSON_BYTES = 40_000_000;
const MAX_CLOUDFLARE_AUDIO_SECONDS = 3_601;
const MAX_MAI_JSON_BYTES = 8_000_000;
const MAX_OPENAI_AUDIO_BYTES = 25_000_000;
// The 2025-10-15 Transcribe REST contract requires audio below both limits.
const MAX_AZURE_AUDIO_BYTES = 250_000_000;
const MAX_AZURE_AUDIO_SECONDS = 2 * 60 * 60;
const TIMESTAMP_TOLERANCE_SECONDS = 0.25;

type TranscribeOptions = Parameters<LearningAsrProvider["transcribe"]>[1];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fail(
  code: ConstructorParameters<typeof LearningAsrError>[0],
  message: string,
  retryAfterMs?: number,
): never {
  throw new LearningAsrError(code, message, undefined, retryAfterMs);
}

function identityFor(value: Record<string, unknown>): string {
  return `learning-asr:${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32)}`;
}

function normalizeHttpsUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return fail("asr_failed", `${label} endpoint is invalid.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    return fail("asr_failed", `${label} endpoint must be a secure HTTPS URL.`);
  }
  url.hostname = url.hostname.toLowerCase();
  return url;
}

function normalizeCloudflareBaseUrl(value: string): string {
  const url = normalizeHttpsUrl(value, "Cloudflare Worker");
  if (
    !url.hostname.endsWith(".workers.dev") ||
    url.hostname === ".workers.dev" ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    return fail("asr_failed", "Cloudflare Worker endpoint must be a workers.dev root URL.");
  }
  return `https://${url.hostname}`;
}

function normalizeOpenAiBaseUrl(value?: string): string {
  const url = normalizeHttpsUrl(value || DEFAULT_OPENAI_BASE_URL, "OpenAI");
  assertAllowedNetworkUrl(url, {
    transport: "main-fetch",
    operation: "asr.openai",
  });
  const pathname = url.pathname.replace(/\/+$/u, "");
  return `${url.origin}${pathname}`;
}

function normalizeAzureEndpoint(value: string): string {
  const url = normalizeHttpsUrl(value, "Azure Speech");
  if (
    !url.hostname.endsWith(".cognitiveservices.azure.com") ||
    url.hostname === "cognitiveservices.azure.com" ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    return fail(
      "asr_failed",
      "Azure Speech endpoint must be a cognitiveservices.azure.com resource root URL.",
    );
  }
  assertAllowedNetworkUrl(url, {
    transport: "main-fetch",
    operation: "asr.azure-speech",
  });
  return `https://${url.hostname}`;
}

function credential(value: unknown, provider: string): string {
  const key = cleanString(value);
  if (!key) fail("asr_auth", `${provider} credentials are required.`);
  return key;
}

function validateRequest(audio: Buffer, options: TranscribeOptions): string {
  if (!Buffer.isBuffer(audio) || audio.length === 0) {
    fail("asr_invalid_audio", "Transcription audio is empty or invalid.");
  }
  if (!options || (options.format !== "wav" && options.format !== "mp3")) {
    fail("asr_invalid_audio", "Transcription audio format is invalid.");
  }
  if (!Number.isFinite(options.duration) || options.duration <= 0) {
    fail("asr_invalid_audio", "Transcription audio duration is invalid.");
  }
  const language = cleanString(options.language).split("-")[0].toLowerCase();
  if (language && !/^[a-z]{2,3}$/u.test(language)) {
    fail("asr_invalid_audio", "Transcription language is invalid.");
  }
  return language;
}

function azureLocale(value: string, engine: "azure_mai" | "azure_speech"): string {
  const language = cleanString(value);
  if (!language) return "";
  if (!/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/u.test(language)) {
    return fail("asr_invalid_audio", "Transcription language is invalid.");
  }
  if (engine === "azure_mai") return language.split("-")[0].toLowerCase();
  try {
    const locale = new Intl.Locale(language);
    if (locale.region) return locale.toString();
    const region = locale.maximize().region;
    if (!region) return fail("asr_invalid_audio", "Transcription locale requires a region.");
    return [locale.language, locale.script, region].filter(Boolean).join("-");
  } catch {
    return fail("asr_invalid_audio", "Transcription language is invalid.");
  }
}

function retryAfterMs(response: Response): number | undefined {
  const value = cleanString(response.headers.get("retry-after"));
  if (!value) return undefined;
  const seconds = Number(value);
  let milliseconds: number;
  if (Number.isFinite(seconds) && seconds >= 0) {
    milliseconds = seconds * 1_000;
  } else {
    const date = Date.parse(value);
    if (!Number.isFinite(date)) return undefined;
    milliseconds = Math.max(0, date - Date.now());
  }
  return Math.min(MAX_RETRY_AFTER_MS, Math.ceil(milliseconds));
}

function throwStatus(response: Response, provider: string): never {
  if (response.status === 401 || response.status === 403) {
    return fail("asr_auth", `${provider} authorization was rejected.`);
  }
  if (response.status === 402) {
    return fail("asr_quota", `${provider} quota is unavailable.`);
  }
  if (response.status === 429) {
    return fail(
      "asr_rate_limit",
      `${provider} is rate limited.`,
      retryAfterMs(response),
    );
  }
  if (response.status === 408 || response.status === 504) {
    return fail("asr_timeout", `${provider} transcription timed out.`);
  }
  if (response.status >= 500) {
    return fail("asr_network", `${provider} transcription service is unavailable.`);
  }
  if (response.status === 400 || response.status === 413 || response.status === 415) {
    return fail("asr_invalid_audio", `${provider} rejected the audio request.`);
  }
  return fail("asr_failed", `${provider} transcription request failed.`);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > RESPONSE_LIMIT_BYTES) {
      fail("asr_invalid_response", "Transcription provider returned an oversized response.");
    }
  }
  if (!response.body) {
    fail("asr_invalid_response", "Transcription provider returned an empty response.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > RESPONSE_LIMIT_BYTES) {
        await reader.cancel("response too large");
        fail("asr_invalid_response", "Transcription provider returned an oversized response.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } catch {
    return fail("asr_invalid_response", "Transcription provider returned invalid JSON.");
  }
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  provider: string,
  timeoutMs = 90_000,
): Promise<unknown> {
  assertActive(signal);
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...init,
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throwStatus(response, provider);
    return await readBoundedJson(response);
  } catch (error) {
    if (error instanceof LearningAsrError) throw error;
    if (signal?.aborted) {
      return fail("asr_cancelled", "Transcription cancelled.");
    }
    if (timedOut) {
      return fail("asr_timeout", `${provider} transcription timed out.`);
    }
    return fail("asr_network", `Could not connect to ${provider}.`);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}

export function validateProviderTranscript(
  value: unknown,
  duration?: number,
): ProviderTranscript {
  const result = asRecord(value);
  if (!result || typeof result.transcript !== "string") {
    return fail("asr_invalid_response", "Transcription provider returned invalid text.");
  }
  const transcript = result.transcript.trim();
  if (!transcript) {
    return fail("asr_no_speech", "Transcription provider detected no speech.");
  }
  if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) {
    return fail("asr_invalid_response", "Transcription duration is invalid.");
  }
  if (result.segments !== undefined && !Array.isArray(result.segments)) {
    return fail("asr_invalid_response", "Transcription provider returned invalid segments.");
  }

  const rawSegments = Array.isArray(result.segments) ? result.segments : [];
  if (rawSegments.length > 10_000) {
    return fail("asr_invalid_response", "Transcription provider returned too many segments.");
  }
  const segments: ProviderTranscript["segments"] = [];
  let previousStart = -1;
  for (const raw of rawSegments) {
    const segment = asRecord(raw);
    const text = cleanString(segment?.text);
    const start = segment?.start;
    const end = segment?.end;
    if (
      !text ||
      typeof start !== "number" ||
      !Number.isFinite(start) ||
      typeof end !== "number" ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      start < previousStart ||
      (duration !== undefined && (
        start > duration ||
        end > duration + TIMESTAMP_TOLERANCE_SECONDS
      ))
    ) {
      return fail("asr_invalid_response", "Transcription provider returned invalid segments.");
    }
    previousStart = start;
    segments.push({ text, start, end: duration === undefined ? end : Math.min(end, duration) });
  }
  return { transcript, segments };
}

function cloudflareProvider(
  config: LearningAsrProviderConfig["cloudflare"],
  fetchImpl: typeof fetch,
): LearningAsrProvider {
  if (!config) fail("asr_failed", "Cloudflare Worker configuration is required.");
  const baseUrl = normalizeCloudflareBaseUrl(config.baseUrl);
  assertAllowedNetworkUrl(baseUrl, {
    transport: "main-fetch",
    operation: "asr.cloudflare-worker",
  });
  const providerFetch = createGuardedFetch(fetchImpl, {
    transport: "main-fetch",
    operation: "asr.cloudflare-worker",
  });
  const token = config.token;
  return {
    engine: "cloudflare_workers_ai",
    model: CLOUDFLARE_MODEL,
    identity: identityFor({
      engine: "cloudflare_workers_ai",
      model: CLOUDFLARE_MODEL,
      endpoint: baseUrl,
      transports: ["audio/mpeg", "json-base64-wav"],
    }),
    preferWhole: true,
    minRequestIntervalMs: 0,
    async transcribe(audio, options) {
      const language = validateRequest(audio, options);
      if (options.duration > MAX_CLOUDFLARE_AUDIO_SECONDS) {
        fail("asr_invalid_audio", "Cloudflare audio exceeds the duration limit.");
      }
      const headers: Record<string, string> = {
        Authorization: `Bearer ${credential(token, "Cloudflare Worker")}`,
      };
      let body: Buffer | string;
      if (options.format === "mp3") {
        if (audio.length > MAX_CLOUDFLARE_MP3_BYTES) {
          fail("asr_invalid_audio", "Cloudflare MP3 audio exceeds the request limit.");
        }
        headers["Content-Type"] = "audio/mpeg";
        if (language) headers["X-Audio-Language"] = language;
        body = audio;
      } else {
        body = JSON.stringify({
          audio: audio.toString("base64"),
          ...(language ? { language } : {}),
        });
        if (Buffer.byteLength(body) > MAX_CLOUDFLARE_JSON_BYTES) {
          fail("asr_invalid_audio", "Cloudflare WAV audio exceeds the request limit.");
        }
        headers["Content-Type"] = "application/json";
      }
      const envelope = asRecord(await fetchJson(
        providerFetch,
        `${baseUrl}/v1/transcriptions`,
        { method: "POST", headers, body },
        options.signal,
        "Cloudflare Worker",
        options.duration > 120 ? REQUEST_TIMEOUT_MS : 90_000,
      ));
      const result = asRecord(envelope?.result);
      if (!envelope || envelope.ok !== true || !result) {
        fail("asr_invalid_response", "Cloudflare Worker returned an invalid response.");
      }
      return validateProviderTranscript({
        transcript: result.text,
        segments: result.segments,
      }, options.duration);
    },
  };
}

function maiProvider(
  config: LearningAsrProviderConfig["mai"],
  fetchImpl: typeof fetch,
): LearningAsrProvider {
  if (!config) fail("asr_failed", "MAI Transcribe configuration is required.");
  const key = config.key;
  assertAllowedNetworkUrl(MAI_ENDPOINT, {
    transport: "main-fetch",
    operation: "asr.mai-openrouter",
  });
  const providerFetch = createGuardedFetch(fetchImpl, {
    transport: "main-fetch",
    operation: "asr.mai-openrouter",
  });
  return {
    engine: "mai_transcribe",
    model: MAI_MODEL,
    identity: identityFor({
      engine: "mai_transcribe",
      model: MAI_MODEL,
      endpoint: MAI_ENDPOINT,
      responseFormat: "verbose_json",
      timestamps: ["segment", "word"],
      provider: "azure-diarization",
    }),
    preferWhole: false,
    minRequestIntervalMs: 7_000,
    async transcribe(audio, options) {
      const language = validateRequest(audio, options);
      const body = JSON.stringify({
        model: MAI_MODEL,
        input_audio: { data: audio.toString("base64"), format: options.format },
        ...(language ? { language } : {}),
        response_format: "verbose_json",
        timestamp_granularities: ["segment", "word"],
        provider: { options: { azure: { diarization: { enabled: true } } } },
      });
      if (Buffer.byteLength(body) > MAX_MAI_JSON_BYTES) {
        fail("asr_invalid_audio", "MAI Transcribe audio exceeds the request limit.");
      }
      const response = asRecord(await fetchJson(
        providerFetch,
        MAI_ENDPOINT,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${credential(key, "MAI Transcribe")}`,
            "Content-Type": "application/json",
          },
          body,
        },
        options.signal,
        "MAI Transcribe",
      ));
      return validateProviderTranscript({
        transcript: response?.text,
        segments: response?.segments,
      }, options.duration);
    },
  };
}

function azureTranscript(value: unknown, duration: number): ProviderTranscript {
  const response = asRecord(value);
  if (
    !response ||
    !Array.isArray(response.combinedPhrases) ||
    !Array.isArray(response.phrases) ||
    response.combinedPhrases.length > 1_000 ||
    response.phrases.length > 10_000
  ) {
    return fail("asr_invalid_response", "Azure Speech returned an invalid response.");
  }

  const combinedText: string[] = [];
  for (const raw of response.combinedPhrases) {
    const phrase = asRecord(raw);
    if (!phrase || typeof phrase.text !== "string") {
      return fail("asr_invalid_response", "Azure Speech returned invalid combined phrases.");
    }
    const text = cleanString(phrase.text);
    if (text) combinedText.push(text);
  }

  const segments: ProviderTranscript["segments"] = [];
  for (const raw of response.phrases) {
    const phrase = asRecord(raw);
    const text = cleanString(phrase?.text);
    const offsetMilliseconds = phrase?.offsetMilliseconds;
    const durationMilliseconds = phrase?.durationMilliseconds;
    if (
      !text ||
      typeof offsetMilliseconds !== "number" ||
      !Number.isSafeInteger(offsetMilliseconds) ||
      offsetMilliseconds < 0 ||
      typeof durationMilliseconds !== "number" ||
      !Number.isSafeInteger(durationMilliseconds) ||
      durationMilliseconds <= 0
    ) {
      return fail("asr_invalid_response", "Azure Speech returned invalid phrase timings.");
    }
    segments.push({
      text,
      start: offsetMilliseconds / 1_000,
      end: (offsetMilliseconds + durationMilliseconds) / 1_000,
    });
  }

  return validateProviderTranscript({
    transcript: combinedText.join(" "),
    segments,
  }, duration);
}

function azureProvider(
  engine: "azure_mai" | "azure_speech",
  config: LearningAsrProviderConfig["azure"],
  fetchImpl: typeof fetch,
): LearningAsrProvider {
  if (!config) fail("asr_failed", "Azure Speech configuration is required.");
  const endpoint = normalizeAzureEndpoint(config.endpoint);
  const key = credential(config.key, "Azure Speech");
  const model = engine === "azure_mai" ? AZURE_MAI_MODEL : AZURE_SPEECH_MODEL;
  const providerFetch = createGuardedFetch(fetchImpl, {
    transport: "main-fetch",
    operation: "asr.azure-speech",
  });
  return {
    engine,
    model,
    identity: identityFor({
      engine,
      model,
      endpoint,
      apiVersion: "2025-10-15",
      timing: engine === "azure_mai" ? "word" : "default",
    }),
    preferWhole: true,
    maxWholeRequestBytes: MAX_AZURE_AUDIO_BYTES,
    minRequestIntervalMs: 0,
    async transcribe(audio, options) {
      validateRequest(audio, options);
      const language = azureLocale(options.language, engine);
      if (audio.length >= MAX_AZURE_AUDIO_BYTES) {
        fail("asr_invalid_audio", "Azure Speech audio exceeds the upload size limit.");
      }
      if (options.duration >= MAX_AZURE_AUDIO_SECONDS) {
        fail("asr_invalid_audio", "Azure Speech audio exceeds the duration limit.");
      }

      const mimeType = options.format === "wav" ? "audio/wav" : "audio/mpeg";
      const form = new FormData();
      form.append(
        "audio",
        new Blob([new Uint8Array(audio)], { type: mimeType }),
        `audio.${options.format}`,
      );
      const definition = engine === "azure_mai"
        ? {
            ...(language ? { locales: [language] } : {}),
            enhancedMode: {
              enabled: true,
              model: AZURE_MAI_MODEL,
              modelOptions: { timestamps: "word" },
            },
          }
        : { ...(language ? { locales: [language] } : {}) };
      form.append("definition", JSON.stringify(definition));

      const response = await fetchJson(
        providerFetch,
        `${endpoint}${AZURE_TRANSCRIBE_PATH}`,
        {
          method: "POST",
          headers: { "Ocp-Apim-Subscription-Key": key },
          body: form,
        },
        options.signal,
        "Azure Speech",
        options.duration > 120 ? REQUEST_TIMEOUT_MS : 90_000,
      );
      return azureTranscript(response, options.duration);
    },
  };
}

function openAiProvider(
  config: LearningAsrProviderConfig["openai"],
  fetchImpl: typeof fetch,
): LearningAsrProvider {
  if (!config) fail("asr_failed", "OpenAI configuration is required.");
  let model: ReturnType<typeof normalizeOpenAiTranscriptionModel>;
  try {
    model = normalizeOpenAiTranscriptionModel(config.model);
  } catch {
    return fail("asr_model_unsupported", "Configured OpenAI transcription model is unsupported.");
  }
  const baseUrl = normalizeOpenAiBaseUrl(config.baseUrl);
  const endpoint = `${baseUrl}/audio/transcriptions`;
  const key = config.key;
  const providerFetch = createGuardedFetch(fetchImpl, {
    transport: "main-fetch",
    operation: "asr.openai",
  });
  return {
    engine: "openai",
    model,
    identity: identityFor({
      engine: "openai",
      model,
      endpoint,
      responseFormat: model === "whisper-1" ? "verbose_json" : "json",
    }),
    preferWhole: model === "whisper-1",
    maxWholeRequestBytes: MAX_OPENAI_AUDIO_BYTES,
    minRequestIntervalMs: 0,
    async transcribe(audio, options) {
      validateRequest(audio, options);
      if (audio.length > MAX_OPENAI_AUDIO_BYTES) {
        fail("asr_invalid_audio", "OpenAI audio exceeds the upload size limit.");
      }
      const mimeType = options.format === "wav" ? "audio/wav" : "audio/mpeg";
      const file = new Blob([new Uint8Array(audio)], { type: mimeType });
      const request = buildOpenAiTranscriptionRequest({
        file,
        model,
        language: options.language,
      });
      const form = new FormData();
      form.append("file", request.file, `audio.${options.format}`);
      form.append("model", request.model);
      form.append("response_format", request.response_format);
      if (request.language) form.append("language", request.language);
      if ("timestamp_granularities" in request) {
        for (const granularity of request.timestamp_granularities) {
          form.append("timestamp_granularities[]", granularity);
        }
      }
      const response = asRecord(await fetchJson(
        providerFetch,
        endpoint,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${credential(key, "OpenAI")}` },
          body: form,
        },
        options.signal,
        "OpenAI",
      ));
      return validateProviderTranscript({
        transcript: response?.text,
        segments: response?.segments,
      }, options.duration);
    },
  };
}

export function createLearningAsrProvider(
  service: LearningAsrEngine,
  config: LearningAsrProviderConfig,
  fetchImpl: typeof fetch = fetch,
): LearningAsrProvider {
  if (service === "cloudflare_workers_ai") {
    return cloudflareProvider(config.cloudflare, fetchImpl);
  }
  if (service === "mai_transcribe") {
    return maiProvider(config.mai, fetchImpl);
  }
  if (service === "openai") {
    return openAiProvider(config.openai, fetchImpl);
  }
  if (service === "azure_mai" || service === "azure_speech") {
    return azureProvider(service, config.azure, fetchImpl);
  }
  return fail("asr_model_unsupported", "Configured transcription engine is unsupported.");
}
