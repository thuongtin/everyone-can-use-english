export const OPENAI_TTS_MODELS = [
  "tts-1",
  "tts-1-hd",
  "gpt-4o-mini-tts",
] as const;

export const ENJOYAI_TTS_MODELS = ["tts-1", "tts-1-hd"] as const;

export const OPENAI_TTS_VOICES = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
] as const;

export const OPENAI_TRANSCRIPTION_MODELS = [
  "whisper-1",
  "gpt-transcribe",
] as const;

export const OPENAI_TTS_RESPONSE_FORMAT = "mp3" as const;

type OpenAiTtsModel = (typeof OPENAI_TTS_MODELS)[number];
type OpenAiTtsVoice = (typeof OPENAI_TTS_VOICES)[number];
export type OpenAiTranscriptionModel =
  (typeof OPENAI_TRANSCRIPTION_MODELS)[number];

export type TtsProvider = "openai" | "azure";

export type ResolvedTtsModel = {
  engine: "openai" | "azure";
  provider: TtsProvider;
  model: string;
  apiModel?: OpenAiTtsModel;
};

export type OpenAiSpeechRequest = {
  input: string;
  model: OpenAiTtsModel;
  voice: OpenAiTtsVoice;
  response_format: typeof OPENAI_TTS_RESPONSE_FORMAT;
};

export type OpenAiWhisperTranscriptionRequest<TFile = unknown> = {
  file: TFile;
  model: "whisper-1";
  response_format: "verbose_json";
  timestamp_granularities: ["word", "segment"];
  language?: string;
};

export type OpenAiGptTranscriptionRequest<TFile = unknown> = {
  file: TFile;
  model: "gpt-transcribe";
  response_format: "json";
  language?: string;
};

export type OpenAiTranscriptionRequest<TFile = unknown> =
  | OpenAiWhisperTranscriptionRequest<TFile>
  | OpenAiGptTranscriptionRequest<TFile>;

export type OpenAiWordTiming = {
  word: string;
  start: number;
  end: number;
};

export type OpenAiSegmentTiming = {
  text: string;
  start: number;
  end: number;
};

export type NormalizedOpenAiTranscription = {
  transcript: string;
  segments: OpenAiSegmentTiming[];
  words?: OpenAiWordTiming[];
};

export function selectCanonicalOpenAiConfig<T>(
  canonicalConfig: T | null | undefined,
  readLegacyConfig: () => T | null | undefined
): T | null | undefined {
  return canonicalConfig === null || canonicalConfig === undefined
    ? readLegacyConfig()
    : canonicalConfig;
}

const OPENAI_MODEL_PREFIX = "openai/";
const AZURE_MODEL = "azure/speech";

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeSpeechModel(model: unknown): string {
  const value = asTrimmedString(model);
  if (!value) return "";

  if (value.toLowerCase().startsWith(OPENAI_MODEL_PREFIX)) {
    return value.slice(OPENAI_MODEL_PREFIX.length).trim().toLowerCase();
  }

  return value.toLowerCase();
}

export function normalizeSpeechEngine(engine: unknown): string {
  return asTrimmedString(engine).toLowerCase();
}

function normalizeAzureModel(model: unknown): string {
  const value = asTrimmedString(model).toLowerCase();
  return value === AZURE_MODEL || value === "azure" ? AZURE_MODEL : value;
}

export function resolveTtsModel(
  engine: unknown,
  model: unknown
): ResolvedTtsModel {
  const normalizedEngine = normalizeSpeechEngine(engine);
  const rawModel = asTrimmedString(model);
  if (!rawModel) {
    throw new Error("TTS model is required.");
  }

  if (normalizedEngine === "openai") {
    const normalizedModel = normalizeSpeechModel(rawModel);
    if (
      !OPENAI_TTS_MODELS.includes(
        normalizedModel as (typeof OPENAI_TTS_MODELS)[number]
      )
    ) {
      throw new Error(
        `TTS model "${rawModel}" is not supported by the direct OpenAI speech endpoint.`
      );
    }

    return {
      engine: "openai",
      provider: "openai",
      model: normalizedModel,
      apiModel: normalizedModel as OpenAiTtsModel,
    };
  }

  if (normalizedEngine === "azure" && normalizeAzureModel(rawModel) === AZURE_MODEL) {
    return {
      engine: "azure",
      provider: "azure",
      model: AZURE_MODEL,
    };
  }

  throw new Error(`TTS engine "${asTrimmedString(engine)}" is not supported.`);
}

/** Parse-only compatibility for historical speech metadata. Never returns an executable provider. */
export function isLegacyEnjoyTtsBinding(engine: unknown, model: unknown): boolean {
  if (normalizeSpeechEngine(engine) !== "enjoyai") return false;
  const normalized = normalizeSpeechModel(model);
  return normalizeAzureModel(model) === AZURE_MODEL || ENJOYAI_TTS_MODELS.includes(
    normalized as (typeof ENJOYAI_TTS_MODELS)[number]
  );
}

function validateText(
  text: unknown,
  model: string,
  options?: { maxCharacters?: number }
): string {
  const value = asTrimmedString(text);
  if (!value) {
    throw new Error("TTS text must not be empty.");
  }

  // Keep a local character guard for a responsive UX. It is not a token-count
  // guarantee, so the provider remains authoritative for the gpt-4o-mini-tts
  // 2,000-token limit without adding a tokenizer to the desktop bundle.
  const maxCharacters = options?.maxCharacters;
  if (maxCharacters && Array.from(value).length > maxCharacters) {
    throw new Error(
      `TTS text is too long for model "${model}" (local maximum ${maxCharacters} characters).`
    );
  }

  return text as string;
}

