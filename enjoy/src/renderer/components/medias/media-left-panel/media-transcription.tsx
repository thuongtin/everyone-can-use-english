import { useEffect, useContext, useRef, useState } from "react";
import {
  AppSettingsProviderContext,
  DbProviderContext,
  MediaShadowProviderContext,
} from "@renderer/context";
import { t } from "i18next";
import { LoaderIcon, MicIcon, PencilLineIcon } from "lucide-react";
import { AlignmentResult } from "echogarden/dist/api/API.d.js";
import { cn, formatDuration } from "@renderer/lib/utils";
import { scoreChipClass } from "@renderer/lib/design";
import { Equalizer, EjEmptyState } from "@renderer/components/enjoy";
import { Sentence } from "@renderer/components";
import { useAiCommand } from "@renderer/hooks";
import { md5 } from "js-md5";

export const MediaTranscription = (props: {
  display?: boolean;
  displayTranslation?: boolean;
}) => {
  const { display, displayTranslation = false } = props;
  const containerRef = useRef<HTMLDivElement>();
  const {
    decoded,
    media,
    currentSegmentIndex,
    wavesurfer,
    setCurrentSegmentIndex,
    transcription,
    transcribing,
    transcribingProgress,
  } = useContext(MediaShadowProviderContext);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { addDblistener, removeDbListener } = useContext(DbProviderContext);

  const [recordingStats, setRecordingStats] =
    useState<SegementRecordingStatsType>([]);

  const [notesStats, setNotesStats] = useState<
    {
      targetId: string;
      targetType: string;
      count: number;
      segment: SegmentType;
    }[]
  >([]);

  const [playing, setPlaying] = useState(false);

  const fetchSegmentStats = async () => {
    if (!media) return;

    EnjoyApp.recordings
      .groupBySegment(media.id, media.mediaType)
      .then((stats) => {
        setRecordingStats(stats);
      });

    EnjoyApp.notes.groupBySegment(media.id, media.mediaType).then((stats) => {
      setNotesStats(stats);
    });
  };

  const scrollToCurrentSegment = () => {
    if (!containerRef?.current) return;
    if (!decoded) return;
    if (!display) return;

    setTimeout(() => {
      containerRef.current
        ?.querySelector(`#segment-${currentSegmentIndex}`)
        ?.scrollIntoView({
          block: "center",
          inline: "center",
        } as ScrollIntoViewOptions);
    }, 300);
  };

  useEffect(() => {
    if (!transcription?.result) return;

    addDblistener(fetchSegmentStats);
    fetchSegmentStats();

    return () => {
      removeDbListener(fetchSegmentStats);
    };
  }, [transcription?.result]);

  useEffect(() => {
    scrollToCurrentSegment();
  }, [display, decoded, currentSegmentIndex, transcription, containerRef]);

  useEffect(() => {
    if (!wavesurfer) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    wavesurfer.on("play", onPlay);
    wavesurfer.on("pause", onPause);
    wavesurfer.on("finish", onPause);
    setPlaying(wavesurfer.isPlaying());

    return () => {
      wavesurfer.un("play", onPlay);
      wavesurfer.un("pause", onPause);
      wavesurfer.un("finish", onPause);
    };
  }, [wavesurfer]);

  if (!transcription?.result?.timeline) {
    const processing = transcribing || transcription?.state === "processing";

    return (
      <div className="px-6 py-10">
        <EjEmptyState
          kicker={
            processing ? (
              <span className="inline-flex items-center gap-1.5">
                <LoaderIcon className="size-3 animate-spin" />
                {transcribingProgress > 0 ? `${transcribingProgress}%` : null}
              </span>
            ) : (
              t("transcript")
            )
          }
          title={processing ? t("transcribing") : t("noTranscription")}
          description={processing ? undefined : t("transcribeToStartShadowing")}
        />
      </div>
    );
  }

  return (
    <div ref={containerRef} data-testid="media-transcription-result">
      {(transcription.result as AlignmentResult).timeline.map(
        (sentence, index) => {
          const active = currentSegmentIndex === index;
          const stat = recordingStats.find((s) => s.referenceId === index);
          const score = stat?.pronunciationAssessment?.pronunciationScore;
          const noted =
            (notesStats || []).findIndex(
              (s) => s.segment?.segmentIndex === index
            ) !== -1;

          return (
            <div
              key={index}
              id={`segment-${index}`}
              className={cn(
                "flex gap-2 px-3 py-2 cursor-pointer border-l-2 transition-colors duration-ej",
                active
                  ? "bg-ej-hl border-ej-accent"
                  : "border-transparent hover:bg-ej-surface2/70"
              )}
              onClick={() => {
                wavesurfer.setTime(parseFloat(sentence.startTime.toFixed(6)));
                wavesurfer.setScrollTime(sentence.startTime);
                setCurrentSegmentIndex(index);
              }}
            >
              <div className="w-11 shrink-0 flex flex-col items-end gap-0.5 pt-[3px]">
                <span
                  className={cn(
                    "text-xxs font-bold ej-tabular",
                    active ? "text-ej-hl-ink" : "text-ej-muted"
                  )}
                >
                  #{index + 1}
                </span>
                <span
                  className={cn(
                    "text-xxs ej-tabular",
                    active ? "text-ej-hl-ink/70" : "text-ej-muted"
                  )}
                >
                  {formatDuration(sentence.startTime, "s")}
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <Sentence
                  className={cn(
                    "font-literata text-[15.5px] leading-[1.55]",
                    active ? "text-ej-hl-ink" : "text-ej-ink"
                  )}
                  sentence={sentence.text}
                />

                {displayTranslation && (
                  <SegmentTranslation text={sentence.text} active={active} />
                )}
              </div>

              <div className="w-10 shrink-0 flex flex-col items-end gap-1 pt-[3px]">
                {active && playing && <Equalizer />}

                {typeof score === "number" && (
                  <span
                    className={cn(
                      "px-1.5 h-4 rounded-full text-xxs font-bold ej-tabular inline-flex items-center",
                      scoreChipClass(score)
                    )}
                  >
                    {Math.round(score)}
                  </span>
                )}

                <div className="flex items-center gap-1">
                  {stat && <MicIcon className="size-3 text-ej-accent" />}
                  {noted && <PencilLineIcon className="size-3 text-ej-accent" />}
                </div>
              </div>
            </div>
          );
        }
      )}
    </div>
  );
};

