import { useEffect, useContext, useRef, useState } from "react";
import {
  AppSettingsProviderContext,
  MediaShadowProviderContext,
} from "@renderer/context";
import { formatDuration } from "@renderer/lib/utils";
import { t } from "i18next";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuContent,
  Button,
  toast,
} from "@renderer/components/ui";
import {
  GalleryHorizontalIcon,
  SpellCheckIcon,
  MinimizeIcon,
  ZoomInIcon,
  ZoomOutIcon,
  MoreHorizontalIcon,
  DownloadIcon,
} from "lucide-react";
import debounce from "lodash/debounce";

const ZOOM_RATIO_OPTIONS = [
  0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 3.5, 4.0,
];
const MIN_ZOOM_RATIO = 0.25;
const MAX_ZOOM_RATIO = 4.0;
const ACTION_BUTTON_HEIGHT = 35;

export const MediaWaveform = () => {
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const {
    media,
    currentTime,
    setWaveformContainerRef,
    pitchChart,
    wavesurfer,
    zoomRatio,
    setZoomRatio,
    fitZoomRatio,
  } = useContext(MediaShadowProviderContext);
  const [displayInlineCaption, setDisplayInlineCaption] =
    useState<boolean>(true);
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [actionButtonsCount, setActionButtonsCount] = useState(0);

  const ref = useRef(null);

  const calContainerSize = () => {
    const size = ref?.current
      ?.closest(".media-player-wrapper")
      ?.getBoundingClientRect();
    if (!size) return;

    setSize({ width: size.width, height: size.height });
    if (wavesurfer) {
      wavesurfer.setOptions({
        height: size.height - 10,
      });
    }

    setActionButtonsCount(Math.floor(size.height / ACTION_BUTTON_HEIGHT));
  };

  const debouncedCalContainerSize = debounce(calContainerSize, 100);

  const handleDownload = () => {
    EnjoyApp.dialog
      .showSaveDialog({
        title: t("download"),
        defaultPath: media.filename,
        filters: [
          {
            name: media.mediaType,
            extensions: [media.filename.split(".").pop()],
          },
        ],
      })
      .then((savePath) => {
        if (!savePath) return;

        toast.promise(EnjoyApp.download.start(media.src, savePath as string), {
          loading: t("downloadingFile", { file: media.filename }),
          success: () => t("downloadedSuccessfully"),
          error: t("downloadFailed"),
          position: "bottom-right",
        });
      })
      .catch((err) => {
        toast.error(err.message);
      });
  };

  useEffect(() => {
    if (!ref?.current) return;

    setWaveformContainerRef(ref);

    if (!wavesurfer) return;

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
  }, [ref, wavesurfer]);

  const Actions = [
    {
      name: "zoomToFit",
      label: t("zoomToFit"),
      icon: MinimizeIcon,
      active: zoomRatio == fitZoomRatio,
      onClick: () => {
        if (zoomRatio == fitZoomRatio) {
          setZoomRatio(1.0);
        } else {
          setZoomRatio(fitZoomRatio);
        }
      },
    },
    {
      name: "zoomIn",
      label: t("zoomIn"),
      icon: ZoomInIcon,
      active: zoomRatio > 1.0,
      onClick: () => {
        if (zoomRatio < MAX_ZOOM_RATIO) {
          const nextZoomRatio = ZOOM_RATIO_OPTIONS.find(
            (rate) => rate > zoomRatio
          );
          setZoomRatio(nextZoomRatio || MAX_ZOOM_RATIO);
        }
      },
    },
    {
      name: "zoomOut",
      label: t("zoomOut"),
      icon: ZoomOutIcon,
      active: zoomRatio < 1.0,
      onClick: () => {
        if (zoomRatio > MIN_ZOOM_RATIO) {
          const nextZoomRatio = ZOOM_RATIO_OPTIONS.reverse().find(
            (rate) => rate < zoomRatio
          );
          setZoomRatio(nextZoomRatio || MIN_ZOOM_RATIO);
        }
      },
    },
    {
      name: "inlineCaption",
      label: t("inlineCaption"),
      icon: SpellCheckIcon,
      active: displayInlineCaption,
      onClick: () => {
        setDisplayInlineCaption(!displayInlineCaption);
        if (pitchChart) {
          pitchChart.options.scales.x.display = !displayInlineCaption;
          pitchChart.update();
        }
      },
    },
    {
      name: "autoCenter",
      label: t("autoCenter"),
      icon: GalleryHorizontalIcon,
      active: wavesurfer?.options?.autoCenter,
      onClick: () => {
        wavesurfer.setOptions({
          autoCenter: !wavesurfer?.options?.autoCenter,
        });
      },
    },
    {
      name: "download",
      label: t("download"),
      icon: DownloadIcon,
      onClick: handleDownload,
    },
  ];

  return (
    <div
      ref={ref}
      className="flex h-full media-player-wrapper border border-ej-line rounded-ej bg-ej-surface2/30 overflow-hidden"
    >
      <div
        data-testid="media-player-container"
        className="flex-1 relative media-player-container overflow-hidden"
      >
        <div
          style={{
            width: `${size?.width - 40}px`, // -40 for action buttons
            height: `${size?.height}px`,
          }}
          className="waveform-container"
        />
        <div className="absolute right-2 top-1 rounded-full bg-ej-surface/85 px-2 py-0.5 text-xxs ej-tabular text-ej-muted">
          <span>{formatDuration(currentTime || 0)}</span>
          <span className="mx-1">/</span>
          <span>{formatDuration(media?.duration || 0)}</span>
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
            variant={`${action.active ? "secondary" : "ghost"}`}
            data-tooltip-id="media-shadow-tooltip"
            data-tooltip-content={action.label}
            data-tooltip-place="left"
            className="relative p-0 w-full h-full rounded-none"
            onClick={action.onClick}
          >
            <action.icon className="w-4 h-4" />
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
                data-tooltip-place="left"
                className="relative p-0 w-full h-full rounded-none"
              >
                <MoreHorizontalIcon className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent>
              {Actions.slice(actionButtonsCount).map((action) => (
                <DropdownMenuItem
                  key={action.name}
                  className="cursor-pointer"
                  onClick={action.onClick}
                >
                  <action.icon className="w-4 h-4 mr-2" />
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

      </div>
    </div>
  );
};
