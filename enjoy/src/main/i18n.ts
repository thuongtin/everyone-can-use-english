import { UI_LANGUAGES, resolveUiLanguage } from "@/constants/ui-language";
import * as i18next from "i18next";
import en from "@/i18n/en.json";
import vi from "@/i18n/vi.json";
import es from "@/i18n/es.json";

const resources = {
  vi: { translation: vi },
  es: { translation: es },
  en: {
    translation: en,
  },
};

export const i18n = (language?: string) => {
  i18next.init({
    resources,
    lng: resolveUiLanguage(language),
    supportedLngs: [...UI_LANGUAGES],
    fallbackLng: "vi",
    interpolation: {
      escapeValue: false, // react already safes from xss
    },
  });
};
