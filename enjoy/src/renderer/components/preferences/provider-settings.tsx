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

export const ProviderSettings = () => {
  const {
    providerConfigs,
    setProviderConfig,
    acpStatuses,
    acpStatusLoading,
    refreshAcpStatus,
  } = useContext(
    AISettingsProviderContext
  );
  const [selectedProvider, setSelectedProvider] = useState<AiProviderId>(
    "openai"
  );
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const config = providerConfigs[selectedProvider];
  const definition = AI_PROVIDER_CATALOG[selectedProvider];
  const acpProvider =
    selectedProvider === "codex-acp"
      ? "codex"
      : selectedProvider === "claude-acp"
        ? "claude"
        : undefined;
  const acpStatus = acpProvider
    ? acpStatuses.find((status) => status.provider === acpProvider)
    : undefined;
  const azureOpenAiProvider = selectedProvider === "azure-openai";
  const vertexExpressProvider = selectedProvider === "vertex-express";
  const baseUrlConfigurable = definition.configurable.includes("baseUrl");
  const modelConfigurable = definition.configurable.includes("model");

  const form = useForm<ProviderConfigForm>({
    resolver: zodResolver(providerConfigSchema),
    values: {
      key: config?.key || "",
      baseUrl: config?.baseUrl || "",
      models: config?.models || "",
    },
  });

  const onSubmit = async (data: ProviderConfigForm) => {
    if (vertexExpressProvider && !data.key?.trim()) {
      toast.error(t("providerApiKeyRequired"));
      return;
    }
    if (vertexExpressProvider && !data.models?.trim()) {
      toast.error(t("providerModelRequired"));
      return;
    }
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
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-sm text-ej-muted space-y-3">
              <div className="flex items-center space-x-2">
                <FormLabel className="min-w-max">{t("aiEngine")}:</FormLabel>
                <Select
                  value={selectedProvider}
                  disabled={editing}
                  onValueChange={selectProvider}
                >
                  <SelectTrigger
                    className="min-w-fit"
                    data-testid="ai-provider-select"
                  >
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
                {acpProvider
                  ? "Dùng phiên đăng nhập hiện có của CLI trên máy qua ACP. Không cần API key hoặc Base URL."
                  : t(definition.descriptionKey)}
              </FormDescription>

              {acpProvider && (
                <div className="rounded-md border p-3 text-sm">
                  <div className="font-medium">
                    {acpStatus?.available ? "Đã kết nối" : "Không khả dụng"}
                  </div>
                  {!acpStatus?.available && (
                    <div className="mt-1 text-ej-muted">
                      {acpStatus?.reason ||
                        "Không tìm thấy ACP runtime tương ứng."}
                    </div>
                  )}
                  {acpStatus?.available && (
                    <div className="mt-1 text-ej-muted">
                      {acpStatus.models.length > 0
                        ? `Mô hình: ${acpStatus.models.map((model) => model.name).join(", ")}`
                        : "Runtime chưa cung cấp model nào."}
                    </div>
                  )}
                </div>
              )}

              {!acpProvider && definition.acceptsApiKey && (
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
                          data-testid="provider-api-key-input"
                          disabled={!editing || saving}
                          type="password"
                          value={field.value || ""}
                          onChange={field.onChange}
                        />
                      </div>
                      <FormMessage />
                      {azureOpenAiProvider && config?.credentialError && (
                        <FormDescription>{t("azureKeyUnavailable")}</FormDescription>
                      )}
                    </FormItem>
                  )}
                />
              )}

              {!acpProvider && !definition.acceptsApiKey && (
                <FormDescription>
                  {t("providerNoApiKeyRequired")}
                </FormDescription>
              )}

              {!acpProvider && baseUrlConfigurable && (
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
                          data-testid="provider-base-url-input"
                          disabled={!editing || saving}
                          placeholder={
                            azureOpenAiProvider
                              ? "https://<resource>.openai.azure.com/openai/v1"
                              : definition.defaultBaseUrl ||
                                t("leaveEmptyToUseDefault")
                          }
                          value={field.value || ""}
                          onChange={field.onChange}
                        />
                      </div>
                      <FormDescription>
                        {t(
                          azureOpenAiProvider
                            ? "azureOpenAiBaseUrlDescription"
                            : "openaiBaseUrlDescription"
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {vertexExpressProvider && definition.defaultBaseUrl && (
                <div className="space-y-1">
                  <FormLabel>{t("providerFixedEndpoint")}:</FormLabel>
                  <div
                    className="break-all rounded-md border bg-muted px-3 py-2 font-mono text-xs"
                    data-testid="provider-fixed-base-url"
                  >
                    {definition.defaultBaseUrl}
                  </div>
                  <FormDescription>
                    {t("vertexExpressFixedEndpointDescription")}
                  </FormDescription>
                </div>
              )}

              {!acpProvider && modelConfigurable && (
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
                          data-testid="provider-models-input"
                          disabled={!editing || saving}
                          placeholder={
                            azureOpenAiProvider
                              ? "my-chat-deployment"
                              : vertexExpressProvider
                                ? t("vertexExpressModelPlaceholder")
                                : t("leaveEmptyToUseDefault")
                          }
                          value={field.value || ""}
                          onChange={field.onChange}
                        />
                      </div>
                      <FormDescription>
                        {t(
                          azureOpenAiProvider
                            ? "azureOpenAiDeploymentsDescription"
                            : vertexExpressProvider
                              ? "vertexExpressModelsDescription"
                              : "customModelsDescription"
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2 pl-4">
            {acpProvider ? (
              <Button
                variant="secondary"
                size="sm"
                type="button"
                disabled={acpStatusLoading}
                onClick={() => void refreshAcpStatus()}
              >
                {acpStatusLoading ? "Đang kiểm tra…" : "Thử lại"}
              </Button>
            ) : (
              <Button
                data-testid="provider-edit-button"
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
            )}
            {!acpProvider && (
              <Button
                data-testid="provider-save-button"
                className={editing ? "" : "hidden"}
                size="sm"
                type="submit"
                disabled={saving || Boolean(config?.credentialError && !form.watch("key")?.trim())}
              >
                {t("save")}
              </Button>
            )}
          </div>
        </div>
      </form>
    </Form>
  );
};
