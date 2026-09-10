import { useState, useContext, useEffect } from "react";
import {
  AppSettingsProviderContext,
  DictProviderContext,
} from "@/renderer/context";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  toast,
} from "@/renderer/components/ui";
import { EjButton } from "@renderer/components/enjoy";
import { t } from "i18next";
import { LoaderIcon, PlusIcon } from "lucide-react";

export const DictImportButton = () => {
  const { reload, importMDict } = useContext(DictProviderContext);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleOpen = (value: boolean) => {
    setOpen(value);
  };

  const handleAdaptationDictImport = async () => {
    const pathes = await EnjoyApp.dialog.showOpenDialog({
      title: t("selectAdaptionDictTitle"),
      properties: ["openFile"],
      filters: [{ name: "zip", extensions: ["zip"] }],
    });

    if (!pathes[0]) return;
    setLoading(true);

    try {
      await EnjoyApp.dict.import(pathes[0]);
      setOpen(false);
    } catch (err) {
      toast.error(t("failedToImportDict", { error: err.message }));
    }

    setLoading(false);
    reload();
  };

  const handleOriginDictImport = async () => {
    const pathes = await EnjoyApp.dialog.showOpenDialog({
      title: t("selectMdictFileOrDirTitle"),
      properties: ["multiSelections", "openFile"],
    });

    if (!pathes[0]) return;
    setLoading(true);

    try {
      const mdict = await EnjoyApp.mdict.import(pathes);
      await importMDict(mdict);
      setOpen(false);
    } catch (err) {
      toast.error(t("failedToImportDict", { error: err.message }));
    }

    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex h-[42px] w-full items-center justify-center gap-1.5 border-t border-dashed border-ej-line2 text-xs font-semibold text-ej-accent-ink transition-colors duration-ej hover:bg-ej-surface2"
        >
          <PlusIcon className="size-3.5" />
          {t("settings.addMdx")}
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-ej-ink">
            {t("importDict")}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div>
            <div className="flex items-center justify-center px-4 py-4">
              <LoaderIcon className="size-5 animate-spin text-ej-muted" />
            </div>
            <div className="mb-8 text-center text-xs text-ej-muted">
              {t("dictImportSlowTip")}
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between py-4">
              <div className="mr-4">
                <div className="mb-2 text-xs font-semibold text-ej-ink">
                  {t("importAdaptionDict")}
                </div>
                <div className="mb-2 text-xxs leading-relaxed text-ej-muted">
                  {t("adaptionDictTip")}
                  <p>{t("bilingual.legacyImport")}</p>
                </div>
              </div>

              <EjButton size="sm" onClick={handleAdaptationDictImport}>
                {t("selectFile")}
              </EjButton>
            </div>

            <div className="flex items-center justify-between py-4">
              <div className="mr-4">
                <div className="mb-2 text-xs font-semibold text-ej-ink">
                  {t("importMdictFile")}
                </div>
                <div className="mb-2 text-xxs leading-relaxed text-ej-muted">
                  {t("mdictFileTip")}
                </div>
              </div>

              <EjButton size="sm" onClick={handleOriginDictImport}>
                {t("selectFile")}
              </EjButton>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
