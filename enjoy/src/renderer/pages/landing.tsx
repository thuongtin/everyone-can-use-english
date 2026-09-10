import { t } from "i18next";
import { useContext, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ChevronRightIcon, LoaderIcon } from "lucide-react";
import { DbState } from "@renderer/components";
import { GradientAvatar } from "@renderer/components/enjoy";
import {
  AppSettingsProviderContext,
  DbProviderContext,
} from "@renderer/context";

type LocalProfile = { id: string; name?: string };

export default () => {
  const { initialized, user, login, EnjoyApp } = useContext(
    AppSettingsProviderContext
  );
  const [profiles, setProfiles] = useState<LocalProfile[] | null>(null);
  const db = useContext(DbProviderContext);

  useEffect(() => {
    if (user) return;
    let active = true;
    EnjoyApp.appSettings.getSessions().then((sessions) => {
      if (active) setProfiles(sessions);
    });
    return () => {
      active = false;
    };
  }, [EnjoyApp, user]);

  if (initialized) {
    return <Navigate to="/" replace />;
  }

  if (user && db.state === "error") {
    return (
      <div
        className="flex justify-center items-center h-full"
        date-testid="layout-db-error"
      >
        <DbState />
      </div>
    );
  }

  return (
    <div
      className="flex h-full items-center justify-center px-4 py-6 bg-ej-bg"
      data-testid="layout-local-profile"
    >
      <div className="w-full max-w-[440px] rounded-[18px] border border-ej-line bg-ej-surface shadow-ej p-7">
        <div className="flex flex-col items-center text-center">
          <img
            src="./assets/icon.png"
            alt="Enjoy"
            className="size-14 rounded-[14px] mb-3.5"
          />
          <div className="text-xl font-bold text-ej-ink">
            {t("landing.title")}
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ej-muted max-w-[320px]">
            {profiles === null
              ? t("landing.loading")
              : profiles.length > 0
                ? t("landing.pickProfile")
                : t("landing.noProfile")}
          </p>
        </div>

        {profiles === null && (
          <div className="mt-6 flex justify-center">
            <LoaderIcon className="size-5 animate-spin text-ej-muted" />
          </div>
        )}

        {profiles && profiles.length > 0 && (
          <div className="mt-6 flex flex-col gap-2">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                data-testid={`select-local-profile-${profile.id}`}
                onClick={() =>
                  void login?.({
                    id: profile.id,
                    name: profile.name || "Local",
                  })
                }
                className="group w-full flex items-center gap-3 rounded-xl border border-ej-line bg-ej-surface p-3 text-left transition-colors duration-ej hover:border-ej-accent hover:bg-ej-accent-soft"
              >
                <GradientAvatar
                  name={profile.name || "Local"}
                  id={profile.id}
                  size={36}
                  square
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-ej-ink truncate">
                    {profile.name || "Local"}
                  </div>
                  <div className="ej-tabular text-[11.5px] text-ej-muted truncate">
                    {profile.id} · {t("landing.localData")}
                  </div>
                </div>
                <ChevronRightIcon className="size-4 shrink-0 text-ej-muted group-hover:text-ej-accent-ink" />
              </button>
            ))}
          </div>
        )}

        <Link
          to="/dictionary"
          className="mt-6 flex items-center justify-center gap-1 text-xs text-ej-accent hover:text-ej-accent-ink transition-colors duration-ej"
        >
          {t("landing.openDictionary")}
          <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  );
};
