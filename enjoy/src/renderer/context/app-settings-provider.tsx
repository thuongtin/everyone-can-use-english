import { resolveUiLanguage, type UiLanguage } from "@/constants/ui-language";
import { createContext, useContext, useEffect, useState } from "react";
import {
  DISTRIBUTION_CONFIG,
  LANGUAGES,
  IPA_MAPPINGS,
  LIBRARY_PATH_SUFFIX,
} from "@/constants";
import type { DistributionConfig } from "@/constants/distribution";
import { LOCAL_PROFILE_MODE } from "@/constants/runtime";
import i18n from "@renderer/i18n";

import { DbProviderContext } from "@renderer/context";
import { UserSettingKeyEnum } from "@/types/enums";
import { syncDbSession } from "@renderer/lib/db-session-sync";
import { toast } from "sonner";

type AppSettingsProviderState = {
  user: UserType | null;
  initialized: boolean;
  version?: string;
  libraryPath?: string;
  login?: (user: UserType) => Promise<void>;
  setLibraryPath?: (path: string) => Promise<void>;
  EnjoyApp: EnjoyAppType;
  distribution: DistributionConfig;
  localMode: boolean;
  language?: UiLanguage;
  savedUiLanguage?: string;
  switchLanguage?: (language: UiLanguage) => void;
  nativeLanguage?: string;
  switchNativeLanguage?: (lang: string) => void;
  learningLanguage?: string;
  switchLearningLanguage?: (lang: string) => void;
  proxy?: ProxyConfigType;
  setProxy?: (config: ProxyConfigType) => Promise<void>;
  vocabularyConfig?: VocabularyConfigType;
  setVocabularyConfig?: (config: VocabularyConfigType) => Promise<void>;

  recorderConfig?: RecorderConfigType;
  setRecorderConfig?: (config: RecorderConfigType) => Promise<void>;
  // remote config
  ipaMappings?: { [key: string]: string };
  displayPreferences?: boolean;
  setDisplayPreferences?: (display: boolean) => void;
};

const EnjoyApp = window.__ENJOY_APP__;

const initialState: AppSettingsProviderState = {
  user: null,
  initialized: false,
  EnjoyApp: EnjoyApp,
  distribution: DISTRIBUTION_CONFIG,
  localMode: LOCAL_PROFILE_MODE,
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Không thể cập nhật phiên làm việc";
};

const canonicalLibraryPath = (value: string | null | undefined): string => {
  const normalized = String(value || "")
    .replaceAll("\\", "/")
    .replace(/\/+$/u, "");
  if (!normalized) return "";
  const suffix = `/${LIBRARY_PATH_SUFFIX}`;
  return normalized.endsWith(suffix) ? normalized : `${normalized}${suffix}`;
};

export const AppSettingsProviderContext =
  createContext<AppSettingsProviderState>(initialState);

