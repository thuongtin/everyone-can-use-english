import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  selectRetryExercises,
  summarizePractice,
  type PracticeSummaryAttempt,
} from "../../../lib/practice-grading";
import { ArrowDown, ArrowUp, Check, Mic, Square, Trash2 } from "lucide-react";

import { EjEmptyState, Pill } from "@renderer/components/enjoy";
import type {
  Exercise,
  LearningTarget,
} from "../../../types/learning";

/** Labels each multiple-choice row so learners can refer to answers by letter. */
const CHOICE_LETTERS = "ABCDEFGH";

const PRIMARY_BUTTON =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] bg-ej-ink px-3.5 text-xs font-semibold text-ej-bg transition-opacity duration-ej hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
const SECONDARY_BUTTON =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] border border-ej-line bg-ej-surface px-3.5 text-xs font-semibold text-ej-ink transition-colors duration-ej hover:bg-ej-surface2 disabled:cursor-not-allowed disabled:opacity-40";
const DANGER_BUTTON =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] border border-ej-bad bg-ej-bad-soft px-3.5 text-xs font-semibold text-ej-bad transition-opacity duration-ej hover:opacity-90 disabled:cursor-wait disabled:opacity-60";
const FIELD =
  "w-full rounded-[10px] border border-ej-line bg-ej-surface px-3.5 text-ej-ink outline-none transition-colors duration-ej placeholder:text-ej-muted focus:border-ej-accent focus:ring-1 focus:ring-ej-accent";

export type PracticeRecording = Readonly<{
  bytes: Uint8Array;
  mimeType: string;
}>;

export interface GradeResult {
  correct: boolean | null;
  feedbackCode?: "correct" | "incorrect" | "self_review" | string;
  normalizedAnswer?: unknown;
  expectedAnswer?: unknown;
  targetIds?: string[];
  recordingAssetId?: string | null;
  message?: string;
  [key: string]: unknown;
}

export interface PracticeAttemptInput {
  questionId: string;
  answer?: unknown;
  result?: unknown;
  kind?: string;
  targetIds?: unknown;
  recordingAssetId?: string | null;
  createdAt?: Date | string | number;
}

export interface PracticePanelProps {
  exercises: readonly Exercise[];
  targets: readonly LearningTarget[];
  attempts: readonly PracticeAttemptInput[];
  onSubmit: (
    questionId: string,
    answer: unknown,
    recording?: PracticeRecording,
  ) => Promise<GradeResult>;
  onPlayRecording?: (assetId: string) => void;
  className?: string;
}

type PracticeMeaningExercise = {
  kind: "meaning";
  id: string;
  prompt: string;
  targetIds: string[];
  choices: Array<{ id: string; text: string }>;
  answerChoiceIds: string[];
};

type PracticeFillExercise = {
  kind: "fill";
  id: string;
  prompt: string;
  targetIds: string[];
  acceptedAnswers: string[];
};

type PracticeOrderExercise = {
  kind: "order";
  id: string;
  prompt: string;
  targetIds: string[];
  tokens: Array<{ id: string; text: string }>;
  acceptedOrders: string[][];
};

type PracticeRetellExercise = {
  kind: "retell";
  id: string;
  prompt: string;
  targetIds: string[];
  hints?: string[];
};

type PracticeExercise =
  | PracticeMeaningExercise
  | PracticeFillExercise
  | PracticeOrderExercise
  | PracticeRetellExercise;

type AnswerValue = string | string[];
type RecordingStatus = "idle" | "requesting" | "recording";

const RECORDING_TIMESLICE_MS = 1_000;
const MAX_RECORDING_DURATION_MS = 10 * 60 * 1_000;
const MAX_RECORDING_BYTES = 16 * 1024 * 1024;

type PendingRecording = PracticeRecording & Readonly<{
  previewUrl: string | null;
}>;

type RecordingSession = {
  questionId: string;
  epoch: number;
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  bytes: number;
  timer: ReturnType<typeof setTimeout> | null;
  discard: boolean;
  errorMessage: string | null;
};

function initialAnswer(exercise: PracticeExercise): AnswerValue {
  if (exercise.kind === "meaning") return [];
  if (exercise.kind === "order") {
    const tokenIds = exercise.tokens.map(({ id }) => id);
    const isAccepted = (candidate: string[]) => exercise.acceptedOrders.some(order => order.length === candidate.length && order.every((id, index) => id === candidate[index]));
    if (!isAccepted(tokenIds)) return tokenIds;
    for (let offset = 1; offset < tokenIds.length; offset += 1) {
      const candidate = [...tokenIds.slice(offset), ...tokenIds.slice(0, offset)];
      if (!isAccepted(candidate)) return candidate;
    }
    return [...tokenIds].reverse();
  }
  return "";
}

