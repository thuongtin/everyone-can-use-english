import { useContext, useEffect, useState } from "react";
import {
  AppSettingsProviderContext,
  DbProviderContext,
  MediaShadowProviderContext,
} from "@renderer/context";
import { MediaProvider } from "@renderer/components";
import { t } from "i18next";
import { cn } from "@renderer/lib/utils";
import { scoreColor } from "@renderer/lib/design";

/**
 * The pinned video stage: a dark 16:9 frame with source badges and a thin
 * progress bar whose ticks are colored by the score of every practiced segment.
 */
export const MediaVideoStage = () => {
  const { media, transcription } = useContext(MediaShadowProviderContext);

  if (!media) return null;

  const language = (media.language || transcription?.language || "")
    .split("-")[0]
    .toUpperCase();
  const height = media.metadata?.streams?.find(
    (stream: any) => stream.codec_type === "video"
  )?.height;

  const badges = [height ? `${height}p` : null, language || null].filter(
    Boolean
  );

  return (
    <div
      className="shrink-0 border-b border-ej-line bg-[#0f1114]"
      data-testid="media-video-stage"
    >
      <div className="relative flex items-center justify-center">
        <div
          className="w-full max-w-[min(760px,calc(38vh*16/9))] aspect-video"
          data-testid="media-video-frame"
        >
          <MediaProvider className="size-full px-0 py-0" />
        </div>

        <div className="absolute left-3 top-3 flex items-center gap-1.5 pointer-events-none">
          {badges.length > 0 && (
            <span className="px-2 h-5 rounded-full bg-black/55 text-white/85 text-xxs font-semibold inline-flex items-center backdrop-blur-sm">
              {badges.join(" · ")}
            </span>
          )}
          <span className="px-2 h-5 rounded-full bg-ej-pitch/85 text-white text-xxs font-semibold inline-flex items-center">
            {t("shadowMode")}
          </span>
        </div>
      </div>

      <MediaVideoProgress />
    </div>
  );
};

const MediaVideoProgress = () => {
  const { media, transcription, currentTime, wavesurfer, setCurrentSegmentIndex } =
    useContext(MediaShadowProviderContext);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { addDblistener, removeDbListener } = useContext(DbProviderContext);
  const [stats, setStats] = useState<SegementRecordingStatsType>([]);

  const timeline = transcription?.result?.timeline || [];
  const duration = media?.duration || 0;

  const fetchStats = async () => {
    if (!media) return;

    EnjoyApp.recordings
      .groupBySegment(media.id, media.mediaType)
      .then((result) => setStats(result));
  };

  useEffect(() => {
    if (!transcription?.result) return;

    addDblistener(fetchStats);
    fetchStats();

    return () => {
      removeDbListener(fetchStats);
    };
  }, [transcription?.result]);

  if (!duration || timeline.length === 0) return null;

  const progress = Math.min(100, (currentTime / duration) * 100);

  return (
    <div
      className="relative h-1 w-full bg-white/10 cursor-pointer"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = (event.clientX - rect.left) / rect.width;
        const time = Math.max(0, Math.min(duration, ratio * duration));
        const index = timeline.findIndex(
          (entry: any) => entry.startTime <= time && entry.endTime > time
        );

        wavesurfer?.setTime(time);
        wavesurfer?.setScrollTime(time);
        if (index > -1) setCurrentSegmentIndex(index);
      }}
    >
      <div
        className="absolute inset-y-0 left-0 bg-white/35"
        style={{ width: `${progress}%` }}
      />

      {stats.map((stat) => {
        const entry = timeline[stat.referenceId as number];
        if (!entry) return null;

        const left = (entry.startTime / duration) * 100;
        const width = Math.max(
          0.35,
          ((entry.endTime - entry.startTime) / duration) * 100
        );

        return (
          <span
            key={stat.referenceId}
            className={cn("absolute inset-y-0 rounded-full")}
            style={{
              left: `${left}%`,
              width: `${width}%`,
              background: scoreColor(
                stat.pronunciationAssessment?.pronunciationScore
              ),
            }}
          />
        );
      })}
    </div>
  );
};
