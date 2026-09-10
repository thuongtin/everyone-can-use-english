import { t } from "i18next";
import { BookAIcon } from "lucide-react";
import { cn } from "@renderer/lib/utils";

/**
 * One dictionary in the list. The whole row is the target: picking it makes
 * that dictionary the default one used when tapping a word in a lesson.
 */
export const DictRow = (props: {
  name: string;
  meta: string;
  isDefault: boolean;
  onSelect?: () => void;
  actions?: React.ReactNode;
}) => {
  const { name, meta, isDefault, onSelect, actions } = props;

  return (
    <div
      role="radio"
      tabIndex={0}
      aria-checked={isDefault}
      onClick={() => onSelect?.()}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect?.();
      }}
      className={cn(
        "group flex cursor-pointer items-center gap-3 px-3.5 py-3",
        "outline-none transition-colors duration-ej",
        isDefault ? "bg-ej-accent-soft/45" : "hover:bg-ej-surface2"
      )}
    >
      <span
        className={cn(
          "size-4 shrink-0 rounded-full",
          isDefault
            ? "border-[5px] border-ej-accent"
            : "border-[1.5px] border-ej-line2"
        )}
      />
      <BookAIcon className="size-4 shrink-0 text-ej-muted" />

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-[13px] text-ej-ink",
            isDefault && "font-semibold"
          )}
        >
          {name}
        </div>
        <div className="mt-0.5 truncate text-[11.5px] text-ej-muted">
          {meta}
        </div>
      </div>

      {isDefault && (
        <span className="shrink-0 rounded-md bg-ej-accent-soft px-1.5 py-0.5 text-[10px] font-bold text-ej-accent-ink">
          {t("default")}
        </span>
      )}
      {actions}
    </div>
  );
};
