import { t } from "i18next";
import {
  Button,
  toast,
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
  Input,
} from "@renderer/components/ui";
import {
  AppSettingsProviderContext,
  AISettingsProviderContext,
} from "@renderer/context";
import { useContext, useEffect, useState } from "react";
import { SttEngineOptionEnum } from "@/types/enums";
import { EchogardenSttSettings } from "@renderer/components";
import {
  normalizeOpenAiTranscriptionModel,
  OPENAI_TRANSCRIPTION_MODELS,
  sanitizeSpeechError,
} from "@/lib/speech-models";
import {
  isLearningAsrEngine,
} from "@/lib/learning-asr-models";

type OpenAiSettingsWithTranscriptionModel = LlmProviderType & {
  transcriptionModel?: string;
};

export const SttSettings = () => {
  const {
    setSttEngine,
    transcriptionSelection,
    echogardenSttConfig,
    setEchogardenSttConfig,
    openai,
    setOpenai,
    getProviderConfig,
    setProviderConfig,
  } = useContext(AISettingsProviderContext);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);

  const [editingLocal, setEditingLocal] = useState(false);
  const openRouter = getProviderConfig("openrouter");
  const [openRouterKey, setOpenRouterKey] = useState(openRouter.key || "");
  const [savingOpenRouter, setSavingOpenRouter] = useState(false);
  const [cloudflareBaseUrl, setCloudflareBaseUrl] = useState("");
  const [cloudflareToken, setCloudflareToken] = useState("");
  const [cloudflareConfigured, setCloudflareConfigured] = useState(false);
  const [savingCloudflare, setSavingCloudflare] = useState(false);
  const openAiSettings = openai as
    | OpenAiSettingsWithTranscriptionModel
    | null
    | undefined;
  const currentOpenAiSettings: OpenAiSettingsWithTranscriptionModel =
    openAiSettings || { name: "openai", models: "" };
  const transcriptionModel =
    openAiSettings?.transcriptionModel?.trim() || "whisper-1";
  const selectedSttEngine =
    transcriptionSelection.status === "configured"
      ? transcriptionSelection.value
      : null;

  const handleOpenAiTranscriptionModelChange = async (model: string) => {
    if (!setOpenai) return;

    try {
      await setOpenai({
        ...currentOpenAiSettings,
        transcriptionModel: normalizeOpenAiTranscriptionModel(model),
      });
      toast.success(t("saved"));
    } catch (error) {
      toast.error(sanitizeSpeechError(error));
    }
  };

  useEffect(() => {
    setOpenRouterKey(openRouter.key || "");
  }, [openRouter.key]);

  useEffect(() => {
    void EnjoyApp.cloudflareTranscribe.getConfig().then((config) => {
      setCloudflareBaseUrl(config.baseUrl);
      setCloudflareConfigured(config.configured);
    });
  }, [EnjoyApp]);

  useEffect(() => {
    if (selectedSttEngine !== SttEngineOptionEnum.LOCAL) {
      setEditingLocal(false);
    }
  }, [selectedSttEngine]);

  const handleCheckLocal = async () => {
    toast.promise(
      async () => {
        const { success, log } = await EnjoyApp.echogarden.check(
          echogardenSttConfig,
        );
        if (!success) throw new Error(log);
      },
      {
        loading: t("checkingWhisper"),
        success: t("whisperIsWorkingGood"),
        error: (error) => t("whisperIsNotWorking") + ": " + error,
      },
    );
  };

  const saveOpenRouterKey = async () => {
    setSavingOpenRouter(true);
    try {
      await setProviderConfig("openrouter", {
        ...openRouter,
        name: "openrouter",
        key: openRouterKey.trim(),
      });
      toast.success(t("saved"));
    } catch {
      toast.error(t("providerConfigSaveFailed"));
    } finally {
      setSavingOpenRouter(false);
    }
  };

  const saveCloudflareConfig = async (clearToken = false) => {
    setSavingCloudflare(true);
    try {
      const config = await EnjoyApp.cloudflareTranscribe.setConfig({
        baseUrl: cloudflareBaseUrl.trim(),
        ...(cloudflareToken.trim() ? { token: cloudflareToken.trim() } : {}),
        ...(clearToken ? { clearToken: true } : {}),
      });
      setCloudflareBaseUrl(config.baseUrl);
      setCloudflareConfigured(config.configured);
      setCloudflareToken("");
      toast.success(t("saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("providerConfigSaveFailed"));
    } finally {
      setSavingCloudflare(false);
    }
  };

  return (
    <div className="ej-setting-row">
      <div className="">
        <div className="flex items-center mb-2">
          <span>{t("sttAiService")}</span>
        </div>
        <div className="text-sm text-ej-muted">
          {selectedSttEngine === SttEngineOptionEnum.LOCAL &&
            t("localSpeechToTextDescription")}
          {(selectedSttEngine === SttEngineOptionEnum.AZURE_MAI ||
            selectedSttEngine === SttEngineOptionEnum.AZURE_SPEECH) && t("azureTranscribeDescription")}
          {selectedSttEngine === SttEngineOptionEnum.OPENAI &&
            t("openaiSpeechToTextDescription")}
          {selectedSttEngine === SttEngineOptionEnum.MAI_TRANSCRIBE &&
            t("maiTranscribeDescription")}
          {selectedSttEngine === SttEngineOptionEnum.CLOUDFLARE_WORKERS_AI &&
            t("cloudflareWorkerTranscribeDescription")}
        </div>
        {selectedSttEngine === SttEngineOptionEnum.LOCAL && editingLocal && (
          <div className="mt-4 px-1 text-sm text-ej-muted">
            <EchogardenSttSettings
              echogardenSttConfig={echogardenSttConfig}
              onSave={(data) => {
                setEchogardenSttConfig(data as EchogardenSttConfigType)
                  .then(() => toast.success(t("saved")))
                  .catch((error) => toast.error(error.message))
                  .finally(() => setEditingLocal(false));
              }}
            />
          </div>
        )}
        {selectedSttEngine === SttEngineOptionEnum.MAI_TRANSCRIBE && (
          <div className="mt-4 space-y-2 text-sm text-ej-muted">
            <div className="flex flex-wrap items-center gap-2">
              <span>{t("openRouterApiKey")}:</span>
              <Input
                className="min-w-56"
                type="password"
                autoComplete="off"
                value={openRouterKey}
                onChange={(event) => setOpenRouterKey(event.target.value)}
                placeholder={t("openRouterApiKeyPlaceholder")}
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={savingOpenRouter || !openRouterKey.trim()}
                onClick={() => void saveOpenRouterKey()}
              >
                {savingOpenRouter ? t("saving") : t("save")}
              </Button>
            </div>
            <div>{t("maiTranscribeKeyLocation")}</div>
            <div data-testid="mai-transcribe-settings-model">
              {t("model")}: microsoft/mai-transcribe-2
            </div>
          </div>
        )}
        {selectedSttEngine === SttEngineOptionEnum.CLOUDFLARE_WORKERS_AI && (
          <div
            className="mt-4 space-y-3 text-sm text-ej-muted"
            data-testid="cloudflare-worker-settings"
          >
            <div className="space-y-1">
              <div>{t("cloudflareWorkerUrl")}</div>
              <Input
                data-testid="cloudflare-worker-url"
                type="url"
                value={cloudflareBaseUrl}
                onChange={(event) => setCloudflareBaseUrl(event.target.value)}
                placeholder="https://your-worker.your-subdomain.workers.dev"
              />
            </div>
            <div className="space-y-1">
              <div>{t("cloudflareWorkerToken")}</div>
              <Input
                data-testid="cloudflare-worker-token"
                type="password"
                autoComplete="off"
                value={cloudflareToken}
                onChange={(event) => setCloudflareToken(event.target.value)}
                placeholder={
                  cloudflareConfigured
                    ? t("cloudflareWorkerTokenSaved")
                    : t("cloudflareWorkerTokenPlaceholder")
                }
              />
            </div>
            <div>{t("cloudflareWorkerTokenHelp")}</div>
            <div data-testid="cloudflare-worker-model">
              {t("model")}: @cf/openai/whisper-large-v3-turbo
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={savingCloudflare || !cloudflareBaseUrl.trim()}
                onClick={() => void saveCloudflareConfig(false)}
                data-testid="cloudflare-worker-save"
              >
                {savingCloudflare ? t("saving") : t("save")}
              </Button>
              {cloudflareConfigured && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={savingCloudflare || !cloudflareBaseUrl.trim()}
                  onClick={() => void saveCloudflareConfig(true)}
                  data-testid="cloudflare-worker-clear-token"
                >
                  {t("cloudflareWorkerClearToken")}
                </Button>
              )}
            </div>
          </div>
        )}
        {(selectedSttEngine === SttEngineOptionEnum.AZURE_MAI ||
            selectedSttEngine === SttEngineOptionEnum.AZURE_SPEECH) && t("azureTranscribeDescription")}
          {selectedSttEngine === SttEngineOptionEnum.OPENAI && (
          <div className="mt-4 space-y-2 text-sm text-ej-muted">
            <div className="flex items-center space-x-2">
              <span>{t("openaiTranscriptionModel")}:</span>
              <Select
                value={transcriptionModel}
                onValueChange={handleOpenAiTranscriptionModelChange}
              >
                <SelectTrigger className="min-w-fit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPENAI_TRANSCRIPTION_MODELS.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>{t("openaiTranscriptionModelDescription")}</div>
          </div>
        )}
      </div>

      <div className="flex items-center space-x-2">
        <Select
          value={selectedSttEngine}
          onValueChange={(value) => {
            if (
              value === SttEngineOptionEnum.LOCAL ||
              isLearningAsrEngine(value)
            ) {
              setSttEngine(value as SttEngineOptionEnum);
            }
          }}
        >
          <SelectTrigger
            className="min-w-fit"
            data-testid="stt-engine-select"
          >
            <SelectValue placeholder="service"></SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SttEngineOptionEnum.LOCAL}>
              {t("local")}
            </SelectItem>
            <SelectItem
              value={SttEngineOptionEnum.CLOUDFLARE_WORKERS_AI}
              data-testid="stt-engine-cloudflare-worker"
            >
              {t("cloudflareWorkerTranscribeName")}
            </SelectItem>
            <SelectItem
              value={SttEngineOptionEnum.MAI_TRANSCRIBE}
              data-testid="stt-engine-mai"
            >
              {t("maiTranscribeName")}
            </SelectItem>
            <SelectItem value={SttEngineOptionEnum.AZURE_MAI} data-testid="stt-engine-azure-mai">
                    {t("azureMaiTranscribeName")}
                  </SelectItem>
                  <SelectItem value={SttEngineOptionEnum.AZURE_SPEECH} data-testid="stt-engine-azure-speech">
                    {t("azureFastTranscribeName")}
                  </SelectItem>
                  <SelectItem value={SttEngineOptionEnum.OPENAI}>OpenAI</SelectItem>
          </SelectContent>
        </Select>
        {selectedSttEngine === SttEngineOptionEnum.LOCAL && (
          <>
            <Button
              type="button"
              onClick={() => setEditingLocal((value) => !value)}
              variant="secondary"
              size="sm"
            >
              {editingLocal ? t("cancel") : t("config")}
            </Button>
            {!editingLocal && (
              <Button
                type="button"
                onClick={() => void handleCheckLocal()}
                variant="secondary"
                size="sm"
              >
                {t("check")}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
