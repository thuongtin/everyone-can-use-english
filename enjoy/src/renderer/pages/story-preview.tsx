import { Button, toast } from "@renderer/components/ui";
import { EjIconButton } from "@renderer/components/enjoy";
import {
  LoaderSpin,
  StoryViewer,
  StoryPreviewToolbar,
} from "@renderer/components";
import { useState, useContext, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppSettingsProviderContext } from "@renderer/context";
import { Readability } from "@mozilla/readability";
import { convert } from "html-to-text";
import { ChevronLeftIcon, BookOpenTextIcon } from "lucide-react";
import { t } from "i18next";
import nlp from "compromise";
import paragraphs from "compromise-paragraphs";
import { useDebounce } from "@uidotdev/usehooks";
import { type IpcRendererEvent } from "electron";
import type {
  LocalMeaning,
  LocalStoryCreateInput,
} from "../../types/local-study-api";
import { isRetiredEnjoyUrl } from "../../lib/network-policy";
nlp.plugin(paragraphs);

export default () => {
  const navigate = useNavigate();
  const { uri } = useParams<{ uri: string }>();
  const containerRef = useRef<HTMLDivElement>();
  const [url] = useState(decodeURIComponent(uri));
  const [error, setError] = useState<string>();
  const [story, setStory] = useState<Partial<LocalStoryCreateInput>>({
    url,
  });
  const [loading, setLoading] = useState(true);
  const [readable, setReadable] = useState(true);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const [meanings, setMeanings] = useState<LocalMeaning[]>([]);
  const [marked, setMarked] = useState<boolean>(false);
  const [doc, setDoc] = useState<any>(null);

  const [webviewRect, setWebviewRect] = useState<DOMRect | null>(null);
  const debouncedWebviewRect = useDebounce(webviewRect, 500);

  const loadURL = () => {
    setError(null);
    setLoading(true);
    setStory({ url });

    if (isRetiredEnjoyUrl(url)) {
      setError(t("notFound"));
      setLoading(false);
      return;
    }

    const { x, y, width, height } = debouncedWebviewRect;
    EnjoyApp.view.load(url, {
      x,
      y,
      width,
      height,
    });
  };

  const createStory = async () => {
    if (!story?.title || !story.content) return;

    EnjoyApp.localStudy.stories
      .create({
        ...story,
        url: story.metadata?.url || story.url || "",
        provenance: {
          source: story.url?.startsWith("file:") ? "file" : "website",
          sourceUrl: story.url,
        },
      } as LocalStoryCreateInput)
      .then((story) => {
        navigate(`/stories/${story.id}`);
      })
      .catch((error) => toast.error(error.message));
  };

  const onViewState = async (event: {
    state: string;
    error?: string;
    url?: string;
    html?: string;
  }) => {
    const { state, error, html } = event;

    if (state == "did-fail-load") {
      setLoading(false);
      if (error) {
        toast.error(error);
        setError(error);
      }

      return;
    }
    if (state !== "did-finish-load") return;
    if (!html) return;

    const doc = new DOMParser().parseFromString(html, "text/html");
    const reader = new Readability(doc);
    const parsed = reader.parse();
    const fallbackContent = doc.body?.textContent?.trim() || "";
    const article = parsed || (fallbackContent
      ? {
          title: doc.title || decodeURIComponent(url.split("/").pop() || "Document"),
          content: doc.body?.innerHTML || fallbackContent,
          excerpt: fallbackContent.slice(0, 240),
          byline: "",
        }
      : null);

    if (!article) {
      setLoading(false);
      setReadable(false);
      return;
    }

    const content = convert(article.content, {
      wordwrap: false,
      selectors: [
        {
          selector: "a",
          options: {
            hideLinkHrefIfSameAsText: true,
            ignoreHref: true,
          },
        },
        {
          selector: "img",
          options: {
            linkBrackets: ["![](", ")"],
          },
        },
      ],
    });

    let favicon =
      doc.querySelector('link[rel="icon"]')?.getAttribute("href") || "";
    if (favicon.startsWith("/")) {
      favicon = new URL(favicon, new URL(url).origin).href;
    }

    const ogUrl =
      doc.querySelector('meta[property="og:url"]')?.getAttribute("content") ||
      "";

    const metadata = {
      url: ogUrl || url,
      title: article.title || "Document",
      description:
        doc
          .querySelector('meta[name="description"]')
          ?.getAttribute("content") || article.excerpt || "",
      byline: article.byline || "",
      image:
        doc
          .querySelector('meta[property="og:image"]')
          ?.getAttribute("content") || "",
      favicon,
    };

    doc.querySelectorAll("script, style, iframe").forEach((tag) => {
      tag.remove();
    });

    setStory({
      title: article.title || "Document",
      content,
      html,
      metadata,
      url,
    });

    const _doc = nlp(content);
    _doc.cache();
    setDoc(_doc);

    setLoading(false);
  };

  const onWindowChange = (
    event: IpcRendererEvent,
    state: { event: string }
  ) => {
    if (state.event === "resize") {
      setWebviewRect(containerRef.current.getBoundingClientRect());
    }
  };

  useEffect(() => {
    if (!containerRef?.current) return;
    if (!url) return;
    if (!debouncedWebviewRect) return;

    loadURL();
    EnjoyApp.view.onViewState((_event, state) => onViewState(state));

    return () => {
      EnjoyApp.view.removeViewStateListeners();
      EnjoyApp.view.remove();
    };
  }, [url, containerRef, debouncedWebviewRect]);

  useEffect(() => {
    if (!containerRef?.current) return;

    setWebviewRect(containerRef.current.getBoundingClientRect());
    EnjoyApp.window.onChange((_event, state) => onWindowChange(_event, state));

    return () => {
      EnjoyApp.window.removeListener(onWindowChange);
    };
  }, [containerRef?.current]);

  useEffect(() => {
    if (readable) {
      EnjoyApp.view.hide().catch(console.error);
    } else if (!loading) {
      if (!containerRef?.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      EnjoyApp.view.show({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
    }
  }, [readable, loading]);

  return (
    <div className="h-content w-full flex flex-col bg-ej-bg">
      {(loading || !readable) && (
        <div className="shrink-0 h-12 flex items-center gap-2 px-4 border-b border-ej-line bg-ej-surface">
          <EjIconButton title={t("back")} onClick={() => navigate(-1)}>
            <ChevronLeftIcon className="size-4" />
          </EjIconButton>

          <div className="flex-1 min-w-0 h-8 px-3 flex items-center rounded-full border border-ej-line bg-ej-surface2 text-xs text-ej-muted truncate">
            {url}
          </div>

          <EjIconButton
            title={t("toggleReadable")}
            active={readable}
            onClick={() => setReadable(!readable)}
          >
            <BookOpenTextIcon className="size-4" />
          </EjIconButton>
        </div>
      )}

      <div
        ref={containerRef}
        className="flex-1 min-h-0 relative overflow-y-auto scroll"
      >
        {loading ? (
          <div className="h-96 w-full">
            <LoaderSpin />
          </div>
        ) : error ? (
          <div className="w-full min-h-[50vh] flex items-center justify-center">
            <div className="m-auto text-center">
              <div className="mb-6 text-sm text-ej-muted">{error}</div>
              <div className="flex justify-center">
                <Button onClick={loadURL}>{t("retry")}</Button>
              </div>
            </div>
          </div>
        ) : (
          story?.content &&
          readable && (
            <StoryViewer
              story={story}
              meanings={meanings}
              setMeanings={setMeanings}
              marked={marked}
              doc={doc}
              actions={
                <StoryPreviewToolbar
                  marked={marked}
                  toggleMarked={() => setMarked(!marked)}
                  onCreateStory={createStory}
                  readable={readable}
                  onToggleReadable={() => setReadable(!readable)}
                />
              }
            />
          )
        )}
      </div>
    </div>
  );
};
