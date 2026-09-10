import {
  useEffect,
  useContext,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  AppSettingsProviderContext,
  HotKeysSettingsProviderContext,
  MediaShadowProviderContext,
} from "@renderer/context";
import { RecordingDetail } from "@renderer/components";
import {
  cn,
  formatDuration,
  renderPitchContour,
} from "@renderer/lib/utils";
import { createLearningSegmentPlaybackController } from "@renderer/lib/learning-segment-playback";
import { RecordingDot } from "@renderer/components/enjoy";
import { extractFrequencies } from "@/utils";
import WaveSurfer from "wavesurfer.js";
import Regions from "wavesurfer.js/dist/plugins/regions";
import {
  Button,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuContent,
  toast,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetClose,
  SheetTitle,
} from "@renderer/components/ui";
import {
  GitCompareIcon,
  PauseIcon,
  PlayIcon,
  GaugeCircleIcon,
  ChevronDownIcon,
  MoreHorizontalIcon,
  TextCursorInputIcon,
  MicIcon,
  SquareIcon,
  DownloadIcon,
  XIcon,
  CheckIcon,
} from "lucide-react";
import { t } from "i18next";
import { useHotkeys } from "react-hotkeys-hook";
import { LiveAudioVisualizer } from "react-audio-visualize";
import debounce from "lodash/debounce";
import { TimelineEntry } from "echogarden/dist/utilities/Timeline.d.js";

