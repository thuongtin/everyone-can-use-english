import { useContext } from "react";
import { DictProviderContext } from "@renderer/context";
import { Button, toast } from "@renderer/components/ui";
import { BILINGUAL_DICTIONARIES } from "@/constants/bilingual-dictionaries";
import { BilingualDictionaryPanel } from "@renderer/components/widgets/lookup/bilingual-dictionary-panel";
import { t } from "i18next";
import { DictImportButton } from "./dict-import-button";
import { InstalledDictList } from ".";

export const DictSettings = () => {
  const { settings, setDefault } = useContext(DictProviderContext);
  return (
    <>
      <div className="mb-4">
        <div className="flex justify-between pt-4 ">
          <div className="mb-2">{t("dictionaries")}</div>
          <DictImportButton />
        </div>

        <div className="my-4 space-y-3">
          {BILINGUAL_DICTIONARIES.map(({ value, key }) => (
            <div key={value} className="flex flex-wrap justify-between gap-2 items-center">
              <span>{t(key)} <span className="text-xs text-muted-foreground">({t("bilingual.bundled")})</span></span>
              <Button size="sm" variant="secondary" disabled={settings.default === value} onClick={async () => {
                try {
                  await setDefault({ type: "preset", value, text: t(key) });
                  toast.success(t("bilingual.defaultSaved"));
                } catch { toast.error(t("bilingual.error")); }
              }}>{settings.default === value ? t("default") : t("setDefault")}</Button>
            </div>
          ))}
          <InstalledDictList />
        </div>
      </div>
      <BilingualDictionaryPanel />
    </>
  );
};
