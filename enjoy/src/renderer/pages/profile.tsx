import { useContext, useEffect, useMemo, useState } from "react";
import { t } from "i18next";
import { CheckCircle2Icon, ClockIcon, FlameIcon, MicIcon } from "lucide-react";
import { AppSettingsProviderContext, useLayout } from "@renderer/context";
import { toast } from "@renderer/components/ui";
import { EjPage, GradientAvatar, Segmented } from "@renderer/components/enjoy";
import {
  LoaderSpin,
  RecordingActivities,
  RecordingHeatmap,
  RecordingMinutesChart,
  RecordingStats,
  type PracticeDay,
  type RecordingActivity,
  type RecordingStat,
} from "@renderer/components";
import dayjs from "@renderer/lib/dayjs";
import { displayableResourceUrl } from "@renderer/lib/retired-resource";
import { cn } from "@renderer/lib/utils";

/** The heatmap always shows 26 weeks, Monday first. */
const WEEKS = 26;
const CELLS = WEEKS * 7;
const DATE_FORMAT = "YYYY-MM-DD";
/** Sequelize needs a lower bound; the app cannot hold older recordings. */
const ALL_TIME_FROM = "2000-01-01";
/** Recent assessments used for the average score and the per-activity chips. */
const ASSESSMENT_LIMIT = 500;

/** Segmented values are strings; the numeric length lives in `rangeSize`. */
type Range = "7" | "30" | "90";

type DayTotal = { count: number; minutes: number };

