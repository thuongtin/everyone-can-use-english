import type { TimelineEntry } from "echogarden/dist/utilities/Timeline.d.js";

type RecordValue = Record<string, unknown>;

type PostAudioTranscriptionApi = {
  transcriptions: (params: { targetMd5: string }) => Promise<unknown>;
};

const isRecord = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isTimelineEntry = (value: unknown): value is TimelineEntry => {
  if (!isRecord(value)) return false;

  return (
    typeof value.text === "string" &&
    isFiniteNumber(value.startTime) &&
    isFiniteNumber(value.endTime)
  );
};

const isLegacySegment = (
  value: unknown
): value is TranscriptionResultSegmentType => {
  if (!isRecord(value) || !isRecord(value.offsets)) return false;
  if (!isRecord(value.timestamps)) return false;

  return (
    typeof value.text === "string" &&
    isFiniteNumber(value.offsets.from) &&
    isFiniteNumber(value.offsets.to) &&
    typeof value.timestamps.from === "string" &&
    typeof value.timestamps.to === "string"
  );
};

const isAlignmentResult = (
  value: unknown
): value is { transcript: string; timeline: TimelineEntry[] } => {
  if (!isRecord(value)) return false;
  if (typeof value.transcript !== "string") return false;
  if (!Array.isArray(value.timeline)) return false;

  return value.timeline.every(isTimelineEntry);
};

const isLegacyResult = (
  value: unknown
): value is TranscriptionResultSegmentType[] =>
  Array.isArray(value) && value.every(isLegacySegment);

const hasSupportedResult = (value: unknown): boolean =>
  isAlignmentResult(value) || isLegacyResult(value);

export const selectPostAudioTranscription = (
  response: unknown,
  targetMd5: string
): TranscriptionType | undefined => {
  if (!isRecord(response) || !Array.isArray(response.transcriptions)) {
    return undefined;
  }

  const item = response.transcriptions[0];
  if (!isRecord(item) || item.targetMd5 !== targetMd5) return undefined;
  if (!hasSupportedResult(item.result)) return undefined;

  return item as unknown as TranscriptionType;
};

export const requestPostAudioTranscription = (
  webApi: PostAudioTranscriptionApi | null | undefined,
  targetMd5: string | undefined,
  isActive: () => boolean = () => true
): Promise<TranscriptionType | undefined> => {
  if (!webApi || !targetMd5) return Promise.resolve(undefined);

  return Promise.resolve()
    .then(() => webApi.transcriptions({ targetMd5 }))
    .then((response) => {
      if (!isActive()) return undefined;
      return selectPostAudioTranscription(response, targetMd5);
    })
    .catch((): undefined => undefined);
};

export const getCurrentPostAudioSegment = (
  transcription: TranscriptionType | undefined,
  currentTime: number
): TimelineEntry | TranscriptionResultSegmentType | undefined => {
  if (!transcription) return undefined;

  const result = transcription.result as unknown;
  if (isAlignmentResult(result)) {
    return result.timeline.find(
      (segment) =>
        currentTime >= segment.startTime && currentTime <= segment.endTime
    );
  }

  if (isLegacyResult(result)) {
    return result.find(
      (segment) =>
        currentTime >= segment.offsets.from / 1000.0 &&
        currentTime <= segment.offsets.to / 1000.0
    );
  }

  return undefined;
};

export const isStorageAudioSource = (
  sourceUrl: unknown,
  endpoints: readonly string[]
): boolean => {
  if (typeof sourceUrl !== "string" || !Array.isArray(endpoints)) {
    return false;
  }

  return endpoints.some(
    (endpoint) => typeof endpoint === "string" && sourceUrl.startsWith(endpoint)
  );
};
