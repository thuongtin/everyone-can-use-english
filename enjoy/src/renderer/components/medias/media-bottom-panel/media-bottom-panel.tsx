import {
  MediaCurrentRecording,
  MediaWaveform,
  MediaPlayerControls,
} from "@renderer/components";

export const MediaBottomPanel = () => {
  return (
    <div className="shrink-0 border-t border-ej-line bg-ej-surface">
      <div className="px-4 pt-3 pb-1 space-y-2">
        <div className="h-[84px]">
          <MediaCurrentRecording />
        </div>
        <div className="h-[92px]">
          <MediaWaveform />
        </div>
      </div>

      <MediaPlayerControls />
    </div>
  );
};
