import { t } from "i18next";
import { AppSettingsProviderContext } from "@renderer/context";
import { useContext } from "react";
import {
  SettingCard,
  SettingGroup,
  SettingRow,
  SettingSelect,
} from "./settings-primitives";

const languageLabels = {
  vi: "Tiếng Việt",
  en: "English",
  es: "Español",
};

export const LanguageSettings = () => {
  const { language, savedUiLanguage, switchLanguage } = useContext(
    AppSettingsProviderContext
  );

  const legacyNotice =
    savedUiLanguage && savedUiLanguage !== language
      ? t("legacyUiLanguageNotice", { language: savedUiLanguage })
      : undefined;

  return (
    <SettingGroup>
      <SettingCard>
        <SettingRow
          label={t("settings.uiLanguage")}
          description={legacyNotice || t("settings.uiLanguageHint")}
        >
          <SettingSelect
            value={savedUiLanguage || language}
            options={Object.entries(languageLabels).map(([value, label]) => ({
              value,
              label,
            }))}
            onChange={(value) =>
              switchLanguage(value as keyof typeof languageLabels)
            }
          />
        </SettingRow>
      </SettingCard>
    </SettingGroup>
  );
};
