import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { t } from "i18next";
import cloneDeep from "lodash/cloneDeep";
import {
  ArrowLeftRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GaugeCircleIcon,
  SpeechIcon,
  Volume2Icon,
} from "lucide-react";
import {
  AISettingsProviderContext,
  AppSettingsProviderContext,
  MediaShadowProviderContext,
  useLayout,
} from "@renderer/context";
import { toast } from "@renderer/components/ui";
import {
  MediaCaption,
  MediaCaptionActions,
  MediaCaptionAnalysis,
  MediaCaptionNote,
  MediaCaptionTranslation,
} from "@renderer/components";
import { countAnalysisPoints } from "./media-caption-analysis";
import { MediaCaptionSection } from "./media-caption-section";
import { LookupAnchor, MediaCaptionLookup } from "./media-caption-lookup";
import { EjIconButton } from "@renderer/components/enjoy";
import { cn } from "@renderer/lib/utils";
import { speakText } from "@renderer/lib/speak";
import {
  captionIpas,
  formatTimestamp,
  scoreTone,
  splitCaptionWords,
  WEAK_SCORE,
  wordScoresFor,
} from "./caption-words";

const POPOVER_MAX_WIDTH = 300;
const POPOVER_MARGIN = 12;
/** Rough height of the popover, used to decide whether the pane must scroll. */
const POPOVER_HEIGHT = 200;

const DOT_TONE: Record<string, string> = {
  ok: "bg-ej-ok",
  warn: "bg-ej-warn",
  bad: "bg-ej-bad",
};

type SectionKey = "translation" | "notes" | "analysis";

