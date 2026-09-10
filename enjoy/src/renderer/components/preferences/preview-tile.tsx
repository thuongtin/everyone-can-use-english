import { CheckIcon } from "lucide-react";
import { cn } from "@renderer/lib/utils";

/**
 * The 84px picture-first option used by the theme and layout pickers. The
 * mini interface inside is drawn with plain divs so it always matches the
 * tokens it advertises.
 */
export const PreviewTile = (props: {
  selected: boolean;
  label: string;
  description?: string;
  onSelect: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={props.onSelect}
    aria-pressed={props.selected}
    className="flex-1 text-left"
  >
    <div
      className={cn(
        "relative h-[84px] overflow-hidden rounded-[10px] border-2",
        "transition-colors duration-ej",
        props.selected
          ? "border-ej-accent shadow-[0_0_0_3px_var(--ej-accent-soft)]"
          : "border-ej-line"
      )}
    >
      {props.children}

      {props.selected && (
        <span className="absolute right-1.5 top-1.5 flex size-[18px] items-center justify-center rounded-full bg-ej-accent">
          <CheckIcon className="size-2.5 text-white" />
        </span>
      )}
    </div>

    <div
      className={cn(
        "mt-1.5 text-xs text-ej-ink",
        props.selected && "font-semibold"
      )}
    >
      {props.label}
    </div>
    {props.description && (
      <div className="text-[10.5px] text-ej-muted">{props.description}</div>
    )}
  </button>
);
