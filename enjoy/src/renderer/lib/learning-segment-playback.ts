export type LearningPlaybackMode = "single" | "loop" | "all";

export type LearningPlaybackRegion = {
  id: string;
  start: number;
  end: number;
};

export type LearningPlaybackPlayer = {
  getCurrentTime: () => number;
  isPlaying: () => boolean;
  pause: () => void;
  play: (start?: number, end?: number) => Promise<void>;
  setTime: (time: number) => void;
  setScrollTime: (time: number) => void;
};

export type RegionOutResult =
  | "ended"
  | "inactive-instance"
  | "inactive-region"
  | "outside-region"
  | "start-rounding"
  | "unbounded-mode"
  | "within-region";

type LearningSegmentPlaybackOptions = {
  player: LearningPlaybackPlayer;
  schedule?: (callback: () => void) => void;
  startToleranceSeconds?: number;
};

const sameRegion = (
  left: LearningPlaybackRegion | null,
  right: LearningPlaybackRegion | null
) =>
  left?.id === right?.id &&
  left?.start === right?.start &&
  left?.end === right?.end;

export const shouldPreserveLearningSubregion = (
  activeRegion: LearningPlaybackRegion | null,
  segmentRegion: LearningPlaybackRegion
) =>
  Boolean(
    (activeRegion?.id.startsWith("word-region") ||
      activeRegion?.id.startsWith("meaning-group-region")) &&
      activeRegion.start >= segmentRegion.start &&
      activeRegion.end <= segmentRegion.end
  );

export const createLearningSegmentPlaybackController = ({
  player,
  schedule = (callback) => requestAnimationFrame(callback),
  startToleranceSeconds = 0.05,
}: LearningSegmentPlaybackOptions) => {
  let activeRegion: LearningPlaybackRegion | null = null;
  let mode: LearningPlaybackMode = "single";
  let regionRevision = 0;
  let destroyed = false;

  const setActiveRegion = (region: LearningPlaybackRegion | null) => {
    if (!sameRegion(activeRegion, region)) regionRevision += 1;
    activeRegion = region;
  };

  const setMode = (nextMode: LearningPlaybackMode) => {
    if (mode !== nextMode) regionRevision += 1;
    mode = nextMode;
  };

  const playRegion = (region: LearningPlaybackRegion) => {
    if (destroyed) return;
    setActiveRegion(region);
    void player.play(region.start, region.end);
  };

  const navigateToRegion = (region: LearningPlaybackRegion) => {
    if (destroyed) return;
    const continuePlaying = player.isPlaying();
    setActiveRegion(region);

    // Pausing clears any bound held by the native WaveSurfer player. The
    // region revision above also invalidates queued callbacks from the old
    // segment before the native time is moved.
    if (continuePlaying) player.pause();
    player.setTime(region.start);
    player.setScrollTime(region.start);

    if (continuePlaying) {
      void player.play(
        region.start,
        mode === "all" ? undefined : region.end
      );
    }
  };

  const toggle = () => {
    if (destroyed) return;
    if (player.isPlaying()) {
      player.pause();
      return;
    }

    if (mode === "all" || !activeRegion) {
      void player.play();
      return;
    }

    const currentTime = player.getCurrentTime();
    const shouldRestart =
      currentTime < activeRegion.start + startToleranceSeconds ||
      currentTime >= activeRegion.end;
    void player.play(
      shouldRestart ? activeRegion.start : undefined,
      activeRegion.end
    );
  };

  const handleRegionOut = (region: LearningPlaybackRegion): RegionOutResult => {
    if (destroyed) return "inactive-instance";
    if (!activeRegion || !sameRegion(activeRegion, region)) {
      return "inactive-region";
    }
    if (mode === "all") return "unbounded-mode";

    const currentTime = player.getCurrentTime();
    if (
      currentTime < region.start &&
      currentTime >= region.start - startToleranceSeconds
    ) {
      return "start-rounding";
    }
    if (currentTime >= region.start && currentTime < region.end) {
      return "within-region";
    }

    const scheduledRevision = regionRevision;
    player.pause();
    schedule(() => {
      if (
        destroyed ||
        scheduledRevision !== regionRevision ||
        !sameRegion(activeRegion, region)
      ) {
        return;
      }

      if (mode === "loop") {
        void player.play(region.start, region.end);
        return;
      }

      if (mode === "single") {
        player.setTime(region.start);
        player.setScrollTime(region.start);
      }
    });
    return currentTime >= region.end ? "ended" : "outside-region";
  };

  return {
    destroy: () => {
      destroyed = true;
      activeRegion = null;
      regionRevision += 1;
    },
    handleRegionOut,
    navigateToRegion,
    playRegion,
    setActiveRegion,
    setMode,
    toggle,
  };
};
