import * as z from "zod";
import { t } from "i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  FormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  Input,
  ScrollArea,
  toast,
} from "@renderer/components/ui";
import { EjButton, Segmented } from "@renderer/components/enjoy";
import { useState, useContext } from "react";
import {
  AppSettingsProviderContext,
  AISettingsProviderContext,
} from "@renderer/context";
import { LoaderIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  ConversationFormGPT,
  ConversationFormTTS,
} from "@renderer/components";
import {
  SUPPORTED_LLM_PROVIDER_IDS,
  isSupportedProvider,
  PROVIDER_SELECTION_REQUIRED,
  providerSupportsOption,
  type AiProviderId,
} from "@/lib/ai-providers";
import { resolveSynthesisProviderSelection } from "@/lib/provider-selection-migration";

export const ConversationForm = (props: {
  conversation: Partial<ConversationType>;
  onFinish?: () => void;
}) => {
  const { conversation, onFinish } = props;
  const [submitting, setSubmitting] = useState<boolean>(false);
  const { EnjoyApp, learningLanguage } = useContext(
    AppSettingsProviderContext
  );
  const {
    openai,
    providerConfigs,
    currentGptEngine,
    gptProviders,
    ttsProviders,
    ttsConfig,
  } = useContext(AISettingsProviderContext);
  const navigate = useNavigate();

  const conversationFormSchema = z.object({
    name: z.string().optional(),
    engine: z.union([
      z.enum([...SUPPORTED_LLM_PROVIDER_IDS] as [AiProviderId, ...AiProviderId[]]),
      z.literal(PROVIDER_SELECTION_REQUIRED),
    ]).default(PROVIDER_SELECTION_REQUIRED),
    configuration: z.object({
      type: z.enum(["gpt", "tts"]),
      model: z.string().optional(),
      baseUrl: z.string().optional(),
      roleDefinition: z.string().optional(),
      temperature: z.number().min(0).max(1).default(0.2),
      numberOfChoices: z.number().min(1).default(1),
      maxTokens: z.number().min(-1).default(2048),
      presencePenalty: z.number().min(-2).max(2).default(0),
      frequencyPenalty: z.number().min(-2).max(2).default(0),
      historyBufferSize: z.number().min(0).default(10),
      tts: z.object({
        language: z.string().default(learningLanguage).optional(),
        engine: z.enum(["openai", "azure", PROVIDER_SELECTION_REQUIRED]).default(PROVIDER_SELECTION_REQUIRED),
        model: z.string().default(""),
        voice: z.string().default(""),
        baseUrl: z.string().optional(),
      }),
    }),
  });

  const destroyConversation = async () => {
    if (!conversation.id) return;

    EnjoyApp.conversations.destroy(conversation.id).then(() => {
      navigate(`/conversations`);
    });
  };

  const defaultConfig = JSON.parse(JSON.stringify(conversation || {}));

  if (!defaultConfig.engine) {
    defaultConfig.engine = currentGptEngine.name;
  }
  if (!isSupportedProvider(defaultConfig.engine)) {
    defaultConfig.engine = PROVIDER_SELECTION_REQUIRED;
    defaultConfig.configuration ||= {};
    defaultConfig.configuration.model = "";
  }
  if (!defaultConfig.configuration) {
    defaultConfig.configuration = {};
  }
  if (!defaultConfig.configuration.type) {
    defaultConfig.configuration.type = "gpt";
  }

  if (!defaultConfig.configuration.model) {
    const configuredEngine =
      typeof defaultConfig.engine === "string"
        ? defaultConfig.engine
        : undefined;
    const defaultProvider = configuredEngine && isSupportedProvider(configuredEngine)
      ? configuredEngine
      : undefined;
    defaultConfig.configuration.model =
      defaultConfig.engine === currentGptEngine.name
        ? currentGptEngine.models.default
        : defaultProvider
          ? gptProviders[defaultProvider]?.models?.[0]
          : undefined;
  }

  if (defaultConfig.engine === "openai" && openai) {
    if (!defaultConfig.configuration.model) {
      defaultConfig.configuration.model =
        openai.model || gptProviders.openai?.models?.[0];
    }
    if (!defaultConfig.configuration.baseUrl) {
      defaultConfig.configuration.baseUrl = openai.baseUrl;
    }
  }

  defaultConfig.configuration.tts = {
    ...(ttsConfig || {
      engine: PROVIDER_SELECTION_REQUIRED,
      model: "",
      voice: "",
    }),
    ...(defaultConfig.configuration.tts || {}),
  };
  if (resolveSynthesisProviderSelection(defaultConfig.configuration.tts).status !== "configured") {
    defaultConfig.configuration.tts = {
      engine: PROVIDER_SELECTION_REQUIRED,
      model: "",
      voice: "",
      language: defaultConfig.configuration.tts.language || learningLanguage,
    };
  }

  if (!defaultConfig.configuration.tts.language) {
    defaultConfig.configuration.tts.language = learningLanguage;
  }

  const form = useForm<z.infer<typeof conversationFormSchema>>({
    resolver: zodResolver(conversationFormSchema),
    values: {
      name: defaultConfig.name,
      engine: defaultConfig.engine,
      configuration: {
        ...defaultConfig.configuration,
      },
    },
  });

  const onSubmit = async (data: z.infer<typeof conversationFormSchema>) => {
    const { name, engine } = data;
    let configuration = data.configuration;
    setSubmitting(true);

    try {
      configuration = validateConfiguration(data);
    } catch (e) {
      toast.error(e.message);
      setSubmitting(false);
      return;
    }

    if (conversation?.id) {
      EnjoyApp.conversations
        .update(conversation.id, {
          name,
          engine,
          configuration,
        })
        .then(() => {
          if (onFinish) onFinish();
        })
        .catch(() => {
          toast.error(t("somethingWentWrong"));
        })
        .finally(() => {
          setSubmitting(false);
        });
    } else {
      EnjoyApp.conversations
        .create({
          name,
          engine,
          configuration,
        })
        .then(() => {
          if (onFinish) onFinish();
        })
        .finally(() => {
          setSubmitting(false);
        });
    }
  };

  const validateConfiguration = (
    data: z.infer<typeof conversationFormSchema>
  ) => {
    const { engine, configuration } = data;
    if (configuration.type === "gpt" && !isSupportedProvider(engine)) {
      throw new Error(t("providerSelectionRequired"));
    }
    const synthesis = resolveSynthesisProviderSelection(configuration.tts);
    if (configuration.type === "tts" && synthesis.status !== "configured") {
      throw new Error(t("providerSelectionRequired"));
    }
    const mutableConfiguration = configuration as typeof configuration &
      Record<string, unknown>;

    Object.keys(configuration).forEach((key) => {
      if (key === "type" || key === "tts") return;

      if (
        configuration.type === "gpt" &&
        !providerSupportsOption(
          engine as AiProviderId,
          key as Parameters<typeof providerSupportsOption>[1],
          configuration.model,
          isSupportedProvider(engine) ? gptProviders[engine] : undefined
        )
      ) {
        delete mutableConfiguration[key];
      }

    });

    // use default base url if not set
    if (!configuration.baseUrl) {
      configuration.baseUrl = isSupportedProvider(engine)
        ? gptProviders[engine]?.baseUrl
        : undefined;
    }

    // use default base url if not set
    if (!configuration?.tts?.baseUrl) {
      configuration.tts ||= {};
      configuration.tts.baseUrl =
        ttsConfig?.baseUrl ||
        (configuration.tts.engine === "openai"
          ? providerConfigs.openai?.baseUrl
          : ttsProviders[configuration.tts.engine]?.baseUrl);
    }

    if (!configuration.tts.baseUrl) {
      configuration.tts.baseUrl =
        ttsConfig?.engine === configuration.tts.engine
          ? ttsConfig.baseUrl
          : configuration.tts.engine === "openai"
            ? providerConfigs.openai?.baseUrl
            : ttsProviders[configuration.tts.engine]?.baseUrl;
    }

    // validates tts voice
    const ttsEngine = configuration.tts.engine;
    for (const key of Object.keys(configuration.tts)) {
      if (key === "engine") continue;
      if (!ttsProviders[ttsEngine]?.configurable.includes(key)) {
        delete (configuration.tts as Record<string, unknown>)[key];
      }
    }
    const voice = configuration.tts.voice;
    const language = configuration.tts.language || learningLanguage;
    configuration.tts.language = language;

    if (ttsEngine === "openai") {
      const options = ttsProviders.openai?.voices || [];
      if (options.length > 0 && !options.includes(voice)) {
        configuration.tts.voice = options[0];
      }
    }
    if (ttsEngine === "azure") {
      const options = ttsProviders.azure?.voices || [];
      if (options.findIndex((o: any) => o.language === language && o.value === voice) < 0) {
        configuration.tts.voice = options.find((o: any) => o.language === language)?.value;
      }
    }

    return configuration;
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex h-full flex-col"
        data-testid="conversation-form"
      >
        <div className="shrink-0 border-b border-ej-line px-6 pb-4">
          <div className="ej-label text-ej-accent">{t("aiAssistant")}</div>
          <div className="mt-0.5 text-base font-bold tracking-[-0.01em] text-ej-ink">
            {conversation.id ? t("editConversation") : t("startConversation")}
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-5 px-6 py-5">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="ej-label">
                    {t("models.conversation.name")}
                  </FormLabel>
                  <Input
                    value={field.value}
                    onChange={field.onChange}
                    className="h-9 rounded-[10px] border-ej-line bg-ej-surface text-xs text-ej-ink focus-visible:ring-ej-accent"
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="configuration.type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="ej-label">
                    {t("models.conversation.type")}
                  </FormLabel>
                  <FormControl>
                    <div
                      className={
                        conversation?.id ? "pointer-events-none opacity-50" : ""
                      }
                    >
                      <Segmented
                        value={field.value}
                        onChange={field.onChange}
                        options={[
                          { value: "gpt", label: "GPT" },
                          { value: "tts", label: t("textToSpeech") },
                        ]}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {form.watch("configuration.type") === "gpt" && (
              <ConversationFormGPT
                form={form}
                gptProviders={gptProviders}
                conversation={conversation}
              />
            )}

            <ConversationFormTTS form={form} ttsProviders={ttsProviders} />
          </div>
        </ScrollArea>

        <div className="flex shrink-0 items-center gap-3 border-t border-ej-line bg-ej-surface px-6 py-4">
          {conversation.id && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <EjButton variant="danger" size="lg" className="flex-1">
                  {t("delete")}
                </EjButton>
              </AlertDialogTrigger>

              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("deleteConversation")}</AlertDialogTitle>
                </AlertDialogHeader>
                <AlertDialogDescription>
                  {t("deleteConversationConfirmation")}
                </AlertDialogDescription>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-ej-bad hover:opacity-90"
                    onClick={destroyConversation}
                  >
                    {t("delete")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          <EjButton
            disabled={
              submitting || (conversation.id && !form.formState.isDirty)
            }
            variant="primary"
            size="lg"
            className="flex-1"
            data-testid="conversation-form-submit"
            type="submit"
          >
            {submitting && <LoaderIcon className="size-4 animate-spin" />}
            {t("confirm")}
          </EjButton>
        </div>
      </form>
    </Form>
  );
};
