import {
  AppSettingsProviderContext,
  AISettingsProviderContext,
} from "@renderer/context";
import { useContext } from "react";
import { ChatMessageHistory, BufferMemory } from "langchain/memory";
import { ConversationChain } from "langchain/chains";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { type LLMResult } from "@langchain/core/outputs";
import { v4 } from "uuid";
import { useSpeech } from "./use-speech";
import {
  assertChatModelResponseComplete,
  createChatModel,
  getChatModelText,
} from "@/lib/chat-model";

type RuntimeAISettings = {
  openai?: LlmProviderType;
  getProviderConfig?: (name: string) => LlmProviderType;
};

export const useConversation = () => {
  const { EnjoyApp } = useContext(
    AppSettingsProviderContext
  );
  const { openai, getProviderConfig } = useContext(
    AISettingsProviderContext
  ) as RuntimeAISettings;
  const { tts } = useSpeech();

  const pickLlm = (conversation: ConversationType) => {
    const {
      baseUrl,
      model,
      temperature,
      maxTokens,
      frequencyPenalty,
      presencePenalty,
      numberOfChoices,
    } = conversation.configuration;

    const provider = conversation.engine;
    const configuredProvider = getProviderConfig?.(provider);
    const legacyProvider = provider === "openai" ? openai : undefined;
    const key = configuredProvider?.key ?? legacyProvider?.key;
    const resolvedBaseUrl = baseUrl || configuredProvider?.baseUrl || legacyProvider?.baseUrl;
    if (provider === "openai" && !key) {
      throw new Error("OpenAI API key is required");
    }

    return createChatModel({
      provider,
      key,
      baseUrl: resolvedBaseUrl,
      modelName: model,
      temperature,
      maxTokens,
      frequencyPenalty,
      presencePenalty,
      numberOfChoices,
    });
  };

  const fetchChatHistory = async (conversation: ConversationType) => {
    const chatMessageHistory = new ChatMessageHistory();
    let limit = conversation.configuration.historyBufferSize;
    if (!limit || limit < 0) {
      limit = 0;
    }
    const _messages: MessageType[] = await EnjoyApp.messages.findAll({
      where: { conversationId: conversation.id },
      order: [["createdAt", "DESC"]],
      limit,
    });

    _messages
      .sort(
        (a, b) =>
          new Date(a.createdAt).getUTCMilliseconds() -
          new Date(b.createdAt).getUTCMilliseconds()
      )
      .forEach((message) => {
        if (message.role === "user") {
          chatMessageHistory.addUserMessage(message.content);
        } else if (message.role === "assistant") {
          chatMessageHistory.addAIMessage(message.content);
        }
      });

    return chatMessageHistory;
  };

  const chat = async (
    message: Partial<MessageType>,
    params: {
      conversation: ConversationType;
    }
  ): Promise<Partial<MessageType>[]> => {
    const { conversation } = params;

    if (conversation.type === "gpt") {
      return askGPT(message, params);
    } else if (conversation.type === "tts") {
      return askTTS(message, params);
    } else {
      return [];
    }
  };

  /*
   * Ask GPT
   * chat with GPT conversation
   * Use LLM to generate response
   */
  const askGPT = async (
    message: Partial<MessageType>,
    params: {
      conversation: ConversationType;
    }
  ): Promise<Partial<MessageType>[]> => {
    const { conversation } = params;
    const chatHistory = await fetchChatHistory(conversation);
    const memory = new BufferMemory({
      chatHistory,
      memoryKey: "history",
      returnMessages: true,
    });
    const prompt = ChatPromptTemplate.fromMessages([
      ["system" as MessageRoleEnum, conversation.configuration.roleDefinition],
      new MessagesPlaceholder("history"),
      ["human", "{input}"],
    ]);

    const llm = pickLlm(conversation);
    const chain = new ConversationChain({
      llm: llm as any,
      memory,
      prompt: prompt as any,
      verbose: false,
    });
    let response: LLMResult["generations"][0] = [];
    await chain.call({ input: message.content }, [
      {
        handleLLMEnd: async (output) => {
          response = output.generations[0] || [];
        },
      },
    ]);
    for (const generation of response) {
      assertChatModelResponseComplete(generation);
    }
    if (response.length === 0) {
      throw new Error("AI returned an empty response");
    }

    const replies = response.map((r) => {
      const generationMessage = (r as { message?: unknown }).message;
      const content = getChatModelText(generationMessage ?? r).trim();
      if (!content) throw new Error("AI returned an empty response");
      return {
        id: v4(),
        content,
        role: "assistant" as MessageRoleEnum,
        conversationId: conversation.id,
      };
    });

    message.role = "user" as MessageRoleEnum;
    message.conversationId = conversation.id;

    await EnjoyApp.messages.createInBatch([message, ...replies]);

    return replies;
  };

  /*
   * Ask TTS
   * chat with TTS conversation
   * It reply with the same text
   * and create speech using TTS
   */
  const askTTS = async (
    message: Partial<MessageType>,
    params: {
      conversation: ConversationType;
    }
  ): Promise<Partial<MessageType>[]> => {
    const { conversation } = params;
    const reply: MessageType = {
      id: v4(),
      content: message.content,
      role: "assistant" as MessageRoleEnum,
      conversationId: conversation.id,
      speeches: [],
    };
    message.role = "user" as MessageRoleEnum;
    message.conversationId = conversation.id;

    const speech = await tts({
      sourceType: "Message",
      sourceId: reply.id,
      text: reply.content,
      configuration: conversation.configuration.tts,
    });
    await EnjoyApp.messages.createInBatch([message, reply]);

    reply.speeches = [speech];

    return [reply];
  };

  return {
    chat,
  };
};
