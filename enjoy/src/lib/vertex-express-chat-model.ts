import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
  type MessageContent,
} from "@langchain/core/messages";
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BaseChatModelParams,
} from "@langchain/core/language_models/chat_models";
import {
  ChatGenerationChunk,
  type ChatResult,
} from "@langchain/core/outputs";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { createGuardedFetch } from "./network-policy";

const VERTEX_EXPRESS_ORIGIN = "https://aiplatform.googleapis.com";
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_SSE_EVENT_BYTES = 2 * 1024 * 1024;
const MODEL_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,126}[a-zA-Z0-9])?$/u;
const ALLOWED_ERROR_REASONS = new Set([
  "ABORTED",
  "DEADLINE_EXCEEDED",
  "FAILED_PRECONDITION",
  "INTERNAL",
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "PERMISSION_DENIED",
  "RESOURCE_EXHAUSTED",
  "SERVICE_UNAVAILABLE",
  "UNAUTHENTICATED",
  "UNAVAILABLE",
]);

type JsonObject = Record<string, unknown>;

type VertexPart = { text: string };
type VertexContent = { role: "user" | "model"; parts: VertexPart[] };
type VertexUsage = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};
type VertexCandidate = {
  content?: { parts?: unknown };
  finishReason?: unknown;
};
type VertexResponse = {
  candidates?: unknown;
  promptFeedback?: unknown;
  usageMetadata?: unknown;
  modelVersion?: unknown;
  responseId?: unknown;
};

export type VertexExpressChatModelCallOptions = BaseChatModelCallOptions & {
  responseMimeType?: "text/plain" | "application/json";
  responseJsonSchema?: unknown;
  tools?: unknown;
};

export type VertexExpressChatModelFields = BaseChatModelParams & {
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  fetch?: typeof globalThis.fetch;
};

type NormalizedResponse = {
  text: string;
  finishReason?: string;
  refusal: boolean;
  usage?: VertexUsage;
  modelVersion?: string;
  responseId?: string;
};

const asObject = (value: unknown): JsonObject | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;

const finiteNumber = (value?: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const vertexError = (code: string, message: string): Error & { code: string } =>
  Object.assign(new Error(message), { code });

const abortError = () =>
  new DOMException("The operation was aborted", "AbortError");

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw abortError();
};

export const resolveVertexExpressBaseUrl = (baseUrl?: string): string => {
  if (baseUrl === undefined || baseUrl.trim() === "") {
    return VERTEX_EXPRESS_ORIGIN;
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl.trim());
  } catch {
    throw vertexError(
      "vertex_express_invalid_base_url",
      "Vertex Express Base URL không hợp lệ"
    );
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "aiplatform.googleapis.com" ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !["", "/", "/v1", "/v1/"].includes(parsed.pathname)
  ) {
    throw vertexError(
      "vertex_express_invalid_base_url",
      "Vertex Express chỉ cho phép endpoint aiplatform.googleapis.com chính thức"
    );
  }
  return VERTEX_EXPRESS_ORIGIN;
};

export const validateVertexExpressModelId = (model: string): string => {
  const value = model.trim();
  if (model !== value || !MODEL_ID_PATTERN.test(value)) {
    throw vertexError(
      "vertex_express_invalid_model",
      "Vertex Express model ID không hợp lệ"
    );
  }
  return value;
};

const contentToParts = (content: MessageContent): VertexPart[] => {
  if (typeof content === "string") return [{ text: content }];
  return (content as unknown[]).map((part) => {
    if (typeof part === "string") return { text: part };
    const record = asObject(part);
    if (record?.type === "text" && typeof record.text === "string") {
      return { text: record.text };
    }
    throw vertexError(
      "vertex_express_unsupported_content",
      "Vertex Express text transport không hỗ trợ nội dung message không phải text"
    );
  });
};

const rejectToolMessageData = (message: BaseMessage) => {
  const record = message as BaseMessage & {
    tool_calls?: unknown[];
    invalid_tool_calls?: unknown[];
  };
  if (
    (Array.isArray(record.tool_calls) && record.tool_calls.length > 0) ||
    (Array.isArray(record.invalid_tool_calls) && record.invalid_tool_calls.length > 0) ||
    message.additional_kwargs.function_call ||
    (Array.isArray(message.additional_kwargs.tool_calls) &&
      message.additional_kwargs.tool_calls.length > 0)
  ) {
    throw vertexError(
      "vertex_express_unsupported_tools",
      "Vertex Express text transport không hỗ trợ tool calls"
    );
  }
};

