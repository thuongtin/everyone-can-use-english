import { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { t } from "i18next";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  HeadphonesIcon,
  VideoIcon,
} from "lucide-react";
import { AppSettingsProviderContext } from "@renderer/context";
import { useNotes } from "@renderer/hooks";
import {
  EjButton,
  GradientCover,
  ejButtonClass,
} from "@renderer/components/enjoy";
import { cn, formatDateTime } from "@renderer/lib/utils";
import { NoteRow } from "./note-row";

/**
 * One source group on the notes page: a collapsible card holding every note
 * written on a single segment.
 */
export const NoteSegmentGroup = (props: {
  count: number;
  segment: SegmentType;
  /** Lower-cased search term coming from the page. */
  query?: string;
  /** Reports whether the group survives the current search. */
  onMatchChange?: (segmentId: string, matched: boolean) => void;
}) => {
  const { count, segment, query, onMatchChange } = props;
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [target, setTarget] = useState<AudioType | VideoType | null>(null);

  const { notes, findNotes, hasMore } = useNotes({
    targetId: segment.id,
    targetType: "Segment",
  });

  // groupByTarget only joins the segment, so the media it belongs to (name and
  // cover) has to be fetched separately.
  useEffect(() => {
    const finder =
      segment.targetType === "Video" ? EnjoyApp.videos : EnjoyApp.audios;

    finder
      .findOne({ id: segment.targetId })
      .then((found) => setTarget(found))
      .catch(() => setTarget(null));
  }, [segment.targetId, segment.targetType]);

  const captionText = segment.caption?.text ?? "";
  const captionMatched = !query || captionText.toLowerCase().includes(query);
  const visibleNotes =
    query && !captionMatched
      ? notes.filter((note) => note.content?.toLowerCase().includes(query))
      : notes;
  const matched = !query || captionMatched || visibleNotes.length > 0;

  useEffect(() => {
    onMatchChange?.(segment.id, matched);
  }, [matched, segment.id]);

  if (!matched) return null;

  const kind = segment.targetType.toLowerCase();
  const href = `/${kind}s/${segment.targetId}?segmentIndex=${segment.segmentIndex}`;
  const latestAt = notes[0]?.createdAt;
  const toggle = () => setCollapsed(!collapsed);

  return (
    <div className="animate-rise overflow-hidden rounded-ej-lg border border-ej-line bg-ej-surface">
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") toggle();
        }}
        className={cn(
          "flex cursor-pointer items-center gap-3 px-3.5 py-3 transition-colors duration-ej hover:bg-ej-surface2",
          !collapsed && "border-b border-ej-line"
        )}
      >
        <GradientCover
          id={segment.targetId}
          src={target?.coverUrl}
          alt={target?.name}
          className="size-10"
          rounded="rounded-[10px]"
        >
          {!target?.coverUrl &&
            (segment.targetType === "Video" ? (
              <VideoIcon className="size-[17px]" />
            ) : (
              <HeadphonesIcon className="size-[17px]" />
            ))}
        </GradientCover>

        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-ej-ink">
            {target?.name || captionText || t("source")}
          </div>
          <div className="mt-0.5 truncate text-xxs text-ej-muted">
            {t(kind)} · {t("notesCount", { count })}
            {latestAt && ` · ${t("latestAt", { time: formatDateTime(latestAt) })}`}
          </div>
        </div>

        <Link
          to={href}
          title={t("openSource")}
          onClick={(event) => event.stopPropagation()}
          className={ejButtonClass({
            size: "sm",
            className: "hover:border-ej-accent",
          })}
        >
          {t("open")}
          <ChevronRightIcon className="size-3" />
        </Link>

        {collapsed ? (
          <ChevronDownIcon className="size-3.5 shrink-0 text-ej-muted" />
        ) : (
          <ChevronUpIcon className="size-3.5 shrink-0 text-ej-muted" />
        )}
      </div>

      {!collapsed && (
        <div className="flex flex-col">
          {visibleNotes.map((note) => (
            <NoteRow key={note.id} note={note} segment={segment} />
          ))}

          {hasMore && (
            <div className="flex justify-center py-2">
              <EjButton
                variant="ghost"
                size="sm"
                onClick={() => findNotes({ offset: notes.length })}
              >
                {t("loadMore")}
              </EjButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
