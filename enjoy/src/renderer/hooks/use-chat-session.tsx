import { useEffect, useContext, useReducer, useState } from "react";
import {
  AISettingsProviderContext,
  AppSettingsProviderContext,
  DbProviderContext,
} from "@renderer/context";
import { toast } from "@renderer/components/ui";
import { chatMessagesReducer } from "@renderer/reducers";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { BufferMemory, ChatMessageHistory } from "langchain/memory";
import { ConversationChain } from "langchain/chains";
import { LLMResult } from "@langchain/core/outputs";
import { CHAT_GROUP_PROMPT_TEMPLATE, DEFAULT_GPT_CONFIG } from "@/constants";
import dayjs from "@renderer/lib/dayjs";
import Mustache from "mustache";
import { t } from "i18next";
import {
  ChatAgentTypeEnum,
  ChatMessageRoleEnum,
  ChatMessageStateEnum,
  ChatTypeEnum,
} from "@/types/enums";
import {
  assertChatModelResponseComplete,
  createChatModel,
  getChatModelText,
} from "@/lib/chat-model";

type RuntimeAISettings = {
  currentGptEngine?: GptEngineSettingType;
  ttsConfig?: TtsConfigType;
  openai?: LlmProviderType;
  getProviderConfig?: (name: string) => LlmProviderType;
};

