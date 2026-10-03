import type { TimelineEntry } from "echogarden/dist/utilities/Timeline.d.js";
import type { StudyTimelineEntry } from "../../types/learning-asr";
import echogarden from "../echogarden";
import { encodePcmWindow, parsePcmWav } from "./audio-windows";
import { assertActive, LearningAsrError } from "./errors";
import { lexicalKey, lexicalUnits } from "./text";

export type StudyAlignmentOptions = {
  language: string;
  offsetSeconds: number;
  durationSeconds: number;
  signal?: AbortSignal;
};

export type StudyAlignmentResult = {
  words: StudyTimelineEntry[];
  omittedPhoneTimings: number;
  repairedWordTimings: number;
};

type TextSpan = { text: string; start: number; end: number; key: string };
type SanitizedEntry = { entry?: StudyTimelineEntry; omittedPhoneTimings: number };
type RawWordGroup = { spanIndex: number; rawStart: number; rawEnd: number };

const WORD_PATTERN = /(?:\p{N}{1,3}(?:,\p{N}{3})+(?:\.\p{N}+)?|[\p{L}\p{M}\p{N}]+(?:['’‘`.-][\p{L}\p{M}\p{N}]+)*)/gu;
const GROUPED_NUMBER_PATTERN = /^\p{N}{1,3}(?:,\p{N}{3})+(?:\.\p{N}+)?$/u;
const TIME_EPSILON = 1e-6;
const LOCAL_REPAIR_PLANS = [
  { contextSeconds: 5, anchorWords: 0 },
  { contextSeconds: 5, anchorWords: 4 },
  { contextSeconds: 9, anchorWords: 0 },
] as const;
const LOCAL_REPAIR_PADDING_SECONDS = 0.4;
const MAX_LOCAL_REPAIR_SECONDS = 15;
const MAX_ZERO_DURATION_REPAIRS = 3;
const ABBREVIATIONS = new Set([
  "dr", "mr", "mrs", "ms", "prof", "sr", "jr", "st", "vs", "etc", "eg", "ie",
]);

let alignmentQueue: Promise<void> = Promise.resolve();

function reviewRequired(message: string): LearningAsrError {
  return new LearningAsrError("asr_review_required", message);
}

function textSpans(text: string): TextSpan[] {
  return [...text.matchAll(WORD_PATTERN)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
    key: lexicalKey(match[0]),
  }));
}

function displayText(spans: readonly TextSpan[], index: number, transcript: string): string {
  const span = spans[index];
  const leading = index === 0 ? transcript.slice(0, span.start).trim() : "";
  const nextStart = spans[index + 1]?.start ?? transcript.length;
  const trailing = transcript.slice(span.end, nextStart).trim();
  return `${leading}${span.text}${trailing}`;
}

function normalizeNumericPunctuation(
  rawWords: readonly TimelineEntry[],
  transcript: string,
  duration: number,
): TimelineEntry[] {
  const normalized: TimelineEntry[] = [];
  const spans = textSpans(transcript);
  let rawIndex = 0;

  for (const span of spans) {
    const rawStart = rawIndex;
    let groupedKey = "";
    let hasPunctuationEntry = false;
    while (rawIndex < rawWords.length && groupedKey !== span.key) {
      const rawWord = rawWords[rawIndex];
      const rawKey = lexicalKey(rawWord.text);
      if (!rawKey) {
        if (!GROUPED_NUMBER_PATTERN.test(span.text)) {
          throw reviewRequired("Alignment returned a non-lexical word entry.");
        }
        hasPunctuationEntry = true;
      }
      groupedKey += rawKey;
      rawIndex += 1;
      if (!span.key.startsWith(groupedKey)) {
        throw reviewRequired("Alignment changed the requested lexical text.");
      }
    }
    if (groupedKey !== span.key || rawIndex === rawStart) {
      throw reviewRequired("Alignment did not cover a requested lexical word.");
    }

    const group = rawWords.slice(rawStart, rawIndex);
    if (!hasPunctuationEntry) {
      normalized.push(...group);
      continue;
    }
    if (group.map((entry) => entry.text).join("") !== span.text) {
      throw reviewRequired("Alignment changed numeric punctuation.");
    }

    let previousEnd = group[0].startTime;
    for (const entry of group) {
      const punctuationOnly = !lexicalKey(entry.text);
      const finiteGeometry = Number.isFinite(entry.startTime) && Number.isFinite(entry.endTime)
        && entry.startTime >= -TIME_EPSILON && entry.endTime <= duration + TIME_EPSILON
        && entry.endTime + TIME_EPSILON >= entry.startTime
        && entry.startTime + TIME_EPSILON >= previousEnd;
      if (entry.type !== "word" || !finiteGeometry
        || (!punctuationOnly && entry.endTime - entry.startTime <= TIME_EPSILON)) {
        throw reviewRequired("Alignment returned invalid numeric word geometry.");
      }
      previousEnd = entry.endTime;
    }
    normalized.push({
      ...group[0],
      text: span.text,
      startTime: group[0].startTime,
      endTime: group.at(-1)!.endTime,
      timeline: group.flatMap((entry) => entry.timeline || []),
    });
  }
  if (rawIndex !== rawWords.length) throw reviewRequired("Alignment returned extra lexical words.");
  return normalized;
}

function isFiniteRange(entry: { startTime: number; endTime: number }, start: number, end: number): boolean {
  return Number.isFinite(entry.startTime)
    && Number.isFinite(entry.endTime)
    && entry.endTime - entry.startTime > TIME_EPSILON
    && entry.startTime >= start - TIME_EPSILON
    && entry.endTime <= end + TIME_EPSILON;
}

function phoneCount(entry: TimelineEntry): number {
  return (entry.type === "phone" ? 1 : 0)
    + (entry.timeline || []).reduce((total, child) => total + phoneCount(child), 0);
}

function sanitizeChild(entry: TimelineEntry, parentStart: number, parentEnd: number): SanitizedEntry {
  if ((entry.type !== "token" && entry.type !== "phone") || !isFiniteRange(entry, parentStart, parentEnd)) {
    return { omittedPhoneTimings: phoneCount(entry) };
  }
  if (entry.type === "phone") {
    return {
      entry: { type: "phone", text: entry.text, startTime: entry.startTime, endTime: entry.endTime, timeline: [] },
      omittedPhoneTimings: 0,
    };
  }

  const children: StudyTimelineEntry[] = [];
  let omittedPhoneTimings = 0;
  let previousEnd = entry.startTime;
  for (const child of entry.timeline || []) {
    const sanitized = sanitizeChild(child, entry.startTime, entry.endTime);
    omittedPhoneTimings += sanitized.omittedPhoneTimings;
    if (!sanitized.entry) continue;
    if (sanitized.entry.startTime + TIME_EPSILON < previousEnd) {
      omittedPhoneTimings += sanitized.entry.type === "phone" ? 1 : phoneCount(child);
      continue;
    }
    children.push(sanitized.entry);
    previousEnd = sanitized.entry.endTime;
  }
  return {
    entry: {
      type: "token",
      text: entry.text,
      startTime: entry.startTime,
      endTime: entry.endTime,
      timeline: children,
    },
    omittedPhoneTimings,
  };
}

function validateWordRanges(
  words: readonly StudyTimelineEntry[],
  transcript: string,
  rangeStart: number,
  rangeEnd: number,
): void {
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeStart < 0 || rangeEnd <= rangeStart) {
    throw reviewRequired("Alignment source bounds are invalid.");
  }
  const expected = lexicalUnits(transcript);
  const actual = words.flatMap((word) => lexicalUnits(word.text));
  if (expected.length === 0 || words.length === 0 || expected.length !== actual.length
    || expected.some((unit, index) => unit !== actual[index])) {
    throw reviewRequired("Aligned words do not cover the requested transcript.");
  }

  let previousEnd = rangeStart;
  for (const word of words) {
    if (word.type !== "word" || !lexicalKey(word.text) || !isFiniteRange(word, rangeStart, rangeEnd)
      || word.startTime + TIME_EPSILON < previousEnd) {
      throw reviewRequired("Aligned word timestamps are invalid or non-monotonic.");
    }
    previousEnd = word.endTime;
  }
}