export const MediaRightPanel = (props: {
  className?: string;
  setDisplayPanel?: (displayPanel: "left" | "right" | null) => void;
}) => {
  const { className, setDisplayPanel } = props;
  const {
    caption,
    currentSegmentIndex,
    setCurrentSegmentIndex,
    currentTime,
    transcription,
    currentRecording,
    currentNotes,
    regions,
    activeRegion,
    setActiveRegion,
    toggleRegion,
    editingRegion,
    setEditingRegion,
    setTranscriptionDraft,
    layout,
  } = useContext(MediaShadowProviderContext);
  const { learningLanguage, ipaMappings } = useContext(
    AppSettingsProviderContext
  );
  const { currentGptEngine } = useContext(AISettingsProviderContext);
  const { fluid } = useLayout();

  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [multiSelecting, setMultiSelecting] = useState<boolean>(false);

  const [displayIpa, setDisplayIpa] = useState<boolean>(true);
  const [scoreMarks, setScoreMarks] = useState<boolean>(true);
  const [markNotedWords, setMarkNotedWords] = useState<boolean>(true);
  const [paneMenu, setPaneMenu] = useState<boolean>(false);

  const [secOpen, setSecOpen] = useState<Record<SectionKey, boolean>>({
    translation: true,
    notes: true,
    analysis: true,
  });
  const [translation, setTranslation] = useState<string>();
  const [analysis, setAnalysis] = useState<string>();

  const [anchor, setAnchor] = useState<LookupAnchor>();
  const paneRef = useRef<HTMLDivElement>(null);

  const language = transcription?.language || learningLanguage;
  const words = useMemo(
    () => (caption ? splitCaptionWords(caption) : []),
    [caption]
  );
  const ipas = useMemo(
    () => (caption ? captionIpas(caption, language, ipaMappings) : []),
    [caption, language, ipaMappings]
  );

  const assessment = currentRecording?.pronunciationAssessment;
  const wordScores = useMemo(
    () => wordScoresFor(words, assessment?.result?.words || []),
    [words, assessment]
  );
  const weakCount = useMemo(
    () =>
      Array.from(wordScores.values()).filter((score) => score < WEAK_SCORE)
        .length,
    [wordScores]
  );
  const hasScores = Boolean(assessment) && wordScores.size > 0;

  const notedIndices = useMemo(() => {
    if (!markNotedWords) return [];

    return (currentNotes || []).flatMap(
      (note) => note.parameters?.quoteIndices || []
    );
  }, [currentNotes, markNotedWords]);

  const totalSegments = transcription?.result?.timeline?.length || 0;
  const selectedWord = selectedIndices
    .map((index) => words[index])
    .filter(Boolean)
    .join(" ");

  const toggleMultiSelect = (event: KeyboardEvent) => {
    setMultiSelecting(event.shiftKey && event.type === "keydown");
  };

  const closeLookup = () => {
    setAnchor(undefined);
    setSelectedIndices([]);
  };

  /** Places the popover under the word, kept inside the pane on both sides. */
  const anchorTo = (element: HTMLElement): LookupAnchor => {
    const pane = paneRef.current;
    const paneRect = pane.getBoundingClientRect();
    const rect = element.getBoundingClientRect();

    const width = Math.min(POPOVER_MAX_WIDTH, paneRect.width - 2 * POPOVER_MARGIN);
    const center = rect.left + rect.width / 2 - paneRect.left;
    const left = Math.min(
      Math.max(center, width / 2 + POPOVER_MARGIN),
      paneRect.width - width / 2 - POPOVER_MARGIN
    );
    const top = rect.bottom - paneRect.top + pane.scrollTop + 10;

    return {
      left,
      top,
      width,
      caret: center - (left - width / 2) - 6,
    };
  };

  const handleWordClick = (index: number, element: HTMLElement) => {
    if (editingRegion) {
      toast.warning(t("currentRegionIsBeingEdited"));
      return;
    }

    let indices: number[];
    if (multiSelecting && selectedIndices.length > 0) {
      const min = Math.min(index, ...selectedIndices);
      const max = Math.max(index, ...selectedIndices);
      indices = Array.from({ length: max - min + 1 }, (_, i) => i + min);
    } else if (selectedIndices.length === 1 && selectedIndices[0] === index) {
      closeLookup();
      return;
    } else {
      indices = [index];
    }

    setSelectedIndices(indices);
    setAnchor(anchorTo(element));

    // Keep the popover inside the visible part of the pane.
    const pane = paneRef.current;
    const rect = element.getBoundingClientRect();
    const paneRect = pane.getBoundingClientRect();
    const overflow = rect.bottom + POPOVER_HEIGHT - paneRect.bottom;
    if (overflow > 0) {
      pane.scrollTo({ top: pane.scrollTop + overflow, behavior: "smooth" });
    }
  };

  const handleSpeakSentence = () => {
    if (!speakText(caption.text as string, language)) {
      toast.error(t("bilingual.noSpeechVoice"));
    }
  };

  const handleToggleScoreMarks = () => {
    if (!hasScores) {
      toast.info(t("segment.noRecordingToast"));
      return;
    }
    setScoreMarks(!scoreMarks);
  };

  const openAssessment = () => {
    document.getElementById("media-pronunciation-assessment-button")?.click();
  };

  useEffect(() => {
    if (!caption) return;

    const index = caption.timeline.findIndex(
      (w) => currentTime >= w.startTime && currentTime < w.endTime
    );

    if (index < 0) return;
    if (index !== activeIndex) {
      setActiveIndex(index);
    }
  }, [currentTime, caption]);

  useEffect(() => {
    if (!caption?.timeline) return;
    if (!activeRegion) return;

    toggleRegion(selectedIndices);
  }, [caption, selectedIndices]);

  // Edit region to update transcription draft
  useEffect(() => {
    if (!activeRegion) return;
    if (!activeRegion.id.startsWith("word-region")) return;

    const region = regions.addRegion({
      id: `word-region-${selectedIndices.join("-")}`,
      start: activeRegion.start,
      end: activeRegion.end,
      color: "#fb6f9233",
      drag: false,
      resize: editingRegion,
    });

    activeRegion?.remove();
    setActiveRegion(region);

    const subscriptions = [
      regions.on("region-updated", (region) => {
        if (!region.id.startsWith("word-region")) return;

        const draft = cloneDeep(transcription.result);
        const draftCaption = draft.timeline[currentSegmentIndex];

        const firstIndex = selectedIndices[0];
        const lastIndex = selectedIndices[selectedIndices.length - 1];
        const firstWord = draftCaption.timeline[firstIndex];
        const lastWord = draftCaption.timeline[lastIndex];

        // If no word is selected somehow, then ignore the update.
        if (!firstWord || !lastWord) {
          setEditingRegion(false);
          return;
        }

        firstWord.startTime = region.start;
        lastWord.endTime = region.end;

        /* Update the timeline of the previous and next words
         * It happens only when regions are intersecting with the previous or next word.
         * It will ignore if the previous/next word's position changed in timestamps.
         */
        const prevWord = draftCaption.timeline[firstIndex - 1];
        const nextWord = draftCaption.timeline[lastIndex + 1];
        if (
          prevWord &&
          prevWord.endTime > region.start &&
          prevWord.startTime < region.start
        ) {
          prevWord.endTime = region.start;
        }
        if (
          nextWord &&
          nextWord.startTime < region.end &&
          nextWord.endTime > region.end
        ) {
          nextWord.startTime = region.end;
        }

        /*
         * If the last word is the last word of the segment, then update the segment's end time.
         */
        if (lastIndex === draftCaption.timeline.length - 1) {
          draftCaption.endTime = region.end;
        }

        setTranscriptionDraft(draft);
      }),
    ];

    return () => {
      subscriptions.forEach((unsub) => unsub());
    };
  }, [editingRegion]);

  // Moving to another sentence closes everything that belonged to the old one.
  useEffect(() => {
    return () => {
      setSelectedIndices([]);
      setAnchor(undefined);
      setPaneMenu(false);
      setTranslation(undefined);
      setAnalysis(undefined);
    };
  }, [currentSegmentIndex]);

  useEffect(() => {
    document.addEventListener("keydown", toggleMultiSelect);
    document.addEventListener("keyup", toggleMultiSelect);

    return () => {
      document.removeEventListener("keydown", toggleMultiSelect);
      document.removeEventListener("keyup", toggleMultiSelect);
    };
  }, []);

  if (!transcription) return null;
  if (!caption) return null;

  const overallScore = assessment?.pronunciationScore
    ? Math.round(assessment.pronunciationScore)
    : undefined;

  const sectionMeta: Record<SectionKey, string> = {
    translation: translation
      ? secOpen.translation
        ? currentGptEngine?.name || t("aiAssistant")
        : t("section.hidden")
      : t("section.translation.empty"),
    notes: currentNotes?.length
      ? t("section.notes.count", { count: currentNotes.length })
      : t("section.empty"),
    analysis: analysis
      ? t("section.analysis.done", { count: countAnalysisPoints(analysis) })
      : t("section.analysis.empty"),
  };

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col bg-ej-surface",
        fluid && "border-r border-ej-line",
        className
      )}
    >
      <div className="flex h-[46px] shrink-0 items-center gap-0.5 border-b border-ej-line pl-1.5 pr-2">
        {layout === "compact" && (
          <EjIconButton
            data-tooltip-id="media-shadow-tooltip"
            data-tooltip-content={t("switchPanel")}
            onClick={() => setDisplayPanel?.("left")}
          >
            <ArrowLeftRightIcon className="size-4" />
          </EjIconButton>
        )}

        <EjIconButton
          disabled={currentSegmentIndex <= 0}
          data-tooltip-id="media-shadow-tooltip"
          data-tooltip-content={t("playPreviousSegment")}
          onClick={() => setCurrentSegmentIndex(currentSegmentIndex - 1)}
        >
          <ChevronLeftIcon className="size-4" />
        </EjIconButton>

        <div className="whitespace-nowrap px-1">
          <span className="ej-tabular text-[12.5px] font-bold text-ej-ink">
            {t("segment.counter", { index: currentSegmentIndex + 1 })}
          </span>
          <span className="ej-tabular text-[12.5px] font-medium text-ej-muted">
            /{totalSegments}
          </span>
          <span className="ej-tabular ml-2 text-[11px] text-ej-muted">
            {formatTimestamp(caption.startTime)} -{" "}
            {formatTimestamp(caption.endTime)}
          </span>
        </div>

        <EjIconButton
          disabled={currentSegmentIndex >= totalSegments - 1}
          data-tooltip-id="media-shadow-tooltip"
          data-tooltip-content={t("playNextSegment")}
          onClick={() => setCurrentSegmentIndex(currentSegmentIndex + 1)}
        >
          <ChevronRightIcon className="size-4" />
        </EjIconButton>

        <div className="ml-auto flex items-center gap-0.5">
          <EjIconButton
            active={displayIpa}
            data-tooltip-id="media-shadow-tooltip"
            data-tooltip-content={t("displayIpa")}
            onClick={() => {
              setDisplayIpa(!displayIpa);
              closeLookup();
            }}
          >
            <SpeechIcon className="size-4" />
          </EjIconButton>

          <EjIconButton
            active={hasScores && scoreMarks}
            className={cn(!hasScores && "opacity-40")}
            data-tooltip-id="media-shadow-tooltip"
            data-tooltip-content={
              hasScores
                ? scoreMarks
                  ? t("segment.markWeakOff")
                  : t("segment.markWeak")
                : t("segment.noRecordingForMarks")
            }
            onClick={handleToggleScoreMarks}
          >
            <GaugeCircleIcon className="size-4" />
          </EjIconButton>

          <EjIconButton
            data-tooltip-id="media-shadow-tooltip"
            data-tooltip-content={t("segment.listenSentence")}
            onClick={handleSpeakSentence}
          >
            <Volume2Icon className="size-4" />
          </EjIconButton>

          <MediaCaptionActions
            caption={caption}
            open={paneMenu}
            onOpenChange={setPaneMenu}
            displayIpa={displayIpa}
            markNotedWords={markNotedWords}
            setMarkNotedWords={setMarkNotedWords}
          />
        </div>
      </div>

      <div
        ref={paneRef}
        data-pane="caption"
        className="scroll relative min-h-0 flex-1 overflow-y-auto"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeLookup();
        }}
      >
        <div onClick={(event) => event.stopPropagation()}>
          <MediaCaption
            caption={caption}
            words={words}
            language={language}
            selectedIndices={selectedIndices}
            currentSegmentIndex={currentSegmentIndex}
            activeIndex={activeIndex}
            displayIpa={displayIpa}
            wordScores={scoreMarks && hasScores ? wordScores : undefined}
            notedIndices={notedIndices}
            onWordClick={handleWordClick}
          />

          <div className="mt-3.5 flex min-h-[22px] flex-wrap items-center gap-2.5 px-5">
            {typeof overallScore === "number" && (
              <button
                type="button"
                onClick={openAssessment}
                className="ej-tabular flex h-[22px] items-center gap-1.5 rounded-full border border-ej-line bg-ej-surface pl-[7px] pr-[9px] text-[11px] font-bold text-ej-ink2 transition-colors duration-ej hover:bg-ej-surface2"
              >
                <span
                  className={cn(
                    "size-2 rounded-full",
                    DOT_TONE[scoreTone(overallScore)]
                  )}
                />
                {overallScore}
                <span className="font-medium text-ej-muted">
                  {weakCount > 0
                    ? t("segment.weakWords", { count: weakCount })
                    : t("segment.goodPronunciation")}
                </span>
              </button>
            )}

            {selectedIndices.length === 0 && (
              <span className="text-[11px] text-ej-muted">
                {t("segment.hint")}
              </span>
            )}
          </div>
        </div>

        <div className="mt-4">
          <MediaCaptionSection
            label={t("captionTabs.translation")}
            meta={sectionMeta.translation}
            open={secOpen.translation}
            onToggle={() =>
              setSecOpen({ ...secOpen, translation: !secOpen.translation })
            }
          >
            <MediaCaptionTranslation
              text={caption.text as string}
              onTranslationChange={setTranslation}
            />
          </MediaCaptionSection>

          <MediaCaptionSection
            label={t("captionTabs.note")}
            meta={sectionMeta.notes}
            open={secOpen.notes}
            onToggle={() => setSecOpen({ ...secOpen, notes: !secOpen.notes })}
          >
            <MediaCaptionNote
              selectedIndices={selectedIndices}
              setSelectedIndices={setSelectedIndices}
            />
          </MediaCaptionSection>

          <MediaCaptionSection
            label={t("captionTabs.analysis")}
            meta={sectionMeta.analysis}
            open={secOpen.analysis}
            onToggle={() =>
              setSecOpen({ ...secOpen, analysis: !secOpen.analysis })
            }
            last
          >
            <MediaCaptionAnalysis
              text={caption.text as string}
              onAnalysisChange={setAnalysis}
            />
          </MediaCaptionSection>
        </div>

        {anchor && selectedWord && (
          <MediaCaptionLookup
            anchor={anchor}
            word={selectedWord}
            ipa={
              selectedIndices.length === 1 ? ipas[selectedIndices[0]] : undefined
            }
            isPhrase={selectedIndices.length > 1}
            score={
              selectedIndices.length === 1 && hasScores
                ? wordScores.get(selectedIndices[0])
                : undefined
            }
            onClose={closeLookup}
          />
        )}
      </div>
    </div>
  );
};