export const useChatSession = (chatId: string) => {
  const { EnjoyApp, user, apiUrl } = useContext(
    AppSettingsProviderContext
  );
  const {
    currentGptEngine,
    ttsConfig,
    openai,
    getProviderConfig,
  } = useContext(AISettingsProviderContext) as RuntimeAISettings;
  const { addDblistener, removeDbListener } = useContext(DbProviderContext);
  const [chatMessages, dispatchChatMessages] = useReducer(
    chatMessagesReducer,
    []
  );
  const [chat, setChat] = useState<ChatType>(null);

  const fetchChat = async () => {
    if (!chatId) return;

    EnjoyApp.chats.findOne({ where: { id: chatId } }).then((c) => {
      setChat(c);
    });
  };

  const fetchChatMessages = async (query?: string) => {
    if (!chatId) return;

    return EnjoyApp.chatMessages
      .findAll({ where: { chatId }, query })
      .then((data) => {
        dispatchChatMessages({ type: "set", records: data });
        return data;
      })
      .catch((error) => {
        toast.error(error.message);
      });
  };

  const updateMessage = (id: string, data: ChatMessageDtoType) => {
    return EnjoyApp.chatMessages.update(id, data);
  };

  const deleteMessage = async (chatMessageId: string) => {
    return EnjoyApp.chatMessages
      .destroy(chatMessageId)
      .then(() =>
        dispatchChatMessages({
          type: "remove",
          record: { id: chatMessageId } as ChatMessageType,
        })
      )
      .catch((error) => {
        toast.error(error.message);
      });
  };

  const onChatSessionUpdate = (event: CustomEvent) => {
    const { model, action, record } = event.detail;
    if (model === "Chat") {
      if (record.id !== chatId) return;

      switch (action) {
        case "update":
          setChat(record);
          break;
        case "destroy":
          setChat(null);
          dispatchChatMessages({ type: "set", records: [] });
          break;
      }
    } else if (model === "ChatMember") {
      if (record.chatId !== chatId) return;

      fetchChat();
    } else if (model === "ChatAgent") {
      if ((chat?.members || []).findIndex((m) => m.userId === record.id) === -1)
        return;

      fetchChat();
    } else if (model === "ChatMessage") {
      if (record.chatId !== chatId) return;

      switch (action) {
        case "create":
          dispatchChatMessages({ type: "append", record });
          break;
        case "update":
          dispatchChatMessages({ type: "update", record });
          break;
        case "destroy":
          dispatchChatMessages({ type: "remove", record });
          break;
      }
    } else if (model === "Recording") {
      switch (action) {
        case "create":
          dispatchChatMessages({
            type: "update",
            record: {
              id: record.targetId,
              recording: record,
            } as ChatMessageType,
          });
          break;
      }
    } else if (model === "Speech") {
      switch (action) {
        case "create":
          if (record.sourceType !== "ChatMessage") return;

          dispatchChatMessages({
            type: "update",
            record: {
              id: record.sourceId,
              speech: record,
            } as ChatMessageType,
          });
          break;
      }
    }
  };

  const invokeAgent = async (memberId: string) => {
    if (!chat) {
      await fetchChat();
    }
    if (!chat) return;

    const member = await EnjoyApp.chatMembers.findOne({
      where: { id: memberId },
    });
    if (chat.type === ChatTypeEnum.CONVERSATION) {
      return askAgentInConversation(member);
    } else if (chat.type === ChatTypeEnum.GROUP) {
      return askAgentInGroup(member);
    } else if (chat.type === ChatTypeEnum.TTS) {
      return askAgentInTts(member);
    }
  };

  const askAgentInConversation = async (member: ChatMemberType) => {
    const pendingMessage = chatMessages.find(
      (m) =>
        m.role === ChatMessageRoleEnum.USER &&
        m.state === ChatMessageStateEnum.PENDING
    );
    if (!pendingMessage) return;

    const llm = buildLlm(member);
    const historyBufferSize = member.config.gpt.historyBufferSize || 10;
    const messages = chatMessages
      .filter((m) => m.state === ChatMessageStateEnum.COMPLETED)
      .slice(-historyBufferSize);
    const chatHistory = new ChatMessageHistory();
    messages.forEach((message) => {
      if (message.role === ChatMessageRoleEnum.USER) {
        chatHistory.addUserMessage(message.content);
      } else if (message.role === ChatMessageRoleEnum.AGENT) {
        chatHistory.addAIMessage(message.content);
      }
    });

    const memory = new BufferMemory({
      chatHistory,
      memoryKey: "history",
      returnMessages: true,
    });
    const prompt = ChatPromptTemplate.fromMessages([
      ["system" as MessageRoleEnum, buildSystemPrompt(member)],
      new MessagesPlaceholder("history"),
      ["human", "{input}"],
    ]);
    const chain = new ConversationChain({
      llm: llm as any,
      memory,
      prompt: prompt as any,
      verbose: false,
    });
    let response: LLMResult["generations"][0] = [];
    await chain.call({ input: pendingMessage.content }, [
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
    for (const r of response) {
      const generationMessage = (r as { message?: unknown }).message;
      const content = getChatModelText(generationMessage ?? r).trim();
      if (!content) throw new Error("AI returned an empty response");
      await EnjoyApp.chatMessages.create({
        chatId,
        memberId: member.id,
        content,
        state: ChatMessageStateEnum.COMPLETED,
      });
    }
    updateMessage(pendingMessage.id, {
      state: ChatMessageStateEnum.COMPLETED,
    });
  };

  const askAgentInGroup = async (member: ChatMemberType) => {
    const pendingMessage = chatMessages.find(
      (m) =>
        m.role === ChatMessageRoleEnum.USER &&
        m.state === ChatMessageStateEnum.PENDING
    );

    const historyBufferSize = member.config.gpt.historyBufferSize || 10;
    const history = chatMessages
      .filter(
        (m) =>
          m.role === ChatMessageRoleEnum.AGENT ||
          m.role === ChatMessageRoleEnum.USER
      )
      .slice(-historyBufferSize)
      .map((message) => {
        const timestamp = dayjs(message.createdAt).fromNow();
        switch (message.role) {
          case ChatMessageRoleEnum.AGENT:
            return `${message.member.agent.name}: ${message.content} (${timestamp})`;
          case ChatMessageRoleEnum.USER:
            return `${user.name}: ${message.content} (${timestamp})`;
          case ChatMessageRoleEnum.SYSTEM:
            return `(${message.content}, ${timestamp})`;
          default:
            return "";
        }
      })
      .join("\n");

    const llm = buildLlm(member);
    const prompt = ChatPromptTemplate.fromMessages([
      ["system", buildSystemPrompt(member)],
      ["system", CHAT_GROUP_PROMPT_TEMPLATE],
      ["user", "{input}"],
    ]);
    const chain = prompt.pipe(llm);

    const reply = await chain.invoke({
      name: member.agent.name,
      history,
      input: "Return your reply directly without any extra words.",
    });
    assertChatModelResponseComplete(reply);

    // the reply may contain the member's name like "ChatAgent: xxx". We need to remove it.
    const content = getChatModelText(reply)
      .replace(new RegExp(`^(${member.agent.name}):`), "")
      .trim();
    if (!content) throw new Error("AI returned an empty response");

    const message = await EnjoyApp.chatMessages.create({
      chatId,
      memberId: member.id,
      content,
      state: ChatMessageStateEnum.COMPLETED,
    });
    if (pendingMessage) {
      updateMessage(pendingMessage.id, {
        state: ChatMessageStateEnum.COMPLETED,
      });
    }

    return message;
  };

  const askAgentInTts = async (member: ChatMemberType) => {
    const pendingMessage = chatMessages.find(
      (m) =>
        m.role === ChatMessageRoleEnum.USER &&
        m.state === ChatMessageStateEnum.PENDING
    );
    if (!pendingMessage) return;

    const message = await EnjoyApp.chatMessages.create({
      chatId,
      memberId: member.id,
      content: pendingMessage.content,
      state: ChatMessageStateEnum.COMPLETED,
    });
    updateMessage(pendingMessage.id, {
      state: ChatMessageStateEnum.COMPLETED,
    });

    return message;
  };

  const buildLlm = (member: ChatMemberType) => {
    const {
      engine = "enjoyai",
      model,
      temperature,
      maxCompletionTokens,
      frequencyPenalty,
      presencePenalty,
      numberOfChoices,
    } = member.config.gpt;

    const providerConfig = getProviderConfig?.(engine);
    const key = providerConfig?.key ??
      (engine === "enjoyai"
        ? user?.accessToken
        : engine === "openai"
          ? openai?.key
          : undefined);
    const baseUrl =
      engine === "enjoyai"
        ? apiUrl
          ? `${apiUrl}/api/ai`
          : undefined
        : member.config.gpt.baseUrl || providerConfig?.baseUrl;

    if (engine === "enjoyai" && !key) {
      throw new Error(t("authorizationExpired"));
    }
    if (engine === "openai" && !key) {
      throw new Error(t("openaiKeyRequired"));
    }

    return createChatModel({
      provider: engine,
      key,
      baseUrl,
      modelName: model,
      temperature,
      maxTokens: maxCompletionTokens,
      frequencyPenalty,
      presencePenalty,
      numberOfChoices,
    });
  };

  const buildSystemPrompt = (member: ChatMemberType) => {
    return Mustache.render(
      `{{{agent_prompt}}}
      {{{chat_prompt}}}
      {{{member_prompt}}}`,
      {
        agent_prompt: member.agent.prompt,
        chat_prompt: chat.config.prompt,
        member_prompt: member.config.prompt,
      }
    );
  };

  const buildAgentMember = async (
    agentId: string
  ): Promise<ChatMemberDtoType> => {
    const agent = await EnjoyApp.chatAgents.findOne({ where: { id: agentId } });
    if (!agent) {
      throw new Error(t("models.chatAgent.notFound"));
    }

    const config =
      agent.type === ChatAgentTypeEnum.TTS
        ? {
            tts: {
              engine: ttsConfig.engine,
              model: ttsConfig.model,
              voice: ttsConfig.voice,
              language: ttsConfig.language,
              ...agent.config.tts,
            },
          }
        : {
            replyOnlyWhenMentioned: false,
            prompt: "",
            gpt: {
              ...DEFAULT_GPT_CONFIG,
              engine: currentGptEngine.name,
              model: currentGptEngine.models.default,
            },
            tts: {
              engine: ttsConfig.engine,
              model: ttsConfig.model,
              voice: ttsConfig.voice,
              language: ttsConfig.language,
            },
          };

    return {
      chatId,
      userId: agent.id,
      userType: "ChatAgent",
      config,
    };
  };

  useEffect(() => {
    if (!chatId) return;

    fetchChat();
    addDblistener(onChatSessionUpdate);
    fetchChatMessages();
    return () => {
      removeDbListener(onChatSessionUpdate);
      dispatchChatMessages({ type: "set", records: [] });
    };
  }, [chatId]);

  return {
    chat,
    chatMembers: chat?.members,
    chatAgents: chat?.members?.filter((m) => m.agent)?.map((m) => m.agent),
    chatMessages,
    fetchChatMessages,
    dispatchChatMessages,
    updateMessage,
    deleteMessage,
    invokeAgent,
    buildAgentMember,
  };
};
