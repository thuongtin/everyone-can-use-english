import { AzureSpeechSettings } from "./azure-speech-settings";
import { t } from "i18next";
import { useContext, useMemo, useState } from "react";
import { Tooltip } from "react-tooltip";
import {
  BookAIcon,
  ChevronRightIcon,
  InfoIcon,
  KeyboardIcon,
  PaletteIcon,
  SearchIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  UserIcon,
  XIcon,
  LucideIcon,
} from "lucide-react";
import {
  About,
  AiServiceCards,
  Appearance,
  Hotkeys,
  UserSettings,
  LibrarySettings,
  OpenaiSettings,
  ProviderSettings,
  ProxySettings,
  ResetSettings,
  ResetAllSettings,
  NativeLanguageSettings,
  LearningLanguageSettings,
  NetworkState,
  RecorderSettings,
  VocabularySettings,
  DictSettings,
  DiskUsage,
  ProfileNameSettings,
  SettingCard,
  SettingDisclosure,
  SettingGroup,
  SttSettings,
  TtsSettings,
  DefaultEngineSettings,
} from "@renderer/components";
import { DialogClose } from "@renderer/components/ui";
import {
  AISettingsProviderContext,
  AppSettingsProviderContext,
} from "@renderer/context";
import { cn } from "@renderer/lib/utils";

type PreferenceTab = {
  value: string;
  label: string;
  description: string;
  Icon: LucideIcon;
  component: () => JSX.Element;
};

/** One searchable setting, so the sidebar box can jump straight to its tab. */
type SettingIndexEntry = {
  tab: string;
  name: string;
  keywords?: string;
};

const tabs = (goTo: (tab: string) => void): PreferenceTab[] => [
  {
    value: "basic",
    label: t("settings.tabs.basic"),
    description: t("settings.descriptions.basic"),
    Icon: SettingsIcon,
    component: () => (
      <>
        <ProfileNameSettings />
        <SettingGroup title={t("settings.languages")}>
          <SettingCard>
            <NativeLanguageSettings />
            <LearningLanguageSettings />
          </SettingCard>
        </SettingGroup>
        <SettingGroup
          title={t("settings.aiServices")}
          meta={t("settings.aiServicesMeta")}
        >
          <AiServiceCards onEnterKey={() => goTo("advanced")} />
        </SettingGroup>
      </>
    ),
  },
  {
    value: "dict",
    label: t("settings.tabs.dict"),
    description: t("settings.descriptions.dict"),
    Icon: BookAIcon,
    component: () => (
      <>
        <VocabularySettings />
        <DictSettings />
      </>
    ),
  },
  {
    value: "advanced",
    label: t("settings.tabs.advanced"),
    description: t("settings.descriptions.advanced"),
    Icon: SlidersHorizontalIcon,
    component: () => (
      <>
        <SettingGroup title={t("settings.connection")}>
          <SettingCard>
            <ProxySettings />
          </SettingCard>
          <NetworkState />
        </SettingGroup>
        <OpenaiSettings />
        <AzureSpeechSettings />
        <RecorderSettings />
        <SettingGroup title={t("settings.advancedServices")}>
          <SettingDisclosure
            label={t("settings.advancedServices")}
            description={t("settings.advancedServicesHint")}
          >
            <div className="flex flex-col gap-5">
              <SttSettings />
              <TtsSettings />
              <DefaultEngineSettings />
              <ProviderSettings />
            </div>
          </SettingDisclosure>
        </SettingGroup>
        <SettingGroup title={t("settings.dangerZone")}>
          <SettingCard className="border-ej-bad/30 bg-ej-bad-soft/35 [&>*+*]:border-ej-bad/20">
            <ResetSettings />
            <ResetAllSettings />
          </SettingCard>
        </SettingGroup>
      </>
    ),
  },
  {
    value: "account",
    label: t("settings.tabs.account"),
    description: t("settings.descriptions.account"),
    Icon: UserIcon,
    component: () => (
      <>
        <UserSettings />
        <LibrarySettings />
        <DiskUsage />
      </>
    ),
  },
  {
    value: "hotkeys",
    label: t("settings.tabs.hotkeys"),
    description: t("settings.descriptions.hotkeys"),
    Icon: KeyboardIcon,
    component: () => <Hotkeys />,
  },
  {
    value: "appearance",
    label: t("settings.tabs.appearance"),
    description: t("settings.descriptions.appearance"),
    Icon: PaletteIcon,
    component: () => <Appearance />,
  },
  {
    value: "about",
    label: t("settings.tabs.about"),
    description: t("settings.descriptions.about"),
    Icon: InfoIcon,
    component: () => <About />,
  },
];

