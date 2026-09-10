import { useEffect, useContext, useRef, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { AppSettingsProviderContext } from "@renderer/context";
import { ChevronLeftIcon, ExternalLinkIcon } from "lucide-react";
import { EjIconButton, EjReader, EjReaderFontSize } from "@renderer/components/enjoy";
import uniq from "lodash/uniq";
import Mark from "mark.js";
import { Vocabulary } from "@renderer/components";
import { t } from "i18next";
import type {
  LocalMeaning,
  LocalStudyLookup,
} from "../../../types/local-study-api";
import { displayableResourceUrl } from "@renderer/lib/retired-resource";

export const StoryViewer = (props: {
  story: {
    id?: string;
    title?: string;
    content?: string;
    url?: string;
    metadata?: Record<string, string>;
  };
  marked?: boolean;
  meanings?: LocalMeaning[];
  setMeanings: (meanings: LocalMeaning[]) => void;
  pendingLookups?: Partial<LocalStudyLookup>[];
  doc: any;
  actions?: React.ReactNode;
}) => {
  const navigate = useNavigate();
  const {
    story,
    marked,
    meanings = [],
    pendingLookups = [],
    doc,
    actions,
  } = props;
  if (!story || !doc) return null;
  const faviconUrl = displayableResourceUrl(story.metadata?.favicon);

  const paragraphs: { terms: any[]; text: string }[][] = doc
    .paragraphs()
    .json();
  const { EnjoyApp } = useContext(AppSettingsProviderContext);

  const ref = useRef<HTMLDivElement>();

  useEffect(() => {
    const marker = new Mark(ref.current);
    if (marked) {
      const words = uniq([
        ...meanings.map((m) => m.word),
        ...pendingLookups.map((l) => l.word),
      ]);
      if (words.length === 0) return;
      marker.mark(words, {
        separateWordSearch: false,
        caseSensitive: false,
        acrossElements: true,
      });
    } else {
      marker.unmark();
    }

    return () => {
      marker.unmark();
    };
  }, [meanings, pendingLookups, marked]);

  return (
    <EjReader>
      <div className="sticky top-0 z-30 border-b border-ej-line bg-ej-surface/95 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-[760px] fluid:max-w-[820px] px-4 py-2 flex items-center gap-2">
          <EjIconButton
            title={t("back")}
            onClick={() => {
              if (story.id) {
                navigate("/stories");
              } else {
                navigate(-1);
              }
            }}
          >
            <ChevronLeftIcon className="size-4" />
          </EjIconButton>

          <div className="flex-1 min-w-0 text-xs text-ej-muted truncate">
            {story.title}
          </div>

          <div className="shrink-0 flex items-center gap-1">
            <EjReaderFontSize />
            {actions}
            {story.url && (
              <EjIconButton
                title={t("source")}
                onClick={() => EnjoyApp.shell.openExternal(story.url)}
              >
                {faviconUrl ? (
                  <img src={faviconUrl} className="size-4" />
                ) : (
                  <ExternalLinkIcon className="size-4" />
                )}
              </EjIconButton>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[760px] fluid:max-w-[820px] px-5 py-7">
        <article
          ref={ref}
          className="ej-prose select-text"
          data-source-type="Story"
          data-source-id={story.id}
        >
          <h1>{story.title}</h1>

          {paragraphs.map((sentences, i: number) => (
            <p key={`paragraph-${i}`}>
              {sentences.map((sentence, j: number) => {
                if (sentence.text.match(/!\[\]\(\S+\)/g)) {
                  const [img] = sentence.text.match(/!\[\]\(\S+\)/g);
                  const src = displayableResourceUrl(
                    img.replace(/!\[\]\(/g, "").replace(/\)/g, "")
                  );
                  if (!src) return null;
                  return <img key={`paragraph-${i}-sentence-${j}`} src={src} />;
                }

                return (
                  <span
                    className="sentence select-auto whitespace-normal"
                    key={`paragraph-${i}-sentence-${j}`}
                  >
                    {sentence.terms.map((term, k: number) => (
                      <Fragment key={`term-${i}-${j}-${k}`}>
                        {term.pre}
                        <Vocabulary word={term.text} context={sentence.text} />
                        {term.post}
                      </Fragment>
                    ))}
                  </span>
                );
              })}
            </p>
          ))}
        </article>
      </div>
    </EjReader>
  );
};
