import { Link } from "react-router-dom";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@renderer/lib/utils";

/**
 * Page shell. Centred at --ej-content-max in the fixed layout, full-bleed in
 * fluid. Every screen mounts inside a height:100% section that scrolls itself.
 */
export const EjPage = (props: {
  children: React.ReactNode;
  className?: string;
  /** Disable the default 22px/28px page padding. */
  bare?: boolean;
}) => {
  const { children, className, bare } = props;

  return (
    <div className="h-full overflow-y-auto">
      <div
        className={cn(
          "w-full mx-auto max-w-content",
          bare ? "" : "px-7 pt-[22px] pb-11",
          className
        )}
      >
        {children}
      </div>
    </div>
  );
};

export const EjPageHeader = (props: {
  /** Small uppercase line above the title. */
  kicker?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned controls. */
  actions?: React.ReactNode;
  className?: string;
}) => {
  const { kicker, title, description, actions, className } = props;

  return (
    <div className={cn("flex items-start gap-4 mb-6", className)}>
      <div className="min-w-0 flex-1">
        {kicker && <div className="ej-label text-ej-accent mb-1">{kicker}</div>}
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-ej-ink truncate">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-xs text-ej-muted">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      )}
    </div>
  );
};

/** Section heading used by Home and library rows. */
export const EjSectionHeader = (props: {
  title: React.ReactNode;
  count?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) => {
  const { title, count, action, className } = props;

  return (
    <div className={cn("flex items-center gap-2 mb-3", className)}>
      <h2 className="text-base font-bold text-ej-ink">{title}</h2>
      {count !== undefined && (
        <span className="text-xs text-ej-muted">{count}</span>
      )}
      <div className="flex-1" />
      {action}
    </div>
  );
};

/** "Xem tất cả ›" link sitting at the right of a section header. */
export const EjSeeAllLink = (props: { to: string; label: React.ReactNode }) => (
  <Link
    to={props.to}
    className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-xs font-medium text-ej-accent hover:bg-ej-accent-soft transition-colors duration-ej"
  >
    {props.label}
    <ChevronRightIcon className="size-3.5" />
  </Link>
);
