import { useState, useContext, useEffect, useMemo, useCallback } from "react";
import { t } from "i18next";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RotateCcwIcon,
  ShuffleIcon,
} from "lucide-react";
import { useHotkeys } from "react-hotkeys-hook";
import {
  AppSettingsProviderContext,
  HotKeysSettingsProviderContext,
  useLayout,
} from "@renderer/context";
import { toast } from "@renderer/components/ui";
import {
  EjPage,
  EjPageHeader,
  Segmented,
} from "@renderer/components/enjoy";
import {
  LoaderSpin,
  MeaningMemorizingCard,
  MEMORIZING_STATUS_DOT,
  type MemorizingStatus,
} from "@renderer/components";
import dayjs from "@renderer/lib/dayjs";
import { cn } from "@renderer/lib/utils";
import type {
  LocalMeaning,
  LocalStudyReview,
} from "../../types/local-study-api";

/** Cards fetched up front so the deck list and counters are meaningful. */
const EAGER_CARDS = 50;
const PAGE_SIZE = 10;

type Filter = "all" | MemorizingStatus;

const dueLabel = (review: LocalStudyReview) => {
  if (!review.dueAt || dayjs(review.dueAt).valueOf() <= dayjs().valueOf()) {
    return t("vocabulary.today");
  }
  return dayjs(review.dueAt).fromNow();
};

