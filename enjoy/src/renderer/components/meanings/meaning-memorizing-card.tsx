import { t } from "i18next";
import { Volume2Icon } from "lucide-react";
import { toast } from "@renderer/components/ui";
import { speakText } from "@renderer/lib/speak";
import { cn } from "@renderer/lib/utils";
import type { LocalMeaning } from "../../../types/local-study-api";

export type MemorizingStatus = "new" | "learning" | "known";

export const MEMORIZING_STATUS_DOT: Record<MemorizingStatus, string> = {
  new: "bg-ej-accent",
  learning: "bg-ej-warn",
  known: "bg-ej-ok",
};

const STATUS_TEXT: Record<MemorizingStatus, string> = {
  new: "text-ej-accent",
  learning: "text-ej-warn",
  known: "text-ej-ok",
};

const statusLabel = (status: MemorizingStatus) =>
  t(`vocabulary.status.${status}`);

/**
 * Splits a sentence around the studied word so it can be highlighted on the
 * back of the card and blanked out on the front.
 */
const splitAroundWord = (sentence: string, word: string) => {
  const escaped = word.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  const pattern = new RegExp(`(${escaped}(?:s|es|ed|ing)?)`, "i");

  return sentence
    .split(pattern)
    .filter(Boolean)
    .map((part) => ({ text: part, hit: pattern.test(part) }));
};

/** Alternative Vietnamese renderings, shown as "near meaning" chips. */
const nearMeanings = (translation?: string) => {
  if (!translation) return [];

  return translation
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter((part) => part && part.length <= 32)
    .slice(1, 5);
};

const SpeakWordButton = (props: { word: string }) => (
  <button
    type="button"
    title={t("vocabulary.listen")}
    aria-label={t("vocabulary.listen")}
    onClick={(event) => {
      event.stopPropagation();
      if (!speakText(props.word, "en-US")) {
        toast.error(t("bilingual.noSpeechVoice"));
      }
    }}
    className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-ej-line bg-ej-surface text-ej-accent transition-colors duration-ej hover:bg-ej-accent-soft"
  >
    <Volume2Icon className="size-3.5" />
  </button>
);

/**
 * Flashcard for one saved word. The page owns which side is showing so the
 * arrows and hotkeys can reset it when the card changes.
 */
export const MeaningMemorizingCard = (props: {
  meaning: LocalMeaning;
  status: MemorizingStatus;
  side: "front" | "back";
  onFlip: () => void;
}) => {
  const { meaning, status, side, onFlip } = props;
  const { word, lemma, pronunciation, pos, definition, translation, lookups } =
    meaning;

  const context = lookups?.find((lookup) => lookup.context)?.context;
  const contextTranslation = lookups?.find(
    (lookup) => lookup.contextTranslation
  )?.contextTranslation;
  const ipa = pronunciation ? `/${pronunciation.replaceAll("/", "")}/` : "";
  const synonyms = nearMeanings(translation);

  return (
    <div
      key={`${meaning.id}-${side}`}
      role="button"
      tabIndex={0}
      onClick={onFlip}
      onKeyDown={(event) => {
        if (event.key === "Enter") onFlip();
      }}
      className={cn(
        "flex min-h-[400px] flex-1 animate-flip-in cursor-pointer flex-col rounded-[20px] border border-ej-line bg-ej-surface px-7 py-6 shadow-ej",
        "fluid:min-h-[440px]"
      )}
    >
      <div className="flex items-center justify-between gap-2.5">
        <span className="ej-label">
          {side === "front"
            ? [t("vocabulary.wordSide"), pos].filter(Boolean).join(" · ")
            : t("vocabulary.meaningSide")}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-[11.5px] font-semibold",
            STATUS_TEXT[status]
          )}
        >
          <span
            className={cn(
              "size-[7px] rounded-full",
              MEMORIZING_STATUS_DOT[status]
            )}
          />
          {statusLabel(status)}
        </span>
      </div>

      {side === "front" ? (
        <>
          <div className="flex flex-1 select-text flex-col items-center justify-center gap-3 py-5 text-center">
            <div className="font-literata text-[44px] font-semibold leading-[1.1] tracking-[-0.01em] text-ej-ink">
              {word}
            </div>

            <div className="flex items-center gap-2.5">
              {ipa && (
                <span className="font-ipa text-lg text-ej-muted">{ipa}</span>
              )}
              <SpeakWordButton word={word} />
            </div>

            {pos && (
              <div className="ej-label rounded-[5px] bg-ej-surface2 px-2 py-[3px] text-ej-ink2">
                {pos}
              </div>
            )}

            {context && (
              <p className="mt-2 max-w-[520px] font-literata text-[15px] leading-relaxed text-ej-ink2">
                {splitAroundWord(context, word).map((part, index) =>
                  part.hit ? (
                    <span
                      key={index}
                      className="rounded bg-ej-hl px-[3px] tracking-[0.1em] text-ej-hl-ink"
                    >
                      {"_".repeat(Math.max(4, part.text.length))}
                    </span>
                  ) : (
                    <span key={index}>{part.text}</span>
                  )
                )}
              </p>
            )}
          </div>

          <div className="text-center text-xs text-ej-muted">
            {t("vocabulary.flipHint")}
          </div>
        </>
      ) : (
        <div className="flex flex-1 select-text flex-col gap-3.5 py-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="font-literata text-[28px] font-semibold text-ej-ink">
              {word}
            </span>
            {ipa && (
              <span className="font-ipa text-[15px] text-ej-muted">{ipa}</span>
            )}
            {pos && <span className="ej-label">{pos}</span>}
            {lemma && lemma !== word && (
              <span className="text-xs text-ej-muted">({lemma})</span>
            )}
          </div>

          {translation && (
            <div className="text-xl font-semibold leading-snug text-ej-ink">
              {translation}
            </div>
          )}

          {definition && (
            <p className="leading-relaxed text-ej-ink2">{definition}</p>
          )}

          {context && (
            <div className="flex flex-col gap-1.5 rounded-ej border border-ej-line bg-ej-bg px-3.5 py-3">
              <p className="font-literata text-[15.5px] leading-relaxed text-ej-ink">
                {splitAroundWord(context, word).map((part, index) => (
                  <span
                    key={index}
                    className={cn(
                      part.hit && "rounded-sm bg-ej-hl px-[3px] font-semibold text-ej-hl-ink"
                    )}
                  >
                    {part.text}
                  </span>
                ))}
              </p>
              {contextTranslation && (
                <p className="text-[11.5px] leading-relaxed text-ej-muted">
                  {contextTranslation}
                </p>
              )}
            </div>
          )}

          {synonyms.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="ej-label">{t("vocabulary.nearMeaning")}</span>
              {synonyms.map((synonym) => (
                <span
                  key={synonym}
                  className="rounded-full bg-ej-surface2 px-2.5 py-[3px] text-xs text-ej-ink2"
                >
                  {synonym}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
