import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  toast,
} from "@renderer/components/ui";
import { EjIconButton } from "@renderer/components/enjoy";
import { MoreVerticalIcon } from "lucide-react";
import { t } from "i18next";
import { useContext } from "react";
import {
  AppSettingsProviderContext,
  DocumentProviderContext,
} from "@renderer/context";
import template from "./document.template.html?raw";

export const DocumentActionsButton = (props: { document: DocumentEType }) => {
  const { document } = props;
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { ref, section } = useContext(DocumentProviderContext);

  const handlePrint = async () => {
    if (!ref.current) return;

    const content = template.replace("$title", document.title).replace(
      "$content",
      Array.from(ref.current.querySelectorAll(".segment, .translation"))
        .map((segment) => {
          const tagName = segment.tagName.toLowerCase();
          if (segment.classList.contains("translation")) {
            return `<${tagName}>${segment.textContent}</${tagName}>`;
          }
          return `<${tagName}>${
            segment.querySelector(".segment-content")?.textContent
          }</${tagName}>`;
        })
        .join("")
    );

    try {
      const savePath = await EnjoyApp.dialog.showSaveDialog({
        title: t("print"),
        defaultPath: `${document.title}(S${section}).pdf`,
      });

      if (!savePath) return;

      await EnjoyApp.download.printAsPdf(content, savePath);

      toast.success(t("downloadedSuccessfully"));
    } catch (err) {
      toast.error(`${t("downloadFailed")}: ${err.message}`);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <EjIconButton title={t("more")}>
          <MoreVerticalIcon className="size-4" />
        </EjIconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        align="start"
        className="rounded-ej-lg border-ej-line bg-ej-surface shadow-ej"
      >
        <DropdownMenuItem onClick={handlePrint}>{t("print")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