export const AppSettingsProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [version, setVersion] = useState<string>("");
  const [user, setUser] = useState<UserType | null>(null);
  const [libraryPath, setLibraryPath] = useState("");
  const [language, setLanguage] = useState<UiLanguage>("vi");
  const [savedUiLanguage, setSavedUiLanguage] = useState<string>();
  const [nativeLanguage, setNativeLanguage] = useState<string>("vi-VN");
  const [learningLanguage, setLearningLanguage] = useState<string>("en-US");
  const [vocabularyConfig, setVocabularyConfig] =
    useState<VocabularyConfigType>(null);
  const [proxy, setProxy] = useState<ProxyConfigType>();
  const [recorderConfig, setRecorderConfig] = useState<RecorderConfigType>();
  const [ipaMappings] = useState<{ [key: string]: string }>(
    IPA_MAPPINGS
  );
  const [displayPreferences, setDisplayPreferences] = useState<boolean>(false);

  const db = useContext(DbProviderContext);

  const fetchLanguages = async () => {
    const language = await EnjoyApp.userSettings.get(
      UserSettingKeyEnum.LANGUAGE
    );
    const uiLanguage = resolveUiLanguage(language);
    setSavedUiLanguage(language);
    setLanguage(uiLanguage);
    i18n.changeLanguage(uiLanguage);

    const _nativeLanguage =
      (await EnjoyApp.userSettings.get(UserSettingKeyEnum.NATIVE_LANGUAGE)) ||
      "vi-VN";
    setNativeLanguage(_nativeLanguage);

    const _learningLanguage =
      (await EnjoyApp.userSettings.get(UserSettingKeyEnum.LEARNING_LANGUAGE)) ||
      "en-US";
    setLearningLanguage(_learningLanguage);
  };

  const switchLanguage = (language: UiLanguage) => {
    EnjoyApp.userSettings
      .set(UserSettingKeyEnum.LANGUAGE, language)
      .then(() => {
        i18n.changeLanguage(language);
        setLanguage(language);
        setSavedUiLanguage(language);
      });
  };

  const switchNativeLanguage = (lang: string) => {
    if (LANGUAGES.findIndex((l) => l.code == lang) < 0) return;
    if (lang == learningLanguage) return;

    setNativeLanguage(lang);
    EnjoyApp.userSettings.set(UserSettingKeyEnum.NATIVE_LANGUAGE, lang);
  };

  const switchLearningLanguage = (lang: string) => {
    if (LANGUAGES.findIndex((l) => l.code == lang) < 0) return;
    if (lang == nativeLanguage) return;

    EnjoyApp.userSettings.set(UserSettingKeyEnum.LEARNING_LANGUAGE, lang);
    setLearningLanguage(lang);
  };

  const fetchVersion = async () => {
    const version = EnjoyApp.app.version;
    setVersion(version);
  };

  const autoLogin = async () => {
    const currentUser = await EnjoyApp.appSettings.getUser();
    if (!currentUser) return;

    setUser({
      id: String(currentUser.id),
      name: currentUser.name || "Local",
      nameSource: currentUser.nameSource,
    });
  };

  const login = async (nextUser: UserType) => {
    if (!nextUser?.id) return;

    const previousUser = user;
    const switchingProfile = Boolean(
      previousUser?.id && String(previousUser.id) !== String(nextUser.id)
    );
    const renamingConnectedProfile = Boolean(
      previousUser?.id &&
      String(previousUser.id) === String(nextUser.id) &&
      db.state === "connected"
    );
    try {
      if (switchingProfile) await db.disconnect?.();
      await EnjoyApp.appSettings.setUser({
        id: nextUser.id,
        name: nextUser.name,
        nameSource: "explicit",
      });
      if (renamingConnectedProfile) {
        await EnjoyApp.userSettings.set(UserSettingKeyEnum.PROFILE, {
          id: String(nextUser.id),
          name: nextUser.name || "Local",
          nameSource: "explicit",
        });
      }
      setUser({
        id: String(nextUser.id),
        name: nextUser.name || "Local",
        nameSource: "explicit",
      });
    } catch (error) {
      toast.error(`Không thể đăng nhập: ${errorMessage(error)}`);
      if (switchingProfile && previousUser?.id) {
        try {
          await db.connect?.();
        } catch (reconnectError) {
          console.error("Failed to restore the previous database session", reconnectError);
        }
      }
      throw error;
    }
  };

  const fetchLibraryPath = async () => {
    const dir = await EnjoyApp.appSettings.getLibrary();
    setLibraryPath(dir);
  };

  const setLibraryPathHandler = async (dir: string) => {
    const libraryChanged = canonicalLibraryPath(libraryPath) !== canonicalLibraryPath(dir);
    const shouldReconnect = Boolean(user?.id && libraryChanged);
    try {
      if (shouldReconnect) await db.disconnect?.();
      await EnjoyApp.appSettings.setLibrary(dir);
      const persistedPath = await EnjoyApp.appSettings.getLibrary();
      setLibraryPath(persistedPath || dir);
      if (shouldReconnect) await db.connect?.();
    } catch (error) {
      toast.error(`Không thể đổi thư viện: ${errorMessage(error)}`);
      if (shouldReconnect) {
        try {
          await db.connect?.();
        } catch (reconnectError) {
          console.error("Failed to restore the database after library change", reconnectError);
        }
      }
    }
  };

  const fetchProxyConfig = async () => {
    const config = await EnjoyApp.system.proxy.get();
    setProxy(config);
    EnjoyApp.system.proxy.refresh();
  };

  const setProxyConfigHandler = async (config: ProxyConfigType) => {
    EnjoyApp.system.proxy.set(config).then(() => {
      setProxy(config);
      EnjoyApp.system.proxy.refresh();
    });
  };

  const fetchRecorderConfig = async () => {
    const config = await EnjoyApp.userSettings.get(UserSettingKeyEnum.RECORDER);
    if (config) {
      setRecorderConfig(config);
    } else {
      const defaultConfig: RecorderConfigType = {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
        sampleSize: 16,
      };
      setRecorderConfigHandler(defaultConfig);
    }
  };

  const setRecorderConfigHandler = async (config: RecorderConfigType) => {
    return EnjoyApp.userSettings
      .set(UserSettingKeyEnum.RECORDER, config)
      .then(() => {
        setRecorderConfig(config);
      });
  };

  const fetchVocabularyConfig = async () => {
    EnjoyApp.userSettings
      .get(UserSettingKeyEnum.VOCABULARY)
      .then((config) => {
        setVocabularyConfig(config || { lookupOnMouseOver: true });
      })
      .catch((err) => {
        console.error(err);
        setVocabularyConfig({ lookupOnMouseOver: true });
      });
  };

  const setVocabularyConfigHandler = async (config: VocabularyConfigType) => {
    await EnjoyApp.userSettings.set(UserSettingKeyEnum.VOCABULARY, config);
    setVocabularyConfig(config);
  };

  useEffect(() => {
    if (db.state === "connected") {
      fetchLanguages();
      fetchVocabularyConfig();
      fetchRecorderConfig();
    }
  }, [db.state]);

  useEffect(() => {
    autoLogin();
    fetchVersion();
    fetchLibraryPath();
    fetchProxyConfig();
  }, []);

  useEffect(() => {
    if (!user?.id) return;

    let active = true;
    const sessionUserId = user.id;
    const connectAndSync = async () => {
      await syncDbSession({
        id: sessionUserId,
        name: user.name,
        nameSource: user.nameSource,
      }, {
        connect: () => db.connect?.() || Promise.resolve(undefined),
        isActive: () => active,
        getLocalProfile: () =>
          EnjoyApp.userSettings.get(UserSettingKeyEnum.PROFILE),
        applyLocalProfile: async (profile) => {
          if (!active) return;
          await EnjoyApp.userSettings.set(UserSettingKeyEnum.PROFILE, profile);
          if (!active) return;
          await EnjoyApp.appSettings.setUser({
            id: profile.id,
            name: profile.name,
            nameSource: profile.nameSource,
          });
          if (!active) return;
          setUser({
            id: String(profile.id),
            name: profile.name || "Local",
            nameSource: profile.nameSource,
          });
        },
      });
    };

    void connectAndSync().catch((error) => {
      if (active) console.error(error);
    });

    return () => {
      active = false;
      void db.disconnect?.().catch((error) => {
        console.error("Failed to disconnect the database session", error);
      });
    };
  }, [user?.id]);

  return (
    <AppSettingsProviderContext.Provider
      value={{
        language,
        savedUiLanguage,
        switchLanguage,
        nativeLanguage,
        switchNativeLanguage,
        learningLanguage,
        switchLearningLanguage,
        EnjoyApp,
        distribution: DISTRIBUTION_CONFIG,
        localMode: LOCAL_PROFILE_MODE,
        version,
        user,
        login,
        libraryPath,
        setLibraryPath: setLibraryPathHandler,
        proxy,
        setProxy: setProxyConfigHandler,
        vocabularyConfig,
        setVocabularyConfig: setVocabularyConfigHandler,
        initialized: Boolean(user && db.state === "connected" && libraryPath),
        recorderConfig,
        setRecorderConfig: setRecorderConfigHandler,
        ipaMappings,
        displayPreferences,
        setDisplayPreferences,
      }}
    >
      {children}

    </AppSettingsProviderContext.Provider>
  );
};
