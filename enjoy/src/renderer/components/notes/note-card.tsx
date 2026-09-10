import { AppSettingsProviderContext } from "@renderer/context";
import { useContext, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@renderer/components/ui";
import { MoreHorizontalIcon } from "lucide-react";
import { EjIconButton } from "@renderer/components/enjoy";
import Markdown from "react-markdown";
import { t } from "i18next";

export const NoteCard = (props: {
  note: NoteType;
  onEdit?: (note: NoteType) => void;
}) => {
  if (props.note.targetType === "Segment") {
    return <SegmentNoteCard {...props} />;
  }
};

export const SegmentNoteCard = (props: {
  note: NoteType;
  onEdit?: (note: NoteType) => void;
}) => {
  const { note } = props;

  return (
    <div
      id={`note-${note.id}`}
      className="w-full rounded-ej border border-ej-line bg-ej-surface px-3.5 py-2.5"
    >
      <Markdown className="prose prose-sm mb-2 max-w-full select-text text-ej-ink dark:prose-invert">
        {note.content}
      </Markdown>

      <div className="flex items-center justify-between gap-2">
        {note.parameters?.quote ? (
          <div className="flex min-w-0">
            <span className="truncate border-b border-dashed border-ej-hl px-1 font-literata text-xs text-ej-ink2">
              {note.parameters.quote}
            </span>
          </div>
        ) : (
          <div></div>
        )}

        <NoteActionsDropdownMenu {...props} />
      </div>
    </div>
  );
};

export const NoteActionsDropdownMenu = (props: {
  note: NoteType;
  onEdit?: (note: NoteType) => void;
}) => {
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { note, onEdit } = props;
  const [deleting, setDeleting] = useState(false);

  const handleDelete = () => {
    EnjoyApp.notes.delete(note.id);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <EjIconButton size={24} aria-label={t("more")}>
            <MoreHorizontalIcon className="size-3.5" />
          </EjIconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {onEdit && (
            <DropdownMenuItem onClick={() => onEdit(note)}>
              {t("edit")}
            </DropdownMenuItem>
          )}

          <DropdownMenuItem
            className="text-ej-bad"
            onClick={() => setDeleting(true)}
          >
            {t("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={deleting} onOpenChange={(value) => setDeleting(value)}>
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-bold text-ej-ink">
              {t("deleteNote")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-ej-muted">
              {t("areYouSureToDeleteThisNote")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-ej-bad hover:opacity-90"
              onClick={handleDelete}
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
