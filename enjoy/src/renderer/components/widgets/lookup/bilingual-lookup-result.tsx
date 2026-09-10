import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppSettingsProviderContext } from "@renderer/context";

/**
 * Compact rendering of the offline dictionary, used inside the lookup popover
 * and the preferences panel. The dictionary screen has its own richer card.
 */
export const BilingualLookupResult = ({
  word,
  direction,
}: {
  word: string;
  direction: BilingualDirection;
}) => {
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { t } = useTranslation();
  const [result, setResult] = useState<{
    word: string;
    direction: string;
    entries?: BilingualEntry[];
    error?: boolean;
  }>();

  useEffect(() => {
    let cancelled = false;
    if (!word.trim()) return;
    EnjoyApp.bilingual.lookup(direction, word).then(
      (entries) => {
        if (!cancelled) setResult({ word, direction, entries });
      },
      () => {
        if (!cancelled) setResult({ word, direction, error: true });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [word, direction, EnjoyApp]);

  if (!word.trim())
    return <p className="text-xs text-ej-muted">{t("bilingual.empty")}</p>;
  if (result?.word !== word || result?.direction !== direction)
    return (
      <p role="status" className="text-xs text-ej-muted">
        {t("bilingual.loading")}
      </p>
    );
  if (result.error)
    return (
      <p role="alert" className="text-xs text-ej-bad">
        {t("bilingual.error")}
      </p>
    );
  if (!result.entries?.length)
    return (
      <p role="status" className="text-xs text-ej-muted">
        {t("bilingual.noResult")}
      </p>
    );

  return (
    <div
      className="flex select-text flex-col gap-4 break-words"
      data-testid="bilingual-result"
    >
      {result.entries.map((entry, index) => (
        <section key={`${entry.word}-${index}`} className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3
              className="font-literata text-lg font-semibold text-ej-ink"
              lang={direction === "en-vi" ? "en" : "vi"}
            >
              {entry.word}
            </h3>
            <span className="ej-label text-ej-accent">
              {t(`bilingual.pos.${entry.pos}`, { defaultValue: entry.pos })}
            </span>
          </div>

          {entry.ipa.length > 0 && (
            <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
              {entry.ipa.map((ipa, ipaIndex) => (
                <li key={ipaIndex} className="text-xs text-ej-ink2">
                  <span className="font-ipa">{ipa.text}</span>
                  {ipa.labels.length > 0 && (
                    <span className="text-ej-muted">
                      {" "}
                      ({ipa.labels.join(", ")})
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <ol
            className="list-decimal space-y-2 pl-5 text-[13px] leading-relaxed text-ej-ink marker:text-ej-muted"
            lang={direction === "en-vi" ? "vi" : "en"}
          >
            {entry.senses.map((sense, senseIndex) => (
              <li key={senseIndex}>
                {sense.tags.length > 0 && (
                  <span className="text-xxs text-ej-muted">
                    ({sense.tags.join(", ")}){" "}
                  </span>
                )}
                {sense.glosses.join("; ")}
                {sense.examples.map((example, exampleIndex) => (
                  <div
                    className="my-1.5 rounded-[9px] bg-ej-bg px-3 py-2"
                    key={exampleIndex}
                  >
                    <p
                      lang={direction === "en-vi" ? "en" : "vi"}
                      className="font-literata text-xs italic leading-relaxed text-ej-ink2"
                    >
                      {example.text}
                    </p>
                    {example.translation && (
                      <p className="mt-0.5 text-xxs text-ej-muted">
                        {example.translation}
                      </p>
                    )}
                  </div>
                ))}
              </li>
            ))}
          </ol>

          {entry.editorialNote && (
            <p
              className="border-l-2 border-ej-accent-soft2 pl-3 text-xxs leading-relaxed text-ej-muted"
              lang="vi"
            >
              {entry.editorialNote}{" "}
              <a
                className="underline"
                href={entry.editorialSourceUrl}
                onClick={(event) => {
                  event.preventDefault();
                  EnjoyApp.shell.openExternal(entry.editorialSourceUrl);
                }}
              >
                {t("bilingual.source")}
              </a>
            </p>
          )}

          <a
            className="text-xxs text-ej-muted underline"
            href={entry.sourceUrl}
            onClick={(event) => {
              event.preventDefault();
              EnjoyApp.shell.openExternal(entry.sourceUrl);
            }}
          >
            {t("bilingual.source")}: Wiktionary
          </a>
        </section>
      ))}

      <p className="border-t border-ej-line pt-3 text-xxs text-ej-muted">
        {t("bilingual.credit")}{" "}
        <a
          className="underline"
          href="https://creativecommons.org/licenses/by-sa/4.0/"
          onClick={(event) => {
            event.preventDefault();
            EnjoyApp.shell.openExternal(
              "https://creativecommons.org/licenses/by-sa/4.0/"
            );
          }}
        >
          CC BY-SA 4.0
        </a>
      </p>
    </div>
  );
};
