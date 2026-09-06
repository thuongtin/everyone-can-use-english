import { t } from "i18next";
import { useForm } from "react-hook-form";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Textarea,
} from "@renderer/components/ui";
import {
  isLegacyProviderModel,
  providerSupportsOption,
  resolveProviderSwitchBaseUrl,
  type AiProviderId,
} from "@/lib/ai-providers";

export const ConversationFormGPT = (props: {
  conversation: Partial<ConversationType>;
  form: ReturnType<typeof useForm>;
  gptProviders: any;
}) => {
  const { form, gptProviders, conversation } = props;
  const selectedEngine = form.watch("engine") as AiProviderId;
  const selectedModel = form.watch("configuration.model") as string | undefined;
  const provider = gptProviders[selectedEngine];
  const supports = (
    option: Parameters<typeof providerSupportsOption>[1]
  ) => providerSupportsOption(selectedEngine, option, selectedModel, provider);
  const modelOptions = Array.from(
    new Set(
      [ ...(provider?.models || []), selectedModel ].filter(
        (model): model is string => typeof model === "string" && model.length > 0
      )
    )
  );

  return (
    <>
      <FormField
        control={form.control}
        name="engine"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("models.conversation.engine")}</FormLabel>
            <Select
              disabled={Boolean(conversation?.id)}
              onValueChange={(value) => {
                const currentProvider = form.getValues("engine");
                const currentBaseUrl = form.getValues(
                  "configuration.baseUrl"
                );
                field.onChange(value);
                const nextProvider = gptProviders[value as AiProviderId];
                const firstModel = nextProvider?.models?.[0];
                form.setValue("configuration.model", firstModel || "", {
                  shouldDirty: true,
                  shouldValidate: true,
                });
                form.setValue(
                  "configuration.baseUrl",
                  resolveProviderSwitchBaseUrl(
                    currentProvider,
                    value,
                    currentBaseUrl
                  ),
                  {
                    shouldDirty: true,
                    shouldValidate: true,
                  }
                );
              }}
              value={field.value}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder={t("selectAiEngine")} />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {Object.keys(gptProviders).map((key) => (
                  <SelectItem key={key} value={key}>
                    {gptProviders[key].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormDescription>
              {provider?.descriptionKey
                ? t(provider.descriptionKey)
                : t("aiEngineNotSupported")}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="configuration.model"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("models.conversation.model")}</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder={t("selectAiModel")} />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {modelOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {isLegacyProviderModel(selectedEngine, option)
                      ? `${option} (legacy)`
                      : option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="configuration.roleDefinition"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("models.conversation.roleDefinition")}</FormLabel>
            <Textarea
              placeholder={t("models.conversation.roleDefinitionPlaceholder")}
              className="h-64"
              {...field}
            />
            <FormMessage />
          </FormItem>
        )}
      />

      {supports("temperature") && (
        <FormField
          control={form.control}
          name="configuration.temperature"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("models.conversation.temperature")}</FormLabel>
              <Input
                type="number"
                min="0"
                max="1.0"
                step="0.1"
                value={field.value}
                onChange={(event) => {
                  field.onChange(
                    event.target.value ? parseFloat(event.target.value) : 0.0
                  );
                }}
              />
              <FormDescription>
                {t("models.conversation.temperatureDescription")}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {supports("maxTokens") && (
        <FormField
          control={form.control}
          name="configuration.maxTokens"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("models.conversation.maxTokens")}</FormLabel>
              <Input
                type="number"
                min="0"
                value={field.value}
                onChange={(event) => {
                  if (!event.target.value) return;
                  field.onChange(parseInt(event.target.value));
                }}
              />
              <FormDescription>
                {t("models.conversation.maxTokensDescription")}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {supports("presencePenalty") && (
        <FormField
          control={form.control}
          name="configuration.presencePenalty"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("models.conversation.presencePenalty")}</FormLabel>
              <Input
                type="number"
                min="-2"
                step="0.1"
                max="2"
                value={field.value}
                onChange={(event) => {
                  if (!event.target.value) return;
                  field.onChange(parseInt(event.target.value));
                }}
              />
              <FormDescription>
                {t("models.conversation.presencePenaltyDescription")}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {supports("frequencyPenalty") && (
        <FormField
          control={form.control}
          name="configuration.frequencyPenalty"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("models.conversation.frequencyPenalty")}</FormLabel>
              <Input
                type="number"
                min="-2"
                step="0.1"
                max="2"
                value={field.value}
                onChange={(event) => {
                  if (!event.target.value) return;
                  field.onChange(parseInt(event.target.value));
                }}
              />
              <FormDescription>
                {t("models.conversation.frequencyPenaltyDescription")}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {supports("numberOfChoices") && (
        <FormField
          control={form.control}
          name="configuration.numberOfChoices"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("models.conversation.numberOfChoices")}</FormLabel>
              <Input
                type="number"
                min="1"
                step="1.0"
                value={field.value}
                onChange={(event) => {
                  field.onChange(
                    event.target.value ? parseInt(event.target.value) : 1.0
                  );
                }}
              />
              <FormDescription>
                {t("models.conversation.numberOfChoicesDescription")}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      <FormField
        control={form.control}
        name="configuration.historyBufferSize"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("models.conversation.historyBufferSize")}</FormLabel>
            <Input
              type="number"
              min="0"
              step="1"
              max="100"
              value={field.value}
              onChange={(event) => {
                field.onChange(
                  event.target.value ? parseInt(event.target.value) : 0
                );
              }}
            />
            <FormDescription>
              {t("models.conversation.historyBufferSizeDescription")}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {supports("baseUrl") && (
        <FormField
          control={form.control}
          name="configuration.baseUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("models.conversation.baseUrl")}</FormLabel>
              <Input
                {...field}
                placeholder={t("models.conversation.baseUrlDescription")}
              />
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </>
  );
};
