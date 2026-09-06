import {
  cn,
  renderPitchContour,
  secondsToTimestamp,
} from "@renderer/lib/utils";
import { extractFrequencies } from "@/utils";
import { useIntersectionObserver } from "@uidotdev/usehooks";
import { useCallback, useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { Button, Skeleton } from "@renderer/components/ui";
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
    height = 80,
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
          waveColor: "#ddd",
          progressColor: "rgba(0, 0, 0, 0.25)",
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
  }, [autoplay, height, isIntersecting, src]);

  return (
    <div className="w-full max-w-screen-lg">
      <div className="flex justify-end">
        <span className="text-xs text-muted-foreground">
          {secondsToTimestamp(currentTime)} / {secondsToTimestamp(duration)}
        </span>
      </div>

      <div
        ref={ref}
        className={cn(
          "bg-background rounded-lg grid grid-cols-9 items-center relative h-[80px]",
          className
        )}
      >
        {initialized ? (
          <div className="col-span-1 flex justify-center">
            <Button
              onClick={onPlayClick}
              className="aspect-square rounded-full p-2 w-full max-w-[50%] h-auto bg-blue-600 hover:bg-blue-500"
            >
              {isPlaying ? (
                <PauseIcon className="w-6 h-6 text-white" />
              ) : (
                <PlayIcon className="w-6 h-6 text-white" />
              )}
            </Button>
          </div>
        ) : (
          <div className="col-span-1 h-[80px]" aria-hidden="true" />
        )}

        <div
          className="col-span-8 min-w-0 h-[80px]"
          ref={containerRef}
        />

        {!initialized && !error && (
          <div className="absolute inset-0 z-10 flex flex-col justify-around h-[80px] px-2 pointer-events-none">
            <Skeleton className="h-3 w-full rounded-full" />
            <Skeleton className="h-3 w-full rounded-full" />
            <Skeleton className="h-3 w-full rounded-full" />
          </div>
        )}

        {error && (
          <div className="absolute inset-0 z-20 flex items-center justify-center gap-3 rounded-lg bg-background/95 px-4">
            <XCircleIcon className="w-4 h-4 shrink-0 text-destructive" />
            <div className="select-text break-all text-center text-sm text-muted-foreground">
              {error}
            </div>
            <Button onClick={onRetry}>{t("retry")}</Button>
          </div>
        )}
      </div>
    </div>
  );
};
