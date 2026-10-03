import type { LearningAsrProgress, LearningAsrResult, StudyTimelineEntry } from "../../types/learning-asr";
import { parsePcmWav, planAudioWindows, encodePcmWindow, type AudioWindow, type ParsedPcmWav } from "./audio-windows";
import { createCheckpointStore, sha256 } from "./checkpoints";
import { LearningAsrError, assertActive, waitForRetry, withCancellation } from "./errors";
import { equalText, joinWordText, lexicalUnits } from "./text";
import { mergeAlignedWindows, type SeamBounds } from "./seams";
import type { LearningAsrProvider, ProviderTranscript } from "./providers";
import type { findUncoveredSpeech, hasDetectedSpeech } from "./speech-coverage";
import type { alignStudyWindow, buildStudyTimeline, validateStudyWords, convertProviderWords } from "./alignment";

type Dependencies = {
  checkpointRoot: string;
  align: typeof alignStudyWindow;
  convertProviderWords?: typeof convertProviderWords;
  buildTimeline: typeof buildStudyTimeline;
  validateWords: typeof validateStudyWords;
  findSpeechGaps: typeof findUncoveredSpeech;
  hasSpeech: typeof hasDetectedSpeech;
  wait?: typeof waitForRetry;
};
type Range = Pick<AudioWindow, "startSample" | "endSample">;
type Aligned = { words: StudyTimelineEntry[]; omittedPhoneTimings: number };
const transient = new Set(["asr_network", "asr_timeout", "asr_rate_limit"]);
const recoverableWhole = new Set(["asr_network", "asr_timeout", "asr_invalid_audio", "asr_invalid_response", "asr_review_required", "asr_no_speech"]);

export function planSeamGeometry(
  previous: Range,
  window: AudioWindow,
  resumedFromFallbackPrefix: boolean,
): { overlapStartSample: number; overlapEndSample: number; boundarySample: number } {
  const nominal = {
    overlapStartSample: window.startSample,
    overlapEndSample: previous.endSample,
    boundarySample: window.coreStartSample,
  };
  if (!resumedFromFallbackPrefix) return nominal;
  const actualStart = Math.max(previous.startSample, window.startSample);
  const actualEnd = Math.min(previous.endSample, window.endSample);
  if (actualEnd <= actualStart) return nominal;
  const boundarySample = Math.floor((actualStart + actualEnd) / 2);
  const nominalHalfWidth = Math.max(0, window.coreStartSample - window.startSample);
  const halfWidth = Math.min(nominalHalfWidth, Math.floor((actualEnd - actualStart) / 2));
  if (halfWidth < 1) {
    return { overlapStartSample: actualStart, overlapEndSample: actualEnd, boundarySample };
  }
  return {
    overlapStartSample: boundarySample - halfWidth,
    overlapEndSample: boundarySample + halfWidth,
    boundarySample,
  };
}

function validTranscript(value: unknown): value is ProviderTranscript {
  const record = value as ProviderTranscript;
  return !!record && typeof record.transcript === "string" && lexicalUnits(record.transcript).length > 0
    && Array.isArray(record.segments) && record.segments.every(segment => segment && typeof segment.text === "string"
      && Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.start >= 0 && segment.end > segment.start);
}

/** Silence is accepted only at the PCM noise floor, never from a VAD decision. */
function digitallySilent(audio: ParsedPcmWav, range: Range): boolean {
  for (let i = range.startSample * audio.blockAlign; i < range.endSample * audio.blockAlign; i += 2) {
    if (Math.abs(audio.pcm.readInt16LE(i)) > 2) return false;
  }
  return true;
}

