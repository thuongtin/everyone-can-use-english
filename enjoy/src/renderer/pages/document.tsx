import {
  DocumentHtmlRenderer,
  DocumentEpubRenderer,
  DocumentPlayer,
  LoaderSpin,
  DocumentTextRenderer,
} from "@renderer/components";
import { EjIconButton, EjReader, Pill } from "@renderer/components/enjoy";
import { useContext, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DocumentProvider, DocumentProviderContext } from "@renderer/context";
import { t } from "i18next";
import {
  ChevronRightIcon,
  Maximize2Icon,
  Minimize2Icon,
  XIcon,
} from "lucide-react";

export default () => {
  const { id } = useParams<{ id: string }>();

  return (
    <DocumentProvider documentId={id}>
      <DocumentComponent />
    </DocumentProvider>
  );
};

const DocumentComponent = () => {
  const { document, playingSegment, togglePlayingSegment } = useContext(
    DocumentProviderContext
  );
  const [expanded, setExpanded] = useState(false);

  if (!document) {
    return (
      <div className="h-content flex flex-col justify-center items-center relative">
        <LoaderSpin />
      </div>
    );
  }

  const extension = document.metadata?.extension;

  return (
    <div className="h-content flex flex-col relative bg-ej-bg">
      <header className="shrink-0 border-b border-ej-line bg-ej-surface px-5 py-2.5 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-xxs text-ej-muted mb-0.5">
            <Link
              to="/documents"
              className="hover:text-ej-accent transition-colors duration-ej"
            >
              {t("sidebar.documents")}
            </Link>
            <ChevronRightIcon className="size-3 shrink-0" />
            <span className="truncate">{t("reading")}</span>
          </div>

          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-[15px] font-bold text-ej-ink truncate">
              {document.title}
            </h1>

            <div className="flex items-center gap-1.5 shrink-0">
              {extension && <Pill className="uppercase">{extension}</Pill>}
              {document.language && (
                <Pill className="uppercase">{document.language}</Pill>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        <main className="flex-1 min-w-0 min-h-0 overflow-y-auto scroll">
          <EjReader className="mx-auto w-full max-w-[760px] fluid:max-w-[820px] px-5 pb-28">
            {extension === "html" && <DocumentHtmlRenderer />}
            {extension === "epub" && <DocumentEpubRenderer />}
            {["txt", "md", "markdown"].includes(extension) && (
              <DocumentTextRenderer />
            )}
          </EjReader>
        </main>

        {playingSegment && (
          <aside className="hidden fluid:flex flex-col w-[380px] shrink-0 border-l border-ej-line bg-ej-side">
            <div className="shrink-0 h-9 px-3 flex items-center gap-2 border-b border-ej-line">
              <span className="ej-label">{t("player")}</span>
              <EjIconButton
                className="ml-auto"
                title={t("close")}
                onClick={() => togglePlayingSegment(null)}
              >
                <XIcon className="size-4" />
              </EjIconButton>
            </div>
            <div className="flex-1 min-h-0 p-3">
              <DocumentPlayer />
            </div>
          </aside>
        )}
      </div>

      {playingSegment && (
        <div
          className="fluid:hidden absolute z-20 left-1/2 -translate-x-1/2 bottom-4 w-[720px] max-w-[calc(100%-32px)] rounded-ej-lg border border-ej-line bg-ej-surface shadow-ej flex flex-col overflow-hidden"
          style={{ height: expanded ? "calc(100% - 78px)" : 220 }}
        >
          <div className="shrink-0 h-9 px-3 flex items-center gap-2 border-b border-ej-line">
            <span className="ej-label">{t("player")}</span>
            <div className="ml-auto flex items-center gap-1">
              <EjIconButton
                title={expanded ? t("collapse") : t("expand")}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? (
                  <Minimize2Icon className="size-4" />
                ) : (
                  <Maximize2Icon className="size-4" />
                )}
              </EjIconButton>
              <EjIconButton
                title={t("close")}
                onClick={() => togglePlayingSegment(null)}
              >
                <XIcon className="size-4" />
              </EjIconButton>
            </div>
          </div>
          <div className="flex-1 min-h-0 p-3">
            <DocumentPlayer />
          </div>
        </div>
      )}
    </div>
  );
};
