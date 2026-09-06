import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { t } from "i18next";
import { useContext, useState } from "react";
import {
  Button,
  FormField,
  Form,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  FormDescription,
} from "@renderer/components/ui";
import { AISettingsProviderContext } from "@renderer/context";
import {
  AI_PROVIDER_CATALOG,
  SUPPORTED_LLM_PROVIDER_IDS,
  type AiProviderId,
} from "@/lib/ai-providers";

const providerConfigSchema = z.object({
  key: z.string().optional(),
  baseUrl: z.string().optional(),
  models: z.string().optional(),
});

type ProviderConfigForm = z.infer<typeof providerConfigSchema>;

export const OpenaiSettings = () => {
  const { providerConfigs, setProviderConfig } = useContext(
    AISettingsProviderContext
  );
  const [selectedProvider, setSelectedProvider] = useState<AiProviderId>(
    "openai"
  );
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const config = providerConfigs[selectedProvider];
  const definition = AI_PROVIDER_CATALOG[selectedProvider];

  const form = useForm<ProviderConfigForm>({
    resolver: zodResolver(providerConfigSchema),
    values: {
      key: config?.key || "",
      baseUrl: config?.baseUrl || "",
      models: config?.models || "",
    },
  });

  const onSubmit = async (data: ProviderConfigForm) => {
    setSaving(true);
    try {
      await setProviderConfig(selectedProvider, {
        ...config,
        name: selectedProvider,
        key: data.key,
        baseUrl: data.baseUrl,
        models: data.models || "",
      });
      setEditing(false);
      toast.success(t("providerConfigSaved"));
    } catch (error) {
      console.error(error);
      toast.error(t("providerConfigSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const selectProvider = (value: string) => {
    if (!SUPPORTED_LLM_PROVIDER_IDS.includes(value as AiProviderId)) return;
    setSelectedProvider(value as AiProviderId);
    setEditing(false);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="flex items-start justify-between py-4">
          <div className="min-w-0 flex-1">
            <div className="mb-2">{t("aiProviders.title")}</div>
            <div className="text-sm text-muted-foreground space-y-3">
              <div className="flex items-center space-x-2">
                <FormLabel className="min-w-max">{t("aiEngine")}:</FormLabel>
                <Select
                  value={selectedProvider}
                  disabled={editing}
                  onValueChange={selectProvider}
                >
                  <SelectTrigger className="min-w-fit">
                    <SelectValue />
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
              <FormDescription>
                {t(definition.descriptionKey)}
              </FormDescription>

              {definition.acceptsApiKey && (
                <FormField
                  control={form.control}
                  name="key"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center space-x-2">
                        <FormLabel className="min-w-max">
                          {t("key")}:
                        </FormLabel>
                        <Input
                          disabled={!editing || saving}
                          type="password"
                          value={field.value || ""}
                          onChange={field.onChange}
                        />
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {!definition.acceptsApiKey && selectedProvider !== "enjoyai" && (
                <FormDescription>
                  {t("providerNoApiKeyRequired")}
                </FormDescription>
              )}

              {selectedProvider !== "enjoyai" && (
                <FormField
                  control={form.control}
                  name="baseUrl"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center space-x-2">
                        <FormLabel className="min-w-max">
                          {t("baseUrl")}:
                        </FormLabel>
                        <Input
                          disabled={!editing || saving}
                          placeholder={
                            definition.defaultBaseUrl ||
                            t("leaveEmptyToUseDefault")
                          }
                          value={field.value || ""}
                          onChange={field.onChange}
                        />
                      </div>
                      <FormDescription>
                        {t("openaiBaseUrlDescription")}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="models"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center space-x-2">
                      <FormLabel className="min-w-max">
                        {t("customModels")}:
                      </FormLabel>
                      <Input
                        disabled={!editing || saving}
                        placeholder={t("leaveEmptyToUseDefault")}
                        value={field.value || ""}
                        onChange={field.onChange}
                      />
                    </div>
                    <FormDescription>
                      {t("customModelsDescription")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <div className="flex items-center space-x-2 pl-4">
            <Button
              variant={editing ? "outline" : "secondary"}
              size="sm"
              type="reset"
              disabled={saving}
              onClick={(event) => {
                event.preventDefault();
                form.reset();
                setEditing(!editing);
              }}
            >
              {editing ? t("cancel") : t("edit")}
            </Button>
            <Button
              className={editing ? "" : "hidden"}
              size="sm"
              type="submit"
              disabled={saving}
            >
              {t("save")}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
};
