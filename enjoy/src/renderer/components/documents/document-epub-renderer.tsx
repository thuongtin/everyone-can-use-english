import { useCallback, useContext, useEffect, useState } from "react";
import {
  DocumentToolbar,
  LoaderSpin,
  MarkdownWrapper,
} from "@renderer/components";
import { makeBook } from "foliate-js/view.js";
import { EPUB } from "foliate-js/epub.js";
import { blobToDataUrl, cn } from "@renderer/lib/utils";
import Turndown from "turndown";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  toast,
} from "@renderer/components/ui";
import { EjIconButton } from "@renderer/components/enjoy";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  TableOfContentsIcon,
} from "lucide-react";
import { t } from "i18next";
import {
  AppSettingsProviderContext,
  DocumentProviderContext,
} from "@renderer/context";

export const DocumentEpubRenderer = () => {
  const {
    ref,
    document,
    onSpeech,
    section,
    setSection,
    onSegmentVisible,
    content,
    setContent,
  } = useContext(DocumentProviderContext);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);

  const [book, setBook] = useState<typeof EPUB>();
  const [title, setTitle] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [tocOpen, setTocOpen] = useState<boolean>(false);

  const refreshBookMetadata = () => {
    if (!book) return;

    if (document.title !== book.metadata.title) {
      EnjoyApp.documents.update(document.id, {
        title: book.metadata.title,
        language: book.metadata.language,
      });
    }
  };

  const renderCurrentSection = async () => {
    setLoading(true);

    try {
      const sectionDoc = await book.sections[section].createDocument();
      const tocItem = book.toc.find((item: any) => item.href === sectionDoc.id);
      setTitle(tocItem?.label || sectionDoc.title);

      for (const img of sectionDoc.body.querySelectorAll("img")) {
        let image: any;
        if (img.src) {
          image = book.resources.manifest.find((resource: any) =>
            resource.href.endsWith(new URL(img.src).pathname)
          );
        } else if (img.id) {
          image = book.resources.manifest.find(
            (resource: any) => resource.id === img.id
          );
        }
        if (!image) continue;

        const blob = new Blob([await book.loadBlob(image.href)], {
          type: image.mediaType,
        });
        const url = await blobToDataUrl(blob);
        img.setAttribute("src", url);
      }

      const markdownContent = new Turndown().turndown(
        sectionDoc.body.innerHTML
      );
      setContent(markdownContent);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePrevSection = () => {
    if (section === 0) return;
    if (!book) return;

    setSection(section - 1);
  };

  const handleNextSection = () => {
    if (section === book.sections.length - 1) return;
    if (!book) return;

    setSection(section + 1);
  };

  const handleSectionClick = useCallback(
    (id: string) => {
      const sec = book.sections.findIndex((sec: any) => sec.id.endsWith(id));
      if (sec === -1) return;

      setSection(sec);
      setTocOpen(false);
    },
    [book]
  );

  const handleLinkClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      handleSectionClick(new URL(e.currentTarget.href).pathname);
      e.currentTarget.blur();
    },
    [handleSectionClick]
  );

  useEffect(() => {
    makeBook(document.src).then((epub: typeof EPUB) => {
      setBook(epub);
      setLoading(false);
    });
  }, [document?.src]);

  useEffect(() => {
    if (!book) return;

    refreshBookMetadata();
    renderCurrentSection();
  }, [book, section]);

  if (!book) return <LoaderSpin />;

  return (
    <div className="select-text relative">
      <DocumentToolbar
        title={title}
        leading={
          <Sheet open={tocOpen} onOpenChange={setTocOpen}>
            <SheetTrigger asChild>
              <EjIconButton title={t("tableOfContents")}>
                <TableOfContentsIcon className="size-4" />
              </EjIconButton>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-[300px] sm:max-w-[300px] p-0 border-r border-ej-line bg-ej-side flex flex-col"
            >
              <SheetHeader className="shrink-0 px-4 py-3 border-b border-ej-line space-y-0">
                <SheetTitle className="ej-label text-left">
                  {t("tableOfContents")}
                </SheetTitle>
              </SheetHeader>
              <div className="flex-1 min-h-0 overflow-y-auto scroll py-2">
                {(book?.toc as any[]).map((item: any) => (
                  <div key={item.href}>
                    <TocItem
                      label={item.label}
                      onClick={() => handleSectionClick(item.href)}
                    />
                    {(item.subitems || []).map((subitem: any) => (
                      <TocItem
                        key={subitem.href}
                        label={subitem.label}
                        nested
                        onClick={() => handleSectionClick(subitem.href)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        }
        trailing={
          <>
            <EjIconButton
              title={t("previousSection")}
              disabled={section === 0}
              onClick={handlePrevSection}
            >
              <ChevronLeftIcon className="size-4" />
            </EjIconButton>
            <EjIconButton
              title={t("nextSection")}
              disabled={section >= book.sections.length - 1}
              onClick={handleNextSection}
            >
              <ChevronRightIcon className="size-4" />
            </EjIconButton>
          </>
        }
      />

      <div id="start-anchor" />
      {loading ? (
        <LoaderSpin />
      ) : (
        <MarkdownWrapper
          className="mx-auto max-w-full document-renderer"
          onLinkClick={handleLinkClick}
          onSegmentVisible={onSegmentVisible}
          autoTranslate={document.config.autoTranslate}
          onSpeech={onSpeech}
          translatable={true}
          section={section}
        >
          {content}
        </MarkdownWrapper>
      )}
    </div>
  );
};

const TocItem = (props: {
  label: string;
  nested?: boolean;
  onClick: () => void;
}) => {
  const { label, nested, onClick } = props;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-1.5 text-xs leading-[1.5] rounded-none",
        "hover:bg-ej-surface2 transition-colors duration-ej",
        nested ? "pl-7 text-ej-muted" : "text-ej-ink"
      )}
    >
      {label}
    </button>
  );
};
