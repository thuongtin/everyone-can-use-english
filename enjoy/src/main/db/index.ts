import { createMigrationBackup } from "./migration-backup";
import { localStudyHandler } from "./handlers/local-study-handler";
import { ipcMain } from "electron";
import settings from "@main/settings";
import { Sequelize } from "sequelize-typescript";
import { Umzug, SequelizeStorage, Resolver, RunnableMigration } from "umzug";
import {
  Audio,
  Recording,
  CacheObject,
  Chat,
  ChatAgent,
  ChatMember,
  ChatMessage,
  Conversation,
  Document,
  Message,
  Note,
  PronunciationAssessment,
  Segment,
  Speech,
  Transcription,
  Video,
  UserSetting,
} from "./models";
import {
  audiosHandler,
  cacheObjectsHandler,
  chatAgentsHandler,
  chatMembersHandler,
  chatMessagesHandler,
  chatsHandler,
  conversationsHandler,
  documentsHandler,
  messagesHandler,
  notesHandler,
  pronunciationAssessmentsHandler,
  recordingsHandler,
  segmentsHandler,
  speechesHandler,
  transcriptionsHandler,
  videosHandler,
  userSettingsHandler,
} from "./handlers";
import os from "os";
import path from "path";
import { i18n } from "@main/i18n";
import { UserSettingKeyEnum } from "@/types/enums";
import log from "@main/logger";
import fs from "fs-extra";
import { LearningRuntime } from "../learning/runtime";
import { createConfiguredLearningSpeechProvider } from "../learning/speech-configuration";

const __dirname = import.meta.dirname;
const logger = log.scope("DB");

const db = {
  connection: null as Sequelize | null,
  learning: null as LearningRuntime | null,
  connect: async () => {},
  disconnect: async (_connectionId?: string) => {},
  shutdown: async () => {},
  withDisconnected: async (_change: () => Promise<void> | void, _shouldDisconnect?: () => boolean) => {},
  registerIpcHandlers: () => {},
  isConnecting: false,
  backup: async (options?: { force: boolean }) => {},
  restore: async (backupFilePath: string) => {},
};

let lifecycleTail: Promise<void> = Promise.resolve();
let shuttingDown = false;
const serializeLifecycle = <T>(action: () => Promise<T>): Promise<T> => {
  const operation = lifecycleTail.then(action);
  lifecycleTail = operation.then((): void => undefined, (): void => undefined);
  return operation;
};

const handlers = [
  localStudyHandler,
  audiosHandler,
  cacheObjectsHandler,
  chatAgentsHandler,
  chatMembersHandler,
  chatMessagesHandler,
  chatsHandler,
  conversationsHandler,
  documentsHandler,
  messagesHandler,
  notesHandler,
  pronunciationAssessmentsHandler,
  recordingsHandler,
  segmentsHandler,
  speechesHandler,
  transcriptionsHandler,
  userSettingsHandler,
  videosHandler,
];

const connectInternal = async () => {
  if (shuttingDown) throw new Error("Database is shutting down");
  // Use a lock to prevent concurrent connections
  if (db.isConnecting) {
    throw new Error("Database connection is already in progress");
  }

  db.isConnecting = true;
  let opening: Sequelize | undefined;
  let learning: LearningRuntime | undefined;

  try {
    if (db.connection) {
      return;
    }
    const dbPath = settings.dbPath();
    if (!dbPath) {
      throw new Error("Db path is not ready");
    }

    const sequelize = new Sequelize({
      dialect: "sqlite",
      storage: dbPath,
      logging: false,
      models: [
        Audio,
        CacheObject,
        Chat,
        ChatAgent,
        ChatMember,
        ChatMessage,
        Conversation,
        Document,
        Message,
        Note,
        PronunciationAssessment,
        Recording,
        Segment,
        Speech,
        Transcription,
        UserSetting,
        Video,
      ],
    });
    opening = sequelize;

    const migrationResolver: Resolver<unknown> = ({
      name,
      path: filepath,
      context,
    }) => {
      if (!filepath) {
        throw new Error(
          `Can't use default resolver for non-filesystem migrations`
        );
      }

      const loadModule: () => Promise<
        RunnableMigration<unknown>
      > = async () => {
        if (os.platform() === "win32") {
          return import(`file://${filepath}`) as Promise<
            RunnableMigration<unknown>
          >;
        } else {
          return import(filepath) as Promise<RunnableMigration<unknown>>;
        }
      };

      const getModule = async () => {
        return await loadModule();
      };

      return {
        name,
        path: filepath,
        up: async () =>
          (await getModule()).up({ path: filepath, name, context }),
        down: async () =>
          (await getModule()).down?.({ path: filepath, name, context }),
      };
    };

    const umzug = new Umzug({
      migrations: {
        glob: ["migrations/*.js", { cwd: __dirname }],
        resolve: migrationResolver,
      },
      context: sequelize.getQueryInterface(),
      storage: new SequelizeStorage({ sequelize }),
      logger: logger,
    });

    const pendingMigrations = await umzug.pending();
    logger.info(pendingMigrations);
    if (pendingMigrations.length > 0) {
      try {
        await createMigrationBackup({ sequelize, databasePath: dbPath, backupDirectory: path.join(settings.userDataPath(), "backup") });
      } catch (err) {
        logger.error("Required pre-migration backup failed", err);
        throw err;
      }
      try {
        // migrate up to the latest state
        await umzug.up();
      } catch (err) {
        logger.error(err);
        await sequelize.close();
        throw err;
      }

      const pendingMigrationTimestamp = pendingMigrations[0].name.split("-")[0];
      if (parseInt(pendingMigrationTimestamp) <= 1725411577564) {
        // migrate settings
        logger.info("Migrating settings");
        await UserSetting.migrateFromSettings();
      }

      if (parseInt(pendingMigrationTimestamp) <= 1726781106038) {
        // migrate chat agents
        logger.info("Migrating chat agents");
        await ChatAgent.migrateConfigToChatMember();
      }
    } else {
      await db.backup();
    }

    await sequelize.query("PRAGMA foreign_keys = false;");
    await sequelize.sync();
    await sequelize.authenticate();
    await UserSetting.migrateProviderSelections();

    // vacuum the database
    logger.info("Vacuuming the database");
    await sequelize.query("VACUUM");

    // initialize i18n
    const language = (await UserSetting.get(
      UserSettingKeyEnum.LANGUAGE
    )) as string;
    i18n(language);

    const userDataPath = settings.userDataPath();
    const profileId = settings.getSync("user.id");
    if (!userDataPath || !profileId) throw new Error("Database profile is not ready");
    // Canonicalize the selected library parent; the owned asset subtree still rejects symlinks.
    const canonicalUserDataPath = await fs.realpath(userDataPath);
    learning = await LearningRuntime.open({
      sequelize,
      profileId: String(profileId),
      assetRoot: path.join(canonicalUserDataPath, "learning-assets"),
      speechProviderFactory: createConfiguredLearningSpeechProvider,
    });

    localStudyHandler.connect({ sequelize, profileId: String(profileId) });

    // register handlers
    logger.info(`Registering handlers`);
    for (const handler of handlers) {
      handler.register();
    }

    db.connection = sequelize;
    db.learning = learning;
    logger.info("Database connection established");
  } catch (err) {
    for (const handler of handlers) handler.unregister();
    await learning?.close();
    if (opening && db.connection !== opening) await opening.close().catch((): void => undefined);
    logger.error(err);
    throw err;
  } finally {
    db.isConnecting = false;
  }
};

