import {
  AppSettingsProviderContext,
  AISettingsProviderContext,
  DbProviderContext,
} from "@renderer/context";
import { useContext, useEffect, useRef, useState } from "react";
import { t } from "i18next";
import { useAiCommand } from "./use-ai-command";
import { toast } from "@renderer/components/ui";
import { TimelineEntry } from "echogarden/dist/utilities/Timeline";
import { type ParsedCaptionsResult, parseText } from "media-captions";
import { SttEngineOptionEnum } from "@/types/enums";
import { RecognitionResult } from "echogarden/dist/api/API.js";
import log from "electron-log/renderer";
import type {
  LearningAsrEngine,
  LearningAsrErrorCode,
  LearningAsrValidation,
} from "@/types/learning-asr";
import { isLearningAsrEngine } from "@/lib/learning-asr-models";
import { resolveTranscriptionProviderSelection } from "@/lib/provider-selection-migration";

const logger = log.scope("use-transcribe.tsx");

// test a text string has any punctuations or not
// some transcribed text may not have any punctuations
const punctuationsPattern = /\w[.,!?](\s|$)/g;

export const useTranscribe = () => {
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { connection } = useContext(DbProviderContext);
  const { echogardenSttConfig } = useContext(AISettingsProviderContext);
  const { punctuateText } = useAiCommand();
  const [output, setOutput] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const activeLearningJob = useRef<{
    jobId: string;
    runVersion: number;
  } | null>(null);
  const cancelled = useRef(false);
  const activeRunVersion = useRef(0);

  useEffect(() => {
    return () => {
      cancelled.current = true;
      activeRunVersion.current += 1;
      const learningJobId = activeLearningJob.current?.jobId;
      activeLearningJob.current = null;
      if (learningJobId) void EnjoyApp.learningAsr.cancel(learningJobId);
    };
  }, [EnjoyApp, connection?.connectionId, connection?.profileId]);

  const assertNotCancelled = (runVersion?: number) => {
    if (
      cancelled.current ||
      (runVersion !== undefined && runVersion !== activeRunVersion.current)
    ) {
      throw new Error(t("learningAsrCancelled"));
    }
  };

  const transcode = async (src: string | Blob): Promise<string> => {
    if (src instanceof Blob) {
      src = await EnjoyApp.cacheObjects.writeFile(
        `${Date.now()}.${src.type.split("/")[1].split(";")[0]}`,
        await src.arrayBuffer(),
      );
    }

    const output = await EnjoyApp.echogarden.transcode(src);
    return output;
  };

  const transcribe = async (
    mediaSrc: string | Blob,
    params?: {
      targetId?: string;
      targetType?: string;
      originalText?: string;
      language: string;
      service: SttEngineOptionEnum | "upload";
      isolate?: boolean;
      align?: boolean;
    },
  ): Promise<{
    engine: string;
    model: string;
    transcript: string;
    timeline: TimelineEntry[];
    validation?: LearningAsrValidation;
    originalText?: string;
    tokenId?: number;
    url: string;
    runVersion: number;
  }> => {
    const runVersion = activeRunVersion.current + 1;
    activeRunVersion.current = runVersion;
    cancelled.current = false;
    setProgress(0);
    const previousLearningJob = activeLearningJob.current;
    activeLearningJob.current = null;
    if (previousLearningJob) {
      await EnjoyApp.learningAsr
        .cancel(previousLearningJob.jobId)
        .catch((err) => {
          logger.warn("Failed to cancel previous learning ASR job", err);
        });
      assertNotCancelled(runVersion);
    }
    const url = await transcode(mediaSrc);
    assertNotCancelled(runVersion);
    const {
      originalText,
      language,
      service,
      isolate = false,
      align = true,
    } = params || {};
    let audioBlob: Blob | undefined;
    const getAudioBlob = async (): Promise<Blob> => {
      if (!audioBlob) {
        audioBlob = await (await fetch(url)).blob();
        assertNotCancelled(runVersion);
      }
      return audioBlob;
    };
    let result: any;

    if (service !== "upload") {
      const selection = resolveTranscriptionProviderSelection(service);
      if (selection.status !== "configured") {
        throw new Error(t("models.chat.sttAiServicePlaceholder"));
      }
    }

    if (isLearningAsrEngine(service)) {
      const learningResult = await transcribeByLearningAsr(
        url,
        service,
        language,
        runVersion,
      );
      return {
        ...learningResult,
        url,
        runVersion,
      };
    }

    if (align && service !== "upload") {
      throw new Error(t("learningAsrModelUnsupported"));
    }

    if (service === "upload" && originalText) {
      result = await alignText(originalText);
    } else if (service === SttEngineOptionEnum.LOCAL) {
      result = await transcribeByLocal(url, {
        language,
      });
    } else {
      throw new Error(t("models.chat.sttAiServicePlaceholder"));
    }

    const { segmentTimeline, transcript } = result;
    assertNotCancelled(runVersion);

    if (!align && transcript) {
      return {
        ...result,
        timeline: [],
        url,
        runVersion,
      };
    }

    if (segmentTimeline && segmentTimeline.length > 0) {
      const wordTimeline = await EnjoyApp.echogarden.alignSegments(
        new Uint8Array(await (await getAudioBlob()).arrayBuffer()),
        segmentTimeline,
        {
          engine: "dtw",
          language: language.split("-")[0],
          isolate,
        },
      );
      assertNotCancelled(runVersion);

      const timeline = await EnjoyApp.echogarden.wordToSentenceTimeline(
        wordTimeline,
        transcript,
        language.split("-")[0],
      );
      assertNotCancelled(runVersion);

      return {
        ...result,
        timeline,
        url,
        runVersion,
      };
    } else if (transcript) {
      setOutput("Aligning the transcript...");
      logger.info("Aligning the transcript...");
      const alignmentResult = await EnjoyApp.echogarden.align(
        new Uint8Array(await (await getAudioBlob()).arrayBuffer()),
        transcript,
        {
          engine: "dtw",
          language: language.split("-")[0],
          isolate,
        },
      );
      assertNotCancelled(runVersion);

      const timeline: TimelineEntry[] = [];
      alignmentResult.timeline.forEach((t: TimelineEntry) => {
        if (t.type === "sentence") {
          timeline.push(t);
        } else {
          t.timeline.forEach((st) => {
            timeline.push(st);
          });
        }
      });

      return {
        ...result,
        timeline,
        url,
        runVersion,
      };
    } else {
      throw new Error(t("transcribeFailed"));
    }
  };

  const transcribeByLearningAsr = async (
    audioUrl: string,
    service: LearningAsrEngine,
    language: string,
    runVersion: number,
  ): Promise<{
    engine: string;
    model: string;
    transcript: string;
    timeline: TimelineEntry[];
    validation: LearningAsrValidation;
  }> => {
    assertNotCancelled(runVersion);
    const profileId = connection?.profileId;
    const connectionId = connection?.connectionId;
    if (!profileId || !connectionId) {
      throw new Error(t("learningAsrCancelled"));
    }
    const jobId = crypto.randomUUID();
    activeLearningJob.current = { jobId, runVersion };
    setOutput(t("learningAsrStarting"));

    const stageKeys = {
      preparing: "learningAsrStagePreparing",
      recognizing: "learningAsrStageRecognizing",
      aligning: "learningAsrStageAligning",
      repairing: "learningAsrStageRepairing",
      validating: "learningAsrStageValidating",
    } as const;
    const removeProgressListener = EnjoyApp.learningAsr.onProgress(
      (_event, event) => {
        const active = activeLearningJob.current;
        if (
          event.jobId !== jobId ||
          active?.jobId !== jobId ||
          active.runVersion !== runVersion ||
          cancelled.current
        ) {
          return;
        }
        setProgress(event.percent);
        setOutput(
          t(
            event.resumed > 0
              ? "learningAsrProgressResumed"
              : "learningAsrProgress",
            {
              stage: t(stageKeys[event.stage]),
              completed: event.completed,
              total: event.total,
              resumed: event.resumed,
            },
          ),
        );
      },
    );

    try {
      const response = await EnjoyApp.learningAsr.start({
        jobId,
        profileId,
        connectionId,
        audioUrl,
        service,
        language,
      });
      assertNotCancelled(runVersion);
      if (response.ok === false) {
        if (response.error.code === "asr_review_required") {
          throw new Error(
            t("learningAsrReviewRequired", {
              start: formatLearningAsrTime(response.error.startTime),
              end: formatLearningAsrTime(response.error.endTime),
            }),
          );
        }
        const errorKeys: Record<LearningAsrErrorCode, string> = {
          asr_auth: "learningAsrAuthError",
          asr_quota: "learningAsrQuotaError",
          asr_rate_limit: "learningAsrRateLimitError",
          asr_timeout: "learningAsrTimeoutError",
          asr_cancelled: "learningAsrCancelled",
          asr_network: "learningAsrNetworkError",
          asr_invalid_audio: "learningAsrInvalidAudio",
          asr_invalid_response: "learningAsrInvalidResponse",
          asr_no_speech: "learningAsrNoSpeech",
          asr_model_unsupported: "learningAsrModelUnsupported",
          asr_review_required: "learningAsrReviewRequired",
          asr_failed: "learningAsrFailed",
        };
        throw new Error(t(errorKeys[response.error.code]));
      }
      if (
        !response.result.validation ||
        !Array.isArray(response.result.timeline)
      ) {
        throw new Error(t("learningAsrInvalidResponse"));
      }
      setProgress(100);
      setOutput(t("learningAsrDone"));
      return {
        engine: response.result.engine,
        model: response.result.model,
        transcript: response.result.transcript,
        timeline: response.result.timeline as TimelineEntry[],
        validation: response.result.validation,
      };
    } finally {
      removeProgressListener();
      if (activeLearningJob.current?.jobId === jobId) {
        activeLearningJob.current = null;
      }
    }
  };

  const formatLearningAsrTime = (seconds?: number) => {
    if (!Number.isFinite(seconds)) return t("learningAsrUnknownTime");
    const value = Math.max(0, seconds as number);
    const minutes = Math.floor(value / 60);
    const remainder = (value % 60).toFixed(1).padStart(4, "0");
    return `${minutes}:${remainder}`;
  };

  const cancel = async () => {
    cancelled.current = true;
    activeRunVersion.current += 1;
    const cancellations: Promise<unknown>[] = [];
    const learningJobId = activeLearningJob.current?.jobId;
    activeLearningJob.current = null;
    if (learningJobId) {
      cancellations.push(EnjoyApp.learningAsr.cancel(learningJobId));
    }
    await Promise.allSettled(cancellations);
    setOutput(t("learningAsrCancelled"));
  };

  const alignText = async (
    originalText: string,
  ): Promise<{
    engine: string;
    model: string;
    transcript: string;
    segmentTimeline: TimelineEntry[];
  }> => {
    let caption: ParsedCaptionsResult;
    try {
      caption = await parseText(originalText, { type: "srt" });
    } catch (err) {
      logger.error("parseTextFailed", { error: err.message });
      throw err;
    }

    if (caption.cues.length > 0) {
      // valid srt file
      const segmentTimeline = caption.cues.map((cue) => {
        return {
          type: "segment",
          text: cue.text,
          startTime: cue.startTime,
          endTime: cue.endTime,
          timeline: [],
        } as TimelineEntry;
      });

      return {
        engine: "upload",
        model: "-",
        transcript: segmentTimeline
          .map((entry: TimelineEntry) => entry.text)
          .join(" "),
        segmentTimeline,
      };
    } else {
      // Remove all content inside `()`, `[]`, `{}` and trim the text
      // remove all markdown formatting
      let transcript = originalText
        .replace(/\(.*?\)/g, "")
        .replace(/\[.*?\]/g, "")
        .replace(/\{.*?\}/g, "")
        .replace(/[*_`]/g, "")
        .trim();

      // if the transcript does not contain any punctuation, use AI command to add punctuation
      if (!transcript.match(punctuationsPattern)) {
        try {
          const punctuatedText = await punctuateText(transcript);
          transcript = punctuatedText;
        } catch (err) {
          toast.error(err.message);
          logger.error("punctuateTextFailed", { error: err.message });
        }
      }

      return {
        engine: "upload",
        model: "-",
        transcript,
        segmentTimeline: [],
      };
    }
  };

  const transcribeByLocal = async (
    url: string,
    options: { language: string },
  ): Promise<{
    engine: string;
    model: string;
    transcript: string;
    segmentTimeline: TimelineEntry[];
  }> => {
    const { language } = options || {};
    const languageCode = language.split("-")[0];
    let model: string;

    let res: RecognitionResult;
    logger.info("Start transcribing from Whisper...");
    try {
      model =
        echogardenSttConfig[
          echogardenSttConfig.engine.replace(".cpp", "Cpp") as
            "whisper" | "whisperCpp"
        ].model;
      res = await EnjoyApp.echogarden.recognize(url, {
        language: languageCode,
        ...echogardenSttConfig,
      });
    } catch (err) {
      throw new Error(t("whisperTranscribeFailed", { error: err.message }));
    }

    setOutput("Whisper transcribe done");
    const { transcript, timeline } = res;

    return {
      engine: "whisper",
      model,
      transcript,
      segmentTimeline: timeline,
    };
  };

  return {
    transcode,
    transcribe,
    cancel,
    ensureActive: assertNotCancelled,
    output,
    progress,
  };
};
