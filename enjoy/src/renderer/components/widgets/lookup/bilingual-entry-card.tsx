import { useContext, useState } from "react";
import { t } from "i18next";
import { BookmarkIcon, CheckIcon, LoaderIcon, Volume2Icon } from "lucide-react";
import { AppSettingsProviderContext } from "@renderer/context";
import { useAiCommand } from "@renderer/hooks";
import { toast } from "@renderer/components/ui";
import { speakText } from "@renderer/lib/speak";
import { cn } from "@renderer/lib/utils";

const posLabel = (pos: string) =>
  t(`bilingual.pos.${pos}`, { defaultValue: pos });

/** First pronunciation found across the entries, used for the headword line. */
const headIpa = (entries: BilingualEntry[]) =>
  entries.flatMap((entry) => entry.ipa).find((ipa) => ipa.text)?.text;

/** Part-of-speech chips plus the sense labels Wiktionary attaches. */
const headTags = (entries: BilingualEntry[]) => {
  const tags: string[] = [];

  entries.forEach((entry) => {
    const pos = posLabel(entry.pos);
    if (pos && !tags.includes(pos)) tags.push(pos);
  });
  entries.forEach((entry) =>
    entry.senses.forEach((sense) =>
      sense.tags.forEach((tag) => {
        if (tag && !tags.includes(tag)) tags.push(tag);
      })
    )
  );

  return tags.slice(0, 5);
};

/**
 * Terms to look up in the opposite direction. They come from the glosses of the
 * entry itself, so no extra data source is needed: looking up "extol" in
 * English offers "tán dương" back in Vietnamese.
 */
const relatedTerms = (entries: BilingualEntry[], word: string) => {
  const terms: string[] = [];
  const seen = new Set<string>([word.trim().toLowerCase()]);

  entries.forEach((entry) =>
    entry.senses.forEach((sense) =>
      sense.glosses.forEach((gloss) =>
        gloss.split(/[;,/]/).forEach((part) => {
          const term = part.trim().replace(/^\(|\)$/g, "").trim();
          const key = term.toLowerCase();
          if (!term || term.length > 28 || seen.has(key)) return;
          if (/[.!?…]$/.test(term)) return;
          seen.add(key);
          terms.push(term);
        })
      )
    )
  );

  return terms.slice(0, 8);
};

/** The first example sentence, used as context for the vocabulary lookup. */
const firstExample = (entries: BilingualEntry[]) =>
  entries
    .flatMap((entry) => entry.senses)
    .flatMap((sense) => sense.examples)
    .find((example) => example.text)?.text ?? "";

const SpeakButton = (props: {
  label: string;
  text: string;
  lang: string;
}) => (
  <button
    type="button"
    onClick={() => {
      if (!speakText(props.text, props.lang)) {
        toast.error(t("bilingual.noSpeechVoice"));
      }
    }}
    className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-ej-line bg-ej-surface px-2.5 text-xs font-semibold text-ej-ink transition-colors duration-ej hover:border-ej-accent"
  >
    <Volume2Icon className="size-3.5 text-ej-accent" />
    {props.label}
  </button>
);

/**
 * Saves the word into the vocabulary deck through the existing lookup pipeline,
 * which is what fills the flashcards on the vocabulary screen.
 */
const AddToVocabularyButton = (props: { word: string; context: string }) => {
  const { word, context } = props;
  const { lookupWord } = useAiCommand();
  const [saving, setSaving] = useState<boolean>(false);
  const [saved, setSaved] = useState<boolean>(false);

  const handleSave = () => {
    if (saving || saved) return;

    setSaving(true);
    lookupWord({ word, context })
      .then((lookup) => {
        if (!lookup?.meaning) throw new Error(t("bilingual.saveFailed"));
        setSaved(true);
        toast.success(t("bilingual.savedToVocabularyToast", { word }));
      })
      .catch((err) => {
        toast.error(err.message);
      })
      .finally(() => setSaving(false));
  };

  return (
    <button
      type="button"
      disabled={saving}
      onClick={handleSave}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-xs font-semibold transition-opacity duration-ej",
        "disabled:cursor-not-allowed disabled:opacity-60",
        saved ? "bg-ej-ok-soft text-ej-ok" : "bg-ej-ink text-ej-bg hover:opacity-90"
      )}
    >
      {saving ? (
        <LoaderIcon className="size-3.5 animate-spin" />
      ) : saved ? (
        <CheckIcon className="size-3.5" />
      ) : (
        <BookmarkIcon className="size-3.5" />
      )}
      {saved ? t("bilingual.savedToVocabulary") : t("bilingual.addToVocabulary")}
    </button>
  );
};

