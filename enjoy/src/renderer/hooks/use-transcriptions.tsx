import { useState, useContext, useEffect, useRef } from "react";
import { useTranscribe } from "@renderer/hooks";
import {
  AISettingsProviderContext,
  AppSettingsProviderContext,
  DbProviderContext,
} from "@renderer/context";
import { toast } from "@renderer/components/ui";
import { TimelineEntry } from "echogarden/dist/utilities/Timeline.d.js";
import { MAGIC_TOKEN_REGEX, END_OF_SENTENCE_REGEX } from "@/constants";
import { SttEngineOptionEnum } from "@/types/enums";
import { t } from "i18next";
import { isLearningAsrEngine } from "@/lib/learning-asr-models";
import { resolveTranscriptionProviderSelection } from "@/lib/provider-selection-migration";
import { transcriptionQualityMetadata } from "@/lib/transcription-speech-review";

export const useTranscriptions = (media: AudioType | VideoType) => {
  const { sttEngine } = useContext(AISettingsProviderContext);
  const { EnjoyApp, learningLanguage } = useContext(
    AppSettingsProviderContext,
  );
  const { connection, addDblistener, removeDbListener } = useContext(DbProviderContext);
  const [transcription, setTranscription] = useState<TranscriptionType>(null);
  const {
    transcribe,
    cancel: cancelTranscription,
    ensureActive,
    output,
    progress,
  } = useTranscribe();
  const [transcribingProgress, setTranscribingProgress] = useState<number>(0);
  const [transcribing, setTranscribing] = useState<boolean>(false);
  const [committing, setCommitting] = useState<boolean>(false);
  const [creating, setCreating] = useState<boolean>(false);
  const [transcribingOutput, setTranscribingOutput] = useState<string>("");
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [service, setService] = useState<
    SttEngineOptionEnum | "upload" | null
  >(
    sttEngine,
  );
  const generationRef = useRef(0);
  const committingRef = useRef(false);
  const connectionRef = useRef({
    profileId: connection?.profileId,
    connectionId: connection?.connectionId,
  });
  connectionRef.current = {
    profileId: connection?.profileId,
    connectionId: connection?.connectionId,
  };

  const onTransactionUpdate = (event: CustomEvent) => {
    if (!transcription) return;

    const { model, action, record } = event.detail || {};
    if (
      model === "Transcription" &&
      record.id === transcription.id &&
      action === "update"
    ) {
      setTranscription(record);
    }
  };
  const findOrCreateTranscription =
    async (): Promise<TranscriptionType | void> => {
      if (!media) return;
      if (transcription?.targetId === media.id) return;
      if (creating) return;

      try {
        setCreating(true);
        const tr = await EnjoyApp.transcriptions.findOrCreate({
          targetId: media.id,
          targetType: media.mediaType,
        });

        if (!tr?.result?.timeline) {
          tr.result = {
            originalText: tr.result?.originalText,
          };
        }

        setTranscription(tr);
        return tr;
      } catch (err) {
        console.error(err);
        return null;
      } finally {
        setCreating(false);
      }
    };

  const generateTranscription = async (params?: {
    originalText?: string;
    language?: string;
    service?: SttEngineOptionEnum | "upload";
    isolate?: boolean;
  }) => {
    if (committingRef.current) return;
    setTranscriptionError(null);
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    committingRef.current = false;
    const boundConnection = { ...connectionRef.current };
    const assertCurrentGeneration = () => {
      if (
        generation !== generationRef.current ||
        boundConnection.profileId !== connectionRef.current.profileId ||
        boundConnection.connectionId !== connectionRef.current.connectionId
      ) {
        throw new Error(t("learningAsrCancelled"));
      }
    };
    let {
      originalText,
      service = sttEngine,
    } = params || {};
    const { language = learningLanguage, isolate = false } = params || {};
    let transcriptionForCommit = transcription;
    try {
      if (service !== "upload") {
        const selection = resolveTranscriptionProviderSelection(service);
        if (selection.status !== "configured") {
          throw new Error(t("models.chat.sttAiServicePlaceholder"));
        }
        service = selection.value as SttEngineOptionEnum;
      }
      setService(service);
      setTranscribing(true);
      setTranscribingProgress(0);
      if (originalText === undefined) {
        if (transcription?.targetId === media.id) {
          originalText = transcription.result?.originalText;
        } else {
          const r = await findOrCreateTranscription();
          assertCurrentGeneration();
          if (r) {
            transcriptionForCommit = r;
            originalText = r.result?.originalText;
          }
        }
      }
      assertCurrentGeneration();
      const {
        engine,
        model,
        transcript,
        timeline,
        validation,
        tokenId,
        runVersion,
      } = await transcribe(media.src, {
        targetId: media.id,
        targetType: media.mediaType,
        originalText,
        language,
        service,
        isolate,
      });
      assertCurrentGeneration();
      ensureActive(runVersion);

      if (isLearningAsrEngine(service) && !validation) {
        throw new Error(t("learningAsrInvalidResponse"));
      }
      const processedTimeline = validation
        ? timeline
        : preProcessTranscription(timeline);
      assertCurrentGeneration();
      ensureActive(runVersion);
      if (media.language !== language) {
        if (media.mediaType === "Video") {
          await EnjoyApp.videos.update(media.id, {
            language,
          });
        } else {
          await EnjoyApp.audios.update(media.id, {
            language,
          });
        }
        assertCurrentGeneration();
        ensureActive(runVersion);
      }

      assertCurrentGeneration();
      ensureActive(runVersion);
      if (!transcriptionForCommit?.id) {
        throw new Error(t("models.transcription.notFound"));
      }
      committingRef.current = true;
      setCommitting(true);
      await EnjoyApp.transcriptions.update(transcriptionForCommit.id, {
        state: "finished",
        result: {
          timeline: processedTimeline,
          transcript,
          originalText,
          tokenId,
          ...transcriptionQualityMetadata(validation,
            service === "upload" && transcriptionForCommit.targetId === media.id
              ? transcriptionForCommit.result : undefined),
        },
        engine,
        model,
        language,
      });
    } catch (err) {
      if (generation === generationRef.current) {
        const message = err instanceof Error ? err.message : t("learningAsrFailed");
        setTranscriptionError(message);
        toast.error(message);
      }
    } finally {
      if (generation === generationRef.current) {
        committingRef.current = false;
        setCommitting(false);
        setTranscribing(false);
      }
    }
  };

  const preProcessTranscription = (timeline: TimelineEntry[]) => {
    /*
     * Pre-process
     * 1. Some words end with period should not be a single sentence, like Mr./Ms./Dr. etc
     * 2. Some words connected by `-`(like scrach-off) are split into multiple words in words timeline, merge them for display;
     * 3. Some numbers with `%` are split into `number + percent` in words timeline, merge them for display;
     */
    try {
      timeline.forEach((sentence, i) => {
        const nextSentence = timeline[i + 1];
        if (
          !sentence.text
            .replaceAll(MAGIC_TOKEN_REGEX, "")
            .match(END_OF_SENTENCE_REGEX) &&
          nextSentence?.text
        ) {
          nextSentence.text = [sentence.text, nextSentence.text].join(" ");
          nextSentence.timeline = [
            ...sentence.timeline,
            ...nextSentence.timeline,
          ];
          nextSentence.startTime = sentence.startTime;
          timeline.splice(i, 1);
        } else {
          const words = sentence.text.split(" ");

          sentence.timeline.forEach((token, j) => {
            const word = words[j]?.trim()?.toLowerCase();

            const match = word?.match(/-|%/);
            if (!match) return;

            if (
              word === "-" &&
              token.text.toLowerCase() === words[j + 1]?.trim()?.toLowerCase()
            ) {
              sentence.timeline.splice(j, 0, {
                type: "token",
                text: "-",
                startTime: sentence.timeline[j - 1]?.endTime || 0,
                endTime: sentence.timeline[j - 1]?.endTime || 0,
                timeline: [],
              });
              return;
            }

            for (let k = j + 1; k <= sentence.timeline.length - 1; k++) {
              while (word.includes(sentence.timeline[k]?.text?.toLowerCase())) {
                let connector = "";
                if (match[0] === "-") {
                  connector = "-";
                }
                token.text = [token.text, sentence.timeline[k].text].join(
                  connector,
                );
                token.timeline = [
                  ...token.timeline,
                  ...sentence.timeline[k].timeline,
                ];
                token.endTime = sentence.timeline[k].endTime;
                sentence.timeline.splice(k, 1);
              }
              break;
            }
          });
        }
      });
    } catch (err) {
      console.warn(err);
      toast.warning(
        `Failed to pre-process transcription timeline: ${err.message}`,
      );
    }
    return timeline;
  };

  /*
   * find or create transcription
   */
  useEffect(() => {
    if (!media) return;

    findOrCreateTranscription();
  }, [media]);

  /*
   * listen to transcription update
   */
  useEffect(() => {
    if (!transcription) return;

    addDblistener(onTransactionUpdate);
    return () => {
      removeDbListener(onTransactionUpdate);
    };
  }, [transcription]);

  /*
   * listen to transcribe progress
   */
  useEffect(() => {
    if (!transcribing) return;

    EnjoyApp.app.onCmdOutput((_, output) => {
      setTranscribingOutput(output);
    });

    return () => {
      EnjoyApp.app.removeCmdOutputListeners();
      setTranscribingOutput(null);
    };
  }, [media, service, transcribing]);

  useEffect(() => {
    if (transcribing) setTranscribingProgress(progress);
  }, [progress, transcribing]);

  useEffect(() => {
    setTranscriptionError(null);
    return () => {
      generationRef.current += 1;
    };
  }, [connection?.connectionId, connection?.profileId, media?.id]);

  const abortGenerateTranscription = () => {
    if (committingRef.current) return;
    generationRef.current += 1;
    void cancelTranscription();
    setTranscribing(false);
  };

  return {
    transcription,
    transcribingProgress,
    transcribing,
    committing,
    transcriptionError,
    transcribingOutput: output || transcribingOutput,
    generateTranscription,
    abortGenerateTranscription,
  };
};
