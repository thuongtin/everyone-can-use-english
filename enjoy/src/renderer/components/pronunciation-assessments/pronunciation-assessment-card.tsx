import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@renderer/components/ui";
import {
  EjButton,
  EjIconButton,
  Pill,
  ScoreRing,
} from "@renderer/components/enjoy";
import { scoreColor } from "@renderer/components";
import { t } from "i18next";
import { formatDateTime } from "@renderer/lib/utils";
import { MoreHorizontalIcon, Trash2Icon } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@renderer/lib/utils";

export const PronunciationAssessmentCard = (props: {
  pronunciationAssessment: PronunciationAssessmentType;
  onSelect: (assessment: PronunciationAssessmentType) => void;
  onDelete: (assessment: PronunciationAssessmentType) => void;
  /** Denser row used by the fluid 400px sidebar. */
  compact?: boolean;
  /** Highlights the row shown in the detail pane. */
  active?: boolean;
}) => {
  const {
    pronunciationAssessment: assessment,
    onSelect,
    onDelete,
    compact,
    active,
  } = props;
  const sourceType = assessment.target?.targetType;

  return (
    <div
      data-testid={`pronunciation-assessment-card-${assessment.id}`}
      onClick={compact ? () => onSelect(assessment) : undefined}
      className={cn(
        "flex transition-all duration-ej hover:shadow-ej",
        compact
          ? "cursor-pointer gap-3 rounded-ej border p-3.5"
          : "gap-5 rounded-ej-lg border border-ej-line bg-ej-surface p-5 hover:-translate-y-0.5 hover:border-ej-line2",
        compact && active
          ? "border-ej-accent bg-ej-accent-soft"
          : compact && "border-ej-line bg-ej-surface hover:border-ej-line2"
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <blockquote
          className={cn(
            "select-text border-l-2 border-ej-accent-soft2 pl-3 font-literata text-ej-ink",
            compact
              ? "mb-2.5 text-[13px] leading-5 line-clamp-2"
              : "mb-4 text-[15px] leading-6 line-clamp-2"
          )}
        >
          {assessment.referenceText ||
            assessment.target?.referenceText ||
            "-"}
        </blockquote>

        <PronunciationAssessmentScoreDetail
          assessment={assessment}
          accuracyScore={!compact}
          fluencyScore={!compact}
          completenessScore={!compact}
          prosodyScore={!compact}
          grammarScore={!compact}
          vocabularyScore={!compact}
          topicScore={!compact}
        />

        {!compact && ["Audio", "Video"].includes(sourceType) && (
          <div className="mt-3 flex items-center gap-2">
            <span className="ej-label">{t("source")}</span>
            <Link
              to={`/${sourceType.toLowerCase()}s/${
                assessment.target.targetId
              }?segmentIndex=${assessment.target.referenceId}`}
              className="text-xxs font-semibold text-ej-accent-ink hover:underline"
            >
              {t(sourceType.toLowerCase())}
            </Link>
          </div>
        )}

        <div
          className={cn(
            "mt-auto flex items-center gap-2",
            compact ? "pt-2.5" : "pt-4"
          )}
        >
          {!compact && assessment.language && (
            <Pill tone="muted">{assessment.language}</Pill>
          )}
          <span className="ej-tabular text-xxs text-ej-muted">
            {formatDateTime(assessment.createdAt)}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <EjIconButton
                aria-label={t("more")}
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontalIcon className="size-3.5" />
              </EjIconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => onDelete(assessment)}
              >
                <Trash2Icon className="mr-2 size-3.5 text-ej-bad" />
                <span className="text-ej-bad">{t("delete")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-center justify-between gap-3">
        <ScoreRing
          size={compact ? 46 : 76}
          score={assessment.pronunciationScore}
        />
        {!compact && (
          <EjButton size="sm" onClick={() => onSelect(assessment)}>
            {t("detail")}
          </EjButton>
        )}
      </div>
    </div>
  );
};

export const PronunciationAssessmentScoreDetail = (props: {
  assessment: PronunciationAssessmentType;
  pronunciationScore?: boolean;
  accuracyScore?: boolean;
  fluencyScore?: boolean;
  completenessScore?: boolean;
  prosodyScore?: boolean;
  grammarScore?: boolean;
  vocabularyScore?: boolean;
  topicScore?: boolean;
}) => {
  const {
    assessment,
    pronunciationScore = true,
    accuracyScore = true,
    fluencyScore = true,
    completenessScore = true,
    prosodyScore = true,
    grammarScore = true,
    vocabularyScore = true,
    topicScore = true,
  } = props;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {[
        {
          label: t("models.pronunciationAssessment.pronunciationScore"),
          value: assessment.pronunciationScore,
          show: pronunciationScore,
        },
        {
          label: t("models.pronunciationAssessment.accuracyScore"),
          value: assessment.accuracyScore,
          show: accuracyScore,
        },
        {
          label: t("models.pronunciationAssessment.fluencyScore"),
          value: assessment.fluencyScore,
          show: fluencyScore,
        },
        {
          label: t("models.pronunciationAssessment.completenessScore"),
          value: assessment.completenessScore,
          show: completenessScore,
        },
        {
          label: t("models.pronunciationAssessment.prosodyScore"),
          value: assessment.prosodyScore,
          show: prosodyScore,
        },
        {
          label: t("models.pronunciationAssessment.grammarScore"),
          value: assessment.grammarScore,
          show: grammarScore,
        },
        {
          label: t("models.pronunciationAssessment.vocabularyScore"),
          value: assessment.vocabularyScore,
          show: vocabularyScore,
        },
        {
          label: t("models.pronunciationAssessment.topicScore"),
          value: assessment.topicScore,
          show: topicScore,
        },
      ].map(({ label, value, show }) => {
        if (show && typeof value === "number") {
          return (
            <div key={label} className="flex items-baseline gap-1.5">
              <span className="ej-label">{label}</span>
              <span
                className={`ej-tabular text-xs font-bold ${scoreColor(
                  value || 0
                )}`}
              >
                {value}
              </span>
            </div>
          );
        }
      })}
    </div>
  );
};
