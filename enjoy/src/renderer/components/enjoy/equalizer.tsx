import { cn } from "@renderer/lib/utils";

/** Three animated bars marking the sentence currently playing. */
export const Equalizer = (props: { className?: string; color?: string }) => {
  const { className, color = "var(--ej-accent)" } = props;

  return (
    <div className={cn("flex items-end gap-[2px] h-3", className)}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[3px] h-full rounded-full origin-bottom animate-bars"
          style={{ background: color, animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
};

/** Three blinking dots used while the assistant is typing. */
export const TypingDots = (props: { className?: string }) => (
  <div className={cn("flex items-center gap-1", props.className)}>
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        className="size-1.5 rounded-full bg-ej-muted animate-blink"
        style={{ animationDelay: `${i * 0.2}s` }}
      />
    ))}
  </div>
);

/** Pulsing red dot shown while recording. */
export const RecordingDot = (props: { className?: string }) => (
  <span
    className={cn(
      "inline-block size-2 rounded-full bg-ej-bad animate-ej-pulse",
      props.className
    )}
  />
);
