import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import fs from "fs-extra";
import log from "@main/logger";

const logger = log.scope("AZURE");

const pronunciationReference = (reference?: string): string =>
  typeof reference === "string" ? reference.trim() : "";

function azureSpeechError(details: unknown): Error {
  const value = typeof details === "string" ? details : "";
  if (/401|403|authentication|authorization|subscription|region/iu.test(value)) {
    return new Error("Azure Speech authorization failed.");
  }
  if (/timeout|timed.?out/iu.test(value)) {
    return new Error("Azure Speech request timed out.");
  }
  if (/network|connection|dns|socket/iu.test(value)) {
    return new Error("Azure Speech connection failed.");
  }
  return new Error("Azure Speech request failed.");
}
export class AzureSpeechSdk {
  private config: sdk.SpeechConfig;

  constructor(subscriptionKey: string, region: string) {
    this.config = sdk.SpeechConfig.fromSubscription(subscriptionKey, region);
  }

  pronunciationAssessment(params: {
    filePath: string;
    reference?: string;
    language?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<sdk.PronunciationAssessmentResult> {
    const {
      filePath,
      reference,
      language = "en-US",
      signal,
      timeoutMs = 30_000,
    } = params;

    const audioConfig = sdk.AudioConfig.fromWavFileInput(
      fs.readFileSync(filePath)
    );

    const pronunciationAssessmentConfig = new sdk.PronunciationAssessmentConfig(
      pronunciationReference(reference),
      sdk.PronunciationAssessmentGradingSystem.HundredMark,
      sdk.PronunciationAssessmentGranularity.Phoneme,
      true
    );
    pronunciationAssessmentConfig.phonemeAlphabet = "IPA";

    // setting the recognition language to English.
    this.config.speechRecognitionLanguage = language;

    // create the speech recognizer.
    const reco = new sdk.SpeechRecognizer(this.config, audioConfig);
    pronunciationAssessmentConfig.applyTo(reco);

    logger.debug("Start pronunciation assessment.");
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (
        result?: sdk.PronunciationAssessmentResult,
        error?: Error
      ): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reco.close();
        if (error) reject(error);
        else resolve(result as sdk.PronunciationAssessmentResult);
      };
      const onAbort = (): void =>
        finish(undefined, new Error("Pronunciation assessment was cancelled."));
      const timer = setTimeout(
        () => finish(undefined, new Error("Pronunciation assessment timed out.")),
        Math.min(Math.max(timeoutMs, 1), 60_000)
      );
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      reco.recognizeOnceAsync((result) => {
        switch (result.reason) {
          case sdk.ResultReason.RecognizedSpeech: {
            const pronunciationResult =
              sdk.PronunciationAssessmentResult.fromResult(result);
            logger.debug(
              "Received pronunciation assessment result.",
              pronunciationResult.detailResult
            );
            finish(pronunciationResult);
            break;
          }
          case sdk.ResultReason.NoMatch:
            finish(undefined, new Error("No speech could be recognized."));
            break;
          case sdk.ResultReason.Canceled: {
            const cancellationDetails =
              sdk.CancellationDetails.fromResult(result);
            logger.debug(
              "CANCELED: Reason=" +
                cancellationDetails.reason
            );
            finish(undefined, azureSpeechError(cancellationDetails.errorDetails));
            break;
          }
          default:
            finish(undefined, new Error("Pronunciation assessment failed."));
        }
      }, (error) => finish(undefined, azureSpeechError(error)));
    });
  }

  continuousPronunciationAssessment(params: {
    filePath: string;
    reference?: string;
    language?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<sdk.PronunciationAssessmentResult> {
    const {
      filePath,
      reference,
      language = "en-US",
      signal,
      timeoutMs = 60_000,
    } = params;
    const audioConfig = sdk.AudioConfig.fromWavFileInput(fs.readFileSync(filePath));
    const assessmentConfig = new sdk.PronunciationAssessmentConfig(
      pronunciationReference(reference),
      sdk.PronunciationAssessmentGradingSystem.HundredMark,
      sdk.PronunciationAssessmentGranularity.Phoneme,
      true
    );
    assessmentConfig.phonemeAlphabet = "IPA";
    this.config.speechRecognitionLanguage = language;
    const recognizer = new sdk.SpeechRecognizer(this.config, audioConfig);
    assessmentConfig.applyTo(recognizer);

    return new Promise((resolve, reject) => {
      const results: sdk.PronunciationAssessmentResult[] = [];
      let settled = false;
      const cleanup = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        try {
          recognizer.stopContinuousRecognitionAsync();
        } catch {
          // The SDK can already be stopped after a terminal callback.
        }
        recognizer.close();
      };
      const finish = (
        result?: sdk.PronunciationAssessmentResult,
        error?: Error
      ): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve(result as sdk.PronunciationAssessmentResult);
      };
      const onAbort = (): void =>
        finish(undefined, new Error("Pronunciation assessment was cancelled."));
      const timer = setTimeout(
        () => finish(undefined, new Error("Pronunciation assessment timed out.")),
        Math.min(Math.max(timeoutMs, 1), 60_000)
      );
      signal?.addEventListener("abort", onAbort, { once: true });

      recognizer.recognized = (_sender, event) => {
        if (event.result.reason === sdk.ResultReason.RecognizedSpeech) {
          results.push(sdk.PronunciationAssessmentResult.fromResult(event.result));
        }
      };
      recognizer.canceled = (_sender, event) => {
        if (event.reason === sdk.CancellationReason.Error) {
          finish(undefined, azureSpeechError(event.errorDetails));
        }
      };
      recognizer.sessionStopped = () => {
        if (!results.length) {
          finish(undefined, new Error("No speech could be recognized."));
          return;
        }
        finish(mergePronunciationAssessmentResults(results));
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      recognizer.startContinuousRecognitionAsync(
        undefined,
        (error) => finish(undefined, azureSpeechError(error))
      );
    });
  }

  async transcribe(params: {
    filePath: string;
    language?: string;
  }): Promise<SpeechRecognitionResultType[]> {
    const { filePath, language = "en-US" } = params;

    const audioConfig = sdk.AudioConfig.fromWavFileInput(
      fs.readFileSync(filePath)
    );

    // setting the recognition language to English.
    this.config.speechRecognitionLanguage = language;
    this.config.requestWordLevelTimestamps();
    this.config.outputFormat = sdk.OutputFormat.Detailed;

    // create the speech recognizer.
    const reco = new sdk.SpeechRecognizer(this.config, audioConfig);

    logger.debug("Start transcribe.");

    let results: SpeechRecognitionResultType[] = [];
    return new Promise((resolve, reject) => {
      reco.recognizing = (_s, e) => {
        logger.debug("Intermediate result received: ", e.result.text);
      };
      reco.recognized = (_s, e) => {
        logger.debug("Got final result", e.result.text);
        const json = e.result.properties.getProperty(
          sdk.PropertyId.SpeechServiceResponse_JsonResult
        );
        const result = JSON.parse(json);
        results = results.concat(result);
      };
      reco.canceled = (_s, e) => {
        logger.debug("CANCELED: Reason=" + e.reason);

        if (e.reason === sdk.CancellationReason.Error) {
          logger.debug(`"CANCELED: ErrorCode=${e.errorCode}`);
          return reject(azureSpeechError(e.errorDetails));
        }

        reco.stopContinuousRecognitionAsync();
      };
      reco.sessionStopped = (_s, _e) => {
        logger.debug("\n    Session stopped event.");
        reco.stopContinuousRecognitionAsync();
        return resolve(results);
      };

      reco.startContinuousRecognitionAsync();
    });
  }
}