/** Result card of the dictionary screen: one card per looked-up word. */
export const BilingualEntryCard = (props: {
  word: string;
  direction: BilingualDirection;
  entries: BilingualEntry[];
  /** Looks the term up in the opposite direction. */
  onRelated: (word: string, direction: BilingualDirection) => void;
}) => {
  const { word, direction, entries, onRelated } = props;
  const { EnjoyApp } = useContext(AppSettingsProviderContext);

  const ipa = headIpa(entries);
  const tags = headTags(entries);
  const related = relatedTerms(entries, word);
  const reversed: BilingualDirection = direction === "en-vi" ? "vi-en" : "en-vi";
  const sourceUrl = entries.find((entry) => entry.sourceUrl)?.sourceUrl;
  const editorial = entries.find((entry) => entry.editorialNote);

  return (
    <div
      data-testid="bilingual-result"
      className="flex animate-rise select-text flex-col gap-4 rounded-ej-lg border border-ej-line bg-ej-surface px-6 py-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-3">
            <span
              lang={direction === "en-vi" ? "en" : "vi"}
              className="font-literata text-[34px] font-semibold leading-tight tracking-[-0.01em] text-ej-ink"
            >
              {word}
            </span>
            {ipa && (
              <span className="font-ipa text-base text-ej-muted">{ipa}</span>
            )}
          </div>
          {tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-[5px] bg-ej-surface2 px-1.5 py-0.5 text-xxs font-bold text-ej-ink2"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {direction === "en-vi" ? (
            <>
              <SpeakButton label="US" text={word} lang="en-US" />
              <SpeakButton label="UK" text={word} lang="en-GB" />
            </>
          ) : (
            <SpeakButton
              label={t("bilingual.speak")}
              text={word}
              lang="vi-VN"
            />
          )}
          <AddToVocabularyButton word={word} context={firstExample(entries)} />
        </div>
      </div>

      {entries.map((entry, entryIndex) => (
        <div
          key={`${entry.word}-${entry.pos}-${entryIndex}`}
          className="flex flex-col gap-2 border-t border-ej-line pt-3.5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="ej-label text-ej-accent">
              {posLabel(entry.pos)}
            </span>
            {entry.ipa.length > 0 && (
              <span className="text-xxs text-ej-muted">
                {entry.ipa
                  .map((item) =>
                    item.labels.length > 0
                      ? `${item.labels.join(", ")} ${item.text}`
                      : item.text
                  )
                  .join(" · ")}
              </span>
            )}
          </div>

          {entry.senses.map((sense, senseIndex) => (
            <div key={senseIndex} className="flex gap-3">
              <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-ej-surface2 text-xxs font-bold text-ej-ink2">
                {senseIndex + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  lang={direction === "en-vi" ? "vi" : "en"}
                  className="text-[15px] leading-normal text-ej-ink"
                >
                  {sense.glosses.join("; ")}
                </div>
                {sense.tags.length > 0 && (
                  <div className="mt-0.5 text-[12.5px] leading-normal text-ej-ink2">
                    {sense.tags.join(", ")}
                  </div>
                )}
                {sense.examples.map((example, exampleIndex) => (
                  <div
                    key={exampleIndex}
                    className="mt-1.5 rounded-[9px] bg-ej-bg px-3 py-2"
                  >
                    <div
                      lang={direction === "en-vi" ? "en" : "vi"}
                      className="font-literata text-sm italic leading-[1.55] text-ej-ink2"
                    >
                      {example.text}
                    </div>
                    {example.translation && (
                      <div className="mt-1 text-xs text-ej-muted">
                        {example.translation}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

      {related.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-ej-line pt-3.5">
          <div className="ej-label">{t("bilingual.related")}</div>
          <div className="flex flex-wrap gap-1.5">
            {related.map((term) => (
              <button
                key={term}
                type="button"
                title={t("bilingual.lookupReversed")}
                onClick={() => onRelated(term, reversed)}
                className="rounded-full border border-ej-line bg-ej-bg px-2.5 py-1 text-xs text-ej-ink transition-colors duration-ej hover:border-ej-accent hover:text-ej-accent"
              >
                {term}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5 border-t border-ej-line pt-3.5 text-xxs leading-relaxed text-ej-muted">
        {editorial?.editorialNote && (
          <p>
            {editorial.editorialNote}{" "}
            {editorial.editorialSourceUrl && (
              <button
                type="button"
                className="underline"
                onClick={() =>
                  EnjoyApp.shell.openExternal(editorial.editorialSourceUrl)
                }
              >
                {t("bilingual.source")}
              </button>
            )}
          </p>
        )}
        <p>
          {t("bilingual.credit")}{" "}
          {sourceUrl && (
            <button
              type="button"
              className="underline"
              onClick={() => EnjoyApp.shell.openExternal(sourceUrl)}
            >
              Wiktionary
            </button>
          )}{" "}
          <button
            type="button"
            className="underline"
            onClick={() =>
              EnjoyApp.shell.openExternal(
                "https://creativecommons.org/licenses/by-sa/4.0/"
              )
            }
          >
            CC BY-SA 4.0
          </button>
        </p>
      </div>
    </div>
  );
};
