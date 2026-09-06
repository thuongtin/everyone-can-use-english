import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { t } from "i18next";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
  toast,
  Form,
  Button,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@renderer/components/ui";
import {
  AISettingsProviderContext,
} from "@renderer/context";
import { useContext, useState } from "react";
import {
  AI_PROVIDER_CATALOG,
  SUPPORTED_LLM_PROVIDER_IDS,
  isSupportedProvider,
  resolveProviderModel,
  type AiProviderId,
} from "@/lib/ai-providers";

const PROVIDER_IDS = [...SUPPORTED_LLM_PROVIDER_IDS] as [
  AiProviderId,
  ...AiProviderId[],
];

export const DefaultEngineSettings = () => {
  const { currentGptEngine, setGptEngine, gptProviders } = useContext(
    AISettingsProviderContext
  );
  const [editing, setEditing] = useState(false);

  const gptEngineSchema = z
    .object({
      name: z.enum(PROVIDER_IDS),
      models: z.object({
        default: z.string(),
        lookup: z.string().optional(),
        translate: z.string().optional(),
        analyze: z.string().optional(),
        extractStory: z.string().optional(),
      }),
    })
    .required();

  const form = useForm<z.infer<typeof gptEngineSchema>>({
    resolver: zodResolver(gptEngineSchema),
    values: {
      name: currentGptEngine.name as AiProviderId,
      models: currentGptEngine.models || {},
    },
  });

  const modelOptions = () => {
    const name = form.watch("name") as AiProviderId;
    const currentModels =
      name === currentGptEngine.name
        ? Object.values(currentGptEngine.models || {})
        : [];
    return Array.from(
      new Set([...(gptProviders[name]?.models || []), ...currentModels])
    );
  };

  const onSubmit = async (data: z.infer<typeof gptEngineSchema>) => {
    const { name, models } = data;
    const options = modelOptions();
    const normalizedModels = { ...models };
    const defaultModel = resolveProviderModel(options, normalizedModels.default);
    if (!defaultModel) {
      toast.error(
        t(
          name === "ollama" || name === "lmstudio"
            ? "localProviderModelRequired"
            : "providerModelRequired"
        )
      );
      return;
    }
    normalizedModels.default = defaultModel;
    (Object.keys(normalizedModels) as Array<keyof typeof normalizedModels>).forEach(
      (key) => {
        const model = normalizedModels[key];
        if (!model || !options.includes(model)) {
          if (key === "default") {
            normalizedModels[key] = defaultModel;
          } else {
            delete normalizedModels[key];
          }
        }
      }
    );

    try {
      await setGptEngine({
        name,
        models: normalizedModels,
      } as GptEngineSettingType);
      setEditing(false);
    } catch (error) {
      console.error(error);
      toast.error(t("providerConfigSaveFailed"));
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="flex items-start justify-between py-4">
          <div className="">
            <div className="flex items-center mb-2">
              <span>{t("defaultAiEngine")}</span>
            </div>
            <div className="text-sm text-muted-foreground space-y-3">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center space-x-2">
                      <FormLabel className="min-w-max">
                        {t("aiEngine")}:
                      </FormLabel>
                      <Select
                        value={field.value}
                        disabled={!editing}
                        onValueChange={(value) => {
                          field.onChange(value);
                          const provider = value as AiProviderId;
                          const firstModel = resolveProviderModel(
                            gptProviders[provider]?.models
                          );
                          form.setValue("models.default", firstModel || "", {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                        }}
                      >
                        <SelectTrigger className="min-w-fit">
                          <SelectValue
                            placeholder={t("defaultAiEngine")}
                          ></SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {SUPPORTED_LLM_PROVIDER_IDS.map((provider) => (
                            <SelectItem key={provider} value={provider}>
                              {AI_PROVIDER_CATALOG[provider].name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <FormMessage />
                    <div className="text-xs text-muted-foreground">
                      {(() => {
                        const providerName = form.watch("name") as string;
                        return isSupportedProvider(providerName)
                          ? t(AI_PROVIDER_CATALOG[providerName].descriptionKey)
                          : t("aiEngineNotSupported");
                      })()}
                    </div>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="models.default"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center space-x-2">
                      <FormLabel className="min-w-max">
                        {t("defaultAiModel")}:
                      </FormLabel>
                      <Select
                        value={field.value}
                        disabled={!editing}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger className="min-w-fit">
                          <SelectValue
                            placeholder={t("defaultAiModel")}
                          ></SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {modelOptions().map((model: string) => (
                            <SelectItem key={model} value={model}>
                              {model}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </FormItem>
                )}
              />
              {editing && (
                <>
                  <FormField
                    control={form.control}
                    name="models.lookup"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center space-x-2">
                          <FormLabel className="min-w-max">
                            {t("lookupAiModel")}:
                          </FormLabel>
                          <Select
                            value={field.value}
                            disabled={!editing}
                            onValueChange={field.onChange}
                          >
                            <SelectTrigger className="min-w-fit">
                              <SelectValue
                                placeholder={t("leaveEmptyToUseDefault")}
                              ></SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {modelOptions().map((model: string) => (
                                <SelectItem key={model} value={model}>
                                  {model}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="models.translate"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center space-x-2">
                          <FormLabel className="min-w-max">
                            {t("translateAiModel")}:
                          </FormLabel>
                          <Select
                            value={field.value}
                            disabled={!editing}
                            onValueChange={field.onChange}
                          >
                            <SelectTrigger className="min-w-fit">
                              <SelectValue
                                placeholder={t("leaveEmptyToUseDefault")}
                              ></SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {modelOptions().map((model: string) => (
                                <SelectItem key={model} value={model}>
                                  {model}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="models.analyze"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center space-x-2">
                          <FormLabel className="min-w-max">
                            {t("analyzeAiModel")}:
                          </FormLabel>
                          <Select
                            value={field.value}
                            disabled={!editing}
                            onValueChange={field.onChange}
                          >
                            <SelectTrigger className="min-w-fit">
                              <SelectValue
                                placeholder={t("leaveEmptyToUseDefault")}
                              ></SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {modelOptions().map((model: string) => (
                                <SelectItem key={model} value={model}>
                                  {model}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="models.extractStory"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center space-x-2">
                          <FormLabel className="min-w-max">
                            {t("extractStoryAiModel")}:
                          </FormLabel>
                          <Select
                            value={field.value}
                            disabled={!editing}
                            onValueChange={field.onChange}
                          >
                            <SelectTrigger className="min-w-fit">
                              <SelectValue
                                placeholder={t("leaveEmptyToUseDefault")}
                              ></SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {modelOptions().map((model: string) => (
                                <SelectItem key={model} value={model}>
                                  {model}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </FormItem>
                    )}
                  />
                </>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Button
              variant={editing ? "outline" : "secondary"}
              size="sm"
              type="reset"
              onClick={(event) => {
                event.preventDefault();
                form.reset();
                setEditing(!editing);
              }}
            >
              {editing ? t("cancel") : t("edit")}
            </Button>
            <Button className={editing ? "" : "hidden"} size="sm" type="submit">
              {t("save")}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
};
