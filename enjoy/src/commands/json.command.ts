import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  assertChatModelResponseComplete,
  createChatModel,
  getChatModelContent,
  getChatModelRequestPolicy,
  getChatModelText,
  type ChatModelOptions,
} from "@/lib/chat-model";

export type JsonCommandOptions = ChatModelOptions & {
  schema: z.ZodTypeAny;
};

const withoutSchemaMeta = (schema: Record<string, unknown>) => {
  const body = { ...schema };
  delete body.$schema;
  return body;
};

const parseJsonText = (value: string) => {
  const text = value.trim();
  if (!text) throw new Error("AI returned an empty or incomplete JSON response");

  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch (error) {
    throw new Error("AI returned malformed JSON", { cause: error });
  }
};

export const jsonCommand = async (
  prompt: string,
  options: JsonCommandOptions
): Promise<any> => {
  if (!prompt) throw new Error("Prompt is required");

  const { schema } = options;
  const policy = getChatModelRequestPolicy(options);
  const chatModel = createChatModel({
    ...options,
    temperature: options.temperature ?? 0,
  });
  const jsonSchema = withoutSchemaMeta(
    zodToJsonSchema(schema) as Record<string, unknown>
  );

  // Keep OpenAI-compatible requests in JSON mode. Responses strict schemas
  // require every optional property to be required or nullable, which would
  // make the existing lookup contract reject valid partial dictionary data.
  // Zod remains the application boundary for the final shape check.
  const requestModel =
    policy.protocol === "ollama"
      ? chatModel.bind({ format: jsonSchema })
      : chatModel.bind({
          response_format: {
            type: "json_object",
          },
        });

  let response: unknown;
  try {
    response = await requestModel.invoke(prompt);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/incomplete|refus|empty|finish_reason/i.test(message)) {
      throw new Error("AI response was incomplete or refused", { cause: error });
    }
    throw error;
  }

  assertChatModelResponseComplete(response);

  const content = getChatModelContent(response);
  const parsed =
    content && typeof content === "object"
      ? content
      : parseJsonText(getChatModelText(response));

  // Keep this explicit even when the transport advertises JSON Schema. A
  // provider can return valid JSON with fields that do not match the lesson
  // contract, and that must fail before the result enters application state.
  return schema.parse(parsed);
};