export function planTranscriptAlignment(result: ProviderTranscript, audio: ParsedPcmWav): Array<Range & { text: string }> | undefined {
  const duration = audio.frameCount / audio.sampleRate;
  if (!result.segments.length || !equalText(result.transcript, result.segments.map(segment => segment.text).join(" "))) return undefined;
  let previousStart = 0, previousEnd = 0;
  const components: Array<{ start: number; end: number; text: string }> = [];
  for (const segment of result.segments) {
    if (segment.start < previousStart - .03 || segment.end < previousEnd - .03
      || segment.end > duration + .05 || segment.end - segment.start > 60) return undefined;
    const last = components.at(-1);
    // Provider segment edges may overlap. Keep that shared audio in one local
    // alignment block so the resulting word timestamps still undergo strict validation.
    if (last && segment.start < last.end - .03) {
      last.end = Math.max(last.end, segment.end);
      last.text += ` ${segment.text}`;
      if (last.end - last.start > 60) return undefined;
    } else components.push({ ...segment });
    previousStart = segment.start;
    previousEnd = segment.end;
  }
  const groups: Array<{ start: number; end: number; text: string }> = [];
  for (const segment of components) {
    const last = groups.at(-1);
    if (last && segment.end - last.start <= 45) {
      last.end = segment.end;
      last.text += ` ${segment.text}`;
    } else groups.push({ ...segment });
  }
  return groups.map((group, index) => ({
    text: group.text,
    startSample: Math.max(0, Math.round((index ? Math.max(group.start - .4, (groups[index - 1].end + group.start) / 2) : Math.max(0, group.start - .4)) * audio.sampleRate)),
    endSample: Math.min(audio.frameCount, Math.round((index + 1 < groups.length ? Math.min(group.end + .4, (group.end + groups[index + 1].start) / 2) : Math.min(duration, group.end + .4)) * audio.sampleRate)),
  }));
}

