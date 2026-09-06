import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BilingualDictionaryPanel } from "@renderer/components/widgets/lookup/bilingual-dictionary-panel";

export default function DictionaryPage() {
  const { t } = useTranslation();
  return (
    <main className="w-full max-w-3xl mx-auto p-6">
      <Link to="/" className="inline-block text-sm underline mb-6">{t("bilingual.back")}</Link>
      <BilingualDictionaryPanel />
    </main>
  );
}