function mergePronunciationAssessmentResults(
  results: sdk.PronunciationAssessmentResult[]
): sdk.PronunciationAssessmentResult {
  const details = results.map((result) =>
    JSON.parse(JSON.stringify(result.detailResult)) as Record<string, any>
  );
  const first = details[0];
  const merged: Record<string, any> = {
    ...first,
    Words: details.flatMap((detail) => detail.Words || []),
    PronunciationAssessment: { ...first.PronunciationAssessment },
    ContentAssessmentResult: { ...(first.ContentAssessmentResult || {}) },
  };
  const average = (path: "PronunciationAssessment" | "ContentAssessmentResult", key: string) => {
    const values = details
      .map((detail) => Number(detail[path]?.[key]))
      .filter(Number.isFinite);
    if (values.length) {
      merged[path][key] = values.reduce((sum, value) => sum + value, 0) / values.length;
    }
  };
  for (const key of [
    "AccuracyScore",
    "CompletenessScore",
    "FluencyScore",
    "ProsodyScore",
    "PronScore",
  ]) average("PronunciationAssessment", key);
  for (const key of ["GrammarScore", "VocabularyScore", "TopicScore"]) {
    average("ContentAssessmentResult", key);
  }
  const confidence = details
    .map((detail) => Number(detail.Confidence))
    .filter((value): value is number => Number.isFinite(value));
  if (confidence.length) {
    merged.Confidence = confidence.reduce((sum, value) => sum + value, 0) / confidence.length;
  }
  for (const key of ["Display", "ITN", "Lexical", "MaskedITN"]) {
    merged[key] = details.map((detail) => detail[key]).filter(Boolean).join(" ");
  }
  return {
    pronunciationScore: merged.PronunciationAssessment?.PronScore,
    accuracyScore: merged.PronunciationAssessment?.AccuracyScore,
    completenessScore: merged.PronunciationAssessment?.CompletenessScore,
    fluencyScore: merged.PronunciationAssessment?.FluencyScore,
    prosodyScore: merged.PronunciationAssessment?.ProsodyScore,
    detailResult: merged,
    contentAssessmentResult: merged.ContentAssessmentResult,
  } as unknown as sdk.PronunciationAssessmentResult;
}
