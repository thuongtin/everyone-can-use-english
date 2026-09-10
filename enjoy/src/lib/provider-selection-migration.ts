import {
  isSupportedProvider,
  PROVIDER_SELECTION_REQUIRED,
} from "./ai-providers";
import { resolveTtsModel } from "./speech-models";
import { isLearningAsrEngine } from "./learning-asr-models";

export const PROVIDER_SELECTION_MIGRATION_VERSION = 1 as const;
export { PROVIDER_SELECTION_REQUIRED };

export function createProviderSelectionRequiredTtsConfig(language = "") {
  return {
    engine: PROVIDER_SELECTION_REQUIRED,
    model: "",
    voice: "",
    language,
  };
}

export type ProviderSelectionRequestToken = Readonly<{
  generation: number;
  scope: string;
}>;

export function createProviderSelectionRequestGuard() {
  let current: ProviderSelectionRequestToken = { generation: 0, scope: "" };
  return {
    activate(scope: string): ProviderSelectionRequestToken {
      if (scope !== current.scope) {
        current = { generation: current.generation + 1, scope };
      }
      return current;
    },
    capture(): ProviderSelectionRequestToken {
      return current;
    },
    isCurrent(token: ProviderSelectionRequestToken): boolean {
      return token.generation === current.generation && token.scope === current.scope;
    },
    invalidate(token: ProviderSelectionRequestToken): void {
      if (token.generation === current.generation && token.scope === current.scope) {
        current = { generation: current.generation + 1, scope: current.scope };
      }
    },
  };
}

export type ProviderSelectionState<T> =
  | Readonly<{ status: "unconfigured" }>
  | Readonly<{ status: "configured"; value: T }>
  | Readonly<{
      status: "needs-selection";
      reason: "legacy-provider" | "unsupported-provider" | "selection-required";
    }>
  | Readonly<{
      status: "invalid-configuration";
      reason: "model-required" | "model-or-voice-invalid";
    }>;

type RecordValue = Record<string, unknown>;

export type TextProviderBinding = RecordValue & {
  name: string;
  models: RecordValue & { default?: unknown };
};

export type SynthesisProviderBinding = RecordValue & {
  engine: string;
  model?: unknown;
  voice?: unknown;
};

export type ProviderSelectionMigrationInput = Readonly<{
  gptEngine?: unknown;
  sttEngine?: unknown;
  ttsConfig?: unknown;
}>;

export type ProviderSelectionMigrationPlan = Readonly<{
  version: typeof PROVIDER_SELECTION_MIGRATION_VERSION;
  backup: ProviderSelectionMigrationInput;
  updates: Readonly<{
    gptEngine?: TextProviderBinding;
    sttEngine?: typeof PROVIDER_SELECTION_REQUIRED;
    ttsConfig?: SynthesisProviderBinding;
  }>;
}>;

export type ProviderSelectionMigrationRecord = Readonly<{
  version: typeof PROVIDER_SELECTION_MIGRATION_VERSION;
  status: "prepared" | "completed" | "restored";
  backup: ProviderSelectionMigrationInput;
  updates: ProviderSelectionMigrationPlan["updates"];
}>;

const isRecord = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const clean = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const isLegacyTextProvider = (value: string): boolean => value === "enjoyai";

const isLegacyTranscriptionProvider = (value: string): boolean =>
  value === "enjoy_azure" || value === "enjoy_cloudflare";

export function resolveTextProviderSelection(
  value: unknown,
): ProviderSelectionState<TextProviderBinding> {
  if (value === null || value === undefined || value === "") {
    return { status: "unconfigured" };
  }
  if (!isRecord(value)) {
    return { status: "needs-selection", reason: "unsupported-provider" };
  }
  const name = clean(value.name);
  if (name === PROVIDER_SELECTION_REQUIRED) {
    return { status: "needs-selection", reason: "selection-required" };
  }
  if (isLegacyTextProvider(name)) {
    return { status: "needs-selection", reason: "legacy-provider" };
  }
  if (!isSupportedProvider(name)) {
    return { status: "needs-selection", reason: "unsupported-provider" };
  }
  if (!isRecord(value.models)) {
    return { status: "invalid-configuration", reason: "model-required" };
  }
  const defaultModel = clean(value.models.default);
  if (name !== "codex-acp" && name !== "claude-acp" && !defaultModel) {
    return { status: "invalid-configuration", reason: "model-required" };
  }
  return { status: "configured", value: value as TextProviderBinding };
}

