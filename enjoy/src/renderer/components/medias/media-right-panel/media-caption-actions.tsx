import { useContext, useState } from "react";
import { t } from "i18next";
import {
  BotIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  MoreHorizontalIcon,
  NotebookPenIcon,
} from "lucide-react";
import {
  AppSettingsProviderContext,
  MediaShadowProviderContext,
} from "@renderer/context";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  toast,
} from "@renderer/components/ui";
import { ConversationShortcuts } from "@renderer/components";
import { EjIconButton } from "@renderer/components/enjoy";
import { TimelineEntry } from "echogarden/dist/utilities/Timeline.d.js";
import { convertWordIpaToNormal } from "@/utils";
import { useCopyToClipboard } from "@uidotdev/usehooks";
import { cn } from "@renderer/lib/utils";

const MenuItem = (props: {
  icon: React.ReactNode;
  label: string;
  checked?: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={props.onClick}
    className="flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-[7px] text-left text-[12.5px] text-ej-ink transition-colors duration-ej hover:bg-ej-surface2"
  >
    <span className="shrink-0 text-ej-ink2">{props.icon}</span>
    <span className="min-w-0 flex-1 truncate">{props.label}</span>
    {props.checked && <CheckIcon className="size-3.5 shrink-0 text-ej-accent" />}
  </button>
);

/**
 * Overflow menu of the sentence toolbar: copying, sending to the assistant,
 * exporting the segment and the note markers.
 */
export const MediaCaptionActions = (props: {
  caption: TimelineEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayIpa: boolean;
  markNotedWords: boolean;
  setMarkNotedWords: (value: boolean) => void;
}) => {
  const {
    caption,
    open,
    onOpenChange,
    displayIpa,
    markNotedWords,
    setMarkNotedWords,
  } = props;
  const { media, currentSegment, createSegment, transcription, activeRegion } =
    useContext(MediaShadowProviderContext);
  const { EnjoyApp, learningLanguage, ipaMappings } = useContext(
    AppSettingsProviderContext
  );
  const [_, copyToClipboard] = useCopyToClipboard();
  const [sending, setSending] = useState<boolean>(false);

  const handleCopy = () => {
    if (displayIpa) {
      const text = caption.timeline
        .map((word) => {
          const ipas = word.timeline.map((entry) =>
            entry.timeline.map((phoneme) => phoneme.text).join("")
          );
          return `${word.text}(${
            (transcription.language || learningLanguage).startsWith("en")
              ? convertWordIpaToNormal(ipas, { mappings: ipaMappings }).join("")
              : ipas.join("")
          })`;
        })
        .join(" ");

      copyToClipboard(text);
    } else {
      copyToClipboard(caption.text);
    }

    toast.success(t("copied"));
    onOpenChange(false);
  };

  const handleDownload = async () => {
    onOpenChange(false);

    if (activeRegion && !activeRegion.id.startsWith("segment-region")) {
      handleDownloadActiveRegion();
    } else {
      handleDownloadSegment();
    }
  };

  const handleDownloadSegment = async () => {
    const segment = currentSegment || (await createSegment());
    if (!segment) return;

    EnjoyApp.dialog
      .showSaveDialog({
        title: t("download"),
        defaultPath: `${media.name}(${segment.startTime.toFixed(
          2
        )}s-${segment.endTime.toFixed(2)}s).mp3`,
        filters: [
          {
            name: "Audio",
            extensions: ["mp3"],
          },
        ],
      })
      .then((savePath) => {
        if (!savePath) return;

        toast.promise(EnjoyApp.download.start(segment.src, savePath as string), {
          loading: t("downloadingFile", { file: media.filename }),
          success: () => t("downloadedSuccessfully"),
          error: t("downloadFailed"),
          position: "bottom-right",
        });
      })
      .catch((err) => {
        console.error(err);
        toast.error(err.message);
      });
  };

  const handleDownloadActiveRegion = async () => {
    if (!activeRegion) return;
    let src: string;

    try {
      if (media.mediaType === "Audio") {
        src = await EnjoyApp.audios.crop(media.id, {
          startTime: activeRegion.start,
          endTime: activeRegion.end,
        });
      } else if (media.mediaType === "Video") {
        src = await EnjoyApp.videos.crop(media.id, {
          startTime: activeRegion.start,
          endTime: activeRegion.end,
        });
      }
    } catch (err) {
      console.error(err);
      toast.error(`${t("downloadFailed")}: ${err.message}`);
    }

    if (!src) return;

    EnjoyApp.dialog
      .showSaveDialog({
        title: t("download"),
        defaultPath: `${media.name}(${activeRegion.start.toFixed(
          2
        )}s-${activeRegion.end.toFixed(2)}s).mp3`,
        filters: [
          {
            name: "Audio",
            extensions: ["mp3"],
          },
        ],
      })
      .then((savePath) => {
        if (!savePath) return;

        toast.promise(EnjoyApp.download.start(src, savePath as string), {
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

  if (!transcription) return null;
  if (!caption) return null;

  return (
    <>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <EjIconButton
            aria-label={t("more")}
            className={cn(open && "bg-ej-surface2 text-ej-ink")}
          >
            <MoreHorizontalIcon className="size-4" />
          </EjIconButton>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          className="w-[216px] animate-rise rounded-[10px] border-ej-line bg-ej-surface p-[5px] shadow-ej"
        >
          <MenuItem
            icon={<CopyIcon className="size-[15px]" />}
            label={t("segment.copySentence")}
            onClick={handleCopy}
          />
          <MenuItem
            icon={<BotIcon className="size-[15px]" />}
            label={t("segment.sendToAssistant")}
            onClick={() => {
              onOpenChange(false);
              setSending(true);
            }}
          />
          <MenuItem
            icon={<DownloadIcon className="size-[15px]" />}
            label={t("segment.downloadSegment")}
            onClick={handleDownload}
          />
          <MenuItem
            icon={<NotebookPenIcon className="size-[15px]" />}
            label={t("segment.markNotedWords")}
            checked={markNotedWords}
            onClick={() => setMarkNotedWords(!markNotedWords)}
          />
        </PopoverContent>
      </Popover>

      <ConversationShortcuts
        open={sending}
        onOpenChange={setSending}
        prompt={caption.text as string}
        title={t("segment.sendToAssistant")}
        trigger={<span className="hidden" />}
      />
    </>
  );
};
