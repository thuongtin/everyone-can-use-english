import {
  AfterCreate,
  AfterDestroy,
  AfterFind,
  BelongsTo,
  HasOne,
  Scopes,
  Table,
  Column,
  Default,
  IsUUID,
  Model,
  DataType,
  AllowNull,
  Unique,
} from "sequelize-typescript";
import mainWindow from "@main/window";
import fs from "fs-extra";
import path from "path";
import settings from "@main/settings";
import OpenAI, { type ClientOptions } from "openai";
import { t } from "i18next";
import { hashFile } from "@main/utils";
import { Audio, Document, Message, UserSetting } from "@main/db/models";
import log from "@main/logger";
import proxyAgent from "@main/proxy-agent";
import { UserSettingKeyEnum } from "@/types/enums";
import {
  buildOpenAiSpeechRequest,
  ensureAudioArrayBuffer,
  resolveTtsModel,
  sanitizeSpeechError,
  selectCanonicalOpenAiConfig,
} from "@/lib/speech-models";

const logger = log.scope("db/models/speech");
@Table({
  modelName: "Speech",
  tableName: "speeches",
  underscored: true,
  timestamps: true,
})
@Scopes(() => ({
  asc: {
    order: [["createdAt", "ASC"]],
  },
  desc: {
    order: [["createdAt", "DESC"]],
  },
}))
export class Speech extends Model<Speech> {
  @IsUUID(4)
  @Default(DataType.UUIDV4)
  @Column({ primaryKey: true, type: DataType.UUID })
  id: string;

  @AllowNull(false)
  @Column(DataType.UUID)
  sourceId: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  sourceType: string;

  @Column(DataType.VIRTUAL)
  source: Message | Document;

  @BelongsTo(() => Message, { foreignKey: "sourceId", constraints: false })
  message: Message;

  @BelongsTo(() => Document, { foreignKey: "sourceId", constraints: false })
  document: Document;

  @HasOne(() => Audio, "md5")
  audio: Audio;

  @AllowNull(false)
  @Column(DataType.TEXT)
  text: string;

  @AllowNull(true)
  @Column(DataType.INTEGER)
  section: number;

  @AllowNull(true)
  @Column(DataType.INTEGER)
  segment: number;

  @AllowNull(false)
  @Column(DataType.JSON)
  configuration: any;

  @Unique
  @Column(DataType.STRING)
  md5: string;

  @AllowNull(false)
  @Column(DataType.STRING)
  extname: string;

  @Column(DataType.VIRTUAL)
  get engine(): string {
    return this.getDataValue("configuration").engine;
  }

  @Column(DataType.VIRTUAL)
  get model(): string {
    return this.getDataValue("configuration").model;
  }

  @Column(DataType.VIRTUAL)
  get voice(): string {
    return this.getDataValue("configuration").voice;
  }

  @Column(DataType.VIRTUAL)
  get src(): string {
    return `enjoy://${path.posix.join(
      "library",
      "speeches",
      this.getDataValue("md5") + this.getDataValue("extname")
    )}`;
  }

  @Column(DataType.VIRTUAL)
  get filename(): string {
    return this.getDataValue("md5") + this.getDataValue("extname");
  }

  @Column(DataType.VIRTUAL)
  get filePath(): string {
    return path.join(
      settings.userDataPath(),
      "speeches",
      this.getDataValue("md5") + this.getDataValue("extname")
    );
  }

  @AfterFind
  static async findSource(findResult: Speech | Speech[]) {
    if (!Array.isArray(findResult)) findResult = [findResult];

    for (const instance of findResult) {
      if (!instance) continue;
      if (instance.sourceType === "Message" && instance.message !== undefined) {
        instance.source = instance.message;
      } else if (
        instance.sourceType === "Document" &&
        instance.document !== undefined
      ) {
        instance.source = instance.document;
      }
      // To prevent mistakes:
      delete instance.dataValues.message;
      delete instance.dataValues.document;
    }
  }

