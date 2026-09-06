export const BILINGUAL_DICTIONARIES = [
  { value: "en-vi", key: "bilingual.enVi" },
  { value: "vi-en", key: "bilingual.viEn" },
] as const;

export const isBilingualDirection = (value: string): value is BilingualDirection =>
  value === "en-vi" || value === "vi-en";

export const getDefaultDictionary = (saved: string, available: string[], learningLanguage: string) =>
  available.includes(saved) ? saved : learningLanguage.startsWith("en") ? "en-vi" : "ai";
