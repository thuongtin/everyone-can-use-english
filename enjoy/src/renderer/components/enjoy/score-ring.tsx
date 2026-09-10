import { cn } from "@renderer/lib/utils";
import { scoreColor, scoreSoftColor } from "@renderer/lib/design";

/**
 * Circular score gauge. Used at 46px in lists and 150px in assessment details.
 */
export const ScoreRing = (props: {
  score?: number | null;
  size?: number;
  stroke?: number;
  className?: string;
  /** Hide the numeric label (tiny sizes). */
  hideLabel?: boolean;
  label?: React.ReactNode;
}) => {
  const {
    score,
    size = 150,
    stroke = Math.max(2, Math.round(size / 13.6)),
    className,
    hideLabel,
    label,
  } = props;

  const value = Math.max(0, Math.min(100, score ?? 0));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = scoreColor(score);

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={scoreSoftColor(score)}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value / 100)}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      {!hideLabel && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-bold ej-tabular leading-none"
            style={{ color, fontSize: Math.max(11, Math.round(size / 4.4)) }}
          >
            {score === undefined || score === null ? "--" : Math.round(score)}
          </span>
          {label && (
            <span className="mt-1 text-xxs text-ej-muted">{label}</span>
          )}
        </div>
      )}
    </div>
  );
};

/** Horizontal score bar used for accuracy / fluency / completeness rows. */
export const ScoreBar = (props: {
  label: React.ReactNode;
  score?: number | null;
  hint?: React.ReactNode;
  height?: number;
  className?: string;
}) => {
  const { label, score, hint, height = 8, className } = props;
  const value = Math.max(0, Math.min(100, score ?? 0));

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-medium text-ej-ink2 truncate">
          {label}
        </span>
        {hint}
        <div className="flex-1" />
        <span
          className="text-xs font-semibold ej-tabular"
          style={{ color: scoreColor(score) }}
        >
          {score === undefined || score === null ? "--" : Math.round(score)}
        </span>
      </div>
      <div
        className="w-full rounded-full bg-ej-surface2 overflow-hidden"
        style={{ height }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${value}%`, background: scoreColor(score) }}
        />
      </div>
    </div>
  );
};
