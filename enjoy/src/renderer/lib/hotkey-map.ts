export type HotkeyMap = Record<string, string>;

const isHotkeyPreferenceMap = (
  value: unknown
): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const mergeWithPreference = (
  preference: unknown,
  defaults: HotkeyMap
): HotkeyMap => {
  const merged: HotkeyMap = { ...defaults };
  if (!isHotkeyPreferenceMap(preference)) return merged;

  for (const [key, value] of Object.entries(preference)) {
    if (Object.prototype.hasOwnProperty.call(defaults, key) && typeof value === "string") {
      // An empty string is a valid explicit choice to disable a shortcut.
      merged[key] = value;
    }
  }

  return merged;
};
