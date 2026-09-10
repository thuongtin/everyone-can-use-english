import { useContext, useEffect, useMemo, useState } from "react";
import { t } from "i18next";
import {
  AlertTriangleIcon,
  BotIcon,
  MicIcon,
  PlayIcon,
  SpeakerIcon,
} from "lucide-react";
import {
  AISettingsProviderContext,
  AppSettingsProviderContext,
} from "@renderer/context";
import { toast } from "@renderer/components/ui";
import { speakText } from "@renderer/lib/speak";
import { cn } from "@renderer/lib/utils";
import { SttEngineOptionEnum } from "@/types/enums";
import {
  AI_PROVIDER_CATALOG,
  SUPPORTED_LLM_PROVIDER_IDS,
  resolveProviderModel,
  type AiProviderId,
} from "@/lib/ai-providers";
import { SettingOption, SettingSelect } from "./settings-primitives";

type ServiceStatus = "local" | "cloud" | "cli" | "needsKey";

const STATUS_CLASS: Record<ServiceStatus, string> = {
  local: "bg-ej-ok-soft text-ej-ok",
  cloud: "bg-ej-accent-soft text-ej-accent-ink",
  cli: "bg-ej-accent-soft text-ej-accent-ink",
  needsKey: "bg-ej-warn-soft text-ej-warn",
};

const DOT_CLASS: Record<ServiceStatus, string> = {
  local: "bg-ej-ok",
  cloud: "bg-ej-accent-ink",
  cli: "bg-ej-accent-ink",
  needsKey: "bg-ej-warn",
};

const StatusChip = (props: { status: ServiceStatus }) => (
  <span
    className={cn(
      "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2",
      "text-[10.5px] font-semibold",
      STATUS_CLASS[props.status]
    )}
  >
    <span className={cn("size-1.5 rounded-full", DOT_CLASS[props.status])} />
    {t(`settings.status.${props.status}`)}
  </span>
);

/** The small "Đổi…" / "Nghe thử" button that closes the card. */
const CardButton = (props: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) => (
  <button
    type="button"
    onClick={props.onClick}
    className={cn(
      "inline-flex h-7 items-center gap-1.5 rounded-[9px] border border-ej-line bg-ej-surface px-2.5",
      "text-[11.5px] font-semibold text-ej-ink transition-colors duration-ej hover:bg-ej-surface2",
      props.className
    )}
  >
    {props.children}
  </button>
);

/** Inline dropdown attached to the model line of a card. */
const ModelPicker = (props: {
  value?: string;
  options: SettingOption[];
  onChange: (value: string) => void;
}) => (
  <SettingSelect
    value={props.value}
    options={props.options}
    onChange={props.onChange}
    className="h-[22px] min-w-0 max-w-full gap-1 rounded-[7px] border-0 bg-transparent px-1 text-xs text-ej-muted hover:bg-ej-surface2"
    menuClassName="left-0 right-auto"
  />
);

const ServiceCard = (props: {
  Icon: typeof MicIcon;
  type: string;
  name: string;
  status: ServiceStatus;
  model?: React.ReactNode;
  onEnterKey?: () => void;
  actions?: React.ReactNode;
  change: { value?: string; options: SettingOption[]; onChange: (v: string) => void };
}) => {
  const { Icon, type, name, status, model, onEnterKey, actions, change } = props;

  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-ej border bg-ej-surface p-3.5",
        status === "needsKey" ? "border-ej-warn/45" : "border-ej-line"
      )}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold text-ej-muted">
        <Icon className="size-3.5 shrink-0" />
        {type}
      </div>

      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold text-ej-ink">
          {name}
        </div>
        {model !== undefined && (
          <div className="mt-0.5 min-w-0 text-xs text-ej-muted">{model}</div>
        )}
      </div>

      <StatusChip status={status} />

      {status === "needsKey" && (
        <div className="flex items-start gap-1.5 text-[11.5px] leading-[1.5] text-ej-warn">
          <AlertTriangleIcon className="mt-px size-[13px] shrink-0" />
          <span className="min-w-0">
            {t("settings.missingOpenaiKey")}{" "}
            <button
              type="button"
              onClick={onEnterKey}
              className="font-semibold text-ej-accent transition-opacity duration-ej hover:opacity-80"
            >
              {t("settings.enterKey")}
            </button>
          </span>
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 pt-1">
        {actions}
        <div className="ml-auto">
          <SettingSelect
            value={change.value}
            options={change.options}
            onChange={change.onChange}
            placeholder={t("settings.change")}
            className="h-7 min-w-0 rounded-[9px] border-ej-line bg-ej-surface px-2.5 text-[11.5px] font-semibold"
            menuClassName="w-56"
          />
        </div>
      </div>
    </div>
  );
};

/**
 * The three services the app leans on, shown side by side so it is obvious at a
 * glance what runs locally and what needs a key. Every choice saves instantly.
 */
