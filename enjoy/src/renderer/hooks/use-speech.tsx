import {
  AppSettingsProviderContext,
  AISettingsProviderContext,
} from "@renderer/context";
import { useContext } from "react";
import OpenAI from "openai";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { t } from "i18next";
import {
  buildOpenAiSpeechRequest,
  ensureAudioArrayBuffer,
  resolveTtsModel,
  sanitizeSpeechError,
  validateAzureTtsInput,
  type ResolvedTtsModel,
} from "@/lib/speech-models";

type SpeechConfiguration = {
  engine?: unknown;
  model?: unknown;
  voice?: unknown;
  baseUrl?: unknown;
};

export const useSpeech = () => {
  const { EnjoyApp, webApi, user, apiUrl, learningLanguage } = useContext(
    AppSettingsProviderContext
  );
  const { openai, ttsConfig } = useContext(AISettingsProviderContext);

  const tts = async (params: Partial<SpeechType>) => {
    const configuration = (params.configuration || ttsConfig) as
      | SpeechConfiguration
      | null
      | undefined;
    if (!configuration) {
      throw new Error("TTS configuration is required.");
    }

    const resolved = resolveTtsModel(
      configuration.engine,
      configuration.model
    );
    const buffer =
      resolved.provider === "openai"
        ? await openaiTTS(params, configuration, resolved)
        : await azureTTS(params, configuration);
    const arrayBuffer = ensureAudioArrayBuffer(buffer);
    const voice =
      resolved.provider === "openai"
        ? buildOpenAiSpeechRequest({
            engine: resolved.engine,
            model: resolved.model,
            voice: configuration.voice,
            text: params.text,
          }).voice
        : validateAzureTtsInput({
            model: resolved.model,
            voice: configuration.voice,
            text: params.text,
          }).voice;

    return EnjoyApp.speeches.create(
      {
        text: params.text,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        section: params.section,
        segment: params.segment,
        configuration: {
          engine: resolved.engine,
          model: resolved.model,
          voice,
        },
      },
      {
        type: "audio/mp3",
        arrayBuffer,
      }
    );
  };

  const openaiTTS = async (
    params: Partial<SpeechType>,
    configuration: SpeechConfiguration,
    resolved: ResolvedTtsModel
  ): Promise<ArrayBuffer> => {
    const request = buildOpenAiSpeechRequest({
      engine: resolved.engine,
      model: resolved.model,
      voice: configuration.voice,
      text: params.text,
    });
    const apiKey =
      resolved.engine === "enjoyai"
        ? typeof user?.accessToken === "string"
          ? user.accessToken.trim()
          : ""
        : typeof openai?.key === "string"
          ? openai.key.trim()
          : "";

    if (!apiKey) {
      throw new Error(t("openaiKeyRequired"));
    }

    const configuredBaseUrl =
      typeof configuration.baseUrl === "string"
        ? configuration.baseUrl.trim()
        : "";
    const savedBaseUrl =
      typeof openai?.baseUrl === "string" ? openai.baseUrl.trim() : "";
    const client = new OpenAI({
      apiKey,
      baseURL:
        resolved.engine === "enjoyai"
          ? `${apiUrl}/api/ai`
          : configuredBaseUrl || savedBaseUrl || undefined,
      dangerouslyAllowBrowser: true,
      maxRetries: 1,
    });

    try {
      const file = await client.audio.speech.create(request);
      return ensureAudioArrayBuffer(await file.arrayBuffer());
    } catch (error) {
      throw new Error(sanitizeSpeechError(error, apiKey));
    }
  };

  const azureTTS = async (
    params: Partial<SpeechType>,
    configuration: SpeechConfiguration
  ): Promise<ArrayBuffer> => {
    const { voice, text } = validateAzureTtsInput({
      model: configuration.model,
      voice: configuration.voice,
      text: params.text,
    });
    const { id, token, region } = await webApi.generateSpeechToken({
      purpose: "tts",
      input: text,
    });
    const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region);
    speechConfig.speechRecognitionLanguage = learningLanguage;
    speechConfig.speechSynthesisVoiceName = voice;

    // Do not playback audio when transcribed.
    const speechSynthesizer = new sdk.SpeechSynthesizer(speechConfig, null);

    return new Promise<ArrayBuffer>((resolve, reject) => {
      const revokeToken = () => {
        void webApi.revokeSpeechToken(id);
      };

      try {
        speechSynthesizer.speakTextAsync(
          text,
          (result) => {
            speechSynthesizer.close();

            try {
              const audioData = ensureAudioArrayBuffer(result?.audioData);
              void webApi.consumeSpeechToken(id);
              resolve(audioData);
            } catch (error) {
              revokeToken();
              reject(error);
            }
          },
          (error) => {
            speechSynthesizer.close();
            revokeToken();
            reject(error);
          }
        );
      } catch (error) {
        speechSynthesizer.close();
        revokeToken();
        reject(error);
      }
    });
  };

  return {
    tts,
  };
};
