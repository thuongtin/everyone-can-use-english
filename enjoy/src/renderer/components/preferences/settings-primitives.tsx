import { forwardRef, useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, EyeIcon, EyeOffIcon, InfoIcon } from "lucide-react";
import { cn } from "@renderer/lib/utils";

/** A titled block of settings. Untitled groups drop the label line. */
export const SettingGroup = (props: {
  title?: string;
  meta?: string;
  className?: string;
  children: React.ReactNode;
}) => (
  <div className={cn("mt-5", props.className)}>
    {props.title && (
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ej-muted">
          {props.title}
        </span>
        {props.meta && (
          <span className="text-[11px] text-ej-muted">{props.meta}</span>
        )}
      </div>
    )}
    {props.children}
  </div>
);

/** The bordered container the rows sit in. */
export const SettingCard = (props: {
  className?: string;
  children: React.ReactNode;
}) => (
  <div
    className={cn(
      "rounded-ej border border-ej-line bg-ej-surface",
      "[&>*+*]:border-t [&>*+*]:border-ej-line",
      props.className
    )}
  >
    {props.children}
  </div>
);

/** One label / description / control line inside a card. */
export const SettingRow = (props: {
  label: string;
  description?: React.ReactNode;
  note?: string;
  className?: string;
  children?: React.ReactNode;
}) => (
  <div
    className={cn(
      "flex items-start justify-between gap-6 px-4 py-[13px]",
      props.className
    )}
  >
    <div className="min-w-0">
      <div className="text-[13px] font-semibold text-ej-ink">{props.label}</div>
      {props.description && (
        <div className="mt-0.5 text-xs leading-[1.5] text-ej-muted">
          {props.description}
        </div>
      )}
    </div>
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      {props.children}
      {props.note && (
        <div className="flex items-center gap-1 text-[11px] text-ej-muted">
          <InfoIcon className="size-3 shrink-0" />
          {props.note}
        </div>
      )}
    </div>
  </div>
);

export type SettingOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

/** Button that opens a small list of choices, the workhorse control. */
export const SettingSelect = (props: {
  value?: string;
  options: SettingOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  menuClassName?: string;
  disabled?: boolean;
}) => {
  const { value, options, onChange, placeholder, disabled } = props;
  const [open, setOpen] = useState<boolean>(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const selected = options.find((option) => option.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-[34px] min-w-[200px] items-center justify-between gap-2 rounded-[9px]",
          "border border-ej-line bg-ej-bg px-2.5 text-left text-[12.5px] text-ej-ink",
          "transition-colors duration-ej hover:bg-ej-surface2",
          "disabled:pointer-events-none disabled:opacity-50",
          props.className
        )}
      >
        <span className="truncate">
          {selected?.label || placeholder || ""}
        </span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-ej-muted" />
      </button>

      {open && (
        <div
          className={cn(
            "absolute right-0 z-30 mt-1 max-h-72 w-60 animate-rise overflow-y-auto",
            "rounded-[10px] border border-ej-line bg-ej-surface p-[5px] shadow-ej",
            props.menuClassName
          )}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={option.disabled}
              onClick={() => {
                setOpen(false);
                if (option.value !== value) onChange(option.value);
              }}
              className={cn(
                "flex w-full items-start gap-2 rounded-[7px] px-2.5 py-2 text-left",
                "text-[12.5px] text-ej-ink transition-colors duration-ej",
                "hover:bg-ej-surface2 disabled:pointer-events-none disabled:opacity-50"
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{option.label}</span>
                {option.description && (
                  <span className="mt-0.5 block text-[11px] leading-[1.45] text-ej-muted">
                    {option.description}
                  </span>
                )}
              </span>
              {option.value === value && (
                <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-ej-accent" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/** 36x20 toggle, the only switch shape the settings use. */
export const SettingSwitch = (props: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={props.checked}
    aria-label={props["aria-label"]}
    disabled={props.disabled}
    onClick={() => props.onCheckedChange(!props.checked)}
    className={cn(
      "relative h-5 w-9 shrink-0 rounded-full transition-colors duration-ej",
      "disabled:pointer-events-none disabled:opacity-50",
      props.checked ? "bg-ej-accent" : "bg-ej-line2"
    )}
  >
    <span
      className={cn(
        "absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-all duration-ej",
        props.checked ? "left-[18px]" : "left-0.5"
      )}
    />
  </button>
);

export const SettingInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-[34px] min-w-[260px] rounded-[9px] border border-ej-line bg-ej-bg px-2.5",
      "text-[12.5px] text-ej-ink outline-none transition-colors duration-ej",
      "placeholder:text-ej-muted focus:border-ej-accent",
      className
    )}
    {...props}
  />
));
SettingInput.displayName = "SettingInput";

/** Password field with the reveal button the handoff asks for. */
export const SettingSecretInput = (
  props: React.InputHTMLAttributes<HTMLInputElement>
) => {
  const { className, ...rest } = props;
  const [visible, setVisible] = useState<boolean>(false);

  return (
    <div className="relative">
      <SettingInput
        type={visible ? "text" : "password"}
        className={cn("w-full pr-9", className)}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setVisible(!visible)}
        className="absolute right-[5px] top-1/2 flex size-[26px] -translate-y-1/2 items-center justify-center rounded-[7px] text-ej-muted transition-colors duration-ej hover:bg-ej-surface2 hover:text-ej-ink"
      >
        {visible ? (
          <EyeOffIcon className="size-3.5" />
        ) : (
          <EyeIcon className="size-3.5" />
        )}
      </button>
    </div>
  );
};

/** Compact button used at the right end of a row. */
export const SettingButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }
>(({ className, danger, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[9px] border px-2.5",
      "text-[11.5px] font-semibold transition-colors duration-ej",
      "disabled:pointer-events-none disabled:opacity-50",
      danger
        ? "border-ej-bad/40 text-ej-bad hover:bg-ej-bad-soft"
        : "border-ej-line text-ej-ink hover:bg-ej-surface2",
      className
    )}
    {...props}
  />
));
SettingButton.displayName = "SettingButton";

/** Collapsible block for the per-service fields power users still need. */
export const SettingDisclosure = (props: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) => {
  const [open, setOpen] = useState<boolean>(false);

  return (
    <div className="rounded-ej border border-ej-line bg-ej-surface">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 px-4 py-[13px] text-left transition-colors duration-ej hover:bg-ej-surface2"
      >
        <ChevronDownIcon
          className={cn(
            "mt-0.5 size-4 shrink-0 text-ej-muted transition-transform duration-ej",
            !open && "-rotate-90"
          )}
        />
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-ej-ink">
            {props.label}
          </span>
          {props.description && (
            <span className="mt-0.5 block text-xs leading-[1.5] text-ej-muted">
              {props.description}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-ej-line px-4 py-3.5">
          {props.children}
        </div>
      )}
    </div>
  );
};
