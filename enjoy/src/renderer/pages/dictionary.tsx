import { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { t } from "i18next";
import { ChevronLeftIcon, LoaderIcon, PlusIcon, SparklesIcon } from "lucide-react";
import {
  AppSettingsProviderContext,
  CopilotProviderContext,
  DictProviderContext,
  useLayout,
} from "@renderer/context";
import { EjButton, EjPage, EjPageHeader, Segmented } from "@renderer/components/enjoy";
import {
  BilingualEntryCard,
  DictionarySearchBox,
  DictionarySuggestion,
} from "@renderer/components";
import { BILINGUAL_DICTIONARIES } from "@/constants/bilingual-dictionaries";
import dayjs from "@renderer/lib/dayjs";
import { cn } from "@renderer/lib/utils";

const DIRECTION_KEY = "enjoy-bilingual-direction";
const RECENT_KEY = "enjoy-bilingual-recent";
const RECENT_LIMIT = 12;

type RecentLookup = {
  word: string;
  direction: BilingualDirection;
  /** Short gloss shown next to the word, taken from the first sense. */
  note?: string;
  ipa?: string;
  at: number;
};

const readRecent = (): RecentLookup[] => {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
};

/** Builds the one-line gloss stored with a recent lookup. */
const summarize = (entries: BilingualEntry[]) => {
  const gloss = entries
    .flatMap((entry) => entry.senses)
    .flatMap((sense) => sense.glosses)
    .find(Boolean);

  return gloss && gloss.length > 48 ? `${gloss.slice(0, 48)}…` : gloss;
};

export default () => {
  const { EnjoyApp, user, setDisplayPreferences } = useContext(
    AppSettingsProviderContext
  );
  const { installedDicts } = useContext(DictProviderContext);
  const { setActive } = useContext(CopilotProviderContext);
  const { fluid } = useLayout();

  const [direction, setDirection] = useState<BilingualDirection>(() => {
    const saved = localStorage.getItem(DIRECTION_KEY);
    return saved === "vi-en" ? "vi-en" : "en-vi";
  });
  const [query, setQuery] = useState<string>("");
  const [word, setWord] = useState<string>("");
  const [entries, setEntries] = useState<BilingualEntry[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [recent, setRecent] = useState<RecentLookup[]>(readRecent);

  useEffect(() => {
    localStorage.setItem(DIRECTION_KEY, direction);
  }, [direction]);

  const rememberLookup = (entry: RecentLookup) => {
    setRecent((current) => {
      const next = [
        entry,
        ...current.filter(
          (item) =>
            item.word.toLowerCase() !== entry.word.toLowerCase() ||
            item.direction !== entry.direction
        ),
      ].slice(0, RECENT_LIMIT);

      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch (err) {
        // A full storage quota must not break the lookup itself.
      }

      return next;
    });
  };

  const lookup = (rawWord: string, lookupDirection: BilingualDirection) => {
    const term = rawWord.trim();
    if (!term) return;

    setDirection(lookupDirection);
    setQuery(term);
    setWord(term);
    setEntries(null);
    setError("");
    setLoading(true);

    EnjoyApp.bilingual
      .lookup(lookupDirection, term)
      .then((result) => {
        setEntries(result || []);
        if (result?.length) {
          rememberLookup({
            word: term,
            direction: lookupDirection,
            note: summarize(result),
            ipa: result.flatMap((item) => item.ipa).find((ipa) => ipa.text)
              ?.text,
            at: dayjs().valueOf(),
          });
        }
      })
      .catch((err) => {
        setError(err.message || t("bilingual.error"));
      })
      .finally(() => setLoading(false));
  };

  const suggestions = useMemo<DictionarySuggestion[]>(() => {
    const prefix = query.trim().toLowerCase();

    return recent
      .filter((item) => item.direction === direction)
      .filter((item) => !prefix || item.word.toLowerCase().startsWith(prefix))
      .filter((item) => item.word.toLowerCase() !== prefix)
      .slice(0, 6)
      .map((item) => ({ word: item.word, note: item.note, ipa: item.ipa }));
  }, [recent, direction, query]);

  const recentForDirection = recent.filter(
    (item) => item.direction === direction
  );

  const directionControl = (
    <Segmented<BilingualDirection>
      value={direction}
      onChange={(value) => {
        setDirection(value);
        if (word) lookup(word, value);
      }}
      options={BILINGUAL_DICTIONARIES.map((dictionary) => ({
        value: dictionary.value as BilingualDirection,
        label: t(dictionary.key),
      }))}
    />
  );

  const results = (
    <div className="flex flex-col gap-4">
      {loading && (
        <div className="flex items-center justify-center gap-2 rounded-ej-lg border border-ej-line bg-ej-surface px-6 py-10 text-xs text-ej-muted">
          <LoaderIcon className="size-4 animate-spin" />
          {t("bilingual.loading")}
        </div>
      )}

      {!loading && error && (
        <div className="rounded-ej-lg border border-ej-bad bg-ej-bad-soft px-6 py-5 text-sm text-ej-bad">
          {error}
        </div>
      )}

      {!loading && !error && entries?.length > 0 && (
        <BilingualEntryCard
          word={word}
          direction={direction}
          entries={entries}
          onRelated={lookup}
        />
      )}

      {!loading && !error && entries?.length === 0 && (
        <div className="flex flex-col items-start gap-3 rounded-ej-lg border border-ej-line bg-ej-surface px-6 py-7">
          <div>
            <div className="text-base font-bold text-ej-ink">
              {t("bilingual.notFoundWord", { word })}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ej-muted">
              {t("bilingual.noResult")}
            </p>
          </div>
          <EjButton variant="secondary" onClick={() => setActive(true)}>
            <SparklesIcon className="size-3.5 text-ej-accent" />
            {t("bilingual.askAi")}
          </EjButton>
        </div>
      )}

      {!loading && !error && entries === null && (
        <div className="rounded-ej-lg border border-dashed border-ej-line bg-ej-surface px-6 py-10 text-center text-xs text-ej-muted">
          {t("bilingual.empty")}
        </div>
      )}
    </div>
  );

  const recentChips = recentForDirection.length > 0 && (
    <div className="flex flex-col gap-2">
      <span className="ej-label">{t("bilingual.recent")}</span>
      <div className="flex flex-wrap gap-1.5">
        {recentForDirection.map((item) => (
          <button
            key={`${item.direction}-${item.word}`}
            type="button"
            onClick={() => lookup(item.word, item.direction)}
            className="rounded-full border border-ej-line bg-ej-surface px-2.5 py-1 text-xs text-ej-ink transition-colors duration-ej hover:border-ej-accent hover:text-ej-accent"
          >
            {item.word}
          </button>
        ))}
      </div>
    </div>
  );

  const aside = (
    <aside className="flex flex-col gap-4">
      <div className="rounded-ej-lg border border-ej-line bg-ej-surface p-4">
        <span className="ej-label">{t("bilingual.recent")}</span>
        <div className="mt-2.5 flex flex-col gap-1">
          {recentForDirection.length === 0 && (
            <span className="text-xs text-ej-muted">
              {t("bilingual.recentEmpty")}
            </span>
          )}
          {recentForDirection.map((item) => (
            <button
              key={`${item.direction}-${item.word}`}
              type="button"
              onClick={() => lookup(item.word, item.direction)}
              className="flex items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-ej hover:bg-ej-surface2"
            >
              <span className="min-w-0 truncate text-xs font-semibold text-ej-ink">
                {item.word}
              </span>
              <span className="shrink-0 text-xxs text-ej-muted">
                {dayjs(item.at).fromNow()}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-ej-lg border border-ej-line bg-ej-surface p-4">
        <span className="ej-label">{t("bilingual.installed")}</span>
        <div className="mt-2.5 flex flex-col gap-1.5">
          {BILINGUAL_DICTIONARIES.map((dictionary) => (
            <div
              key={dictionary.value}
              className="flex items-center justify-between gap-2 rounded-lg bg-ej-bg px-2.5 py-2"
            >
              <span className="min-w-0 truncate text-xs font-semibold text-ej-ink">
                {t(dictionary.key)}
              </span>
              <span className="shrink-0 text-xxs text-ej-muted">
                {t("bilingual.bundled")}
              </span>
            </div>
          ))}
          {installedDicts.map((dict) => (
            <div
              key={dict.value}
              className="flex items-center justify-between gap-2 rounded-lg bg-ej-bg px-2.5 py-2"
            >
              <span className="min-w-0 truncate text-xs font-semibold text-ej-ink">
                {dict.text}
              </span>
              <span className="shrink-0 text-xxs uppercase text-ej-muted">
                {dict.type}
              </span>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setDisplayPreferences(true)}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-ej-line px-2.5 py-2 text-xs font-semibold text-ej-muted transition-colors duration-ej hover:border-ej-accent hover:text-ej-accent"
          >
            <PlusIcon className="size-3.5" />
            {t("bilingual.addMdx")}
          </button>
        </div>
      </div>

      <p className="px-1 text-xxs leading-relaxed text-ej-muted">
        {t("bilingual.offlineNote")}
      </p>
    </aside>
  );

  return (
    <EjPage className={cn(!fluid && "max-w-[760px]")}>
      <div data-testid="bilingual-panel">
        {!user && (
          <Link
            to="/"
            className="mb-4 inline-flex items-center gap-1 text-xxs font-semibold text-ej-accent-ink hover:underline"
          >
            <ChevronLeftIcon className="size-3.5" />
            {t("bilingual.back")}
          </Link>
        )}

        <EjPageHeader
          kicker={t("bilingual.title")}
          title={t("bilingual.pageTitle")}
          description={t("bilingual.pageDescription")}
        />

        <div
          className={cn(
            "grid items-start gap-[22px]",
            fluid ? "grid-cols-[minmax(0,1fr)_320px]" : "grid-cols-1"
          )}
        >
          <div className="flex min-w-0 flex-col gap-4">
            {directionControl}

            <DictionarySearchBox
              value={query}
              onChange={setQuery}
              onSearch={() => lookup(query, direction)}
              onPick={(picked) => lookup(picked, direction)}
              suggestions={suggestions}
              inputLabel={t("bilingual.query")}
              actionLabel={t("bilingual.lookupAction")}
              clearLabel={t("bilingual.clear")}
              placeholder={
                direction === "en-vi"
                  ? t("bilingual.placeholderEn")
                  : t("bilingual.placeholderVi")
              }
            />

            {results}

            {!fluid && recentChips}
          </div>

          {fluid && aside}
        </div>
      </div>
    </EjPage>
  );
};
