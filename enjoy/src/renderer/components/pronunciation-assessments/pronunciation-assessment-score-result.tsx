import { t } from "i18next";
import { cn } from "@renderer/lib/utils";
import { InfoIcon, LoaderIcon, SparklesIcon } from "lucide-react";
import { ScoreBar, ScoreRing } from "@renderer/components/enjoy";

export const PronunciationAssessmentScoreResult = (props: {
  pronunciationScore?: number;
  accuracyScore?: number;
  fluencyScore?: number;
  completenessScore?: number;
  prosodyScore?: number;
  assessing?: boolean;
  onAssess?: () => void;
}) => {
  const {
    assessing = false,
    onAssess,
    pronunciationScore,
    accuracyScore,
    fluencyScore,
    completenessScore,
    prosodyScore,
  } = props;

  const bars = [
    {
      score: accuracyScore,
      label: t("models.pronunciationAssessment.accuracyScore"),
      explaination: t(
        "models.pronunciationAssessment.explainations.accuracyScore"
      ),
    },
    {
      score: completenessScore,
      label: t("models.pronunciationAssessment.completenessScore"),
      explaination: t(
        "models.pronunciationAssessment.explainations.completenessScore"
      ),
    },
    {
      score: fluencyScore,
      label: t("models.pronunciationAssessment.fluencyScore"),
      explaination: t(
        "models.pronunciationAssessment.explainations.fluencyScore"
      ),
    },
    {
      score: prosodyScore,
      label: t("models.pronunciationAssessment.prosodyScore"),
      explaination: t(
        "models.pronunciationAssessment.explainations.prosodyScore"
      ),
    },
  ].filter((bar) => bar.score !== undefined && bar.score !== null);

  return (
    <div className="flex-1 p-6 flex items-center justify-center relative">
      <div
        className={cn(
          "w-full max-w-[620px] flex flex-col md:flex-row items-center gap-8",
          pronunciationScore ? "" : "blur-sm select-none"
        )}
      >
        <div className="shrink-0 flex flex-col items-center gap-3">
          <ScoreRing
            score={pronunciationScore}
            size={150}
            label={t("pronunciationAssessment")}
          />

          <div className="flex items-center gap-3">
            {[
              { className: "bg-ej-bad", range: "0-59" },
              { className: "bg-ej-warn", range: "60-79" },
              { className: "bg-ej-ok", range: "80-100" },
            ].map((legend) => (
              <span
                key={legend.range}
                className="flex items-center gap-1 text-xxs text-ej-muted"
              >
                <span
                  className={cn("size-2 rounded-full", legend.className)}
                />
                <span className="ej-tabular">{legend.range}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="flex-1 min-w-0 w-full space-y-4">
          {bars.map((bar) => (
            <ScoreBar
              key={bar.label}
              label={bar.label}
              score={bar.score}
              hint={
                <InfoIcon
                  data-tooltip-id="recording-tooltip"
                  data-tooltip-content={bar.explaination}
                  className="size-3 shrink-0 cursor-pointer text-ej-muted"
                />
              }
            />
          ))}
        </div>
      </div>

      {!pronunciationScore && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-ej-surface/40">
          <button
            type="button"
            disabled={assessing}
            onClick={onAssess}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-ej-accent text-white text-[13px] font-semibold shadow-ej hover:bg-ej-accent-ink transition-colors duration-ej disabled:opacity-50"
          >
            {assessing ? (
              <LoaderIcon className="size-4 animate-spin" />
            ) : (
              <SparklesIcon className="size-4" />
            )}
            {t("pronunciationAssessment")}
          </button>
        </div>
      )}
    </div>
  );
};

export const scoreColor = (score: number, type: "text" | "bg" = "text") => {
  if (!score) return type == "text" ? "text-ej-muted" : "bg-ej-surface2";

  if (score >= 80) return type == "text" ? "text-ej-ok" : "bg-ej-ok";
  if (score >= 60) return type == "text" ? "text-ej-warn" : "bg-ej-warn";

  return type == "text" ? "text-ej-bad" : "bg-ej-bad";
};
