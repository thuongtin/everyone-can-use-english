import { t } from "i18next";
import { useContext } from "react";
import { ExternalLinkIcon, FolderIcon, InfoIcon } from "lucide-react";
import { AppSettingsProviderContext } from "@renderer/context";
import { SettingButton, SettingGroup } from "./settings-primitives";

export const LibrarySettings = () => {
  const { libraryPath, setLibraryPath, EnjoyApp } = useContext(
    AppSettingsProviderContext
  );

  const handleChooseLibraryPath = async () => {
    const filePaths = await EnjoyApp.dialog.showOpenDialog({
      properties: ["openDirectory"],
    });

    if (filePaths?.[0] && setLibraryPath) {
      await setLibraryPath(filePaths[0]);
      const _library = await EnjoyApp.appSettings.getLibrary();
      if (_library !== libraryPath) {
        EnjoyApp.app.relaunch();
      }
    }
  };

  return (
    <SettingGroup title={t("settings.libraryFolder")}>
      <div className="rounded-ej border border-ej-line bg-ej-surface px-4 py-3.5">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-ej-surface2">
            <FolderIcon className="size-[18px] text-ej-ink2" />
          </div>
          <div className="min-w-0">
            <div className="break-all text-[12.5px] leading-[1.5] text-ej-ink">
              {libraryPath}
            </div>
            <div className="mt-1 text-[11px] leading-[1.5] text-ej-muted">
              {t("settings.libraryFolderHint")}
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 border-t border-ej-line pt-3">
          <span className="flex min-w-0 items-center gap-1 text-[11px] text-ej-muted">
            <InfoIcon className="size-3 shrink-0" />
            <span className="truncate">{t("settings.restartNote")}</span>
          </span>
          <SettingButton
            className="ml-auto"
            onClick={() => EnjoyApp.shell.openPath(libraryPath)}
          >
            <ExternalLinkIcon className="size-3" />
            {t("settings.openFolder")}
          </SettingButton>
          <SettingButton onClick={handleChooseLibraryPath}>
            {t("settings.change")}
          </SettingButton>
        </div>
      </div>
    </SettingGroup>
  );
};
