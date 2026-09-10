import { assertAllowedNetworkUrl, createGuardedFetch } from "./network-policy";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { AcpChatModel } from "./acp-chat-model";
import { VertexExpressChatModel } from "./vertex-express-chat-model";
import type { AcpBridge } from "@/types/acp-api";

/**
 * The small set of options shared by command, conversation, and chat-agent
 * callers. Provider-specific request policy lives in this module so callers
 * do not have to know which transport a model needs.
 */
export type ChatModelOptions = {
  provider?: string;
  key?: string;
  baseUrl?: string;
  modelName?: string;
  temperature?: number;
  maxTokens?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  numberOfChoices?: number;
  signal?: AbortSignal;
  acpBridge?: AcpBridge;
};

export type ChatModelRequestPolicy = {
  provider: string;
  modelName: string;
  protocol: "chat-completions" | "responses" | "ollama" | "acp" | "vertex-express";
  useResponsesApi: boolean;
  reasoningEffort?: "low";
  omitSamplingParameters: boolean;
};

type RecordValue = Record<string, unknown>;

const DEFAULT_OPENAI_MODEL = "gpt-4o";
const DEFAULT_OLLAMA_MODEL = "llama3";
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const SUPPORTED_PROVIDERS = new Set([
  "openai",
  "azure-openai",
  "gemini",
  "deepseek",
  "openrouter",
  "ollama",
  "lmstudio",
  "codex-acp",
  "claude-acp",
  "vertex-express",
]);

const trimToUndefined = (value?: string) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value?.trim();
  return trimmed || undefined;
};

const isNewOpenAIModel = (modelName: string) =>
  /^gpt-(?:5|6)(?:[.-]|$)/i.test(modelName);

const isGeminiReasoningModel = (modelName: string) =>
  /^gemini-3\.8(?:[.-]|$)/i.test(modelName);

const isOpenRouterClaudeSonnet5 = (modelName: string) =>
  /(?:^|\/)claude-sonnet-5(?:$|[-:])/i.test(modelName);

/**
 * Responses is safe only for the actual OpenAI endpoint. A user-entered
 * proxy may implement the older compatible surface even when the model name
 * looks like GPT-5 or GPT-6.
 */
export const isOfficialOpenAIEndpoint = (baseUrl?: string) => {
  if (!baseUrl?.trim()) return true;

  try {
    const url = new URL(baseUrl.trim());
    if (url.protocol !== "https:" || url.hostname !== "api.openai.com") {
      return false;
    }
    if (url.username || url.password || url.port) return false;
    return url.pathname === "" || url.pathname === "/" || url.pathname === "/v1" || url.pathname === "/v1/";
  } catch {
    return false;
  }
};

const AZURE_OPENAI_HOSTS = [
  ".openai.azure.com",
  ".services.ai.azure.com",
] as const;

/**
 * Azure OpenAI v1 uses an OpenAI-compatible base URL and the deployment name
 * in the request model field. Resource endpoint roots copied from Azure are
 * completed with /openai/v1; explicit custom gateway paths are preserved.
 */
