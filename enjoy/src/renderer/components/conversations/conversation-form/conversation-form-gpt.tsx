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
  Slider,
  Textarea,
} from "@renderer/components/ui";
import {
  isLegacyProviderModel,
  isSupportedProvider,
  providerSupportsOption,
  resolveProviderSwitchBaseUrl,
  type AiProviderId,
} from "@/lib/ai-providers";

const FIELD =
  "h-9 rounded-[10px] border-ej-line bg-ej-surface text-xs text-ej-ink focus-visible:ring-ej-accent";

export const ConversationFormGPT = (props: {
  conversation: Partial<ConversationType>;
  form: ReturnType<typeof useForm>;
  gptProviders: any;
}) => {
  const { form, gptProviders, conversation } = props;
  const canRebindLegacyConversation = Boolean(
    conversation?.id && !isSupportedProvider(conversation.engine)
  );
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
            <FormLabel className="ej-label">{t("models.conversation.engine")}</FormLabel>
            <Select
              disabled={Boolean(conversation?.id) && !canRebindLegacyConversation}
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
                <SelectTrigger className={FIELD}>
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
            <FormDescription className="text-xxs leading-4 text-ej-muted">
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
            <FormLabel className="ej-label">{t("models.conversation.model")}</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger className={FIELD}>
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
            <FormLabel className="ej-label">{t("models.conversation.roleDefinition")}</FormLabel>
            <Textarea
              placeholder={t("models.conversation.roleDefinitionPlaceholder")}
              className="min-h-[180px] rounded-[10px] border-ej-line bg-ej-surface text-xs leading-6 text-ej-ink focus-visible:ring-ej-accent"
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
              <div className="flex items-center justify-between">
                <FormLabel className="ej-label">
                  {t("models.conversation.temperature")}
                </FormLabel>
                <span className="ej-tabular text-xxs font-semibold text-ej-accent-ink">
                  {Number(field.value ?? 0).toFixed(1)}
                </span>
              </div>
              <FormControl>
                <Slider
                  min={0}
                  max={1}
                  step={0.1}
                  value={[Number(field.value ?? 0)]}
                  onValueChange={([value]) => field.onChange(value)}
                  className="py-2"
                />
              </FormControl>
              <FormDescription className="text-xxs leading-4 text-ej-muted">
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
              <FormLabel className="ej-label">{t("models.conversation.maxTokens")}</FormLabel>
              <Input
                className={FIELD}
                type="number"
                min="0"
                value={field.value}
                onChange={(event) => {
                  if (!event.target.value) return;
                  field.onChange(parseInt(event.target.value));
                }}
              />
              <FormDescription className="text-xxs leading-4 text-ej-muted">
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
              <FormLabel className="ej-label">{t("models.conversation.presencePenalty")}</FormLabel>
              <Input
                className={FIELD}
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
              <FormDescription className="text-xxs leading-4 text-ej-muted">
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
              <FormLabel className="ej-label">{t("models.conversation.frequencyPenalty")}</FormLabel>
              <Input
                className={FIELD}
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
              <FormDescription className="text-xxs leading-4 text-ej-muted">
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
              <FormLabel className="ej-label">{t("models.conversation.numberOfChoices")}</FormLabel>
              <Input
                className={FIELD}
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
              <FormDescription className="text-xxs leading-4 text-ej-muted">
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
            <FormLabel className="ej-label">{t("models.conversation.historyBufferSize")}</FormLabel>
            <Input
              className={FIELD}
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
            <FormDescription className="text-xxs leading-4 text-ej-muted">
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
              <FormLabel className="ej-label">{t("models.conversation.baseUrl")}</FormLabel>
              <Input
                {...field}
                className={FIELD}
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
