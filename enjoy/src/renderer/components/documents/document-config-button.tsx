import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  toast,
} from "@renderer/components/ui";
import { EjIconButton } from "@renderer/components/enjoy";
import { SettingsIcon } from "lucide-react";
import { useContext, useState } from "react";
import { DocumentConfigForm } from "@renderer/components";
import { AppSettingsProviderContext } from "@/renderer/context";
import { t } from "i18next";

export const DocumentConfigButton = (props: { document: DocumentEType }) => {
  const { document } = props;
  const [configOpen, setConfigOpen] = useState(false);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);

  return (
    <Popover open={configOpen} onOpenChange={setConfigOpen}>
      <PopoverTrigger asChild>
        <EjIconButton title={t("settings.title")}>
          <SettingsIcon className="size-4" />
        </EjIconButton>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="rounded-ej-lg border-ej-line bg-ej-surface shadow-ej"
      >
        <DocumentConfigForm
          config={document.config}
          onSubmit={(data: any) => {
            return EnjoyApp.documents
              .update(document.id, {
                ...data,
              })
              .then(() => {
                toast.success(t("saved"));
                setConfigOpen(false);
              })
              .catch((err) => {
                toast.error(err.message);
              });
          }}
        />
      </PopoverContent>
    </Popover>
  );
};
