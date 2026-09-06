import { t } from "i18next";
import {
  Button,
  toast,
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
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

type OpenAiSettingsWithTranscriptionModel = LlmProviderType & {
  transcriptionModel?: string;
};

export const SttSettings = () => {
  const {
    sttEngine,
    setSttEngine,
    echogardenSttConfig,
    setEchogardenSttConfig,
    openai,
    setOpenai,
  } = useContext(AISettingsProviderContext);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);

  const [editing, setEditing] = useState(false);
  const openAiSettings = openai as
    | OpenAiSettingsWithTranscriptionModel
    | null
    | undefined;
  const currentOpenAiSettings: OpenAiSettingsWithTranscriptionModel =
    openAiSettings || { name: "openai", models: "" };
  let transcriptionModel = "whisper-1";
  try {
    transcriptionModel = normalizeOpenAiTranscriptionModel(
      openAiSettings?.transcriptionModel
    );
  } catch {
    // Keep an unknown saved value usable in the settings screen until it is replaced.
  }

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

  const handleCheck = async () => {
    toast.promise(
      async () => {
        const { success, log } = await EnjoyApp.echogarden.check(
          echogardenSttConfig
        );
        if (success) {
          return Promise.resolve();
        } else {
          return Promise.reject(log);
        }
      },
      {
        loading: t("checkingWhisper"),
        success: t("whisperIsWorkingGood"),
        error: (error) => t("whisperIsNotWorking") + ": " + error,
      }
    );
  };

  useEffect(() => {
    if (sttEngine !== SttEngineOptionEnum.LOCAL) {
      setEditing(false);
    }
  }, [sttEngine]);

  return (
    <div className="flex items-start justify-between py-4">
      <div className="">
        <div className="flex items-center mb-2">
          <span>{t("sttAiService")}</span>
        </div>
        <div className="text-sm text-muted-foreground">
          {sttEngine === SttEngineOptionEnum.LOCAL &&
            t("localSpeechToTextDescription")}
          {sttEngine === SttEngineOptionEnum.ENJOY_AZURE &&
            t("enjoyAzureSpeechToTextDescription")}
          {sttEngine === SttEngineOptionEnum.ENJOY_CLOUDFLARE &&
            t("enjoyCloudflareSpeechToTextDescription")}
          {sttEngine === SttEngineOptionEnum.OPENAI &&
            t("openaiSpeechToTextDescription")}
        </div>
        {sttEngine === SttEngineOptionEnum.OPENAI && (
          <div className="mt-4 space-y-2 text-sm text-muted-foreground">
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
        <div
          className={`text-sm text-muted-foreground mt-4 px-1 ${
            editing ? "" : "hidden"
          }`}
        >
          <EchogardenSttSettings
            echogardenSttConfig={echogardenSttConfig}
            onSave={(data) => {
              setEchogardenSttConfig(data as EchogardenSttConfigType)
                .then(() => {
                  toast.success(t("saved"));
                })
                .catch((error) => {
                  toast.error(error.message);
                })
                .finally(() => {
                  setEditing(false);
                });
            }}
          />
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <Select
          value={sttEngine}
          onValueChange={(value) => {
            setSttEngine(value as SttEngineOptionEnum);
          }}
        >
          <SelectTrigger className="min-w-fit">
            <SelectValue placeholder="service"></SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SttEngineOptionEnum.LOCAL}>
              {t("local")}
            </SelectItem>
            <SelectItem value={SttEngineOptionEnum.ENJOY_AZURE}>
              {t("enjoyAzure")}
            </SelectItem>
            <SelectItem value={SttEngineOptionEnum.ENJOY_CLOUDFLARE}>
              {t("enjoyCloudflare")}
            </SelectItem>
            <SelectItem value={SttEngineOptionEnum.OPENAI}>OpenAI</SelectItem>
          </SelectContent>
        </Select>

        {sttEngine === SttEngineOptionEnum.LOCAL && (
          <>
            <Button
              onClick={() => setEditing(!editing)}
              variant="secondary"
              size="sm"
            >
              {editing ? t("cancel") : t("config")}
            </Button>
            {!editing && (
              <Button onClick={handleCheck} variant="secondary" size="sm">
                {t("check")}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
