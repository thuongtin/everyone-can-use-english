import { resolveUiLanguage, type UiLanguage } from "@/constants/ui-language";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  DISTRIBUTION_CONFIG,
  WEB_API_URL,
  LANGUAGES,
  IPA_MAPPINGS,
} from "@/constants";
import type { DistributionConfig } from "@/constants/distribution";
import { Client } from "@/api";
import i18n from "@renderer/i18n";
import ahoy from "ahoy.js";
import { type Consumer, createConsumer } from "@rails/actioncable";
import { DbProviderContext } from "@renderer/context";
import { UserSettingKeyEnum } from "@/types/enums";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  Button,
} from "@renderer/components/ui";
import { t } from "i18next";
import { redirect } from "react-router-dom";
import { Deposit } from "@renderer/components";
import { syncDbSession } from "@renderer/lib/db-session-sync";

type AppSettingsProviderState = {
  webApi: Client;
  apiUrl?: string;
  setApiUrl?: (url: string) => Promise<void>;
  user: UserType | null;
  initialized: boolean;
  version?: string;
  libraryPath?: string;
  login?: (user: UserType) => void;
  logout?: () => void;
  refreshAccount?: () => Promise<void>;
  setLibraryPath?: (path: string) => Promise<void>;
  EnjoyApp: EnjoyAppType;
  distribution: DistributionConfig;
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
  cable?: Consumer;
  ahoy?: typeof ahoy;
  recorderConfig?: RecorderConfigType;
  setRecorderConfig?: (config: RecorderConfigType) => Promise<void>;
  // remote config
  ipaMappings?: { [key: string]: string };
  displayPreferences?: boolean;
  setDisplayPreferences?: (display: boolean) => void;
  displayDepositDialog?: boolean;
  setDisplayDepositDialog?: (display: boolean) => void;
};

const EnjoyApp = window.__ENJOY_APP__;

const initialState: AppSettingsProviderState = {
  webApi: null,
  user: null,
  initialized: false,
  EnjoyApp: EnjoyApp,
  distribution: DISTRIBUTION_CONFIG,
};

export const AppSettingsProviderContext =
  createContext<AppSettingsProviderState>(initialState);

