import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppSettingsProviderContext } from "./app-settings-provider";
import { DbProviderContext } from "./db-provider";
import { SttEngineOptionEnum, UserSettingKeyEnum } from "@/types/enums";
import {
  SUPPORTED_LLM_PROVIDER_IDS,
  createDefaultProviderConfigs,
  createGptProviders,
  discoverLocalModels,
  isSupportedProvider,
  normalizeProviderConfig,
  resolveGptEngineBootstrap,
  type AiProviderId,
  type GptProviderCatalog,
  type ProviderConfig,
} from "@/lib/ai-providers";
import { TTS_PROVIDERS } from "@renderer/components/conversations/tts-providers";
import { WHISPER_MODELS } from "@/constants";

const PROVIDER_SETTING_KEYS: Record<AiProviderId, UserSettingKeyEnum> = {
  enjoyai: UserSettingKeyEnum.ENJOYAI,
  openai: UserSettingKeyEnum.OPENAI,
  gemini: UserSettingKeyEnum.GEMINI,
  deepseek: UserSettingKeyEnum.DEEPSEEK,
  openrouter: UserSettingKeyEnum.OPENROUTER,
  ollama: UserSettingKeyEnum.OLLAMA,
  lmstudio: UserSettingKeyEnum.LMSTUDIO,
};

const DEFAULT_GPT_ENGINE: GptEngineSettingType = {
  name: "enjoyai",
  models: {
    default: "gpt-4o",
  },
};

const cloneProviderConfig = (config: ProviderConfig): LlmProviderType => ({
  name: config.name,
  key: config.key,
  model: config.model,
  baseUrl: config.baseUrl,
  models: config.models,
  transcriptionModel: config.transcriptionModel,
});

const createUnknownProviderConfig = (name: string): LlmProviderType => ({
  name,
  key: undefined,
  baseUrl: undefined,
  models: "",
});

const cloneProviderConfigs = (
  configs: Record<AiProviderId, ProviderConfig>
): Record<string, LlmProviderType> =>
  Object.fromEntries(
    SUPPORTED_LLM_PROVIDER_IDS.map((id) => [id, cloneProviderConfig(configs[id])])
  );

const cloneTtsProviders = (): typeof TTS_PROVIDERS =>
  JSON.parse(JSON.stringify(TTS_PROVIDERS)) as typeof TTS_PROVIDERS;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const mergeRemoteTtsProviders = (
  providers: typeof TTS_PROVIDERS,
  remote: unknown
): typeof TTS_PROVIDERS => {
  if (!isObject(remote) || !isObject(remote.enjoyai)) return providers;

  const remoteEnjoyAi = remote.enjoyai;
  const enjoyAi = providers.enjoyai as Record<string, any>;
  if (Array.isArray(remoteEnjoyAi.models)) {
    const models = remoteEnjoyAi.models.filter(
      (model): model is string => typeof model === "string" && model.trim().length > 0
    );
    enjoyAi.models = Array.from(new Set([...(enjoyAi.models || []), ...models]));
  }
  if (isObject(remoteEnjoyAi.voices) && isObject(enjoyAi.voices)) {
    for (const [engine, remoteVoices] of Object.entries(remoteEnjoyAi.voices)) {
      if (!Array.isArray(remoteVoices) || !Array.isArray(enjoyAi.voices[engine])) {
        continue;
      }
      enjoyAi.voices[engine] = [
        ...enjoyAi.voices[engine],
        ...remoteVoices.filter((voice) =>
          typeof voice === "string" ||
          (isObject(voice) &&
            typeof voice.value === "string" &&
            typeof voice.label === "string")
        ),
      ];
    }
  }
  if (Array.isArray(remoteEnjoyAi.configurable)) {
    const allowedOptions = new Set(enjoyAi.configurable || []);
    enjoyAi.configurable = Array.from(
      new Set([
        ...(enjoyAi.configurable || []),
        ...remoteEnjoyAi.configurable.filter(
          (option): option is string =>
            typeof option === "string" && allowedOptions.has(option)
        ),
      ])
    );
  }
  return providers;
};

const normalizeGptEngine = (value: unknown): GptEngineSettingType =>
  resolveGptEngineBootstrap(value, undefined).engine;

