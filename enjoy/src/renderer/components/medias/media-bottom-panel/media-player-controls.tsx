import { useEffect, useState, useContext, useRef } from "react";
import { type Region as RegionType } from "wavesurfer.js/dist/plugins/regions";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@renderer/components/ui";
import { EjIconButton } from "@renderer/components/enjoy";
import { cn } from "@renderer/lib/utils";
import {
  createLearningSegmentPlaybackController,
  shouldPreserveLearningSubregion,
} from "@renderer/lib/learning-segment-playback";
import {
  MediaShadowProviderContext,
  AppSettingsProviderContext,
  HotKeysSettingsProviderContext,
} from "@renderer/context";
import {
  ScissorsIcon,
  PlayIcon,
  PauseIcon,
  Repeat1Icon,
  RepeatIcon,
  ListRestartIcon,
  SkipForwardIcon,
  SkipBackIcon,
  SaveIcon,
  UndoIcon,
  GroupIcon,
} from "lucide-react";
import { t } from "i18next";
import { useHotkeys } from "react-hotkeys-hook";
import cloneDeep from "lodash/cloneDeep";
import debounce from "lodash/debounce";
import { AlignmentResult } from "echogarden/dist/api/API.d.js";
import { TimelineEntry } from "echogarden/dist/utilities/Timeline.d.js";

