import { t } from "i18next";
import { useNavigate } from "react-router-dom";
import { HeadphonesIcon, VideoIcon } from "lucide-react";
import { GradientCover } from "@renderer/components/enjoy";
import { scoreChipClass } from "@renderer/lib/design";
import { secondsToTimestamp } from "@renderer/lib/utils";
import { cn } from "@renderer/lib/utils";

export type RecordingActivity = {
  /** YYYY-MM-DD */
  date: string;
  targetId: string;
  targetType: string;
  count: number;
  duration: number;
  target?: AudioType | VideoType;
  score?: number;
};

const routeFor = (activity: RecordingActivity) =>
  activity.targetType === "Video"
    ? `/videos/${activity.targetId}`
    : `/audios/${activity.targetId}`;

export const RecordingActivities = (props: {
  activities: RecordingActivity[];
  /** Range or single-day label shown under the heading. */
  rangeLabel: string;
  dayLabel: (date: string) => string;
}) => {
  const { activities, rangeLabel, dayLabel } = props;
  const navigate = useNavigate();

  const total = activities.reduce((sum, activity) => sum + activity.count, 0);

  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-ej-lg border border-ej-line bg-ej-surface px-5 py-[18px]">
      <header className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="min-w-0">
          <h2 className="text-[13px] font-bold text-ej-ink">
            {t("profile.activity")}
          </h2>
          <div className="truncate text-xs text-ej-muted">{rangeLabel}</div>
        </div>
        <span className="shrink-0 text-xs text-ej-muted">
          {t("profile.recordingCount", { count: total })}
        </span>
      </header>

      <div className="flex flex-col gap-2">
        {activities.map((activity, index) => (
          <div key={`${activity.date}-${activity.targetId}`}>
            {(index === 0 || activity.date !== activities[index - 1].date) && (
              <div className="pb-2 pt-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-ej-muted">
                {dayLabel(activity.date)}
              </div>
            )}

            <button
              type="button"
              onClick={() => navigate(routeFor(activity))}
              className="flex w-full animate-rise items-center gap-3 rounded-ej border border-ej-line px-3 py-2.5 text-left transition-colors duration-ej hover:bg-ej-bg"
            >
              <GradientCover
                id={activity.targetId}
                rounded="rounded-[10px]"
                className="size-9"
              >
                {activity.targetType === "Video" ? (
                  <VideoIcon className="size-[15px]" />
                ) : (
                  <HeadphonesIcon className="size-[15px]" />
                )}
              </GradientCover>

              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-ej-ink">
                  {activity.target?.name || activity.targetId}
                </div>
                <div className="truncate text-[11.5px] text-ej-muted">
                  {t("profile.activityMeta", {
                    count: activity.count,
                    duration: secondsToTimestamp(activity.duration / 1000),
                  })}
                </div>
              </div>

              {typeof activity.score === "number" && (
                <span
                  className={cn(
                    "ej-tabular shrink-0 rounded-full px-2.5 py-[3px] text-xs font-bold",
                    scoreChipClass(activity.score)
                  )}
                >
                  {Math.round(activity.score)}
                </span>
              )}
            </button>
          </div>
        ))}

        {activities.length === 0 && (
          <div className="px-3 py-6 text-center leading-relaxed text-ej-muted">
            <div>{t("profile.emptyDay")}</div>
            <div>{t("profile.emptyDayHint")}</div>
          </div>
        )}
      </div>
    </section>
  );
};