export const AiServiceCards = (props: { onEnterKey: () => void }) => {
  const {
    sttEngine,
    setSttEngine,
    transcriptionSelection,
    ttsConfig,
    setTtsConfig,
    ttsProviders,
    currentGptEngine,
    setGptEngine,
    gptProviders,
    acpStatuses,
    getProviderConfig,
  } = useContext(AISettingsProviderContext);
  const { EnjoyApp, learningLanguage } = useContext(AppSettingsProviderContext);
  const [previewing, setPreviewing] = useState<boolean>(false);
  const [cloudflareTranscribeConfigured, setCloudflareTranscribeConfigured] =
    useState(false);
  const [azureTranscribeConfigured, setAzureTranscribeConfigured] = useState(false);

  /* ---------------------------------------------------------------- STT */

  const sttOptions: SettingOption[] = [
    { value: SttEngineOptionEnum.LOCAL, label: t("local") },
    {
      value: SttEngineOptionEnum.CLOUDFLARE_WORKERS_AI,
      label: t("cloudflareWorkerTranscribeName"),
    },
    { value: SttEngineOptionEnum.MAI_TRANSCRIBE, label: t("maiTranscribeName") },
    { value: SttEngineOptionEnum.OPENAI, label: "OpenAI" },
    { value: SttEngineOptionEnum.AZURE_MAI, label: t("azureMaiTranscribeName") },
    { value: SttEngineOptionEnum.AZURE_SPEECH, label: t("azureFastTranscribeName") },
  ];

  const selectedSttEngine =
    transcriptionSelection.status === "configured"
      ? transcriptionSelection.value
      : undefined;

  useEffect(() => {
    let active = true;
    const refreshAzure = () => {
      void EnjoyApp.speeches.getAzureConfig()
        .then((config) => { if (active) setAzureTranscribeConfigured(config.transcriptionConfigured); })
        .catch(() => { if (active) setAzureTranscribeConfigured(false); });
    };
    refreshAzure();
    window.addEventListener("azure-speech-config-updated", refreshAzure);
    void EnjoyApp.cloudflareTranscribe
      .getConfig()
      .then((config) => setCloudflareTranscribeConfigured(config.configured))
      .catch(() => setCloudflareTranscribeConfigured(false));
    return () => {
      active = false;
      window.removeEventListener("azure-speech-config-updated", refreshAzure);
    };
  }, [EnjoyApp, sttEngine]);

  const sttName =
    sttOptions.find((option) => option.value === selectedSttEngine)?.label ??
    t("models.chat.sttAiServicePlaceholder");
  const sttModel =
    selectedSttEngine === SttEngineOptionEnum.AZURE_MAI
      ? "MAI-Transcribe-2"
      : selectedSttEngine === SttEngineOptionEnum.AZURE_SPEECH
        ? "azure-speech-fast"
      : selectedSttEngine === SttEngineOptionEnum.LOCAL
      ? undefined
      : selectedSttEngine === SttEngineOptionEnum.CLOUDFLARE_WORKERS_AI
      ? "@cf/openai/whisper-large-v3-turbo"
      : selectedSttEngine === SttEngineOptionEnum.MAI_TRANSCRIBE
        ? "microsoft/mai-transcribe-2"
        : selectedSttEngine === SttEngineOptionEnum.OPENAI
          ? (getProviderConfig("openai") as LlmProviderType & {
            transcriptionModel?: string;
          }).transcriptionModel || "whisper-1"
          : undefined;
  const sttStatus: ServiceStatus = !selectedSttEngine
    ? "needsKey"
    : (selectedSttEngine === SttEngineOptionEnum.AZURE_MAI ||
        selectedSttEngine === SttEngineOptionEnum.AZURE_SPEECH) && !azureTranscribeConfigured
      ? "needsKey"
    : selectedSttEngine === SttEngineOptionEnum.LOCAL
      ? "local"
      : selectedSttEngine === SttEngineOptionEnum.OPENAI &&
          !getProviderConfig("openai").key
        ? "needsKey"
        : selectedSttEngine === SttEngineOptionEnum.MAI_TRANSCRIBE &&
            !getProviderConfig("openrouter").key
          ? "needsKey"
          : selectedSttEngine === SttEngineOptionEnum.CLOUDFLARE_WORKERS_AI &&
              !cloudflareTranscribeConfigured
            ? "needsKey"
            : "cloud";

  /* ---------------------------------------------------------------- TTS */

  const ttsEngineOptions: SettingOption[] = Object.keys(ttsProviders || {}).map(
    (key) => ({ value: key, label: ttsProviders[key].name })
  );

  const ttsVoices = useMemo<string[]>(() => {
    const provider = ttsProviders?.[ttsConfig?.engine];
    if (!provider) return [];

    const raw =
      ttsConfig?.engine === "enjoyai"
        ? provider.voices?.[ttsConfig?.model?.split("/")?.[0]]
        : provider.voices;

    return (raw || [])
      .map((voice: any) =>
        typeof voice === "string"
          ? voice
          : voice.language === ttsConfig?.language
            ? voice.value
            : undefined
      )
      .filter(Boolean);
  }, [ttsProviders, ttsConfig?.engine, ttsConfig?.model, ttsConfig?.language]);

  const saveTts = (config: TtsConfigType) => {
    setTtsConfig(config).catch((error) => toast.error(error.message));
  };

  const switchTtsEngine = (engine: string) => {
    const provider = ttsProviders?.[engine];
    const model = provider?.models?.[0] || ttsConfig?.model;
    const voices =
      engine === "enjoyai"
        ? provider?.voices?.[model?.split("/")?.[0]]
        : provider?.voices;
    const first = voices?.[0];

    saveTts({
      ...ttsConfig,
      engine,
      model,
      voice: typeof first === "string" ? first : first?.value || ttsConfig?.voice,
    });
  };

  const handlePreview = () => {
    if (previewing) return;

    setPreviewing(true);
    const spoken = speakText(
      t("settings.aiServices"),
      ttsConfig?.language || learningLanguage
    );
    if (!spoken) toast.error(t("bilingual.noSpeechVoice"));
    setPreviewing(false);
  };

  /* ---------------------------------------------------------- Assistant */

  const acpReason = (provider: AiProviderId) => {
    const acp =
      provider === "codex-acp"
        ? "codex"
        : provider === "claude-acp"
          ? "claude"
          : undefined;
    if (!acp) return undefined;

    const status = acpStatuses.find((item) => item.provider === acp);
    return status?.available ? undefined : status?.reason || t("aiEngineNotSupported");
  };

  const engineOptions: SettingOption[] = SUPPORTED_LLM_PROVIDER_IDS.map(
    (provider) => ({
      value: provider,
      label: AI_PROVIDER_CATALOG[provider].name,
      disabled: Boolean(acpReason(provider)),
    })
  );

  const engineName = currentGptEngine?.name as AiProviderId;
  const engineModels = Array.from(
    new Set([
      ...(gptProviders[engineName]?.models || []),
      ...(currentGptEngine?.models?.default
        ? [currentGptEngine.models.default]
        : []),
    ])
  );

  const openaiKey = getProviderConfig("openai")?.key;
  const assistantStatus: ServiceStatus =
    engineName === "codex-acp" || engineName === "claude-acp"
      ? "cli"
      : engineName === "ollama" || engineName === "lmstudio"
        ? "local"
        : engineName === "openai" && !openaiKey
          ? "needsKey"
          : "cloud";

  const saveEngine = (engine: GptEngineSettingType) => {
    setGptEngine(engine).catch((error) => {
      console.error(error);
      toast.error(t("providerConfigSaveFailed"));
    });
  };

  const switchEngine = (name: string) => {
    const provider = name as AiProviderId;
    saveEngine({
      name: provider,
      models: {
        default: resolveProviderModel(gptProviders[provider]?.models) || "",
      },
    } as GptEngineSettingType);
  };

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2.5">
      <ServiceCard
        Icon={MicIcon}
        type={t("settings.ai.transcribe")}
        name={sttName}
        model={sttModel}
        status={sttStatus}
        onEnterKey={props.onEnterKey}
        change={{
          value: selectedSttEngine,
          options: sttOptions,
          onChange: (value) => {
            void setSttEngine(value as SttEngineOptionEnum).catch((error) =>
              toast.error(error.message),
            );
          },
        }}
      />

      <ServiceCard
        Icon={SpeakerIcon}
        type={t("settings.ai.voice")}
        name={ttsProviders?.[ttsConfig?.engine]?.name || ttsConfig?.engine}
        status={
          ttsConfig?.engine === "enjoyai" || ttsConfig?.engine === "openai"
            ? "cloud"
            : "local"
        }
        model={
          <span className="flex min-w-0 flex-wrap items-center gap-0.5">
            <span className="truncate">{ttsConfig?.model}</span>
            <span>·</span>
            <ModelPicker
              value={ttsConfig?.voice}
              options={ttsVoices.map((voice) => ({
                value: voice,
                label: voice,
              }))}
              onChange={(voice) => saveTts({ ...ttsConfig, voice })}
            />
          </span>
        }
        actions={
          <CardButton onClick={handlePreview}>
            <PlayIcon className="size-[11px]" />
            {t("settings.preview")}
          </CardButton>
        }
        change={{
          value: ttsConfig?.engine,
          options: ttsEngineOptions,
          onChange: switchTtsEngine,
        }}
      />

      <ServiceCard
        Icon={BotIcon}
        type={t("settings.ai.assistant")}
        name={AI_PROVIDER_CATALOG[engineName]?.name || engineName}
        status={assistantStatus}
        onEnterKey={props.onEnterKey}
        model={
          <ModelPicker
            value={currentGptEngine?.models?.default}
            options={engineModels.map((model) => ({
              value: model,
              label: model,
            }))}
            onChange={(model) =>
              saveEngine({
                ...currentGptEngine,
                models: { ...currentGptEngine.models, default: model },
              } as GptEngineSettingType)
            }
          />
        }
        change={{
          value: engineName,
          options: engineOptions,
          onChange: switchEngine,
        }}
      />
    </div>
  );
};
