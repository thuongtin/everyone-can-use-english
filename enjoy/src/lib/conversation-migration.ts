export type ConversationMigrationSource = {
  engine?: unknown;
  model?: unknown;
  sttEngine?: unknown;
  stt?: unknown;
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
  temperature?: number;
  maxCompletionTokens?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  historyBufferSize?: number;
  numberOfChoices?: number;
};

export type MigratedConversationChatConfig = {
  sttEngine: string;
};

type ChatConfigSource = Pick<ConversationMigrationSource, "sttEngine" | "stt">;

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
  return {
    engine: resolvePersistedString(source.engine, defaults.engine),
    model: resolvePersistedString(source.model, defaults.model),
    temperature: source.temperature,
    maxCompletionTokens: source.maxCompletionTokens,
    frequencyPenalty: source.frequencyPenalty,
    presencePenalty: source.presencePenalty,
    historyBufferSize: source.historyBufferSize,
    numberOfChoices: source.numberOfChoices,
  };
}

/**
 * Write the current Chat config key while accepting legacy conversation data
 * that may still use `stt`.
 */
export function migrateConversationChatConfig(
  source:
    | Pick<ConversationMigrationSource, "sttEngine" | "stt">
    | null
    | undefined,
  defaultSttEngine: unknown
): MigratedConversationChatConfig {
  return {
    sttEngine: resolvePersistedString(
      source?.sttEngine,
      nonEmptyPersistedString(source?.stt) || defaultSttEngine
    ),
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

  const sttEngine = readChatSttEngine(source as ChatConfigSource);
  if (!sttEngine) {
    return source;
  }

  return {
    ...(source as Record<string, unknown>),
    sttEngine,
  };
}