/** "18h 42m" / "42m", the shape the design asks for. */
const formatPracticeTime = (milliseconds: number) => {
  const totalMinutes = Math.round((Number(milliseconds) || 0) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

/** Days practised in a row, counted back from today (or yesterday). */
const currentStreakOf = (days: Set<string>) => {
  let cursor = dayjs();
  if (!days.has(cursor.format(DATE_FORMAT))) cursor = cursor.subtract(1, "day");

  let streak = 0;
  while (days.has(cursor.format(DATE_FORMAT))) {
    streak += 1;
    cursor = cursor.subtract(1, "day");
  }

  return streak;
};

const bestStreakOf = (days: Set<string>) => {
  let best = 0;
  let run = 0;
  let previous: string | null = null;

  [...days].sort().forEach((date) => {
    run =
      previous && dayjs(date).diff(dayjs(previous), "day") === 1 ? run + 1 : 1;
    previous = date;
    best = Math.max(best, run);
  });

  return best;
};

const average = (values: number[]) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;

export default () => {
  const { EnjoyApp, user } = useContext(AppSettingsProviderContext);
  const { fluid } = useLayout();

  const [loading, setLoading] = useState<boolean>(true);
  const [range, setRange] = useState<Range>("7");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [totals, setTotals] = useState<{ count: number; duration: number }>({
    count: 0,
    duration: 0,
  });
  const [practisedDates, setPractisedDates] = useState<string[]>([]);
  const [targets, setTargets] = useState<RecordingActivity[]>([]);
  const [assessments, setAssessments] = useState<PronunciationAssessmentType[]>(
    []
  );

  // The calendar starts on the Monday 25 weeks before the current week.
  const calendarStart = useMemo(() => {
    const mondayOffset = (dayjs().day() + 6) % 7;
    return dayjs()
      .subtract(mondayOffset, "day")
      .subtract((WEEKS - 1) * 7, "day")
      .startOf("day");
  }, []);

  const rangeSize = Number(range);

  useEffect(() => {
    const now = dayjs().endOf("day").format();

    Promise.all([
      EnjoyApp.recordings.stats({ from: ALL_TIME_FROM, to: now }),
      EnjoyApp.recordings.groupByDate({ from: ALL_TIME_FROM, to: now }),
      EnjoyApp.recordings.groupByTarget({
        from: calendarStart.format(),
        to: now,
      }),
      EnjoyApp.pronunciationAssessments.findAll({ limit: ASSESSMENT_LIMIT }),
    ])
      .then(([stats, byDate, byTarget, fetchedAssessments]) => {
        setTotals({
          count: Number(stats?.count) || 0,
          duration: Number(stats?.duration) || 0,
        });
        setPractisedDates((byDate || []).map((entry) => entry.date));
        setTargets(
          (byTarget || []).map((entry) => ({
            date: entry.date,
            targetId: entry.targetId,
            targetType: entry.targetType,
            count: Number(entry.count) || 0,
            duration: Number(entry.duration) || 0,
            target: entry.target,
          }))
        );
        setAssessments(fetchedAssessments || []);
      })
      .catch((err) => {
        toast.error(err.message);
      })
      .finally(() => setLoading(false));
  }, [calendarStart]);

  /** Recording minutes and counts per calendar day. */
  const dayTotals = useMemo(() => {
    const map = new Map<string, DayTotal>();

    targets.forEach((entry) => {
      const total = map.get(entry.date) || { count: 0, minutes: 0 };
      total.count += entry.count;
      total.minutes += entry.duration / 60000;
      map.set(entry.date, total);
    });

    return map;
  }, [targets]);

  const days = useMemo<PracticeDay[]>(() => {
    const today = dayjs().format(DATE_FORMAT);

    return Array.from({ length: CELLS }, (_unused, index) => {
      const date = calendarStart.add(index, "day").format(DATE_FORMAT);
      const total = dayTotals.get(date);

      return {
        date,
        count: total?.count ?? 0,
        minutes: Math.round(total?.minutes ?? 0),
        future: date > today,
      };
    });
  }, [calendarStart, dayTotals]);

  /** The last `range` days, oldest first, for the bar chart. */
  const rangeDays = useMemo(
    () => days.filter((day) => !day.future).slice(-rangeSize),
    [days, rangeSize]
  );

  const rangeStart = rangeDays[0]?.date ?? dayjs().format(DATE_FORMAT);

  /** Score per audio/video and day, so an activity row can show a chip. */
  const scores = useMemo(() => {
    const map = new Map<string, number[]>();

    assessments.forEach((assessment) => {
      const recording = assessment.recording;
      if (!recording?.targetId) return;
      if (typeof assessment.pronunciationScore !== "number") return;

      const key = [
        dayjs(recording.createdAt || assessment.createdAt).format(DATE_FORMAT),
        recording.targetType,
        recording.targetId,
      ].join("-");

      map.set(key, [...(map.get(key) || []), assessment.pronunciationScore]);
    });

    return map;
  }, [assessments]);

  const activities = useMemo<RecordingActivity[]>(() => {
    const visible = selectedDay
      ? targets.filter((entry) => entry.date === selectedDay)
      : targets.filter((entry) => entry.date >= rangeStart);

    return visible.map((entry) => {
      const key = [entry.date, entry.targetType, entry.targetId].join("-");
      const score = average(scores.get(key) || []);

      return {
        ...entry,
        score: score === null ? undefined : Math.round(score),
      };
    });
  }, [targets, selectedDay, rangeStart, scores]);

  const stats = useMemo<RecordingStat[]>(() => {
    const practisedSet = new Set(practisedDates);
    const rangeCount = rangeDays.reduce((sum, day) => sum + day.count, 0);
    const rangeMinutes = rangeDays.reduce((sum, day) => sum + day.minutes, 0);

    const previousStart = dayjs(rangeStart).subtract(rangeSize, "day");
    const scoreIn = (from: dayjs.Dayjs, to: dayjs.Dayjs) =>
      average(
        assessments
          .filter((assessment) => {
            if (typeof assessment.pronunciationScore !== "number") return false;
            const at = dayjs(assessment.createdAt);
            return !at.isBefore(from) && at.isBefore(to);
          })
          .map((assessment) => assessment.pronunciationScore)
      );

    const currentScore = scoreIn(dayjs(rangeStart), dayjs().add(1, "day"));
    const previousScore = scoreIn(previousStart, dayjs(rangeStart));
    const scoreDelta =
      currentScore !== null && previousScore !== null
        ? Math.round(currentScore - previousScore)
        : null;

    return [
      {
        label: t("profile.totalRecordings"),
        value: totals.count.toLocaleString(),
        hint: t("profile.deltaInRange", { value: rangeCount, days: rangeSize }),
        hintTone: rangeCount > 0 ? "ok" : "muted",
        icon: <MicIcon className="size-4" />,
        iconClassName: "text-ej-accent",
      },
      {
        label: t("profile.practiceTime"),
        value: formatPracticeTime(totals.duration),
        hint: t("profile.deltaInRange", {
          value: formatPracticeTime(rangeMinutes * 60000),
          days: rangeSize,
        }),
        hintTone: rangeMinutes > 0 ? "ok" : "muted",
        icon: <ClockIcon className="size-4" />,
        iconClassName: "text-ej-accent",
      },
      {
        label: t("profile.streak"),
        value: `${currentStreakOf(practisedSet)}`,
        hint: t("profile.bestStreak", { count: bestStreakOf(practisedSet) }),
        hintTone: "muted",
        icon: <FlameIcon className="size-4" />,
        iconClassName: "text-ej-warn",
      },
      {
        label: t("profile.averageScore"),
        value: currentScore === null ? "–" : `${Math.round(currentScore)}`,
        hint:
          scoreDelta === null
            ? t("profile.noScore")
            : t("profile.scoreDelta", {
                value: scoreDelta > 0 ? `+${scoreDelta}` : `${scoreDelta}`,
              }),
        hintTone: scoreDelta !== null && scoreDelta >= 0 ? "ok" : "muted",
        icon: <CheckCircle2Icon className="size-4" />,
        iconClassName: "text-ej-ok",
      },
    ];
  }, [totals, rangeDays, rangeStart, rangeSize, practisedDates, assessments]);

  if (loading) return <LoaderSpin />;

  const selectedTotal = selectedDay ? dayTotals.get(selectedDay) : undefined;
  const rangeLabel = t("profile.lastNDays", { count: rangeSize });

  const header = (
    <div className="mb-6 flex flex-wrap items-center gap-4">
      {displayableResourceUrl(user?.avatarUrl) ? (
        <img
          src={displayableResourceUrl(user.avatarUrl)}
          alt={user.name || ""}
          className="size-14 shrink-0 rounded-[16px] object-cover"
        />
      ) : (
        <GradientAvatar
          name={user?.name}
          id={user?.id?.toString()}
          size={56}
          square
          className="rounded-[16px]"
        />
      )}

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-bold tracking-[-0.02em] text-ej-ink">
          {user?.name}
        </h1>
        <p className="mt-1 truncate text-xs text-ej-muted">
          {[
            user?.id && t("profile.profileId", { id: user.id }),
            t("profile.localData"),
            user?.createdAt &&
              t("profile.learningSince", {
                date: dayjs(user.createdAt).format("DD/MM/YYYY"),
              }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <Segmented<Range>
        value={range}
        onChange={(value) => {
          setRange(value);
          setSelectedDay(null);
        }}
        options={[
          { value: "7", label: t("profile.range7") },
          { value: "30", label: t("profile.range30") },
          { value: "90", label: t("profile.range90") },
        ]}
      />
    </div>
  );

  return (
    <EjPage className={cn(!fluid && "max-w-[900px]")}>
      <div data-testid="profile-page">
        {header}

        <div className="mb-4">
          <RecordingStats stats={stats} />
        </div>

        <div
          className={cn(
            "grid items-start gap-4",
            fluid
              ? "grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)]"
              : "grid-cols-1"
          )}
        >
          <div className="flex min-w-0 flex-col gap-4">
            <RecordingHeatmap
              days={days}
              selected={selectedDay}
              onSelect={setSelectedDay}
              startLabel={dayjs(days[0]?.date).format("D/M")}
              footer={
                selectedDay
                  ? selectedTotal
                    ? t("profile.viewingDay", {
                        date: dayjs(selectedDay).format("DD/MM"),
                        minutes: Math.round(selectedTotal.minutes),
                      })
                    : t("profile.viewingDayEmpty", {
                        date: dayjs(selectedDay).format("DD/MM"),
                      })
                  : t("profile.pickCellHint")
              }
            />

            <RecordingMinutesChart days={rangeDays} rangeLabel={rangeLabel} />
          </div>

          <RecordingActivities
            activities={activities}
            rangeLabel={
              selectedDay
                ? t("profile.dayOf", {
                    date: dayjs(selectedDay).format("DD/MM/YYYY"),
                  })
                : rangeLabel
            }
            dayLabel={(date) => {
              if (date === dayjs().format(DATE_FORMAT)) return t("today");
              if (date === dayjs().subtract(1, "day").format(DATE_FORMAT))
                return t("yesterday");
              return dayjs(date).format("DD/MM/YYYY");
            }}
          />
        </div>
      </div>
    </EjPage>
  );
};
