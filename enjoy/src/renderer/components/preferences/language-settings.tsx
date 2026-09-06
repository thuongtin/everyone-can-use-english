import { t } from "i18next";
import {
  Select,
  SelectTrigger,
  SelectItem,
  SelectValue,
  SelectContent,
} from "@renderer/components/ui";
import {
  AppSettingsProviderContext,
} from "@renderer/context";
import { useContext } from "react";

const languageLabels = {
  vi: "Tiếng Việt",
  en: "English",
  es: "Español",
};

export const LanguageSettings = () => {
  const { language, savedUiLanguage, switchLanguage } = useContext(AppSettingsProviderContext);

  return (
    <div className="flex items-start justify-between py-4">
      <div className="">
        <div className="mb-2">{t("language")}</div>
        <div className="text-sm text-muted-foreground mb-2">
          {languageLabels[language]}
        </div>
        {savedUiLanguage && savedUiLanguage !== language && (
          <p className="text-sm text-muted-foreground max-w-md">
            {t("legacyUiLanguageNotice", { language: savedUiLanguage })}
          </p>
        )}
      </div>

      <div className="">
        <div className="flex items-center justify-end space-x-2 mb-2">
          <Select
            value={savedUiLanguage || language}
            onValueChange={(value: keyof typeof languageLabels) => {
              switchLanguage(value);
            }}
          >
            <SelectTrigger className="text-xs">
              <SelectValue>
                {languageLabels[language]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(languageLabels).map(([value, label]) => (
                <SelectItem className="text-xs" value={value} key={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
};
