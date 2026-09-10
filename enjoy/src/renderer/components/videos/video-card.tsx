import {
  CircleAlertIcon,
  VideoIcon,
  MoreVerticalIcon,
  TrashIcon,
  EditIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@renderer/components/ui";
import { MediaCard, MediaCardStatus } from "@renderer/components/enjoy";
import { formatDuration } from "@renderer/lib/utils";
import { t } from "i18next";
import { useEffect, useState } from "react";
import { getYoutubeThumbnailUrl } from "@/utils/youtube";
import { resolveDisplayResource } from "@renderer/lib/retired-resource";

const statusOf = (video: Partial<VideoType>): MediaCardStatus => {
  if (video.transcribing) return "processing";
  return video.transcribed ? "done" : "pending";
};

const statusLabel = (status: MediaCardStatus) =>
  status === "processing"
    ? t("media.transcribing")
    : status === "done"
      ? t("media.transcribed")
      : t("media.notTranscribed");

export const VideoCard = (props: {
  video: Partial<VideoType>;
  className?: string;
  onDelete?: () => void;
  onEdit?: () => void;
}) => {
  const { video, className, onDelete, onEdit } = props;
  const fallbackCover = resolveDisplayResource(video.coverUrl);
  const preferredCoverUrl =
    resolveDisplayResource(getYoutubeThumbnailUrl(video.source)).url ||
    fallbackCover.url;
  const [coverUrl, setCoverUrl] = useState(preferredCoverUrl);
  const status = statusOf(video);

  useEffect(() => {
    setCoverUrl(preferredCoverUrl);
  }, [preferredCoverUrl]);

  const meta = [
    video.recordingsCount
      ? t("media.recordingsCount", { count: video.recordingsCount })
      : null,
    !video.src ? t("cannotFindSourceFile") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <MediaCard
      className={className}
      to={`/videos/${video.id}`}
      id={video.id}
      title={video.name}
      ratio="video"
      coverUrl={coverUrl}
      onError={() =>
        setCoverUrl(coverUrl === fallbackCover.url ? undefined : fallbackCover.url)
      }
      coverFallback={<VideoIcon className="size-8" strokeWidth={1.4} />}
      language={video.language}
      duration={video.duration ? formatDuration(video.duration) : undefined}
      processing={video.transcribing}
      processingLabel={t("media.transcribing")}
      status={status}
      statusLabel={statusLabel(status)}
      meta={
        meta ? (
          <span className="inline-flex items-center gap-1">
            {(!video.src || (!preferredCoverUrl && fallbackCover.retired)) && (
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