/**
 * Renders the cached AI translation of a sentence. Only the sentence currently
 * being played is translated on the fly, so turning the toggle on never fires
 * one request per line.
 */
const SegmentTranslation = (props: { text: string; active?: boolean }) => {
  const { text, active = false } = props;
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { translate } = useAiCommand();
  const [translation, setTranslation] = useState<string>();
  const [translating, setTranslating] = useState(false);

  useEffect(() => {
    let stale = false;
    const cacheKey = `translate-${md5(text)}`;

    EnjoyApp.cacheObjects.get(cacheKey).then((cached) => {
      if (stale) return;

      if (cached) {
        setTranslation(cached);
        return;
      }

      setTranslation(undefined);
      if (!active) return;

      setTranslating(true);
      translate(text, cacheKey)
        .then((result) => {
          if (stale || !result) return;
          setTranslation(result);
        })
        .catch(() => {})
        .finally(() => {
          if (!stale) setTranslating(false);
        });
    });

    return () => {
      stale = true;
    };
  }, [text, active]);

  if (translating) {
    return (
      <div className="mt-1 flex items-center gap-1.5 text-xs text-ej-muted">
        <LoaderIcon className="size-3 animate-spin" />
        {t("translating")}
      </div>
    );
  }

  if (!translation) return null;

  return (
    <div className="mt-1 text-xs leading-[1.5] text-ej-muted">{translation}</div>
  );
};
