import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  assertChatModelResponseComplete,
  createChatModel,
  getChatModelText,
  type ChatModelOptions,
} from "@/lib/chat-model";

export type TextCommandOptions = ChatModelOptions & {
  systemPrompt?: string;
};

export const textCommand = async (
  prompt: string,
  options: TextCommandOptions
): Promise<string> => {
  if (!prompt) throw new Error("Prompt is required");

  const chatModel = createChatModel({
    ...options,
    temperature: options.temperature ?? 0,
  });
  const input = options.systemPrompt
    ? [new SystemMessage(options.systemPrompt), new HumanMessage(prompt)]
    : prompt;

  const response = await chatModel.invoke(input);
  assertChatModelResponseComplete(response);
  const text = getChatModelText(response).trim();
  if (!text) throw new Error("AI returned an empty response");

  return text;
};
