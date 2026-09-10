import { t } from "i18next";
import { useContext } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { Button, toast } from "@renderer/components/ui";
import { AppSettingsProviderContext } from "@renderer/context";

export const About = () => {
  const { version, distribution, EnjoyApp } = useContext(
    AppSettingsProviderContext
  );

  const checkUpdate = async () => {
    const platformInfo = await EnjoyApp.app.getPlatformInfo();
    if (!distribution.updateFeedUrl || platformInfo.platform === "linux") {
      EnjoyApp.shell.openExternal(distribution.downloadUrl);
      if (!distribution.updateFeedUrl) {
        toast.info(t("automaticUpdatesUnavailable"));
      }
    } else {
      EnjoyApp.app.checkForUpdates();
      toast.info(t("checkingForUpdate"));
    }
  };

  return (
    <div className="pt-4 flex flex-col items-center text-center">
      <img
        src="./assets/icon.png"
        alt="Enjoy"
        className="size-16 rounded-[14px] mb-3"
      />
      <div className="text-xl font-bold text-ej-ink">Enjoy</div>
      <div className="ej-tabular text-xs text-ej-muted mb-3">
        v{version} · {t("settings.localFirst")}
      </div>
      <p className="max-w-[380px] text-[12.5px] leading-relaxed text-ej-ink2 mb-6">
        {t("settings.aboutDescription")}
      </p>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={checkUpdate}>
          {distribution.updateFeedUrl ? t("checkUpdate") : t("open")}
        </Button>
        <Button
          variant="outline"
          className="gap-1.5"
          onClick={() => EnjoyApp.shell.openExternal(distribution.docsUrl)}
        >
          {t("userGuide")}
          <ExternalLinkIcon className="size-3.5" />
        </Button>
        <Button
          variant="outline"
          className="gap-1.5"
          onClick={() =>
            EnjoyApp.shell.openExternal(distribution.repositoryUrl)
          }
        >
          {t("sourceCode")}
          <ExternalLinkIcon className="size-3.5" />
        </Button>
      </div>

      {!distribution.updateFeedUrl && (
        <p className="mt-4 max-w-[360px] text-xs text-ej-muted">
          {t("automaticUpdatesUnavailable")}
        </p>
      )}

      <button
        type="button"
        onClick={() =>
          EnjoyApp.shell.openExternal(
            `${distribution.repositoryUrl.replace(/\/+$/, "")}/discussions`
          )
        }
        className="mt-6 text-xs text-ej-accent hover:text-ej-accent-ink transition-colors duration-ej"
      >
        {t("feedback")}
      </button>
    </div>
  );
};
