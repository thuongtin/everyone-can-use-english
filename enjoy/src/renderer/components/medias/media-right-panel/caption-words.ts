import { TimelineEntry } from "echogarden/dist/utilities/Timeline.d.js";
import { convertWordIpaToNormal } from "@/utils";

/** A token is a word only when it carries letters or digits; punctuation is inert. */
export const isLexical = (token: string) => /[\p{L}\p{N}]/u.test(token);

const normalize = (token: string) =>
  token.replace(/[^\p{L}\p{N}']/gu, "").toLowerCase();

/**
 * Splits the caption into the tokens drawn in the pane. Falls back to the
 * timeline when the plain text cannot be split into as many words as the
 * timeline holds, so word indices always address the same timeline entry.
 */
export const splitCaptionWords = (caption: TimelineEntry): string[] => {
  const words = caption.text
    .replace(/ ([.,!?:;])/g, "$1")
    .replace(/ (['"")])/g, "$1")
    .replace(/ \.\.\./g, "...")
    .split(/([\u2014]|\s+)/g)
    .filter((word) => word.trim() !== "" && word !== "\u2014");

  if (words.length !== caption.timeline.length) {
    return caption.timeline.map((word) => word.text);
  }

  return words;
};

/**
 * Maps every display word to its accuracy score from the selected recording.
 * Matching walks both lists in order with a small lookahead, so a single
 * insertion or omission in the assessment does not shift the whole sentence.
 */
export const wordScoresFor = (
  words: string[],
  assessed: PronunciationAssessmentWordResultType[]
): Map<number, number> => {
  const scores = new Map<number, number>();
  if (!assessed?.length) return scores;

  let cursor = 0;
  words.forEach((word, index) => {
    if (!isLexical(word)) return;

    const target = normalize(word);
    if (!target) return;

    const limit = Math.min(assessed.length, cursor + 4);
    for (let i = cursor; i < limit; i++) {
      if (normalize(assessed[i].word || "") !== target) continue;

      const score = assessed[i].pronunciationAssessment?.accuracyScore;
      if (typeof score === "number") scores.set(index, Math.round(score));
      cursor = i + 1;
      break;
    }
  });

  return scores;
};

export type ScoreTone = "ok" | "warn" | "bad";

/** Score bands shared by the underlines, the chip dot and the lookup popover. */
export const scoreTone = (score: number): ScoreTone =>
  score >= 80 ? "ok" : score >= 60 ? "warn" : "bad";

/** A word needs practice when the recording scored it below 80. */
export const WEAK_SCORE = 80;

export const formatTimestamp = (seconds: number) => {
  if (!Number.isFinite(seconds)) return "0:00";

  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * Phonetics of every word of the sentence, already mapped to the notation the
 * user picked. Shared by the sentence itself and the lookup popover.
 */
export const captionIpas = (
  caption: TimelineEntry,
  language: string,
  ipaMappings: any
): string[] =>
  caption.timeline.map((word) =>
    (word.timeline || [])
      .map((entry: any) =>
        entry.timeline && language.startsWith("en")
          ? convertWordIpaToNormal(
              entry.timeline.map((phoneme: any) => phoneme.text),
              { mappings: ipaMappings }
            ).join("")
          : entry.text
      )
      .join("")
  );
