import type { CefrLevel, LessonLength } from "../types/learning";

export type WordRange = readonly [number, number];

export type CefrRubric = {
  wordRange: WordRange;
  maxSentenceWords: number;
};

export const CEFR_LEVEL_ORDER: readonly CefrLevel[] = [
  "A1",
  "A2",
  "B1",
  "B2",
  "C1",
  "C2",
];

export const CEFR_RUBRICS: Record<CefrLevel, Record<LessonLength, CefrRubric>> = {
  A1: {
    short: { wordRange: [60, 120], maxSentenceWords: 12 },
    medium: { wordRange: [100, 180], maxSentenceWords: 12 },
    long: { wordRange: [150, 250], maxSentenceWords: 14 },
  },
  A2: {
    short: { wordRange: [100, 180], maxSentenceWords: 16 },
    medium: { wordRange: [150, 250], maxSentenceWords: 18 },
    long: { wordRange: [220, 350], maxSentenceWords: 20 },
  },
  B1: {
    short: { wordRange: [140, 220], maxSentenceWords: 20 },
    medium: { wordRange: [220, 350], maxSentenceWords: 24 },
    long: { wordRange: [320, 500], maxSentenceWords: 28 },
  },
  B2: {
    short: { wordRange: [180, 280], maxSentenceWords: 24 },
    medium: { wordRange: [280, 450], maxSentenceWords: 30 },
    long: { wordRange: [420, 650], maxSentenceWords: 34 },
  },
  C1: {
    short: { wordRange: [220, 340], maxSentenceWords: 28 },
    medium: { wordRange: [340, 550], maxSentenceWords: 36 },
    long: { wordRange: [500, 800], maxSentenceWords: 40 },
  },
  C2: {
    short: { wordRange: [260, 400], maxSentenceWords: 32 },
    medium: { wordRange: [400, 650], maxSentenceWords: 42 },
    long: { wordRange: [600, 900], maxSentenceWords: 48 },
  },
};

export const CURATED_TARGET_LEVELS: Readonly<Record<string, CefrLevel>> = {
  nevertheless: "B2",
  consequently: "B2",
  sustainable: "B2",
  ambiguous: "B2",
  meticulous: "C1",
  entrepreneurship: "C1",
  interdisciplinary: "C1",
  polysemy: "C1",
  circadian: "C1",
  photosynthesis: "C1",
};

export function getCefrRubric(level: CefrLevel, length: LessonLength): CefrRubric {
  return CEFR_RUBRICS[level][length];
}

export function getCuratedTargetLevel(term: string): CefrLevel | undefined {
  const normalized = term
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u02BC\uFF07]/gu, "'")
    .toLocaleLowerCase("en-US")
    .trim()
    .replace(/\s+/gu, " ");
  return CURATED_TARGET_LEVELS[normalized];
}