export default () => {
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { currentHotkeys, enabled } = useContext(
    HotKeysSettingsProviderContext
  );
  const { fluid } = useLayout();

  const [loading, setLoading] = useState<boolean>(true);
  const [meanings, setMeanings] = useState<LocalMeaning[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(1);
  const [filter, setFilter] = useState<Filter>("all");
  const [index, setIndex] = useState<number>(0);
  const [side, setSide] = useState<"front" | "back">("front");
  const [order, setOrder] = useState<string[] | null>(null);

  const fetchMeanings = useCallback((page: number) => {
    if (!page) return;

    setLoading(true);
    EnjoyApp.localStudy.meanings
      .list({ page, items: PAGE_SIZE })
      .then((response) => {
        setMeanings((current) => {
          const byId = new Map(current.map((meaning) => [meaning.id, meaning]));
          response.meanings.forEach((meaning) => byId.set(meaning.id, meaning));
          return [...byId.values()];
        });
        setNextPage(response.next);
      })
      .catch((err) => {
        toast.error(err.message);
        setNextPage(null);
      })
      .finally(() => setLoading(false));
  }, [EnjoyApp]);

  useEffect(() => {
    fetchMeanings(1);
  }, [fetchMeanings]);

  // Keep pulling pages until the deck is large enough to summarise.
  useEffect(() => {
    if (loading) return;
    if (!nextPage) return;
    if (meanings.length >= EAGER_CARDS) return;
    fetchMeanings(nextPage);
  }, [fetchMeanings, loading, nextPage, meanings.length]);

  const statusOf = (meaning: LocalMeaning): MemorizingStatus =>
    meaning.review.status;

  const ordered = useMemo(() => {
    if (!order) return meanings;

    const byId = new Map(meanings.map((meaning) => [meaning.id, meaning]));
    const shuffled = order
      .map((id) => byId.get(id))
      .filter(Boolean) as LocalMeaning[];
    const missing = meanings.filter((meaning) => !order.includes(meaning.id));

    return [...shuffled, ...missing];
  }, [meanings, order]);

  const cards = useMemo(
    () =>
      ordered.filter(
        (meaning) => filter === "all" || statusOf(meaning) === filter
      ),
    [ordered, filter]
  );

  const counts = useMemo(() => {
    const tally = { new: 0, learning: 0, known: 0 };
    meanings.forEach((meaning) => {
      tally[statusOf(meaning)] += 1;
    });
    return tally;
  }, [meanings]);

  const dueCount = useMemo(
    () =>
      meanings.filter((meaning) => {
        const { dueAt } = meaning.review;
        return !dueAt || dayjs(dueAt).valueOf() <= dayjs().valueOf();
      }).length,
    [meanings]
  );

  const current = cards[Math.min(index, Math.max(0, cards.length - 1))];

  const step = (delta: number) => {
    if (!cards.length) return;
    setIndex((value) => (value + delta + cards.length) % cards.length);
    setSide("front");

    // Pull the next page as the reader approaches the end of the deck.
    if (delta > 0 && nextPage && index >= cards.length - 2) {
      fetchMeanings(nextPage);
    }
  };

  const mark = async (status: MemorizingStatus) => {
    if (!current) return;

    const dueAt = dayjs()
      .add(status === "known" ? 4 : 1, "day")
      .toISOString();
    try {
      const review = await EnjoyApp.localStudy.reviews.set(current.id, {
        status,
        dueAt,
      });
      setMeanings((items) =>
        items.map((meaning) =>
          meaning.id === current.id ? { ...meaning, review } : meaning
        )
      );
      toast.success(
        status === "known"
          ? t("vocabulary.markedKnown", { word: current.word })
          : t("vocabulary.markedUnknown", { word: current.word })
      );
      setSide("front");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const shuffle = () => {
    const ids = ordered.map((meaning) => meaning.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    setOrder(ids);
    setIndex(0);
    setSide("front");
    toast.success(t("vocabulary.shuffled"));
  };

  useHotkeys(
    [
      currentHotkeys.PlayPreviousSegment,
      currentHotkeys.PlayNextSegment,
      currentHotkeys.PlayOrPause,
      "1",
      "2",
    ],
    (keyboardEvent, hotkeyEvent) => {
      keyboardEvent.preventDefault();

      switch (hotkeyEvent.keys.join("")) {
        case currentHotkeys.PlayPreviousSegment.toLowerCase():
          step(-1);
          break;
        case currentHotkeys.PlayNextSegment.toLowerCase():
          step(1);
          break;
        case currentHotkeys.PlayOrPause.toLowerCase():
          setSide((value) => (value === "front" ? "back" : "front"));
          break;
        case "1":
          void mark("learning");
          break;
        case "2":
          void mark("known");
          break;
      }
    },
    { enabled },
    [cards, index, currentHotkeys]
  );

  if (loading && meanings.length === 0) {
    return <LoaderSpin />;
  }

  const filterControl = (
    <Segmented<Filter>
      value={filter}
      onChange={(value) => {
        setFilter(value);
        setIndex(0);
        setSide("front");
      }}
      options={[
        { value: "all", label: t("vocabulary.filterAll") },
        { value: "new", label: t("vocabulary.status.new") },
        { value: "learning", label: t("vocabulary.status.learning") },
        { value: "known", label: t("vocabulary.status.known") },
      ]}
    />
  );

  const keyHints = (
    <div className="flex flex-wrap justify-center gap-3.5 text-[11.5px] text-ej-muted">
      {[
        [currentHotkeys.PlayPreviousSegment, t("vocabulary.keyPrevious")],
        [currentHotkeys.PlayNextSegment, t("vocabulary.keyNext")],
        [currentHotkeys.PlayOrPause, t("vocabulary.keyFlip")],
        ["1", t("vocabulary.keyUnknown")],
        ["2", t("vocabulary.keyKnown")],
      ].map(([key, label]) => (
        <span key={label}>
          <b className="font-semibold text-ej-ink2">{key}</b> {label}
        </span>
      ))}
    </div>
  );

  const arrowButton = (props: {
    label: string;
    onClick: () => void;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      onClick={props.onClick}
      className="flex w-11 shrink-0 items-center justify-center rounded-ej border border-ej-line bg-ej-surface text-ej-ink2 transition-colors duration-ej hover:border-ej-accent hover:text-ej-accent"
    >
      {props.children}
    </button>
  );

  const aside = (
    <aside className="sticky top-0 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold text-ej-ink">
          {t("vocabulary.deckCount", { count: meanings.length })}
        </span>
        <span className="text-xs text-ej-muted">
          {t("vocabulary.dueToday", { count: dueCount })}
        </span>
      </div>

      <div className="flex flex-col overflow-hidden rounded-ej-lg border border-ej-line bg-ej-surface">
        {cards.map((meaning, cardIndex) => (
          <button
            key={meaning.id}
            type="button"
            onClick={() => {
              setIndex(cardIndex);
              setSide("front");
            }}
            className={cn(
              "flex items-center gap-2.5 border-b border-ej-line px-3 py-2.5 text-left transition-colors duration-ej last:border-b-0",
              cardIndex === index
                ? "bg-ej-accent-soft"
                : "hover:bg-ej-surface2"
            )}
          >
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                MEMORIZING_STATUS_DOT[statusOf(meaning)]
              )}
            />
            <span className="shrink-0 font-literata text-sm font-semibold text-ej-ink">
              {meaning.word}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-ej-ink2">
              {meaning.translation}
            </span>
            <span className="shrink-0 text-xxs text-ej-muted">
              {dueLabel(meaning.review)}
            </span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          {
            value: counts.known,
            label: t("vocabulary.countKnown"),
            tone: "text-ej-ok",
          },
          {
            value: counts.learning,
            label: t("vocabulary.countLearning"),
            tone: "text-ej-warn",
          },
          {
            value: counts.new,
            label: t("vocabulary.countNew"),
            tone: "text-ej-ink",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-ej border border-ej-line bg-ej-surface px-3 py-2.5"
          >
            <div className={cn("ej-tabular text-xl font-bold", stat.tone)}>
              {stat.value}
            </div>
            <div className="text-[11.5px] text-ej-muted">{stat.label}</div>
          </div>
        ))}
      </div>
    </aside>
  );

  return (
    <EjPage className={cn(!fluid && "max-w-[820px]")}>
      <div
        data-testid="vocabulary-page"
        className={cn(
          "grid items-start gap-6",
          fluid ? "grid-cols-[minmax(0,1fr)_340px]" : "grid-cols-1"
        )}
      >
        <div className="flex min-w-0 flex-col gap-4">
          <EjPageHeader
            className="mb-0"
            kicker={t("sidebar.vocabulary")}
            title={t("sidebar.vocabulary")}
            description={t("vocabulary.description")}
            actions={filterControl}
          />

          <div className="flex items-center gap-2.5">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ej-surface2">
              <div
                className="h-full rounded-full bg-ej-accent transition-all duration-300"
                style={{
                  width: cards.length
                    ? `${((index + 1) / cards.length) * 100}%`
                    : "0%",
                }}
              />
            </div>
            <span className="ej-tabular whitespace-nowrap text-xs text-ej-muted">
              {t("vocabulary.progress", {
                current: cards.length ? index + 1 : 0,
                total: cards.length,
                known: counts.known,
              })}
            </span>
          </div>

          {current ? (
            <>
              <div className="flex items-stretch gap-3.5">
                {arrowButton({
                  label: t("vocabulary.previousCard"),
                  onClick: () => step(-1),
                  children: <ChevronLeftIcon className="size-[18px]" />,
                })}

                <MeaningMemorizingCard
                  meaning={current}
                  status={statusOf(current)}
                  side={side}
                  onFlip={() =>
                    setSide(side === "front" ? "back" : "front")
                  }
                />

                {arrowButton({
                  label: t("vocabulary.nextCard"),
                  onClick: () => step(1),
                  children: <ChevronRightIcon className="size-[18px]" />,
                })}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => void mark("learning")}
                  className="inline-flex h-10 items-center gap-2 rounded-ej border border-ej-line bg-ej-surface px-[18px] text-xs font-semibold text-ej-ink transition-colors duration-ej hover:border-ej-warn hover:text-ej-warn"
                >
                  <RotateCcwIcon className="size-3.5" />
                  {t("vocabulary.markUnknown")}
                </button>
                <button
                  type="button"
                  onClick={() => void mark("known")}
                  className="inline-flex h-10 items-center gap-2 rounded-ej bg-ej-ink px-[18px] text-xs font-semibold text-ej-bg transition-opacity duration-ej hover:opacity-90"
                >
                  <CheckIcon className="size-3.5" />
                  {t("vocabulary.markKnown")}
                </button>
                <button
                  type="button"
                  title={t("vocabulary.shuffle")}
                  aria-label={t("vocabulary.shuffle")}
                  onClick={shuffle}
                  className="inline-flex size-10 items-center justify-center rounded-ej border border-ej-line bg-ej-surface text-ej-ink2 transition-colors duration-ej hover:border-ej-accent hover:text-ej-accent"
                >
                  <ShuffleIcon className="size-[15px]" />
                </button>
              </div>

              {keyHints}
            </>
          ) : (
            <div className="rounded-[20px] border border-dashed border-ej-line2 bg-ej-surface px-5 py-14 text-center leading-relaxed text-ej-muted">
              <div>{t("vocabulary.empty")}</div>
              <div>{t("vocabulary.emptyDescription")}</div>
            </div>
          )}
        </div>

        {fluid && aside}
      </div>
    </EjPage>
  );
};
