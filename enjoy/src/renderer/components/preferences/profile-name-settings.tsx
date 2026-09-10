import { t } from "i18next";
import { useContext, useEffect, useRef, useState } from "react";
import { toast } from "@renderer/components/ui";
import { GradientAvatar } from "@renderer/components/enjoy";
import { AppSettingsProviderContext } from "@renderer/context";
import { SettingGroup, SettingInput } from "./settings-primitives";

/** Debounce so every keystroke does not hit the local profile store. */
const SAVE_DELAY = 500;

/**
 * Enjoy has no login, so the display name is purely a label for the local data
 * profile. It opens both the basic and the local-data tabs.
 */
export const ProfileNameSettings = () => {
  const { user, login } = useContext(AppSettingsProviderContext);
  const [name, setName] = useState(user?.name ?? "");
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setName(user?.name ?? "");
  }, [user?.name]);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!user) return null;

  const save = (value: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const trimmed = value.trim();
      if (!trimmed || trimmed === user.name) return;

      try {
        await login?.({ id: user.id, name: trimmed });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("profileUpdateFailed")
        );
      }
    }, SAVE_DELAY);
  };

  return (
    <SettingGroup>
      <div className="flex items-start justify-between gap-6 rounded-ej border border-ej-line bg-ej-surface px-4 py-3.5">
        <div className="flex min-w-0 items-start gap-3">
          <GradientAvatar name={name} id={user.id} size={48} square />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-ej-ink">
              {t("settings.yourName")}
            </div>
            <div className="mt-0.5 text-xs leading-[1.5] text-ej-muted">
              {t("settings.yourNameHint")}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <SettingInput
            value={name}
            data-testid="profile-name-input"
            className="min-w-[200px] font-semibold text-[13px]"
            onChange={(event) => {
              setName(event.target.value);
              save(event.target.value);
            }}
          />
          <span className="text-[10.5px] text-ej-muted ej-tabular">
            {t("settings.profileId", { id: user.id })}
          </span>
        </div>
      </div>
    </SettingGroup>
  );
};
