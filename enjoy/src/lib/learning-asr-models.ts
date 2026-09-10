export const LEARNING_ASR_ENGINES = [
  "cloudflare_workers_ai",
  "mai_transcribe",
  "openai",
  "azure_mai",
  "azure_speech",
] as const;

export const LOCAL_ASR_ENGINE = "local" as const;
export const LEGACY_ASR_ENGINES = ["enjoy_azure", "enjoy_cloudflare"] as const;

export type LearningAsrEngine = (typeof LEARNING_ASR_ENGINES)[number];

export type LearningAsrEngineCapability = Readonly<{
  model: "@cf/openai/whisper-large-v3-turbo" | "microsoft/mai-transcribe-2" | "configured" | "MAI-Transcribe-2" | "azure-speech-fast";
  structuredTiming: "segment" | "word-and-segment" | "model-dependent";
  longAudioPolicy: "direct-first" | "chunked" | "provider-limited";
}>;

export const LEARNING_ASR_ENGINE_CAPABILITIES: Readonly<
  Record<LearningAsrEngine, LearningAsrEngineCapability>
> = Object.freeze({
  azure_mai: Object.freeze({
    model: "MAI-Transcribe-2",
    structuredTiming: "word-and-segment",
    longAudioPolicy: "provider-limited",
  }),
  azure_speech: Object.freeze({
    model: "azure-speech-fast",
    structuredTiming: "word-and-segment",
    longAudioPolicy: "provider-limited",
  }),
  cloudflare_workers_ai: Object.freeze({
    model: "@cf/openai/whisper-large-v3-turbo",
    structuredTiming: "segment",
    longAudioPolicy: "direct-first",
  }),
  mai_transcribe: Object.freeze({
    model: "microsoft/mai-transcribe-2",
    structuredTiming: "word-and-segment",
    longAudioPolicy: "chunked",
  }),
  openai: Object.freeze({
    model: "configured",
    structuredTiming: "model-dependent",
    longAudioPolicy: "provider-limited",
  }),
});

export function isLearningAsrEngine(value: unknown): value is LearningAsrEngine {
  return (
    typeof value === "string" &&
    LEARNING_ASR_ENGINES.includes(value as LearningAsrEngine)
  );
}

/**
 * Resolves legacy UI state without writing it back to user settings.
 * Model capability describes the adapter contract, not transcript accuracy.
 */
export function resolveLearningAsrEngine(value: unknown): LearningAsrEngine | null {
  return isLearningAsrEngine(value) ? value : null;
}
