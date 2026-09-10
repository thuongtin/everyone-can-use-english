import { Readability } from "@mozilla/readability";
import { useContext, useEffect, useState } from "react";
import {
  DocumentToolbar,
  LoaderSpin,
  MarkdownWrapper,
} from "@renderer/components";
import Turndown from "turndown";
import {
  AppSettingsProviderContext,
  DocumentProviderContext,
} from "@/renderer/context";

export const DocumentHtmlRenderer = () => {
  const { document, onSpeech, onSegmentVisible, content, setContent } =
    useContext(DocumentProviderContext);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const [title, setTitle] = useState<string>("");

  const fetchContent = async () => {
    const res = await fetch(document.src);
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, "text/html");
    setTitle(doc.title || document.title);
    const readability = new Readability(doc);
    const article = readability.parse();
    const markdownContent = new Turndown().turndown(article.content);
    setContent(markdownContent);
  };

  useEffect(() => {
    fetchContent();
  }, [document.src]);

  useEffect(() => {
    if (!title) return;

    if (document.title !== title) {
      EnjoyApp.documents.update(document.id, {
        title,
      });
    }
  }, [title]);

  if (!content) return <LoaderSpin />;

  return (
    <div className="select-text relative">
      <DocumentToolbar title={title} />

      <MarkdownWrapper
        className="mx-auto max-w-full document-renderer"
        autoTranslate={document.config.autoTranslate}
        onSpeech={onSpeech}
        onSegmentVisible={onSegmentVisible}
        translatable={true}
      >
        {content}
      </MarkdownWrapper>
    </div>
  );
};
