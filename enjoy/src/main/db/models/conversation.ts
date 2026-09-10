import {
  AfterCreate,
  AfterDestroy,
  BeforeDestroy,
  Table,
  Column,
  Default,
  IsUUID,
  Model,
  HasMany,
  DataType,
  AllowNull,
  BeforeSave,
} from "sequelize-typescript";
import {
  Chat,
  ChatAgent,
  ChatMember,
  ChatMessage,
  Message,
  Speech,
  UserSetting,
} from "@main/db/models";
import mainWindow from "@main/window";
import log from "@main/logger";
import { t } from "i18next";
import {
  ChatAgentTypeEnum,
  ChatTypeEnum,
  ChatMessageRoleEnum,
  ChatMessageStateEnum,
  UserSettingKeyEnum,
} from "@/types/enums";
import { DEFAULT_GPT_CONFIG } from "@/constants";
import {
  migrateConversationChatConfig,
  migrateConversationGptConfig,
  migrateConversationTtsConfig,
  nonEmptyPersistedString,
} from "@/lib/conversation-migration";
import {
  resolveSynthesisProviderSelection,
  resolveTextProviderSelection,
} from "@/lib/provider-selection-migration";

const logger = log.scope("db/models/conversation");
@Table({
  modelName: "Conversation",
  tableName: "conversations",
  underscored: true,
  timestamps: true,
})
export class Conversation extends Model<Conversation> {
  @IsUUID(4)
  @Default(DataType.UUIDV4)
  @Column({ primaryKey: true, type: DataType.UUID })
  id: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  name: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  engine: string;

  @AllowNull(false)
  @Column(DataType.JSON)
  configuration: {
    model: string;
    type: "gpt" | "tts";
    roleDefinition?: string;
    temperature?: number;
    maxTokens?: number;
  } & { [key: string]: any };

  @Column(DataType.VIRTUAL)
  get type(): "gpt" | "tts" {
    return this.getDataValue("configuration").type || "gpt";
  }

  @Column(DataType.VIRTUAL)
  get model(): string {
    return this.getDataValue("configuration").model;
  }

  @Column(DataType.VIRTUAL)
  get roleDefinition(): string {
    return this.getDataValue("configuration").roleDefinition;
  }

  @Column(DataType.VIRTUAL)
  get language(): string {
    return this.getDataValue("configuration").tts?.language;
  }

  @HasMany(() => Message)
  messages: Message[];

