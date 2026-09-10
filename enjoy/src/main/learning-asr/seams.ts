import type { StudyTimelineEntry } from "../../types/learning-asr";
import { lexicalKey } from "./text";

export type SeamBounds = {
  overlapStartTime: number;
  overlapEndTime: number;
  boundaryTime: number;
  silenceVerified?: boolean;
  language?: string;
};

export type SeamMerge = {
  consistent: boolean;
  words: StudyTimelineEntry[];
  anchors: number;
  reason: "matched" | "silence" | "disagreement" | "missing-anchor";
};

const center = (word: StudyTimelineEntry) =>
  (word.startTime + word.endTime) / 2;
const TIME_TOLERANCE = 0.65;
// A splice alone must not create a gap that the strict source-coverage gate
// will necessarily classify as meaningful: 0.6s plus 0.15s per word edge.
const COVERAGE_SAFE_SPLICE_GAP = 0.9;

const ENGLISH_SMALL_INTEGERS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const ENGLISH_TENS: Readonly<Record<string, number>> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function englishIntegerToken(text: string): number | undefined {
  const token = text.normalize("NFKC").toLocaleLowerCase().trim();
  const wrapped = token.match(
    /^[('"“‘[{]*([a-z0-9]+(?:-[a-z]+)?)[,.;:!?)'"”’}\]]*$/,
  );
  if (!wrapped) return undefined;
  const core = wrapped[1];

  if (/^(?:0|[1-9][0-9]?)$/.test(core)) return Number(core);
  if (Object.hasOwn(ENGLISH_SMALL_INTEGERS, core)) {
    return ENGLISH_SMALL_INTEGERS[core];
  }
  if (Object.hasOwn(ENGLISH_TENS, core)) return ENGLISH_TENS[core];

  const compound = core.match(/^([a-z]+)-([a-z]+)$/);
  if (!compound) return undefined;
  const tens = ENGLISH_TENS[compound[1]];
  const unit = ENGLISH_SMALL_INTEGERS[compound[2]];
  if (tens === undefined || unit === undefined || unit < 1 || unit > 9) {
    return undefined;
  }
  return tens + unit;
}

function seamComparisonKey(text: string, language?: string): string {
  const key = lexicalKey(text);
  if (!/^en(?:-|$)/i.test(language || "")) return key;
  const number = englishIntegerToken(text);
  return number === undefined ? key : `\u0000integer:${number}`;
}

/** Match only the shared audio interval. Text repetition elsewhere is never deduplicated. */
export function mergeAlignedWindows(
  left: readonly StudyTimelineEntry[],
  right: readonly StudyTimelineEntry[],
  bounds: SeamBounds,
): SeamMerge {
  const { overlapStartTime: start, overlapEndTime: end, boundaryTime } = bounds;
  const failure = (reason: SeamMerge["reason"], anchors = 0): SeamMerge => ({
    consistent: false,
    words: [],
    anchors,
    reason,
  });
  if (
    ![start, end, boundaryTime].every(Number.isFinite) ||
    end <= start ||
    boundaryTime < start ||
    boundaryTime > end
  ) {
    return failure("missing-anchor");
  }
  const inOverlap = (words: readonly StudyTimelineEntry[]) =>
    words
      .map((word, index) => ({
        word,
        index,
        key: seamComparisonKey(word.text, bounds.language),
      }))
      .filter(
        ({ word, key }) =>
          key && center(word) >= start - 0.03 && center(word) <= end + 0.03,
      );
  const a = inOverlap(left);
  const b = inOverlap(right);
  if (a.length === 0 && b.length === 0) {
    // Missing ASR words are not evidence of silence. The caller must inspect source PCM.
    if (
      bounds.silenceVerified === true &&
      left.every((word) => word.endTime <= boundaryTime) &&
      right.every((word) => word.startTime >= boundaryTime)
    ) {
      return {
        consistent: true,
        words: [...left, ...right],
        anchors: 0,
        reason: "silence",
      };
    }
    return failure("missing-anchor");
  }
  if (!a.length || !b.length || a.length > 300 || b.length > 300)
    return failure("missing-anchor");
  const canMatch = (i: number, j: number) =>
    a[i].key === b[j].key &&
    Math.abs(center(a[i].word) - center(b[j].word)) <= TIME_TOLERANCE;
  const scores = Array.from(
    { length: a.length + 1 },
    () => new Uint16Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      scores[i][j] = canMatch(i, j)
        ? scores[i + 1][j + 1] + 1
        : Math.max(scores[i + 1][j], scores[i][j + 1]);
    }
  }
  const matches: Array<{ i: number; j: number }> = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (canMatch(i, j) && scores[i][j] === scores[i + 1][j + 1] + 1) {
      matches.push({ i, j });
      i++;
      j++;
    } else if (scores[i + 1][j] > scores[i][j + 1]) i++;
    else j++;
  }
  if (matches.length < 2) return failure("missing-anchor", matches.length);
  const first = matches[0];
  const last = matches[matches.length - 1];
  const aInterior = a
    .slice(first.i, last.i + 1)
    .map((item) => item.key)
    .join(" ");
  const bInterior = b
    .slice(first.j, last.j + 1)
    .map((item) => item.key)
    .join(" ");
  if (aInterior !== bInterior) return failure("disagreement", matches.length);
  const aMatched = new Set(matches.map((match) => match.i));
  const bMatched = new Set(matches.map((match) => match.j));
  const rightSuffix = b.slice(last.j + 1);
  const leftFinal = left[left.length - 1];
  const keepsRightContinuation =
    rightSuffix.length > 0 &&
    a[last.i].index === left.length - 1 &&
    rightSuffix.every(({ word }) => word.startTime + 1e-6 >= leftFinal.endTime);
  // A clipped edge word may differ; an extra or missing word near the actual cut may not.
  const edgeMargin = Math.min(0.45, (end - start) / 5);
  const unmatchedInterior = (
    items: typeof a,
    matched: Set<number>,
    ignore: (index: number) => boolean = () => false,
  ) =>
    items.some(
      ({ word }, index) =>
        !matched.has(index) &&
        !ignore(index) &&
        center(word) > start + edgeMargin &&
        center(word) < end - edgeMargin,
    );
  if (
    unmatchedInterior(a, aMatched) ||
    unmatchedInterior(
      b,
      bMatched,
      (index) => keepsRightContinuation && index > last.j,
    )
  )
    return failure("disagreement", matches.length);
  const nearestAnchors = [...matches].sort(
    (x, y) =>
      Math.abs(center(a[x.i].word) - boundaryTime) -
      Math.abs(center(a[y.i].word) - boundaryTime),
  );
  const compatibleSplices: Array<{
    words: StudyTimelineEntry[];
    spliceGap: number;
  }> = [];
  for (const anchor of nearestAnchors) {
    const leftIndex = a[anchor.i].index;
    const rightIndex = b[anchor.j].index;
    const words = [
      ...left.slice(0, leftIndex + 1),
      ...right.slice(rightIndex + 1),
    ];
    // ASR words may agree while their independent alignments overlap. Choose an actual compatible splice.
    if (
      words.some(
        (word, index) =>
          index > 0 && word.startTime + 1e-6 < words[index - 1].endTime,
      )
    )
      continue;
    const nextRight = right[rightIndex + 1];
    compatibleSplices.push({
      words,
      spliceGap: nextRight
        ? Math.max(0, nextRight.startTime - left[leftIndex].endTime)
        : Number.POSITIVE_INFINITY,
    });
  }
  const selected = compatibleSplices.find(
    candidate => candidate.spliceGap + 1e-6 < COVERAGE_SAFE_SPLICE_GAP,
  ) || compatibleSplices[0];
  if (selected) {
    return {
      consistent: true,
      words: selected.words,
      anchors: matches.length,
      reason: "matched",
    };
  }
  return failure("disagreement", matches.length);
}
