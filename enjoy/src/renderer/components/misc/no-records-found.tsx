import { BirdIcon } from "lucide-react";
import { t } from "i18next";

export const NoRecordsFound = (props: { text?: string }) => {
  const { text } = props;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-7 py-10 text-center">
      <BirdIcon className="size-7 text-ej-muted" />
      <div className="text-xs text-ej-muted">{text || t("noRecordsFound")}</div>
    </div>
  );
};
