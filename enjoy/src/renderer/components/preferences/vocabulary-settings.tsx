import { t } from "i18next";
import { useContext } from "react";
import { AppSettingsProviderContext } from "@renderer/context";
import {
  SettingCard,
  SettingGroup,
  SettingRow,
  SettingSwitch,
} from "./settings-primitives";

export const VocabularySettings = () => {
  const { vocabularyConfig, setVocabularyConfig } = useContext(
    AppSettingsProviderContext
  );

  return (
    <SettingGroup title={t("settings.lookup")}>
      <SettingCard>
        <SettingRow
          label={t("settings.lookupOnMouseOver")}
          description={t("settings.lookupOnMouseOverHint")}
        >
          <SettingSwitch
            checked={vocabularyConfig.lookupOnMouseOver}
            onCheckedChange={(checked) =>
              setVocabularyConfig({
                ...vocabularyConfig,
                lookupOnMouseOver: checked,
              })
            }
          />
        </SettingRow>
      </SettingCard>
    </SettingGroup>
  );
};
