import type { StudyTimelineEntry, InstrumentalMusicEvidence } from "../../types/learning-asr";
import { findUncoveredSpeech, type SpeechCoverageGap } from "./speech-coverage";
import { assertActive } from "./errors";

export const YAMNET_MODEL_SHA256 = "10c95ea3eb9a7bb4cb8bddf6feb023250381008177ac162ce169694d05c317de";

export type GapMusicClassification = SpeechCoverageGap & {
  modelSha256: string;
  musicMean: number;
  vocalMax: number;
  analyzedWindows: number;
  completeFrameCoverage: boolean;
};

export type GapMusicClassifier = (
  audio: Uint8Array,
  gaps: readonly SpeechCoverageGap[],
  signal?: AbortSignal,
) => Promise<GapMusicClassification[]>;

/** Only affirmative instrumental evidence can remove a VAD candidate. */
export function isConfirmedInstrumental(value: GapMusicClassification): boolean {
  return value.modelSha256 === YAMNET_MODEL_SHA256
    && value.completeFrameCoverage === true
    && Number.isSafeInteger(value.analyzedWindows) && value.analyzedWindows > 0
    && Number.isFinite(value.musicMean) && value.musicMean >= .5 && value.musicMean <= 1
    && Number.isFinite(value.vocalMax) && value.vocalMax >= 0 && value.vocalMax <= .1;
}

export function createMusicAwareSpeechCoverage(
  classify: GapMusicClassifier,
  detect: typeof findUncoveredSpeech = findUncoveredSpeech,
) {
  const sources = new WeakMap<Uint8Array, {
    cache: Map<string, GapMusicClassification | undefined>;
    confirmed: Map<string, InstrumentalMusicEvidence>;
  }>();
  const key = (gap: SpeechCoverageGap) => `${gap.startTime}:${gap.endTime}`;
  return {
    evidence: (audio: Uint8Array) => [...(sources.get(audio)?.confirmed.values() || [])],
    async findSpeechGaps(audio: Uint8Array, words: readonly StudyTimelineEntry[], duration: number, signal?: AbortSignal) {
      let source = sources.get(audio);
      if (!source) { source = { cache: new Map(), confirmed: new Map() }; sources.set(audio, source); }
      const { cache, confirmed } = source;
      const gaps = await detect(audio, words, duration, signal);
      assertActive(signal);
      // Bound optional work. Longer or excess candidates retain the normal repair path.
      const pending = gaps.filter(gap => !cache.has(key(gap)) && gap.endTime - gap.startTime <= 15).slice(0, 12);
      if (pending.length) {
        let classifications: GapMusicClassification[] = [];
        try {
          const result = await classify(audio, pending, signal);
          if (Array.isArray(result)) classifications = result;
        }
        catch { assertActive(signal); }
        assertActive(signal);
        for (const gap of pending) {
          const matches = classifications.filter(value => value && value.startTime === gap.startTime && value.endTime === gap.endTime);
          cache.set(key(gap), matches.length === 1 ? matches[0] : undefined);
        }
      }
      const remaining = gaps.filter(gap => {
        const value = cache.get(key(gap));
        if (!value || !isConfirmedInstrumental(value)) return true;
        confirmed.set(key(gap), {
          startTime: gap.startTime, endTime: gap.endTime, modelSha256: value.modelSha256,
          musicMean: value.musicMean, vocalMax: value.vocalMax, analyzedWindows: value.analyzedWindows,
        });
        return false;
      });
      return remaining;
    },
  };
}
