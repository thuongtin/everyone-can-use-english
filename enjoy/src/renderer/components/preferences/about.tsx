import { t } from "i18next";
import { Button, Separator, toast } from "@renderer/components/ui";
import { AppSettingsProviderContext } from "@renderer/context";
import { useContext } from "react";

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
    <>
      <div className="font-semibold mb-4 capitilized">{t("about")}</div>

      <div className="flex items-start justify-between py-4">
        <div className="">
          <div className="mb-2">{t("currentVersion")}</div>
          <div className="text-sm text-muted-foreground mb-2">v{version}</div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Button onClick={checkUpdate}>
            {distribution.updateFeedUrl ? t("checkUpdate") : t("open")}
          </Button>
          {!distribution.updateFeedUrl && (
            <p className="max-w-xs text-right text-xs text-muted-foreground">
              {t("automaticUpdatesUnavailable")}
            </p>
          )}
        </div>
      </div>

      <Separator />

      <div className="flex items-start justify-between py-4">
        <div className="">
          <div className="mb-2">{t("userGuide")}</div>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            EnjoyApp.shell.openExternal(distribution.docsUrl);
          }}
        >
          {t("open")}
        </Button>
      </div>

      <Separator />

      <div className="flex items-start justify-between py-4">
        <div className="">
          <div className="mb-2">{t("feedback")}</div>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="secondary"
            onClick={() => {
              EnjoyApp.shell.openExternal(
                "https://mixin.one/codes/f8ff96b8-54fb-4ad8-a6d4-5a5bdb1df13e"
              );
            }}
          >
            Mixin
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              EnjoyApp.shell.openExternal(
                `${distribution.repositoryUrl.replace(/\/+$/, "")}/discussions`
              );
            }}
          >
            GitHub
          </Button>
        </div>
      </div>
    </>
  );
};