export function validateStudyWords(
  words: readonly StudyTimelineEntry[],
  transcript: string,
  duration: number,
): void {
  validateWordRanges(words, transcript, 0, duration);
}

function convertWords(
  rawWords: readonly TimelineEntry[],
  transcript: string,
  duration: number,
): { words: StudyTimelineEntry[]; omittedPhoneTimings: number } {
  const spans = textSpans(transcript);
  let previousRawEnd = 0;
  for (const rawWord of rawWords) {
    if (rawWord.type !== "word" || !lexicalKey(rawWord.text) || !isFiniteRange(rawWord, 0, duration)
      || rawWord.startTime + TIME_EPSILON < previousRawEnd) {
      throw reviewRequired("Alignment returned invalid lexical word geometry.");
    }
    previousRawEnd = rawWord.endTime;
  }

  const words: StudyTimelineEntry[] = [];
  let omittedPhoneTimings = 0;
  let rawIndex = 0;
  for (let spanIndex = 0; spanIndex < spans.length; spanIndex += 1) {
    const span = spans[spanIndex];
    const grouped: TimelineEntry[] = [];
    let groupedKey = "";
    while (rawIndex < rawWords.length && groupedKey !== span.key) {
      const rawWord = rawWords[rawIndex];
      grouped.push(rawWord);
      groupedKey += lexicalKey(rawWord.text);
      rawIndex += 1;
      if (!span.key.startsWith(groupedKey)) {
        throw reviewRequired("Alignment changed the requested lexical text.");
      }
    }
    if (groupedKey !== span.key || grouped.length === 0) {
      throw reviewRequired("Alignment did not cover a requested lexical word.");
    }
    const startTime = grouped[0].startTime;
    const endTime = grouped.at(-1)!.endTime;
    const children: StudyTimelineEntry[] = [];
    let previousEnd = startTime;
    for (const rawWord of grouped) {
      for (const child of rawWord.timeline || []) {
        const sanitized = sanitizeChild(child, startTime, endTime);
        omittedPhoneTimings += sanitized.omittedPhoneTimings;
        if (!sanitized.entry) continue;
        if (sanitized.entry.startTime + TIME_EPSILON < previousEnd) {
          omittedPhoneTimings += phoneCount(child);
          continue;
        }
        children.push(sanitized.entry);
        previousEnd = sanitized.entry.endTime;
      }
    }
    words.push({
      type: "word",
      text: displayText(spans, spanIndex, transcript),
      startTime,
      endTime,
      timeline: children,
    });
  }
  if (rawIndex !== rawWords.length) throw reviewRequired("Alignment returned extra lexical words.");
  validateStudyWords(words, transcript, duration);
  return { words, omittedPhoneTimings };
}

