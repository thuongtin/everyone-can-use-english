import {
  DocumentAddButton,
  DocumentCard,
  LoaderSpin,
} from "@renderer/components";
import {
  EjEmptyState,
  EjMediaGrid,
  EjPage,
  EjPageHeader,
  EjSearchInput,
  EjToolbar,
} from "@renderer/components/enjoy";
import { useState, useContext, useEffect } from "react";
import { AppSettingsProviderContext } from "@renderer/context";
import { t } from "i18next";
import { useDebounce } from "@uidotdev/usehooks";

export default () => {
  const [documents, setDocuments] = useState<DocumentEType[]>([]);
  const [query, setQuery] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const debouncedQuery = useDebounce(query, 500);

  const fetchDocuments = () => {
    setLoading(true);
    EnjoyApp.documents
      .findAll({ query: debouncedQuery })
      .then((documents) => {
        setDocuments(documents);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchDocuments();
  }, [debouncedQuery]);

  return (
    <EjPage>
      <EjPageHeader
        title={t("library.documents")}
        description={t("library.documentsDescription")}
        actions={<DocumentAddButton />}
      />

      <EjToolbar>
        <EjSearchInput
          value={query}
          onChange={setQuery}
          placeholder={t("library.searchPlaceholder")}
        />
        <span className="ml-auto text-xs text-ej-muted ej-tabular">
          {t("library.itemsCount", { count: documents.length })}
        </span>
      </EjToolbar>

      {loading ? (
        <LoaderSpin />
      ) : documents.length === 0 ? (
        <EjEmptyState
          title={t("library.empty")}
          description={t("library.emptyDescription")}
          actions={<DocumentAddButton />}
        />
      ) : (
        <EjMediaGrid>
          {documents.map((document) => (
            <DocumentCard
              key={document.id}
              document={document}
              onDelete={() =>
                setDocuments(documents.filter((d) => d.id !== document.id))
              }
            />
          ))}
        </EjMediaGrid>
      )}
    </EjPage>
  );
};
