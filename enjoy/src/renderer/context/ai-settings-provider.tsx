import { t } from "i18next";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  PROVIDER_SELECTION_REQUIRED,
  resolveGptEngineBootstrap,
  type AiProviderId,
  type GptProviderCatalog,
  type ProviderConfig,
} from "@/lib/ai-providers";
import { TTS_PROVIDERS } from "@renderer/components/conversations/tts-providers";
import { WHISPER_MODELS } from "@/constants";
import type { AcpBridge, AcpConnectionStatus } from "@/types/acp-api";
import {
  resolveSynthesisProviderSelection,
  createProviderSelectionRequestGuard,
  createProviderSelectionRequiredTtsConfig,
  resolveTextProviderSelection,
  resolveTranscriptionProviderSelection,
  type ProviderSelectionState,
  type SynthesisProviderBinding,
  type TextProviderBinding,
  type ProviderSelectionRequestToken,
} from "@/lib/provider-selection-migration";

const PROVIDER_SETTING_KEYS: Record<AiProviderId, UserSettingKeyEnum> = {
  "azure-openai": UserSettingKeyEnum.AZURE_OPENAI,
  openai: UserSettingKeyEnum.OPENAI,
  gemini: UserSettingKeyEnum.GEMINI,
  "vertex-express": UserSettingKeyEnum.VERTEX_EXPRESS,
  deepseek: UserSettingKeyEnum.DEEPSEEK,
  openrouter: UserSettingKeyEnum.OPENROUTER,
  ollama: UserSettingKeyEnum.OLLAMA,
  lmstudio: UserSettingKeyEnum.LMSTUDIO,
  "codex-acp": UserSettingKeyEnum.CODEX_ACP,
  "claude-acp": UserSettingKeyEnum.CLAUDE_ACP,
};

const UNAVAILABLE_ACP_STATUSES: AcpConnectionStatus[] = [
  {
    provider: "codex",
    available: false,
    reason: "ACP runtime chưa sẵn sàng.",
    models: [],
    currentModel: null,
  },
  {
    provider: "claude",
    available: false,
    reason: "ACP runtime chưa sẵn sàng.",
    models: [],
    currentModel: null,
  },
];

const ACP_REASON_TEXT: Record<string, string> = {
  native_binary_missing: "Không tìm thấy CLI tương ứng trên máy.",
  native_auth_unconfirmed: "CLI chưa xác nhận được phiên đăng nhập hiện có.",
  native_version_unsupported: "Phiên bản CLI hiện tại chưa hỗ trợ ACP.",
  native_probe_failed: "Không thể kiểm tra ACP runtime.",
  acp_probe_failed: "ACP runtime không trả về trạng thái hợp lệ.",
};

const localizeAcpReason = (reason: string | null): string | null =>
  reason ? ACP_REASON_TEXT[reason] || reason : null;

const DEFAULT_GPT_ENGINE: GptEngineSettingType = {
  name: PROVIDER_SELECTION_REQUIRED,
  models: {
    default: "",
  },
};

