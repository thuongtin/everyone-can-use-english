import { useContext, useEffect } from "react";
import { DbProviderContext } from "@renderer/context";
import { CheckCircle2Icon, LoaderIcon, AlertCircleIcon } from "lucide-react";
import { ResetAllButton } from "@renderer/components";
import { EjButton } from "@renderer/components/enjoy";
import { t } from "i18next";

export const DbState = () => {
  const db = useContext(DbProviderContext);

  if (db.state === "connected") {
    return (
      <div>
        <div className="mb-2 flex justify-center">
          <CheckCircle2Icon className="size-24 text-ej-ok" />
        </div>
        <p className="select-text break-all text-xxs text-ej-muted">
          {db.path}
        </p>
      </div>
    );
  }

  if (db.state === "error") {
    return (
      <div>
        <div className="mb-2 flex justify-center">
          <AlertCircleIcon className="size-24 text-ej-bad" />
        </div>
        <div className="mb-4 text-center">
          <ResetAllButton>
            <EjButton variant="primary">{t("resetAll")}</EjButton>
          </ResetAllButton>
        </div>
        <p className="select-text break-words text-xxs text-ej-muted">
          {db.error}
        </p>
      </div>
    );
  }

  return (
    <div className="flex justify-center">
      <LoaderIcon className="size-6 animate-spin text-ej-muted" />
    </div>
  );
};
