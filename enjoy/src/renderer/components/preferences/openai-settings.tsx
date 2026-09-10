import { t } from "i18next";
import { useContext, useEffect, useState } from "react";
import { toast } from "@renderer/components/ui";
import { AISettingsProviderContext } from "@renderer/context";
import {
  SettingCard,
  SettingGroup,
  SettingRow,
  SettingSecretInput,
} from "./settings-primitives";

/**
 * The one key most users ever need. Everything else per provider lives in the
 * detailed disclosure further down the tab.
 */
export const OpenaiSettings = () => {
  const { providerConfigs, setProviderConfig, currentGptEngine } = useContext(
    AISettingsProviderContext
  );
  const config = providerConfigs["openai"];
  const [key, setKey] = useState<string>(config?.key || "");

  useEffect(() => setKey(config?.key || ""), [config?.key]);

  const save = () => {
    const next = key.trim();
    if (next === (config?.key || "")) return;

    setProviderConfig("openai", { ...config, name: "openai", key: next })
      .then(() => toast.success(t("providerConfigSaved")))
      .catch((error) => {
        console.error(error);
        toast.error(t("providerConfigSaveFailed"));
      });
  };

  const required = currentGptEngine?.name === "openai";

  return (
    <SettingGroup title={t("settings.apiKeys")}>
      <SettingCard>
        <SettingRow
          label={t("settings.openaiKey")}
          description={
            required
              ? t("settings.openaiKeyRequired")
              : t("settings.openaiKeyHint")
          }
        >
          <SettingSecretInput
            value={key}
            placeholder="sk-…"
            onChange={(event) => setKey(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </SettingRow>
      </SettingCard>
    </SettingGroup>
  );
};
