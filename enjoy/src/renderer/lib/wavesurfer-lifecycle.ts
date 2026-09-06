export type WavesurferEventName =
  | "play"
  | "pause"
  | "finish"
  | "timeupdate"
  | "ready"
  | "error";

export type WavesurferLifecycleInstance = {
  on: (
    event: WavesurferEventName,
    listener: (...args: any[]) => void
  ) => () => void;
  load: (src: string) => Promise<void> | void;
  destroy: () => void;
};

export type WavesurferLifecycleHandlers<
  T extends WavesurferLifecycleInstance,
> = {
  onPlay?: () => void;
  onPause?: () => void;
  onFinish?: () => void;
  onTimeUpdate?: (time: number) => void;
  onReady?: (
    instance: T,
    duration?: number
  ) => void | (() => void);
  onError?: (error: Error) => void;
};

export type WavesurferLifecycleOptions<T extends WavesurferLifecycleInstance> = {
  create: () => T;
  src: string;
  handlers?: WavesurferLifecycleHandlers<T>;
};

export type WavesurferLifecycle<T extends WavesurferLifecycleInstance> = {
  getInstance: () => T | null;
  reload: (src?: string) => Promise<void>;
  destroy: () => void;
};

const toError = (value: unknown) => {
  if (value instanceof Error) return value;
  if (typeof value === "string" && value.trim()) return new Error(value);
  return new Error("Failed to load audio");
};

export const createWavesurferLifecycle = <
  T extends WavesurferLifecycleInstance,
>({
  create,
  src,
  handlers = {},
}: WavesurferLifecycleOptions<T>): WavesurferLifecycle<T> => {
  let activeInstance: T | null = null;
  let removeSubscriptions: (() => void)[] = [];
  let readyCleanup: (() => void) | undefined;
  let currentSrc = src;
  let generation = 0;
  let destroyed = false;
  let errorReported = false;

  const reportError = (value: unknown, instance: T, instanceGeneration: number) => {
    if (
      destroyed ||
      activeInstance !== instance ||
      generation !== instanceGeneration ||
      errorReported
    ) {
      return;
    }

    errorReported = true;
    handlers.onError?.(toError(value));
  };

  const removeInstanceSubscriptions = () => {
    const subscriptions = removeSubscriptions;
    removeSubscriptions = [];
    subscriptions.forEach((unsubscribe) => unsubscribe());

    readyCleanup?.();
    readyCleanup = undefined;
  };

  const destroyActiveInstance = () => {
    const instance = activeInstance;
    activeInstance = null;
    generation += 1;
    removeInstanceSubscriptions();
    instance?.destroy();
  };

  const loadInstance = (instance: T, nextSrc: string, instanceGeneration: number) => {
    try {
      return Promise.resolve(instance.load(nextSrc)).catch((error) => {
        reportError(error, instance, instanceGeneration);
      });
    } catch (error) {
      reportError(error, instance, instanceGeneration);
      return Promise.resolve();
    }
  };

  const createInstance = (nextSrc: string): Promise<void> => {
    if (destroyed) return Promise.resolve();

    let instance: T;
    try {
      instance = create();
    } catch (error) {
      handlers.onError?.(toError(error));
      return Promise.resolve();
    }

    activeInstance = instance;
    generation += 1;
    const instanceGeneration = generation;
    errorReported = false;

    const subscriptions = [
      instance.on("play", () => handlers.onPlay?.()),
      instance.on("pause", () => handlers.onPause?.()),
      instance.on("finish", () => handlers.onFinish?.()),
      instance.on("timeupdate", (time: number) => handlers.onTimeUpdate?.(time)),
      instance.on("ready", (duration?: number) => {
        if (
          destroyed ||
          activeInstance !== instance ||
          generation !== instanceGeneration
        ) {
          return;
        }

        readyCleanup?.();
        readyCleanup = handlers.onReady?.(instance, duration) || undefined;
      }),
      instance.on("error", (error: unknown) =>
        reportError(error, instance, instanceGeneration)
      ),
    ];
    removeSubscriptions = subscriptions;

    return loadInstance(instance, nextSrc, instanceGeneration);
  };

  const lifecycle = {
    getInstance: () => activeInstance,
    reload: async (nextSrc = currentSrc) => {
      if (destroyed) return;

      currentSrc = nextSrc;
      destroyActiveInstance();
      await createInstance(nextSrc);
    },
    destroy: () => {
      if (destroyed) return;

      destroyed = true;
      destroyActiveInstance();
    },
  };

  void createInstance(src);
  return lifecycle;
};
