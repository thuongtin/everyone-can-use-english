export const SUPPORTED_LLM_PROVIDER_IDS = [
  "openai",
  "azure-openai",
  "gemini",
  "vertex-express",
  "deepseek",
  "openrouter",
  "ollama",
  "lmstudio",
  "codex-acp",
  "claude-acp",
] as const;

export const LEGACY_LLM_PROVIDER_IDS = ["enjoyai"] as const;
export const PROVIDER_SELECTION_REQUIRED = "needs-selection" as const;

export type AiProviderId = (typeof SUPPORTED_LLM_PROVIDER_IDS)[number];

export type ProviderOption =
  | "model"
  | "baseUrl"
  | "roleDefinition"
  | "temperature"
  | "numberOfChoices"
  | "maxTokens"
  | "frequencyPenalty"
  | "presencePenalty"
  | "historyBufferSize"
  | "tts";

export type ProviderDefinition = {
  id: AiProviderId;
  name: string;
  descriptionKey: string;
  models: readonly string[];
  legacyModels?: readonly string[];
  defaultBaseUrl?: string;
  acceptsApiKey: boolean;
  configurable: readonly ProviderOption[];
  modelCapabilities?: Readonly<
    Record<string, Partial<Record<ProviderOption, boolean>>>
  >;
};

export type ProviderConfig = {
  name: AiProviderId;
  key?: string;
  model?: string;
  baseUrl?: string;
  models: string;
  transcriptionModel?: string;
  credentialError?: "azure_key_unavailable";
};

export type GptProvider = {
  name: string;
  descriptionKey: string;
  models: string[];
  legacyModels: string[];
  configurable: ProviderOption[];
  baseUrl?: string;
  acceptsApiKey: boolean;
  modelCapabilities?: Readonly<
    Record<string, Partial<Record<ProviderOption, boolean>>>
  >;
};

export type GptProviderCatalog = Record<AiProviderId, GptProvider>;

export type ProviderRuntimeOptions = Pick<
  GptProvider,
  "configurable" | "modelCapabilities"
>;

export type GptEngineSelection = {
  name: string;
  models: {
    default: string;
    lookup?: string;
    translate?: string;
    analyze?: string;
    extractStory?: string;
  };
};

const ENJOYAI_LEGACY_MODELS = [
  "gpt-4o-mini",
  "gpt-4o",
  "chatgpt-4o-latest",
  "gpt-4-turbo",
  "gpt-4",
  "anthropic/claude-3.5-sonnet",
  "meta-llama/llama-3.1-8b-instruct",
  "meta-llama/llama-3.1-70b-instruct",
  "meta-llama/llama-3.1-405b-instruct",
  "google/gemma-2-27b-it",
  "google/gemma-2-9b-it:free",
  "google/gemini-pro-1.5",
  "google/gemini-flash-1.5",
  "perplexity/llama-3-sonar-large-32k-online",
  "deepseek/deepseek-chat",
  "deepseek/deepseek-coder",
] as const;

const OPENAI_MODELS = [
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-6-astra",
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4-turbo",
  "gpt-4",
] as const;

const COMMON_OPENAI_OPTIONS: readonly ProviderOption[] = [
  "model",
  "baseUrl",
  "roleDefinition",
  "temperature",
  "numberOfChoices",
  "maxTokens",
  "frequencyPenalty",
  "presencePenalty",
  "historyBufferSize",
  "tts",
];

// Deployment names do not reveal whether the underlying Azure model accepts
// sampling or token-limit fields. Keeping those fields out of shared settings
// lets chat and reasoning deployments use the same provider safely.
const AZURE_OPENAI_OPTIONS: readonly ProviderOption[] = [
  "model",
  "baseUrl",
  "roleDefinition",
  "maxTokens",
  "historyBufferSize",
  "tts",
];

const VERTEX_EXPRESS_OPTIONS: readonly ProviderOption[] = [
  "model",
  "roleDefinition",
  "temperature",
  "maxTokens",
  "historyBufferSize",
];

const COMMON_LOCAL_OPTIONS: readonly ProviderOption[] = [
  "model",
  "baseUrl",
  "roleDefinition",
  "temperature",
  "maxTokens",
  "historyBufferSize",
  "tts",
];

const ACP_OPTIONS: readonly ProviderOption[] = [
  "model",
  "roleDefinition",
  "historyBufferSize",
  "tts",
];

