import { useContext } from "react";
import { t } from "i18next";
import { MediaShadowProviderContext } from "@renderer/context";
import { formatDuration } from "@renderer/lib/utils";
import { transcriptionSpeechReview } from "@/lib/transcription-speech-review";
import type { StudyTimelineEntry } from "@/types/learning-asr";

export const MediaTranscriptionReviewNotice = () => {
  const { transcription, decoded, wavesurfer, setCurrentSegmentIndex } = useContext(MediaShadowProviderContext);
  const gaps = transcriptionSpeechReview(transcription?.result)?.speechGaps;
  if (!gaps?.length) return null;

  return (
    <details
      key={transcription.id}
      className="shrink-0 border-b border-ej-line bg-ej-surface2 px-4 py-2 text-xs text-ej-ink"
      data-testid="transcription-review-notice"
    >
      <summary className="cursor-pointer font-semibold">
        {t("learningAsrReviewNotice", { count: gaps.length })}
      </summary>
      <p className="mt-2 text-ej-muted">{t("learningAsrReviewDescription")}</p>
      <div className="mt-2 flex max-h-24 flex-wrap gap-2 overflow-y-auto" aria-label={t("learningAsrReviewRanges")}>
        {gaps.map((gap, index) => (
          <button
            key={`${gap.startTime}:${gap.endTime}`}
            type="button"
            className="rounded border border-ej-line px-2 py-1 hover:bg-ej-surface disabled:opacity-50"
            data-testid="transcription-review-range"
            disabled={!decoded || !wavesurfer}
            onClick={() => {
              const start = Math.max(0, gap.startTime - 0.5);
              const timeline = transcription.result.timeline as StudyTimelineEntry[];
              const following = timeline.findIndex(sentence => sentence.startTime > start);
              setCurrentSegmentIndex(following < 0 ? timeline.length - 1 : Math.max(0, following - 1));
              wavesurfer.setTime(start);
              wavesurfer.setScrollTime(start);
            }}
            aria-label={t("learningAsrReviewSeek", { start: formatDuration(gap.startTime), end: formatDuration(gap.endTime) })}
          >
            {index + 1}. {formatDuration(gap.startTime)} - {formatDuration(gap.endTime)}
          </button>
        ))}
      </div>
    </details>
  );
};
