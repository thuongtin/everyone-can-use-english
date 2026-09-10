import { useContext, useEffect, useState } from "react";
import { t } from "i18next";
import { LoaderIcon, SparklesIcon } from "lucide-react";
import { md5 } from "js-md5";
import {
  AISettingsProviderContext,
  AppSettingsProviderContext,
} from "@renderer/context";
import { toast } from "@renderer/components/ui";
import { useAiCommand } from "@renderer/hooks";

const formatDay = (date: Date) =>
  `${String(date.getDate()).padStart(2, "0")}/${String(
    date.getMonth() + 1
  ).padStart(2, "0")}`;

/**
 * Translation pane of the sentence. The result is cached per sentence, so
 * moving back and forth never spends another AI call.
 */
export function MediaCaptionTranslation(props: {
  text: string;
  onTranslationChange?: (translation?: string) => void;
}) {
  const { text, onTranslationChange } = props;
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { currentGptEngine } = useContext(AISettingsProviderContext);
  const { translate } = useAiCommand();

  const [translation, setTranslation] = useState<string>();
  const [translating, setTranslating] = useState<boolean>(false);
  const [translatedAt, setTranslatedAt] = useState<Date>();

  const handleTranslate = () => {
    if (translating || !text) return;

    setTranslating(true);
    translate(text, `translate-${md5(text)}`)
      .then((result) => {
        if (!result) return;
        setTranslation(result);
        setTranslatedAt(new Date());
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setTranslating(false));
  };

  useEffect(() => {
    if (!text) return;

    setTranslatedAt(undefined);
    EnjoyApp.cacheObjects.get(`translate-${md5(text)}`).then((cached) => {
      setTranslation(cached || undefined);
    });
  }, [text]);

  useEffect(() => {
    onTranslationChange?.(translation);
  }, [translation]);

  if (!translation) {
    return (
      <button
        type="button"
        disabled={translating}
        onClick={handleTranslate}
        className="inline-flex h-[34px] items-center gap-2 rounded-[10px] border border-ej-line bg-ej-surface px-3 text-xs font-semibold text-ej-ink transition-colors duration-ej hover:bg-ej-surface2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {translating ? (
          <LoaderIcon className="size-3.5 animate-spin" />
        ) : (
          <SparklesIcon className="size-3.5 text-ej-accent" />
        )}
        {translating ? t("translating") : t("aiTranslate")}
      </button>
    );
  }

  return (
    <div>
      <p className="select-text text-[14.5px] leading-[1.65] text-ej-ink">
        {translation}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-ej-muted">
        <span>
          {currentGptEngine?.name || t("aiAssistant")}
          {translatedAt ? ` · ${formatDay(translatedAt)}` : ""}
        </span>
        <button
          type="button"
          disabled={translating}
          onClick={handleTranslate}
          className="font-semibold text-ej-accent transition-opacity duration-ej hover:opacity-80 disabled:opacity-50"
        >
          {translating ? t("translating") : t("reTranslate")}
        </button>
      </div>
    </div>
  );
}
