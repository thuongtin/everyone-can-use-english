import settings from "electron-settings";
import { LIBRARY_PATH_SUFFIX, DATABASE_NAME } from "@/constants";
import { ipcMain, app } from "electron";
import path from "path";
import fs from "fs-extra";
import { AppSettingsKeyEnum } from "@/types/enums";
import {
  backupDisconnectedProfile,
  backupSettingsFile,
  DEFAULT_LOCAL_PROFILE_ID,
  discoverLocalProfiles,
  LOCAL_PROFILE_MODE,
  normalizeLocalProfile,
  resolveProfileForLibrary,
  type LocalProfile,
} from "@main/local-profile";

if (process.env.SETTINGS_PATH) {
  settings.configure({
    dir: process.env.SETTINGS_PATH,
    prettify: true,
  });
}

const libraryPath = () => {
  const _library = settings.getSync("library");

  if (!_library || typeof _library !== "string") {
    settings.setSync(
      AppSettingsKeyEnum.LIBRARY,
      process.env.LIBRARY_PATH ||
        path.join(app.getPath("documents"), LIBRARY_PATH_SUFFIX)
    );
  } else if (path.parse(_library).base !== LIBRARY_PATH_SUFFIX) {
    settings.setSync(
      AppSettingsKeyEnum.LIBRARY,
      path.join(_library, LIBRARY_PATH_SUFFIX)
    );
  }

  const library = settings.getSync(AppSettingsKeyEnum.LIBRARY) as string;
  fs.ensureDirSync(library);

  return library;
};

const cachePath = () => {
  const tmpDir = path.join(libraryPath(), "cache");
  fs.ensureDirSync(tmpDir);

  return tmpDir;
};

const dbPath = () => {
  if (!userDataPath()) return null;

  const dbName = app.isPackaged
    ? `${DATABASE_NAME}.sqlite`
    : `${DATABASE_NAME}_dev.sqlite`;
  return path.join(userDataPath(), dbName);
};

const databaseNames = () => [
  `${DATABASE_NAME}.sqlite`,
  `${DATABASE_NAME}_dev.sqlite`,
];

const userDataPath = () => {
  const userId = settings.getSync("user.id");
  if (!userId) return null;

  const userData = path.join(libraryPath(), userId.toString());
  fs.ensureDirSync(userData);

  return userData;
};

// Scan the library for profile directories that contain an Enjoy database.
const sessions = (): LocalProfile[] =>
  discoverLocalProfiles(libraryPath(), databaseNames());

const persistLocalProfilePointer = (
  profile: LocalProfile,
  profileIdsToBackup: readonly string[] = [],
) => {
  backupSettingsFile(settings.file());
  for (const profileId of new Set(profileIdsToBackup)) {
    backupDisconnectedProfile(libraryPath(), profileId, databaseNames());
  }
  settings.setSync(AppSettingsKeyEnum.USER, profile);
};

const localProfile = (): LocalProfile | null => {
  const stored = settings.getSync(AppSettingsKeyEnum.USER);
  const current = normalizeLocalProfile(stored);
  const profiles = sessions();
  if (
    current &&
    (profiles.some((profile) => profile.id === current.id) ||
      (profiles.length === 0 && current.id === DEFAULT_LOCAL_PROFILE_ID))
  ) {
    return current;
  }
  const profile = resolveProfileForLibrary(stored, profiles);
  if (!profile) return null;
  persistLocalProfilePointer(profile, profiles.length === 1 ? [profile.id] : []);
  return profile;
};

export default {
  registerIpcHandlers: () => {
    ipcMain.handle("app-settings-get-library", () => {
      libraryPath();
      return settings.getSync(AppSettingsKeyEnum.LIBRARY);
    });

    ipcMain.handle("app-settings-set-library", async (_event, library) => {
      if (typeof library !== "string" || !path.isAbsolute(library)) throw new Error("Invalid library path");
      const dir = path.parse(library).base === LIBRARY_PATH_SUFFIX ? library : path.join(library, LIBRARY_PATH_SUFFIX);
      const { default: db } = await import("@main/db");
      const previousLibrary = libraryPath();
      if (path.resolve(previousLibrary) === path.resolve(dir)) return;
      const previousSettings = settings.getSync();
      const previousUser = previousSettings[AppSettingsKeyEnum.USER];
      const current = normalizeLocalProfile(previousUser);
      let next: LocalProfile | null = null;

      try {
        await db.withDisconnected(() => {
          fs.ensureDirSync(dir);
          backupSettingsFile(settings.file());
          if (current) {
            backupDisconnectedProfile(previousLibrary, current.id, databaseNames());
          }
          const targetProfiles = discoverLocalProfiles(dir, databaseNames());
          next = resolveProfileForLibrary(current, targetProfiles);
          if (next) {
            backupDisconnectedProfile(dir, next.id, databaseNames());
          }

          const nextSettings = { ...previousSettings, [AppSettingsKeyEnum.LIBRARY]: dir };
          if (next) {
            settings.setSync({
              ...nextSettings,
              [AppSettingsKeyEnum.USER]: {
                id: next.id,
                name: next.name,
                ...(next.nameSource ? { nameSource: next.nameSource } : {}),
              },
            });
          } else {
            Reflect.deleteProperty(nextSettings, AppSettingsKeyEnum.USER);
            settings.setSync(nextSettings);
          }
        });

        if (next) await db.connect();
      } catch (error) {
        try {
          await db.withDisconnected(() => settings.setSync(previousSettings));
        } catch {
          // Preserve the original mutation failure for the caller.
        }
        try {
          if (previousUser) await db.connect();
        } catch {
          // Preserve the original mutation failure for the caller.
        }
        throw error;
      }
    });

    ipcMain.handle("app-settings-get-user", () => {
      return localProfile();
    });

    ipcMain.handle("app-settings-set-user", async (_event, user) => {
      const normalized = normalizeLocalProfile(user);
      const next = normalized && {
        ...normalized,
        nameSource: normalized.nameSource || "explicit" as const,
      };
      if (!next) {
        throw new Error("Invalid profile identity");
      }
      const { default: db } = await import("@main/db");
      const current = normalizeLocalProfile(settings.getSync(AppSettingsKeyEnum.USER));
      const switchingProfile = String(current?.id) !== String(next.id);
      await db.withDisconnected(
        () => persistLocalProfilePointer(
          next,
          switchingProfile ? [current?.id, next.id].filter((id): id is string => Boolean(id)) : [],
        ),
        () => switchingProfile,
      );
    });

    ipcMain.handle("app-settings-get-user-data-path", () => {
      return userDataPath();
    });

    ipcMain.handle("app-settings-get-sessions", () => {
      return sessions();
    });
  },
  cachePath,
  libraryPath,
  userDataPath,
  dbPath,
  localProfile,
  localMode: LOCAL_PROFILE_MODE,
  ...settings,
};
