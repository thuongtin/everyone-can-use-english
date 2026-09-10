import { cn } from "@renderer/lib/utils";

export type RecordingStat = {
  label: string;
  value: string;
  hint?: string;
  hintTone?: "ok" | "muted";
  icon: React.ReactNode;
  iconClassName?: string;
};

/** The four headline numbers on the profile screen. */
export const RecordingStats = (props: { stats: RecordingStat[] }) => (
  <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
    {props.stats.map((stat) => (
      <div
        key={stat.label}
        className="flex animate-rise flex-col gap-1 rounded-[14px] border border-ej-line bg-ej-surface px-4 py-3.5"
      >
        <div className="flex items-center justify-between gap-2 text-[11.5px] text-ej-muted">
          <span className="min-w-0 truncate">{stat.label}</span>
          <span className={cn("shrink-0", stat.iconClassName)}>
            {stat.icon}
          </span>
        </div>
        <div className="ej-tabular text-[26px] font-bold leading-tight tracking-[-0.02em] text-ej-ink">
          {stat.value}
        </div>
        <div
          className={cn(
            "text-[11.5px]",
            stat.hintTone === "ok" ? "text-ej-ok" : "text-ej-muted"
          )}
        >
          {stat.hint}
        </div>
      </div>
    ))}
  </div>
);