export type ProviderWordAlignmentResult = StudyAlignmentResult & {
  providerTimingAdjustments: { count: number; maxSeconds: number };
};

export function convertProviderWords(
  words: readonly { text: string; start: number; end: number }[],
  transcript: string,
  duration: number,
  offsetSeconds = 0,
): ProviderWordAlignmentResult {
  if (!Number.isFinite(offsetSeconds) || offsetSeconds < 0) throw reviewRequired("Provider word offset is invalid.");
  const rawWords: TimelineEntry[] = words.map((word): TimelineEntry => ({
    type: "word", text: word.text, startTime: word.start, endTime: word.end, timeline: [],
  }));
  const providerTimingAdjustments = { count: 0, maxSeconds: 0 };
  const maximumOverlapSeconds = 0.02;
  let previousEnd = 0;
  let previousStart = 0;
  for (const word of rawWords) {
    if (!isFiniteRange(word, 0, duration) || word.startTime + TIME_EPSILON < previousStart) {
      throw reviewRequired("Provider words returned invalid source geometry.");
    }
    previousStart = word.startTime;
    const overlap = previousEnd - word.startTime;
    if (overlap > TIME_EPSILON) {
      // Provider timestamps may overlap by one quantization step. Record any
      // bounded adjustment without changing text or inferring phone timings.
      if (overlap > maximumOverlapSeconds + TIME_EPSILON
        || word.endTime - previousEnd <= TIME_EPSILON) {
        throw reviewRequired("Provider word overlap exceeds bounded normalization.");
      }
      word.startTime = previousEnd;
      providerTimingAdjustments.count += 1;
      providerTimingAdjustments.maxSeconds = Math.max(providerTimingAdjustments.maxSeconds, overlap);
    }
    previousEnd = word.endTime;
  }
  const spans = textSpans(transcript);
  let rawIndex = 0;
  for (const span of spans) {
    let groupedKey = "";
    while (rawIndex < rawWords.length && groupedKey !== span.key) {
      const word = rawWords[rawIndex];
      let key = lexicalKey(word.text);
      // Leading elision marks belong to display punctuation, unlike an
      // apostrophe inside a contraction or its split trailing fragment.
      if (!groupedKey && key.startsWith("'") && key.replace(/^'+/u, "") === span.key) {
        word.text = word.text.replace(/^['’‘`]+/u, "");
        key = lexicalKey(word.text);
      }
      groupedKey += key;
      rawIndex += 1;
      if (!span.key.startsWith(groupedKey)) throw reviewRequired("Provider words changed the requested lexical text.");
    }
    if (groupedKey !== span.key) throw reviewRequired("Provider words did not cover the requested lexical text.");
  }
  if (rawIndex !== rawWords.length) throw reviewRequired("Provider words returned extra lexical text.");
  const normalized = normalizeNumericPunctuation(rawWords, transcript, duration);
  const converted = convertWords(normalized, transcript, duration);
  const shifted = converted.words.map(word => offsetEntry(word, offsetSeconds));
  validateWordRanges(shifted, transcript, offsetSeconds, offsetSeconds + duration);
  return { ...converted, words: shifted, repairedWordTimings: 0, providerTimingAdjustments };
}

function mapRawWords(rawWords: readonly TimelineEntry[], transcript: string): RawWordGroup[] {
  const spans = textSpans(transcript);
  const groups: RawWordGroup[] = [];
  let rawIndex = 0;
  for (let spanIndex = 0; spanIndex < spans.length; spanIndex += 1) {
    const rawStart = rawIndex;
    let groupedKey = "";
    while (rawIndex < rawWords.length && groupedKey !== spans[spanIndex].key) {
      const rawWord = rawWords[rawIndex];
      if (rawWord.type !== "word" || !lexicalKey(rawWord.text)) {
        throw reviewRequired("Alignment returned a non-lexical word entry.");
      }
      groupedKey += lexicalKey(rawWord.text);
      rawIndex += 1;
      if (!spans[spanIndex].key.startsWith(groupedKey)) {
        throw reviewRequired("Alignment changed the requested lexical text.");
      }
    }
    if (groupedKey !== spans[spanIndex].key || rawIndex === rawStart) {
      throw reviewRequired("Alignment did not cover a requested lexical word.");
    }
    groups.push({ spanIndex, rawStart, rawEnd: rawIndex });
  }
  if (rawIndex !== rawWords.length) throw reviewRequired("Alignment returned extra lexical words.");
  return groups;
}

function zeroDurationIndexes(rawWords: readonly TimelineEntry[], duration: number): number[] | undefined {
  const invalid: number[] = [];
  let previousEnd = 0;
  for (const [index, word] of rawWords.entries()) {
    if (word.type !== "word" || !lexicalKey(word.text)
      || !Number.isFinite(word.startTime) || !Number.isFinite(word.endTime)
      || word.startTime < -TIME_EPSILON || word.endTime > duration + TIME_EPSILON
      || word.endTime + TIME_EPSILON < word.startTime
      || word.startTime + TIME_EPSILON < previousEnd) {
      return undefined;
    }
    if (word.endTime - word.startTime <= TIME_EPSILON) invalid.push(index);
    previousEnd = word.endTime;
  }
  return invalid.length > 0 && invalid.length <= MAX_ZERO_DURATION_REPAIRS ? invalid : undefined;
}

function offsetRawEntry(entry: TimelineEntry, offsetSeconds: number): TimelineEntry {
  return {
    ...entry,
    startTime: entry.startTime + offsetSeconds,
    endTime: entry.endTime + offsetSeconds,
    timeline: (entry.timeline || []).map((child) => offsetRawEntry(child, offsetSeconds)),
  };
}

function smallestAnchoredSplice(
  original: readonly TimelineEntry[],
  originalGroups: readonly RawWordGroup[],
  local: readonly TimelineEntry[],
  localGroups: readonly RawWordGroup[],
  targetSpanIndex: number,
  contextFirstSpan: number,
  duration: number,
): { words: TimelineEntry[]; repairedWordTimings: number } | undefined {
  const localTarget = targetSpanIndex - contextFirstSpan;
  const ranges: Array<{ start: number; end: number }> = [];
  for (let start = 0; start <= localTarget; start += 1) {
    for (let end = localTarget; end < localGroups.length; end += 1) ranges.push({ start, end });
  }
  ranges.sort((left, right) => (left.end - left.start) - (right.end - right.start) || left.start - right.start);

  for (const range of ranges) {
    const originalStartGroup = originalGroups[contextFirstSpan + range.start];
    const originalEndGroup = originalGroups[contextFirstSpan + range.end];
    const localStartGroup = localGroups[range.start];
    const localEndGroup = localGroups[range.end];
    const replacement = local.slice(localStartGroup.rawStart, localEndGroup.rawEnd);
    const leftAnchor = originalStartGroup.rawStart === 0 ? 0 : original[originalStartGroup.rawStart - 1].endTime;
    const rightAnchor = originalEndGroup.rawEnd === original.length ? duration : original[originalEndGroup.rawEnd].startTime;
    if (replacement.length === 0 || replacement[0].startTime + TIME_EPSILON < leftAnchor
      || replacement.at(-1)!.endTime > rightAnchor + TIME_EPSILON) continue;
    return {
      words: [
        ...original.slice(0, originalStartGroup.rawStart),
        ...replacement,
        ...original.slice(originalEndGroup.rawEnd),
      ],
      repairedWordTimings: range.end - range.start + 1,
    };
  }
  return undefined;
}

async function repairZeroDurationWords(
  audio: Uint8Array,
  transcript: string,
  duration: number,
  rawWords: readonly TimelineEntry[],
  language: string,
  repairEngine: "dtw" | "whisper",
  signal?: AbortSignal,
): Promise<{ converted: StudyAlignmentResult; rawWords: TimelineEntry[] } | undefined> {
  let pcm;
  try {
    pcm = parsePcmWav(Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength));
  } catch {
    return undefined;
  }
  let repaired = [...rawWords];
  let repairedWordTimings = 0;
  for (let repairIndex = 0; repairIndex < MAX_ZERO_DURATION_REPAIRS; repairIndex += 1) {
    const invalid = zeroDurationIndexes(repaired, duration);
    if (!invalid) return undefined;
    const targetRawIndex = invalid[0];
    let originalGroups: RawWordGroup[];
    try {
      originalGroups = mapRawWords(repaired, transcript);
    } catch {
      return undefined;
    }
    const targetGroup = originalGroups.find((group) => group.rawStart <= targetRawIndex && targetRawIndex < group.rawEnd);
    if (!targetGroup) return undefined;
    let accepted: { words: TimelineEntry[]; repairedWordTimings: number } | undefined;

    for (const { contextSeconds, anchorWords } of LOCAL_REPAIR_PLANS) {
      let firstRaw = targetRawIndex;
      let lastRaw = targetRawIndex;
      const center = repaired[targetRawIndex].startTime;
      while (firstRaw > 0 && center - repaired[firstRaw].startTime < contextSeconds / 2) firstRaw -= 1;
      while (lastRaw + 1 < repaired.length && repaired[lastRaw].endTime - center < contextSeconds / 2) lastRaw += 1;
      const firstIntersectingGroup = originalGroups.findIndex((group) => group.rawEnd > firstRaw);
      const lastIntersectingGroup = originalGroups.findLastIndex((group) => group.rawStart <= lastRaw);
      if (firstIntersectingGroup < 0 || lastIntersectingGroup < firstIntersectingGroup) continue;
      let firstGroupIndex = firstIntersectingGroup;
      let lastGroupIndex = lastIntersectingGroup;
      if (anchorWords > 0) {
        firstGroupIndex = Math.max(0, firstGroupIndex - anchorWords);
        lastGroupIndex = Math.min(originalGroups.length - 1, lastGroupIndex + anchorWords);
      }
      const includedGroups = originalGroups.slice(firstGroupIndex, lastGroupIndex + 1);
      const firstSpan = includedGroups[0].spanIndex;
      const lastSpan = includedGroups.at(-1)!.spanIndex;
      const spans = textSpans(transcript);
      const localText = transcript.slice(spans[firstSpan].start, spans[lastSpan + 1]?.start ?? transcript.length).trim();
      const audioStart = Math.max(0, repaired[includedGroups[0].rawStart].startTime - LOCAL_REPAIR_PADDING_SECONDS);
      const audioEnd = Math.min(duration, repaired[includedGroups.at(-1)!.rawEnd - 1].endTime + LOCAL_REPAIR_PADDING_SECONDS);
      if (audioEnd - audioStart > MAX_LOCAL_REPAIR_SECONDS) continue;
      const startSample = Math.max(0, Math.floor(audioStart * pcm.sampleRate));
      const endSample = Math.min(pcm.frameCount, Math.ceil(audioEnd * pcm.sampleRate));
      if (endSample <= startSample) continue;

      const engines = [repairEngine, repairEngine === "dtw" ? "whisper" : "dtw"] as const;
      for (const engine of engines) {
        try {
          assertActive(signal);
          const normalizedLanguage = language.trim().toLocaleLowerCase();
          const localResult = await echogarden.align(encodePcmWindow(pcm, { startSample, endSample }), localText, {
            language,
            crop: false,
            engine,
            ...(engine === "dtw"
              ? { dtw: { phoneAlignmentMethod: "dtw" as const } }
              : { whisper: { model: normalizedLanguage === "en" || normalizedLanguage.startsWith("en-") ? "tiny.en" : "tiny" } }),
          });
          assertActive(signal);
          const localDuration = (endSample - startSample) / pcm.sampleRate;
          const localWords = normalizeNumericPunctuation(localResult.wordTimeline, localText, localDuration);
          convertWords(localWords, localText, localDuration);
          const localGroups = mapRawWords(localWords, localText);
          const offset = startSample / pcm.sampleRate;
          const offsetWords = localWords.map((word) => offsetRawEntry(word, offset));
          accepted = smallestAnchoredSplice(
            repaired, originalGroups, offsetWords, localGroups, targetGroup.spanIndex, firstSpan, duration,
          );
          if (accepted) break;
        } catch (error) {
          if (error instanceof LearningAsrError && error.code === "asr_cancelled") throw error;
        }
      }
      if (accepted) break;
    }
    if (!accepted) return undefined;
    repaired = accepted.words;
    repairedWordTimings += accepted.repairedWordTimings;
    try {
      const converted = convertWords(repaired, transcript, duration);
      return { converted: { ...converted, repairedWordTimings }, rawWords: repaired };
    } catch {
      // Continue only when another bounded zero-duration repair remains.
    }
  }
  return undefined;
}

function offsetEntry(entry: StudyTimelineEntry, offsetSeconds: number): StudyTimelineEntry {
  return {
    ...entry,
    startTime: entry.startTime + offsetSeconds,
    endTime: entry.endTime + offsetSeconds,
    timeline: entry.timeline.map((child) => offsetEntry(child, offsetSeconds)),
  };
}

function enqueueAlignment<T>(operation: () => Promise<T>): Promise<T> {
  const result = alignmentQueue.then(operation);
  alignmentQueue = result.then((): void => {}, (): void => {});
  return result;
}

export async function alignStudyWindow(
  audio: Uint8Array,
  text: string,
  options: StudyAlignmentOptions,
): Promise<StudyAlignmentResult> {
  assertActive(options.signal);
  if (!(audio instanceof Uint8Array) || audio.byteLength === 0) {
    throw new LearningAsrError("asr_invalid_audio", "Alignment audio is empty.");
  }
  if (!Number.isFinite(options.offsetSeconds) || options.offsetSeconds < 0
    || !Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0) {
    throw new LearningAsrError("asr_invalid_audio", "Alignment window bounds are invalid.");
  }
  if (lexicalUnits(text).length === 0) throw reviewRequired("Alignment transcript has no lexical words.");

  return enqueueAlignment(async () => {
    assertActive(options.signal);
    const baseOptions = { language: options.language, crop: false } as const;
    let converted: StudyAlignmentResult | undefined;
    try {
      const primary = await echogarden.align(audio, text, {
        ...baseOptions,
        engine: "dtw",
        dtw: { phoneAlignmentMethod: "dtw" },
      });
      assertActive(options.signal);
      const primaryWords = normalizeNumericPunctuation(primary.wordTimeline, text, options.durationSeconds);
      try {
        converted = { ...convertWords(primaryWords, text, options.durationSeconds), repairedWordTimings: 0 };
      } catch {
        const repaired = await repairZeroDurationWords(
          audio, text, options.durationSeconds, primaryWords, options.language, "whisper", options.signal,
        );
        converted = repaired?.converted;
      }
    } catch (error) {
      if (error instanceof LearningAsrError && error.code === "asr_cancelled") throw error;
    }

    if (!converted) {
      assertActive(options.signal);
      try {
        const language = options.language.trim().toLocaleLowerCase();
        const fallback = await echogarden.align(audio, text, {
          ...baseOptions,
          engine: "whisper",
          whisper: { model: language === "en" || language.startsWith("en-") ? "tiny.en" : "tiny" },
        });
        assertActive(options.signal);
        const fallbackWords = normalizeNumericPunctuation(fallback.wordTimeline, text, options.durationSeconds);
        try {
          converted = { ...convertWords(fallbackWords, text, options.durationSeconds), repairedWordTimings: 0 };
        } catch {
          const repaired = await repairZeroDurationWords(
            audio, text, options.durationSeconds, fallbackWords, options.language, "dtw", options.signal,
          );
          converted = repaired?.converted;
          if (!converted) throw reviewRequired("Local alignment repair could not restore reliable word timestamps.");
        }
      } catch (error) {
        if (error instanceof LearningAsrError && error.code === "asr_cancelled") throw error;
        throw reviewRequired("Local forced alignment could not produce reliable study timestamps.");
      }
    }

    const words = converted.words.map((word) => offsetEntry(word, options.offsetSeconds));
    validateWordRanges(words, text, options.offsetSeconds, options.offsetSeconds + options.durationSeconds);
    return {
      words,
      omittedPhoneTimings: converted.omittedPhoneTimings,
      repairedWordTimings: converted.repairedWordTimings,
    };
  });
}

type SentencePiece = { text: string; start: number; end: number };

function sentencePieces(transcript: string, language: string): SentencePiece[] {
  const segmented = [...new Intl.Segmenter(language || undefined, { granularity: "sentence" }).segment(transcript)]
    .map((part) => ({ text: part.segment, start: part.index, end: part.index + part.segment.length }));
  const pieces = segmented.length > 0 ? segmented : [{ text: transcript, start: 0, end: transcript.length }];
  const merged: SentencePiece[] = [];
  for (const piece of pieces) {
    const previous = merged.at(-1);
    if (previous) {
      const trimmed = previous.text.trimEnd();
      const units = lexicalUnits(trimmed);
      const lastUnit = units.at(-1) || "";
      if (trimmed.endsWith(".") && units.length === 1 && ABBREVIATIONS.has(lastUnit)) {
        previous.text += piece.text;
        previous.end = piece.end;
        continue;
      }
    }
    merged.push({ ...piece });
  }
  return merged;
}

export function buildStudyTimeline(
  words: StudyTimelineEntry[],
  transcript: string,
  language: string,
  duration: number,
): StudyTimelineEntry[] {
  validateStudyWords(words, transcript, duration);
  const spans = textSpans(transcript);
  const normalizedWords = words.map((word, index) => ({
    ...word,
    text: displayText(spans, index, transcript),
    timeline: word.timeline.map((child) => ({ ...child })),
  }));
  const sentences: StudyTimelineEntry[] = [];
  let wordIndex = 0;
  let pendingPrefix = "";

  for (const piece of sentencePieces(transcript, language)) {
    const sentenceWords: StudyTimelineEntry[] = [];
    while (wordIndex < spans.length && spans[wordIndex].start < piece.end) {
      if (spans[wordIndex].end > piece.start) sentenceWords.push(normalizedWords[wordIndex]);
      wordIndex += 1;
    }
    if (sentenceWords.length === 0) {
      if (sentences.length > 0) sentences[sentences.length - 1].text += piece.text;
      else pendingPrefix += piece.text;
      continue;
    }
    sentences.push({
      type: "sentence",
      text: pendingPrefix + piece.text,
      startTime: sentenceWords[0].startTime,
      endTime: sentenceWords.at(-1)!.endTime,
      timeline: sentenceWords,
    });
    pendingPrefix = "";
  }

  if (pendingPrefix && sentences.length > 0) sentences[sentences.length - 1].text += pendingPrefix;
  if (wordIndex !== words.length || sentences.length === 0
    || sentences.map((sentence) => sentence.text).join("") !== transcript) {
    throw reviewRequired("Sentence segmentation did not preserve the complete transcript.");
  }
  for (const [index, sentence] of sentences.entries()) {
    if (!isFiniteRange(sentence, 0, duration)
      || (index > 0 && sentence.startTime + TIME_EPSILON < sentences[index - 1].endTime)
      || sentence.timeline.some((word) => word.startTime < sentence.startTime - TIME_EPSILON
        || word.endTime > sentence.endTime + TIME_EPSILON)) {
      throw reviewRequired("Sentence and word timestamps are not ordered and contained.");
    }
  }
  return sentences;
}
