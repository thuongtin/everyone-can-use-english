import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppSettingsProviderContext } from "@renderer/context";

export const BilingualLookupResult = ({ word, direction }: {
  word: string;
  direction: BilingualDirection;
}) => {
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { t } = useTranslation();
  const [result, setResult] = useState<{ word: string; direction: string; entries?: BilingualEntry[]; error?: boolean }>();

  useEffect(() => {
    let cancelled = false;
    if (!word.trim()) return;
    EnjoyApp.bilingual.lookup(direction, word).then(
      entries => { if (!cancelled) setResult({ word, direction, entries }); },
      () => { if (!cancelled) setResult({ word, direction, error: true }); }
    );
    return () => { cancelled = true; };
  }, [word, direction, EnjoyApp]);

  if (!word.trim()) return <p className="text-muted-foreground">{t("bilingual.empty")}</p>;
  if (result?.word !== word || result?.direction !== direction) return <p role="status">{t("bilingual.loading")}</p>;
  if (result.error) return <p role="alert">{t("bilingual.error")}</p>;
  if (!result.entries?.length) return <p role="status">{t("bilingual.noResult")}</p>;

  return (
    <div className="space-y-5 select-text break-words" data-testid="bilingual-result">
      {result.entries.map((entry, index) => (
        <section key={`${entry.word}-${index}`}>
          <h3 className="font-semibold text-lg" lang={direction === "en-vi" ? "en" : "vi"}>{entry.word}</h3>
          <p className="text-sm text-muted-foreground">{t(`bilingual.pos.${entry.pos}`, { defaultValue: entry.pos })}</p>
          {entry.ipa.length > 0 && <ul className="text-sm my-2 space-y-1">{entry.ipa.map((ipa, ipaIndex) => <li key={ipaIndex}><span className="font-code">{ipa.text}</span>{ipa.labels.length > 0 && <span className="text-muted-foreground"> ({ipa.labels.join(", ")})</span>}</li>)}</ul>}
          <ol className="list-decimal pl-5 space-y-2" lang={direction === "en-vi" ? "vi" : "en"}>
            {entry.senses.map((sense, senseIndex) => (
              <li key={senseIndex}>
                {sense.tags.length > 0 && <span className="text-xs text-muted-foreground">({sense.tags.join(", ")}) </span>}
                {sense.glosses.join("; ")}
                {sense.examples.map((example, exampleIndex) => (
                  <div className="text-sm border-l-2 pl-3 my-2" key={exampleIndex}>
                    <p lang={direction === "en-vi" ? "en" : "vi"} className="italic">{example.text}</p>
                    {example.translation && <p>{example.translation}</p>}
                  </div>
                ))}
              </li>
            ))}
          </ol>
          {entry.editorialNote && <p className="text-xs text-muted-foreground border-l-2 pl-3 my-2" lang="vi">
            {entry.editorialNote} {" "}
            <a className="underline" href={entry.editorialSourceUrl} onClick={event => {
              event.preventDefault();
              EnjoyApp.shell.openExternal(entry.editorialSourceUrl);
            }}>{t("bilingual.source")}</a>
          </p>}
          <a className="text-xs underline text-muted-foreground" href={entry.sourceUrl} onClick={event => {
            event.preventDefault();
            EnjoyApp.shell.openExternal(entry.sourceUrl);
          }}>{t("bilingual.source")}: Wiktionary</a>
        </section>
      ))}
      <p className="text-xs text-muted-foreground border-t pt-3">
        {t("bilingual.credit")} {" "}
        <a className="underline" href="https://creativecommons.org/licenses/by-sa/4.0/" onClick={event => {
          event.preventDefault();
          EnjoyApp.shell.openExternal("https://creativecommons.org/licenses/by-sa/4.0/");
        }}>CC BY-SA 4.0</a>
      </p>
    </div>
  );
};