const PLAYBACK_RATE_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5];
export const MediaPlayerControls = () => {
  const {
    decoded,
    wavesurfer,
    currentTime,
    currentSegmentIndex,
    setCurrentSegmentIndex,
    zoomRatio,
    setZoomRatio,
    fitZoomRatio,
    transcription,
    regions,
    activeRegion,
    setActiveRegion,
    editingRegion,
    setEditingRegion,
    transcriptionDraft,
    setTranscriptionDraft,
  } = useContext(MediaShadowProviderContext);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { currentHotkeys } = useContext(HotKeysSettingsProviderContext);
  const [playMode, setPlayMode] = useState<"loop" | "single" | "all">("single");
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [grouping, setGrouping] = useState(false);
  const learningPlaybackRef = useRef<
    ReturnType<typeof createLearningSegmentPlaybackController> | null
  >(null);

  const playOrPause = () => {
    learningPlaybackRef.current?.toggle();
  };
  const debouncedPlayOrPause = debounce(playOrPause, 100);

  useEffect(() => {
    if (!wavesurfer) return;

    const controller = createLearningSegmentPlaybackController({
      player: wavesurfer,
    });
    learningPlaybackRef.current = controller;

    return () => {
      if (learningPlaybackRef.current === controller) {
        learningPlaybackRef.current = null;
      }
      controller.destroy();
    };
  }, [wavesurfer]);

  useEffect(() => {
    learningPlaybackRef.current?.setMode(playMode);
  }, [playMode, wavesurfer]);

  useEffect(() => {
    learningPlaybackRef.current?.setActiveRegion(activeRegion);
  }, [activeRegion, wavesurfer]);

  const segmentPlaybackRegion = (index: number) => {
    const segment = transcription?.result?.timeline?.[index];
    if (!segment) return null;
    return {
      id: `segment-region-${index}`,
      start: segment.startTime,
      end: segment.endTime,
    };
  };

  const navigateToSegment = (index: number) => {
    const region = segmentPlaybackRegion(index);
    if (!region) return;
    learningPlaybackRef.current?.navigateToRegion(region);
    setCurrentSegmentIndex(index);
  };

  const onPrev = () => {
    if (!wavesurfer) return;
    navigateToSegment(currentSegmentIndex - 1);
  };

  const onNext = () => {
    if (!wavesurfer) return;
    navigateToSegment(currentSegmentIndex + 1);
  };

  /*
   * Update segmentRegion when currentSegmentIndex is updated
   * or when editingRegion is toggled.
   * It will clear all regions and add a new region for the current segment.
   */
  const updateSegmentRegion = () => {
    if (!wavesurfer) return;
    if (!regions) return;

    // Do not update segmentRegion when editing word region
    if (
      editingRegion &&
      activeRegion &&
      activeRegion.id.startsWith("word-region")
    ) {
      return;
    }

    const currentSegment =
      transcription?.result?.timeline?.[currentSegmentIndex];
    if (!currentSegment) return;

    const id = `segment-region-${currentSegmentIndex}`;
    const from = currentSegment.startTime;
    const to = currentSegment.endTime;
    const span = document.createElement("span");
    span.innerText = `#${currentSegmentIndex + 1} (${(to - from).toFixed(2)}s)`;
    span.style.padding = "1rem";
    span.style.fontSize = "0.9rem";

    regions
      .getRegions()
      .filter((r) => r.id.startsWith("segment-region"))
      .forEach((r) => r.remove());

    const region = regions.addRegion({
      id,
      start: from,
      end: to,
      color: "#fb6f9211",
      drag: false,
      resize: editingRegion,
      content: span,
    });

    /*
     * Remain active wordRegion unchanged if it's still in the segment region.
     * It happens when word region finish editing and the transcription is updated.
     */
    if (shouldPreserveLearningSubregion(activeRegion, region)) {
      return;
    }

    /*
     * Otherwise remove all word regions.
     * Set the segment region as active
     */
    regions
      .getRegions()
      .filter((r) => r.id.startsWith("word-region"))
      .forEach((r) => r.remove());
    setActiveRegion(region);
    wavesurfer.setScrollTime(region.start);
  };

  // Keep one debounced callback for the component lifetime. It dereferences
  // the latest render so a word selection made during the wait is preserved.
  const updateSegmentRegionRef = useRef(updateSegmentRegion);
  updateSegmentRegionRef.current = updateSegmentRegion;
  const debouncedUpdateSegmentRegionRef = useRef(
    debounce(() => updateSegmentRegionRef.current(), 100)
  );
  const debouncedUpdateSegmentRegion = debouncedUpdateSegmentRegionRef.current;

  useEffect(
    () => () => {
      debouncedUpdateSegmentRegion.cancel();
    },
    [debouncedUpdateSegmentRegion]
  );

  const groupMeanings = () => {
    if (!regions) return;

    regions
      .getRegions()
      .filter((r) => r.id.startsWith("meaning-group-region"))
      .forEach((r) => r.remove());

    const groups: { start: number; end: number }[] = [];
    const segment = transcription?.result?.timeline[currentSegmentIndex];
    if (!segment) return;

    const words = segment.text.split(" ");
    const silenceThreshold = 0.15;
    const groupThreshold = 0.5;

    let start = segment.timeline[0].startTime;
    let end = segment.timeline[0].endTime;

    segment.timeline.forEach((word: TimelineEntry, i: number) => {
      const text = words[i - 1];
      const lastWord = segment.timeline[i - 1];

      if (
        // split group when silence is longer than silenceThreshold
        (word.startTime - end > silenceThreshold ||
          // split group when there is a comma or colon at the end of the word
          (text &&
            lastWord &&
            text.match(/,|:$/) &&
            text.includes(lastWord.text))) &&
        // split group only when group duration is longer than groupThreshold
        end - start > groupThreshold
      ) {
        groups.push({ start, end });
        start = word.startTime;
        end = word.endTime;
      } else {
        end = word.endTime;
      }
    });
    groups.push({ start, end });

    const groupRegions: RegionType[] = [];
    groups.forEach((group) => {
      groupRegions.push(
        regions.addRegion({
          id: `meaning-group-region-${Date.now()}`,
          start: group.start,
          end: group.end,
          color: "#fb6f9233",
          drag: false,
          resize: false,
        })
      );
    });

    setActiveRegion(groupRegions[0]);
  };

  const findAndClickElement = (id: string) => {
    const button = document.getElementById(id);
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const elementAtPoint = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2
    );
    if (elementAtPoint !== button && !button.contains(elementAtPoint)) return;

    button.click();
  };

  /*
   * Update segmentRegion when currentSegmentIndex is updated
   */
  useEffect(() => {
    if (!regions) return;

    // Exit editing when segment is updated
    setEditingRegion(false);
    debouncedUpdateSegmentRegion();
  }, [currentSegmentIndex, regions, transcription?.result]);

  /*
   * Handle segment-index changes from transcript and caption controls without
   * waiting for the visual region debounce. Index changes driven by all-mode
   * playback already have native time inside the new segment and only need to
   * invalidate the old controller region.
   */
  useEffect(() => {
    if (!wavesurfer) return;
    const region = segmentPlaybackRegion(currentSegmentIndex);
    if (!region) return;

    const time = wavesurfer.getCurrentTime();
    if (time >= region.start && time < region.end) {
      learningPlaybackRef.current?.setActiveRegion(region);
      return;
    }
    learningPlaybackRef.current?.navigateToRegion(region);
  }, [currentSegmentIndex, transcription?.id, wavesurfer]);

  /*
   * Update region to editable when editingRegion is toggled
   */
  useEffect(() => {
    debouncedUpdateSegmentRegion();
  }, [editingRegion]);

  /*
   * When regions are available,
   * set up event listeners for regions
   * and clean up when component is unmounted
   */
  useEffect(() => {
    if (!regions) return;
    if (!transcription?.result) return;

    const segmentRegion = regions
      .getRegions()
      .find((r) => r.id === `segment-region-${currentSegmentIndex}`);

    const subscriptions = [
      regions.on("region-updated", (region) => {
        if (region !== segmentRegion) {
          return;
        }

        const draft = cloneDeep(transcription.result);

        draft.timeline[currentSegmentIndex].startTime = region.start;
        draft.timeline[currentSegmentIndex].endTime = region.end;

        // ensure that the previous segment ends before the current segment
        if (
          currentSegmentIndex > 0 &&
          draft.timeline[currentSegmentIndex - 1].endTime > region.start
        ) {
          draft.timeline[currentSegmentIndex - 1].endTime = region.start;
        }

        // ensure that the next segment starts after the current segment
        if (
          currentSegmentIndex < draft.length - 1 &&
          draft.timeline[currentSegmentIndex + 1].startTime < region.end
        ) {
          draft.timeline[currentSegmentIndex + 1].startTime = region.end;
        }

        setTranscriptionDraft(draft);
      }),

      regions.on("region-clicked", (region, event) => {
        if (region.id.startsWith("meaning-group-region")) {
          learningPlaybackRef.current?.setActiveRegion(region);
          setActiveRegion(region);
          learningPlaybackRef.current?.playRegion(region);
          event.stopPropagation();
        }
      }),

      regions.on("region-out", (region) => {
        learningPlaybackRef.current?.handleRegionOut(region);
      }),
    ];

    return () => {
      subscriptions.forEach((unsub) => unsub());
    };
  }, [regions, transcription, currentSegmentIndex]);

  /*
   * Auto select the firt segment when everything is ready
   */
  useEffect(() => {
    if (!transcription?.result) return;
    if (!transcription.result["transcript"]) return;
    if (!decoded) return;
    if (!wavesurfer) return;

    const segment = transcription.result.timeline[currentSegmentIndex];
    if (!segment) {
      setCurrentSegmentIndex(0);
      return;
    }
    wavesurfer.setScrollTime(segment.startTime);
    wavesurfer.setTime(parseFloat(segment.startTime.toFixed(6)));
  }, [decoded, transcription?.id, wavesurfer]);

  useEffect(() => {
    if (!wavesurfer) return;

    wavesurfer.setPlaybackRate(playbackRate);
  }, [playbackRate, wavesurfer]);

  /*
   * Update currentSegmentIndex when currentTime is updated
   */
  useEffect(() => {
    if (!transcription?.result) return;
    if (!transcription.result["transcript"]) return;

    const index = (transcription.result as AlignmentResult).timeline.findIndex(
      (t) => currentTime >= t.startTime && currentTime < t.endTime
    );
    if (index === -1) return;
    // Stay on the current segment if playMode is single
    if (["single", "loop"].includes(playMode) && index !== currentSegmentIndex)
      return;

    setCurrentSegmentIndex(index);
  }, [currentTime, transcription?.result]);

  useHotkeys(
    currentHotkeys.PlayOrPause,
    () => {
      findAndClickElement("media-play-or-pause-button");
    },
    {
      preventDefault: true,
    }
  );
  useHotkeys(
    currentHotkeys.PlayPreviousSegment,
    () => {
      findAndClickElement("media-play-previous-button");
    },
    {
      preventDefault: true,
    }
  );
  useHotkeys(
    currentHotkeys.PlayNextSegment,
    () => {
      findAndClickElement("media-play-next-button");
    },
    {
      preventDefault: true,
    }
  );
  useHotkeys(
    currentHotkeys.StartOrStopRecording,
    () => {
      findAndClickElement("media-record-button");
    },
    {
      preventDefault: true,
    }
  );
  useHotkeys(
    currentHotkeys.IncreasePlaybackRate,
    () => {
      setPlaybackRate(
        PLAYBACK_RATE_OPTIONS[
          PLAYBACK_RATE_OPTIONS.indexOf(playbackRate) + 1
        ] ?? playbackRate
      );
    },
    {
      preventDefault: true,
    }
  );
  useHotkeys(
    currentHotkeys.DecreasePlaybackRate,
    () => {
      setPlaybackRate(
        PLAYBACK_RATE_OPTIONS[
          PLAYBACK_RATE_OPTIONS.indexOf(playbackRate) - 1
        ] ?? playbackRate
      );
    },
    {
      preventDefault: true,
    }
  );

  /*
   * Fit zoom ratio when activeRegion is word or segment
   * not in playMode all
   */
  useEffect(() => {
    if (!activeRegion) return;
    if (!wavesurfer) return;
    if (zoomRatio === fitZoomRatio) return;
    if (playMode === "all") return;

    if (
      activeRegion.id.startsWith("word-region") ||
      activeRegion.id.startsWith("segment-region")
    ) {
      if (!wavesurfer.isPlaying()) {
        wavesurfer.setTime(parseFloat(activeRegion.start.toFixed(6)));
      }
      setZoomRatio(fitZoomRatio);
    }
  }, [activeRegion, fitZoomRatio, playMode, wavesurfer, zoomRatio]);

  /*
   * Remove word regions when meaning group region is active
   * and vice versa
   */
  useEffect(() => {
    if (!regions) return;
    if (!activeRegion) return;

    if (activeRegion.id.startsWith("meaning-group-region")) {
      regions
        .getRegions()
        .filter((r) => r.id.startsWith("word-region"))
        .forEach((r) => r.remove());
    } else {
      setGrouping(false);
    }
  }, [regions, activeRegion]);

  /*
   * toggle meaning groups
   */
  useEffect(() => {
    if (!regions) return;

    if (grouping) {
      groupMeanings();
    }

    return () => {
      const currentRegions = regions.getRegions();
      currentRegions
        .filter((r) => r.id.startsWith("meaning-group-region"))
        .forEach((r) => r.remove());

      const wordRegion = currentRegions.find((r) =>
        r.id.startsWith("word-region")
      );
      const segmentRegion = currentRegions.find((r) =>
        r.id.startsWith("segment-region")
      );
      setActiveRegion(wordRegion || segmentRegion);
    };
  }, [grouping]);

  const cyclePlaybackRate = () => {
    const index = PLAYBACK_RATE_OPTIONS.indexOf(playbackRate);
    setPlaybackRate(
      PLAYBACK_RATE_OPTIONS[(index + 1) % PLAYBACK_RATE_OPTIONS.length]
    );
  };

  return (
    <div className="w-full h-[62px] flex items-center justify-center gap-1.5 px-6 border-t border-ej-line">
      <EjIconButton
        size={32}
        active={playbackRate !== 1.0}
        data-tooltip-id="media-shadow-tooltip"
        data-tooltip-content={t("playbackSpeed")}
        onClick={cyclePlaybackRate}
      >
        <span className="text-xxs font-bold ej-tabular">{playbackRate}x</span>
      </EjIconButton>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <EjIconButton
            size={32}
            active={playMode !== "single"}
            data-tooltip-id="media-shadow-tooltip"
            data-tooltip-content={t("switchPlayMode")}
          >
            {playMode === "single" && <RepeatIcon className="size-[18px]" />}
            {playMode === "loop" && <Repeat1Icon className="size-[18px]" />}
            {playMode === "all" && <ListRestartIcon className="size-[18px]" />}
          </EjIconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-48">
          <DropdownMenuItem
            className={playMode === "single" ? "bg-ej-surface2" : ""}
            onClick={() => setPlayMode("single")}
          >
            <RepeatIcon className="size-4 mr-2" />
            <span>{t("playSingleSegment")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className={playMode === "loop" ? "bg-ej-surface2" : ""}
            onClick={() => setPlayMode("loop")}
          >
            <Repeat1Icon className="size-4 mr-2" />
            <span>{t("playInLoop")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className={playMode === "all" ? "bg-ej-surface2" : ""}
            onClick={() => setPlayMode("all")}
          >
            <ListRestartIcon className="size-4 mr-2" />
            <span>{t("playAllSegments")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EjIconButton
        size={32}
        onClick={onPrev}
        id="media-play-previous-button"
        data-tooltip-id="media-shadow-tooltip"
        data-tooltip-content={t("playPreviousSegment")}
      >
        <SkipBackIcon className="size-[18px]" />
      </EjIconButton>

      <button
        type="button"
        onClick={debouncedPlayOrPause}
        id="media-play-or-pause-button"
        data-tooltip-id="media-shadow-tooltip"
        data-tooltip-content={wavesurfer?.isPlaying() ? t("pause") : t("play")}
        className={cn(
          "size-10 rounded-full shrink-0 inline-flex items-center justify-center mx-1",
          "bg-ej-accent text-white shadow-ej transition-colors duration-ej",
          "hover:bg-ej-accent-ink"
        )}
      >
        {wavesurfer?.isPlaying() ? (
          <PauseIcon fill="currentColor" className="size-[18px]" />
        ) : (
          <PlayIcon fill="currentColor" className="size-[18px] ml-0.5" />
        )}
      </button>

      <EjIconButton
        size={32}
        onClick={onNext}
        id="media-play-next-button"
        data-tooltip-id="media-shadow-tooltip"
        data-tooltip-content={t("playNextSegment")}
      >
        <SkipForwardIcon className="size-[18px]" />
      </EjIconButton>

      <EjIconButton
        size={32}
        active={grouping}
        data-tooltip-id="media-shadow-tooltip"
        data-tooltip-content={t("autoGroup")}
        onClick={() => setGrouping(!grouping)}
      >
        <GroupIcon className="size-[18px]" />
      </EjIconButton>

      <div className="relative">
        <EjIconButton
          size={32}
          active={editingRegion}
          data-tooltip-id="media-shadow-tooltip"
          data-tooltip-content={
            editingRegion ? t("dragRegionBorderToEdit") : t("editRegion")
          }
          onClick={() => {
            setEditingRegion(!editingRegion);
          }}
        >
          <ScissorsIcon className="size-[18px]" />
        </EjIconButton>

        {editingRegion && (
          <div className="absolute top-0 left-10 flex items-center gap-1">
            <EjIconButton
              size={32}
              data-tooltip-id="media-shadow-tooltip"
              data-tooltip-content={t("cancel")}
              onClick={() => {
                setEditingRegion(false);
                setTranscriptionDraft(null);
              }}
            >
              <UndoIcon className="size-[18px]" />
            </EjIconButton>
            <EjIconButton
              size={32}
              className="bg-ej-accent text-white hover:bg-ej-accent-ink hover:text-white"
              data-tooltip-id="media-shadow-tooltip"
              data-tooltip-content={t("save")}
              onClick={() => {
                if (!transcriptionDraft) return;

                EnjoyApp.transcriptions
                  .update(transcription.id, {
                    result: transcriptionDraft,
                  })
                  .then(() => {
                    setTranscriptionDraft(null);
                    setEditingRegion(false);
                  });
              }}
            >
              <SaveIcon className="size-[18px]" />
            </EjIconButton>
          </div>
        )}
      </div>
    </div>
  );
};
