import {
  AudiosSegment,
  AudibleBooksSegment,
  DocumentsSegment,
  VideosSegment,
  YoutubeVideosSegment,
} from "@renderer/components";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AppSettingsProviderContext } from "@renderer/context";
import { toast } from "@renderer/components/ui";
import {
  EjPage,
  EjSectionHeader,
  GradientCover,
  MiniWaveform,
  Pill,
} from "@renderer/components/enjoy";
import { t } from "i18next";
import {
  FlameIcon,
  HeadphonesIcon,
  MicIcon,
  NewspaperIcon,
  PlayIcon,
  PlusIcon,
  VideoIcon,
  XIcon,
} from "lucide-react";
import dayjs from "@renderer/lib/dayjs";
import { cn, formatDate, formatDuration } from "@renderer/lib/utils";
import {
  loadCustomYoutubeChannels,
  normalizeYoutubeChannel,
  saveCustomYoutubeChannels,
} from "@/utils/youtube";

const DEFAULT_YOUTUBE_CHANNELS = ["@TED", "@CNN", "@nytimes"];

/** How far back the streak calculation looks. */
const STREAK_WINDOW_DAYS = 180;

const uniqueChannels = (channels: string[]) =>
  [...new Map(channels.map((channel) => [channel.toLowerCase(), channel])).values()];

type RecentItem = {
  id: string;
  kind: "audio" | "video" | "document";
  title: string;
  href: string;
  coverUrl?: string;
  duration?: number;
  recordingsCount?: number;
  updatedAt: string | Date;
};

export default () => {
  const [suggestedChannels] = useState<string[]>(
    DEFAULT_YOUTUBE_CHANNELS
  );
  const [customChannels, setCustomChannels] = useState<string[]>([]);
  // Online suggestions are opt-out: shown by default, collapsible for offline sessions.
  const [showOnlineSuggestions, setShowOnlineSuggestions] = useState(true);
  const customChannelsChanged = useRef(false);

  const { EnjoyApp } = useContext(AppSettingsProviderContext);

  const channels = uniqueChannels([...suggestedChannels, ...customChannels]);

  useEffect(() => {
    let active = true;

    loadCustomYoutubeChannels(EnjoyApp.userSettings, EnjoyApp.cacheObjects)
      .then((storedChannels) => {
        if (!active || customChannelsChanged.current) return;
        setCustomChannels(storedChannels);
      });

    return () => {
      active = false;
    };
  }, [EnjoyApp]);

  const addChannel = async (input: string) => {
    const channel = normalizeYoutubeChannel(input);
    if (!channel) {
      toast.error(t("invalidYoutubeChannel"));
      return false;
    }
    if (channels.some((existing) => existing.toLowerCase() === channel.toLowerCase())) {
      toast.error(t("youtubeChannelAlreadyAdded"));
      return false;
    }

    const nextChannels = [...customChannels, channel];
    customChannelsChanged.current = true;
    await saveCustomYoutubeChannels(EnjoyApp.userSettings, nextChannels);
    setCustomChannels(nextChannels);
    toast.success(t("youtubeChannelAdded"));
    return true;
  };

  const removeChannel = async (channel: string) => {
    const nextChannels = customChannels.filter((item) => item !== channel);
    customChannelsChanged.current = true;
    await saveCustomYoutubeChannels(EnjoyApp.userSettings, nextChannels);
    setCustomChannels(nextChannels);
  };

  return (
    <EjPage>
      <HomeHeader />
      <ContinueBlock />

      <div className="flex flex-col gap-8 mt-8">
        <AudiosSegment />
        <VideosSegment />
        <DocumentsSegment />
      </div>

      <div className="border-t border-ej-line mt-9 pt-7">
        <EjSectionHeader
          title={t("home.explore")}
          action={
            <button
              type="button"
              onClick={() => setShowOnlineSuggestions(!showOnlineSuggestions)}
              className="h-7 px-2.5 rounded-lg text-xs font-medium text-ej-ink2 border border-ej-line hover:border-ej-accent hover:text-ej-accent-ink transition-colors duration-ej"
            >
              {showOnlineSuggestions
                ? t("home.hideOnlineSuggestions")
                : t("home.showOnlineSuggestions")}
            </button>
          }
        />
        <p className="-mt-1 mb-4 text-xs text-ej-muted">
          {t("home.exploreDescription")}
        </p>

        <ChannelChips
          suggested={suggestedChannels}
          custom={customChannels}
          onAdd={addChannel}
          onRemove={removeChannel}
        />

        {showOnlineSuggestions && (
          <div className="flex flex-col gap-8 mt-7">
            <AudibleBooksSegment />
            {channels.map((channel) => (
              <YoutubeVideosSegment key={channel} channel={channel} />
            ))}
          </div>
        )}
      </div>
    </EjPage>
  );
};

