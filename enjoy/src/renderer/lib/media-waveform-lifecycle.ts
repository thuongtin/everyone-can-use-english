type MediaWaveformEvent = "decode" | "error" | "ready" | "timeupdate";

export type MediaWaveformInstance = {
  on: (event: MediaWaveformEvent, listener: (...args: any[]) => void) => () => void;
  destroy: () => void;
};

type MediaWaveformLifecycleOptions<T extends MediaWaveformInstance> = {
  create: () => T;
  load: (instance: T) => Promise<void> | void;
  isCurrent?: () => boolean;
  onDecode?: (instance: T) => void;
  onError?: (error: Error) => void;
  onReady?: (instance: T, duration?: number) => void;
  onTimeUpdate?: (time: number) => void;
};

const asError = (value: unknown) => {
  if (value instanceof Error) return value;
  if (typeof value === "string" && value.trim()) return new Error(value);
  return new Error("Error occurred while decoding audio");
};

type MediaWaveformCacheOptions<T> = {
  load: () => Promise<T | null>;
  isCurrent?: () => boolean;
  onResolved: (value: T | null) => void;
};

export const resolveMediaWaveformDuration = (
  cachedDuration: unknown,
  mediaDuration: unknown
) => {
  for (const value of [cachedDuration, mediaDuration]) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return undefined;
};

export const isValidMediaWaveformCache = (
  value: unknown
): value is WaveFormDataType => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WaveFormDataType>;
  return (
    typeof candidate.duration === "number" &&
    Number.isFinite(candidate.duration) &&
    candidate.duration > 0 &&
    typeof candidate.sampleRate === "number" &&
    Number.isFinite(candidate.sampleRate) &&
    candidate.sampleRate > 0 &&
    Array.isArray(candidate.peaks) &&
    candidate.peaks.length > 0 &&
    candidate.peaks.every(
      peak => typeof peak === "number" && Number.isFinite(peak)
    ) &&
    Array.isArray(candidate.frequencies) &&
    candidate.frequencies.every(
      frequency =>
        frequency === null ||
        (typeof frequency === "number" && Number.isFinite(frequency))
    )
  );
};

type PublishPreparedMediaWaveformOptions<T> = {
  value: T;
  isCurrent?: () => boolean;
  publish: (value: T) => void;
  save: (value: T) => Promise<void>;
};

export const publishPreparedMediaWaveform = <T>({
  value,
  isCurrent = () => true,
  publish,
  save,
}: PublishPreparedMediaWaveformOptions<T>) => {
  if (!isCurrent()) return Promise.resolve();
  publish(value);
  return Promise.resolve()
    .then(() => save(value))
    .catch((): void => undefined);
};

export const resolveMediaWaveformCache = <T>({
  load,
  isCurrent = () => true,
  onResolved,
}: MediaWaveformCacheOptions<T>) => {
  let disposed = false;
  const active = () => !disposed && isCurrent();
  const resolved = Promise.resolve()
    .then(load)
    .then((value) => {
      if (active()) onResolved(value);
    })
    .catch(() => {
      if (active()) onResolved(null);
    });

  return {
    resolved,
    dispose: () => {
      disposed = true;
    },
  };
};

export const startMediaWaveformLifecycle = <T extends MediaWaveformInstance>({
  create,
  load,
  isCurrent = () => true,
  onDecode,
  onError,
  onReady,
  onTimeUpdate,
}: MediaWaveformLifecycleOptions<T>) => {
  const instance = create();
  let disposed = false;
  let errorReported = false;
  const active = () => !disposed && isCurrent();
  const reportError = (value: unknown) => {
    if (!active() || errorReported) return;
    errorReported = true;
    onError?.(asError(value));
  };

  const subscriptions = [
    instance.on("timeupdate", (time: number) => {
      if (active()) onTimeUpdate?.(time);
    }),
    instance.on("decode", () => {
      if (active()) onDecode?.(instance);
    }),
    instance.on("ready", (duration?: number) => {
      if (active()) onReady?.(instance, duration);
    }),
    instance.on("error", reportError),
  ];

  const loaded = (() => {
    try {
      return Promise.resolve(load(instance)).catch(reportError);
    } catch (error) {
      reportError(error);
      return Promise.resolve();
    }
  })();

  return {
    instance,
    loaded,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      subscriptions.forEach(unsubscribe => unsubscribe());
      instance.destroy();
    },
  };
};
