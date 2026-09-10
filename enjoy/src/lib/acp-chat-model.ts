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
import { v4 as uuidv4 } from "uuid";
import type {
  AcpBridge,
  AcpProvider,
  AcpTextRequest,
} from "@/types/acp-api";

type JsonResponseFormat = {
  type?: string;
  json_schema?: unknown;
  schema?: unknown;
};

export type AcpChatModelCallOptions = BaseChatModelCallOptions & {
  response_format?: JsonResponseFormat;
  format?: unknown;
};

export type AcpChatModelFields = BaseChatModelParams & {
  provider: AcpProvider;
  model?: string;
  bridge: AcpBridge;
};

const acpModelError = (code: string, message: string): Error & { code: string } =>
  Object.assign(new Error(message), { code });

const contentToText = (content: MessageContent): string => {
  if (typeof content === "string") return content;
  const parts: string[] = [];
  for (const part of content as unknown[]) {
    if (typeof part === "string") {
      parts.push(part);
      continue;
    }
    if (
      part &&
      typeof part === "object" &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
    ) {
      parts.push(part.text);
      continue;
    }
    throw acpModelError(
      "acp_unsupported_content",
      "ACP text transport does not support non-text message content"
    );
  }
  return parts.join("\n");
};

const messageRole = (
  message: BaseMessage
): AcpTextRequest["messages"][number]["role"] => {
  switch (message.getType()) {
    case "human":
      return "user";
    case "ai":
      return "assistant";
    case "system":
    case "developer":
      return "system";
    default:
      throw acpModelError(
        "acp_unsupported_message_role",
        `ACP text transport does not support ${message.getType()} messages`
      );
  }
};

const jsonInstruction = (
  options: AcpChatModelCallOptions
): string | undefined => {
  const format = options.response_format;
  if (!format && options.format === undefined) return undefined;

  const schema = format?.json_schema ?? format?.schema ?? options.format;
  if (schema !== undefined) {
    return `Return only valid JSON matching this JSON Schema. Do not use Markdown fences.\n${JSON.stringify(schema)}`;
  }
  return "Return only one valid JSON value. Do not use Markdown fences or explanatory text.";
};

const abortError = () =>
  new DOMException("The operation was aborted", "AbortError");

export class AcpChatModel extends BaseChatModel<AcpChatModelCallOptions> {
  readonly provider: AcpProvider;
  readonly model?: string;
  private readonly bridge: AcpBridge;

  constructor(fields: AcpChatModelFields) {
    super({ ...fields, cache: false });
    this.provider = fields.provider;
    this.model = fields.model;
    this.bridge = fields.bridge;
  }

  _llmType(): string {
    return `${this.provider}-acp`;
  }

  private request(
    messages: BaseMessage[],
    options: AcpChatModelCallOptions
  ): AcpTextRequest {
    const requestMessages = messages.map((message) => ({
      role: messageRole(message),
      content: contentToText(message.content),
    }));
    const instruction = jsonInstruction(options);
    if (instruction) {
      requestMessages.unshift({ role: "system", content: instruction });
    }
    return {
      requestId: uuidv4(),
      provider: this.provider,
      ...(this.model ? { model: this.model } : {}),
      messages: requestMessages,
    };
  }

  private async invokeWithCancellation(
    request: AcpTextRequest,
    signal?: AbortSignal
  ): Promise<{ text: string; model: string | null }> {
    if (signal?.aborted) throw abortError();
    const cancel = () => {
      void this.bridge
        .cancel(request.requestId)
        .catch((): void => undefined);
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const result = await this.bridge.invoke(request);
      if (signal?.aborted) throw abortError();
      return result;
    } catch (error) {
      if (signal?.aborted) throw abortError();
      throw error;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }

  async _generate(
    messages: BaseMessage[],
    options: AcpChatModelCallOptions
  ): Promise<ChatResult> {
    const result = await this.invokeWithCancellation(
      this.request(messages, options),
      options.signal
    );
    return {
      generations: [
        {
          text: result.text,
          message: new AIMessage({
            content: result.text,
            response_metadata: {
              provider: this.provider,
              model: result.model,
              transport: "acp",
            },
          }),
        },
      ],
    };
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: AcpChatModelCallOptions,
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    const request = this.request(messages, options);
    let emitted = "";
    const pending: string[] = [];
    let wake: (() => void) | undefined;
    let finished = false;
    let failure: unknown;

    const unsubscribe = this.bridge.onUpdate((update) => {
      if (update.requestId !== request.requestId || update.type !== "text") return;
      const delta = update.text || "";
      if (!delta) return;
      emitted += delta;
      pending.push(delta);
      wake?.();
      wake = undefined;
    });

    const invocation = this.invokeWithCancellation(request, options.signal)
      .then((result) => {
        if (result.text.startsWith(emitted)) {
          const remainder = result.text.slice(emitted.length);
          if (remainder) pending.push(remainder);
        } else if (!emitted && result.text) {
          pending.push(result.text);
        } else {
          throw acpModelError(
            "acp_stream_result_mismatch",
            "ACP stream updates did not match the completed response"
          );
        }
      })
      .catch((error) => {
        failure = error;
      })
      .finally(() => {
        finished = true;
        wake?.();
        wake = undefined;
      });

    try {
      while (!finished || pending.length > 0) {
        if (pending.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }
        const text = pending.shift() || "";
        if (!text) continue;
        await runManager?.handleLLMNewToken(text);
        yield new ChatGenerationChunk({
          text,
          message: new AIMessageChunk({
            content: text,
            response_metadata: { provider: this.provider, transport: "acp" },
          }),
        });
      }
      await invocation;
      if (failure) throw failure;
    } finally {
      unsubscribe();
      if (!finished) {
        void this.bridge
          .cancel(request.requestId)
          .catch((): void => undefined);
      }
    }
  }
}