const searchIndex = (): SettingIndexEntry[] => [
  {
    tab: "basic",
    name: t("settings.index.profileName"),
    keywords: t("settings.index.profileNameKeywords"),
  },
  {
    tab: "basic",
    name: t("settings.nativeLanguage"),
    keywords: t("settings.index.nativeLanguageKeywords"),
  },
  {
    tab: "basic",
    name: t("settings.learningLanguage"),
    keywords: t("settings.index.learningLanguageKeywords"),
  },
  {
    tab: "basic",
    name: t("settings.index.stt"),
    keywords: t("settings.index.sttKeywords"),
  },
  {
    tab: "basic",
    name: t("settings.index.tts"),
    keywords: t("settings.index.ttsKeywords"),
  },
  {
    tab: "basic",
    name: t("settings.index.assistant"),
    keywords: t("settings.index.assistantKeywords"),
  },
  { tab: "dict", name: t("settings.lookupOnMouseOver") },
  {
    tab: "dict",
    name: t("settings.installedDicts"),
    keywords: t("settings.index.dictsKeywords"),
  },
  { tab: "advanced", name: t("settings.proxy") },
  {
    tab: "advanced",
    name: t("settings.networkState"),
    keywords: t("settings.index.networkKeywords"),
  },
  {
    tab: "advanced",
    name: t("settings.openaiKey"),
    keywords: t("settings.index.openaiKeyKeywords"),
  },
  {
    tab: "advanced",
    name: t("settings.inputDevice"),
    keywords: t("settings.index.recorderKeywords"),
  },
  { tab: "advanced", name: t("settings.resetSettings") },
  { tab: "advanced", name: t("settings.deleteAllData") },
  {
    tab: "account",
    name: t("settings.libraryFolder"),
    keywords: t("settings.index.libraryKeywords"),
  },
  {
    tab: "account",
    name: t("settings.diskUsage"),
    keywords: t("settings.index.diskKeywords"),
  },
  {
    tab: "hotkeys",
    name: t("settings.hotkeys"),
    keywords: t("settings.index.hotkeysKeywords"),
  },
  {
    tab: "appearance",
    name: t("settings.themeMode"),
    keywords: t("settings.index.themeKeywords"),
  },
  {
    tab: "appearance",
    name: t("settings.layout.label"),
    keywords: t("settings.index.layoutKeywords"),
  },
  { tab: "advanced", name: "Azure Speech", keywords: "region key phát âm pronunciation TTS" },
  { tab: "appearance", name: t("settings.uiLanguage") },
  {
    tab: "about",
    name: t("settings.index.update"),
    keywords: t("settings.index.updateKeywords"),
  },
];

