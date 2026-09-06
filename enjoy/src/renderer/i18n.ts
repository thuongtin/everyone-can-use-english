import { UI_LANGUAGES, resolveUiLanguage } from "@/constants/ui-language";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/i18n/en.json";
import es from "@/i18n/es.json";
import vi from "@/i18n/vi.json";

// the translations
// (tip move them in a JSON file and import them,
// or even better, manage them separated from your code: https://react.i18next.com/guides/multiple-translation-files)
const resources = {
  vi: { translation: vi },
  en: {
    translation: en,
  },
  es: {
    translation: es,
  },
};

i18n
  .use(initReactI18next) // passes i18n down to react-i18next
  .init({
    resources,
    lng: "vi",
    supportedLngs: [...UI_LANGUAGES],
    fallbackLng: "vi",
    interpolation: {
      escapeValue: false, // react already safes from xss
    },
  });

i18n.on("languageChanged", (language) => {
  document.documentElement.lang = resolveUiLanguage(language);
});

export default i18n;