type AISettingsProviderState = {
  sttEngine: SttEngineOptionEnum;
  setSttEngine: (name: SttEngineOptionEnum) => Promise<void>;
  openai: LlmProviderType;
  setOpenai: (config: LlmProviderType) => Promise<void>;
  providerConfigs: Record<string, LlmProviderType>;
  getProviderConfig: (name: string) => LlmProviderType;
  setProviderConfig: (name: string, config: LlmProviderType) => Promise<void>;
  setGptEngine: (engine: GptEngineSettingType) => Promise<void>;
  currentGptEngine: GptEngineSettingType;
  gptProviders: GptProviderCatalog;
  ttsProviders: typeof TTS_PROVIDERS;
  ttsConfig: TtsConfigType;
  setTtsConfig: (config: TtsConfigType) => Promise<void>;
  echogardenSttConfig: EchogardenSttConfigType;
  setEchogardenSttConfig: (config: EchogardenSttConfigType) => Promise<void>;
};

const defaultProviderConfigs = createDefaultProviderConfigs();
const initialState: AISettingsProviderState = {
  sttEngine: SttEngineOptionEnum.ENJOY_AZURE,
  setSttEngine: async () => undefined,
  openai: cloneProviderConfig(defaultProviderConfigs.openai),
  setOpenai: async () => undefined,
  providerConfigs: cloneProviderConfigs(defaultProviderConfigs),
  getProviderConfig: (name) =>
    isSupportedProvider(name)
      ? cloneProviderConfig(defaultProviderConfigs[name])
      : createUnknownProviderConfig(name),
  setProviderConfig: async (name) => {
    throw new Error(`Unsupported AI provider: ${name}`);
  },
  setGptEngine: async () => undefined,
  currentGptEngine: {
    ...DEFAULT_GPT_ENGINE,
    models: { ...DEFAULT_GPT_ENGINE.models },
  },
  gptProviders: createGptProviders(defaultProviderConfigs),
  ttsProviders: cloneTtsProviders(),
  ttsConfig: null,
  setTtsConfig: async () => undefined,
  echogardenSttConfig: null,
  setEchogardenSttConfig: async () => undefined,
};

export const AISettingsProviderContext =
  createContext<AISettingsProviderState>(initialState);

