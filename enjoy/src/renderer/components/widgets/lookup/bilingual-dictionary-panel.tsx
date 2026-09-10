import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EjButton, Segmented } from "@renderer/components/enjoy";
import { BilingualLookupResult } from "./bilingual-lookup-result";
import {
  BILINGUAL_DICTIONARIES,
  isBilingualDirection,
} from "@/constants/bilingual-dictionaries";

const storageKey = "enjoy-bilingual-direction";

/**
 * Small lookup form embedded in the preferences dialog. The dedicated
 * dictionary screen builds its own layout on top of the same IPC call.
 */
export const BilingualDictionaryPanel = () => {
  const { t } = useTranslation();
  const [direction, setDirection] = useState<BilingualDirection>(() => {
    const saved = localStorage.getItem(storageKey);
    return isBilingualDirection(saved) ? saved : "en-vi";
  });
  const [query, setQuery] = useState("");
  const [word, setWord] = useState("");

  return (
    <section className="flex flex-col gap-4" data-testid="bilingual-panel">
      <div>
        <h2 className="text-base font-bold text-ej-ink">
          {t("bilingual.title")}
        </h2>
        <p className="mt-1 text-xs text-ej-muted">
          {t("bilingual.description")}
        </p>
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setWord(query.trim());
        }}
      >
        <div className="flex flex-col gap-1.5">
          <span className="ej-label">{t("bilingual.direction")}</span>
          <Segmented<BilingualDirection>
            size="sm"
            value={direction}
            onChange={(value) => {
              setDirection(value);
              localStorage.setItem(storageKey, value);
            }}
            options={BILINGUAL_DICTIONARIES.map((dictionary) => ({
              value: dictionary.value as BilingualDirection,
              label: t(dictionary.key),
            }))}
          />
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="ej-label">{t("bilingual.query")}</span>
          <input
            value={query}
            maxLength={200}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("bilingual.placeholder")}
            className="h-9 rounded-[9px] border border-ej-line bg-ej-surface px-3 text-xs text-ej-ink outline-none transition-colors duration-ej placeholder:text-ej-muted focus:border-ej-accent"
          />
        </label>

        <EjButton
          type="submit"
          variant="primary"
          className="self-start"
          disabled={!query.trim()}
        >
          {t("bilingual.search")}
        </EjButton>
      </form>

      <p className="text-xxs leading-relaxed text-ej-muted">
        {t("bilingual.offlineNote")}
      </p>

      <BilingualLookupResult word={word} direction={direction} />
    </section>
  );
};
