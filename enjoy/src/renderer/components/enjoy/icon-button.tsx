import { forwardRef } from "react";
import { cn } from "@renderer/lib/utils";

/**
 * Square icon button, the shell/toolbar workhorse (28-34px per the spec).
 */
export const EjIconButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: number;
    active?: boolean;
    danger?: boolean;
  }
>(({ size = 28, active, danger, className, style, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    style={{ width: size, height: size, ...style }}
    className={cn(
      "inline-flex items-center justify-center rounded-lg shrink-0",
      "text-ej-ink2 transition-colors duration-ej",
      "disabled:opacity-40 disabled:pointer-events-none",
      active
        ? "bg-ej-accent-soft text-ej-accent-ink"
        : "hover:bg-ej-surface2 hover:text-ej-ink",
      danger && "hover:bg-ej-bad hover:text-white",
      className
    )}
    {...props}
  />
));
EjIconButton.displayName = "EjIconButton";