const OPENAI_REASONING_CAPABILITIES = {
  "gpt-5.6-luna": {
    temperature: false,
    numberOfChoices: false,
    frequencyPenalty: false,
    presencePenalty: false,
  },
  "gpt-5.6-terra": {
    temperature: false,
    numberOfChoices: false,
    frequencyPenalty: false,
    presencePenalty: false,
  },
  "gpt-6-astra": {
    temperature: false,
    numberOfChoices: false,
    frequencyPenalty: false,
    presencePenalty: false,
  },
} satisfies Readonly<
  Record<string, Partial<Record<ProviderOption, boolean>>>
>;

const GEMINI_CAPABILITIES = {
  "gemini-3.8-flash": {
    numberOfChoices: false,
    frequencyPenalty: false,
    presencePenalty: false,
  },
  "gemini-3.5-flash-lite": {
    numberOfChoices: false,
    frequencyPenalty: false,
    presencePenalty: false,
  },
} satisfies Readonly<
  Record<string, Partial<Record<ProviderOption, boolean>>>
>;

const OPENROUTER_CAPABILITIES = {
  "anthropic/claude-sonnet-5": {
    temperature: false,
    numberOfChoices: false,
    frequencyPenalty: false,
    presencePenalty: false,
  },
} satisfies Readonly<
  Record<string, Partial<Record<ProviderOption, boolean>>>
>;

export const AI_PROVIDER_CATALOG: Readonly<
  Record<AiProviderId, ProviderDefinition>
> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    descriptionKey: "aiProviders.openai.description",
    models: OPENAI_MODELS,
    acceptsApiKey: true,
    configurable: COMMON_OPENAI_OPTIONS,
    modelCapabilities: OPENAI_REASONING_CAPABILITIES,
  },
  "azure-openai": {
    id: "azure-openai",
    name: "Azure OpenAI",
    descriptionKey: "aiProviders.azureOpenai.description",
    // Azure v1 requests use deployment names in the model field. Deployments
    // are resource-specific, so a static model catalog would create invalid
    // choices for some accounts.
    models: [],
    acceptsApiKey: true,
    configurable: AZURE_OPENAI_OPTIONS,
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    descriptionKey: "aiProviders.gemini.description",
    models: ["gemini-3.8-flash", "gemini-3.5-flash-lite"],
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    acceptsApiKey: true,
    configurable: COMMON_OPENAI_OPTIONS,
    modelCapabilities: GEMINI_CAPABILITIES,
  },
  "vertex-express": {
    id: "vertex-express",
    name: "Vertex AI Express",
    descriptionKey: "aiProviders.vertexExpress.description",
    // Express Mode model availability depends on the account and service state.
    // Require an explicit model instead of advertising an unverified default.
    models: [],
    defaultBaseUrl: "https://aiplatform.googleapis.com/v1",
    acceptsApiKey: true,
    configurable: VERTEX_EXPRESS_OPTIONS,
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    descriptionKey: "aiProviders.deepseek.description",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    defaultBaseUrl: "https://api.deepseek.com",
    acceptsApiKey: true,
    configurable: COMMON_OPENAI_OPTIONS,
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    descriptionKey: "aiProviders.openrouter.description",
    models: ["anthropic/claude-sonnet-5"],
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    acceptsApiKey: true,
    configurable: COMMON_OPENAI_OPTIONS,
    modelCapabilities: OPENROUTER_CAPABILITIES,
  },
  ollama: {
    id: "ollama",
    name: "Ollama",
    descriptionKey: "aiProviders.ollama.description",
    models: [],
    defaultBaseUrl: "http://localhost:11434",
    acceptsApiKey: false,
    configurable: COMMON_LOCAL_OPTIONS,
  },
  lmstudio: {
    id: "lmstudio",
    name: "LM Studio",
    descriptionKey: "aiProviders.lmstudio.description",
    models: [],
    defaultBaseUrl: "http://localhost:1234/v1",
    acceptsApiKey: true,
    configurable: COMMON_LOCAL_OPTIONS,
  },
  "codex-acp": {
    id: "codex-acp",
    name: "Codex (ACP)",
    descriptionKey: "providerNoApiKeyRequired",
    models: [],
    acceptsApiKey: false,
    configurable: ACP_OPTIONS,
  },
  "claude-acp": {
    id: "claude-acp",
    name: "Claude Code (ACP)",
    descriptionKey: "providerNoApiKeyRequired",
    models: [],
    acceptsApiKey: false,
    configurable: ACP_OPTIONS,
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function isSupportedProvider(name: string): name is AiProviderId {
  return (SUPPORTED_LLM_PROVIDER_IDS as readonly string[]).includes(name);
}

export function normalizeModelList(input: unknown): string[] {
  const values = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];

  const seen = new Set<string>();
  const models: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    for (const item of value.split(",")) {
      const model = item.trim();
      if (!model || seen.has(model)) continue;
      seen.add(model);
      models.push(model);
    }
  }
  return models;
}

