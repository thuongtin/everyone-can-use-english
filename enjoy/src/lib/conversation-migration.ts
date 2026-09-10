import {
  PROVIDER_SELECTION_MIGRATION_VERSION,
  PROVIDER_SELECTION_REQUIRED,
  resolveSynthesisProviderSelection,
  resolveTranscriptionProviderSelection,
} from "./provider-selection-migration";
import { isSupportedProvider } from "./ai-providers";

export type ConversationMigrationSource = {
  engine?: unknown;
  model?: unknown;
  baseUrl?: unknown;
  sttEngine?: unknown;
  stt?: unknown;
  providerSelectionMigration?: unknown;
  temperature?: number;
  maxCompletionTokens?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  historyBufferSize?: number;
  numberOfChoices?: number;
};

export type ConversationMigrationDefaults = {
  engine: unknown;
  model: unknown;
};

export type MigratedConversationGptConfig = {
  engine: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
  maxCompletionTokens?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  historyBufferSize?: number;
  numberOfChoices?: number;
  providerSelectionMigration?: ConversationBindingBackup;
};

export type MigratedConversationChatConfig = {
  sttEngine: string;
  providerSelectionMigration?: ConversationBindingBackup;
};

export type ConversationBindingBackup = {
  version: typeof PROVIDER_SELECTION_MIGRATION_VERSION;
  backup: Record<string, unknown>;
};

export type MigratedConversationTtsConfig = Record<string, unknown> & {
  engine: string;
  model?: string;
  voice?: string;
  language?: string;
};

type ChatConfigSource = Pick<ConversationMigrationSource, "sttEngine" | "stt">;

function readBindingBackup(value: unknown): ConversationBindingBackup | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.version !== PROVIDER_SELECTION_MIGRATION_VERSION ||
    !record.backup ||
    typeof record.backup !== "object" ||
    Array.isArray(record.backup)
  ) {
    return undefined;
  }
  return record as ConversationBindingBackup;
}

/** Return a persisted string without changing its representation. */
export function nonEmptyPersistedString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  return value;
}

function resolvePersistedString(value: unknown, fallback: unknown): string {
  return (
    nonEmptyPersistedString(value) ||
    nonEmptyPersistedString(fallback) ||
    ""
  );
}

/**
 * Preserve the historical provider/model pair, including provider IDs that
 * the current runtime does not know yet. Defaults are used only for empty
 * persisted values.
 */
export function migrateConversationGptConfig(
  source: ConversationMigrationSource,
  defaults: ConversationMigrationDefaults
): MigratedConversationGptConfig {
  const engine = resolvePersistedString(source.engine, defaults.engine);
  const model = resolvePersistedString(source.model, defaults.model);
  const result: MigratedConversationGptConfig = {
    engine,
    model,
    baseUrl: nonEmptyPersistedString(source.baseUrl),
    temperature: source.temperature,
    maxCompletionTokens: source.maxCompletionTokens,
    frequencyPenalty: source.frequencyPenalty,
    presencePenalty: source.presencePenalty,
    historyBufferSize: source.historyBufferSize,
    numberOfChoices: source.numberOfChoices,
  };
  const executable = isSupportedProvider(engine) &&
    (engine === "codex-acp" || engine === "claude-acp" || Boolean(model));
  if (executable) return result;
  const existingBackup = readBindingBackup(source.providerSelectionMigration);
  return {
    ...result,
    engine: PROVIDER_SELECTION_REQUIRED,
    model: "",
    providerSelectionMigration: existingBackup || {
      version: PROVIDER_SELECTION_MIGRATION_VERSION,
      backup: { ...source, engine, model },
    },
  };
}

/**
 * Write the current Chat config key while accepting legacy conversation data
 * that may still use `stt`.
 */
export function migrateConversationChatConfig(
  source:
    | Pick<ConversationMigrationSource, "sttEngine" | "stt" | "providerSelectionMigration">
    | null
    | undefined,
  defaultSttEngine: unknown
): MigratedConversationChatConfig {
  const sttEngine = resolvePersistedString(
    source?.sttEngine,
    nonEmptyPersistedString(source?.stt) || defaultSttEngine
  );
  const selection = resolveTranscriptionProviderSelection(sttEngine);
  if (selection.status === "configured") return { sttEngine: selection.value };
  return {
    sttEngine: PROVIDER_SELECTION_REQUIRED,
    providerSelectionMigration: readBindingBackup(source?.providerSelectionMigration) || {
      version: PROVIDER_SELECTION_MIGRATION_VERSION,
      backup: { sttEngine, ...(source?.stt ? { stt: source.stt } : {}) },
    },
  };
}

export function migrateConversationTtsConfig(source: unknown): MigratedConversationTtsConfig {
  const selection = resolveSynthesisProviderSelection(source);
  if (selection.status === "configured") {
    return { ...selection.value } as unknown as MigratedConversationTtsConfig;
  }
  if (source && typeof source === "object" && !Array.isArray(source)) {
    const record = source as Record<string, unknown>;
    if (
      record.engine === PROVIDER_SELECTION_REQUIRED &&
      readBindingBackup(record.providerSelectionMigration)
    ) {
      return { ...record } as MigratedConversationTtsConfig;
    }
  }
  return {
    engine: PROVIDER_SELECTION_REQUIRED,
    providerSelectionMigration: {
      version: PROVIDER_SELECTION_MIGRATION_VERSION,
      backup: source && typeof source === "object" && !Array.isArray(source)
        ? { ...(source as Record<string, unknown>) }
        : {},
    },
  };
}

/** Read both Chat config spellings without mutating legacy rows. */
export function readChatSttEngine(
  source: ChatConfigSource | null | undefined
): string | undefined {
  return (
    nonEmptyPersistedString(source?.sttEngine) ||
    nonEmptyPersistedString(source?.stt)
  );
}

/** Add the resolved STT key to a read projection without changing the row. */
export function normalizeChatConfigForRead(source: unknown): unknown {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return source;
  }

  return {
    ...(source as Record<string, unknown>),
    ...migrateConversationChatConfig(source as ChatConfigSource, ""),
  };
}
