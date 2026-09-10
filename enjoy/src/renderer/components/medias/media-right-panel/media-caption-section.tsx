import { ChevronDownIcon } from "lucide-react";
import { cn } from "@renderer/lib/utils";

/**
 * One of the three stacked panes under the sentence. The header stays visible
 * when collapsed and carries the summary of what is inside.
 */
export const MediaCaptionSection = (props: {
  label: string;
  meta?: string;
  open: boolean;
  onToggle: () => void;
  last?: boolean;
  children: React.ReactNode;
}) => {
  const { label, meta, open, onToggle, last, children } = props;

  return (
    <section className="border-t border-ej-line">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex h-10 w-full select-none items-center gap-2 pl-4 pr-5 text-left transition-colors duration-ej hover:bg-ej-surface2"
      >
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-ej-muted transition-transform duration-ej",
            !open && "-rotate-90"
          )}
        />
        <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ej-muted">
          {label}
        </span>
        {meta && (
          <span className="ml-auto truncate text-[11px] text-ej-muted">
            {meta}
          </span>
        )}
      </button>

      {open && (
        <div className={cn("pl-10 pr-5 pb-[18px]", last && "pb-4")}>
          {children}
        </div>
      )}
    </section>
  );
};