/** Date kicker, greeting and the two practice pills. */
const HomeHeader = () => {
  const { EnjoyApp, user } = useContext(AppSettingsProviderContext);
  const [streak, setStreak] = useState(0);
  const [todayMinutes, setTodayMinutes] = useState(0);

  useEffect(() => {
    const today = dayjs().endOf("day");

    EnjoyApp.recordings
      .groupByDate({
        from: today.subtract(STREAK_WINDOW_DAYS, "day").startOf("day").toISOString(),
        to: today.toISOString(),
      })
      .then((rows: { date: string; count: number }[]) => {
        setStreak(streakFromDates((rows || []).map((row) => row.date)));
      })
      .catch(() => setStreak(0));

    EnjoyApp.recordings
      .stats({
        from: dayjs().startOf("day").toISOString(),
        to: today.toISOString(),
      })
      .then((stats: { count: number; duration: number }) => {
        // Recording durations are stored in milliseconds.
        setTodayMinutes(Math.round((stats?.duration || 0) / 60000));
      })
      .catch(() => setTodayMinutes(0));
  }, [EnjoyApp]);

  const kicker = dayjs().format("dddd, D MMMM").toUpperCase();

  return (
    <div className="flex items-end gap-4 flex-wrap mb-7">
      <div className="min-w-0 flex-1">
        <div className="ej-label mb-1.5">{kicker}</div>
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-ej-ink">
          {t("home.greeting", { name: user?.name || t("home.learner") })}
        </h1>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Pill>
          <FlameIcon className="size-3.5 text-ej-warn" />
          <span>
            <strong className="font-semibold text-ej-ink">
              {t("home.streakDays", { count: streak })}
            </strong>{" "}
            {t("home.streakSuffix")}
          </span>
        </Pill>
        <Pill>
          <MicIcon className="size-3.5 text-ej-accent" />
          <span>
            <strong className="font-semibold text-ej-ink">
              {t("home.minutes", { count: todayMinutes })}
            </strong>{" "}
            {t("home.today")}
          </span>
        </Pill>
      </div>
    </div>
  );
};

/**
 * Consecutive practice days ending today (or yesterday, so a streak is not
 * reported as broken before the first recording of the day).
 */
const streakFromDates = (dates: string[]) => {
  const days = new Set(dates.map((date) => dayjs(date).format("YYYY-MM-DD")));
  let cursor = dayjs();
  if (!days.has(cursor.format("YYYY-MM-DD"))) {
    cursor = cursor.subtract(1, "day");
  }

  let streak = 0;
  while (days.has(cursor.format("YYYY-MM-DD"))) {
    streak += 1;
    cursor = cursor.subtract(1, "day");
  }
  return streak;
};

const KIND_ICON = {
  audio: HeadphonesIcon,
  video: VideoIcon,
  document: NewspaperIcon,
} as const;

const KIND_LABEL = {
  audio: "home.audios",
  video: "home.videos",
  document: "home.documents",
} as const;

