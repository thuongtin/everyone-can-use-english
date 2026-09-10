import { cn } from "@renderer/lib/utils";

export type SegmentedOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  /** Tooltip for icon-only segments. */
  title?: string;
};

/**
 * Segmented control: --ej-surface2 tray, selected item on --ej-surface with the
 * design shadow.
 */
export function Segmented<T extends string>(props: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  className?: string;
  size?: "sm" | "md";
}) {
  const { value, onChange, options, className, size = "md" } = props;

  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-1 rounded-[10px] bg-ej-surface2 p-[3px]",
        className
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-lg font-medium transition-colors duration-ej whitespace-nowrap",
              size === "sm" ? "h-6 px-2 text-xxs" : "h-[26px] px-3 text-xs",
              active
                ? "bg-ej-surface text-ej-ink shadow-ej"
                : "text-ej-muted hover:text-ej-ink"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
