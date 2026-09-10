import { ExerciseSchema } from "./learning-schemas";
import type {
  Exercise,
  LearningTarget,
} from "../types/learning";

const MAX_FIXED_ANSWER_LENGTH = 300;
const MAX_RECALL_ANSWER_LENGTH = 24_000;
const APOSTROPHE_PATTERN = /[\u2018\u2019\u02BC\uFF07\u275B\u275C\uA78C\u2032\u00B4]/gu;

export type PracticeFeedbackCode = "correct" | "incorrect" | "self_review";

export interface PracticeGrade {
  kind: Exercise["kind"];
  correct: boolean | null;
  normalizedAnswer: unknown;
  expectedAnswer: unknown;
  feedbackCode: PracticeFeedbackCode;
  targetIds: string[];
}

export interface PracticeSummaryAttempt {
  questionId: string;
  kind: Exercise["kind"];
  targetIds: string[];
  result: {
    correct: boolean | null;
  };
}

export interface PracticeTargetSummary {
  targetId: string;
  attempts: number;
  correct: number;
  incorrect: number;
  needsReview: boolean;
}

export class PracticeGradingError extends TypeError {
  readonly code: "invalid_exercise" | "invalid_answer";

  constructor(
    code: "invalid_exercise" | "invalid_answer",
    message: string
  ) {
    super(message);
    this.name = "PracticeGradingError";
    this.code = code;
  }
}

const invalidAnswer = (message: string): never => {
  throw new PracticeGradingError("invalid_answer", message);
};

const parseExercise = (exercise: unknown): Exercise => {
  const parsed = ExerciseSchema.safeParse(exercise);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new PracticeGradingError(
      "invalid_exercise",
      issue?.message || "exercise does not satisfy ExerciseSchema"
    );
  }
  return parsed.data as Exercise;
};

const normalizeApostrophes = (value: string): string =>
  value.normalize("NFC").replace(APOSTROPHE_PATTERN, "'");

const normalizeFillAnswer = (answer: unknown): string => {
  if (typeof answer !== "string") {
    return invalidAnswer("fill answer must be a string");
  }
  if (answer.length > MAX_FIXED_ANSWER_LENGTH) {
    return invalidAnswer("fill answer is too long");
  }
  const normalized = normalizeApostrophes(answer)
    .replace(/,/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.!?]+$/gu, "")
    .trim()
    .toLocaleLowerCase("en-US");
  if (!normalized) {
    return invalidAnswer("fill answer must not be empty");
  }
  return normalized;
};

const normalizeMeaningAnswer = (
  answer: unknown,
  choiceIds: ReadonlySet<string>
): string[] => {
  const answerIds = typeof answer === "string" ? [answer] : answer;
  if (!Array.isArray(answerIds) || answerIds.length === 0 || answerIds.length > 8) {
    return invalidAnswer("meaning answer must contain one to eight choice IDs");
  }
  const normalized = [...answerIds];
  const seen = new Set<string>();
  for (const choiceId of normalized) {
    if (typeof choiceId !== "string") {
      return invalidAnswer("meaning answer choice IDs must be strings");
    }
    if (!choiceIds.has(choiceId)) {
      return invalidAnswer("meaning answer contains an unknown choice ID");
    }
    if (seen.has(choiceId)) {
      return invalidAnswer("meaning answer choice IDs must be unique");
    }
    seen.add(choiceId);
  }
  return normalized.sort();
};

const normalizeOrderAnswer = (
  answer: unknown,
  tokenIds: ReadonlySet<string>
): string[] => {
  if (!Array.isArray(answer) || answer.length === 0 || answer.length > 32) {
    return invalidAnswer("order answer must contain one to thirty-two token IDs");
  }
  const normalized = [...answer];
  const seen = new Set<string>();
  for (const tokenId of normalized) {
    if (typeof tokenId !== "string") {
      return invalidAnswer("order answer token IDs must be strings");
    }
    if (!tokenIds.has(tokenId)) {
      return invalidAnswer("order answer contains an unknown token ID");
    }
    if (seen.has(tokenId)) {
      return invalidAnswer("order answer token IDs must be unique");
    }
    seen.add(tokenId);
  }
  return normalized;
};

const normalizeRetellAnswer = (answer: unknown): string => {
  if (typeof answer !== "string") {
    return invalidAnswer("retell answer must be a string");
  }
  if (answer.length > MAX_RECALL_ANSWER_LENGTH) {
    return invalidAnswer("retell answer is too long");
  }
  const normalized = normalizeApostrophes(answer).replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return invalidAnswer("retell answer must not be empty");
  }
  return normalized;
};