export const resolveAzureOpenAiBaseUrl = (baseUrl?: string): string => {
  const value = trimToUndefined(baseUrl);
  if (!value) {
    throw new Error(
      "Chưa cấu hình Azure OpenAI Base URL. Dùng endpoint kết thúc bằng /openai/v1."
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Azure OpenAI Base URL không hợp lệ.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Azure OpenAI Base URL phải là HTTPS và không chứa credential hoặc query.");
  }

  const azureResourceHost = AZURE_OPENAI_HOSTS.some((suffix) =>
    url.hostname.toLowerCase().endsWith(suffix)
  );
  if (azureResourceHost && (url.pathname === "" || url.pathname === "/")) {
    url.pathname = "/openai/v1";
  }
  return url.toString().replace(/\/+$/u, "");
};

export const getChatModelRequestPolicy = (
  options: ChatModelOptions = {}
): ChatModelRequestPolicy => {
  const explicitProvider = trimToUndefined(options.provider)?.toLowerCase();
  const provider = explicitProvider;
  if (!provider || provider === "enjoyai" || provider === "needs-selection") {
    throw new Error("Chưa chọn provider AI. Mở Cài đặt > Dịch vụ AI để chọn provider và model.");
  }
  if (options.baseUrl) assertAllowedNetworkUrl(options.baseUrl, { transport: "chat-sdk", operation: "configure" });
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
  if (
    provider !== "codex-acp" && provider !== "claude-acp" &&
    !trimToUndefined(options.modelName)
  ) {
    throw new Error(`Chưa chọn model cho ${provider}.`);
  }
  if (provider === "azure-openai") {
    const azureBaseUrl = resolveAzureOpenAiBaseUrl(options.baseUrl);
    assertAllowedNetworkUrl(azureBaseUrl, {
      transport: "chat-sdk",
      operation: "configure",
    });
  }
  const modelName =
    trimToUndefined(options.modelName) ||
    (provider === "codex-acp" || provider === "claude-acp"
      ? ""
      : provider === "ollama"
        ? DEFAULT_OLLAMA_MODEL
        : DEFAULT_OPENAI_MODEL);
  const officialOpenAI = provider === "openai" && isOfficialOpenAIEndpoint(options.baseUrl);
  const useResponsesApi = officialOpenAI && isNewOpenAIModel(modelName);
  const isClaudeWithoutSampling =
    provider === "openrouter" && isOpenRouterClaudeSonnet5(modelName);
  const omitSamplingParameters =
    (provider === "openai" && isNewOpenAIModel(modelName)) ||
    provider === "azure-openai" ||
    isClaudeWithoutSampling;

  return {
    provider,
    modelName,
    protocol:
      provider === "vertex-express"
        ? "vertex-express"
        : provider === "codex-acp" || provider === "claude-acp"
        ? "acp"
        : provider === "ollama"
          ? "ollama"
          : useResponsesApi
            ? "responses"
            : "chat-completions",
    useResponsesApi,
    ...(useResponsesApi || provider === "gemini" && isGeminiReasoningModel(modelName)
      ? { reasoningEffort: "low" as const }
      : {}),
    omitSamplingParameters,
  };
};

const finiteNumber = (value?: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asRecord = (value: unknown): RecordValue | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;

const hasRefusalBlock = (value: unknown): boolean => {
  if (!Array.isArray(value)) return false;
  return value.some((part) => {
    const record = asRecord(part);
    return record?.type === "refusal" || hasRefusalBlock(record?.content);
  });
};

const isUnsuccessfulStatus = (value: unknown) => {
  if (typeof value !== "string") return false;
  return !["completed", "complete", "success", "succeeded", "stop"].includes(
    value.toLowerCase()
  );
};

const isUnsuccessfulFinishReason = (value: unknown) => {
  if (typeof value !== "string") return false;
  return [
    "length",
    "max_tokens",
    "max_output_tokens",
    "content_filter",
    "incomplete",
    "cancelled",
    "canceled",
    "refusal",
    "error",
    "empty",
    "safety",
    "recitation",
    "other",
    "blocklist",
    "prohibited_content",
    "spii",
    "malformed_function_call",
    "image_safety",
    "unexpected_tool_call",
    "no_image",
    "image_prohibited_content",
  ].includes(value.toLowerCase());
};

/**
 * Return a safe, provider-neutral explanation when a model response cannot be
 * used as a complete lesson response. LangChain places these fields in
 * response_metadata on both Responses and Chat Completions messages.
 */
export const getChatModelResponseIssue = (
  response: unknown
): string | undefined => {
  const record = asRecord(response);
  if (!record) return undefined;

  const message = asRecord(record.message);

  const metadata: RecordValue = {
    status: record.status,
    incomplete_details: record.incomplete_details,
    finish_reason: record.finish_reason,
    done_reason: record.done_reason,
    ...(asRecord(record.generationInfo) || {}),
    ...(asRecord(record.response_metadata) || {}),
    ...(asRecord(message?.response_metadata) || {}),
  };
  if (isUnsuccessfulStatus(metadata.status)) {
    return `status:${String(metadata.status)}`;
  }

  const incompleteDetails = asRecord(metadata.incomplete_details);
  if (incompleteDetails || metadata.incomplete_details != null) {
    const reason = incompleteDetails?.reason;
    return reason ? `incomplete:${String(reason)}` : "incomplete";
  }

  if (isUnsuccessfulFinishReason(metadata.finish_reason)) {
    return `finish_reason:${String(metadata.finish_reason)}`;
  }
  if (isUnsuccessfulFinishReason(metadata.done_reason)) {
    return `done_reason:${String(metadata.done_reason)}`;
  }

  const additionalKwargs = {
    ...(asRecord(message?.additional_kwargs) || {}),
    ...(asRecord(record.additional_kwargs) || {}),
  };
  const refusal =
    metadata["refusal"] ?? record.refusal ?? additionalKwargs["refusal"];
  if (typeof refusal === "string" && refusal.trim()) {
    return "refusal";
  }

  if (
    hasRefusalBlock(record.content) ||
    hasRefusalBlock(message?.content) ||
    hasRefusalBlock(additionalKwargs.tool_outputs)
  ) {
    return "refusal";
  }

  return undefined;
};

export const assertChatModelResponseComplete = (response: unknown) => {
  const issue = getChatModelResponseIssue(response);
  if (issue) {
    throw new Error(`AI response was incomplete or refused (${issue})`);
  }
};

const buildOpenAIConfiguration = (
  baseUrl?: string,
  key?: string,
  provider?: string
) => {
  const configuration: Record<string, unknown> = {};
  const normalizedBaseUrl = trimToUndefined(baseUrl);
  const normalizedKey = trimToUndefined(key);

  if (provider === "azure-openai") {
    configuration.baseURL = resolveAzureOpenAiBaseUrl(normalizedBaseUrl);
  } else if (normalizedBaseUrl) {
    configuration.baseURL = normalizedBaseUrl;
  }

  // Keep the adapter on the host runtime's fetch implementation. Electron's
  // renderer and the mock transport use the same Web Fetch boundary, while
  // the OpenAI SDK's Node shim otherwise captures node-fetch at import time.
  if (typeof globalThis.fetch === "function") {
    configuration.fetch = createGuardedFetch(globalThis.fetch.bind(globalThis), { transport: "chat-sdk", operation: "request" });
  }

  // OpenAI's client otherwise reads OPENAI_API_KEY from the environment and
  // emits an Authorization header even for local OpenAI-compatible servers.
  // An explicit null default header removes that header when no key was set.
  if (provider === "azure-openai" && normalizedKey) {
    configuration.defaultHeaders = {
      "api-key": normalizedKey,
      Authorization: null,
    };
  } else if (!normalizedKey) {
    configuration.defaultHeaders = { Authorization: null };
  }

  return configuration;
};

export function createChatModel(
  options: ChatModelOptions = {}
): ChatOpenAI | ChatOllama | AcpChatModel | VertexExpressChatModel {
  const policy = getChatModelRequestPolicy(options);
  if (["openai", "azure-openai", "gemini", "deepseek", "openrouter"].includes(policy.provider) && !trimToUndefined(options.key)) {
    throw new Error(`Chưa cấu hình API key cho ${policy.provider}.`);
  }

  if (policy.protocol === "vertex-express") {
    return new VertexExpressChatModel({
      apiKey: trimToUndefined(options.key) || "",
      model: policy.modelName,
      baseUrl: options.baseUrl,
      temperature: finiteNumber(options.temperature),
      maxTokens: finiteNumber(options.maxTokens),
      frequencyPenalty: finiteNumber(options.frequencyPenalty),
      presencePenalty: finiteNumber(options.presencePenalty),
    });
  }

  if (policy.protocol === "acp") {
    const bridge =
      options.acpBridge ||
      (globalThis as typeof globalThis & {
        window?: { __ENJOY_APP__?: { acp?: AcpBridge } };
      }).window?.__ENJOY_APP__?.acp;
    if (!bridge) {
      throw new Error("ACP runtime is unavailable");
    }
    return new AcpChatModel({
      provider: policy.provider === "codex-acp" ? "codex" : "claude",
      model: trimToUndefined(options.modelName),
      bridge,
    });
  }

  if (policy.protocol === "ollama") {
    const ollamaOptions: ConstructorParameters<typeof ChatOllama>[0] = {
      model: policy.modelName,
      baseUrl: trimToUndefined(options.baseUrl) || DEFAULT_OLLAMA_BASE_URL,
      maxRetries: 1,
      streaming: false,
    };

    const temperature = finiteNumber(options.temperature);
    const maxTokens = finiteNumber(options.maxTokens);
    const frequencyPenalty = finiteNumber(options.frequencyPenalty);
    const presencePenalty = finiteNumber(options.presencePenalty);

    if (temperature !== undefined) ollamaOptions.temperature = temperature;
    if (maxTokens !== undefined && maxTokens >= -1) {
      ollamaOptions.numPredict = maxTokens;
    }
    if (frequencyPenalty !== undefined) ollamaOptions.frequencyPenalty = frequencyPenalty;
    if (presencePenalty !== undefined) ollamaOptions.presencePenalty = presencePenalty;

    return new ChatOllama(ollamaOptions);
  }

  const chatOptions: ConstructorParameters<typeof ChatOpenAI>[0] = {
    modelName: policy.modelName,
    openAIApiKey: trimToUndefined(options.key) || "",
    configuration: buildOpenAIConfiguration(
      options.baseUrl,
      options.key,
      policy.provider
    ),
    cache: false,
    verbose: false,
    streamUsage: false,
    maxRetries: 1,
  };

  if (!policy.omitSamplingParameters) {
    const temperature = finiteNumber(options.temperature);
    const frequencyPenalty = finiteNumber(options.frequencyPenalty);
    const presencePenalty = finiteNumber(options.presencePenalty);
    if (temperature !== undefined) chatOptions.temperature = temperature;
    if (frequencyPenalty !== undefined) chatOptions.frequencyPenalty = frequencyPenalty;
    if (presencePenalty !== undefined) chatOptions.presencePenalty = presencePenalty;
  }

  const maxTokens = finiteNumber(options.maxTokens);
  if (
    policy.provider !== "azure-openai" &&
    maxTokens !== undefined &&
    maxTokens >= -1
  ) {
    chatOptions.maxTokens = maxTokens;
  }

  const modelKwargs: Record<string, unknown> = {
    // The app consumes one assistant response. Do not let the adapter's
    // default n=1 turn a historical numberOfChoices value into fan-out.
    n: undefined,
  };
  if (
    policy.provider === "azure-openai" &&
    maxTokens !== undefined &&
    maxTokens >= 0
  ) {
    modelKwargs.max_completion_tokens = maxTokens;
  }

  if (policy.useResponsesApi) {
    chatOptions.useResponsesApi = true;
    chatOptions.reasoningEffort = policy.reasoningEffort;
    // Enjoy keeps conversation history locally and sends it on each request.
    // This avoids creating a server-side response chain; it is not a claim of
    // zero-retention behavior by the provider.
    modelKwargs.store = false;
  } else if (policy.reasoningEffort) {
    // Gemini's OpenAI-compatible Chat Completions endpoint accepts the
    // documented low reasoning effort for Gemini 3.8.
    chatOptions.reasoningEffort = policy.reasoningEffort;
  }

  // @langchain/openai currently initializes `n` to one and may initialize
  // sampling defaults in a future adapter. Override every unsupported field
  // with undefined after the adapter's own fields are assembled, so JSON
  // serialization omits them from the provider request.
  if (policy.omitSamplingParameters) {
    Object.assign(modelKwargs, {
      temperature: undefined,
      top_p: undefined,
      frequency_penalty: undefined,
      presence_penalty: undefined,
    });
  }

  chatOptions.modelKwargs = modelKwargs;

  return new ChatOpenAI(chatOptions);
}

/**
 * Normalize LangChain's AIMessage content for text and JSON commands. The
 * OpenAI Responses adapter may expose text as a content block array while
 * Chat Completions and Ollama generally expose a string.
 */
export const getChatModelContent = (response: unknown): unknown => {
  if (!response || typeof response !== "object") return response;

  const additionalKwargs = (response as { additional_kwargs?: unknown }).additional_kwargs;
  if (
    additionalKwargs &&
    typeof additionalKwargs === "object" &&
    "parsed" in additionalKwargs &&
    (additionalKwargs as { parsed?: unknown }).parsed !== undefined
  ) {
    return (additionalKwargs as { parsed: unknown }).parsed;
  }

  const text = (response as { text?: unknown }).text;
  if (typeof text === "string" && text.length > 0) return text;

  const content = (response as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        const value = part as { text?: unknown; content?: unknown };
        if (typeof value.text === "string") return value.text;
        return typeof value.content === "string" ? value.content : "";
      })
      .join("");
  }

  return content;
};

export const getChatModelText = (response: unknown) => {
  const content = getChatModelContent(response);
  if (typeof content === "string") return content;
  if (content === undefined || content === null) return "";
  return JSON.stringify(content);
};
