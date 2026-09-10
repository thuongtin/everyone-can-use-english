import { useContext } from "react";
import { DictProviderContext } from "@renderer/context";
import { toast } from "@renderer/components/ui";
import { BILINGUAL_DICTIONARIES } from "@/constants/bilingual-dictionaries";
import { t } from "i18next";
import { SettingGroup } from "../settings-primitives";
import { DictImportButton } from "./dict-import-button";
import { DictRow } from "./dict-row";
import { InstalledDictList } from "./installed-dict-list";

export const DictSettings = () => {
  const { settings, installedDicts, setDefault } =
    useContext(DictProviderContext);

  const handleSelect = async (dict: DictItem) => {
    if (settings.default === dict.value) return;

    try {
      await setDefault(dict);
      toast.success(t("bilingual.defaultSaved"));
    } catch (err) {
      toast.error(err?.message || t("bilingual.error"));
    }
  };

  const count = BILINGUAL_DICTIONARIES.length + installedDicts.length;

  return (
    <SettingGroup
      title={t("settings.installedDicts")}
      meta={t("settings.dictCount", { count })}
    >
      <div className="overflow-hidden rounded-ej border border-ej-line bg-ej-surface">
        <div className="[&>*+*]:border-t [&>*+*]:border-ej-line">
          {BILINGUAL_DICTIONARIES.map(({ value, key }) => (
            <DictRow
              key={value}
              name={t(key)}
              meta={t("settings.bundledDict")}
              isDefault={settings.default === value}
              onSelect={() =>
                handleSelect({ type: "preset", value, text: t(key) })
              }
            />
          ))}
          <InstalledDictList onSelect={handleSelect} />
        </div>

        <DictImportButton />
      </div>

      <p className="mt-2 text-[11.5px] leading-[1.5] text-ej-muted">
        {t("settings.defaultDictHint")}
      </p>
    </SettingGroup>
  );
};
