import { useContext } from "react";
import {
  AppSettingsProviderContext,
  DocumentProviderContext,
} from "@renderer/context";
import { DocumentActionsButton, DocumentConfigButton } from "@renderer/components";
import { EjIconButton, EjReaderFontSize } from "@renderer/components/enjoy";
import { toast } from "@renderer/components/ui";
import { t } from "i18next";
import { LanguagesIcon, LinkIcon } from "lucide-react";

/**
 * Sticky chapter bar shared by the text, html and epub renderers.
 * `leading` carries renderer specific controls (table of contents),
 * `trailing` the section pager.
 */
export const DocumentToolbar = (props: {
  title?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}) => {
  const { title, leading, trailing } = props;
  const { document } = useContext(DocumentProviderContext);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);

  if (!document) return null;

  const autoTranslate = Boolean(document.config?.autoTranslate);

  const toggleAutoTranslate = () => {
    EnjoyApp.documents
      .update(document.id, {
        config: { ...document.config, autoTranslate: !autoTranslate },
      })
      .catch((err) => toast.error(err.message));
  };

  return (
    <div className="sticky top-0 z-10 -mx-2 px-2 py-2 mb-2 bg-ej-bg/92 backdrop-blur-sm border-b border-ej-line flex items-center gap-2">
      <div className="flex items-center gap-1 shrink-0">
        {leading}
        <DocumentConfigButton document={document} />
        <DocumentActionsButton document={document} />
      </div>

      <div className="flex-1 min-w-0 text-center text-xs text-ej-muted truncate">
        {title || document.title}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <EjReaderFontSize />

        <EjIconButton
          title={t("autoTranslate")}
          active={autoTranslate}
          onClick={toggleAutoTranslate}
        >
          <LanguagesIcon className="size-4" />
        </EjIconButton>

        {document.metadata?.source && (
          <EjIconButton
            title={t("source")}
            onClick={() => EnjoyApp.shell.openExternal(document.metadata.source)}
          >
            <LinkIcon className="size-4" />
          </EjIconButton>
        )}

        {trailing}
      </div>
    </div>
  );
};
