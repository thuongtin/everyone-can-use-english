import { useContext, useEffect, useRef, useState } from "react";
import { t } from "i18next";
import { LoaderIcon, SparklesIcon } from "lucide-react";
import {
  AISettingsProviderContext,
  AppSettingsProviderContext,
} from "@renderer/context";
import { toast } from "@renderer/components/ui";
import { useAiCommand } from "@renderer/hooks";
import Markdown from "react-markdown";

/** Bullets the AI produced, used for the collapsed summary of the section. */
export const countAnalysisPoints = (analysis?: string) => {
  if (!analysis) return 0;

  const bullets = analysis.match(/^\s*(?:[-*+]|\d+\.)\s+/gm);
  if (bullets?.length) return bullets.length;

  return analysis.split(/\n{2,}/).filter((block) => block.trim()).length;
};

/**
 * Grammar and usage breakdown of the sentence. The result is cached per
 * sentence, same as the translation.
 */
export function MediaCaptionAnalysis(props: {
  text: string;
  onAnalysisChange?: (analysis?: string) => void;
}) {
  const { text, onAnalysisChange } = props;
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { currentGptEngine } = useContext(AISettingsProviderContext);
  const { analyzeText, analysisCacheKey } = useAiCommand();
  const cacheKey = analysisCacheKey(text);
  const activeKey = useRef(cacheKey);
  activeKey.current = cacheKey;

  const [analysis, setAnalysis] = useState<string>();
  const [analyzing, setAnalyzing] = useState<boolean>(false);

  const handleAnalyze = () => {
    if (analyzing || !text) return;

    setAnalyzing(true);
    analyzeText(text)
      .then((result) => {
        if (result && activeKey.current === cacheKey) setAnalysis(result);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setAnalyzing(false));
  };

  useEffect(() => {
    let active = true;
    setAnalysis(undefined);
    if (text) EnjoyApp.cacheObjects.get(cacheKey).then((cached) => {
      if (active) setAnalysis(cached || undefined);
    });
    return () => { active = false; };
  }, [cacheKey]);

  useEffect(() => {
    onAnalysisChange?.(analysis);
  }, [analysis]);

  if (!analysis) {
    return (
      <button
        type="button"
        disabled={analyzing}
        onClick={handleAnalyze}
        className="inline-flex h-[34px] items-center gap-2 rounded-[10px] border border-ej-line bg-ej-surface px-3 text-xs font-semibold text-ej-ink transition-colors duration-ej hover:bg-ej-surface2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {analyzing ? (
          <LoaderIcon className="size-3.5 animate-spin" />
        ) : (
          <SparklesIcon className="size-3.5 text-ej-accent" />
        )}
        {analyzing ? t("analyzing") : t("analyzeAiModel")}
      </button>
    );
  }

  return (
    <div>
      <Markdown
        className="select-text text-[12.5px] leading-[1.55] text-ej-ink2"
        components={{
          ul({ children }) {
            return <ul className="flex flex-col gap-2">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="flex flex-col gap-2">{children}</ol>;
          },
          li({ children }) {
            return (
              <li className="flex gap-2">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-ej-accent" />
                <span className="min-w-0 flex-1">{children}</span>
              </li>
            );
          },
          p({ children }) {
            return <p className="mb-2 last:mb-0">{children}</p>;
          },
          strong({ children }) {
            return (
              <strong className="font-semibold text-ej-ink">{children}</strong>
            );
          },
          a({ node, children, ...rest }) {
            try {
              new URL(rest.href ?? "");
              rest.target = "_blank";
              rest.rel = "noopener noreferrer";
            } catch (e) {}

            return (
              <a className="text-ej-accent underline" {...rest}>
                {children}
              </a>
            );
          },
        }}
      >
        {analysis}
      </Markdown>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-ej-muted">
        <span>{currentGptEngine?.name || t("aiAssistant")}</span>
        <button
          type="button"
          disabled={analyzing}
          onClick={handleAnalyze}
          className="font-semibold text-ej-accent transition-opacity duration-ej hover:opacity-80 disabled:opacity-50"
        >
          {analyzing ? t("analyzing") : t("reAnalyze")}
        </button>
      </div>
    </div>
  );
}
