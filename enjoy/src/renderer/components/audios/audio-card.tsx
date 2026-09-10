import {
  AudioLinesIcon,
  CircleAlertIcon,
  EditIcon,
  MoreVerticalIcon,
  TrashIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@renderer/components/ui";
import { MediaCard, MediaCardStatus } from "@renderer/components/enjoy";
import { formatDuration } from "@renderer/lib/utils";
import { resolveDisplayResource } from "@renderer/lib/retired-resource";
import { t } from "i18next";

const statusOf = (audio: Partial<AudioType>): MediaCardStatus => {
  if (audio.transcribing) return "processing";
  return audio.transcribed ? "done" : "pending";
};

const statusLabel = (status: MediaCardStatus) =>
  status === "processing"
    ? t("media.transcribing")
    : status === "done"
      ? t("media.transcribed")
      : t("media.notTranscribed");

export const AudioCard = (props: {
  audio: Partial<AudioType>;
  className?: string;
  onDelete?: () => void;
  onEdit?: () => void;
}) => {
  const { audio, className, onDelete, onEdit } = props;
  const status = statusOf(audio);
  const coverResource = resolveDisplayResource(audio.coverUrl);

  const meta = [
    audio.recordingsCount
      ? t("media.recordingsCount", { count: audio.recordingsCount })
      : null,
    !audio.src ? t("cannotFindSourceFile") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <MediaCard
      className={className}
      to={`/audios/${audio.id}`}
      id={audio.id}
      title={audio.name}
      ratio="square"
      coverUrl={coverResource.url}
      coverFallback={<AudioLinesIcon className="size-8" strokeWidth={1.4} />}
      language={audio.language}
      duration={audio.duration ? formatDuration(audio.duration) : undefined}
      processing={audio.transcribing}
      processingLabel={t("media.transcribing")}
      status={status}
      statusLabel={statusLabel(status)}
      meta={
        meta ? (
          <span className="inline-flex items-center gap-1">
            {!audio.src && (
              <CircleAlertIcon className="size-3 text-ej-bad shrink-0" />
            )}
            {meta}
          </span>
        ) : undefined
      }
      actions={
        onDelete || onEdit ? (
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
              {onEdit && (
                <DropdownMenuItem className="cursor-pointer gap-2" onClick={onEdit}>
                  <EditIcon className="size-4" />
                  {t("edit")}
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem
                  className="cursor-pointer gap-2 text-ej-bad focus:text-ej-bad"
                  onClick={onDelete}
                >
                  <TrashIcon className="size-4" />
                  {t("delete")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : undefined
      }
    />
  );
};
