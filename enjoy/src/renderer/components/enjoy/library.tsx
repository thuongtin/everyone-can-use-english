import { SearchIcon } from "lucide-react";
import { cn } from "@renderer/lib/utils";

/**
 * Toolbar sitting under a library header: filters on the left, view switch on
 * the right, closed by the design's hairline rule.
 */
export const EjToolbar = (props: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "flex flex-wrap items-center gap-2.5 pb-3 mb-5 border-b border-ej-line",
      props.className
    )}
  >
    {props.children}
  </div>
);

/** Shared height/shape for every control living inside `EjToolbar`. */
export const EJ_CONTROL_CLASS =
  "h-[34px] rounded-[10px] border border-ej-line bg-ej-surface text-xs text-ej-ink";

export const EjSearchInput = (props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) => (
  <div className={cn("relative flex-1 min-w-[180px] max-w-[340px]", props.className)}>
    <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-ej-muted pointer-events-none" />
    <input
      type="search"
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
      className={cn(
        EJ_CONTROL_CLASS,
        "w-full pl-8 pr-3 placeholder:text-ej-muted outline-none focus:border-ej-accent transition-colors duration-ej"
      )}
    />
  </div>
);

/**
 * Auto-filling media grid. `wide` switches to the 16:9 track used by videos.
 */
export const EjMediaGrid = (props: {
  children: React.ReactNode;
  wide?: boolean;
  className?: string;
}) => (
  <div
    className={cn("grid", props.className)}
    style={{
      gap: props.wide ? 18 : 20,
      gridTemplateColumns: `repeat(auto-fill, minmax(${
        props.wide ? 240 : 176
      }px, 1fr))`,
    }}
  >
    {props.children}
  </div>
);