function answerForExercise(
  answers: Readonly<Record<string, AnswerValue>>,
  exercise: PracticeExercise,
): AnswerValue {
  return answers[exercise.id] ?? initialAnswer(exercise);
}

function answerIsEmpty(answer: AnswerValue): boolean {
  if (typeof answer === "string") return answer.trim().length === 0;
  return answer.length === 0;
}

function toBooleanResult(result: unknown): boolean | null {
  if (result === true || result === false) return result as boolean;
  if (result === null) return null;
  if (!result || typeof result !== "object") return null;
  const candidate = (result as { correct?: unknown }).correct;
  return candidate === true || candidate === false || candidate === null
    ? candidate as boolean | null
    : null;
}

function asGradeResult(result: unknown): GradeResult | null {
  if (!result || typeof result !== "object") {
    const correct = toBooleanResult(result);
    return correct === null && result !== null ? null : { correct };
  }
  const record = result as Record<string, unknown>;
  const correct = toBooleanResult(record);
  if (correct === null && !Object.prototype.hasOwnProperty.call(record, "correct")) {
    return null;
  }
  return { ...record, correct } as GradeResult;
}

function toTargetIds(value: unknown, fallback: readonly string[]): string[] {
  if (Array.isArray(value)) {
    const ids = value.filter((candidate): candidate is string => typeof candidate === "string");
    if (ids.length > 0) return [...new Set(ids)];
  }
  return [...fallback];
}

function toSummaryAttempts(
  attempts: readonly PracticeAttemptInput[],
  exercises: readonly PracticeExercise[],
): PracticeSummaryAttempt[] {
  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  return attempts
    .map((attempt, index) => ({
      attempt,
      index,
      timestamp: attempt.createdAt === undefined
        ? Number.NEGATIVE_INFINITY
        : new Date(attempt.createdAt).getTime(),
    }))
    .sort((left, right) => {
      const leftTime = Number.isFinite(left.timestamp) ? left.timestamp : Number.NEGATIVE_INFINITY;
      const rightTime = Number.isFinite(right.timestamp) ? right.timestamp : Number.NEGATIVE_INFINITY;
      return leftTime - rightTime || left.index - right.index;
    })
    .map(({ attempt }) => {
      const exercise = exerciseById.get(attempt.questionId);
      const kind = exercise?.kind ?? (
        attempt.kind === "meaning" || attempt.kind === "fill" || attempt.kind === "order" || attempt.kind === "retell"
          ? attempt.kind
          : "fill"
      );
      return {
        questionId: attempt.questionId,
        kind,
        targetIds: toTargetIds(attempt.targetIds, exercise?.targetIds ?? []),
        result: { correct: toBooleanResult(attempt.result) },
      };
    });
}