export function resolveGptEngineBootstrap(
  storedGptEngine: unknown,
  _storedOpenaiConfig: unknown
): { engine: GptEngineSelection; shouldPersist: boolean } {
  void _storedOpenaiConfig;
  if (isRecord(storedGptEngine)) {
    const rawModels = isRecord(storedGptEngine.models)
      ? storedGptEngine.models
      : {};
    const models: GptEngineSelection["models"] = {
      default:
        typeof rawModels.default === "string" && rawModels.default.trim()
          ? rawModels.default
          : "",
    };
    for (const key of [
      "lookup",
      "translate",
      "analyze",
      "extractStory",
    ] as const) {
      if (typeof rawModels[key] === "string" && rawModels[key].trim()) {
        models[key] = rawModels[key];
      }
    }
    const providerName =
      typeof storedGptEngine.name === "string"
        ? storedGptEngine.name.trim()
        : "";
    if (!isSupportedProvider(providerName)) {
      return {
        engine: {
          name: PROVIDER_SELECTION_REQUIRED,
          models: { default: "" },
        },
        shouldPersist: false,
      };
    }
    return {
      engine: {
        name: providerName,
        models,
      },
      shouldPersist: false,
    };
  }

  return {
    engine: {
      name: PROVIDER_SELECTION_REQUIRED,
      models: { default: "" },
    },
    shouldPersist: false,
  };
}

export function mergeModelLists(...inputs: unknown[]): string[] {
  return normalizeModelList(inputs.flatMap((input) =>
    Array.isArray(input) ? input : [input]
  ));
}

export function resolveProviderModel(
  availableModels: unknown,
  savedModel?: unknown
): string | undefined {
  const models = normalizeModelList(availableModels);
  const normalizedSavedModel =
    typeof savedModel === "string" ? savedModel.trim() : "";
  if (normalizedSavedModel && models.includes(normalizedSavedModel)) {
    return normalizedSavedModel;
  }
  return models[0];
}

export function resolveProviderSwitchBaseUrl(
  currentProvider: unknown,
  nextProvider: string,
  currentBaseUrl: unknown
): string | undefined {
  if (currentProvider !== nextProvider || typeof currentBaseUrl !== "string") {
    return undefined;
  }
  const baseUrl = currentBaseUrl.trim();
  return baseUrl || undefined;
}

export function createDefaultProviderConfigs(): Record<AiProviderId, ProviderConfig> {
  return Object.fromEntries(
    SUPPORTED_LLM_PROVIDER_IDS.map((id) => {
      const definition = AI_PROVIDER_CATALOG[id];
      const config: ProviderConfig = {
        name: id,
        key: undefined,
        baseUrl: definition.defaultBaseUrl,
        models: "",
      };
      return [
        id,
        config,
      ];
    })
  ) as Record<AiProviderId, ProviderConfig>;
}

export function normalizeProviderConfig(
  name: string,
  saved: unknown,
  fallback?: Partial<ProviderConfig>
): ProviderConfig {
  if (!isSupportedProvider(name)) {
    throw new Error(`Unsupported AI provider: ${name}`);
  }
  const id: AiProviderId = name;
  const definition = AI_PROVIDER_CATALOG[id];
  const record = isRecord(saved) ? saved : {};
  const fallbackRecord = fallback || {};
  const rawModels = record.models ?? record.model ?? fallbackRecord.models;
  const hasSavedBaseUrl = Object.prototype.hasOwnProperty.call(
    record,
    "baseUrl"
  );
  const baseUrl =
    !definition.configurable.includes("baseUrl")
      ? definition.defaultBaseUrl
      : hasSavedBaseUrl && typeof record.baseUrl === "string"
        ? record.baseUrl.trim() || definition.defaultBaseUrl
        : typeof fallbackRecord.baseUrl === "string"
          ? fallbackRecord.baseUrl.trim()
          : definition.defaultBaseUrl;

  const config: ProviderConfig = {
    name: id,
    key:
      definition.acceptsApiKey && typeof record.key === "string"
        ? record.key
        : definition.acceptsApiKey && typeof fallbackRecord.key === "string"
          ? fallbackRecord.key
          : undefined,
    baseUrl,
    models: normalizeModelList(rawModels).join(","),
  };

  if (typeof record.model === "string") config.model = record.model;
  if (typeof record.transcriptionModel === "string") {
    config.transcriptionModel = record.transcriptionModel;
  }
  if (id === "azure-openai" && !config.key && record.credentialError === "azure_key_unavailable") {
    config.credentialError = "azure_key_unavailable";
  }
  return config;
}