export function createLearningAsrService(deps: Dependencies) {
  const wait = deps.wait || waitForRetry;
  return {
    async transcribe(input: {
      jobId: string; wav: Buffer; language: string; provider: LearningAsrProvider;
      prepareWhole?: () => Promise<{ audio: Buffer; duration: number; format: "mp3" }>;
      signal?: AbortSignal; onProgress?: (value: LearningAsrProgress) => void;
    }): Promise<LearningAsrResult> {
      const { signal, provider } = input;
      assertActive(signal);
      let pcm: ParsedPcmWav;
      try { pcm = parsePcmWav(input.wav); }
      catch { throw new LearningAsrError("asr_invalid_audio", "A valid PCM WAV is required."); }
      const language = input.language.split("-")[0] || "en";
      // Fast Transcription requires the locale; local alignment uses the language code.
      const recognitionLanguage = provider.engine === "azure_speech"
        ? input.language.trim() || language
        : language;
      const duration = pcm.frameCount / pcm.sampleRate;
      const sourceSha256 = sha256(input.wav);
      const store = createCheckpointStore(deps.checkpointRoot, `${sourceSha256}:${provider.identity}:${recognitionLanguage}`);
      const metrics = { requestWindows: 0, resumedWindows: 0, retries: 0, repairedSeams: 0, repairedSpeechGaps: 0, repairedAlignmentWindows: 0, omittedPhoneTimings: 0 };
      const providerTimingAdjustments = { count: 0, maxSeconds: 0 };
      let lastRequestAt = 0;
      let maximumProgress = 0;
      const progress = (stage: LearningAsrProgress["stage"], completed: number, total: number, percent: number) => {
        assertActive(signal);
        maximumProgress = Math.max(maximumProgress, Math.min(99, percent));
        input.onProgress?.({ jobId: input.jobId, stage, completed, total, percent: maximumProgress, resumed: metrics.resumedWindows });
      };
      const recognize = async (key: string, bytes: Buffer, format: "wav" | "mp3", seconds: number): Promise<ProviderTranscript> => {
        assertActive(signal);
        const cached = await store.read(`recognize:${key}:${sha256(bytes)}`, validTranscript);
        if (cached) { metrics.resumedWindows++; return cached; }
        for (let attempt = 0; ; attempt++) {
          assertActive(signal);
          await wait(Math.max(0, provider.minRequestIntervalMs - (Date.now() - lastRequestAt)), signal);
          try {
            lastRequestAt = Date.now();
            metrics.requestWindows++;
            const result = await provider.transcribe(bytes, { format, language: recognitionLanguage, duration: seconds, signal });
            assertActive(signal);
            if (!validTranscript(result)) throw new LearningAsrError("asr_invalid_response", "Transcript response is invalid.");
            await store.write(`recognize:${key}:${sha256(bytes)}`, result);
            return result;
          } catch (error) {
            assertActive(signal);
            if (!(error instanceof LearningAsrError) || !transient.has(error.code) || attempt >= 2) throw error;
            metrics.retries++;
            await wait(Math.max(error.retryAfterMs || 0, 1000 * 2 ** attempt + Math.floor(Math.random() * 250)), signal);
          }
        }
      };
      const align = async (range: Range, text: string): Promise<Aligned> => {
        assertActive(signal);
        const key = `alignment:${range.startSample}:${range.endSample}:${sha256(text)}:crop-false`;
        const isAligned = (value: unknown): value is Aligned => {
          const candidate = value as Aligned;
          if (!candidate || !Array.isArray(candidate.words) || !Number.isSafeInteger(candidate.omittedPhoneTimings) || candidate.omittedPhoneTimings < 0) return false;
          try {
            deps.validateWords(candidate.words, text, duration);
            return candidate.words.every(word => word.startTime >= range.startSample / pcm.sampleRate - .001 && word.endTime <= range.endSample / pcm.sampleRate + .001);
          } catch { return false; }
        };
        const cached = await store.read(key, isAligned);
        if (cached) return cached;
        const result = await withCancellation(deps.align(encodePcmWindow(pcm, range), text, {
          language, offsetSeconds: range.startSample / pcm.sampleRate,
          durationSeconds: (range.endSample - range.startSample) / pcm.sampleRate, signal,
        }), signal).catch(error => {
          assertActive(signal);
          if (error instanceof LearningAsrError) throw new LearningAsrError(error.code, error.message, error.range || {
            startTime: range.startSample / pcm.sampleRate, endTime: range.endSample / pcm.sampleRate,
          }, error.retryAfterMs);
          throw error;
        });
        assertActive(signal);
        if (!isAligned(result)) throw new LearningAsrError("asr_review_required", "Alignment requires review.", { startTime: range.startSample / pcm.sampleRate, endTime: range.endSample / pcm.sampleRate });
        await store.write(key, result);
        return result;
      };
      const nativeWords = (response: ProviderTranscript, range: Range): Aligned | undefined => {
        if (!response.words?.length || !deps.convertProviderWords) return undefined;
        try {
          const result = deps.convertProviderWords(
            response.words, response.transcript,
            (range.endSample - range.startSample) / pcm.sampleRate,
            range.startSample / pcm.sampleRate,
          );
          deps.validateWords(result.words, response.transcript, duration);
          providerTimingAdjustments.count += result.providerTimingAdjustments.count;
          providerTimingAdjustments.maxSeconds = Math.max(providerTimingAdjustments.maxSeconds, result.providerTimingAdjustments.maxSeconds);
          return result;
        } catch {
          return undefined;
        }
      };
      const recognizeRange = async (range: Range, onRecognized?: () => void, partitionDepth = 0): Promise<Aligned> => {
        if (digitallySilent(pcm, range)) return { words: [], omittedPhoneTimings: 0 };
        const attempt = async (sourceRange: Range) => {
          const audio = encodePcmWindow(pcm, sourceRange);
          const seconds = (sourceRange.endSample - sourceRange.startSample) / pcm.sampleRate;
          let response: ProviderTranscript;
          try { response = await recognize(`${sourceRange.startSample}:${sourceRange.endSample}`, audio, "wav", seconds); }
          catch (error) {
            assertActive(signal);
            if (!(error instanceof LearningAsrError) || error.code !== "asr_no_speech") throw error;
            if (!(await withCancellation(deps.hasSpeech(audio, seconds, signal), signal))) return { words: [], omittedPhoneTimings: 0 };
            throw new LearningAsrError("asr_review_required", "Speech was detected but the provider returned no transcript.", {
              startTime: sourceRange.startSample / pcm.sampleRate, endTime: sourceRange.endSample / pcm.sampleRate,
            });
          }
          onRecognized?.();
          return nativeWords(response, sourceRange) ?? align(sourceRange, response.transcript);
        };
        let failure: LearningAsrError;
        try { return await attempt(range); }
        catch (error) {
          assertActive(signal);
          if (!(error instanceof LearningAsrError) || error.code !== "asr_review_required") throw error;
          failure = error;
        }
        if (partitionDepth === 0) {
          // A clipped utterance or a hallucinated edge needs more acoustic context, not fabricated word times.
          const remaining = Math.max(0, 60 * pcm.sampleRate - (range.endSample - range.startSample));
          let left = Math.min(6 * pcm.sampleRate, range.startSample, Math.floor(remaining / 2));
          let right = Math.min(6 * pcm.sampleRate, pcm.frameCount - range.endSample, remaining - left);
          left = Math.min(6 * pcm.sampleRate, range.startSample, remaining - right);
          right = Math.min(6 * pcm.sampleRate, pcm.frameCount - range.endSample, remaining - left);
          if (left + right >= pcm.sampleRate) {
            try {
              const repaired = await attempt({ startSample: range.startSample - left, endSample: range.endSample + right });
              metrics.repairedAlignmentWindows++;
              return repaired;
            } catch (error) {
              assertActive(signal);
              if (!(error instanceof LearningAsrError) || error.code !== "asr_review_required") throw error;
              failure = error;
            }
          }
        }
        // Fresh recognition on smaller overlapping source ranges can recover
        // text which remains unalignable after adding context. Child calls
        // stay inside this source range and cannot recursively expand it.
        const length = range.endSample - range.startSample;
        if (partitionDepth >= 2 || length <= 20 * pcm.sampleRate) throw failure;
        const middle = range.startSample + Math.floor(length / 2);
        const overlap = Math.min(3 * pcm.sampleRate, Math.floor(length / 8));
        const first = await recognizeRange({ startSample: range.startSample, endSample: middle + overlap }, onRecognized, partitionDepth + 1);
        const second = await recognizeRange({ startSample: middle - overlap, endSample: range.endSample }, onRecognized, partitionDepth + 1);
        const joined = await merge(first.words, second.words, {
          overlapStartTime: (middle - overlap) / pcm.sampleRate,
          overlapEndTime: (middle + overlap) / pcm.sampleRate,
          boundaryTime: middle / pcm.sampleRate,
        });
        if (!joined.consistent) throw new LearningAsrError("asr_review_required", "Shorter source transcripts disagree after bounded alignment recovery.", {
          startTime: range.startSample / pcm.sampleRate, endTime: range.endSample / pcm.sampleRate,
        });
        deps.validateWords(joined.words, joinWordText(joined.words), duration);
        metrics.repairedAlignmentWindows++;
        return { words: joined.words, omittedPhoneTimings: first.omittedPhoneTimings + second.omittedPhoneTimings };
      };
      const merge = async (left: StudyTimelineEntry[], right: StudyTimelineEntry[], bounds: SeamBounds) => {
        bounds = { ...bounds, language };
        const range = {
          startSample: Math.max(0, Math.floor(bounds.overlapStartTime * pcm.sampleRate)),
          endSample: Math.min(pcm.frameCount, Math.ceil(bounds.overlapEndTime * pcm.sampleRate)),
        };
        if (range.endSample <= range.startSample) return mergeAlignedWindows(left, right, bounds);
        const initial = mergeAlignedWindows(left, right, { ...bounds, silenceVerified: digitallySilent(pcm, range) });
        if (initial.consistent || initial.reason !== "missing-anchor") return initial;
        const seconds = (range.endSample - range.startSample) / pcm.sampleRate;
        const hasSpeech = await withCancellation(deps.hasSpeech(encodePcmWindow(pcm, range), seconds, signal), signal);
        return hasSpeech ? initial : mergeAlignedWindows(left, right, { ...bounds, silenceVerified: true });
      };
      let transport: "whole" | "windows" = "windows";
      let words: StudyTimelineEntry[] | undefined;
      let transcript = "";
      let fallbackPrefix: { words: StudyTimelineEntry[]; endSample: number; omittedPhoneTimings: number } | undefined;
      progress("preparing", 0, 1, 0);
      if (provider.preferWhole && input.prepareWhole && duration <= 3601) {
        try {
          progress("recognizing", 0, 1, 3);
          const audio = await input.prepareWhole().catch(error => {
            assertActive(signal);
            if (error instanceof LearningAsrError) throw error;
            throw new LearningAsrError("asr_invalid_response", "Whole audio preparation is unavailable; use source windows.");
          });
          assertActive(signal);
          if (provider.maxWholeRequestBytes !== undefined && audio.audio.length > provider.maxWholeRequestBytes) {
            throw new LearningAsrError("asr_invalid_response", "Prepared whole audio exceeds the provider upload size limit.");
          }
          const response = await recognize("whole", audio.audio, "mp3", audio.duration);
          const native = nativeWords(response, { startSample: 0, endSample: pcm.frameCount });
          if (native) {
            words = native.words;
            transcript = response.transcript;
            metrics.omittedPhoneTimings = native.omittedPhoneTimings;
            transport = "whole";
          } else {
            const blocks = planTranscriptAlignment(response, pcm);
            if (!blocks) throw new LearningAsrError("asr_invalid_response", "Whole transcript cannot be safely aligned in bounded blocks.");
            const aligned: StudyTimelineEntry[] = [];
            let omitted = 0;
            for (let i = 0; i < blocks.length; i++) {
              progress("aligning", i, blocks.length, 35 + 55 * i / blocks.length);
              const range = blocks[i];
              const start = range.startSample / pcm.sampleRate;
              const end = range.endSample / pcm.sampleRate;
              // A malformed native timestamp in one block must not discard
              // measured timestamps for the rest of a long recording.
              const blockWords = response.words?.filter(word => word.start >= start && word.end <= end)
                .map(word => ({ ...word, start: word.start - start, end: word.end - start }));
              const block = nativeWords({ transcript: range.text, segments: [], words: blockWords }, range)
                ?? await align(range, range.text);
              aligned.push(...block.words);
              omitted += block.omittedPhoneTimings;
              deps.validateWords(aligned, joinWordText(aligned), duration);
              fallbackPrefix = { words: [...aligned], endSample: blocks[i].endSample, omittedPhoneTimings: omitted };
            }
            deps.validateWords(aligned, response.transcript, duration);
            words = aligned;
            transcript = response.transcript;
            metrics.omittedPhoneTimings = omitted;
            transport = "whole";
          }
        } catch (error) {
          assertActive(signal);
          if (!(error instanceof LearningAsrError) || !recoverableWhole.has(error.code)) throw error;
        }
      }
      if (!words) {
        const windows = planAudioWindows(pcm);
        const resumeIndex = fallbackPrefix ? windows.findIndex(window => window.coreEndSample > fallbackPrefix.endSample) : -1;
        const startIndex = resumeIndex >= 0 ? resumeIndex : 0;
        const prefix = resumeIndex > 0 ? fallbackPrefix : undefined;
        let merged: StudyTimelineEntry[] = prefix ? [...prefix.words] : [];
        metrics.omittedPhoneTimings = prefix?.omittedPhoneTimings || 0;
        for (let index = startIndex; index < windows.length; index++) {
          const window = windows[index];
          progress("recognizing", index, windows.length, 5 + 85 * index / windows.length);
          const current = await recognizeRange(window, () => progress("aligning", index, windows.length, 5 + 85 * (index + .5) / windows.length));
          metrics.omittedPhoneTimings += current.omittedPhoneTimings;
          if (index === 0 && !prefix) { merged = current.words; continue; }
          const previous: Range = index === startIndex && prefix
            ? { startSample: 0, endSample: prefix.endSample }
            : windows[index - 1];
          const seam = planSeamGeometry(previous, window, index === startIndex && prefix !== undefined);
          const boundary = seam.boundarySample / pcm.sampleRate;
          let joined = await merge(merged, current.words, {
            overlapStartTime: seam.overlapStartSample / pcm.sampleRate,
            overlapEndTime: seam.overlapEndSample / pcm.sampleRate,
            boundaryTime: boundary,
          });
          if (!joined.consistent) {
            progress("repairing", index, windows.length, 5 + 85 * index / windows.length);
            for (const radius of [8, 15]) {
              const bridge = {
                startSample: Math.max(previous.startSample, seam.boundarySample - radius * pcm.sampleRate),
                endSample: Math.min(window.endSample, seam.boundarySample + radius * pcm.sampleRate),
              };
              let replacement: Aligned;
              try { replacement = await recognizeRange(bridge); }
              catch (error) {
                assertActive(signal);
                if (error instanceof LearningAsrError && (error.code === "asr_review_required" || error.code === "asr_no_speech")) continue;
                throw error;
              }
              metrics.omittedPhoneTimings += replacement.omittedPhoneTimings;
              const leftEnd = boundary - .75;
              const rightStart = boundary + .75;
              const leftStart = bridge.startSample / pcm.sampleRate;
              const rightEnd = bridge.endSample / pcm.sampleRate;
              if (leftEnd <= leftStart || rightEnd <= rightStart) continue;
              const first = await merge(merged, replacement.words, {
                overlapStartTime: leftStart, overlapEndTime: leftEnd, boundaryTime: (leftStart + leftEnd) / 2,
              });
              if (!first.consistent) continue;
              const second = await merge(first.words, current.words, {
                overlapStartTime: rightStart, overlapEndTime: rightEnd, boundaryTime: (rightStart + rightEnd) / 2,
              });
              if (second.consistent) { joined = second; metrics.repairedSeams++; break; }
            }
          }
          if (!joined.consistent) throw new LearningAsrError("asr_review_required", "The overlapping transcripts disagree after bounded repair.", {
            startTime: Math.max(0, boundary - 15), endTime: Math.min(duration, boundary + 15),
          });
          merged = joined.words;
        }
        words = merged;
        transcript = joinWordText(words);
      }
      if (!words.length || !lexicalUnits(transcript).length) throw new LearningAsrError("asr_no_speech", "No usable speech was recognized.");
      progress("validating", 0, 1, 95);
      deps.validateWords(words, transcript, duration);
      let gaps = await withCancellation(deps.findSpeechGaps(input.wav, words, duration, signal), signal);
      for (let repair = 0; gaps.length && repair < 12; repair++) {
        const gap = gaps[0];
        let repaired: StudyTimelineEntry[] | undefined;
        progress("repairing", repair, repair + gaps.length, 96);
        for (const radius of [8, 15]) {
          const range = {
            startSample: Math.max(0, Math.floor((gap.startTime - radius) * pcm.sampleRate)),
            endSample: Math.min(pcm.frameCount, Math.ceil((gap.endTime + radius) * pcm.sampleRate)),
          };
          if ((range.endSample - range.startSample) / pcm.sampleRate > 60) break;
          let replacement: Aligned;
          try { replacement = await recognizeRange(range); }
          catch (error) {
            assertActive(signal);
            if (error instanceof LearningAsrError && (error.code === "asr_no_speech" || error.code === "asr_review_required")) continue;
            throw error;
          }
          if (!replacement.words.length) continue;
          metrics.omittedPhoneTimings += replacement.omittedPhoneTimings;
          let candidate = replacement.words;
          if (range.startSample > 0) {
            const start = range.startSample / pcm.sampleRate;
            const end = gap.startTime - .2;
            const left = await merge(words, candidate, { overlapStartTime: start, overlapEndTime: end, boundaryTime: (start + end) / 2 });
            if (!left.consistent) continue;
            candidate = left.words;
          }
          if (range.endSample < pcm.frameCount) {
            const start = gap.endTime + .2;
            const end = range.endSample / pcm.sampleRate;
            const right = await merge(candidate, words, { overlapStartTime: start, overlapEndTime: end, boundaryTime: (start + end) / 2 });
            if (!right.consistent) continue;
            candidate = right.words;
          }
          deps.validateWords(candidate, joinWordText(candidate), duration);
          const remaining = await withCancellation(deps.findSpeechGaps(input.wav, candidate, duration, signal), signal);
          if (remaining.some(item => item.startTime < gap.endTime && item.endTime > gap.startTime)) continue;
          repaired = candidate;
          gaps = remaining;
          metrics.repairedSpeechGaps++;
          break;
        }
        // A successful coverage check may flag omitted fillers or speech that
        // bounded repair cannot recover. Preserve the valid transcript together
        // with every unresolved source range for visible review in the player.
        if (!repaired) break;
        words = repaired;
        transcript = joinWordText(words);
      }
      // Detector failures, invalid timestamps and unsupported source speech
      // still throw above; only actual, successfully detected gaps reach here.
      deps.validateWords(words, transcript, duration);
      const timeline = deps.buildTimeline(words, transcript, language, duration);
      assertActive(signal);
      return {
        engine: provider.engine, model: provider.model, transcript, language, duration, timeline,
        validation: { version: 1, sourceSha256, sourceSamples: pcm.frameCount, sampleRate: pcm.sampleRate, transport, ...metrics, providerTimingAdjustments,
          sourceCoverage: "complete", textCoverage: "matched", timestampChecks: "passed", speechGapCheck: gaps.length ? "review-required" : "passed",
          ...(gaps.length ? { speechGaps: gaps.map(gap => ({ ...gap })) } : {}), recognitionAccuracy: "not-measured" },
      };
    },
  };
}
