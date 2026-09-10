import { useContext, useEffect, useState } from "react";
import { t } from "i18next";
import {
  BookmarkIcon,
  BotIcon,
  CheckIcon,
  GaugeCircleIcon,
  LoaderIcon,
  Volume2Icon,
  XIcon,
} from "lucide-react";
import {
  AppSettingsProviderContext,
  MediaShadowProviderContext,
} from "@renderer/context";
import { ConversationShortcuts } from "@renderer/components";
import { toast } from "@renderer/components/ui";
import { useAiCommand } from "@renderer/hooks";
import { speakText } from "@renderer/lib/speak";
import { cn } from "@renderer/lib/utils";
import { scoreTone } from "./caption-words";

export type LookupAnchor = {
  /** Centre of the popover, in pixels from the left edge of the scroll pane. */
  left: number;
  /** Distance from the top of the scrolled content. */
  top: number;
  width: number;
  /** Caret offset inside the popover, so it points back at the word. */
  caret: number;
};

const TONE_TEXT: Record<string, string> = {
  ok: "text-ej-ok",
  warn: "text-ej-warn",
  bad: "text-ej-bad",
};

const SCORE_LABEL: Record<string, string> = {
  ok: "segment.pronunciationGood",
  warn: "segment.pronunciationWeak",
  bad: "segment.pronunciationBad",
};

const ActionButton = (props: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) => (
  <button
    type="button"
    onClick={props.onClick}
    disabled={props.disabled}
    className={cn(
      "inline-flex h-7 items-center gap-1.5 rounded-[9px] border border-ej-line bg-ej-surface px-2.5",
      "text-[11px] font-semibold text-ej-ink transition-colors duration-ej",
      "hover:bg-ej-surface2 disabled:cursor-not-allowed disabled:opacity-60",
      props.className
    )}
  >
    {props.children}
  </button>
);

/**
 * Anchored dictionary card. It replaces the inline lookup panel: the meaning
 * shows up right under the word that was clicked, and closes as soon as the
 * selection changes.
 */
export const MediaCaptionLookup = (props: {
  anchor: LookupAnchor;
  word: string;
  ipa?: string;
  isPhrase: boolean;
  score?: number;
  onClose: () => void;
}) => {
  const { anchor, word, ipa, isPhrase, score, onClose } = props;
  const { EnjoyApp, learningLanguage } = useContext(AppSettingsProviderContext);
  const { caption } = useContext(MediaShadowProviderContext);
  const { lookupWord } = useAiCommand();

  const [entries, setEntries] = useState<BilingualEntry[]>();
  const [saving, setSaving] = useState<boolean>(false);
  const [saved, setSaved] = useState<boolean>(false);

  const context = caption?.text ?? "";

  useEffect(() => {
    setSaved(false);
    setEntries(undefined);
    if (isPhrase || !word.trim()) return;

    let cancelled = false;
    EnjoyApp.bilingual.lookup("en-vi", word).then(
      (found: BilingualEntry[]) => {
        if (!cancelled) setEntries(found ?? []);
      },
      () => {
        if (!cancelled) setEntries([]);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [word, isPhrase]);

  const entry = entries?.[0];
  const meaning = entry?.senses
    ?.flatMap((sense) => sense.glosses)
    .filter(Boolean)
    .slice(0, 3)
    .join("; ");

  const handleSpeak = () => {
    if (!speakText(word, learningLanguage)) {
      toast.error(t("bilingual.noSpeechVoice"));
    }
  };

  const handleSave = () => {
    if (saving || saved) return;

    setSaving(true);
    lookupWord({ word, context })
      .then((lookup) => {
        if (!lookup?.meaning) throw new Error(t("lookupFailed"));
        setSaved(true);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setSaving(false));
  };

  const tone = typeof score === "number" ? scoreTone(score) : null;

  return (
    <div
      className="absolute z-[6] animate-rise"
      style={{
        left: anchor.left,
        top: anchor.top,
        width: anchor.width,
        boxSizing: "border-box",
        transform: "translateX(-50%)",
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="relative rounded-[14px] border border-ej-line bg-ej-surface px-3.5 py-3 shadow-ej">
        <span
          className="absolute size-[11px] rotate-45 border-l border-t border-ej-line bg-ej-surface"
          style={{ top: -6, left: anchor.caret }}
        />

        <div className="relative flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <span className="font-literata text-[20px] font-semibold leading-[1.3] text-ej-ink">
              {word}
            </span>
            {ipa && (
              <span className="ml-2 break-words font-ipa text-[13px] text-ej-muted">
                {ipa}
              </span>
            )}
          </div>

          <button
            type="button"
            aria-label={t("close")}
            onClick={onClose}
            className="-mr-1 -mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[7px] text-ej-muted transition-colors duration-ej hover:bg-ej-surface2 hover:text-ej-ink"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>

        {!isPhrase && entry?.pos && (
          <div className="mt-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ej-accent-ink">
            {t(`bilingual.pos.${entry.pos}`, { defaultValue: entry.pos })}
          </div>
        )}

        <p className="mt-1.5 select-text text-[12.5px] leading-[1.55] text-ej-ink2">
          {isPhrase
            ? t("wordLookup.phraseHint")
            : entries === undefined
              ? t("bilingual.loading")
              : meaning || t("wordLookup.notInDictionary")}
        </p>

        {!isPhrase && tone && (
          <div className="mt-2 flex items-center gap-1.5">
            <GaugeCircleIcon className={cn("size-[13px]", TONE_TEXT[tone])} />
            <span
              className={cn(
                "text-[11.5px] font-semibold ej-tabular",
                TONE_TEXT[tone]
              )}
            >
              {t("wordLookup.pronunciation", {
                score,
                label: t(SCORE_LABEL[tone]),
              })}
            </span>
          </div>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <ActionButton onClick={handleSpeak}>
            <Volume2Icon className="size-3 text-ej-accent" />
            {t("wordLookup.listen")}
          </ActionButton>

          <ActionButton onClick={handleSave} disabled={saving}>
            {saving ? (
              <LoaderIcon className="size-3 animate-spin" />
            ) : saved ? (
              <CheckIcon className="size-3 text-ej-ok" />
            ) : (
              <BookmarkIcon className="size-3" />
            )}
            {saved
              ? t("wordLookup.savedToVocabulary")
              : t("wordLookup.addToVocabulary")}
          </ActionButton>

          <ConversationShortcuts
            prompt={t("wordLookup.askAiPrompt", { word, sentence: context })}
            title={t("wordLookup.askAi")}
            trigger={
              <ActionButton>
                <BotIcon className="size-3" />
                {t("wordLookup.askAi")}
              </ActionButton>
            }
          />
        </div>
      </div>
    </div>
  );
};
