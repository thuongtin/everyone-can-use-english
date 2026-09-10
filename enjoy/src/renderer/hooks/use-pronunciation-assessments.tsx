import { useContext } from "react";
import { AppSettingsProviderContext } from "@renderer/context";

export const usePronunciationAssessments = () => {
  const { EnjoyApp } = useContext(AppSettingsProviderContext);

  // Keep the exported name until the form is migrated independently. The
  // readiness check now covers only the direct Azure Speech configuration.
  const ensureEnjoyAiConfigured = async (): Promise<void> => {
    const config = await EnjoyApp.speeches.getAzureConfig();
    if (!config.configured) {
      throw new Error(
        "Chưa cấu hình Azure Speech. Hãy nhập subscription key và region trong Dịch vụ AI."
      );
    }
  };

  const createAssessment = async (params: {
    language: string;
    recording: RecordingType;
    reference?: string;
    targetId?: string;
    targetType?: string;
  }) => {
    let recording = params.recording;
    if (!recording && params.targetId && params.targetType) {
      recording = await EnjoyApp.recordings.findOne({ targetId: params.targetId });
    }
    if (!recording) throw new Error("Recording is required for assessment.");
    return EnjoyApp.pronunciationAssessments.assess({
      recordingId: recording.id,
      language: params.language || recording.language,
      reference: params.reference || recording.referenceText,
    });
  };

  return { createAssessment, ensureEnjoyAiConfigured };
};
