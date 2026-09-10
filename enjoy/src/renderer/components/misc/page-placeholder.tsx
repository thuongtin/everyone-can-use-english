import { AlertTriangleIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { EjButton } from "@renderer/components/enjoy";
import { t } from "i18next";

export const PagePlaceholder = (props: {
  placeholder?: string;
  extra?: string;
  showBackButton?: boolean;
}) => {
  const { placeholder, extra, showBackButton } = props;
  const navigate = useNavigate();

  return (
    <div className="flex h-full shrink-0 items-center justify-center rounded-[20px] border border-dashed border-ej-line2 bg-ej-surface px-6 py-14">
      <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
        <AlertTriangleIcon className="size-9 text-ej-warn" />

        <h3 className="mt-4 text-base font-bold text-ej-ink">
          {placeholder || t("notReadyYet")}
        </h3>
        {extra && (
          <p className="mt-2 select-text break-words text-xs leading-relaxed text-ej-muted">
            {extra}
          </p>
        )}
        {showBackButton && (
          <EjButton
            variant="secondary"
            className="mt-4"
            onClick={() => navigate(-1)}
          >
            {t("goBack")}
          </EjButton>
        )}
      </div>
    </div>
  );
};
