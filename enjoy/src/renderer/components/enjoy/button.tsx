import { forwardRef } from "react";
import { Link } from "react-router-dom";
import { cn } from "@renderer/lib/utils";

export type EjButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "accent"
  | "danger";

export type EjButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<EjButtonVariant, string> = {
  primary:
    "bg-ej-ink text-ej-bg hover:opacity-90 disabled:hover:opacity-100",
  secondary:
    "border border-ej-line bg-ej-surface text-ej-ink hover:bg-ej-surface2",
  ghost: "text-ej-ink2 hover:bg-ej-surface2 hover:text-ej-ink",
  accent:
    "border border-ej-accent bg-ej-accent-soft text-ej-accent-ink hover:bg-ej-accent-soft2",
  danger: "border border-ej-bad bg-ej-bad-soft text-ej-bad hover:opacity-90",
};

const SIZES: Record<EjButtonSize, string> = {
  sm: "h-7 px-2.5 text-xxs gap-1",
  md: "h-9 px-3.5 text-xs gap-1.5",
  lg: "h-11 px-5 text-[13px] gap-2",
};

/** Shared button class string so every screen draws the same control shapes. */
export const ejButtonClass = (options?: {
  variant?: EjButtonVariant;
  size?: EjButtonSize;
  className?: string;
}) =>
  cn(
    "inline-flex items-center justify-center rounded-[10px] font-semibold whitespace-nowrap",
    "transition-colors duration-ej focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ej-accent",
    "disabled:cursor-not-allowed disabled:opacity-40",
    SIZES[options?.size ?? "md"],
    VARIANTS[options?.variant ?? "secondary"],
    options?.className
  );

export const EjButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: EjButtonVariant;
    size?: EjButtonSize;
  }
>(({ variant, size, className, type = "button", ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={ejButtonClass({ variant, size, className })}
    {...props}
  />
));
EjButton.displayName = "EjButton";

/** Router link drawn as a button. */
export const EjLinkButton = (props: {
  to: string;
  children: React.ReactNode;
  variant?: EjButtonVariant;
  size?: EjButtonSize;
  className?: string;
}) => {
  const { to, children, variant, size, className } = props;
  return (
    <Link to={to} className={ejButtonClass({ variant, size, className })}>
      {children}
    </Link>
  );
};
