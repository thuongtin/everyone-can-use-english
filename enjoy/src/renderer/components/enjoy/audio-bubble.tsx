import { useCallback, useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { useIntersectionObserver } from "@uidotdev/usehooks";
import { PauseIcon, PlayIcon, RotateCwIcon } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { t } from "i18next";
import { cn, secondsToTimestamp } from "@renderer/lib/utils";
import {
  createWavesurferLifecycle,
  type WavesurferLifecycle,
} from "@renderer/lib/wavesurfer-lifecycle";

export const cssColor = (name: string, fallback: string) => {
  if (typeof window === "undefined") return fallback;

  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
};

/**
 * Compact audio bubble: round play button + real wavesurfer waveform + duration.
 * Used by chat messages where the full-size WavesurferPlayer is too heavy.
 */
export const EjAudioBubble = (props: {
  id: string;
  src: string;
  height?: number;
  waveWidth?: number;
  autoplay?: boolean;
  className?: string;
  tone?: "accent" | "ink";
  trailing?: React.ReactNode;
}) => {
  const {
    id,
    src,
    height = 32,
    waveWidth,
    autoplay = false,
    className,
    tone = "accent",
    trailing,
  } = props;

  const [containerRef, entry] = useIntersectionObserver({ threshold: 0 });
  const waveRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const lifecycleRef = useRef<WavesurferLifecycle<WaveSurfer> | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const isIntersecting = entry?.isIntersecting ?? false;

  const onPlayClick = useCallback(() => {
    void wavesurferRef.current?.playPause();
  }, []);

  const onRetry = useCallback(() => {
    setInitialized(false);
    setIsPlaying(false);
    setDuration(0);
    setCurrentTime(0);
    setError(null);
    void lifecycleRef.current?.reload();
  }, []);

  useEffect(() => {
    if (!isIntersecting || !src || !waveRef.current) return;

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
        const instance = WaveSurfer.create({
          container: waveRef.current as HTMLDivElement,
          height,
          barWidth: 2,
          barGap: 1,
          barRadius: 2,
          cursorWidth: 0,
          autoplay,
          dragToSeek: true,
          hideScrollbar: true,
          normalize: true,
          waveColor: cssColor("--ej-wave", "#cfcabf"),
          progressColor: cssColor("--ej-wave-on", "#2d6be0"),
        });
        wavesurferRef.current = instance;
        return instance;
      },
      handlers: {
        onPlay: () => {
          setIsPlaying(true);
          document.dispatchEvent(new CustomEvent("play", { detail: { uuid } }));
        },
        onPause: () => setIsPlaying(false),
        onTimeUpdate: (time) => setCurrentTime(time),
        onReady: (instance, readyDuration) => {
          setDuration(readyDuration ?? instance.getDuration());
          setInitialized(true);
        },
        onError: (loadError) => {
          setInitialized(false);
          setIsPlaying(false);
          setError(loadError.message);
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
    <div
      ref={containerRef}
      className={cn(
        "inline-flex items-center gap-2.5 max-w-full",
        "rounded-ej border border-ej-line bg-ej-surface2 px-2.5 py-2",
        className
      )}
    >
      <button
        type="button"
        onClick={error ? onRetry : onPlayClick}
        disabled={!initialized && !error}
        title={error ? t("retry") : undefined}
        className={cn(
          "size-[34px] shrink-0 rounded-full inline-flex items-center justify-center",
          "text-white transition-opacity duration-ej hover:opacity-90",
          "disabled:opacity-40 disabled:pointer-events-none",
          tone === "ink" ? "bg-ej-ink" : "bg-ej-accent"
        )}
      >
        {error ? (
          <RotateCwIcon className="size-4" />
        ) : isPlaying ? (
          <PauseIcon className="size-4 fill-current" />
        ) : (
          <PlayIcon className="size-4 fill-current" />
        )}
      </button>

      <div
        className="min-w-0 flex-1"
        style={waveWidth ? { width: waveWidth, flex: "none" } : undefined}
      >
        <div
          ref={waveRef}
          data-audio-bubble-id={id}
          style={{ height }}
          className={cn(
            "w-full transition-opacity duration-ej",
            initialized ? "opacity-100" : "opacity-30"
          )}
        />
      </div>

      <div className="shrink-0 text-xxs text-ej-muted ej-tabular">
        {error
          ? t("loadFailed")
          : secondsToTimestamp(isPlaying ? currentTime : duration)}
      </div>

      {trailing}
    </div>
  );
};
