import { cn } from "@renderer/lib/utils";
import { scoreChipClass } from "@renderer/lib/design";

export const PronunciationAssessmentScoreIcon = (props: {
  score: number;
  size?: number;
  className?: string;
  onClick?: () => void;
}) => {
  const { score, className, onClick } = props;

  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-full font-bold ej-tabular",
        scoreChipClass(score),
        className
      )}
    >
      {score}
    </div>
  );
};
