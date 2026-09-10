import { useContext, useState } from "react";
import { t } from "i18next";
import {
  AppSettingsProviderContext,
  MediaShadowProviderContext,
} from "@renderer/context";
import { toast } from "@renderer/components/ui";
import { NoteActionsDropdownMenu, NoteForm } from "@renderer/components";
import Markdown from "react-markdown";

const formatTime = (value: string | Date) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return `${String(date.getDate()).padStart(2, "0")}/${String(
    date.getMonth() + 1
  ).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
};

/**
 * Notes attached to the current sentence. Writing one creates the segment on
 * demand, so the user never has to "start noting" first.
 */
export const MediaCaptionNote = (props: {
  selectedIndices: number[];
  setSelectedIndices: (indices: number[]) => void;
}) => {
  const { selectedIndices, setSelectedIndices } = props;
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { currentSegment, createSegment, currentNotes } = useContext(
    MediaShadowProviderContext
  );
  const [content, setContent] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [editingNote, setEditingNote] = useState<NoteType>();

  const quoteParameters = (segment: SegmentType) => ({
    quoteIndices: selectedIndices,
    quote: selectedIndices
      .map((index) => segment?.caption?.timeline?.[index]?.text)
      .filter(Boolean)
      .join(" "),
  });

  const handleSave = async () => {
    if (saving) return;
    if (!content.trim()) return;

    setSaving(true);
    try {
      const segment = currentSegment || (await createSegment());
      if (!segment) return;

      await EnjoyApp.notes.create({
        targetId: segment.id,
        targetType: "Segment",
        parameters: quoteParameters(segment),
        content: content.trim(),
      });
      setContent("");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {currentNotes.map((note) =>
        editingNote?.id === note.id ? (
          <NoteForm
            key={note.id}
            segment={currentSegment}
            note={note}
            parameters={quoteParameters(currentSegment)}
            onParametersChange={(parameters) => {
              if (parameters.quoteIndices) {
                setSelectedIndices(parameters.quoteIndices);
              }
            }}
            onCancel={() => setEditingNote(undefined)}
            onSave={() => setEditingNote(undefined)}
          />
        ) : (
          <div
            key={note.id}
            id={`note-${note.id}`}
            className="rounded-ej border border-ej-line bg-ej-bg px-3 py-2.5"
          >
            <div className="flex items-start gap-2">
              <Markdown className="prose prose-sm min-w-0 flex-1 max-w-full select-text text-[12.5px] leading-[1.55] text-ej-ink dark:prose-invert">
                {note.content}
              </Markdown>
              <NoteActionsDropdownMenu
                note={note}
                onEdit={() => setEditingNote(note)}
              />
            </div>

            <div className="mt-1 flex items-center gap-2 text-[11px] text-ej-muted">
              {note.parameters?.quote && (
                <span className="min-w-0 truncate border-b border-dashed border-ej-hl font-literata text-ej-ink2">
                  {note.parameters.quote}
                </span>
              )}
              <span className="ml-auto shrink-0 ej-tabular">
                {formatTime(note.createdAt)}
              </span>
            </div>
          </div>
        )
      )}

      <div className="flex items-center gap-2">
        <input
          value={content}
          disabled={saving}
          placeholder={t("segment.notePlaceholder")}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            handleSave();
          }}
          className="h-[34px] min-w-0 flex-1 rounded-[10px] border border-ej-line bg-ej-bg px-3 text-xs text-ej-ink outline-none transition-colors duration-ej placeholder:text-ej-muted focus:border-ej-accent"
        />
        <button
          type="button"
          disabled={saving || !content.trim()}
          onClick={handleSave}
          className="h-[34px] shrink-0 rounded-[10px] bg-ej-ink px-3.5 text-xs font-semibold text-ej-bg transition-opacity duration-ej hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("save")}
        </button>
      </div>
    </div>
  );
};
