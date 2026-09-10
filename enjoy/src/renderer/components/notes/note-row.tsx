import { useContext, useState } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "i18next";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { AppSettingsProviderContext } from "@renderer/context";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Textarea,
  toast,
} from "@renderer/components/ui";
import { EjButton, EjIconButton } from "@renderer/components/enjoy";
import { formatDateTime, secondsToTimestamp } from "@renderer/lib/utils";

/**
 * Splits the quoted sentence around the phrase the note was attached to, so the
 * phrase can be highlighted the way the design does.
 */
const highlightParts = (text: string, phrase?: string) => {
  if (!phrase) return [{ text, highlighted: false }];

  const index = text.toLowerCase().indexOf(phrase.toLowerCase());
  if (index < 0) return [{ text, highlighted: false }];

  return [
    { text: text.slice(0, index), highlighted: false },
    { text: text.slice(index, index + phrase.length), highlighted: true },
    { text: text.slice(index + phrase.length), highlighted: false },
  ].filter((part) => part.text);
};

/** One note inside a source group: quote, body, meta row and inline editing. */
export const NoteRow = (props: { note: NoteType; segment: SegmentType }) => {
  const { note, segment } = props;
  const navigate = useNavigate();
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const [editing, setEditing] = useState<boolean>(false);
  const [draft, setDraft] = useState<string>(note.content ?? "");
  const [deleting, setDeleting] = useState<boolean>(false);

  const parts = highlightParts(
    segment.caption?.text ?? "",
    note.parameters?.quote
  );

  const openSegment = () => {
    navigate(
      `/${segment.targetType.toLowerCase()}s/${segment.targetId}?segmentIndex=${
        segment.segmentIndex
      }`
    );
  };

  const handleSave = () => {
    if (!draft.trim()) return;

    EnjoyApp.notes
      .update(note.id, { content: draft, parameters: note.parameters })
      .then(() => {
        setEditing(false);
        toast.success(t("noteSaved"));
      })
      .catch((err) => {
        toast.error(err.message);
      });
  };

  const handleDelete = () => {
    EnjoyApp.notes
      .delete(note.id)
      .then(() => {
        setDeleting(false);
        toast.success(t("noteDeleted"));
      })
      .catch((err) => {
        toast.error(err.message);
      });
  };

  return (
    <div
      id={`note-${note.id}`}
      className="flex flex-col gap-2 border-b border-ej-line py-3 pl-[18px] pr-3.5 transition-colors duration-ej last:border-b-0 hover:bg-ej-bg"
    >
      <div
        role="button"
        tabIndex={0}
        title={t("openThisSegment")}
        onClick={openSegment}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") openSegment();
        }}
        className="flex cursor-pointer gap-2.5 text-left"
      >
        <span className="w-[3px] shrink-0 rounded-sm bg-ej-hl-ink/50" />
        <div className="min-w-0 flex-1 select-text font-literata text-[14.5px] leading-[1.55] text-ej-ink2">
          {parts.map((part, index) =>
            part.highlighted ? (
              <span
                key={index}
                className="rounded-[3px] bg-ej-hl px-0.5 font-semibold text-ej-hl-ink"
              >
                {part.text}
              </span>
            ) : (
              <span key={index}>{part.text}</span>
            )
          )}
        </div>
      </div>

      {editing ? (
        <div className="flex flex-col gap-1.5">
          <Textarea
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="resize-y rounded-[9px] border-ej-accent bg-ej-surface text-xs leading-6 text-ej-ink focus-visible:ring-ej-accent"
          />
          <div className="flex gap-1.5">
            <EjButton
              variant="primary"
              size="sm"
              disabled={!draft.trim()}
              onClick={handleSave}
            >
              {t("save")}
            </EjButton>
            <EjButton
              size="sm"
              onClick={() => {
                setDraft(note.content ?? "");
                setEditing(false);
              }}
            >
              {t("cancel")}
            </EjButton>
          </div>
        </div>
      ) : (
        <div className="select-text whitespace-pre-wrap text-xs leading-[1.6] text-ej-ink">
          {note.content}
        </div>
      )}

      <div className="flex items-center gap-1.5 text-xxs text-ej-muted">
        <span>{t("sentenceIndex", { index: segment.segmentIndex + 1 })}</span>
        <span>·</span>
        <span className="ej-tabular">
          {secondsToTimestamp(segment.startTime ?? 0)}
        </span>
        <span>·</span>
        <span className="ej-tabular">{formatDateTime(note.createdAt)}</span>
        <span className="flex-1" />
        <EjIconButton
          size={26}
          aria-label={t("edit")}
          onClick={() => {
            setDraft(note.content ?? "");
            setEditing(true);
          }}
        >
          <PencilIcon className="size-3.5" />
        </EjIconButton>
        <EjIconButton
          size={26}
          danger
          aria-label={t("delete")}
          onClick={() => setDeleting(true)}
        >
          <Trash2Icon className="size-3.5" />
        </EjIconButton>
      </div>

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
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
    </div>
  );
};