function timestampForAttempt(attempt: PracticeAttemptInput): number {
  if (attempt.createdAt === undefined) return Number.NEGATIVE_INFINITY;
  const timestamp = new Date(attempt.createdAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function latestAttemptMap(
  attempts: readonly PracticeAttemptInput[],
): Map<string, PracticeAttemptInput> {
  const indexed = attempts.map((attempt, index) => ({ attempt, index }));
  indexed.sort((left, right) => {
    return timestampForAttempt(left.attempt) - timestampForAttempt(right.attempt)
      || left.index - right.index;
  });
  return new Map(indexed.map(({ attempt }) => [attempt.questionId, attempt]));
}

function feedbackMessage(result: GradeResult): string {
  if (typeof result.message === "string" && result.message.trim()) return result.message;
  if (result.correct === true) return "Chính xác. Câu trả lời đã được ghi nhận.";
  if (result.correct === false) return "Chưa đúng. Hãy xem lại gợi ý và thử lại.";
  return "Hãy tự đánh giá câu trả lời của bạn và luyện lại nếu cần.";
}

function recordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/wav",
  ];
  if (typeof MediaRecorder.isTypeSupported !== "function") return candidates[0];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function safeCreateObjectUrl(blob: Blob): string | null {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  return URL.createObjectURL(blob);
}

function safeRevokeObjectUrl(url: string | null | undefined): void {
  if (!url || typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  URL.revokeObjectURL(url);
}

function MeaningAnswer({
  exercise,
  answer,
  onChange,
}: {
  exercise: PracticeMeaningExercise;
  answer: string[];
  onChange: (answer: string[]) => void;
}) {
  const allowsMultiple = exercise.answerChoiceIds.length > 1;
  return (
    <fieldset className="mt-4 space-y-2" data-testid={`practice-meaning-${exercise.id}`}>
      <legend className="sr-only">{exercise.prompt}</legend>
      <div
        className="space-y-2"
        role={allowsMultiple ? "group" : "radiogroup"}
        aria-label={allowsMultiple ? "Chọn một hoặc nhiều đáp án" : "Chọn một đáp án"}
      >
        {exercise.choices.map((choice, index) => {
          const checked = answer.includes(choice.id);
          return (
            <label
              key={choice.id}
              className={`flex cursor-pointer items-center gap-3 rounded-[10px] border px-3.5 py-2.5 transition-colors duration-ej ${checked ? "border-ej-accent bg-ej-accent-soft text-ej-accent-ink" : "border-ej-line bg-ej-surface text-ej-ink2 hover:border-ej-accent hover:bg-ej-surface2"}`}
            >
              <input
                type={allowsMultiple ? "checkbox" : "radio"}
                name={`practice-meaning-${exercise.id}`}
                value={choice.id}
                checked={checked}
                onChange={(event) => {
                  if (allowsMultiple) {
                    onChange(event.currentTarget.checked
                      ? [...answer, choice.id]
                      : answer.filter((id) => id !== choice.id));
                  } else {
                    onChange([choice.id]);
                  }
                }}
                className="h-4 w-4 shrink-0 accent-ej-accent"
                data-testid={`practice-meaning-option-${exercise.id}-${choice.id}`}
              />
              <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xxs font-bold ${checked ? "bg-ej-accent text-white" : "bg-ej-surface2 text-ej-muted"}`}>
                {CHOICE_LETTERS[index] ?? index + 1}
              </span>
              <span className="min-w-0 font-literata text-[15px] leading-6">{choice.text}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function FillAnswer({
  exercise,
  answer,
  onChange,
}: {
  exercise: PracticeFillExercise;
  answer: string;
  onChange: (answer: string) => void;
}) {
  const inputId = `practice-fill-input-${exercise.id}`;
  return (
    <div className="mt-4">
      <label htmlFor={inputId} className="mb-2 block ej-label">
        Câu trả lời
      </label>
      <input
        id={inputId}
        type="text"
        value={answer}
        onChange={(event) => onChange(event.currentTarget.value)}
        autoComplete="off"
        className={`${FIELD} h-11 font-literata text-[15px]`}
        placeholder="Nhập câu trả lời..."
        data-testid={`practice-fill-input-${exercise.id}`}
      />
    </div>
  );
}

function OrderAnswer({
  exercise,
  answer,
  onChange,
}: {
  exercise: PracticeOrderExercise;
  answer: string[];
  onChange: (answer: string[]) => void;
}) {
  const tokensById = new Map(exercise.tokens.map((token) => [token.id, token]));
  const move = (index: number, offset: -1 | 1) => {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= answer.length) return;
    const next = [...answer];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    onChange(next);
  };

  return (
    <div className="mt-4" data-testid={`practice-order-${exercise.id}`}>
      <p className="mb-2 ej-label">
        Thứ tự câu
      </p>
      <ol className="space-y-2" aria-label="Các từ trong câu">
        {answer.map((tokenId, index) => {
          const token = tokensById.get(tokenId);
          if (!token) return null;
          return (
            <li
              key={token.id}
              className="flex items-center gap-2.5 rounded-[10px] border border-ej-line bg-ej-surface px-3 py-2"
              data-testid={`practice-order-token-${exercise.id}-${token.id}`}
            >
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ej-surface2 text-xxs font-bold text-ej-muted">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate font-literata text-[15px] text-ej-ink">{token.text}</span>
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={`Đưa ${token.text} lên trước`}
                className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-ej-line text-ej-ink2 transition-colors duration-ej hover:bg-ej-surface2 disabled:cursor-not-allowed disabled:opacity-30"
                data-testid={`practice-order-up-${exercise.id}-${token.id}`}
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === answer.length - 1}
                aria-label={`Đưa ${token.text} xuống sau`}
                className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-ej-line text-ej-ink2 transition-colors duration-ej hover:bg-ej-surface2 disabled:cursor-not-allowed disabled:opacity-30"
                data-testid={`practice-order-down-${exercise.id}-${token.id}`}
              >
                <ArrowDown className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function RetellAnswer({
  exercise,
  answer,
  onChange,
}: {
  exercise: PracticeRetellExercise;
  answer: string;
  onChange: (answer: string) => void;
}) {
  const textareaId = `practice-retell-input-${exercise.id}`;
  return (
    <div className="mt-4">
      <label htmlFor={textareaId} className="mb-2 block ej-label">
        Kể lại bằng tiếng Anh
      </label>
      <textarea
        id={textareaId}
        value={answer}
        onChange={(event) => onChange(event.currentTarget.value)}
        rows={5}
        className={`${FIELD} resize-y py-2.5 font-literata text-[15px] leading-7`}
        placeholder="Viết hoặc ghi âm cách bạn kể lại nội dung..."
        data-testid={`practice-retell-input-${exercise.id}`}
      />
      {exercise.hints && exercise.hints.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs leading-5 text-ej-muted" data-testid={`practice-retell-hints-${exercise.id}`}>
          {exercise.hints.map((hint) => <li key={hint}>Gợi ý: {hint}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

export function PracticePanel({
  exercises,
  targets,
  attempts,
  onSubmit,
  onPlayRecording,
  className,
}: PracticePanelProps) {
  const viewExercises = exercises as unknown as readonly PracticeExercise[];
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(() =>
    Object.fromEntries(viewExercises.map((exercise) => [exercise.id, initialAnswer(exercise)])),
  );
  const [results, setResults] = useState<Record<string, GradeResult>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const [recordingStates, setRecordingStates] = useState<Record<string, RecordingStatus>>({});
  const [recordingErrors, setRecordingErrors] = useState<Record<string, string>>({});
  const [recordings, setRecordings] = useState<Record<string, PendingRecording>>({});
  const [activeRecordingQuestionId, setActiveRecordingQuestionId] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const recordingEpochsRef = useRef(new Map<string, number>());
  const recordingSessionsRef = useRef(new Map<string, RecordingSession>());
  const activeRecordingRef = useRef<{ questionId: string; epoch: number } | null>(null);
  const recordingsRef = useRef<Record<string, PendingRecording>>({});

  const normalizedAttempts = useMemo(
    () => toSummaryAttempts(attempts, viewExercises),
    [attempts, viewExercises],
  );
  const targetSummary = useMemo(
    () => summarizePractice(targets, normalizedAttempts),
    [normalizedAttempts, targets],
  );
  const retryExercises = useMemo(
    () => selectRetryExercises(viewExercises as unknown as readonly Exercise[], normalizedAttempts),
    [normalizedAttempts, viewExercises],
  );
  const latestAttempts = useMemo(() => latestAttemptMap(attempts), [attempts]);

  useEffect(() => {
    setAnswers((current) => {
      const next: Record<string, AnswerValue> = {};
      for (const exercise of viewExercises) {
        next[exercise.id] = current[exercise.id] ?? initialAnswer(exercise);
      }
      return next;
    });
  }, [viewExercises]);

  useEffect(() => {
    const exerciseIds = new Set(viewExercises.map((exercise) => exercise.id));
    for (const [questionId, recording] of Object.entries(recordingsRef.current)) {
      if (exerciseIds.has(questionId)) continue;
      safeRevokeObjectUrl(recording.previewUrl);
      delete recordingsRef.current[questionId];
      setRecordings((current) => {
        const next = { ...current };
        delete next[questionId];
        return next;
      });
    }
  }, [viewExercises]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      for (const session of recordingSessionsRef.current.values()) {
        session.discard = true;
        if (session.timer) clearTimeout(session.timer);
        try {
          if (session.recorder && session.recorder.state !== "inactive") session.recorder.stop();
        } catch {
          // The browser may already have ended the recorder during unmount.
        }
        session.stream?.getTracks().forEach((track) => track.stop());
        session.stream = null;
      }
      for (const recording of Object.values(recordingsRef.current)) {
        safeRevokeObjectUrl(recording.previewUrl);
      }
      recordingSessionsRef.current.clear();
      activeRecordingRef.current = null;
      recordingsRef.current = {};
    };
  }, []);

  const setAnswer = useCallback((questionId: string, answer: AnswerValue) => {
    setAnswers((current) => ({ ...current, [questionId]: answer }));
    setErrors((current) => {
      if (!current[questionId]) return current;
      const next = { ...current };
      delete next[questionId];
      return next;
    });
  }, []);

  const setRecordingValue = useCallback((questionId: string, recording: PendingRecording | null) => {
    const previous = recordingsRef.current[questionId];
    if (previous && previous.previewUrl !== recording?.previewUrl) {
      safeRevokeObjectUrl(previous.previewUrl);
    }
    if (recording) recordingsRef.current[questionId] = recording;
    else delete recordingsRef.current[questionId];
    if (!mountedRef.current) return;
    setRecordings((current) => {
      const next = { ...current };
      if (recording) next[questionId] = recording;
      else delete next[questionId];
      return next;
    });
  }, []);

  const nextRecordingEpoch = useCallback((questionId: string): number => {
    const epoch = (recordingEpochsRef.current.get(questionId) ?? 0) + 1;
    recordingEpochsRef.current.set(questionId, epoch);
    return epoch;
  }, []);

  const isCurrentSession = useCallback((session: RecordingSession): boolean => (
    mountedRef.current
    && recordingSessionsRef.current.get(session.questionId) === session
    && recordingEpochsRef.current.get(session.questionId) === session.epoch
  ), []);

  const releaseSessionMedia = useCallback((session: RecordingSession) => {
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }
    session.stream?.getTracks().forEach((track) => track.stop());
    session.stream = null;
  }, []);

  const clearActiveSession = useCallback((session: RecordingSession) => {
    releaseSessionMedia(session);
    if (activeRecordingRef.current?.questionId === session.questionId
      && activeRecordingRef.current.epoch === session.epoch) {
      activeRecordingRef.current = null;
      if (mountedRef.current) setActiveRecordingQuestionId(null);
    }
    if (recordingSessionsRef.current.get(session.questionId) === session) {
      recordingSessionsRef.current.delete(session.questionId);
    }
  }, [releaseSessionMedia]);

  const abortSession = useCallback((session: RecordingSession, message?: string) => {
    session.discard = true;
    session.errorMessage = message ?? session.errorMessage;
    nextRecordingEpoch(session.questionId);
    const recorder = session.recorder;
    releaseSessionMedia(session);
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // A recorder can become inactive between the state check and stop().
      }
    }
    clearActiveSession(session);
    if (!mountedRef.current) return;
    setRecordingStates((current) => ({ ...current, [session.questionId]: "idle" }));
    if (message) {
      setRecordingErrors((current) => ({ ...current, [session.questionId]: message }));
    }
  }, [clearActiveSession, nextRecordingEpoch, releaseSessionMedia]);

  const finishRecording = useCallback(async (session: RecordingSession) => {
    const { questionId, recorder } = session;
    const mimeType = recorder?.mimeType || "audio/webm";
    const blob = new Blob(session.chunks, { type: mimeType });
    releaseSessionMedia(session);
    if (activeRecordingRef.current?.questionId === questionId
      && activeRecordingRef.current.epoch === session.epoch) {
      activeRecordingRef.current = null;
      if (mountedRef.current) setActiveRecordingQuestionId(null);
    }
    if (session.discard || !isCurrentSession(session)) {
      if (recordingSessionsRef.current.get(questionId) === session) recordingSessionsRef.current.delete(questionId);
      return;
    }
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (session.discard || !isCurrentSession(session)) {
        if (recordingSessionsRef.current.get(questionId) === session) recordingSessionsRef.current.delete(questionId);
        return;
      }
      const previewUrl = safeCreateObjectUrl(blob);
      setRecordingValue(questionId, { bytes, mimeType, previewUrl });
      recordingSessionsRef.current.delete(questionId);
      setRecordingStates((current) => ({ ...current, [questionId]: "idle" }));
    } catch {
      const current = isCurrentSession(session);
      if (recordingSessionsRef.current.get(questionId) === session) recordingSessionsRef.current.delete(questionId);
      if (!mountedRef.current || !current) return;
      setRecordingErrors((current) => ({
        ...current,
        [questionId]: "Không thể lưu bản ghi âm này.",
      }));
      setRecordingStates((current) => ({ ...current, [questionId]: "idle" }));
    }
  }, [isCurrentSession, releaseSessionMedia, setRecordingValue]);

  const startRecording = useCallback(async (questionId: string) => {
    if (activeRecordingRef.current) return;
    setRecordingErrors((current) => {
      const next = { ...current };
      delete next[questionId];
      return next;
    });
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setRecordingErrors((current) => ({
        ...current,
        [questionId]: "Thiết bị này chưa hỗ trợ ghi âm.",
      }));
      return;
    }
    const session: RecordingSession = {
      questionId,
      epoch: nextRecordingEpoch(questionId),
      stream: null,
      recorder: null,
      chunks: [],
      bytes: 0,
      timer: null,
      discard: false,
      errorMessage: null,
    };
    recordingSessionsRef.current.set(questionId, session);
    activeRecordingRef.current = { questionId, epoch: session.epoch };
    setActiveRecordingQuestionId(questionId);
    setRecordingStates((current) => ({ ...current, [questionId]: "requesting" }));
    let acquiredStream: MediaStream | null = null;
    try {
      acquiredStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!isCurrentSession(session)) {
        acquiredStream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mimeType = recordingMimeType();
      if (!mimeType) {
        acquiredStream.getTracks().forEach((track) => track.stop());
        clearActiveSession(session);
        setRecordingStates((current) => ({ ...current, [questionId]: "idle" }));
        setRecordingErrors((current) => ({
          ...current,
          [questionId]: "Thiết bị này chưa hỗ trợ định dạng ghi âm được yêu cầu.",
        }));
        return;
      }
      const recorder = new MediaRecorder(acquiredStream, { mimeType });
      session.stream = acquiredStream;
      session.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (!isCurrentSession(session) || session.discard || event.data.size === 0) return;
        const nextBytes = session.bytes + event.data.size;
        if (nextBytes > MAX_RECORDING_BYTES) {
          abortSession(session, "Bản ghi âm vượt quá giới hạn 16 MiB và đã được hủy.");
          return;
        }
        session.chunks.push(event.data);
        session.bytes = nextBytes;
      };
      recorder.onerror = () => {
        if (!isCurrentSession(session)) {
          releaseSessionMedia(session);
          return;
        }
        abortSession(session, "Đã xảy ra lỗi khi ghi âm.");
      };
      recorder.onstop = () => { void finishRecording(session); };
      recorder.start(RECORDING_TIMESLICE_MS);
      session.timer = setTimeout(() => {
        if (isCurrentSession(session)) abortSession(session, "Bản ghi âm đã đạt giới hạn 10 phút và được hủy.");
      }, MAX_RECORDING_DURATION_MS);
      setRecordingStates((current) => ({ ...current, [questionId]: "recording" }));
    } catch {
      acquiredStream?.getTracks().forEach((track) => track.stop());
      if (!isCurrentSession(session)) return;
      clearActiveSession(session);
      setRecordingStates((current) => ({ ...current, [questionId]: "idle" }));
      setRecordingErrors((current) => ({
        ...current,
        [questionId]: "Không thể truy cập microphone. Hãy cấp quyền ghi âm rồi thử lại.",
      }));
    }
  }, [abortSession, clearActiveSession, finishRecording, isCurrentSession, nextRecordingEpoch, releaseSessionMedia]);

  const cancelRecording = useCallback((questionId: string) => {
    const session = recordingSessionsRef.current.get(questionId);
    if (session) abortSession(session);
    else nextRecordingEpoch(questionId);
    if (mountedRef.current) {
      setRecordingStates((current) => ({ ...current, [questionId]: "idle" }));
      setRecordingErrors((current) => {
        const next = { ...current };
        delete next[questionId];
        return next;
      });
    }
  }, [abortSession, nextRecordingEpoch]);

  const stopRecording = useCallback((questionId: string) => {
    const session = recordingSessionsRef.current.get(questionId);
    const recorder = session?.recorder;
    if (!session || !recorder || recorder.state === "inactive") return;
    try {
      recorder.stop();
    } catch {
      abortSession(session, "Đã xảy ra lỗi khi dừng ghi âm.");
    }
  }, [abortSession]);

  const submitExercise = useCallback(async (
    event: FormEvent<HTMLFormElement>,
    exercise: PracticeExercise,
  ) => {
    event.preventDefault();
    const rawAnswer = answerForExercise(answers, exercise);
    const pendingRecording = recordings[exercise.id];
    const hasAudioOnlyRetell = exercise.kind === "retell" && Boolean(pendingRecording);
    if (answerIsEmpty(rawAnswer) && !hasAudioOnlyRetell) {
      setErrors((current) => ({
        ...current,
        [exercise.id]: exercise.kind === "retell"
          ? "Hãy viết hoặc ghi âm câu trả lời trước khi gửi."
          : "Hãy hoàn thành câu trả lời trước khi gửi.",
      }));
      return;
    }
    const answer = exercise.kind === "retell" && hasAudioOnlyRetell && typeof rawAnswer === "string" && rawAnswer.trim().length === 0
      ? ""
      : exercise.kind === "meaning" && exercise.answerChoiceIds.length === 1
      ? rawAnswer[0] ?? ""
      : rawAnswer;
    setSubmitting((current) => ({ ...current, [exercise.id]: true }));
    setErrors((current) => {
      const next = { ...current };
      delete next[exercise.id];
      return next;
    });
    try {
      const result = await onSubmit(
        exercise.id,
        answer,
        pendingRecording
          ? { bytes: pendingRecording.bytes, mimeType: pendingRecording.mimeType }
          : undefined,
      );
      if (!mountedRef.current) return;
      setResults((current) => ({ ...current, [exercise.id]: result }));
    } catch {
      if (!mountedRef.current) return;
      setErrors((current) => ({
        ...current,
        [exercise.id]: "Không thể lưu kết quả lúc này. Hãy thử lại.",
      }));
    } finally {
      if (mountedRef.current) setSubmitting((current) => ({ ...current, [exercise.id]: false }));
    }
  }, [answers, onSubmit, recordings]);

  const panelClassName = [
    "space-y-6",
    className,
  ].filter(Boolean).join(" ");

  return (
    <section className={panelClassName} data-testid="practice-panel" aria-labelledby="practice-panel-title">
      <header className="rounded-ej-lg border border-ej-line bg-ej-surface p-5 shadow-ej">
        <p className="ej-label">Luyện tập chủ động</p>
        <h2 id="practice-panel-title" className="mt-2 font-literata text-2xl font-bold tracking-[-0.02em] text-ej-ink">Ôn lại điều bạn vừa học</h2>
        <p className="mt-1.5 max-w-2xl text-xs leading-5 text-ej-muted">Hoàn thành từng câu rồi gửi để hệ thống lưu kết quả. Với phần kể lại, kết quả cần được bạn tự đánh giá.</p>
      </header>

      {targetSummary.length > 0 ? (
        <section className="rounded-ej-lg border border-ej-line bg-ej-surface p-5" aria-labelledby="practice-summary-title" data-testid="practice-summary">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="ej-label">Tiến độ</p>
              <h3 id="practice-summary-title" className="mt-1 font-literata text-lg font-bold text-ej-ink">Mỗi mục tiêu, một bước nhỏ</h3>
            </div>
            <p className="text-xs text-ej-muted">Số liệu tính trên toàn bộ lịch sử làm bài</p>
          </div>
          <div className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
            {targetSummary.map((summary) => {
              const target = targets.find((candidate) => candidate.id === summary.targetId);
              return (
                <article key={summary.targetId} className="rounded-ej border border-ej-line bg-ej-surface2 p-3.5" data-testid={`practice-target-summary-${summary.targetId}`}>
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="min-w-0 truncate font-literata text-base font-bold text-ej-ink">{target?.term ?? summary.targetId}</h4>
                    {summary.needsReview
                      ? <Pill tone="warn">Cần ôn lại</Pill>
                      : <Pill tone="ok">Ổn</Pill>}
                  </div>
                  <p className="ej-tabular mt-2 text-xs text-ej-muted">{summary.attempts} lần làm · {summary.correct} đúng · {summary.incorrect} sai</p>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {retryExercises.length > 0 ? (
        <section className="rounded-ej-lg border border-ej-line2 bg-ej-warn-soft p-5" aria-labelledby="practice-retry-title" data-testid="practice-retry-section">
          <p className="ej-label text-ej-warn">Lượt ôn lại gần nhất</p>
          <h3 id="practice-retry-title" className="mt-1 font-literata text-lg font-bold text-ej-ink">Câu cần luyện thêm</h3>
          <ul className="mt-3 flex flex-wrap gap-2">
            {retryExercises.map((exercise) => <li key={exercise.id} className="max-w-full"><Pill tone="warn" className="max-w-full"><span className="truncate">{exercise.prompt}</span></Pill></li>)}
          </ul>
        </section>
      ) : null}

      <div className="space-y-5" data-testid="practice-exercises">
        {viewExercises.map((exercise, index) => {
          const rawAnswer = answerForExercise(answers, exercise);
          const result = results[exercise.id] ?? asGradeResult(latestAttempts.get(exercise.id)?.result);
          const error = errors[exercise.id];
          const recordingError = recordingErrors[exercise.id];
          const recordingState = recordingStates[exercise.id] ?? "idle";
          const pendingRecording = recordings[exercise.id];
          const isRetry = retryExercises.some((candidate) => candidate.id === exercise.id);
          return (
            <form
              key={exercise.id}
              className="rounded-ej-lg border border-ej-line bg-ej-surface p-5 shadow-ej"
              onSubmit={(event) => { void submitExercise(event, exercise); }}
              data-testid={`practice-exercise-${exercise.id}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-ej-accent-soft px-1.5 text-xxs font-bold text-ej-accent-ink">{index + 1}</span>
                  <span className="ej-label">{exercise.kind === "meaning" ? "Ý nghĩa" : exercise.kind === "fill" ? "Điền từ" : exercise.kind === "order" ? "Sắp xếp" : "Kể lại"}</span>
                </div>
                {isRetry ? <Pill tone="warn">Ôn lại</Pill> : null}
              </div>
              <h3 className="mt-2.5 font-literata text-lg font-bold leading-7 text-ej-ink">{exercise.prompt}</h3>

              {exercise.kind === "meaning" ? <MeaningAnswer exercise={exercise} answer={Array.isArray(rawAnswer) ? rawAnswer : []} onChange={(next) => setAnswer(exercise.id, next)} /> : null}
              {exercise.kind === "fill" ? <FillAnswer exercise={exercise} answer={typeof rawAnswer === "string" ? rawAnswer : ""} onChange={(next) => setAnswer(exercise.id, next)} /> : null}
              {exercise.kind === "order" ? <OrderAnswer exercise={exercise} answer={Array.isArray(rawAnswer) ? rawAnswer : exercise.tokens.map(({ id }) => id)} onChange={(next) => setAnswer(exercise.id, next)} /> : null}
              {exercise.kind === "retell" ? <RetellAnswer exercise={exercise} answer={typeof rawAnswer === "string" ? rawAnswer : ""} onChange={(next) => setAnswer(exercise.id, next)} /> : null}

              {exercise.kind === "retell" ? (
                <div className="mt-4 rounded-ej border border-ej-line bg-ej-surface2 p-4" data-testid={`practice-retell-recording-${exercise.id}`}>
                  <p className="ej-label">Mục tiêu cần nhắc lại</p>
                  <ul className="mt-2 space-y-2 text-xs text-ej-ink2" data-testid={`practice-retell-targets-${exercise.id}`}>
                    {exercise.targetIds.map((targetId) => {
                      const target = targets.find((candidate) => candidate.id === targetId);
                      return <li key={targetId}><span className="font-semibold">{target?.term ?? targetId}</span>{target?.translationVi ? `: ${target.translationVi}` : ""}</li>;
                    })}
                  </ul>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {recordingState === "recording" || recordingState === "requesting" ? (
                      <>
                        <button type="button" onClick={() => stopRecording(exercise.id)} disabled={recordingState === "requesting"} className={DANGER_BUTTON} data-testid={`practice-recording-stop-${exercise.id}`}><Square className="h-3.5 w-3.5" aria-hidden />{recordingState === "requesting" ? "Đang xin quyền..." : "Dừng ghi âm"}</button>
                        <button type="button" onClick={() => cancelRecording(exercise.id)} className={SECONDARY_BUTTON} data-testid={`practice-recording-cancel-${exercise.id}`}>Hủy</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => { void startRecording(exercise.id); }} disabled={activeRecordingQuestionId !== null && activeRecordingQuestionId !== exercise.id} className={SECONDARY_BUTTON} data-testid={`practice-recording-start-${exercise.id}`}><Mic className="h-3.5 w-3.5 text-ej-bad" aria-hidden />Ghi âm câu trả lời</button>
                    )}
                    {pendingRecording?.previewUrl ? <audio controls src={pendingRecording.previewUrl} className="h-9 max-w-full" data-testid={`practice-recording-preview-${exercise.id}`} /> : null}
                    {pendingRecording ? <button type="button" onClick={() => setRecordingValue(exercise.id, null)} className={SECONDARY_BUTTON} data-testid={`practice-recording-remove-${exercise.id}`}><Trash2 className="h-3.5 w-3.5" aria-hidden />Xóa bản ghi</button> : null}
                  </div>
                  {recordingError ? <p className="mt-2 text-xs text-ej-bad" role="alert" data-testid={`practice-recording-error-${exercise.id}`}>{recordingError}</p> : null}
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button type="submit" disabled={Boolean(submitting[exercise.id]) || recordingState === "recording" || recordingState === "requesting"} className={PRIMARY_BUTTON} data-testid={`practice-submit-${exercise.id}`}><Check className="h-3.5 w-3.5" aria-hidden />{submitting[exercise.id] ? "Đang lưu..." : "Gửi câu trả lời"}</button>
                {latestAttempts.get(exercise.id)?.recordingAssetId && onPlayRecording ? <button type="button" onClick={() => onPlayRecording(latestAttempts.get(exercise.id)!.recordingAssetId!)} className={SECONDARY_BUTTON} data-testid={`practice-play-recording-${exercise.id}`}>Nghe bản ghi trước</button> : null}
              </div>

              {error ? <p className="mt-3 text-xs text-ej-bad" role="alert" data-testid={`practice-error-${exercise.id}`}>{error}</p> : null}
              {result ? <div className={`mt-4 rounded-[10px] border px-3.5 py-2.5 text-xs leading-5 ${result.correct === true ? "border-ej-ok bg-ej-ok-soft text-ej-ok" : result.correct === false ? "border-ej-bad bg-ej-bad-soft text-ej-bad" : "border-ej-warn bg-ej-warn-soft text-ej-warn"}`} role="status" aria-live="polite" data-testid={`practice-feedback-${exercise.id}`}><span className="font-semibold">{result.correct === true ? "Đúng" : result.correct === false ? "Cần luyện thêm" : "Tự đánh giá"}</span><span className="ml-2">{feedbackMessage(result)}</span></div> : null}
            </form>
          );
        })}
      </div>

      {viewExercises.length === 0 ? (
        <div data-testid="practice-empty">
          <EjEmptyState
            kicker="Luyện tập"
            title="Chưa có câu hỏi luyện tập"
            description="Hãy tạo bài học rồi quay lại đây để ôn tập chủ động."
          />
        </div>
      ) : null}
    </section>
  );
}

export default PracticePanel;