  async migrateToChat() {
    const source = `conversations://${this.id}`;
    let agent = await ChatAgent.findOne({
      where: {
        source,
      },
    });

    if (agent) return;

    const gptSource = {
      engine: this.engine,
      model: this.configuration.model,
      baseUrl: this.configuration.baseUrl,
      temperature: this.configuration.temperature,
      maxCompletionTokens: this.configuration.maxTokens,
      presencePenalty: this.configuration.presencePenalty,
      frequencyPenalty: this.configuration.frequencyPenalty,
      historyBufferSize: this.configuration.historyBufferSize,
      numberOfChoices: this.configuration.numberOfChoices,
    };
    let gptDefaults = {
      engine: DEFAULT_GPT_CONFIG.engine,
      model: DEFAULT_GPT_CONFIG.model,
    };

    if (
      !nonEmptyPersistedString(gptSource.engine) ||
      !nonEmptyPersistedString(gptSource.model)
    ) {
      const defaultGptEngine = await UserSetting.get(
        UserSettingKeyEnum.GPT_ENGINE
      );
      gptDefaults = {
        engine: defaultGptEngine?.name || DEFAULT_GPT_CONFIG.engine,
        model: defaultGptEngine?.models?.default || DEFAULT_GPT_CONFIG.model,
      };
    }

    const gpt = migrateConversationGptConfig(gptSource, gptDefaults);

    const tts = migrateConversationTtsConfig(this.configuration.tts);

    agent = await ChatAgent.create({
      name:
        this.configuration.type === "tts" ? tts.voice || this.name : this.name,
      type: this.configuration.type === "tts"
        ? ChatAgentTypeEnum.TTS
        : ChatAgentTypeEnum.GPT,
      source,
      description: "",
      config:
        this.configuration.type === "tts"
          ? {
              tts,
            }
          : {
              prompt: this.configuration.roleDefinition,
            },
    });

    const transaction = await Conversation.sequelize.transaction();

    try {
      const selectedSttEngine = await UserSetting.get(UserSettingKeyEnum.STT_ENGINE);
      const chat = await Chat.create(
        {
          name: t("newChat"),
          type: this.type === "tts"
            ? ChatTypeEnum.TTS
            : ChatTypeEnum.CONVERSATION,
          config: migrateConversationChatConfig(
            {
              sttEngine: this.configuration.sttEngine,
              stt: this.configuration.stt,
            },
            selectedSttEngine
          ),
        },
        {
          transaction,
        }
      );
      const chatMember = await ChatMember.create(
        {
          chatId: chat.id,
          userId: agent.id,
          userType: "ChatAgent",
          config:
            this.configuration.type === "tts"
              ? {
                  tts,
                }
              : {
                  gpt,
                  tts,
                },
        },
        {
          transaction,
          hooks: false,
        }
      );

      const messages = await Message.findAll({
        where: {
          conversationId: this.id,
        },
        include: [
          {
            association: "speeches",
            model: Speech,
            where: { sourceType: "Message" },
            required: false,
          },
        ],
        order: [["createdAt", "ASC"]],
      });

      for (const message of messages) {
        const chatMessage = await ChatMessage.create(
          {
            chatId: chat.id,
            content: message.content,
            role: message.role === "user"
              ? ChatMessageRoleEnum.USER
              : ChatMessageRoleEnum.AGENT,
            state: ChatMessageStateEnum.COMPLETED,
            memberId: message.role === "assistant" ? chatMember.id : null,
            agentId: message.role === "assistant" ? agent.id : null,
            createdAt: message.createdAt,
            updatedAt: message.updatedAt,
          },
          {
            transaction,
            hooks: false,
          }
        );
        if (chat.type === "TTS") {
          for (const speech of message.speeches) {
            await speech.update(
              {
                sourceId: chatMessage.id,
                sourceType: "ChatMessage",
              },
              { transaction }
            );
          }
        }
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      logger.error(error);
      throw error;
    }
  }

  @BeforeSave
  static validateConfiguration(conversation: Conversation) {
    if (conversation.type === "tts") {
      if (!conversation.configuration.tts) {
        throw new Error(t("models.conversation.ttsConfigurationIsRequired"));
      }
      if (!conversation.configuration.tts.engine) {
        throw new Error(t("models.conversation.ttsEngineIsRequired"));
      }
      if (!conversation.configuration.tts.model) {
        throw new Error("models.conversation.ttsModelIsRequired");
      }

      if (
        resolveSynthesisProviderSelection(conversation.configuration.tts).status !==
        "configured"
      ) {
        throw new Error("provider_selection_required");
      }

      conversation.engine = conversation.configuration.tts.engine;
      conversation.configuration.model = conversation.configuration.tts.model;
    }

    if (conversation.type === "gpt" && !conversation.configuration.model)
      throw new Error(t("models.conversation.modelIsRequired"));
    if (
      conversation.type === "gpt" &&
      resolveTextProviderSelection({
        name: conversation.engine,
        models: { default: conversation.configuration.model },
      }).status !== "configured"
    ) {
      throw new Error("provider_selection_required");
    }
  }

  @AfterCreate
  static notifyForCreate(conversation: Conversation) {
    this.notify(conversation, "create");
  }

  @BeforeDestroy
  static destroyAllMessages(conversation: Conversation) {
    Message.findAll({ where: { conversationId: conversation.id } }).then(
      (messages) => {
        messages.forEach((message) => message.destroy());
      }
    );
  }

  @AfterDestroy
  static notifyForDestroy(conversation: Conversation) {
    this.notify(conversation, "destroy");
  }

  static notify(
    conversation: Conversation,
    action: "create" | "update" | "destroy"
  ) {
    if (!mainWindow.win) return;

    mainWindow.win.webContents.send("db-on-transaction", {
      model: "Conversation",
      id: conversation.id,
      action: action,
      record: conversation.toJSON(),
    });
  }
}
