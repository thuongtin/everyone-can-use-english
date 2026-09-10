import { cn } from "@renderer/lib/utils";

/** Rounded chip: stats, tags, filters. */
export const Pill = (props: {
  children: React.ReactNode;
  className?: string;
  tone?: "default" | "accent" | "ok" | "warn" | "bad" | "muted";
  onClick?: () => void;
  title?: string;
}) => {
  const { children, className, tone = "default", onClick, title } = props;

  const tones: Record<string, string> = {
    default: "bg-ej-surface border border-ej-line text-ej-ink2",
    accent: "bg-ej-accent-soft text-ej-accent-ink",
    ok: "bg-ej-ok-soft text-ej-ok",
    warn: "bg-ej-warn-soft text-ej-warn",
    bad: "bg-ej-bad-soft text-ej-bad",
    muted: "bg-ej-surface2 text-ej-muted",
  };

  const Tag = onClick ? "button" : "div";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 h-6 text-xs font-medium whitespace-nowrap",
        tones[tone],
        onClick && "hover:border-ej-accent transition-colors duration-ej",
        className
      )}
    >
      {children}
    </Tag>
  );
};

/** Compact stat block used on Profile and Chats aside. */
export const StatBox = (props: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "rounded-ej border border-ej-line bg-ej-surface px-4 py-3",
      props.className
    )}
  >
    <div className="ej-label mb-1.5">{props.label}</div>
    <div className="text-[26px] font-bold leading-none text-ej-ink ej-tabular">
      {props.value}
    </div>
    {props.hint && (
      <div className="mt-1.5 text-xs text-ej-muted">{props.hint}</div>
    )}
  </div>
);