/** "Tiếp tục": the most recently touched item, plus the two behind it. */
const ContinueBlock = () => {
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const [items, setItems] = useState<RecentItem[]>([]);

  useEffect(() => {
    Promise.all([
      EnjoyApp.audios.findAll({ offset: 0, limit: 6 }).catch((): any[] => []),
      EnjoyApp.videos.findAll({ offset: 0, limit: 6 }).catch((): any[] => []),
      EnjoyApp.documents.findAll({ offset: 0, limit: 6 }).catch((): any[] => []),
    ]).then(([audios, videos, documents]) => {
      setItems(
        [
          ...(audios || []).map((item: AudioType) => ({
            id: item.id,
            kind: "audio" as const,
            title: item.name,
            href: `/audios/${item.id}`,
            coverUrl: item.coverUrl,
            duration: item.duration,
            recordingsCount: item.recordingsCount,
            updatedAt: item.updatedAt,
          })),
          ...(videos || []).map((item: VideoType) => ({
            id: item.id,
            kind: "video" as const,
            title: item.name,
            href: `/videos/${item.id}`,
            coverUrl: item.coverUrl,
            duration: item.duration,
            recordingsCount: item.recordingsCount,
            updatedAt: item.updatedAt,
          })),
          ...(documents || []).map((item: DocumentEType) => ({
            id: item.id,
            kind: "document" as const,
            title: item.title,
            href: `/documents/${item.id}`,
            updatedAt: item.lastReadAt || item.updatedAt,
          })),
        ].sort((a, b) => dayjs(b.updatedAt).valueOf() - dayjs(a.updatedAt).valueOf())
      );
    });
  }, [EnjoyApp]);

  const [primary, ...rest] = items;
  const secondary = useMemo(() => rest.slice(0, 2), [items]);

  if (!primary) return null;

  return (
    <div className="flex flex-wrap gap-3.5">
      <div className="flex-[1.6_1_400px] min-w-0 rounded-ej-lg border border-ej-line bg-ej-surface p-4 flex gap-4">
        <GradientCover
          id={primary.id}
          src={primary.coverUrl}
          alt={primary.title}
          className="size-[108px] shrink-0"
        />

        <div className="min-w-0 flex-1 flex flex-col">
          <div className="ej-label text-ej-accent mb-1">
            {t("home.continueKicker")}
          </div>
          <Link
            to={primary.href}
            className="text-[17px] font-semibold leading-snug text-ej-ink line-clamp-2"
          >
            {primary.title}
          </Link>
          <div className="mt-1 text-[11.5px] text-ej-muted truncate">
            {[
              t(KIND_LABEL[primary.kind]),
              primary.recordingsCount
                ? t("media.recordingsCount", { count: primary.recordingsCount })
                : null,
              formatDate(primary.updatedAt),
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>

          <MiniWaveform id={primary.id} height={34} className="mt-auto mb-2.5" />

          <Link
            to={primary.href}
            className="inline-flex items-center gap-2 self-start h-9 px-4 rounded-[10px] bg-ej-ink text-white text-xs font-semibold hover:opacity-90 transition-opacity duration-ej"
          >
            <PlayIcon className="size-3.5 fill-current" />
            {t("home.continueAction")}
            {primary.duration ? ` · ${formatDuration(primary.duration)}` : ""}
          </Link>
        </div>
      </div>

      {secondary.length > 0 && (
        <div className="flex-[1_1_300px] min-w-0 grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
          {secondary.map((item) => (
            <RecentTile key={`${item.kind}-${item.id}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
};

const RecentTile = (props: { item: RecentItem }) => {
  const { item } = props;
  const Icon = KIND_ICON[item.kind];

  return (
    <Link
      to={item.href}
      className="rounded-ej-lg border border-ej-line bg-ej-surface p-3.5 flex gap-3 min-w-0 hover:-translate-y-[2px] hover:shadow-ej transition-transform duration-ej"
    >
      <GradientCover id={item.id} src={item.coverUrl} className="size-[52px] shrink-0">
        {!item.coverUrl && <Icon className="size-5 text-white/90" />}
      </GradientCover>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="ej-label truncate">{t(KIND_LABEL[item.kind])}</span>
          <span className="ml-auto text-[11px] text-ej-muted shrink-0">
            {formatDate(item.updatedAt)}
          </span>
        </div>
        <div className="mt-0.5 text-[13px] font-semibold text-ej-ink line-clamp-2">
          {item.title}
        </div>
        <div className="mt-1 text-[11.5px] text-ej-muted truncate">
          {item.recordingsCount
            ? t("media.recordingsCount", { count: item.recordingsCount })
            : t("home.notPracticedYet")}
        </div>
      </div>
    </Link>
  );
};

/** Followed YouTube channels, with an inline "add" chip. */
const ChannelChips = (props: {
  suggested: string[];
  custom: string[];
  onAdd: (input: string) => Promise<boolean>;
  onRemove: (channel: string) => Promise<void>;
}) => {
  const { suggested, custom, onAdd, onRemove } = props;
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState("");

  const submit = async () => {
    if (!input.trim()) return;
    if (!(await onAdd(input))) return;
    setInput("");
    setAdding(false);
  };

  const chip =
    "inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium whitespace-nowrap transition-colors duration-ej";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {suggested.map((channel) => (
        <span
          key={channel}
          className={cn(chip, "bg-ej-surface border border-ej-line text-ej-ink2")}
        >
          {channel}
        </span>
      ))}

      {custom.map((channel) => (
        <span
          key={channel}
          className={cn(chip, "bg-ej-surface border border-ej-line text-ej-ink2")}
        >
          {channel}
          <button
            type="button"
            aria-label={t("removeYoutubeChannel")}
            onClick={() => void onRemove(channel)}
            className="text-ej-muted hover:text-ej-bad transition-colors duration-ej"
          >
            <XIcon className="size-3.5" />
          </button>
        </span>
      ))}

      {adding ? (
        <span
          className={cn(chip, "bg-ej-surface border border-ej-accent pr-1.5")}
        >
          <input
            autoFocus
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              } else if (event.key === "Escape") {
                setAdding(false);
                setInput("");
              }
            }}
            placeholder={t("youtubeChannelPlaceholder")}
            className="w-32 bg-transparent outline-none text-xs text-ej-ink placeholder:text-ej-muted"
          />
          <button
            type="button"
            onClick={() => void submit()}
            className="h-6 px-2 rounded-full bg-ej-accent text-white text-[11px] font-semibold"
          >
            {t("confirm")}
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={cn(
            chip,
            "border border-dashed border-ej-line2 text-ej-muted hover:border-ej-accent hover:text-ej-accent-ink"
          )}
        >
          <PlusIcon className="size-3.5" />
          {t("home.addChannel")}
        </button>
      )}
    </div>
  );
};
