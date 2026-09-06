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
  Button,
  FormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  Input,
  ScrollArea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  toast,
} from "@renderer/components/ui";
import { useState, useContext } from "react";
import {
  AppSettingsProviderContext,
  AISettingsProviderContext,
} from "@renderer/context";
import { LoaderIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  GPTShareButton,
  ConversationFormGPT,
  ConversationFormTTS,
} from "@renderer/components";
import {
  SUPPORTED_LLM_PROVIDER_IDS,
  isSupportedProvider,
  providerSupportsOption,
  type AiProviderId,
} from "@/lib/ai-providers";

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
    engine: z
      .enum([...SUPPORTED_LLM_PROVIDER_IDS] as [AiProviderId, ...AiProviderId[]])
      .default("enjoyai"),
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
        engine: z.enum(["openai", "enjoyai"]).default("enjoyai"),
        model: z.string().default("openai/tts-1"),
        voice: z.string(),
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
      engine: "enjoyai",
      model: "openai/tts-1",
      voice: "alloy",
    }),
    ...(defaultConfig.configuration.tts || {}),
  };

  if (!defaultConfig.configuration.tts.language) {
    defaultConfig.configuration.tts.language = learningLanguage;
  }

  const form = useForm<z.infer<typeof conversationFormSchema>>({
    resolver: zodResolver(conversationFormSchema),
    values: conversation?.id
      ? {
          name: conversation.name,
          engine: conversation.engine,
          configuration: {
            type: conversation.configuration.type || "gpt",
            ...conversation.configuration,
          },
        }
      : {
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
          configuration,
        })
        .then(() => {
          if (onFinish) onFinish();
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
    const mutableConfiguration = configuration as typeof configuration &
      Record<string, unknown>;

    Object.keys(configuration).forEach((key) => {
      if (key === "type" || key === "tts") return;

      if (
        configuration.type === "gpt" &&
        !providerSupportsOption(
          engine,
          key as Parameters<typeof providerSupportsOption>[1],
          configuration.model,
          gptProviders[engine]
        )
      ) {
        delete mutableConfiguration[key];
      }

    });

    // use default base url if not set
    if (!configuration.baseUrl) {
      configuration.baseUrl = gptProviders[engine]?.baseUrl;
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

    if (!configuration.tts.engine) {
      configuration.tts.engine = "openai";
    }
    if (!configuration.tts.model) {
      configuration.tts.model = "openai/tts-1";
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
    if (ttsEngine === "enjoyai") {
      const model = configuration.tts.model.split("/")[0];
      const options = ttsProviders.enjoyai?.voices?.[model] || [];
      if (model === "openai" && options.length > 0 && !options.includes(voice)) {
        configuration.tts.voice = options[0];
      } else if (
        model === "azure" &&
        options.findIndex(
          (o: any) => o.language === language && o.value === voice
        ) < 0
      ) {
        configuration.tts.voice = options.find(
          (o: any) => o.language === language
        )?.value;
      }
    }

    return configuration;
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="h-full flex flex-col pt-6"
        data-testid="conversation-form"
      >
        <div className="mb-4 px-6 flex items-center space-x-4">
          <div className="text-lg font-bold">
            {conversation.id ? t("editConversation") : t("startConversation")}
          </div>
          <GPTShareButton conversation={conversation} />
        </div>
        <ScrollArea className="flex-1 px-4">
          <div className="space-y-4 px-2 mb-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("models.conversation.name")}</FormLabel>
                  <Input value={field.value} onChange={field.onChange} />
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="configuration.type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("models.conversation.type")}</FormLabel>
                  <Select
                    disabled={Boolean(conversation?.id)}
                    onValueChange={field.onChange}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t("selectAiType")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem key="gpt" value="gpt">
                        GPT
                      </SelectItem>
                      <SelectItem key="tts" value="tts">
                        TTS
                      </SelectItem>
                    </SelectContent>
                  </Select>
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

        <div className="flex justify-center space-x-4 py-6 px-6 border-t shadow">
          {conversation.id && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  className="w-full h-12 text-destructive"
                  size="lg"
                  variant="secondary"
                >
                  {t("delete")}
                </Button>
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
                    className="bg-destructive hover:bg-destructive-hover"
                    onClick={destroyConversation}
                  >
                    {t("delete")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          <Button
            disabled={
              submitting || (conversation.id && !form.formState.isDirty)
            }
            className="w-full h-12"
            data-testid="conversation-form-submit"
            size="lg"
            type="submit"
          >
            {submitting && <LoaderIcon className="mr-2 animate-spin" />}
            {t("confirm")}
          </Button>
        </div>
      </form>
    </Form>
  );
};