export function createGptProviders(
  providerConfigs: Partial<Record<AiProviderId, ProviderConfig>> = {},
  remote?: unknown,
  discoveredModels: Partial<Record<AiProviderId, unknown>> = {}
): GptProviderCatalog {
  void remote;
  return Object.fromEntries(
    SUPPORTED_LLM_PROVIDER_IDS.map((id) => {
      const definition = AI_PROVIDER_CATALOG[id];
      const saved = providerConfigs[id];
      const catalogModels = definition.models;
      const models =
        id === "codex-acp" || id === "claude-acp"
          ? mergeModelLists(discoveredModels[id])
          : mergeModelLists(
              catalogModels,
              saved?.models,
              saved?.model,
              discoveredModels[id]
            );
      const configurable = [...definition.configurable];
      const baseUrl = definition.configurable.includes("baseUrl")
        ? saved?.baseUrl ?? definition.defaultBaseUrl
        : definition.defaultBaseUrl;
      return [
        id,
        {
          name: definition.name,
          descriptionKey: definition.descriptionKey,
          models,
          legacyModels: [...(definition.legacyModels || [])],
          configurable,
          baseUrl,
          acceptsApiKey: definition.acceptsApiKey,
          modelCapabilities: definition.modelCapabilities,
        },
      ];
    })
  ) as GptProviderCatalog;
}

export function providerSupportsOption(
  provider: string,
  option: ProviderOption,
  model?: string,
  runtimeOptions?: ProviderRuntimeOptions
): boolean {
  if (!isSupportedProvider(provider)) return false;
  const definition = AI_PROVIDER_CATALOG[provider];
  const configurable = runtimeOptions?.configurable || definition.configurable;
  if (!configurable.includes(option)) return false;
  const modelCapability = model
    ? (runtimeOptions?.modelCapabilities || definition.modelCapabilities)?.[model]?.[
        option
      ]
    : undefined;
  return modelCapability !== false;
}

export function isLegacyProviderModel(provider: string, model: string): boolean {
  if (provider === "enjoyai") return ENJOYAI_LEGACY_MODELS.includes(model as never);
  return isSupportedProvider(provider)
    ? AI_PROVIDER_CATALOG[provider].legacyModels?.includes(model) === true
    : false;
}

export type ProviderFetchResponse = {
  ok?: boolean;
  json: () => Promise<unknown>;
};

export type ProviderFetch = (
  url: string,
  options?: {
    signal?: AbortSignal;
    headers?: Record<string, string>;
  }
) => Promise<ProviderFetchResponse>;

export async function discoverLocalModels(
  provider: string,
  baseUrl: string | undefined,
  fetchImpl?: ProviderFetch,
  timeoutMs = 1500,
  apiKey?: string
): Promise<string[] | null> {
  if (provider !== "ollama" && provider !== "lmstudio") return null;
  if (!baseUrl?.trim()) return null;

  const fetcher =
    fetchImpl ||
    (typeof globalThis.fetch === "function"
      ? (globalThis.fetch.bind(globalThis) as unknown as ProviderFetch)
      : undefined);
  if (!fetcher) return null;

  const controller = new AbortController();
  const endpoint = `${baseUrl.trim().replace(/\/+$/, "")}/${
    provider === "ollama" ? "api/tags" : "models"
  }`;
  const normalizedApiKey =
    provider === "lmstudio" && typeof apiKey === "string"
      ? apiKey.trim()
      : "";
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = (async (): Promise<string[] | null> => {
      const response = await fetcher(endpoint, {
        signal: controller.signal,
        ...(normalizedApiKey
          ? { headers: { Authorization: `Bearer ${normalizedApiKey}` } }
          : {}),
      });
      if (response.ok === false) return null;
      const payload = await response.json();
      if (!isRecord(payload)) return null;

      if (provider === "ollama") {
        if (!Array.isArray(payload.models)) return null;
        const models = normalizeModelList(
          payload.models.flatMap((model) =>
            isRecord(model) && typeof model.name === "string"
              ? [model.name]
              : []
          )
        );
        return payload.models.length > 0 && models.length === 0 ? null : models;
      }

      if (!Array.isArray(payload.data)) return null;
      const models = normalizeModelList(
        payload.data.flatMap((model) =>
          isRecord(model) && typeof model.id === "string" ? [model.id] : []
        )
      );
      return payload.data.length > 0 && models.length === 0 ? null : models;
    })();
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error("Provider discovery timed out"));
      }, Math.max(1, timeoutMs));
    });
    return await Promise.race([request, timeoutPromise]);
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