  @AfterCreate
  static notifyForCreate(speech: Speech) {
    this.notify(speech, "create");
  }

  @AfterDestroy
  static notifyForDestroy(speech: Speech) {
    this.notify(speech, "destroy");
  }

  @AfterDestroy
  static cleanupFile(speech: Speech) {
    fs.remove(speech.filePath);
  }

  static notify(speech: Speech, action: "create" | "update" | "destroy") {
    if (!mainWindow.win) return;

    mainWindow.win.webContents.send("db-on-transaction", {
      model: "Speech",
      id: speech.id,
      action: action,
      record: speech.toJSON(),
    });
  }

  static async generate(params: {
    sourceId: string;
    sourceType: string;
    text: string;
    configuration?: any;
  }): Promise<Speech> {
    const { sourceId, sourceType, text, configuration } = params;
    const {
      engine = "openai",
      model = "tts-1",
      voice = "alloy",
      baseUrl,
    } = configuration || {};
    const resolved = resolveTtsModel(engine, model);
    if (resolved.provider !== "openai" || !resolved.apiModel) {
      throw new Error(
        `TTS model "${String(model).trim()}" must use the renderer speech path.`
      );
    }
    const request = buildOpenAiSpeechRequest({
      engine: resolved.engine,
      model: resolved.model,
      voice,
      text,
    });

    logger.debug("Generating speech", {
      engine: resolved.engine,
      model: resolved.model,
      voice: request.voice,
    });

    const extname = ".mp3";
    const filename = `${Date.now()}${extname}`;
    const filePath = path.join(settings.userDataPath(), "speeches", filename);

    let openaiConfig: ClientOptions;
    if (resolved.engine === "enjoyai") {
      const accessToken = await UserSetting.accessToken();
      if (!accessToken) {
        throw new Error(t("openaiKeyRequired"));
      }
      openaiConfig = {
        apiKey: accessToken,
        baseURL: `${settings.apiUrl()}/api/ai`,
      };
    } else {
      const canonicalConfig = await UserSetting.get(UserSettingKeyEnum.OPENAI);
      const savedConfig = selectCanonicalOpenAiConfig(
        canonicalConfig as LlmProviderType | null | undefined,
        () => settings.getSync("openai") as LlmProviderType | null
      );
      const apiKey =
        savedConfig && typeof savedConfig.key === "string"
          ? savedConfig.key.trim()
          : "";
      if (!apiKey) {
        throw new Error(t("openaiKeyRequired"));
      }
      const configuredBaseUrl =
        typeof baseUrl === "string" ? baseUrl.trim() : "";
      const savedBaseUrl =
        savedConfig && typeof savedConfig.baseUrl === "string"
          ? savedConfig.baseUrl.trim()
          : "";
      openaiConfig = {
        apiKey,
        baseURL: configuredBaseUrl || savedBaseUrl || undefined,
      };
    }

    const { httpAgent, fetch } = proxyAgent();
    const openai = new OpenAI({
      ...openaiConfig,
      httpAgent,
      // @ts-expect-error node-fetch and OpenAI use different RequestInfo types.
      fetch,
    });

    let buffer: ArrayBuffer;
    try {
      const file = await openai.audio.speech.create(request);
      buffer = ensureAudioArrayBuffer(await file.arrayBuffer());
    } catch (error) {
      throw new Error(sanitizeSpeechError(error, openaiConfig.apiKey));
    }
    const audioBuffer = Buffer.from(buffer);
    await fs.outputFile(filePath, audioBuffer);

    const md5 = await hashFile(filePath, { algo: "md5" });
    fs.renameSync(
      filePath,
      path.join(path.dirname(filePath), `${md5}${extname}`)
    );

    return Speech.create({
      sourceId,
      sourceType,
      text,
      extname,
      md5,
      configuration: {
        engine: resolved.engine,
        model: resolved.model,
        voice: request.voice,
      },
    });
  }
}
