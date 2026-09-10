import { t } from "i18next";
import { ResetSettingsButton } from "@renderer/components";
import { SettingButton, SettingRow } from "./settings-primitives";

export const ResetSettings = () => (
  <SettingRow
    label={t("settings.resetSettings")}
    description={t("settings.resetSettingsHint")}
    note={t("relaunchIsNeededAfterChanged")}
  >
    <ResetSettingsButton>
      <SettingButton danger>{t("settings.reset")}</SettingButton>
    </ResetSettingsButton>
  </SettingRow>
);