const cloneProviderConfig = (config: ProviderConfig): LlmProviderType => ({
  name: config.name,
  key: config.key,
  model: config.model,
  baseUrl: config.baseUrl,
  models: config.models,
  transcriptionModel: config.transcriptionModel,
  credentialError: config.credentialError,
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

const cloneTtsProviders = (): typeof TTS_PROVIDERS => {
  const providers = JSON.parse(JSON.stringify(TTS_PROVIDERS)) as typeof TTS_PROVIDERS;
  delete providers.enjoyai;
  return providers;
};

const normalizeGptEngine = (value: unknown): GptEngineSettingType =>
  resolveGptEngineBootstrap(value, undefined).engine;

type AISettingsProviderState = {
  sttEngine: SttEngineOptionEnum | null;
  setSttEngine: (name: SttEngineOptionEnum) => Promise<void>;
  openai: LlmProviderType;
  setOpenai: (config: LlmProviderType) => Promise<void>;
  providerConfigs: Record<string, LlmProviderType>;
  getProviderConfig: (name: string) => LlmProviderType;
  setProviderConfig: (name: string, config: LlmProviderType) => Promise<void>;
  setGptEngine: (engine: GptEngineSettingType) => Promise<void>;
  currentGptEngine: GptEngineSettingType;
  textSelection: ProviderSelectionState<TextProviderBinding>;
  transcriptionSelection: ProviderSelectionState<string>;
  synthesisSelection: ProviderSelectionState<SynthesisProviderBinding>;
  acpStatuses: AcpConnectionStatus[];
  acpStatusLoading: boolean;
  refreshAcpStatus: () => Promise<void>;
  gptProviders: GptProviderCatalog;
  ttsProviders: typeof TTS_PROVIDERS;
  ttsConfig: TtsConfigType;
  setTtsConfig: (config: TtsConfigType) => Promise<void>;
  echogardenSttConfig: EchogardenSttConfigType;
  setEchogardenSttConfig: (config: EchogardenSttConfigType) => Promise<void>;
};

const defaultProviderConfigs = createDefaultProviderConfigs();
const initialState: AISettingsProviderState = {
  sttEngine: null,
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
  textSelection: { status: "unconfigured" },
  transcriptionSelection: { status: "unconfigured" },
  synthesisSelection: { status: "unconfigured" },
  gptProviders: createGptProviders(defaultProviderConfigs),
  acpStatuses: UNAVAILABLE_ACP_STATUSES,
  acpStatusLoading: false,
  refreshAcpStatus: async () => undefined,
  ttsProviders: cloneTtsProviders(),
  ttsConfig: createProviderSelectionRequiredTtsConfig(),
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
  const { EnjoyApp, learningLanguage } = useContext(
    AppSettingsProviderContext
  );
  const db = useContext(DbProviderContext);
  const requestGuard = useRef(createProviderSelectionRequestGuard()).current;
  const requestScope = [
    db.state,
    db.connection?.connectionId || "",
    db.connection?.profileId || "",
    db.path || "",
  ].join(":");
  requestGuard.activate(requestScope);
  const [providerConfigs, setProviderConfigs] = useState<
    Record<AiProviderId, ProviderConfig>
  >(defaultProviderConfigs);
  const [discoveredModels, setDiscoveredModels] = useState<
    Partial<Record<AiProviderId, string[]>>
  >({});
  const [acpStatuses, setAcpStatuses] = useState<AcpConnectionStatus[]>(
    UNAVAILABLE_ACP_STATUSES
  );
  const [acpStatusLoading, setAcpStatusLoading] = useState(false);
  const [ttsProviders] = useState<typeof TTS_PROVIDERS>(
    cloneTtsProviders()
  );
  const [sttEngine, setSttEngineState] = useState<SttEngineOptionEnum | null>(null);
  const [ttsConfig, setTtsConfigState] = useState<TtsConfigType>(() =>
    createProviderSelectionRequiredTtsConfig(learningLanguage)
  );
  const [transcriptionSelection, setTranscriptionSelection] = useState<
    ProviderSelectionState<string>
  >({ status: "unconfigured" });
  const [synthesisSelection, setSynthesisSelection] = useState<
    ProviderSelectionState<SynthesisProviderBinding>
  >({ status: "unconfigured" });
  const [echogardenSttConfig, setEchogardenSttConfigState] =
    useState<EchogardenSttConfigType>(null);
  const [gptEngine, setGptEngineState] =
    useState<GptEngineSettingType>(DEFAULT_GPT_ENGINE);
  const [loadedScope, setLoadedScope] = useState("");
  const profileReady = db.state === "connected" && loadedScope === requestScope;

  const resetProfileState = useCallback(() => {
    setProviderConfigs(createDefaultProviderConfigs());
    setDiscoveredModels({});
    setAcpStatuses(UNAVAILABLE_ACP_STATUSES);
    setAcpStatusLoading(false);
    setSttEngineState(null);
    setTranscriptionSelection({ status: "unconfigured" });
    setTtsConfigState(createProviderSelectionRequiredTtsConfig(learningLanguage));
    setSynthesisSelection({ status: "unconfigured" });
    setEchogardenSttConfigState(null);
    setGptEngineState(DEFAULT_GPT_ENGINE);
    setLoadedScope("");
  }, [learningLanguage]);

  const gptProviders = useMemo(
    () => createGptProviders(providerConfigs, undefined, discoveredModels),
    [providerConfigs, discoveredModels]
  );
  const loadedProviderConfigs = useMemo(
    () => cloneProviderConfigs(providerConfigs),
    [providerConfigs]
  );
  const publicProviderConfigs = useMemo(
    () => profileReady
      ? loadedProviderConfigs
      : cloneProviderConfigs(defaultProviderConfigs),
    [loadedProviderConfigs, profileReady]
  );
  const openai = publicProviderConfigs.openai;

  const getProviderConfig = useCallback(
    (name: string): LlmProviderType => {
      if (!isSupportedProvider(name)) return createUnknownProviderConfig(name);
      return cloneProviderConfig(
        profileReady ? providerConfigs[name] : defaultProviderConfigs[name]
      );
    },
    [profileReady, providerConfigs]
  );

  const handleSetProviderConfig = useCallback(
    async (name: string, config: LlmProviderType): Promise<void> => {
      if (!profileReady) throw new Error(t("providerSelectionRequired"));
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

      const request = requestGuard.capture();
      await EnjoyApp.userSettings.set(
        PROVIDER_SETTING_KEYS[providerName],
        next
      );
      if (!requestGuard.isCurrent(request)) return;
      setProviderConfigs((current) => ({
        ...current,
        [providerName]: next,
      }));
    },
    [EnjoyApp, profileReady, providerConfigs, requestGuard]
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
      if (!profileReady) throw new Error(t("providerSelectionRequired"));
      const selection = resolveTextProviderSelection(engine);
      if (selection.status !== "configured") {
        throw new Error(t("providerSelectionRequired"));
      }
      const next = normalizeGptEngine(selection.value);
      const request = requestGuard.capture();
      await EnjoyApp.userSettings.set(UserSettingKeyEnum.GPT_ENGINE, next);
      if (!requestGuard.isCurrent(request)) return;
      setGptEngineState(next);
    },
    [EnjoyApp, profileReady, requestGuard]
  );

  const handleSetSttEngine = useCallback(
    async (name: SttEngineOptionEnum): Promise<void> => {
      if (!profileReady) throw new Error(t("providerSelectionRequired"));
      const selection = resolveTranscriptionProviderSelection(name);
      if (selection.status !== "configured") {
        throw new Error(t("providerSelectionRequired"));
      }
      const request = requestGuard.capture();
      await EnjoyApp.userSettings.set(UserSettingKeyEnum.STT_ENGINE, name);
      if (!requestGuard.isCurrent(request)) return;
      setSttEngineState(name);
      setTranscriptionSelection(selection);
    },
    [EnjoyApp, profileReady, requestGuard]
  );

  const handleSetTtsConfig = useCallback(
    async (config: TtsConfigType): Promise<void> => {
      if (!profileReady) throw new Error(t("providerSelectionRequired"));
      const selection = resolveSynthesisProviderSelection(config);
      if (selection.status !== "configured") {
        throw new Error(t("providerSelectionRequired"));
      }
      const request = requestGuard.capture();
      await EnjoyApp.userSettings.set(UserSettingKeyEnum.TTS_CONFIG, config);
      if (!requestGuard.isCurrent(request)) return;
      setTtsConfigState(config);
      setSynthesisSelection(selection);
    },
    [EnjoyApp, profileReady, requestGuard]
  );

  const handleSetEchogardenSttConfig = useCallback(
    async (config: EchogardenSttConfigType): Promise<void> => {
      if (!profileReady) throw new Error(t("providerSelectionRequired"));
      const request = requestGuard.capture();
      await EnjoyApp.userSettings.set(UserSettingKeyEnum.ECHOGARDEN, config);
      if (!requestGuard.isCurrent(request)) return;
      setEchogardenSttConfigState(config);
    },
    [EnjoyApp, profileReady, requestGuard]
  );

  const refreshAcpStatus = useCallback(async () => {
    const request = requestGuard.capture();
    if (db.state !== "connected") {
      setAcpStatuses(UNAVAILABLE_ACP_STATUSES);
      setAcpStatusLoading(false);
      setDiscoveredModels((current) => ({
        ...current,
        "codex-acp": [],
        "claude-acp": [],
      }));
      return;
    }

    setAcpStatusLoading(true);
    const bridge = (EnjoyApp as typeof EnjoyApp & { acp?: AcpBridge }).acp;
    try {
      const statuses = bridge
        ? await bridge.status()
        : UNAVAILABLE_ACP_STATUSES;
      if (!requestGuard.isCurrent(request)) return;
      const byProvider = new Map(
        statuses.map((status) => [status.provider, status])
      );
      const normalized = UNAVAILABLE_ACP_STATUSES.map((fallback) => {
        const status = byProvider.get(fallback.provider);
        if (!status) return fallback;
        return {
          ...status,
          reason: status.available ? null : localizeAcpReason(status.reason),
          models: status.available ? status.models : [],
          currentModel: status.available ? status.currentModel : null,
        };
      });
      setAcpStatuses(normalized);
      setDiscoveredModels((current) => ({
        ...current,
        "codex-acp": normalized
          .find((status) => status.provider === "codex" && status.available)
          ?.models.map((model) => model.id) || [],
        "claude-acp": normalized
          .find((status) => status.provider === "claude" && status.available)
          ?.models.map((model) => model.id) || [],
      }));
    } catch (error) {
      if (!requestGuard.isCurrent(request)) return;
      const reason =
        error instanceof Error && error.message.trim()
          ? error.message
          : "Không thể kiểm tra ACP runtime.";
      setAcpStatuses(
        UNAVAILABLE_ACP_STATUSES.map((status) => ({ ...status, reason }))
      );
      setDiscoveredModels((current) => ({
        ...current,
        "codex-acp": [],
        "claude-acp": [],
      }));
    } finally {
      if (requestGuard.isCurrent(request)) setAcpStatusLoading(false);
    }
  }, [EnjoyApp, db.state, requestGuard, requestScope]);

  const refreshTtsConfig = useCallback(async (request: ProviderSelectionRequestToken) => {
    const stored = await EnjoyApp.userSettings.get(UserSettingKeyEnum.TTS_CONFIG);
    if (!requestGuard.isCurrent(request)) return;
    const selection = resolveSynthesisProviderSelection(stored);
    setSynthesisSelection(selection);
    if (selection.status === "configured") {
      setTtsConfigState(stored);
      return;
    }
    setTtsConfigState(createProviderSelectionRequiredTtsConfig(learningLanguage));
  }, [EnjoyApp, learningLanguage, requestGuard]);

  const refreshEchogardenSttConfig = useCallback(async (
    request: ProviderSelectionRequestToken
  ) => {
    let config = await EnjoyApp.userSettings.get(UserSettingKeyEnum.ECHOGARDEN);
    if (!requestGuard.isCurrent(request)) return;

    if (!config) {
      let model = "tiny";
      const whisperModel =
        (await EnjoyApp.userSettings.get(UserSettingKeyEnum.WHISPER)) || "";
      if (!requestGuard.isCurrent(request)) return;
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
    }
    if (!requestGuard.isCurrent(request)) return;
    setEchogardenSttConfigState(config);
  }, [EnjoyApp, learningLanguage, requestGuard]);

  useEffect(() => {
    if (!profileReady) return;
    let active = true;
    const request = requestGuard.capture();
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
      if (!active || !requestGuard.isCurrent(request)) return;

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
    db.state,
    profileReady,
    requestGuard,
    requestScope,
    providerConfigs.ollama.baseUrl,
    providerConfigs.lmstudio.baseUrl,
    providerConfigs.lmstudio.key,
  ]);

  useEffect(() => {
    if (db.state !== "connected") {
      setAcpStatuses(UNAVAILABLE_ACP_STATUSES);
      setAcpStatusLoading(false);
      setDiscoveredModels((current) => ({
        ...current,
        "codex-acp": [],
        "claude-acp": [],
      }));
      return;
    }
    void refreshAcpStatus();
  }, [db.state, refreshAcpStatus]);

  const fetchSettings = useCallback(async (
    request: ProviderSelectionRequestToken
  ) => {
    const [
      storedSttEngine,
      storedGptEngine,
      ...storedProviders
    ] =
      await Promise.all([
        EnjoyApp.userSettings.get(UserSettingKeyEnum.STT_ENGINE),
        EnjoyApp.userSettings.get(UserSettingKeyEnum.GPT_ENGINE),
        ...SUPPORTED_LLM_PROVIDER_IDS.map((id) =>
          EnjoyApp.userSettings.get(PROVIDER_SETTING_KEYS[id])
        ),
      ]);
    if (!requestGuard.isCurrent(request)) return;

    const transcription = resolveTranscriptionProviderSelection(storedSttEngine);
    setTranscriptionSelection(transcription);
    setSttEngineState(
      transcription.status === "configured"
        ? (transcription.value as SttEngineOptionEnum)
        : null
    );
    const storedOpenaiConfig =
      storedProviders[SUPPORTED_LLM_PROVIDER_IDS.indexOf("openai")];
    const gptBootstrap = resolveGptEngineBootstrap(
      storedGptEngine,
      storedOpenaiConfig
    );
    if (gptBootstrap.shouldPersist) {
      if (!requestGuard.isCurrent(request)) return;
      await EnjoyApp.userSettings.set(
        UserSettingKeyEnum.GPT_ENGINE,
        gptBootstrap.engine
      );
      if (!requestGuard.isCurrent(request)) return;
    }
    setGptEngineState(gptBootstrap.engine);

    const next = createDefaultProviderConfigs();
    SUPPORTED_LLM_PROVIDER_IDS.forEach((id, index) => {
      next[id] = normalizeProviderConfig(id, storedProviders[index]);
    });
    setProviderConfigs(next);

    await Promise.all([
      refreshEchogardenSttConfig(request),
      refreshTtsConfig(request),
    ]);
    if (requestGuard.isCurrent(request)) setLoadedScope(request.scope);
  }, [EnjoyApp, refreshEchogardenSttConfig, refreshTtsConfig, requestGuard]);

  useEffect(() => {
    const request = requestGuard.capture();
    if (db.state !== "connected") {
      resetProfileState();
      return;
    }
    if (loadedScope && loadedScope !== requestScope) resetProfileState();
    void fetchSettings(request);
  }, [db.state, fetchSettings, requestGuard, requestScope, resetProfileState]);

  useEffect(
    () => () => requestGuard.invalidate(requestGuard.capture()),
    [requestGuard]
  );

  const currentGptEngine = useMemo<GptEngineSettingType>(() => {
    const activeEngine = profileReady ? gptEngine : DEFAULT_GPT_ENGINE;
    const providerName = activeEngine.name;
    const providerConfig = getProviderConfig(providerName);
    return {
      name: providerName,
      models: { ...activeEngine.models },
      key: providerConfig.key,
      baseUrl: providerConfig.baseUrl,
    };
  }, [getProviderConfig, gptEngine, profileReady]);

  const textSelection = useMemo(
    () => profileReady
      ? resolveTextProviderSelection(gptEngine)
      : ({ status: "unconfigured" } as const),
    [gptEngine, profileReady]
  );
  const visibleGptProviders = profileReady
    ? gptProviders
    : createGptProviders(defaultProviderConfigs);
  const visibleTtsConfig = profileReady
    ? ttsConfig
    : createProviderSelectionRequiredTtsConfig(learningLanguage);
  return (
    <AISettingsProviderContext.Provider
      value={{
        sttEngine: profileReady ? sttEngine : null,
        setSttEngine: handleSetSttEngine,
        openai,
        setOpenai: handleSetOpenai,
        providerConfigs: publicProviderConfigs,
        getProviderConfig,
        setProviderConfig: handleSetProviderConfig,
        setGptEngine: handleSetGptEngine,
        currentGptEngine,
        textSelection,
        transcriptionSelection: profileReady
          ? transcriptionSelection
          : { status: "unconfigured" },
        synthesisSelection: profileReady
          ? synthesisSelection
          : { status: "unconfigured" },
        acpStatuses: profileReady ? acpStatuses : UNAVAILABLE_ACP_STATUSES,
        acpStatusLoading: profileReady ? acpStatusLoading : false,
        refreshAcpStatus,
        gptProviders: visibleGptProviders,
        ttsProviders,
        ttsConfig: visibleTtsConfig,
        setTtsConfig: handleSetTtsConfig,
        echogardenSttConfig: profileReady ? echogardenSttConfig : null,
        setEchogardenSttConfig: handleSetEchogardenSttConfig,
      }}
    >
      {children}
    </AISettingsProviderContext.Provider>
  );
};
