import { t } from "i18next";
import dayjs from "@renderer/lib/dayjs";
import type { PracticeDay } from "./recording-heatmap";

const MIN_BAR_HEIGHT = 3;

export const RecordingMinutesChart = (props: {
  days: PracticeDay[];
  rangeLabel: string;
}) => {
  const { days, rangeLabel } = props;

  const peak = Math.max(...days.map((day) => day.minutes), 1);
  const total = days.reduce((sum, day) => sum + day.minutes, 0);
  const average = days.length ? Math.round(total / days.length) : 0;
  const today = dayjs().format("YYYY-MM-DD");
  const dense = days.length > 7;
  // A tick every 5 days over a month, every 15 over a quarter.
  const tickEvery = days.length > 30 ? 15 : 5;

  return (
    <section className="flex flex-col gap-3 rounded-ej-lg border border-ej-line bg-ej-surface px-5 py-[18px]">
      <header className="flex items-center justify-between gap-2.5">
        <h2 className="text-[13px] font-bold text-ej-ink">
          {t("profile.minutesPerDay", { range: rangeLabel })}
        </h2>
        <span className="shrink-0 text-xs text-ej-muted">
          {t("profile.avgMinutes", { minutes: average })}
        </span>
      </header>

      <div
        className="flex h-[120px] items-end pt-1.5"
        style={{ gap: dense ? 2 : 10 }}
      >
        {days.map((day, index) => {
          const isToday = day.date === today;
          const height = day.minutes
            ? Math.max(MIN_BAR_HEIGHT, (day.minutes / peak) * 100)
            : MIN_BAR_HEIGHT;
          const label = dense
            ? index % tickEvery === 0
              ? dayjs(day.date).format("D/M")
              : ""
            : t(`profile.weekdays.${dayjs(day.date).day()}`);

          return (
            <div
              key={day.date}
              title={t("profile.minutesTip", {
                date: dayjs(day.date).format("D/M"),
                minutes: day.minutes,
              })}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
            >
              {!dense && (
                <span className="text-[10.5px] font-semibold text-ej-ink2">
                  {day.minutes || ""}
                </span>
              )}
              <span
                className="w-full max-w-[34px] rounded-t-md rounded-b-[3px] transition-[height] duration-300"
                style={{
                  height: `${height}%`,
                  background: isToday
                    ? "var(--ej-accent)"
                    : day.minutes
                      ? "var(--ej-accent-soft2)"
                      : "var(--ej-surface2)",
                }}
              />
              <span className="whitespace-nowrap text-[10px] text-ej-muted">
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
};
