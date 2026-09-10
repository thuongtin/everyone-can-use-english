import { t } from "i18next";
import { AppSettingsProviderContext } from "@renderer/context";
import { useContext } from "react";
import { LANGUAGES } from "@/constants";
import { SettingRow, SettingSelect } from "./settings-primitives";

export const NativeLanguageSettings = () => {
  const { nativeLanguage, switchNativeLanguage } = useContext(
    AppSettingsProviderContext
  );

  return (
    <SettingRow
      label={t("settings.nativeLanguage")}
      description={t("settings.nativeLanguageHint")}
    >
      <SettingSelect
        value={nativeLanguage}
        onChange={switchNativeLanguage}
        options={LANGUAGES.map((lang) => ({
          value: lang.code,
          label: `${lang.name} (${lang.code})`,
        }))}
      />
    </SettingRow>
  );
};
