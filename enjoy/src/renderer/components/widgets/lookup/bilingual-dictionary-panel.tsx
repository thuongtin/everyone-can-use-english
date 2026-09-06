import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input } from "@renderer/components/ui";
import { BilingualLookupResult } from "./bilingual-lookup-result";
import { BILINGUAL_DICTIONARIES, isBilingualDirection } from "@/constants/bilingual-dictionaries";

const storageKey = "enjoy-bilingual-direction";

export const BilingualDictionaryPanel = () => {
  const { t } = useTranslation();
  const [direction, setDirection] = useState<BilingualDirection>(() => {
    const saved = localStorage.getItem(storageKey);
    return isBilingualDirection(saved) ? saved : "en-vi";
  });
  const [query, setQuery] = useState("");
  const [word, setWord] = useState("");

  return (
    <section className="space-y-5" data-testid="bilingual-panel">
      <div>
        <h1 className="text-2xl font-semibold mb-2">{t("bilingual.title")}</h1>
        <p className="text-muted-foreground">{t("bilingual.description")}</p>
      </div>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); setWord(query.trim()); }}>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("bilingual.direction")}</span>
          <select className="block w-full rounded-md border bg-background p-2" value={direction} onChange={event => {
            if (!isBilingualDirection(event.target.value)) return;
            setDirection(event.target.value);
            localStorage.setItem(storageKey, event.target.value);
          }}>
            {BILINGUAL_DICTIONARIES.map(dictionary => <option key={dictionary.value} value={dictionary.value}>{t(dictionary.key)}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("bilingual.query")}</span>
          <Input value={query} maxLength={200} onChange={event => setQuery(event.target.value)} placeholder={t("bilingual.placeholder")} />
        </label>
        <Button type="submit" disabled={!query.trim()}>{t("bilingual.search")}</Button>
      </form>
      <p className="text-xs text-muted-foreground">{t("bilingual.offlineNote")}</p>
      <BilingualLookupResult word={word} direction={direction} />
    </section>
  );
};
