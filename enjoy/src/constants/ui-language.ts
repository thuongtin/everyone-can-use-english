export const UI_LANGUAGES = ["vi", "en", "es"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

// Resolve display language without mutating a saved preference.
export const resolveUiLanguage = (language?: string): UiLanguage =>
  UI_LANGUAGES.find((supported) => supported === language) || "vi";
