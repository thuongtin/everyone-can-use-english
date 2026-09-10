import {
  AfterUpdate,
  AfterDestroy,
  Table,
  Column,
  Default,
  IsUUID,
  Model,
  DataType,
  AfterCreate,
  Unique,
} from "sequelize-typescript";
import mainWindow from "@main/window";
import log from "@main/logger";
import settings from "@main/settings";
import fs from "fs-extra";
import { t } from "i18next";
import path from "path";
import { DocumentFormats } from "@/constants";
import { enjoyUrlToPath, hashFile } from "@/main/utils";
import { v5 as uuidv5 } from "uuid";
import { fileTypeFromFile } from "file-type";
import mime from "mime-types";

const logger = log.scope("db/models/document");
@Table({
  modelName: "Document",
  tableName: "documents",
  underscored: true,
  timestamps: true,
})
export class Document extends Model<Document> {
  @IsUUID("all")
  @Default(DataType.UUIDV4)
  @Column({ primaryKey: true, type: DataType.UUID })
  id: string;

  @Column(DataType.STRING)
  language: string;

  @Unique
  @Column(DataType.STRING)
  md5: string;

  @Column(DataType.STRING)
  title: string;

  @Column(DataType.STRING)
  coverUrl: string;

  @Column(DataType.STRING)
  source: string;

  @Column(DataType.JSON)
  metadata: Record<string, any>;

  @Column(DataType.JSON)
  config: Record<string, any>;

  @Column(DataType.JSON)
  lastReadPosition: Record<string, any>;

  @Column(DataType.DATE)
  lastReadAt: Date;

  @Column(DataType.DATE)
  syncedAt: Date;

  @Column(DataType.DATE)
  uploadedAt: Date;

  @Column(DataType.VIRTUAL)
  get autoTranslate(): boolean {
    return this.config.autoTranslate || false;
  }

  @Column(DataType.VIRTUAL)
  get autoNextSpeech(): boolean {
    return this.config.autoNextSpeech || false;
  }

  @Column(DataType.VIRTUAL)
  get layout(): "horizontal" | "vertical" {
    return this.config.layout || "horizontal";
  }

  @Column(DataType.VIRTUAL)
  get ttsConfig(): Record<string, any> {
    return this.config.tts || {};
  }

  @Column(DataType.VIRTUAL)
  get filePath(): string {
    const file = path.join(
      settings.userDataPath(),
      "documents",
      `${this.md5}.${this.metadata.extension}`
    );
    if (fs.existsSync(file)) {
      return file;
    }
    return null;
  }

  @Column(DataType.VIRTUAL)
  get src(): string {
    if (!this.filePath) return null;

    return `enjoy://${path.posix.join(
      "library",
      "documents",
      `${this.md5}.${this.metadata.extension}`
    )}`;
  }

  @Column(DataType.VIRTUAL)
  get isSynced(): boolean {
    return Boolean(this.syncedAt) && this.syncedAt >= this.updatedAt;
  }

  @Column(DataType.VIRTUAL)
  get isUploaded(): boolean {
    return Boolean(this.uploadedAt) && this.uploadedAt >= this.updatedAt;
  }

  @AfterCreate
  static notifyForCreate(document: Document) {
    this.notify(document, "create");
  }

  @AfterUpdate
  static notifyForUpdate(document: Document) {
    if (document.changed("config") || document.changed("title")) {
      this.notify(document, "update");
    }
  }

  @AfterDestroy
  static removeLocalFile(document: Document) {
    if (document.filePath) {
      fs.removeSync(document.filePath);
    }
  }

  @AfterDestroy
  static notifyForDestroy(document: Document) {
    this.notify(document, "destroy");
  }

  static async buildFromLocalFile(
    filePath: string,
    params: {
      title?: string;
      config?: Record<string, any>;
      source?: string;
    }
  ): Promise<Document> {
    // Check if file exists
    if (filePath.startsWith("enjoy://")) {
      filePath = enjoyUrlToPath(filePath);
    }
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
    } catch (error) {
      throw new Error(t("models.document.fileNotFound", { file: filePath }));
    }

    // calculate md5
    const md5 = await hashFile(filePath, { algo: "md5" });

    const existing = await Document.findOne({
      where: {
        md5,
      },
    });
    if (existing) {
      return existing;
    }

    // Check if file format is supported
    let mimeType: string;
    let extension: string;
    const fileType = await fileTypeFromFile(filePath);
    if (fileType) {
      mimeType = fileType.mime;
      extension = fileType.ext;
    } else {
      mimeType = mime.lookup(filePath) || "";
      extension = mime.extension(mimeType) || "";
    }

    logger.debug("detected file type", filePath, mimeType, extension);
    if (extension === "zip" && filePath.endsWith(".epub")) {
      extension = "epub";
    } else if (!DocumentFormats.includes(extension)) {
      logger.error("unsupported file type", filePath, extension);
      throw new Error(
        t("models.document.fileNotSupported", { file: filePath })
      );
    }

    // get file's metadata
    const stat = await fs.promises.stat(filePath);

    const metadata = {
      size: stat.size,
      created: stat.birthtime,
      modified: stat.mtime,
      mimeType,
      extension,
      extname: extension,
    };

    // generate ID
    const userId = settings.getSync("user.id");
    const id = uuidv5(`${userId}/${md5}`, uuidv5.URL);

    const destDir = path.join(settings.userDataPath(), "documents");
    fs.ensureDirSync(destDir);
    const destFile = path.join(destDir, `${md5}.${extension}`);

    try {
      // copy file to library
      fs.copyFileSync(filePath, destFile);
    } catch (error) {
      logger.error("failed to copy file", filePath, error);
      throw new Error(
        t("models.document.failedToCopyFile", { file: filePath })
      );
    }

    const {
      title = path.basename(filePath, `.${extension}`),
      config = {
        autoTranslate: false,
        autoNextSpeech: true,
        layout: "horizontal",
        tts: {
          engine: "needs-selection",
        },
      },
      source,
    } = params || {};

    const record = this.build({
      id,
      md5,
      title,
      metadata,
      config,
      source,
    });

    return record.save().catch((err) => {
      // remove copied file
      fs.removeSync(destFile);
      throw err;
    });
  }

  static async notify(
    document: Document,
    action: "create" | "update" | "destroy"
  ) {
    if (!mainWindow.win) return;

    const record = document.toJSON();

    mainWindow.win.webContents.send("db-on-transaction", {
      model: "Document",
      id: document.id,
      action,
      record,
    });
  }
}
