import { t } from "i18next";
import { cn } from "@renderer/lib/utils";

export type PracticeDay = {
  /** YYYY-MM-DD */
  date: string;
  count: number;
  minutes: number;
  /** Days after today are rendered as placeholders. */
  future?: boolean;
};

/** Level palette, from "no practice" to "a lot". Mirrors the design tokens. */
const LEVEL_COLORS = [
  "var(--ej-surface2)",
  "var(--ej-accent-soft2)",
  "#7FA6EA",
  "var(--ej-accent)",
  "var(--ej-accent-ink)",
];

export const practiceLevel = (minutes: number) => {
  if (minutes <= 0) return 0;
  if (minutes < 10) return 1;
  if (minutes < 25) return 2;
  if (minutes < 45) return 3;
  return 4;
};

/** Weekday label column: only Mon / Wed / Fri / Sun carry a label. */
const ROW_LABELS = [1, null, 3, null, 5, null, 0];

export const RecordingHeatmap = (props: {
  /** 26 * 7 cells, ordered column by column (each column is one week). */
  days: PracticeDay[];
  selected?: string | null;
  onSelect?: (date: string | null) => void;
  startLabel: string;
  footer: string;
}) => {
  const { days, selected, onSelect, startLabel, footer } = props;

  return (
    <section className="flex flex-col gap-3 rounded-ej-lg border border-ej-line bg-ej-surface px-5 py-[18px]">
      <header className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="text-[13px] font-bold text-ej-ink">
          {t("profile.calendar")}
        </h2>
        <div className="flex items-center gap-1.5 text-[11px] text-ej-muted">
          {t("profile.less")}
          <span className="inline-flex gap-[3px]">
            {LEVEL_COLORS.map((color) => (
              <span
                key={color}
                className="size-[11px] rounded-[3px]"
                style={{ background: color }}
              />
            ))}
          </span>
          {t("profile.more")}
        </div>
      </header>

      <div className="flex gap-2">
        <div className="grid grid-rows-7 gap-[3px] text-[10px] text-ej-muted">
          {ROW_LABELS.map((weekday, row) => (
            <span key={row} className="h-3 leading-3">
              {weekday === null ? "" : t(`profile.weekdays.${weekday}`)}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto">
          <div
            className="grid min-w-[420px] grid-flow-col grid-rows-7 gap-[3px]"
            style={{ gridTemplateColumns: "repeat(26, minmax(0, 1fr))" }}
          >
            {days.map((day) => {
              if (day.future) {
                return <span key={day.date} className="h-3 w-full" />;
              }

              const active = selected === day.date;

              return (
                <button
                  key={day.date}
                  type="button"
                  aria-label={day.date}
                  title={
                    day.count
                      ? t("profile.cellTip", {
                          date: day.date,
                          minutes: day.minutes,
                          count: day.count,
                        })
                      : `${day.date} · ${t("profile.noPractice")}`
                  }
                  onClick={() => onSelect?.(active ? null : day.date)}
                  className={cn(
                    "h-3 w-full rounded-[3px] transition-transform duration-ej hover:scale-125",
                    active && "outline outline-2 outline-ej-ink"
                  )}
                  style={{
                    background: LEVEL_COLORS[practiceLevel(day.minutes)],
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>

      <footer className="flex items-center justify-between gap-3 text-[11.5px] text-ej-muted">
        <span className="shrink-0">{startLabel}</span>
        <span className="min-w-0 truncate text-center">{footer}</span>
        <span className="shrink-0">{t("profile.today")}</span>
      </footer>
    </section>
  );
};
