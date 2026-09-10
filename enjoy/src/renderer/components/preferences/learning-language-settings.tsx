import { t } from "i18next";
import { useContext } from "react";
import { AppSettingsProviderContext } from "@renderer/context";
import { LANGUAGES } from "@/constants";
import { SettingRow, SettingSelect } from "./settings-primitives";

export const LearningLanguageSettings = () => {
  const { learningLanguage, switchLearningLanguage } = useContext(
    AppSettingsProviderContext
  );

  return (
    <SettingRow
      label={t("settings.learningLanguage")}
      description={t("settings.learningLanguageHint")}
    >
      <SettingSelect
        value={learningLanguage}
        onChange={switchLearningLanguage}
        options={LANGUAGES.map((lang) => ({
          value: lang.code,
          label: `${lang.name} (${lang.code})`,
        }))}
      />
    </SettingRow>
  );
};
