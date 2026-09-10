import { useContext, useEffect } from "react";
import {
  DocumentToolbar,
  LoaderSpin,
  MarkdownWrapper,
} from "@renderer/components";
import { DocumentProviderContext } from "@renderer/context";

export const DocumentTextRenderer = () => {
  const { document, onSpeech, onSegmentVisible, content, setContent } =
    useContext(DocumentProviderContext);

  const fetchContent = async () => {
    const res = await fetch(document.src);
    const text = await res.text();
    setContent(text);
  };

  useEffect(() => {
    fetchContent();
  }, [document.src]);

  if (!content) return <LoaderSpin />;

  return (
    <div className="select-text relative">
      <DocumentToolbar />

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
