import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  toast,
} from "@renderer/components/ui";
import { MediaCard } from "@renderer/components/enjoy";
import {
  BookOpenIcon,
  CircleAlertIcon,
  MoreVerticalIcon,
  TrashIcon,
} from "lucide-react";
import { t } from "i18next";
import { useContext, useState } from "react";
import { AppSettingsProviderContext } from "@renderer/context";
import { formatDate } from "@renderer/lib/utils";

export const DocumentCard = (props: {
  document: DocumentEType;
  className?: string;
  onDelete?: () => void;
}) => {
  const { document, className, onDelete } = props;
  const [deleting, setDeleting] = useState(false);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const metadata = [
    formatDate(document.lastReadAt || document.createdAt),
    !document.src ? t("cannotFindSourceFile") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    setDeleting(true);
  };

  return (
    <>
      <MediaCard
        className={className}
        to={`/documents/${document.id}`}
        id={document.id}
        title={document.title}
        ratio="book"
        coverFallback={
          <div className="px-4 text-center">
            <BookOpenIcon
              className="size-7 mx-auto mb-2 opacity-80"
              strokeWidth={1.4}
            />
            <div className="text-[12px] font-semibold leading-snug line-clamp-3 text-white">
              {document.title}
            </div>
          </div>
        }
        language={document.language}
        spineLabel={document.metadata?.extension}
        meta={
          metadata ? (
            <span className="inline-flex items-center gap-1">
              {!document.src && (
                <CircleAlertIcon className="size-3 shrink-0 text-ej-bad" />
              )}
              {metadata}
            </span>
          ) : undefined
        }
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="size-6 rounded-lg bg-white/90 text-ej-ink flex items-center justify-center shadow-ej"
              >
                <MoreVerticalIcon className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="cursor-pointer gap-2 text-ej-bad focus:text-ej-bad"
                onClick={handleDelete}
              >
                <TrashIcon className="size-4" />
                {t("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-bold text-ej-ink">
              {t("delete")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-ej-muted">
              {t("deleteDocumentConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-ej-bad hover:opacity-90"
              onClick={() => {
                EnjoyApp.documents
                  .destroy(document.id)
                  .then(() => {
                    toast.success(t("documentDeletedSuccessfully"));
                    onDelete?.();
                  })
                  .catch((error) => {
                    toast.error(error.message);
                  })
                  .finally(() => {
                    setDeleting(false);
                  });
              }}
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
