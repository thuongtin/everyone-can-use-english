import { useContext, useState } from "react";
import {
  AppSettingsProviderContext,
  MediaShadowProviderContext,
} from "@renderer/context";
import { formatDuration, formatDateTime } from "@renderer/lib/utils";
import { t } from "i18next";
import { toast } from "@renderer/components/ui";
import { useAiCommand } from "@renderer/hooks";
import { LoaderIcon, SparklesIcon } from "lucide-react";

export const MediaInfo = () => {
  const { media, transcription } = useContext(MediaShadowProviderContext);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { summarizeTopic } = useAiCommand();
  const [summarizing, setSummarizing] = useState<boolean>(false);

  const handleSummarize = async () => {
    setSummarizing(true);

    try {
      const topic = await summarizeTopic(transcription.result.transcript);
      if (media.mediaType === "Video") {
        await EnjoyApp.videos.update(media.id, {
          name: topic,
        });
      } else if (media.mediaType === "Audio") {
        await EnjoyApp.audios.update(media.id, {
          name: topic,
        });
      }
    } catch (error) {
      toast.error(error.message);
    }

    setSummarizing(false);
  };

  if (!media) return null;

  return (
    <div className="px-4 py-4 space-y-4" data-testid="media-info-panel">
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="ej-label">{t("models.audio.name")}</span>
          <button
            type="button"
            disabled={summarizing}
            onClick={handleSummarize}
            className="inline-flex items-center gap-1.5 h-6 px-2 rounded-lg text-xxs font-semibold text-ej-accent-ink bg-ej-accent-soft hover:bg-ej-accent-soft2 transition-colors duration-ej disabled:opacity-40"
          >
            {summarizing ? (
              <LoaderIcon className="size-3 animate-spin" />
            ) : (
              <SparklesIcon className="size-3" />
            )}
            {t("summarize")}
          </button>
        </div>
        <div className="font-literata text-[15px] leading-[1.45] text-ej-ink">
          {media.name}
        </div>
      </div>

      <div className="rounded-ej border border-ej-line overflow-hidden">
        {[
          {
            label: t("models.audio.duration"),
            value: formatDuration(media.duration),
          },
          {
            label: t("models.audio.recordingsCount"),
            value: media.recordingsCount ? media.recordingsCount : 0,
          },
          {
            label: t("models.audio.recordingsDuration"),
            value: formatDuration(media.recordingsDuration, "ms"),
          },
          {
            label: t("models.audio.createdAt"),
            value: formatDateTime(media.createdAt),
          },
        ].map((item, index) => (
          <div
            key={`media-info-item-${index}`}
            className="flex items-center justify-between gap-3 px-3 py-2 border-b border-ej-line last:border-b-0"
          >
            <span className="text-xs text-ej-muted capitalize">
              {item.label}
            </span>
            <span className="text-xs font-semibold ej-tabular text-ej-ink">
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
