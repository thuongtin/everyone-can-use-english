import { DocumentCard } from "@renderer/components";
import { EjSectionHeader, EjSeeAllLink } from "@renderer/components/enjoy";
import { t } from "i18next";
import { useState, useContext, useEffect } from "react";
import { AppSettingsProviderContext } from "@renderer/context";

export const DocumentsSegment = () => {
  const [documents, setDocuments] = useState<DocumentEType[]>([]);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);

  const fetchDocuments = async () => {
    EnjoyApp.documents.findAll({ limit: 10 }).then((docs) => {
      setDocuments(docs);
    });
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  if (documents.length == 0) return null;

  return (
    <section>
      <EjSectionHeader
        title={t("home.documents")}
        count={t("home.documentsCount", { count: documents.length })}
        action={<EjSeeAllLink to="/documents" label={t("home.seeAll")} />}
      />

      <div className="ej-row pb-1">
        {documents.map((document) => (
          <DocumentCard
            key={document.id}
            document={document}
            onDelete={() =>
              setDocuments(documents.filter((d) => d.id !== document.id))
            }
          />
        ))}
      </div>
    </section>
  );
};