const ACTION_BUTTON_HEIGHT = 35;
export const MediaCurrentRecording = () => {
  const {
    isRecording,
    isPaused,
    currentRecording,
    renderPitchContour: renderMediaPitchContour,
    regions: mediaRegions,
    activeRegion: mediaActiveRegion,
    wavesurfer,
    zoomRatio,
    editingRegion,
    currentTime: mediaCurrentTime,
    caption,
    toggleRegion,
  } = useContext(MediaShadowProviderContext);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { currentHotkeys } = useContext(HotKeysSettingsProviderContext);
  const [player, setPlayer] = useState(null);
  const [regions, setRegions] = useState<Regions | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const [detailIsOpen, setDetailIsOpen] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [isSelectingRegion, setIsSelectingRegion] = useState(false);

  const [frequencies, setFrequencies] = useState<number[]>([]);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [actionButtonsCount, setActionButtonsCount] = useState(0);

  const ref = useRef(null);
  const recordingPlaybackRef = useRef<
    ReturnType<typeof createLearningSegmentPlaybackController> | null
  >(null);

  useEffect(() => {
    if (!player) return;

    const controller = createLearningSegmentPlaybackController({
      player,
    });
    recordingPlaybackRef.current = controller;

    return () => {
      if (recordingPlaybackRef.current === controller) {
        recordingPlaybackRef.current = null;
      }
      controller.destroy();
    };
  }, [player]);

  const removeComparingPitchContour = () => {
    if (!wavesurfer) return;
    if (!regions) return;

    regions
      .getRegions()
      .find((r) => r.id.startsWith("recording-voice-region"))
      ?.remove();

    const wrapper = (wavesurfer as any).renderer.getWrapper();
    wrapper
      .querySelectorAll(".pitch-contour-recording")
      .forEach((el: HTMLDivElement) => el.remove());
  };

  /*
   * Render recording's pitch contour on the original audio waveform
   * with the original pitch contour.
   */
  const renderComparingPitchContour = () => {
    if (!currentRecording) return;

    const region = mediaRegions
      .getRegions()
      .find((r) => r.id.startsWith("segment-region"));
    if (!region) return;

    if (!frequencies || !peaks) return;

    // Trim the peaks from start to end, so we can render the voicable part of the recording
    const minValue = 0.015;
    let voiceStartIndex = 0;
    let voiceEndIndex = peaks.length - 1;

    for (let i = 1; i < voiceEndIndex; i++) {
      if (peaks[i] >= minValue) {
        voiceStartIndex = i;
        break;
      }
    }
    for (let i = voiceEndIndex; i > voiceStartIndex; i--) {
      if (peaks[i] >= minValue) {
        voiceEndIndex = i;
        break;
      }
    }
    const voiceStartFrequenciesIndex = Math.round(
      ((1.0 * voiceStartIndex) / peaks.length) * frequencies.length
    );
    const voiceEndFrequenciesIndex = Math.round(
      ((1.0 * voiceEndIndex) / peaks.length) * frequencies.length
    );

    regions.clearRegions();
    regions.addRegion({
      id: `recording-voice-region-${currentRecording.id}`,
      start: (voiceStartIndex / peaks.length) * player.getDuration(),
      end: (voiceEndIndex / peaks.length) * player.getDuration(),
      color: "#fb6f9211",
      drag: false,
      resize: false,
    });

    const data = frequencies.slice(
      voiceStartFrequenciesIndex,
      voiceEndFrequenciesIndex
    );
    renderMediaPitchContour(region, {
      repaint: false,
      canvasId: `pitch-contour-${currentRecording.id}-canvas`,
      containerClassNames: ["pitch-contour-recording"],
      data: {
        labels: new Array(data.length).fill(""),
        datasets: [
          {
            data,
            cubicInterpolationMode: "monotone",
            borderColor: "#fb6f92",
            pointBorderColor: "#fb6f92",
            pointBackgroundColor: "#ff8fab",
          },
        ],
      },
    });
  };

  const toggleCompare = () => {
    if (isComparing) {
      removeComparingPitchContour();
      setIsComparing(false);
    } else {
      setIsComparing(true);
      renderComparingPitchContour();
    }
  };

  const handleDownload = () => {
    EnjoyApp.dialog
      .showSaveDialog({
        title: t("download"),
        defaultPath: currentRecording.filename,
        filters: [
          {
            name: "Audio",
            extensions: [currentRecording.filename.split(".").pop()],
          },
        ],
      })
      .then((savePath) => {
        if (!savePath) return;

        toast.promise(
          EnjoyApp.download.start(currentRecording.src, savePath as string),
          {
            loading: t("downloadingFile", { file: currentRecording.filename }),
            success: () => t("downloadedSuccessfully"),
            error: t("downloadFailed"),
            position: "bottom-right",
          }
        );
      })
      .catch((err) => {
        if (err) toast.error(err.message);
      });
  };

  const playWord = useCallback(
    (word: string, index: number) => {
      const candidates = caption.timeline.filter(
        (w: TimelineEntry) => w.text.toLowerCase() === word.toLowerCase()
      );
      const target = candidates[index];
      if (!target) return;

      const wordIndex = caption.timeline.findIndex(
        (w) => w.startTime === target.startTime
      );

      toggleRegion([wordIndex]);
      setTimeout(() => {
        wavesurfer?.playPause();
      }, 250);
    },
    [caption?.timeline, toggleRegion, wavesurfer]
  );

  const calContainerSize = () => {
    const size = ref?.current
      ?.closest(".media-recording-wrapper")
      ?.getBoundingClientRect();

    if (!size) return;

    setSize(size);
    if (player) {
      player.setOptions({
        height: size.height - 10, // -10 to leave space for scrollbar
      });
    }

    setActionButtonsCount(Math.floor(size.height / ACTION_BUTTON_HEIGHT));
  };

  const debouncedCalContainerSize = debounce(calContainerSize, 100);

  useEffect(() => {
    if (!ref.current) return;
    if (isRecording) return;
    if (!currentRecording?.src) return;

    const height = ref.current.getBoundingClientRect().height - 10; // -10 to leave space for scrollbar
    const ws = WaveSurfer.create({
      container: ref.current.querySelector(".waveform-container"),
      url: currentRecording.src,
      height,
      barWidth: 2,
      cursorWidth: 1,
      autoCenter: true,
      autoScroll: true,
      minPxPerSec: 150,
      waveColor: "#efefef",
      normalize: false,
      progressColor: "rgba(0, 0, 0, 0.1)",
    });

    setPlayer(ws);

    const regions = ws.registerPlugin(Regions.create());
    setRegions(regions);

    ws.on("timeupdate", (time: number) => setCurrentTime(time));

    ws.on("finish", () => ws.seekTo(0));

    ws.on("ready", () => {
      const peaks: Float32Array = ws.getDecodedData().getChannelData(0);
      const sampleRate = ws.options.sampleRate;
      const data = extractFrequencies({ peaks, sampleRate });
      setFrequencies(data);
      setPeaks(Array.from(peaks));

      renderPitchContour({
        wrapper: ws.getWrapper(),
        canvasId: `pitch-contour-${currentRecording.id}-canvas`,
        labels: new Array(data.length).fill(""),
        datasets: [
          {
            data,
            cubicInterpolationMode: "monotone",
            borderColor: "#fb6f92",
            pointBorderColor: "#fb6f92",
            pointBackgroundColor: "#ff8fab",
          },
        ],
      });
    });

    return () => {
      ws?.destroy();
    };
  }, [ref, currentRecording, isRecording]);

  useEffect(() => {
    setCurrentTime(0);
    setIsComparing(false);
    removeComparingPitchContour();
  }, [currentRecording]);

  useEffect(() => {
    if (!isComparing) return;

    if (editingRegion) {
      setIsComparing(false);
    } else {
      setTimeout(() => {
        renderComparingPitchContour();
      }, 100);
    }
  }, [zoomRatio, editingRegion]);

  useEffect(() => {
    if (!regions) return;

    let disableSelectingRegion: () => void | undefined;
    if (isSelectingRegion) {
      regions.clearRegions();
      disableSelectingRegion = regions.enableDragSelection({
        color: "rgba(76, 201, 240, 0.2)",
        drag: false,
      });
    }

    const subscriptions = [
      regions.on("region-created", () => {}),

      regions.on("region-clicked", (region, e) => {
        e.stopPropagation();
        recordingPlaybackRef.current?.playRegion(region);
      }),

      regions.on("region-out", (region) => {
        recordingPlaybackRef.current?.handleRegionOut(region);
      }),
    ];

    return () => {
      if (disableSelectingRegion) disableSelectingRegion();
      regions.clearRegions();
      subscriptions.forEach((unsub) => unsub());
    };
  }, [regions, isSelectingRegion, player]);

  /*
   * Update player styles
   */
  useEffect(() => {
    if (!ref?.current || !player) return;

    const scrollContainer = player.getWrapper()?.closest(".scroll");
    if (!scrollContainer) return;

    scrollContainer.style.scrollbarWidth = "thin";
  }, [ref, player]);

  /*
   * play recording along with the media when isComparing is true
   * only when the media is playing and the active region is the segment region
   */
  useEffect(() => {
    if (!regions) return;
    if (!isComparing) return;
    if (!wavesurfer?.isPlaying()) return;
    if (player?.isPlaying()) return;
    if (!mediaActiveRegion?.id?.startsWith("segment-region")) return;

    const voiceRegion = regions
      .getRegions()
      .find((r) => r.id.startsWith("recording-voice-region"));
    if (voiceRegion) {
      recordingPlaybackRef.current?.playRegion(voiceRegion);
    }
  }, [
    wavesurfer,
    player,
    regions,
    isComparing,
    mediaCurrentTime,
    mediaActiveRegion,
  ]);

  useEffect(() => {
    if (!ref?.current) return;
    if (!player) return;

    let rafId: number;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        debouncedCalContainerSize();
      });
    });
    observer.observe(ref.current);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [ref, player]);

  useHotkeys(currentHotkeys.PlayOrPauseRecording, () => {
    const button = document.getElementById("recording-play-or-pause-button");
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const elementAtPoint = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2
    );
    if (elementAtPoint !== button && !button.contains(elementAtPoint)) return;

    button.click();
  });

  useHotkeys(currentHotkeys.PronunciationAssessment, () => {
    if (isRecording) return;
    setDetailIsOpen(!detailIsOpen);
  });

  useHotkeys(
    currentHotkeys.Compare,
    () => {
      toggleCompare();
    },
    {
      preventDefault: true,
    }
  );

  const Actions = [
    {
      id: "recording-record-button-wrapper",
      name: "record",
      label: t("record"),
      icon: MediaRecordButton,
      active: isRecording,
      onClick: () => {},
      asChild: true,
    },
    {
      id: "recording-play-or-pause-button",
      name: "playOrPause",
      label: t("playRecording"),
      icon: player?.isPlaying() ? PauseIcon : PlayIcon,
      active: player?.isPlaying(),
      onClick: () => {
        const region = regions
          ?.getRegions()
          ?.find((r) => r.id.startsWith("recording-voice-region"));

        if (region) {
          recordingPlaybackRef.current?.setActiveRegion(region);
          recordingPlaybackRef.current?.toggle();
        } else {
          player?.playPause();
        }
      },
      asChild: false,
    },
    {
      id: "media-pronunciation-assessment-button",
      name: "pronunciationAssessment",
      label: t("pronunciationAssessment"),
      icon: GaugeCircleIcon,
      active: detailIsOpen,
      iconClassName: currentRecording?.pronunciationAssessment
        ? currentRecording?.pronunciationAssessment.pronunciationScore >= 80
          ? "text-green-500"
          : currentRecording?.pronunciationAssessment.pronunciationScore >= 60
          ? "text-yellow-600"
          : "text-red-500"
        : "",
      onClick: () => setDetailIsOpen(!detailIsOpen),
      asChild: false,
    },
    {
      id: "media-compare-button",
      name: "compare",
      label: t("compare"),
      icon: GitCompareIcon,
      active: isComparing,
      onClick: toggleCompare,
      asChild: false,
    },
    {
      id: "media-select-region-button",
      name: "selectRegion",
      label: t("selectRegion"),
      icon: TextCursorInputIcon,
      active: isSelectingRegion,
      onClick: () => setIsSelectingRegion(!isSelectingRegion),
      asChild: false,
    },
    {
      id: "media-download-button",
      name: "download",
      label: t("download"),
      icon: DownloadIcon,
      active: false,
      onClick: handleDownload,
      asChild: false,
    },
  ];

  if (isRecording || isPaused) {
    return <MediaRecorder />;
  }

  if (!currentRecording?.src)
    return (
      <div className="h-full w-full flex items-center justify-center gap-4 rounded-ej border border-dashed border-ej-line2 bg-ej-surface2/30">
        <MediaRecordButton variant="pill" />
        <div
          className="text-xs text-ej-muted max-w-xs"
          dangerouslySetInnerHTML={{
            __html: t("noRecordingForThisSegmentYet", {
              key: currentHotkeys.StartOrStopRecording?.toUpperCase(),
            }),
          }}
        ></div>
      </div>
    );

  return (
    <div
      ref={ref}
      className="h-full flex media-recording-wrapper border border-ej-line rounded-ej bg-ej-surface2/30 overflow-hidden"
    >
      <div className="flex-1 relative media-recording-container">
        <div
          style={{
            width: `${size?.width - 40}px`, // -40 for action buttons
            height: `${size?.height}px`,
          }}
          className="waveform-container"
        ></div>

        <div className="absolute right-2 top-1 rounded-full bg-ej-surface/85 px-2 py-0.5 text-xxs ej-tabular text-ej-muted">
          <span>{formatDuration(currentTime || 0)}</span>
          <span className="mx-1">/</span>
          <span>
            {formatDuration(
              player?.getDuration() || currentRecording.duration / 1000.0 || 0
            )}
          </span>
        </div>
      </div>

      <div
        className={`grid grid-rows-${
          actionButtonsCount < Actions.length
            ? actionButtonsCount + 1
            : Actions.length
        } w-10 border-l border-ej-line`}
      >
        {Actions.slice(0, actionButtonsCount).map((action) => (
          <Button
            key={action.name}
            id={action.id}
            variant={action.active ? "secondary" : "ghost"}
            data-tooltip-id="media-shadow-tooltip"
            data-tooltip-content={action.label}
            className="relative p-0 w-full h-full rounded-none"
            onClick={action.onClick}
            asChild={action.asChild}
          >
            <action.icon className={`w-4 h-4 ${cn(action.iconClassName)}`} />
          </Button>
        ))}

        {actionButtonsCount < Actions.length && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                data-tooltip-id="media-shadow-tooltip"
                data-tooltip-content={t("more")}
                className="rounded-none w-full h-full p-0"
              >
                <MoreHorizontalIcon className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent>
              {Actions.slice(actionButtonsCount).map((action) => (
                <DropdownMenuItem
                  id={action.id}
                  key={action.name}
                  className={`cursor-pointer ${
                    action.active ? "bg-ej-surface2" : ""
                  }`}
                  onClick={action.onClick}
                >
                  <action.icon
                    className={`${cn(action.iconClassName)} w-4 h-4 mr-4`}
                  />
                  <span>{action.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <Sheet open={detailIsOpen} onOpenChange={(open) => setDetailIsOpen(open)}>
        <SheetContent
          container="main-panel-content"
          aria-describedby={undefined}
          side="bottom"
          className="rounded-t-ej-lg border-t border-ej-line bg-ej-bg shadow-ej max-h-content overflow-y-auto scroll"
          displayClose={false}
        >
          <SheetHeader className="-mt-2 mb-3 flex flex-row items-center justify-between gap-2 space-y-0">
            <SheetTitle className="ej-label">
              {t("pronunciationAssessment")}
            </SheetTitle>
            <SheetClose className="inline-flex items-center justify-center size-7 rounded-lg text-ej-ink2 hover:bg-ej-surface2 transition-colors duration-ej">
              <ChevronDownIcon className="size-4" />
            </SheetClose>
          </SheetHeader>

          <RecordingDetail
            recording={currentRecording}
            onPlayOrigin={playWord}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
};

export const MediaRecordButton = (props: { variant?: "fill" | "pill" }) => {
  const { variant = "fill" } = props;
  const { isRecording, startRecording, stopRecording } = useContext(
    MediaShadowProviderContext
  );

  return (
    <Button
      variant="ghost"
      onClick={() => {
        if (isRecording) {
          stopRecording();
        } else {
          startRecording();
        }
      }}
      id="media-record-button"
      data-tooltip-id="media-shadow-tooltip"
      data-tooltip-content={
        isRecording ? t("stopRecording") : t("startRecording")
      }
      className={cn(
        "text-white",
        variant === "pill"
          ? "h-[44px] px-5 rounded-full gap-2 text-[13px] font-semibold shadow-ej"
          : "p-0 h-full w-full rounded-none",
        isRecording
          ? "bg-ej-bad hover:bg-ej-bad/90"
          : variant === "pill"
          ? "bg-ej-accent hover:bg-ej-accent-ink"
          : "bg-ej-bad hover:bg-ej-bad/90"
      )}
    >
      {isRecording ? (
        <SquareIcon fill="currentColor" className="size-4" />
      ) : (
        <MicIcon className="size-4" />
      )}
      {variant === "pill" && (
        <span>{isRecording ? t("stopRecording") : t("startRecording")}</span>
      )}
    </Button>
  );
};

const MediaRecorder = () => {
  const {
    mediaRecorder,
    recordingTime,
    isPaused,
    cancelRecording,
    togglePauseResume,
    stopRecording,
  } = useContext(MediaShadowProviderContext);
  const ref = useRef(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null
  );

  const calContainerSize = () => {
    const size = ref?.current?.getBoundingClientRect();
    if (!size) return;

    setSize({ width: size.width, height: size.height });
  };
  const debouncedCalContainerSize = debounce(calContainerSize, 100);

  useEffect(() => {
    if (!ref?.current) return;

    let rafId: number;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        debouncedCalContainerSize();
      });
    });
    observer.observe(ref.current);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [ref]);

  return (
    <div
      ref={ref}
      className="w-full h-full flex justify-center items-center gap-4 rounded-ej border border-ej-bad/40 bg-ej-bad-soft/50"
    >
      {size?.width && size?.width > 1024 && (
        <LiveAudioVisualizer
          mediaRecorder={mediaRecorder}
          barWidth={2}
          gap={2}
          width={480}
          height="100%"
          fftSize={512}
          maxDecibels={-10}
          minDecibels={-80}
          smoothingTimeConstant={0.4}
        />
      )}
      <span className="flex items-center gap-2 text-[15px] font-bold ej-tabular text-ej-bad">
        <RecordingDot />
        {Math.floor(recordingTime / 60)}:
        {String(recordingTime % 60).padStart(2, "0")}
      </span>
      <div className="flex items-center gap-2">
        <Button
          data-tooltip-id="media-shadow-tooltip"
          data-tooltip-content={t("cancel")}
          onClick={cancelRecording}
          className="rounded-full shadow w-8 h-8 bg-ej-bad hover:bg-ej-bad/90"
          variant="secondary"
          size="icon"
        >
          <XIcon fill="white" className="w-4 h-4 text-white" />
        </Button>
        <Button
          onClick={togglePauseResume}
          className="rounded-full shadow w-8 h-8"
          size="icon"
        >
          {isPaused ? (
            <PlayIcon
              data-tooltip-id="media-shadow-tooltip"
              data-tooltip-content={t("continue")}
              fill="white"
              className="w-4 h-4"
            />
          ) : (
            <PauseIcon
              data-tooltip-id="media-shadow-tooltip"
              data-tooltip-content={t("pause")}
              fill="white"
              className="w-4 h-4"
            />
          )}
        </Button>
        <Button
          id="media-record-button"
          data-tooltip-id="media-shadow-tooltip"
          data-tooltip-content={t("finish")}
          onClick={stopRecording}
          className="rounded-full bg-ej-ok hover:bg-ej-ok/90 shadow w-8 h-8"
          size="icon"
        >
          <CheckIcon className="w-4 h-4 text-white" />
        </Button>
      </div>
    </div>
  );
};
