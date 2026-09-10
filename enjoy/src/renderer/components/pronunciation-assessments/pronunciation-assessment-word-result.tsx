import { t } from "i18next";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  ScrollArea,
  ScrollBar,
} from "@renderer/components/ui";
import { EjIconButton } from "@renderer/components/enjoy";
import { scoreChipClass } from "@renderer/lib/design";
import { cn } from "@renderer/lib/utils";
import { Volume2Icon } from "lucide-react";
import { memo, useEffect, useRef } from "react";

export const PronunciationAssessmentWordResult = (props: {
  src?: string;
  result: PronunciationAssessmentWordResultType;
  errorDisplay?: {
    mispronunciation: boolean;
    omission: boolean;
    insertion: boolean;
    unexpectedBreak: boolean;
    missingBreak: boolean;
    monotone: boolean;
  };
  currentTime?: number;
  onPlayOrigin?: () => void;
}) => {
  const {
    result,
    errorDisplay = {
      mispronunciation: true,
      omission: true,
      insertion: true,
      unexpectedBreak: true,
      missingBreak: true,
      monotone: true,
    },
    currentTime = 0,
    onPlayOrigin,
  } = props;

  const audio = useRef<HTMLAudioElement>(null);

  const WordDisplay = {
    None: <CorrectWordDisplay word={result.word} />,
    Mispronunciation: errorDisplay.mispronunciation ? (
      <MispronunciationWordDisplay word={result.word} />
    ) : (
      <CorrectWordDisplay word={result.word} />
    ),
    Omission: errorDisplay.omission ? (
      <OmissionWordDisplay word={result.word} />
    ) : (
      <CorrectWordDisplay word={result.word} />
    ),
    Insertion: errorDisplay.insertion ? (
      <InsertionWordDisplay word={result.word} />
    ) : (
      <CorrectWordDisplay word={result.word} />
    ),
    UnexpectedBreak: errorDisplay.unexpectedBreak ? (
      <UnexpectedBreakWordDisplay word={result.word} />
    ) : (
      <CorrectWordDisplay word={result.word} />
    ),
    MissingBreak: errorDisplay ? (
      <MissingBreakWordDisplay />
    ) : (
      <CorrectWordDisplay word={result.word} />
    ),
    Monotone: errorDisplay ? (
      <MonotoneWordDisplay word={result.word} />
    ) : (
      <CorrectWordDisplay word={result.word} />
    ),
  }[result.pronunciationAssessment.errorType];

  const play = () => {
    if (!audio.current || !props.src) return;

    const { offset, duration } = result;
    if (!offset || !duration) return;

    const startTime = (offset * 1.0) / 1e7;
    const endTime = ((offset + duration) * 1.0) / 1e7;

    audio.current.currentTime = startTime;

    // Add timeupdate listener to stop at the end of the segment
    const handleTimeUpdate = () => {
      if (audio.current.currentTime >= endTime) {
        audio.current.pause();
        audio.current.removeEventListener("timeupdate", handleTimeUpdate);
      }
    };

    audio.current.addEventListener("timeupdate", handleTimeUpdate);
    audio.current.play();
  };

  useEffect(() => {
    if (!audio.current) {
      audio.current = new Audio(props.src);
    }

    return () => {
      if (audio.current) {
        audio.current.pause();
        audio.current.removeEventListener("timeupdate", () => {});
        audio.current = null;
      }
    };
  }, [props.src]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <div className="flex flex-col items-center cursor-pointer">
          <div
            className={cn(
              "underline-offset-4",
              currentTime * 1e7 >= result.offset &&
                currentTime * 1e7 < result.offset + result.duration &&
                "underline decoration-ej-accent decoration-2"
            )}
          >
            {WordDisplay}
          </div>
          <div className="font-ipa text-[11px] leading-[1.3]">
            {result.phonemes.map((phoneme, index) => (
              <span
                key={index}
                className={scoreColor(
                  phoneme.pronunciationAssessment.accuracyScore
                )}
              >
                {phoneme.phoneme}
              </span>
            ))}
          </div>
        </div>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-auto max-w-[320px] rounded-ej-lg border-ej-line bg-ej-surface shadow-ej p-3"
      >
        <div className="flex items-center justify-between gap-3 mb-3">
          <span className="font-literata text-[17px] text-ej-ink">
            {result.word}
          </span>
          <span
            className={cn(
              "px-2 h-5 rounded-full text-xxs font-bold ej-tabular inline-flex items-center",
              scoreChipClass(result.pronunciationAssessment?.accuracyScore)
            )}
          >
            {result.pronunciationAssessment?.accuracyScore ?? "--"}
          </span>
        </div>

        <div className="rounded-ej border border-ej-line bg-ej-surface2/40 px-2 py-2 mb-3">
          <PronunciationAssessmentPhonemeResult result={result} />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-ej-muted">{t("myPronunciation")}</span>
            <EjIconButton onClick={play} title={t("myPronunciation")}>
              <Volume2Icon className="size-4" />
            </EjIconButton>
          </div>
          {onPlayOrigin && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-ej-muted">
                {t("originalPronunciation")}
              </span>
              <EjIconButton
                onClick={onPlayOrigin}
                title={t("originalPronunciation")}
              >
                <Volume2Icon className="size-4" />
              </EjIconButton>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

/** Shared shape for every word chip in the assessment cloud. */
const WORD_BASE =
  "px-1.5 py-0.5 rounded-md font-literata text-[19px] leading-[1.35] tracking-[0.01em] cursor-pointer transition-colors duration-ej";

const CorrectWordDisplay = (props: { word: string }) => (
  <span className={cn(WORD_BASE, "text-ej-ink hover:bg-ej-surface2")}>
    {props.word}
  </span>
);

const MispronunciationWordDisplay = (props: { word: string }) => (
  <span className={cn(WORD_BASE, "bg-ej-warn-soft text-ej-warn")}>
    {props.word}
  </span>
);

const OmissionWordDisplay = (props: { word: string }) => (
  <span className={cn(WORD_BASE, "bg-ej-surface2 text-ej-muted")}>
    [{props.word}]
  </span>
);

const InsertionWordDisplay = (props: { word: string }) => (
  <span className={cn(WORD_BASE, "bg-ej-bad-soft text-ej-bad line-through")}>
    {props.word}
  </span>
);

const UnexpectedBreakWordDisplay = (props: { word: string }) => (
  <span
    className={cn(WORD_BASE, "bg-ej-pitch/15 text-ej-pitch line-through")}
    style={{ color: "var(--ej-pitch)" }}
  >
    [{props.word}]
  </span>
);

const MissingBreakWordDisplay = () => (
  <span className={cn(WORD_BASE, "bg-ej-surface2 text-ej-muted")}>[ ]</span>
);

const MonotoneWordDisplay = (props: { word: string }) => (
  <span className={cn(WORD_BASE, "bg-ej-accent-soft text-ej-accent-ink")}>
    {props.word}
  </span>
);

const scoreColor = (score: number) => {
  if (!score) return "text-ej-muted";

  if (score >= 80) return "text-ej-muted";
  if (score >= 60) return "font-semibold text-ej-warn";

  return "font-semibold text-ej-bad";
};

export const PronunciationAssessmentPhonemeResult = memo(
  (props: { result: PronunciationAssessmentWordResultType }) => {
    const { result } = props;

    return (
      <ScrollArea className="w-full">
        <div className="w-full flex items-center gap-2.5">
          {result.phonemes.map((phoneme, index) => (
            <div key={index} className="text-center shrink-0">
              <div className="font-ipa text-[14px] font-semibold text-ej-ink">
                {phoneme.phoneme}
              </div>
              <div
                className={cn(
                  "text-xxs ej-tabular",
                  scoreColor(phoneme.pronunciationAssessment.accuracyScore)
                )}
              >
                {phoneme.pronunciationAssessment.accuracyScore}
              </div>
            </div>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    );
  }
);
