import {
  cn,
  renderPitchContour,
  secondsToTimestamp,
} from "@renderer/lib/utils";
import { extractFrequencies } from "@/utils";
import { useIntersectionObserver } from "@uidotdev/usehooks";
import { useCallback, useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { Skeleton } from "@renderer/components/ui";
import { EjButton } from "@renderer/components/enjoy";
import { useEjColor } from "@renderer/hooks";
import { PauseIcon, PlayIcon, XCircleIcon } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { t } from "i18next";
import {
  createWavesurferLifecycle,
  type WavesurferLifecycle,
} from "@renderer/lib/wavesurfer-lifecycle";

export const WavesurferPlayer = (props: {
  id: string;
  src: string;
  height?: number;
  setCurrentTime?: (currentTime: number) => void;
  onError?: (error: Error) => void;
  wavesurferOptions?: any;
  pitchContourOptions?: any;
  className?: string;
  autoplay?: boolean;
  onEnded?: () => void;
}) => {
  const {
    id,
    src,
    height = 56,
    onError,
    setCurrentTime: onSetCurrentTime,
    wavesurferOptions,
    pitchContourOptions,
    className = "",
    autoplay = false,
    onEnded,
  } = props;
  const [initialized, setInitialized] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [ref, entry] = useIntersectionObserver({
    threshold: 0,
  });
  const waveColor = useEjColor("--ej-wave", "#cfcabf");
  const waveOnColor = useEjColor("--ej-wave-on", "#2d6be0");
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const lifecycleRef = useRef<WavesurferLifecycle<WaveSurfer> | null>(null);
  const playerPropsRef = useRef({
    id,
    onError,
    onEnded,
    onSetCurrentTime,
    pitchContourOptions,
    wavesurferOptions,
  });
  playerPropsRef.current = {
    id,
    onError,
    onEnded,
    onSetCurrentTime,
    pitchContourOptions,
    wavesurferOptions,
  };

  const onPlayClick = useCallback(() => {
    const instance = wavesurferRef.current;
    if (!instance) return;

    void instance.playPause();
  }, []);

  const onRetry = useCallback(() => {
    setInitialized(false);
    setIsPlaying(false);
    setDuration(0);
    setCurrentTime(0);
    setError(null);
    void lifecycleRef.current?.reload();
  }, []);

  const isIntersecting = entry?.isIntersecting ?? false;

  useEffect(() => {
    if (!isIntersecting || !src || !containerRef.current) {
      if (!isIntersecting || !src) {
        setInitialized(false);
        setIsPlaying(false);
        setDuration(0);
        setCurrentTime(0);
        setError(null);
      }
      return;
    }

    setInitialized(false);
    setIsPlaying(false);
    setDuration(0);
    setCurrentTime(0);
    setError(null);

    const uuid = uuidv4();
    const onOtherPlayerPlay = (event: Event) => {
      const instance = wavesurferRef.current;
      const detail = (event as CustomEvent<{ uuid?: string }>).detail;
      if (!instance || detail?.uuid === uuid) return;

      instance.pause();
    };
    document.addEventListener("play", onOtherPlayerPlay);

    const lifecycle = createWavesurferLifecycle<WaveSurfer>({
      src,
      create: () => {
        const options = {
          container: containerRef.current as HTMLDivElement,
          height,
          barWidth: 1,
          cursorWidth: 0,
          autoCenter: true,
          autoScroll: true,
          autoplay,
          dragToSeek: true,
          hideScrollbar: true,
          minPxPerSec: 100,
          waveColor,
          progressColor: waveOnColor,
          ...playerPropsRef.current.wavesurferOptions,
        };
        delete options.url;

        const instance = WaveSurfer.create(options);
        wavesurferRef.current = instance;
        return instance;
      },
      handlers: {
        onPlay: () => {
          setIsPlaying(true);
          const customEvent = new CustomEvent("play", { detail: { uuid } });
          document.dispatchEvent(customEvent);
        },
        onPause: () => {
          setIsPlaying(false);
        },
        onFinish: () => {
          playerPropsRef.current.onEnded?.();
        },
        onTimeUpdate: (time) => {
          setCurrentTime(time);
          playerPropsRef.current.onSetCurrentTime?.(time);
        },
        onReady: (instance, readyDuration) => {
          setDuration(readyDuration ?? instance.getDuration());
          setInitialized(true);

          const decodedData = instance.getDecodedData();
          if (!decodedData) return;

          const peaks = decodedData.getChannelData(0);
          const sampleRate = instance.options.sampleRate;
          const data = extractFrequencies({ peaks, sampleRate });
          const contourTimer = window.setTimeout(() => {
            if (wavesurferRef.current !== instance) return;

            renderPitchContour({
              wrapper: instance.getWrapper(),
              canvasId: `pitch-contour-${playerPropsRef.current.id}-canvas`,
              labels: new Array(data.length).fill(""),
              datasets: [
                {
                  data,
                  cubicInterpolationMode: "monotone",
                  pointRadius: 1,
                  ...playerPropsRef.current.pitchContourOptions,
                },
              ],
            });
          }, 1000);

          return () => window.clearTimeout(contourTimer);
        },
        onError: (loadError) => {
          setInitialized(false);
          setIsPlaying(false);
          setError(loadError.message);
          playerPropsRef.current.onError?.(loadError);
        },
      },
    });
    lifecycleRef.current = lifecycle;

    return () => {
      document.removeEventListener("play", onOtherPlayerPlay);
      if (lifecycleRef.current === lifecycle) lifecycleRef.current = null;
      if (wavesurferRef.current === lifecycle.getInstance()) {
        wavesurferRef.current = null;
      }
      lifecycle.destroy();
    };
  }, [autoplay, height, isIntersecting, src, waveColor, waveOnColor]);

  return (
    <div className="w-full max-w-screen-lg">
      <div className="mb-1 flex justify-end">
        <span className="ej-tabular text-xxs text-ej-muted">
          {secondsToTimestamp(currentTime)} / {secondsToTimestamp(duration)}
        </span>
      </div>

      <div
        ref={ref}
        className={cn(
          "relative flex items-center gap-3 rounded-ej bg-ej-surface px-3",
          className
        )}
        style={{ minHeight: height }}
      >
        {initialized && (
          <button
            type="button"
            onClick={onPlayClick}
            aria-label={isPlaying ? t("pause") : t("play")}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ej-accent text-white shadow-ej transition-opacity duration-ej hover:opacity-90"
          >
            {isPlaying ? (
              <PauseIcon className="size-5" />
            ) : (
              <PlayIcon className="size-5" />
            )}
          </button>
        )}

        <div
          className="min-w-0 flex-1"
          style={{ height }}
          ref={containerRef}
        />

        {!initialized && !error && (
          <div
            className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-around px-3"
            style={{ height }}
          >
            <Skeleton className="h-3 w-full rounded-full" />
            <Skeleton className="h-3 w-full rounded-full" />
            <Skeleton className="h-3 w-full rounded-full" />
          </div>
        )}

        {error && (
          <div className="absolute inset-0 z-20 flex items-center justify-center gap-3 rounded-ej bg-ej-surface px-4">
            <XCircleIcon className="size-4 shrink-0 text-ej-bad" />
            <div className="select-text break-all text-center text-xxs text-ej-muted">
              {error}
            </div>
            <EjButton size="sm" onClick={onRetry}>
              {t("retry")}
            </EjButton>
          </div>
        )}
      </div>
    </div>
  );
};