const serializeMessages = (messages: BaseMessage[]) => {
  const contents: VertexContent[] = [];
  const systemParts: VertexPart[] = [];
  for (const message of messages) {
    rejectToolMessageData(message);
    const parts = contentToParts(message.content);
    switch (message.getType()) {
      case "human":
        contents.push({ role: "user", parts });
        break;
      case "ai":
        contents.push({ role: "model", parts });
        break;
      case "system":
      case "developer":
        systemParts.push(...parts);
        break;
      default:
        throw vertexError(
          "vertex_express_unsupported_message_role",
          `Vertex Express text transport không hỗ trợ role ${message.getType()}`
        );
    }
  }
  if (contents.length === 0) {
    throw vertexError(
      "vertex_express_missing_content",
      "Vertex Express cần ít nhất một user hoặc model message"
    );
  }
  return { contents, systemParts };
};

const safeReason = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const reason = value.trim().toUpperCase();
  return ALLOWED_ERROR_REASONS.has(reason) ? reason : undefined;
};

const sanitizedHttpError = async (
  response: Response,
  signal?: AbortSignal
): Promise<Error> => {
  let reason: string | undefined;
  try {
    const text = await readResponseText(response, signal, MAX_RESPONSE_BYTES);
    const body = asObject(JSON.parse(text));
    reason = safeReason(asObject(body?.error)?.status);
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw abortError();
    }
    // The response body is intentionally never exposed in an error.
  }
  return vertexError(
    "vertex_express_http_error",
    `Vertex Express request failed (HTTP ${response.status}${reason ? ` ${reason}` : ""})`
  );
};

const awaitWithAbort = async <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  throwIfAborted(signal);
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
};

const readResponseText = async (
  response: Response,
  signal?: AbortSignal,
  limit = MAX_RESPONSE_BYTES
): Promise<string> => {
  if (!response.body) {
    const text = await awaitWithAbort(response.text(), signal);
    if (new TextEncoder().encode(text).byteLength > limit) {
      throw vertexError("vertex_express_response_too_large", "Vertex Express response vượt giới hạn kích thước");
    }
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = "";
  try {
    while (true) {
      throwIfAborted(signal);
      const next = await awaitWithAbort(reader.read(), signal);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) {
        throw vertexError("vertex_express_response_too_large", "Vertex Express response vượt giới hạn kích thước");
      }
      result += decoder.decode(next.value, { stream: true });
    }
    result += decoder.decode();
    return result;
  } finally {
    if (signal?.aborted) void reader.cancel().catch((): void => undefined);
    reader.releaseLock();
  }
};

const normalizeUsage = (value: unknown): VertexUsage | undefined => {
  const usage = asObject(value);
  if (!usage) return undefined;
  const promptTokenCount = finiteNumber(usage.promptTokenCount as number | undefined);
  const candidatesTokenCount = finiteNumber(usage.candidatesTokenCount as number | undefined);
  const totalTokenCount = finiteNumber(usage.totalTokenCount as number | undefined);
  if (promptTokenCount === undefined && candidatesTokenCount === undefined && totalTokenCount === undefined) {
    return undefined;
  }
  return { promptTokenCount, candidatesTokenCount, totalTokenCount };
};

const normalizeResponse = (value: unknown): NormalizedResponse => {
  const response = asObject(value) as VertexResponse | undefined;
  if (!response) {
    throw vertexError("vertex_express_invalid_response", "Vertex Express trả về response không hợp lệ");
  }
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  const candidate = asObject(candidates[0]) as VertexCandidate | undefined;
  const parts = asObject(candidate?.content)?.parts;
  let text = "";
  if (parts !== undefined) {
    if (!Array.isArray(parts)) {
      throw vertexError("vertex_express_invalid_response", "Vertex Express trả về content không hợp lệ");
    }
    text = parts.map((part) => {
      const record = asObject(part);
      if (!record || typeof record.text !== "string") {
        throw vertexError(
          "vertex_express_unsupported_output",
          "Vertex Express text transport nhận output không phải text"
        );
      }
      return record.text;
    }).join("");
  }
  const finishReason = typeof candidate?.finishReason === "string"
    ? candidate.finishReason
    : undefined;
  const promptFeedback = asObject(response.promptFeedback);
  const refusal = candidates.length === 0 && typeof promptFeedback?.blockReason === "string";
  return {
    text,
    finishReason,
    refusal,
    usage: normalizeUsage(response.usageMetadata),
    modelVersion: typeof response.modelVersion === "string" ? response.modelVersion : undefined,
    responseId: typeof response.responseId === "string" ? response.responseId : undefined,
  };
};

const responseMetadata = (response: NormalizedResponse) => ({
  provider: "vertex-express",
  transport: "vertex-express",
  ...(response.modelVersion ? { model: response.modelVersion } : {}),
  ...(response.responseId ? { response_id: response.responseId } : {}),
  ...(response.finishReason ? { finish_reason: response.finishReason } : {}),
  status:
    response.text && !response.refusal && response.finishReason?.toUpperCase() === "STOP"
      ? "completed"
      : "incomplete",
  ...(response.refusal ? { refusal: "provider_refusal" } : {}),
});

