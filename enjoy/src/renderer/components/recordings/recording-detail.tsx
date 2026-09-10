import {
  PronunciationAssessmentFulltextResult,
  PronunciationAssessmentScoreResult,
  WavesurferPlayer,
} from "@renderer/components";
import { toast } from "@renderer/components/ui";
import { useState, useContext, useEffect } from "react";
import { AppSettingsProviderContext } from "@renderer/context";
import { Tooltip } from "react-tooltip";
import { usePronunciationAssessments } from "@renderer/hooks";
import { t } from "i18next";

export const RecordingDetail = (props: {
  recording: RecordingType;
  pronunciationAssessment?: PronunciationAssessmentType;
  onAssess?: (assessment: PronunciationAssessmentType) => void;
  onPlayOrigin?: (word: string, index: number) => void;
}) => {
  const { recording, onAssess, onPlayOrigin } = props;
  if (!recording) return;

  const [pronunciationAssessment, setPronunciationAssessment] =
    useState<PronunciationAssessmentType>(
      props.pronunciationAssessment || recording.pronunciationAssessment
    );
  const { result } = pronunciationAssessment || {};
  const [currentTime, setCurrentTime] = useState<number>(0);

  const { learningLanguage } = useContext(AppSettingsProviderContext);
  const { createAssessment } = usePronunciationAssessments();
  const [assessing, setAssessing] = useState(false);

  const assess = () => {
    if (assessing) return;
    if (result) return;

    if (recording.duration > 60 * 1000) {
      toast.error(t("recordingIsTooLongToAssess"));
      return;
    }
    setAssessing(true);
    createAssessment({
      recording,
      reference: recording.referenceText?.replace(/[—]/g, ", ") || "",
      language: recording.language || learningLanguage,
    })
      .then((assessment) => {
        onAssess && onAssess(assessment);
        setPronunciationAssessment(assessment);
      })
      .catch((err) => {
        toast.error(err.message);
      })
      .finally(() => {
        setAssessing(false);
      });
  };

  useEffect(() => {
    assess();
  }, [recording]);

  return (
    <div className="space-y-4">
      <div className="rounded-ej-lg border border-ej-line bg-ej-surface2/30 px-3 py-3">
        <WavesurferPlayer
          id={recording.id}
          src={recording.src}
          setCurrentTime={setCurrentTime}
        />
      </div>

      {result ? (
        <PronunciationAssessmentFulltextResult
          words={result.words}
          currentTime={currentTime}
          src={recording.src}
          onPlayOrigin={onPlayOrigin}
        />
      ) : (
        <div className="min-h-72 rounded-ej-lg border border-ej-line bg-ej-surface2/30 px-5 py-4 select-text overflow-y-auto scroll">
          {(recording?.referenceText || "").split("\n").map((line, index) => (
            <div
              key={index}
              className="font-literata text-[19px] leading-[1.6] text-ej-ink mb-2"
            >
              {line}
            </div>
          ))}
        </div>
      )}

      <div className="rounded-ej-lg border border-ej-line bg-ej-surface flex">
        <PronunciationAssessmentScoreResult
          pronunciationScore={pronunciationAssessment?.pronunciationScore}
          accuracyScore={pronunciationAssessment?.accuracyScore}
          fluencyScore={pronunciationAssessment?.fluencyScore}
          completenessScore={pronunciationAssessment?.completenessScore}
          prosodyScore={pronunciationAssessment?.prosodyScore}
          assessing={assessing}
          onAssess={assess}
        />
      </div>

      <Tooltip id="recording-tooltip" />
    </div>
  );
};