function validateOpenAiVoice(voice: unknown): OpenAiTtsVoice {
  const normalizedVoice = asTrimmedString(voice).toLowerCase();
  if (!normalizedVoice) {
    throw new Error("TTS voice is required.");
  }

  if (
    !OPENAI_TTS_VOICES.includes(
      normalizedVoice as (typeof OPENAI_TTS_VOICES)[number]
    )
  ) {
    throw new Error(`TTS voice "${asTrimmedString(voice)}" is not supported by OpenAI.`);
  }

  return normalizedVoice as OpenAiTtsVoice;
}

function validateAzureVoice(voice: unknown): string {
  const value = asTrimmedString(voice);
  if (!value) {
    throw new Error("TTS voice is required.");
  }

  if (!/^[a-z]{2,3}-[A-Z]{2,3}-[A-Za-z0-9]+Neural\d*$/u.test(value)) {
    throw new Error(`TTS voice "${value}" is not a supported Azure voice.`);
  }

  return value;
}

export function buildOpenAiSpeechRequest(params: {
  engine: unknown;
  model: unknown;
  voice: unknown;
  text: unknown;
}): OpenAiSpeechRequest {
  const resolved = resolveTtsModel(params.engine, params.model);
  if (resolved.provider !== "openai" || !resolved.apiModel) {
    throw new Error(
      `TTS model "${asTrimmedString(params.model)}" is not an OpenAI speech model.`
    );
  }

  return {
    input: validateText(params.text, resolved.apiModel, { maxCharacters: 4096 }),
    model: resolved.apiModel,
    voice: validateOpenAiVoice(params.voice),
    response_format: OPENAI_TTS_RESPONSE_FORMAT,
  };
}

export function validateAzureTtsInput(params: {
  model: unknown;
  voice: unknown;
  text: unknown;
}): { model: typeof AZURE_MODEL; voice: string; text: string } {
  const model = normalizeAzureModel(params.model);
  if (model !== AZURE_MODEL) {
    throw new Error(`TTS model "${asTrimmedString(params.model)}" is not supported by Azure.`);
  }

  return {
    model: AZURE_MODEL,
    voice: validateAzureVoice(params.voice),
    text: validateText(params.text, AZURE_MODEL),
  };
}

export function normalizeOpenAiTranscriptionModel(
  model: unknown
): OpenAiTranscriptionModel {
  const value = asTrimmedString(model).toLowerCase();
  if (!value) return "whisper-1";

  if (
    !OPENAI_TRANSCRIPTION_MODELS.includes(
      value as (typeof OPENAI_TRANSCRIPTION_MODELS)[number]
    )
  ) {
    throw new Error(`OpenAI transcription model "${asTrimmedString(model)}" is not supported.`);
  }

  return value as OpenAiTranscriptionModel;
}

export function buildOpenAiTranscriptionRequest<TFile>(params: {
  file: TFile;
  model?: unknown;
  language?: unknown;
}): OpenAiTranscriptionRequest<TFile> {
  const language = asTrimmedString(params.language).split("-")[0];
  const model = normalizeOpenAiTranscriptionModel(params.model);
  if (model === "gpt-transcribe") {
    return {
      file: params.file,
      model,
      response_format: "json",
      ...(language ? { language } : {}),
    };
  }
  return {
    file: params.file,
    model,
    response_format: "verbose_json",
    timestamp_granularities: ["word", "segment"],
    ...(language ? { language } : {}),
  };
}

export function normalizeOpenAiTranscriptionResponse(
  response: unknown
): NormalizedOpenAiTranscription {
  const value = response as {
    text?: unknown;
    words?: unknown;
    segments?: unknown;
  } | null;
  if (typeof value?.text !== "string" || !value.text.trim()) {
    throw new Error("OpenAI transcription returned no text.");
  }

  const segments = Array.isArray(value.segments)
    ? value.segments.filter((segment): segment is OpenAiSegmentTiming => {
        if (!segment || typeof segment !== "object") return false;
        const item = segment as Partial<OpenAiSegmentTiming>;
        return (
          typeof item.text === "string" &&
          item.text.trim().length > 0 &&
          Number.isFinite(item.start) &&
          Number.isFinite(item.end) &&
          item.end >= item.start
        );
      })
    : [];
  const words = Array.isArray(value.words)
    ? value.words.filter((word): word is OpenAiWordTiming => {
        if (!word || typeof word !== "object") return false;
        const item = word as Partial<OpenAiWordTiming>;
        return (
          typeof item.word === "string" &&
          Number.isFinite(item.start) &&
          Number.isFinite(item.end) &&
          item.end >= item.start
        );
      })
    : undefined;

  return {
    transcript: value.text,
    segments,
    words: words?.length ? words : undefined,
  };
}

export function ensureAudioArrayBuffer(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) {
    if (value.byteLength === 0) {
      throw new Error("TTS provider returned empty audio.");
    }
    return value;
  }

  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (bytes.byteLength === 0) {
      throw new Error("TTS provider returned empty audio.");
    }
    return bytes.slice().buffer;
  }

  throw new Error("TTS provider returned invalid audio.");
}

export function sanitizeSpeechError(error: unknown, secret?: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const redacted = secret ? message.split(secret).join("[redacted]") : message;
  return redacted.length > 240 ? `${redacted.slice(0, 237)}...` : redacted;
}
