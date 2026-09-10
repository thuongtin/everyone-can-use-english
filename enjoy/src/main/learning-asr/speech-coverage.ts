import { detectVoiceActivity } from "echogarden/dist/api/API.js";
import type { StudyTimelineEntry } from "../../types/learning-asr";
import { assertActive, LearningAsrError } from "./errors";

export type SpeechCoverageGap = { startTime: number; endTime: number };

const WORD_MARGIN_SECONDS = 0.15;
const MIN_UNCOVERED_SPEECH_SECONDS = 0.6;
const CUMULATIVE_WINDOW_SECONDS = 1;
const TIME_EPSILON = 1e-6;

function reviewRequired(message: string): LearningAsrError {
  return new LearningAsrError("asr_review_required", message);
}

function mergeIntervals(intervals: readonly SpeechCoverageGap[]): SpeechCoverageGap[] {
  const sorted = [...intervals].sort((left, right) => left.startTime - right.startTime || left.endTime - right.endTime);
  const merged: SpeechCoverageGap[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous && interval.startTime <= previous.endTime + TIME_EPSILON) {
      previous.endTime = Math.max(previous.endTime, interval.endTime);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function subtractIntervals(
  active: readonly SpeechCoverageGap[],
  covered: readonly SpeechCoverageGap[],
): SpeechCoverageGap[] {
  const uncovered: SpeechCoverageGap[] = [];
  let coverageIndex = 0;
  for (const speech of active) {
    let cursor = speech.startTime;
    while (coverageIndex < covered.length && covered[coverageIndex].endTime <= cursor + TIME_EPSILON) {
      coverageIndex += 1;
    }
    for (let index = coverageIndex; index < covered.length && covered[index].startTime < speech.endTime; index += 1) {
      const word = covered[index];
      if (word.startTime > cursor + TIME_EPSILON) {
        uncovered.push({ startTime: cursor, endTime: Math.min(word.startTime, speech.endTime) });
      }
      cursor = Math.max(cursor, word.endTime);
      if (cursor >= speech.endTime - TIME_EPSILON) break;
    }
    if (cursor < speech.endTime - TIME_EPSILON) uncovered.push({ startTime: cursor, endTime: speech.endTime });
  }
  return uncovered;
}

function selectMeaningfulGaps(fragments: readonly SpeechCoverageGap[]): SpeechCoverageGap[] {
  const candidates = fragments
    .filter((gap) => gap.endTime - gap.startTime + TIME_EPSILON >= MIN_UNCOVERED_SPEECH_SECONDS)
    .map((gap) => ({ ...gap }));

  for (let left = 0; left < fragments.length; left += 1) {
    let activeDuration = 0;
    for (let right = left; right < fragments.length; right += 1) {
      const span = fragments[right].endTime - fragments[left].startTime;
      if (span > CUMULATIVE_WINDOW_SECONDS + TIME_EPSILON) break;
      activeDuration += fragments[right].endTime - fragments[right].startTime;
      if (activeDuration + TIME_EPSILON >= MIN_UNCOVERED_SPEECH_SECONDS) {
        candidates.push({ startTime: fragments[left].startTime, endTime: fragments[right].endTime });
        break;
      }
    }
  }
  return mergeIntervals(candidates);
}

type SourceActivity = { webRtc: SpeechCoverageGap[]; silero: SpeechCoverageGap[] };

const activityCache = new WeakMap<Uint8Array, Map<number, Promise<SourceActivity>>>();

function overlaps(left: SpeechCoverageGap, right: SpeechCoverageGap): boolean {
  return left.startTime < right.endTime - TIME_EPSILON && left.endTime > right.startTime + TIME_EPSILON;
}

function validatedActivity(
  timeline: readonly { text: string; startTime: number; endTime: number }[],
  duration: number,
): SpeechCoverageGap[] {
  return mergeIntervals(timeline.flatMap(entry => {
    if (entry.text !== "active" || !Number.isFinite(entry.startTime) || !Number.isFinite(entry.endTime)) return [];
    const startTime = Math.max(0, entry.startTime), endTime = Math.min(duration, entry.endTime);
    return endTime > startTime ? [{ startTime, endTime }] : [];
  }));
}

async function sourceSpeech(audio: Uint8Array, duration: number, signal?: AbortSignal): Promise<SourceActivity> {
  assertActive(signal);
  if (!(audio instanceof Uint8Array) || audio.byteLength === 0 || !Number.isFinite(duration) || duration <= 0) {
    throw new LearningAsrError("asr_invalid_audio", "Speech coverage input is invalid.");
  }
  let byDuration = activityCache.get(audio);
  if (!byDuration) { byDuration = new Map(); activityCache.set(audio, byDuration); }
  let pending = byDuration.get(duration);
  if (!pending) {
    pending = Promise.all([
      detectVoiceActivity(audio, { engine: "webrtc", activityThreshold: 0.5, webrtc: { frameDuration: 30 } }),
      detectVoiceActivity(audio, { engine: "silero", activityThreshold: 0.5, silero: { frameDuration: 90 } }),
    ]).then(([webRtc, silero]) => ({
      webRtc: validatedActivity(webRtc.timeline, duration),
      silero: validatedActivity(silero.timeline, duration),
    }));
    byDuration.set(duration, pending);
    pending.catch(() => byDuration.delete(duration));
  }
  try {
    const active = await pending;
    assertActive(signal);
    return active;
  } catch {
    assertActive(signal);
    throw reviewRequired("Local speech coverage detection failed.");
  }
}

export async function hasDetectedSpeech(audio: Uint8Array, duration: number, signal?: AbortSignal): Promise<boolean> {
  const activity = await sourceSpeech(audio, duration, signal);
  return activity.webRtc.some(coarse => activity.silero.some(corroborating => overlaps(coarse, corroborating)));
}

export async function findUncoveredSpeech(
  audio: Uint8Array,
  words: readonly StudyTimelineEntry[],
  duration: number,
  signal?: AbortSignal,
): Promise<SpeechCoverageGap[]> {
  assertActive(signal);
  if (!(audio instanceof Uint8Array) || audio.byteLength === 0 || !Number.isFinite(duration) || duration <= 0) {
    throw new LearningAsrError("asr_invalid_audio", "Speech coverage input is invalid.");
  }

  const covered: SpeechCoverageGap[] = [];
  for (const word of words) {
    if (word.type !== "word" || !Number.isFinite(word.startTime) || !Number.isFinite(word.endTime)
      || word.endTime <= word.startTime || word.startTime < 0 || word.endTime > duration + TIME_EPSILON) {
      throw reviewRequired("Word timestamps are invalid for speech coverage validation.");
    }
    covered.push({
      startTime: Math.max(0, word.startTime - WORD_MARGIN_SECONDS),
      endTime: Math.min(duration, word.endTime + WORD_MARGIN_SECONDS),
    });
  }

  const activity = await sourceSpeech(audio, duration, signal);
  const hasCorroboratedSpeech = activity.webRtc.some(coarse => activity.silero.some(corroborating => overlaps(coarse, corroborating)));
  if (!hasCorroboratedSpeech) {
    if (words.length) throw new LearningAsrError("asr_review_required", "Transcript words are unsupported by detected source speech.", { startTime: 0, endTime: duration });
    return [];
  }

  // WebRTC supplies the high-recall candidate bounds; Silero rejects archival noise without shrinking real repair ranges.
  const uncovered = selectMeaningfulGaps(subtractIntervals(activity.webRtc, mergeIntervals(covered)));
  return uncovered.filter(gap => activity.silero.some(corroborating => overlaps(gap, corroborating)));
}
