import { useContext } from "react";
import {
  AISettingsProviderContext,
  AppSettingsProviderContext,
} from "@renderer/context";

type SpeechConfiguration = {
  engine: string;
  model: string;
  voice: string;
  baseUrl?: string;
};

export const useSpeech = () => {
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { ttsConfig } = useContext(AISettingsProviderContext);

  const tts = async (params: Partial<SpeechType>) => {
    const configuration = (params.configuration || ttsConfig) as
      | SpeechConfiguration
      | null;
    if (!configuration) {
      throw new Error("Speech synthesis provider selection is required.");
    }
    const text = typeof params.text === "string" ? params.text.trim() : "";
    if (!text) {
      throw new Error("Speech synthesis text is required.");
    }

    return EnjoyApp.speeches.generate({
      sourceId: params.sourceId,
      sourceType: params.sourceType,
      text,
      section: params.section,
      segment: params.segment,
      configuration,
    });
  };

  return { tts };
};
