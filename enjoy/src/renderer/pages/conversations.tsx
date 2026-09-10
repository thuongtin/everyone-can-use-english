import { t } from "i18next";
import { useState, useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { MessageCirclePlusIcon, SpeechIcon, SparklesIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  ScrollArea,
} from "@renderer/components/ui";
import { ConversationForm, ConversationList } from "@renderer/components";
import {
  EjButton,
  EjPage,
  EjPageHeader,
  EjSectionHeader,
} from "@renderer/components/enjoy";
import {
  AISettingsProviderContext,
} from "@renderer/context";
import { GPT_PRESETS } from "@/constants";

export default () => {
  const { currentGptEngine, ttsConfig } = useContext(AISettingsProviderContext);
  const getDefaultTtsConfig = () => ({
    engine: "needs-selection",
    model: "",
    voice: "alloy",
    ...(ttsConfig || {}),
  });
  const defaultTtsConfig = getDefaultTtsConfig();
  const [creating, setCreating] = useState<boolean>(false);
  const [preset, setPreset] = useState<any>({});
  const [config, setConfig] = useState<any>({
    gptPresets: GPT_PRESETS,
    customPreset: {},
    ttsPreset: {
      key: "tts",
      name: "TTS",
      engine: defaultTtsConfig.engine,
      configuration: {
        type: "tts",
        tts: {
          ...defaultTtsConfig,
        },
      },
    },
  });
  const navigate = useNavigate();

  const preparePresets = async () => {
    const presets = GPT_PRESETS;
    const savedTtsConfig = getDefaultTtsConfig();
    const defaultGptPreset = {
      key: "custom",
      engine: (currentGptEngine?.name || "needs-selection"),
      name: t("custom"),
      configuration: {
        type: "gpt",
        engine: (currentGptEngine?.name || "needs-selection"),
        model: (currentGptEngine?.models?.default || ""),
        tts: {
          ...savedTtsConfig,
        },
      },
    };
    const defaultTtsPreset = {
      key: "tts",
      name: "TTS",
      engine: savedTtsConfig.engine,
      configuration: {
        type: "tts",
        tts: {
          ...savedTtsConfig,
        },
      },
    };

    const gptPresets = presets.map((preset) =>
      Object.assign({}, preset, {
        engine: currentGptEngine?.name,
        configuration: {
          ...preset.configuration,
          model: (currentGptEngine?.models?.default || ""),
          tts: {
            ...preset.configuration.tts,
            ...savedTtsConfig,
          },
        },
      })
    );

    setConfig({
      gptPresets,
      customPreset: defaultGptPreset,
      ttsPreset: defaultTtsPreset,
    });
  };

  useEffect(() => {
    preparePresets();
  }, [currentGptEngine, ttsConfig]);

  const startWithPreset = (nextPreset: any) => {
    setPreset(nextPreset);
    setCreating(true);
  };

  const newConversationButton = (
    <EjButton data-testid="conversation-new-button" variant="primary">
      <MessageCirclePlusIcon className="size-3.5" />
      {t("newConversation")}
    </EjButton>
  );

  return (
    <EjPage>
      <Dialog>
        <EjPageHeader
          kicker={t("aiAssistant")}
          title={t("conversations")}
          description={t("aiAssistantDescription")}
          actions={<DialogTrigger asChild>{newConversationButton}</DialogTrigger>}
        />

        <DialogContent className="max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-ej-ink">
              {t("chooseAiRole")}
            </DialogTitle>
            <DialogDescription className="text-xs text-ej-muted">
              {t("chooseAiRoleDescription")}
            </DialogDescription>
          </DialogHeader>

          <div data-testid="conversation-presets">
            <div className="ej-label mb-2">{t("chooseFromPresetGpts")}</div>
            <ScrollArea className="h-64 pr-3">
              <div className="space-y-1.5">
                {config.gptPresets.map((preset: any) => (
                  <DialogTrigger
                    key={preset.key}
                    data-testid={`conversation-preset-${preset.key}`}
                    asChild
                    onClick={() => startWithPreset(preset)}
                  >
                    <div className="cursor-pointer rounded-[10px] border border-ej-line bg-ej-surface px-3.5 py-2.5 transition-colors duration-ej hover:border-ej-accent hover:bg-ej-accent-soft">
                      <div className="truncate text-xs font-semibold capitalize text-ej-ink">
                        {preset.name}
                      </div>
                      {preset.configuration.roleDefinition && (
                        <div className="mt-0.5 line-clamp-1 text-xxs text-ej-muted">
                          {preset.configuration.roleDefinition}
                        </div>
                      )}
                    </div>
                  </DialogTrigger>
                ))}
              </div>
            </ScrollArea>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DialogTrigger
              asChild
              onClick={() => startWithPreset(config.customPreset)}
            >
              <EjButton
                data-testid={`conversation-preset-${config.customPreset.key}`}
                className="w-full"
              >
                <SparklesIcon className="size-3.5" />
                {t("customRole")}
              </EjButton>
            </DialogTrigger>
            {config.ttsPreset.key && (
              <DialogTrigger
                asChild
                onClick={() => startWithPreset(config.ttsPreset)}
              >
                <EjButton
                  data-testid={`conversation-preset-${config.ttsPreset.key}`}
                  className="w-full"
                >
                  <SpeechIcon className="size-3.5" />
                  {t("textToSpeech")}
                </EjButton>
              </DialogTrigger>
            )}
          </div>
        </DialogContent>

        <EjSectionHeader title={t("conversations")} className="mt-7" />

        <ConversationList
          onCreated={(conversation) =>
            navigate(`/conversations/${conversation.id}`)
          }
          emptyAction={
            <DialogTrigger asChild>{newConversationButton}</DialogTrigger>
          }
        />
      </Dialog>

      <Sheet open={creating} onOpenChange={(value) => setCreating(value)}>
        <SheetContent
          className="w-[460px] p-0 pt-8 sm:max-w-[460px]"
          aria-describedby={undefined}
        >
          <SheetHeader>
            <SheetTitle className="sr-only">{t("startConversation")}</SheetTitle>
          </SheetHeader>
          <div className="h-content relative">
            <ConversationForm
              conversation={preset}
              onFinish={() => setCreating(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </EjPage>
  );
};
