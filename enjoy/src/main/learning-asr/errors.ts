import type { LearningAsrErrorCode } from "../../types/learning-asr";

export class LearningAsrError extends Error {
  constructor(
    public readonly code: LearningAsrErrorCode,
    message: string,
    public readonly range?: { startTime: number; endTime: number },
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LearningAsrError";
  }
}

export function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new LearningAsrError("asr_cancelled", "Transcription cancelled.");
}

export function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  assertActive(signal);
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new LearningAsrError("asr_cancelled", "Transcription cancelled."));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

/** End the owning job promptly while a non-interruptible native call settles in its queue. */
export function withCancellation<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new LearningAsrError("asr_cancelled", "Transcription cancelled."));
    };
    operation.then(value => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) abort();
      else resolve(value);
    }, error => {
      signal.removeEventListener("abort", abort);
      reject(signal.aborted ? new LearningAsrError("asr_cancelled", "Transcription cancelled.") : error);
    });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