const equalStringArrays = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const fixedGrade = (
  exercise: Exercise,
  normalizedAnswer: unknown,
  expectedAnswer: unknown,
  correct: boolean
): PracticeGrade => ({
  kind: exercise.kind,
  correct,
  normalizedAnswer,
  expectedAnswer,
  feedbackCode: correct ? "correct" : "incorrect",
  targetIds: [...exercise.targetIds],
});

export function gradePractice(
  exercise: Exercise,
  answer: unknown
): PracticeGrade {
  const parsedExercise = parseExercise(exercise);

  if (parsedExercise.kind === "meaning") {
    const choiceIds = new Set(parsedExercise.choices.map(({ id }) => id));
    const normalizedAnswer = normalizeMeaningAnswer(answer, choiceIds);
    const expectedAnswer = [...parsedExercise.answerChoiceIds];
    const normalizedExpectedAnswer = [...expectedAnswer].sort();
    return fixedGrade(
      parsedExercise,
      normalizedAnswer,
      expectedAnswer,
      equalStringArrays(normalizedAnswer, normalizedExpectedAnswer)
    );
  }

  if (parsedExercise.kind === "fill") {
    const normalizedAnswer = normalizeFillAnswer(answer);
    const expectedAnswer = [...parsedExercise.acceptedAnswers];
    const normalizedExpectedAnswer = expectedAnswer.map(normalizeFillAnswer);
    return fixedGrade(
      parsedExercise,
      normalizedAnswer,
      expectedAnswer,
      normalizedExpectedAnswer.includes(normalizedAnswer)
    );
  }

  if (parsedExercise.kind === "order") {
    const tokenIds = new Set(parsedExercise.tokens.map(({ id }) => id));
    const normalizedAnswer = normalizeOrderAnswer(answer, tokenIds);
    const expectedAnswer = parsedExercise.acceptedOrders.map((order) => [...order]);
    return fixedGrade(
      parsedExercise,
      normalizedAnswer,
      expectedAnswer,
      expectedAnswer.some((order) => equalStringArrays(normalizedAnswer, order))
    );
  }

  const normalizedAnswer = normalizeRetellAnswer(answer);
  return {
    kind: parsedExercise.kind,
    correct: null,
    normalizedAnswer,
    expectedAnswer: null,
    feedbackCode: "self_review",
    targetIds: [...parsedExercise.targetIds],
  };
}

export function summarizePractice(
  targets: readonly LearningTarget[],
  attempts: readonly PracticeSummaryAttempt[]
): PracticeTargetSummary[] {
  const counters = new Map<string, {
    attempts: number;
    correct: number;
    incorrect: number;
    needsReview: boolean;
  }>();
  const latestByQuestion = new Map<string, PracticeSummaryAttempt>();
  for (const target of targets) {
    if (!counters.has(target.id)) {
      counters.set(target.id, {
        attempts: 0,
        correct: 0,
        incorrect: 0,
        needsReview: false,
      });
    }
  }

  for (const attempt of attempts) {
    latestByQuestion.set(attempt.questionId, attempt);
    const seenTargetIds = new Set(attempt.targetIds);
    for (const targetId of seenTargetIds) {
      const counter = counters.get(targetId);
      if (!counter) continue;
      counter.attempts += 1;
      if (attempt.result.correct === true) {
        counter.correct += 1;
      } else if (attempt.result.correct === false) {
        counter.incorrect += 1;
      }
    }
  }

  for (const attempt of latestByQuestion.values()) {
    if (attempt.result.correct === true) continue;
    for (const targetId of new Set(attempt.targetIds)) {
      const counter = counters.get(targetId);
      if (counter) counter.needsReview = true;
    }
  }

  return targets.map((target) => ({
    targetId: target.id,
    ...counters.get(target.id)!,
  }));
}

export function selectRetryExercises(
  exercises: readonly Exercise[],
  attempts: readonly PracticeSummaryAttempt[]
): Exercise[] {
  const parsedExercises = exercises.map((exercise) => parseExercise(exercise));
  const latestAttempts = new Map<string, PracticeSummaryAttempt>();
  for (const attempt of attempts) {
    latestAttempts.set(attempt.questionId, attempt);
  }

  const wrongTargetIds = new Set<string>();
  for (const attempt of latestAttempts.values()) {
    if (attempt.result.correct !== false) continue;
    for (const targetId of new Set(attempt.targetIds)) {
      wrongTargetIds.add(targetId);
    }
  }

  return parsedExercises.filter((exercise) => {
    if (exercise.kind === "retell") return false;
    const latestAttempt = latestAttempts.get(exercise.id);
    if (latestAttempt && latestAttempt.result.correct !== false) return false;
    return exercise.targetIds.some((targetId) => wrongTargetIds.has(targetId));
  });
}