const usageMetadata = (usage?: VertexUsage) => {
  if (!usage) return undefined;
  const input = usage.promptTokenCount ?? 0;
  const output = usage.candidatesTokenCount ?? 0;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: usage.totalTokenCount ?? input + output,
  };
};

export class VertexExpressChatModel extends BaseChatModel<VertexExpressChatModelCallOptions> {
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly generationConfig: JsonObject;

  constructor(fields: VertexExpressChatModelFields) {
    super({ ...fields, cache: false });
    this.baseUrl = resolveVertexExpressBaseUrl(fields.baseUrl);
    this.model = validateVertexExpressModelId(fields.model);
    this.apiKey = fields.apiKey.trim();
    if (!this.apiKey) {
      throw vertexError("vertex_express_missing_api_key", "Chưa cấu hình API key cho vertex-express");
    }
    const fetchImplementation = fields.fetch ?? globalThis.fetch?.bind(globalThis);
    if (typeof fetchImplementation !== "function") {
      throw vertexError("vertex_express_fetch_unavailable", "Fetch runtime không khả dụng");
    }
    this.fetchImpl = createGuardedFetch(fetchImplementation, {
      transport: "vertex-express",
      operation: "generate-content",
    }) as typeof globalThis.fetch;
    this.generationConfig = {};
    const temperature = finiteNumber(fields.temperature);
    const maxTokens = finiteNumber(fields.maxTokens);
    const frequencyPenalty = finiteNumber(fields.frequencyPenalty);
    const presencePenalty = finiteNumber(fields.presencePenalty);
    if (temperature !== undefined) this.generationConfig.temperature = temperature;
    if (maxTokens !== undefined && maxTokens >= 0) this.generationConfig.maxOutputTokens = maxTokens;
    if (frequencyPenalty !== undefined) this.generationConfig.frequencyPenalty = frequencyPenalty;
    if (presencePenalty !== undefined) this.generationConfig.presencePenalty = presencePenalty;
  }

  _llmType(): string {
    return "vertex-express";
  }

  private request(messages: BaseMessage[], options: VertexExpressChatModelCallOptions) {
    if (options.tool_choice !== undefined || options.tools !== undefined) {
      throw vertexError(
        "vertex_express_unsupported_tools",
        "Vertex Express text transport không hỗ trợ tool binding"
      );
    }
    const responseMimeType: unknown = options.responseMimeType;
    if (
      responseMimeType !== undefined &&
      responseMimeType !== "text/plain" &&
      responseMimeType !== "application/json"
    ) {
      throw vertexError(
        "vertex_express_unsupported_response_mime_type",
        "Vertex Express text transport chỉ hỗ trợ text/plain hoặc application/json"
      );
    }
    if (options.responseJsonSchema !== undefined && responseMimeType !== "application/json") {
      throw vertexError(
        "vertex_express_invalid_json_config",
        "responseJsonSchema yêu cầu responseMimeType application/json"
      );
    }
    const { contents, systemParts } = serializeMessages(messages);
    const generationConfig = {
      ...this.generationConfig,
      ...(options.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
      ...(options.responseJsonSchema !== undefined
        ? { responseJsonSchema: options.responseJsonSchema }
        : {}),
    };
    return {
      contents,
      ...(systemParts.length > 0
        ? { systemInstruction: { parts: systemParts } }
        : {}),
      ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
    };
  }

  private async fetch(messages: BaseMessage[], options: VertexExpressChatModelCallOptions, stream: boolean) {
    throwIfAborted(options.signal);
    const suffix = stream ? ":streamGenerateContent?alt=sse" : ":generateContent";
    const url = `${this.baseUrl}/v1/publishers/google/models/${this.model}${suffix}`;
    const body = JSON.stringify(this.request(messages, options));
    const requestController = new AbortController();
    const forwardAbort = () => requestController.abort();
    options.signal?.addEventListener("abort", forwardAbort, { once: true });
    const cleanup = () => {
      options.signal?.removeEventListener("abort", forwardAbort);
    };
    let response: Response;
    try {
      response = await awaitWithAbort(this.fetchImpl(url, {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body,
        signal: requestController.signal,
      }), options.signal) as Response;
    } catch (error) {
      cleanup();
      if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw abortError();
      }
      throw vertexError("vertex_express_network_error", "Vertex Express request failed (network_error)");
    }
    if (options.signal?.aborted) {
      cleanup();
      throw abortError();
    }
    if (!response.ok) {
      try {
        throw await sanitizedHttpError(response, options.signal);
      } finally {
        cleanup();
      }
    }
    return { response, requestController, cleanup };
  }