export const AISettingsProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { EnjoyApp, user, apiUrl, webApi, learningLanguage } = useContext(
    AppSettingsProviderContext
  );
  const db = useContext(DbProviderContext);
  const [providerConfigs, setProviderConfigs] = useState<
    Record<AiProviderId, ProviderConfig>
  >(defaultProviderConfigs);
  const [remoteGptConfig, setRemoteGptConfig] = useState<unknown>();
  const [discoveredModels, setDiscoveredModels] = useState<
    Partial<Record<AiProviderId, string[]>>
  >({});
  const [ttsProviders, setTtsProviders] = useState<typeof TTS_PROVIDERS>(
    cloneTtsProviders()
  );
  const [sttEngine, setSttEngineState] = useState<SttEngineOptionEnum>(
    SttEngineOptionEnum.ENJOY_AZURE
  );
  const [ttsConfig, setTtsConfigState] = useState<TtsConfigType>(null);
  const [echogardenSttConfig, setEchogardenSttConfigState] =
    useState<EchogardenSttConfigType>(null);
  const [gptEngine, setGptEngineState] =
    useState<GptEngineSettingType>(DEFAULT_GPT_ENGINE);

  const gptProviders = useMemo(
    () => createGptProviders(providerConfigs, remoteGptConfig, discoveredModels),
    [providerConfigs, remoteGptConfig, discoveredModels]
  );
  const publicProviderConfigs = useMemo(
    () => cloneProviderConfigs(providerConfigs),
    [providerConfigs]
  );
  const openai = publicProviderConfigs.openai;

  const getProviderConfig = useCallback(
    (name: string): LlmProviderType => {
      if (!isSupportedProvider(name)) return createUnknownProviderConfig(name);
      return cloneProviderConfig(providerConfigs[name]);
    },
    [providerConfigs]
  );

  const handleSetProviderConfig = useCallback(
    async (name: string, config: LlmProviderType): Promise<void> => {
      if (!isSupportedProvider(name)) {
        throw new Error(`Unsupported AI provider: ${name}`);
      }
      const providerName: AiProviderId = name;
      const previous = providerConfigs[providerName];
      const merged: Record<string, unknown> = { ...previous };
      for (const [key, value] of Object.entries(config)) {
        if (value !== undefined) merged[key] = value;
      }
      const next = normalizeProviderConfig(providerName, {
        ...merged,
        name: providerName,
      });

      await EnjoyApp.userSettings.set(
        PROVIDER_SETTING_KEYS[providerName],
        next
      );
      setProviderConfigs((current) => ({
        ...current,
        [providerName]: next,
      }));
    },
    [EnjoyApp, providerConfigs]
  );

  const handleSetOpenai = useCallback(
    (config: LlmProviderType) =>
      handleSetProviderConfig("openai", {
        ...config,
        name: "openai",
      }),
    [handleSetProviderConfig]
  );

  const handleSetGptEngine = useCallback(
    async (engine: GptEngineSettingType): Promise<void> => {
      const next = normalizeGptEngine(engine);
      await EnjoyApp.userSettings.set(UserSettingKeyEnum.GPT_ENGINE, next);
      setGptEngineState(next);
    },
    [EnjoyApp]
  );

  const handleSetSttEngine = useCallback(
    async (name: SttEngineOptionEnum): Promise<void> => {
      await EnjoyApp.userSettings.set(UserSettingKeyEnum.STT_ENGINE, name);
      setSttEngineState(name);
    },
    [EnjoyApp]
  );

  const handleSetTtsConfig = useCallback(
    async (config: TtsConfigType): Promise<void> => {
      await EnjoyApp.userSettings.set(UserSettingKeyEnum.TTS_CONFIG, config);
      setTtsConfigState(config);
    },
    [EnjoyApp]
  );

  const handleSetEchogardenSttConfig = useCallback(
    async (config: EchogardenSttConfigType): Promise<void> => {
      await EnjoyApp.userSettings.set(UserSettingKeyEnum.ECHOGARDEN, config);
      setEchogardenSttConfigState(config);
    },
    [EnjoyApp]
  );

  const refreshTtsConfig = useCallback(async () => {
    const stored = await EnjoyApp.userSettings.get(UserSettingKeyEnum.TTS_CONFIG);
    if (stored) {
      setTtsConfigState(stored);
      return;
    }

    const config = {
      engine: "enjoyai",
      model: "openai/tts-1",
      voice: "alloy",
      language: learningLanguage,
    } as TtsConfigType;
    await EnjoyApp.userSettings.set(UserSettingKeyEnum.TTS_CONFIG, config);
    setTtsConfigState(config);
  }, [EnjoyApp, learningLanguage]);

  const refreshEchogardenSttConfig = useCallback(async () => {
    let config = await EnjoyApp.userSettings.get(UserSettingKeyEnum.ECHOGARDEN);

    if (!config) {
      let model = "tiny";
      const whisperModel =
        (await EnjoyApp.userSettings.get(UserSettingKeyEnum.WHISPER)) || "";
      if (WHISPER_MODELS.includes(whisperModel)) {
        model = whisperModel;
      } else {
        if (whisperModel.match(/tiny/)) {
          model = "tiny";
        } else if (whisperModel.match(/base/)) {
          model = "base";
        } else if (whisperModel.match(/small/)) {
          model = "small";
        } else if (whisperModel.match(/medium/)) {
          model = "medium";
        } else if (whisperModel.match(/large/)) {
          model = "large-v3-turbo";
        }

        if (
          learningLanguage.match(/en/) &&
          model.match(/tiny|base|small|medium/)
        ) {
          model = `${model}.en`;
        }
      }

      config = {
        engine: "whisper",
        whisper: {
          model,
          temperature: 0.2,
          prompt: "",
          encoderProvider: "cpu",
          decoderProvider: "cpu",
        },
      };
      await EnjoyApp.userSettings.set(UserSettingKeyEnum.ECHOGARDEN, config);
    }
    setEchogardenSttConfigState(config);
  }, [EnjoyApp, learningLanguage]);

  useEffect(() => {
    if (!webApi) return;
    let active = true;
    void (async () => {
      try {
        const config = await webApi.config("gpt_providers");
        if (active) setRemoteGptConfig(config);
      } catch {
        if (active) setRemoteGptConfig(undefined);
      }
    })();
    return () => {
      active = false;
    };
  }, [webApi]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const discovered = await Promise.all(
        (["ollama", "lmstudio"] as const).map(async (provider) => ({
          provider,
          models: await discoverLocalModels(
            provider,
            providerConfigs[provider].baseUrl,
            undefined,
            1500,
            providerConfigs[provider].key
          ),
        }))
      );
      if (!active) return;

      setDiscoveredModels((current) => {
        const next = { ...current };
        for (const result of discovered) {
          if (result.models) next[result.provider] = result.models;
        }
        return next;
      });
    })();
    return () => {
      active = false;
    };
  }, [
    providerConfigs.ollama.baseUrl,
    providerConfigs.lmstudio.baseUrl,
    providerConfigs.lmstudio.key,
  ]);

  useEffect(() => {
    if (!webApi) return;
    let active = true;
    void (async () => {
      const providers = cloneTtsProviders();
      try {
        const remote = await webApi.config("tts_providers_v2");
        mergeRemoteTtsProviders(providers, remote);
      } catch {
        // The bundled TTS catalog remains available when remote config is unavailable.
      }
      if (active) setTtsProviders(providers);
    })();
    return () => {
      active = false;
    };
  }, [webApi]);

  const fetchSettings = useCallback(async () => {
    const [storedSttEngine, storedGptEngine, ...storedProviders] =
      await Promise.all([
        EnjoyApp.userSettings.get(UserSettingKeyEnum.STT_ENGINE),
        EnjoyApp.userSettings.get(UserSettingKeyEnum.GPT_ENGINE),
        ...SUPPORTED_LLM_PROVIDER_IDS.map((id) =>
          EnjoyApp.userSettings.get(PROVIDER_SETTING_KEYS[id])
        ),
      ]);

    if (storedSttEngine) setSttEngineState(storedSttEngine);
    const storedOpenaiConfig =
      storedProviders[SUPPORTED_LLM_PROVIDER_IDS.indexOf("openai")];
    const gptBootstrap = resolveGptEngineBootstrap(
      storedGptEngine,
      storedOpenaiConfig
    );
    if (gptBootstrap.shouldPersist) {
      await EnjoyApp.userSettings.set(
        UserSettingKeyEnum.GPT_ENGINE,
        gptBootstrap.engine
      );
    }
    setGptEngineState(gptBootstrap.engine);

    const next = createDefaultProviderConfigs();
    SUPPORTED_LLM_PROVIDER_IDS.forEach((id, index) => {
      next[id] = normalizeProviderConfig(id, storedProviders[index]);
    });
    setProviderConfigs(next);

    await Promise.all([refreshEchogardenSttConfig(), refreshTtsConfig()]);
  }, [EnjoyApp, refreshEchogardenSttConfig, refreshTtsConfig]);

  useEffect(() => {
    if (db.state !== "connected") return;
    void fetchSettings();
  }, [db.state, fetchSettings]);

  const currentGptEngine = useMemo<GptEngineSettingType>(() => {
    const providerName = gptEngine.name;
    const providerConfig = isSupportedProvider(providerName)
      ? providerConfigs[providerName]
      : undefined;
    const isEnjoyAi = providerName === "enjoyai";
    return {
      name: providerName,
      models: { ...gptEngine.models },
      key: isEnjoyAi ? user?.accessToken : providerConfig?.key,
      baseUrl: isEnjoyAi
        ? apiUrl
          ? `${apiUrl}/api/ai`
          : undefined
        : providerConfig?.baseUrl,
    };
  }, [apiUrl, gptEngine, providerConfigs, user?.accessToken]);

  return (
    <AISettingsProviderContext.Provider
      value={{
        sttEngine,
        setSttEngine: handleSetSttEngine,
        openai,
        setOpenai: handleSetOpenai,
        providerConfigs: publicProviderConfigs,
        getProviderConfig,
        setProviderConfig: handleSetProviderConfig,
        setGptEngine: handleSetGptEngine,
        currentGptEngine,
        gptProviders,
        ttsProviders,
        ttsConfig,
        setTtsConfig: handleSetTtsConfig,
        echogardenSttConfig,
        setEchogardenSttConfig: handleSetEchogardenSttConfig,
      }}
    >
      {children}
    </AISettingsProviderContext.Provider>
  );
};
