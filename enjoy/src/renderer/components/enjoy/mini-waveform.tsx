import { useMemo } from "react";
import { cn } from "@renderer/lib/utils";
import { hashCode } from "@renderer/lib/design";

/**
 * Decorative waveform preview drawn from a deterministic pseudo-random series,
 * used where a real wavesurfer instance would be too heavy (cards, rows).
 * `peaks` accepts real amplitude data when it is already available.
 */
export const MiniWaveform = (props: {
  id?: string;
  peaks?: number[];
  /** Played fraction, 0..1, filled with --ej-wave-on. */
  progress?: number;
  bars?: number;
  height?: number;
  className?: string;
  onSeek?: (fraction: number) => void;
}) => {
  const {
    id,
    peaks,
    progress = 0,
    bars = 64,
    height = 34,
    className,
    onSeek,
  } = props;

  const values = useMemo(() => {
    if (peaks?.length) return peaks;
    // Deterministic per-id pseudo-random walk: stable across re-renders.
    let seed = hashCode(id || "enjoy") || 1;
    return Array.from({ length: bars }, () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return 0.25 + ((seed >> 8) % 1000) / 1000 * 0.75;
    });
  }, [id, peaks, bars]);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)));
  };

  return (
    <div
      className={cn(
        "flex items-center gap-[2px] w-full",
        onSeek && "cursor-pointer",
        className
      )}
      style={{ height }}
      onClick={handleClick}
    >
      {values.map((value, index) => (
        <span
          key={index}
          className="flex-1 rounded-full"
          style={{
            height: `${Math.round(value * 100)}%`,
            minWidth: 2,
            background:
              index / values.length <= progress
                ? "var(--ej-wave-on)"
                : "var(--ej-wave)",
          }}
        />
      ))}
    </div>
  );
};