  async _generate(
    messages: BaseMessage[],
    options: VertexExpressChatModelCallOptions
  ): Promise<ChatResult> {
    const request = await this.fetch(messages, options, false);
    try {
      let payload: unknown;
      try {
        payload = JSON.parse(await readResponseText(request.response, options.signal));
      } catch (error) {
        if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw abortError();
        if (error instanceof Error && "code" in error) throw error;
        throw vertexError("vertex_express_invalid_response", "Vertex Express trả về JSON không hợp lệ");
      }
      const normalized = normalizeResponse(payload);
      const message = new AIMessage({
        content: normalized.text,
        response_metadata: responseMetadata(normalized),
        ...(normalized.refusal ? { additional_kwargs: { refusal: "provider_refusal" } } : {}),
        ...(normalized.usage ? { usage_metadata: usageMetadata(normalized.usage) } : {}),
      });
      return {
        generations: [{ text: normalized.text, message }],
        ...(normalized.usage ? { llmOutput: { tokenUsage: normalized.usage } } : {}),
      };
    } finally {
      request.cleanup();
    }
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: VertexExpressChatModelCallOptions,
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    const request = await this.fetch(messages, options, true);
    const response = request.response;
    if (!response.body) {
      request.requestController.abort();
      request.cleanup();
      throw vertexError("vertex_express_invalid_response", "Vertex Express stream không có response body");
    }
    if (!response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
      await response.body.cancel().catch((): void => undefined);
      request.requestController.abort();
      request.cleanup();
      throw vertexError("vertex_express_invalid_response", "Vertex Express stream không dùng SSE content type");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let totalBytes = 0;
    let emittedText = "";
    let finalResponse: NormalizedResponse | undefined;
    let reachedEof = false;

    const parseEvent = (event: string): NormalizedResponse | undefined => {
      const data = event
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim();
      if (!data || data === "[DONE]") return undefined;
      if (new TextEncoder().encode(data).byteLength > MAX_SSE_EVENT_BYTES) {
        throw vertexError("vertex_express_response_too_large", "Vertex Express SSE event vượt giới hạn kích thước");
      }
      try {
        return normalizeResponse(JSON.parse(data));
      } catch (error) {
        if (error instanceof Error && "code" in error) throw error;
        throw vertexError("vertex_express_invalid_response", "Vertex Express SSE event không hợp lệ");
      }
    };

    const emitNormalized = async function* (normalized: NormalizedResponse) {
      finalResponse = {
        text: normalized.text,
        finishReason: normalized.finishReason ?? finalResponse?.finishReason,
        refusal: normalized.refusal || finalResponse?.refusal || false,
        usage: normalized.usage ?? finalResponse?.usage,
        modelVersion: normalized.modelVersion ?? finalResponse?.modelVersion,
        responseId: normalized.responseId ?? finalResponse?.responseId,
      };
      if (!normalized.text) return;
      emittedText += normalized.text;
      await runManager?.handleLLMNewToken(normalized.text);
      yield new ChatGenerationChunk({
        text: normalized.text,
        message: new AIMessageChunk({ content: normalized.text }),
      });
    };

    try {
      while (true) {
        throwIfAborted(options.signal);
        const next = await awaitWithAbort(reader.read(), options.signal);
        if (next.done) {
          reachedEof = true;
          break;
        }
        totalBytes += next.value.byteLength;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          throw vertexError("vertex_express_response_too_large", "Vertex Express stream vượt giới hạn kích thước");
        }
        buffer += decoder.decode(next.value, { stream: true });
        let match = buffer.match(/\r?\n\r?\n/u);
        while (match?.index !== undefined) {
          const event = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          const normalized = parseEvent(event);
          if (normalized) yield* emitNormalized(normalized);
          match = buffer.match(/\r?\n\r?\n/u);
        }
        if (new TextEncoder().encode(buffer).byteLength > MAX_SSE_EVENT_BYTES) {
          throw vertexError("vertex_express_response_too_large", "Vertex Express SSE event vượt giới hạn kích thước");
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) {
        const normalized = parseEvent(buffer);
        if (normalized) yield* emitNormalized(normalized);
      }
      const completed = finalResponse ?? {
        text: "",
        refusal: false,
      };
      completed.text = emittedText;
      const metadata = responseMetadata(completed);
      yield new ChatGenerationChunk({
        text: "",
        generationInfo: metadata,
        message: new AIMessageChunk({
          content: "",
          response_metadata: metadata,
          ...(completed.refusal ? { additional_kwargs: { refusal: "provider_refusal" } } : {}),
          ...(completed.usage ? { usage_metadata: usageMetadata(completed.usage) } : {}),
        }),
      });
    } catch (error) {
      if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw abortError();
      throw error;
    } finally {
      if (!reachedEof) {
        await reader.cancel().catch((): void => undefined);
        request.requestController.abort();
      }
      reader.releaseLock();
      request.cleanup();
    }
  }
}
