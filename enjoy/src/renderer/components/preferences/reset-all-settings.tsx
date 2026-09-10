import { t } from "i18next";
import { ResetAllButton } from "@renderer/components";
import { SettingButton, SettingRow } from "./settings-primitives";

export const ResetAllSettings = () => (
  <SettingRow
    label={t("settings.deleteAllData")}
    description={t("settings.resetAllHint")}
    note={t("relaunchIsNeededAfterChanged")}
  >
    <ResetAllButton>
      <SettingButton danger>{t("settings.deleteAll")}</SettingButton>
    </ResetAllButton>
  </SettingRow>
);
