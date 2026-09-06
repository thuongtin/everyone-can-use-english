import { createContext, useState, useEffect, useContext, useMemo } from "react";
import {
  AppSettingsProviderContext,
  DbProviderContext,
} from "@renderer/context";
import { t } from "i18next";
import { useTranslation } from "react-i18next";
import { BILINGUAL_DICTIONARIES, getDefaultDictionary } from "@/constants/bilingual-dictionaries";
import { UserSettingKeyEnum } from "@/types/enums";

type DictProviderState = {
  settings: DictSettingType;
  installedDicts: DictItem[];
  dictSelectItems: DictItem[];
  reload?: () => void;
  importMDict?: (mdict: MDict) => Promise<void>;
  lookup?: (word: string, dict: DictItem) => Promise<string | null>;
  getResource?: (key: string, dict: DictItem) => Promise<string | null>;
  remove?: (v: DictItem) => Promise<void>;
  currentDict?: DictItem | null;
  currentDictValue?: string;
  handleSetCurrentDict?: (v: string) => void;
  setDefault?: (v: DictItem) => Promise<void>;
};

const AIDict = {
  type: "preset" as DictType,
  text: t("aiLookup"),
  value: "ai",
};

const initialState: DictProviderState = {
  installedDicts: [],
  dictSelectItems: [AIDict],
  settings: {
    default: "",
    removing: [],
    mdicts: [],
  },
};

export const DictProviderContext =
  createContext<DictProviderState>(initialState);

export const DictProvider = ({ children }: { children: React.ReactNode }) => {
  const { i18n } = useTranslation();
  const { EnjoyApp, learningLanguage } = useContext(AppSettingsProviderContext);
  const [dicts, setDicts] = useState<Dict[]>([]);
  const [settings, setSettings] = useState<DictSettingType>({
    default: "",
    removing: [],
    mdicts: [],
  });
  const [currentDictValue, setCurrentDictValue] = useState<string>("en-vi");
  const { state: dbState } = useContext(DbProviderContext);

  const installedDicts = useMemo<DictItem[]>(() => {
    const _dicts = dicts
      .filter((dict) => dict.state === "installed")
      .map((dict) => ({
        type: "dict" as DictType,
        text: dict.title,
        value: dict.name,
      }));
    const _mdicts = (settings.mdicts || []).map((mdict) => ({
      type: "mdict" as DictType,
      text: mdict.title,
      value: mdict.hash,
    }));

    return [..._dicts, ..._mdicts];
  }, [dicts, settings]);

  const availableDicts = useMemo(() => {
    return installedDicts.filter(
      ({ value }) => !settings.removing.find((v) => v === value)
    );
  }, [installedDicts, settings]);

  const dictSelectItems = useMemo<DictItem[]>(() => [
    ...BILINGUAL_DICTIONARIES.map(({ value, key }) => ({ type: "preset" as DictType, value, text: t(key) })),
    { ...AIDict, text: t("aiLookup") },
    ...availableDicts,
  ], [availableDicts, i18n.language]);

  const currentDict = dictSelectItems.find(dict => dict.value === currentDictValue);

  useEffect(() => {
    setCurrentDictValue(getDefaultDictionary(settings.default, dictSelectItems.map(dict => dict.value), learningLanguage));
  }, [dictSelectItems, settings.default, learningLanguage]);

  useEffect(() => {
    if (dbState !== "connected") return;

    fetchSettings();
    fetchDicts();
  }, [dbState]);

  const fetchSettings = async () => {
    return EnjoyApp.userSettings.get(UserSettingKeyEnum.DICTS).then((res) => {
      if (res) {
        setSettings({ ...initialState.settings, ...res });
      } else {
        setSettings(initialState.settings);
      }
    });
  };

  const updateSettings = async (_settings: DictSettingType) => {
    return EnjoyApp.userSettings
      .set(UserSettingKeyEnum.DICTS, _settings)
      .then(() => setSettings(_settings));
  };

  const fetchDicts = async () => {
    return EnjoyApp.dict.getDicts().then((dicts) => {
      setDicts(dicts);
    });
  };

  const handleSetCurrentDict = (value: string) => {
    setCurrentDictValue(value);

  };

  const setDefault = async (dict: DictItem | null) => {
    await updateSettings({ ...settings, default: dict?.value ?? "" });
  };

  const remove = async (dict: DictItem) => {
    const isRemoving = settings.removing?.find((value) => dict.value === value);
    if (isRemoving) return;

    await updateSettings({
      ...settings,
      removing: [...(settings.removing ?? []), dict.value],
    });

    if (dict.type === "dict") {
      const _dict = dicts.find(({ name }) => name === dict.value);
      await EnjoyApp.dict.remove(_dict);
    } else if (dict.type === "mdict") {
      const _dict = settings.mdicts.find(({ hash }) => hash === dict.value);
      await EnjoyApp.mdict.remove(_dict);
    }

    await updateSettings({
      ...settings,
      mdicts: settings.mdicts?.filter(({ hash }) => dict.value !== hash) ?? [],
      removing:
        settings.removing?.filter((value) => value !== dict.value) ?? [],
    });
  };

  const lookup = async (word: string, dict: DictItem) => {
    if (dict.type === "dict") {
      const _dict = dicts.find(({ name }) => name === dict.value);
      return EnjoyApp.dict.lookup(word, _dict);
    } else if (dict.type === "mdict") {
      const _dict = settings.mdicts.find(({ hash }) => hash === dict.value);
      return EnjoyApp.mdict.lookup(word, _dict);
    } else {
      return null;
    }
  };

  const getResource = async (key: string, dict: DictItem) => {
    if (dict.type === "dict") {
      const _dict = dicts.find(({ name }) => name === dict.value);
      return EnjoyApp.dict.getResource(key, _dict);
    } else if (dict.type === "mdict") {
      const _dict = settings.mdicts.find(({ hash }) => hash === dict.value);
      return EnjoyApp.mdict.getResource(key, _dict);
    } else {
      return null;
    }
  };

  const importMDict = async (mdict: MDict) => {
    const mdicts = settings.mdicts.filter(({ hash }) => hash !== mdict.hash);
    const _settings = { ...settings, mdicts: [mdict, ...mdicts] };

    await updateSettings(_settings);
  };

  return (
    <DictProviderContext.Provider
      value={{
        settings,
        importMDict,
        remove,
        lookup,
        getResource,
        reload: fetchDicts,
        dictSelectItems,
        installedDicts,
        currentDict,
        currentDictValue,
        handleSetCurrentDict,
        setDefault,
      }}
    >
      {children}
    </DictProviderContext.Provider>
  );
};
