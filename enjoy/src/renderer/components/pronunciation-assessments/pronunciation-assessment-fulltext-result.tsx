import { t } from "i18next";
import { useState, useMemo, useCallback } from "react";
import { PronunciationAssessmentWordResult } from "@renderer/components";
import { Switch } from "@renderer/components/ui";
import { InfoIcon } from "lucide-react";
import { cn } from "@renderer/lib/utils";

type ErrorKey =
  | "mispronunciation"
  | "omission"
  | "insertion"
  | "unexpectedBreak"
  | "missingBreak"
  | "monotone";

/** Error type as reported by Azure Speech, paired with its swatch. */
const ERROR_TYPES: {
  key: ErrorKey;
  errorType: string;
  labelKey: string;
  explainationKey: string;
  swatch: string;
}[] = [
  {
    key: "mispronunciation",
    errorType: "Mispronunciation",
    labelKey: "models.pronunciationAssessment.errors.misspronunciation",
    explainationKey:
      "models.pronunciationAssessment.explainations.misspronunciation",
    swatch: "bg-ej-warn",
  },
  {
    key: "omission",
    errorType: "Omission",
    labelKey: "models.pronunciationAssessment.errors.omission",
    explainationKey: "models.pronunciationAssessment.explainations.omission",
    swatch: "bg-ej-muted",
  },
  {
    key: "insertion",
    errorType: "Insertion",
    labelKey: "models.pronunciationAssessment.errors.insertion",
    explainationKey: "models.pronunciationAssessment.explainations.insertion",
    swatch: "bg-ej-bad",
  },
  {
    key: "unexpectedBreak",
    errorType: "UnexpectedBreak",
    labelKey: "models.pronunciationAssessment.errors.unexpectedBreak",
    explainationKey:
      "models.pronunciationAssessment.explainations.unexpectedBreak",
    swatch: "bg-ej-pitch",
  },
  {
    key: "missingBreak",
    errorType: "MissingBreak",
    labelKey: "models.pronunciationAssessment.errors.missingBreak",
    explainationKey:
      "models.pronunciationAssessment.explainations.missingBreak",
    swatch: "bg-ej-line2",
  },
  {
    key: "monotone",
    errorType: "Monotone",
    labelKey: "models.pronunciationAssessment.errors.monotone",
    explainationKey: "models.pronunciationAssessment.explainations.monotone",
    swatch: "bg-ej-accent",
  },
];

export const PronunciationAssessmentFulltextResult = (props: {
  words: PronunciationAssessmentWordResultType[];
  currentTime?: number;
  src?: string;
  onPlayOrigin?: (word: string, index: number) => void;
  className?: string;
}) => {
  const { words, currentTime, src, onPlayOrigin, className } = props;
  const [errorDisplay, setErrorDisplay] = useState<Record<ErrorKey, boolean>>({
    mispronunciation: true,
    omission: true,
    insertion: true,
    unexpectedBreak: true,
    missingBreak: true,
    monotone: true,
  });

  const errorStats = useMemo(() => {
    const stats = {} as Record<ErrorKey, number>;
    ERROR_TYPES.forEach((type) => {
      stats[type.key] = words.filter(
        (w) => w.pronunciationAssessment?.errorType === type.errorType
      ).length;
    });
    return stats;
  }, [words]);

  const handlePlayOrigin = useCallback(
    (word: string, index: number) => {
      if (!onPlayOrigin) return;
      onPlayOrigin(word, index);
    },
    [onPlayOrigin]
  );

  return (
    <div
      className={cn(
        "min-h-72 grid gap-4 grid-cols-1 lg:grid-cols-[1fr_240px]",
        className
      )}
    >
      <div className="min-w-0 rounded-ej-lg border border-ej-line bg-ej-surface2/30 px-4 py-4">
        <div className="flex items-start flex-wrap gap-x-0.5 gap-y-1">
          {words.map((result, index: number) => (
            <PronunciationAssessmentWordResult
              key={index}
              result={result}
              errorDisplay={errorDisplay}
              currentTime={currentTime}
              src={src}
              onPlayOrigin={() => {
                const word = words[index];
                const candidates = words.filter((w) => w.word === word.word);
                const wordIndex = candidates.findIndex(
                  (w) => w.offset === word.offset
                );
                handlePlayOrigin(word.word, wordIndex);
              }}
            />
          ))}
        </div>
      </div>

      <div className="min-w-0 rounded-ej-lg border border-ej-line bg-ej-surface p-3">
        <div className="ej-label mb-3">{t("errors")}</div>

        <div className="space-y-1">
          {ERROR_TYPES.map((type) => (
            <div
              key={type.key}
              className="flex items-center justify-between gap-2 py-1"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={cn(
                    "shrink-0 min-w-5 h-5 px-1 rounded-md text-white text-xxs font-bold ej-tabular inline-flex items-center justify-center",
                    type.swatch
                  )}
                >
                  {errorStats[type.key]}
                </span>
                <span className="text-xs text-ej-ink2 truncate">
                  {t(type.labelKey)}
                </span>
                <InfoIcon
                  data-tooltip-id="recording-tooltip"
                  data-tooltip-content={t(type.explainationKey)}
                  className="size-3 shrink-0 cursor-pointer text-ej-muted"
                />
              </div>

              <Switch
                className="shrink-0"
                checked={errorDisplay[type.key]}
                onClick={() =>
                  setErrorDisplay({
                    ...errorDisplay,
                    [type.key]: !errorDisplay[type.key],
                  })
                }
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