export const AppSettingsProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [version, setVersion] = useState<string>("");
  const [apiUrl, setApiUrl] = useState<string>(WEB_API_URL);
  const [webApi, setWebApi] = useState<Client>(null);
  const [cable, setCable] = useState<Consumer>();
  const cableRef = useRef<Consumer>();
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
  const [ipaMappings, setIpaMappings] = useState<{ [key: string]: string }>(
    IPA_MAPPINGS
  );
  const [loggingOut, setLoggingOut] = useState<boolean>(false);
  const [displayDepositDialog, setDisplayDepositDialog] =
    useState<boolean>(false);
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

  const fetchApiUrl = async () => {
    const apiUrl = await EnjoyApp.app.apiUrl();
    setApiUrl(apiUrl);
  };

  const autoLogin = async () => {
    const currentUser = await EnjoyApp.appSettings.getUser();
    if (!currentUser) return;

    setUser(currentUser);
  };

  const login = async (user: UserType) => {
    if (!user?.id) return;

    setUser(user);
    if (user.accessToken) {
      // Set current user to App settings
      EnjoyApp.appSettings.setUser({ id: user.id, name: user.name });
    }
  };

  const logout = () => {
    setUser(null);
    EnjoyApp.appSettings.setUser(null);
  };

  const fetchLibraryPath = async () => {
    const dir = await EnjoyApp.appSettings.getLibrary();
    setLibraryPath(dir);
  };

  const setLibraryPathHandler = async (dir: string) => {
    await EnjoyApp.appSettings.setLibrary(dir);
    setLibraryPath(dir);
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

  const setApiUrlHandler = async (url: string) => {
    EnjoyApp.appSettings.setApiUrl(url).then(() => {
      EnjoyApp.app.reload();
    });
  };

  const createCable = async (
    token: string | null | undefined,
    isActive: () => boolean = () => true
  ) => {
    if (!token) return;

    const wsUrl = await EnjoyApp.app.wsUrl();
    if (!isActive()) return;
    const consumer = createConsumer(wsUrl + "/cable?token=" + token);
    if (!isActive()) {
      consumer.disconnect();
      return;
    }
    cableRef.current?.disconnect();
    cableRef.current = consumer;
    setCable(consumer);
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

  const refreshAccount = async () => {
    webApi.me().then((u) => {
      setUser({
        ...user,
        ...u,
      });
    });
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
    fetchApiUrl();
  }, []);

  useEffect(() => {
    if (!apiUrl) return;

    setWebApi(
      new Client({
        baseUrl: apiUrl,
        accessToken: user?.accessToken,
        // Keep the existing server locale contract until Vietnamese is supported.
        locale: "en",
        errorLocale: language,
        onError: (err) => {
          if (user && user.accessToken && err.status == 401) {
            setUser({ ...user, accessToken: null });
          }
        },
      })
    );
  }, [user?.accessToken, apiUrl, language]);

  useEffect(() => {
    if (!apiUrl) return;

    ahoy.configure({
      urlPrefix: apiUrl,
    });
  }, [apiUrl]);

  useEffect(() => {
    if (!webApi) return;

    webApi.config("ipa_mappings").then((mappings) => {
      if (mappings) setIpaMappings(mappings);
    });
  }, [webApi]);

  useEffect(() => {
    if (!user?.id) return;

    let active = true;
    const sessionUserId = user.id;
    const connectAndSync = async () => {
      await syncDbSession(sessionUserId, user.accessToken, {
        connect: () => db.connect?.() || Promise.resolve(undefined),
        isActive: () => active,
        persistAuthenticatedProfile: () =>
          EnjoyApp.userSettings.set(UserSettingKeyEnum.PROFILE, user),
        createCable: () => createCable(user.accessToken, () => active),
        getLocalProfile: () =>
          EnjoyApp.userSettings.get(UserSettingKeyEnum.PROFILE),
        applyLocalProfile: async (profile) => {
          setUser(profile);
          if (!active) return;
          await EnjoyApp.appSettings.setUser({
            id: profile.id,
            name: profile.name,
          });
        },
      });
    };

    void connectAndSync().catch((error) => {
      if (active) console.error(error);
    });

    return () => {
      active = false;
      cableRef.current?.disconnect();
      cableRef.current = undefined;
      setCable(undefined);
      void db.disconnect?.();
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
        version,
        webApi,
        apiUrl,
        setApiUrl: setApiUrlHandler,
        user,
        login,
        logout: () => setLoggingOut(true),
        refreshAccount,
        libraryPath,
        setLibraryPath: setLibraryPathHandler,
        proxy,
        setProxy: setProxyConfigHandler,
        vocabularyConfig,
        setVocabularyConfig: setVocabularyConfigHandler,
        initialized: Boolean(user && db.state === "connected" && libraryPath),
        ahoy,
        cable,
        recorderConfig,
        setRecorderConfig: setRecorderConfigHandler,
        ipaMappings,
        displayPreferences,
        setDisplayPreferences,
        displayDepositDialog,
        setDisplayDepositDialog,
      }}
    >
      {children}

      <AlertDialog open={loggingOut} onOpenChange={setLoggingOut}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("logout")}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {t("logoutConfirmation")}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive-hover"
              onClick={() => {
                logout();
                redirect("/landing");
              }}
            >
              {t("logout")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={displayDepositDialog}
        onOpenChange={setDisplayDepositDialog}
      >
        <DialogContent className="max-h-full overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("deposit")}</DialogTitle>
            <DialogDescription>{t("depositDescription")}</DialogDescription>
          </DialogHeader>

          {displayDepositDialog && <Deposit />}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">{t("close")}</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppSettingsProviderContext.Provider>
  );
};
