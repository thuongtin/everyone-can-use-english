import { cn } from "@renderer/lib/utils";

/** Dashed placeholder used by empty libraries, studio and flashcards. */
export const EjEmptyState = (props: {
  kicker?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) => {
  const { kicker, title, description, actions, className } = props;

  return (
    <div
      className={cn(
        "rounded-[18px] border border-dashed border-ej-line2 bg-ej-surface/40",
        "px-8 py-12 text-center animate-rise",
        className
      )}
    >
      {kicker && <div className="ej-label mb-2">{kicker}</div>}
      <h2 className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-ej-ink max-w-xl mx-auto">
        {title}
      </h2>
      {description && (
        <p className="mt-3 text-xs text-ej-muted max-w-md mx-auto">
          {description}
        </p>
      )}
      {actions && (
        <div className="mt-6 flex items-center justify-center gap-3 flex-wrap">
          {actions}
        </div>
      )}
    </div>
  );
};