export const Preferences = () => {
  const { version } = useContext(AppSettingsProviderContext);
  const { currentGptEngine, getProviderConfig } = useContext(
    AISettingsProviderContext
  );
  const [activeTab, setActiveTab] = useState<string>("basic");
  const [query, setQuery] = useState<string>("");

  const items = useMemo(
    () => tabs((tab) => setActiveTab(tab)),
    [activeTab, query]
  );
  const current = items.find((tab) => tab.value === activeTab) ?? items[0];
  const searching = Boolean(query.trim());

  /* The assistant cannot answer without a key, so the tab carries a dot. */
  const needsKey =
    currentGptEngine?.name === "openai" && !getProviderConfig("openai")?.key;

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    return searchIndex().filter((entry) => {
      const tab = items.find((item) => item.value === entry.tab);
      return [entry.name, entry.keywords, tab?.label]
        .filter(Boolean)
        .some((text) => text.toLowerCase().includes(needle));
    });
  }, [query, items]);

  const openResult = (tab: string) => {
    setActiveTab(tab);
    setQuery("");
  };

  return (
    <>
      <div className="grid grid-cols-[224px_1fr] h-full overflow-hidden">
        <div className="flex flex-col bg-ej-bg border-r border-ej-line overflow-hidden">
          <div className="px-4 pt-[18px] pb-2.5 text-base font-bold text-ej-ink">
            {t("settings.title")}
          </div>

          <div className="relative px-2.5 pb-2">
            <SearchIcon className="pointer-events-none absolute left-[18px] top-1/2 size-3.5 -translate-y-[9px] text-ej-muted" />
            <input
              value={query}
              placeholder={t("settings.search")}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 w-full rounded-[9px] border border-ej-line bg-ej-surface pl-[30px] pr-7 text-[12.5px] text-ej-ink outline-none transition-colors duration-ej placeholder:text-ej-muted focus:border-ej-accent"
            />
            {searching && (
              <button
                type="button"
                aria-label={t("settings.clearSearch")}
                onClick={() => setQuery("")}
                className="absolute right-[14px] top-1/2 flex size-5 -translate-y-[13px] items-center justify-center rounded-md text-ej-muted transition-colors duration-ej hover:bg-ej-surface2 hover:text-ej-ink"
              >
                <XIcon className="size-3" />
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-2.5 pb-3 flex flex-col gap-0.5">
            {items.map((tab) => {
              const active = !searching && tab.value === activeTab;
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setActiveTab(tab.value);
                  }}
                  className={cn(
                    "h-[34px] rounded-[9px] flex items-center gap-2.5 px-2.5 shrink-0",
                    "text-[13px] text-left transition-colors duration-ej",
                    active
                      ? "bg-ej-surface text-ej-ink font-semibold shadow-ej"
                      : "text-ej-ink2 hover:bg-ej-surface2 hover:text-ej-ink"
                  )}
                >
                  <tab.Icon
                    className={cn(
                      "size-[15px] shrink-0",
                      active && "text-ej-accent"
                    )}
                    strokeWidth={active ? 2.2 : 1.8}
                  />
                  <span className="truncate">{tab.label}</span>
                  {tab.value === "advanced" && needsKey && (
                    <span className="ml-auto size-2 shrink-0 rounded-full bg-ej-warn" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="px-4 py-3 border-t border-ej-line text-[11px] leading-relaxed text-ej-muted">
            <div>
              Enjoy {version} · {t("settings.localFirst")}
            </div>
            <div>{t("settings.savedInstantly")}</div>
          </div>
        </div>

        <div className="ej-settings-pane relative flex flex-col overflow-hidden">
          <div className="shrink-0 pl-8 pr-[18px] pt-[22px]">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-lg font-bold text-ej-ink">
                  {searching ? t("settings.searchTitle") : current.label}
                </div>
                <div className="mt-0.5 text-xs text-ej-muted">
                  {searching
                    ? t("settings.results", {
                        count: results.length,
                        query: query.trim(),
                      })
                    : current.description}
                </div>
              </div>
              <DialogClose className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] text-ej-muted transition-colors duration-ej hover:bg-ej-surface2 hover:text-ej-ink">
                <XIcon className="size-4" />
              </DialogClose>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-8 pb-9">
            {searching ? (
              <div className="mt-4 rounded-ej border border-ej-line bg-ej-surface">
                {results.length === 0 ? (
                  <div className="px-4 py-7 text-center text-[12.5px] text-ej-muted">
                    {t("settings.noResults")}
                  </div>
                ) : (
                  results.map((entry, index) => {
                    const tab = items.find((item) => item.value === entry.tab);
                    if (!tab) return null;

                    return (
                      <button
                        key={`${entry.tab}-${entry.name}`}
                        type="button"
                        onClick={() => openResult(entry.tab)}
                        className={cn(
                          "flex w-full items-center gap-3 px-3.5 py-[11px] text-left",
                          "transition-colors duration-ej hover:bg-ej-surface2",
                          index > 0 && "border-t border-ej-line"
                        )}
                      >
                        <tab.Icon className="size-[15px] shrink-0 text-ej-muted" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-ej-ink">
                            {entry.name}
                          </span>
                          {entry.keywords && (
                            <span className="mt-0.5 block truncate text-[11.5px] text-ej-muted">
                              {entry.keywords}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-[11px] text-ej-muted">
                          {tab.label}
                        </span>
                        <ChevronRightIcon className="size-3.5 shrink-0 text-ej-muted" />
                      </button>
                    );
                  })
                )}
              </div>
            ) : (
              <div className="max-w-[640px]">{current.component()}</div>
            )}
          </div>
        </div>
      </div>
      <Tooltip id="preferences-tooltip" />
    </>
  );
};