export function resolveTranscriptionProviderSelection(
  value: unknown,
): ProviderSelectionState<string> {
  if (value === null || value === undefined || value === "") {
    return { status: "unconfigured" };
  }
  const engine = clean(value);
  if (engine === PROVIDER_SELECTION_REQUIRED) {
    return { status: "needs-selection", reason: "selection-required" };
  }
  if (isLegacyTranscriptionProvider(engine)) {
    return { status: "needs-selection", reason: "legacy-provider" };
  }
  if (engine === "local" || isLearningAsrEngine(engine)) {
    return { status: "configured", value: engine };
  }
  return { status: "needs-selection", reason: "unsupported-provider" };
}

export function resolveSynthesisProviderSelection(
  value: unknown,
): ProviderSelectionState<SynthesisProviderBinding> {
  if (value === null || value === undefined || value === "") {
    return { status: "unconfigured" };
  }
  if (!isRecord(value)) {
    return { status: "needs-selection", reason: "unsupported-provider" };
  }
  const engine = clean(value.engine);
  if (engine === PROVIDER_SELECTION_REQUIRED) {
    return { status: "needs-selection", reason: "selection-required" };
  }
  if (engine === "enjoyai") {
    return { status: "needs-selection", reason: "legacy-provider" };
  }
  if (engine !== "openai" && engine !== "azure") {
    return { status: "needs-selection", reason: "unsupported-provider" };
  }
  try {
    resolveTtsModel(engine, value.model);
    if (!clean(value.voice)) throw new Error("voice-required");
  } catch {
    return {
      status: "invalid-configuration",
      reason: "model-or-voice-invalid",
    };
  }
  return { status: "configured", value: value as SynthesisProviderBinding };
}

export function planProviderSelectionMigration(
  input: ProviderSelectionMigrationInput,
): ProviderSelectionMigrationPlan {
  const backup: RecordValue = {};
  const updates: RecordValue = {};
  const text = resolveTextProviderSelection(input.gptEngine);
  if (
    text.status === "needs-selection" &&
    text.reason !== "selection-required"
  ) {
    backup.gptEngine = input.gptEngine;
    updates.gptEngine = {
      name: PROVIDER_SELECTION_REQUIRED,
      models: { default: "" },
    };
  }
  const transcription = resolveTranscriptionProviderSelection(input.sttEngine);
  if (
    transcription.status === "needs-selection" &&
    transcription.reason !== "selection-required"
  ) {
    backup.sttEngine = input.sttEngine;
    updates.sttEngine = PROVIDER_SELECTION_REQUIRED;
  }
  const synthesis = resolveSynthesisProviderSelection(input.ttsConfig);
  if (
    synthesis.status === "needs-selection" &&
    synthesis.reason !== "selection-required"
  ) {
    backup.ttsConfig = input.ttsConfig;
    updates.ttsConfig = { engine: PROVIDER_SELECTION_REQUIRED };
  }
  return {
    version: PROVIDER_SELECTION_MIGRATION_VERSION,
    backup: backup as ProviderSelectionMigrationInput,
    updates: updates as ProviderSelectionMigrationPlan["updates"],
  };
}

export function readProviderSelectionMigrationRecord(
  value: unknown,
): ProviderSelectionMigrationRecord | null {
  if (!isRecord(value) || value.version !== PROVIDER_SELECTION_MIGRATION_VERSION) {
    return null;
  }
  if (value.status !== "prepared" && value.status !== "completed" && value.status !== "restored") {
    return null;
  }
  if (!isRecord(value.backup) || !isRecord(value.updates)) return null;
  return value as ProviderSelectionMigrationRecord;
}