const disconnectInternal = async (connectionId?: string) => {
  if (connectionId && db.learning?.scope.context.connectionId !== connectionId) return;
  // The connection remains available for draining writes until all owned work has stopped.
  await db.learning?.close();
  // unregister handlers
  for (const handler of handlers) {
    handler.unregister();
  }

  await db.connection?.close();
  db.connection = null;
  db.learning = null;
};

db.connect = () => serializeLifecycle(connectInternal);
db.disconnect = (connectionId) => serializeLifecycle(() => disconnectInternal(connectionId));
db.shutdown = () => {
  shuttingDown = true;
  return serializeLifecycle(() => disconnectInternal());
};
db.withDisconnected = (change, shouldDisconnect = () => true) => serializeLifecycle(async () => {
  if (shuttingDown) throw new Error("Database is shutting down");
  if (shouldDisconnect()) await disconnectInternal();
  await change();
});

db.backup = async (options?: { force: boolean }) => {
  const force = options?.force ?? false;

  const dbPath = settings.dbPath();
  if (!dbPath) {
    logger.error("Db path is not ready");
    return;
  }

  const backupPath = path.join(settings.userDataPath(), "backup");
  fs.ensureDirSync(backupPath);

  const backupFiles = fs
    .readdirSync(backupPath)
    .filter((file) => file.startsWith(path.basename(dbPath)))
    .sort();

  // Check if the last backup is older than 1 day
  const lastBackup = backupFiles.pop();
  const timestamp = lastBackup?.match(/\d{13}/)?.[0];
  if (
    !force &&
    lastBackup &&
    timestamp &&
    new Date(parseInt(timestamp)) > new Date(Date.now() - 1000 * 60 * 60 * 24)
  ) {
    logger.info(`Backup is up to date: ${lastBackup}`);
    return;
  }

  // Only keep the latest 10 backups
  if (backupFiles.length >= 10) {
    fs.removeSync(path.join(backupPath, backupFiles[0]));
  }

  const backupFilePath = path.join(
    backupPath,
    `${path.basename(dbPath)}.${Date.now().toString().padStart(13, "0")}`
  );
  fs.copySync(dbPath, backupFilePath);

  logger.info(`Backup created at ${backupFilePath}`);
};

db.restore = (backupFilePath: string) => serializeLifecycle(async () => {
  if (shuttingDown) throw new Error("Database is shutting down");
  const dbPath = settings.dbPath();
  if (!dbPath) {
    logger.error("Db path is not ready");
    return;
  }

  if (!fs.existsSync(backupFilePath)) {
    logger.error(`Backup file not found at ${backupFilePath}`);
    return;
  }

  try {
    await disconnectInternal();

    fs.copySync(backupFilePath, dbPath);
    logger.info(`Database restored from ${backupFilePath}`);
  } catch (err) {
    logger.error(err);
    throw err;
  } finally {
    await connectInternal();
  }
});

db.registerIpcHandlers = () => {
  ipcMain.handle("db-connect", async () => {
    if (db.isConnecting)
      return {
        state: "connecting",
        path: settings.dbPath(),
        error: null as string | null,
      };

    try {
      return await serializeLifecycle(async () => {
        await connectInternal();
        return {
          state: "connected",
          path: settings.dbPath(),
          error: null as string | null,
          connectionId: db.learning?.scope.context.connectionId,
          profileId: db.learning?.scope.context.profileId,
        };
      });
    } catch (err) {
      return {
        state: "error",
        error: err.message,
        path: settings.dbPath(),
      };
    }
  });

  ipcMain.handle("db-disconnect", async (_event, connectionId?: string) => {
    if (typeof connectionId !== "string" || !connectionId) return;
    await db.disconnect(connectionId);
  });

  ipcMain.handle("db-backup", async () => {
    await serializeLifecycle(() => db.backup());
  });

  ipcMain.handle("db-restore", async (_, backupFilePath: string) => {
    await db.restore(backupFilePath);
  });
};

export default db;
