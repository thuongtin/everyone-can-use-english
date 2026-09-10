import { useEffect, useContext, useState } from "react";
import { MediaShadowProviderContext } from "@renderer/context";
import {
  MediaProvider,
  MediaTranscription,
  MediaInfo,
  MediaRecordings,
  MediaVideoStage,
} from "@renderer/components";
import { EjIconButton, Segmented } from "@renderer/components/enjoy";
import { t } from "i18next";
import { cn } from "@renderer/lib/utils";
import {
  ArrowLeftRightIcon,
  LanguagesIcon,
  MousePointerClickIcon,
} from "lucide-react";

type LeftTab = "transcription" | "recordings" | "info";

export const MediaLeftPanel = (props: {
  className?: string;
  setDisplayPanel?: (displayPanel: "left" | "right" | null) => void;
}) => {
  const { className, setDisplayPanel } = props;
  const { media, decoded, layout } = useContext(MediaShadowProviderContext);
  const [tab, setTab] = useState<LeftTab>("transcription");
  const [displayTranslation, setDisplayTranslation] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (!decoded) return;

    setTab("transcription");
  }, [decoded]);

  if (!media) return null;

  const isVideo = media.mediaType === "Video";

  const options: { value: LeftTab; label: string }[] = [
    { value: "transcription", label: t("transcription") },
    { value: "recordings", label: t("myRecordings") },
    { value: "info", label: t("mediaInfo") },
  ];

  return (
    <div className={cn("h-full min-h-0 flex flex-col", className)}>
      {isVideo && <MediaVideoStage />}

      <div
        className="shrink-0 h-[46px] px-3 flex items-center gap-2 border-b border-ej-line"
        data-testid="media-left-tabs"
      >
        {layout === "compact" && (
          <EjIconButton
            title={t("switchPanel")}
            onClick={() => setDisplayPanel?.("right")}
          >
            <ArrowLeftRightIcon className="size-4" />
          </EjIconButton>
        )}

        <Segmented
          size="sm"
          value={tab}
          onChange={(value) => setTab(value as LeftTab)}
          options={options}
          className="min-w-0 overflow-x-auto"
        />

        <div className="ml-auto shrink-0 flex items-center gap-1">
          <EjIconButton
            title={t("autoScroll")}
            active={autoScroll}
            onClick={() => setAutoScroll(!autoScroll)}
          >
            <MousePointerClickIcon className="size-4" />
          </EjIconButton>

          <EjIconButton
            title={t("captionTabs.translation")}
            active={displayTranslation}
            onClick={() => setDisplayTranslation(!displayTranslation)}
          >
            <LanguagesIcon className="size-4" />
          </EjIconButton>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scroll relative">
        {!isVideo && (
          <div className="hidden">
            <MediaProvider />
          </div>
        )}
        <div className={tab === "recordings" ? "block" : "hidden"}>
          <MediaRecordings />
        </div>
        {tab === "transcription" && (
          <MediaTranscription
            display={autoScroll}
            displayTranslation={displayTranslation}
          />
        )}
        {tab === "info" && <MediaInfo />}
      </div>
    </div>
  );
};
