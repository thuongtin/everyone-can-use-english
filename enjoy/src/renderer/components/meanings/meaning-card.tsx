import { t } from "i18next";
import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import type { LocalMeaning, LocalStudyLookup } from "../../../types/local-study-api";

export const MeaningCard = (props: {
  meaning: LocalMeaning;
  lookup?: LocalStudyLookup;
}) => {
  const {
    meaning: {
      word,
      lemma,
      pronunciation,
      pos,
      definition,
      translation,
      lookups: _lookups = [],
    },
    lookup,
  } = props;
  const [contextVisible, setContextVisible] = useState<boolean>(false);
  const lookups = [lookup, ..._lookups].filter(Boolean);

  return (
    <div className="select-text">
      <div className="font-literata text-lg font-bold text-ej-ink">{word}</div>

      <div className="mt-1 flex flex-wrap items-baseline gap-2">
        {pos && (
          <span className="text-xs italic text-ej-muted">{pos}</span>
        )}
        {pronunciation && (
          <span className="font-ipa text-xs text-ej-accent-ink">
            /{pronunciation}/
          </span>
        )}
        {lemma && lemma !== word && (
          <span className="text-xs text-ej-muted">({lemma})</span>
        )}
      </div>

      {translation && (
        <div className="mt-2.5 text-sm text-ej-ink">{translation}</div>
      )}

      {definition && (
        <p className="mt-1.5 text-xs leading-relaxed text-ej-ink2">
          {definition}
        </p>
      )}

      {lookups.length > 0 && contextVisible && (
        <div className="mt-3 flex flex-col gap-3">
          {lookups.map((lookup) => (
            <ContextPart
              key={lookup.id}
              context={lookup.context}
              contextTranslation={lookup.contextTranslation}
            />
          ))}
        </div>
      )}

      {lookups.length > 0 && (
        <div className="mt-2 flex items-center justify-center">
          <button
            type="button"
            onClick={() => setContextVisible(!contextVisible)}
            aria-label={t("context")}
            className="flex size-7 items-center justify-center rounded-lg text-ej-muted transition-colors duration-ej hover:bg-ej-surface2 hover:text-ej-ink"
          >
            {contextVisible ? (
              <ChevronUpIcon className="size-4" />
            ) : (
              <ChevronDownIcon className="size-4" />
            )}
          </button>
        </div>
      )}
    </div>
  );
};

const ContextPart = (props: {
  context: string;
  contextTranslation?: string;
}) => {
  const { context, contextTranslation } = props;

  return (
    <div className="rounded-ej border border-ej-line bg-ej-bg px-3 py-2.5">
      <div className="ej-label mb-1.5">{t("context")}</div>
      <div className="font-literata text-xs leading-relaxed text-ej-ink">
        {context}
      </div>
      {contextTranslation && (
        <div className="mt-1.5 text-xs leading-relaxed text-ej-muted">
          {contextTranslation}
        </div>
      )}
    </div>
  );
};
