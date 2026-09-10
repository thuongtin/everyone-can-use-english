import { t } from "i18next";
import { useContext, useEffect, useState } from "react";
import { toast } from "@renderer/components/ui";
import { AppSettingsProviderContext } from "@renderer/context";
import {
  SettingInput,
  SettingRow,
  SettingSwitch,
} from "./settings-primitives";

export const ProxySettings = () => {
  const { proxy, setProxy } = useContext(AppSettingsProviderContext);
  const [url, setUrl] = useState<string>(proxy?.url || "");

  useEffect(() => setUrl(proxy?.url || ""), [proxy?.url]);

  const save = (config: { enabled: boolean; url: string }) => {
    setProxy(config).then(() => toast.success(t("proxyConfigUpdated")));
  };

  const saveUrl = () => {
    const next = url.trim();
    if (next === (proxy?.url || "")) return;

    /* An empty address cannot stay enabled, so turn the switch off with it. */
    save({ enabled: next ? proxy?.enabled : false, url: next });
  };

  return (
    <SettingRow
      label={t("settings.proxy")}
      description={t("settings.proxyHint")}
    >
      <div className="flex items-center gap-2">
        <SettingInput
          value={url}
          placeholder="http://proxy:port"
          className="min-w-[200px]"
          onChange={(event) => setUrl(event.target.value)}
          onBlur={saveUrl}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <SettingSwitch
          checked={Boolean(proxy?.enabled)}
          disabled={!url.trim()}
          aria-label={t("settings.proxy")}
          onCheckedChange={(enabled) => save({ enabled, url: url.trim() })}
        />
      </div>
    </SettingRow>
  );
};
