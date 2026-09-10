import { useContext } from "react";
import { Link } from "react-router-dom";
import { t } from "i18next";
import {
  ChevronRightIcon,
  DownloadIcon,
  LoaderIcon,
  MoreHorizontalIcon,
  PencilLineIcon,
  CopyIcon,
  SparklesIcon,
  Volume2Icon,
} from "lucide-react";
import { useCopyToClipboard } from "@uidotdev/usehooks";
import { AlignmentResult } from "echogarden/dist/api/API.d.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from "@renderer/components/ui";
import {
  MediaTranscriptionGenerateButton,
  MediaTranscriptionPrint,
  MediaTranscriptionReadButton,
  TranscriptionEditButton,
} from "@renderer/components";
import { EjIconButton, Pill } from "@renderer/components/enjoy";
import {
  AppSettingsProviderContext,
  MediaShadowProviderContext,
} from "@renderer/context";
import { formatDuration } from "@renderer/lib/utils";

/**
 * Sticky header of the shadowing screen: breadcrumb, media meta chips and the
 * transcription/download actions that used to live inside the transcript pane.
 */
export const MediaHeader = () => {
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { media, transcription, transcribing, transcribingProgress } =
    useContext(MediaShadowProviderContext);
  const [_, copyToClipboard] = useCopyToClipboard();

  if (!media) return null;

  const isVideo = media.mediaType === "Video";
  const backTo = isVideo ? "/videos" : "/audios";
  const processing = transcribing || transcription?.state === "processing";
  const transcribed = Boolean(transcription?.result?.timeline);

  const handleCopyFullText = () => {
    if (!transcription?.result) return;

    const fullText = (transcription.result as AlignmentResult).timeline
      .map((s) => s.text)
      .join("\n\n");
    copyToClipboard(fullText);
    toast.success(t("copied"));
  };

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

  return (
    <header className="shrink-0 border-b border-ej-line bg-ej-surface px-5 py-2.5 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xxs text-ej-muted mb-0.5">
          <Link
            to={backTo}
            className="hover:text-ej-accent transition-colors duration-ej"
          >
            {isVideo ? t("sidebar.videos") : t("sidebar.audios")}
          </Link>
          <ChevronRightIcon className="size-3 shrink-0" />
          <span className="truncate">{t("shadowingAudio")}</span>
        </div>

        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-[15px] font-bold text-ej-ink truncate">
            {media.name}
          </h1>

          <div className="flex items-center gap-1.5 shrink-0">
            {media.language && (
              <Pill className="uppercase">{media.language}</Pill>
            )}
            {media.duration > 0 && (
              <Pill className="ej-tabular">
                {formatDuration(media.duration)}
              </Pill>
            )}
            {media.recordingsCount > 0 && (
              <Pill tone="accent" className="ej-tabular">
                {t("media.recordingsCount", { count: media.recordingsCount })}
              </Pill>
            )}
            {processing && (
              <Pill tone="warn" className="ej-tabular">
                <LoaderIcon className="size-3 animate-spin mr-1" />
                {transcribingProgress > 0
                  ? `${transcribingProgress}%`
                  : t("media.transcribing")}
              </Pill>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {transcribed && (
          <MediaTranscriptionReadButton>
            <EjIconButton title={t("readThrough")}>
              <Volume2Icon className="size-4" />
            </EjIconButton>
          </MediaTranscriptionReadButton>
        )}

        <EjIconButton title={t("download")} onClick={handleDownload}>
          <DownloadIcon className="size-4" />
        </EjIconButton>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <EjIconButton title={t("more")}>
              <MoreHorizontalIcon className="size-4" />
            </EjIconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <MediaTranscriptionGenerateButton>
              <DropdownMenuItem
                disabled={processing}
                onSelect={(event) => event.preventDefault()}
              >
                <SparklesIcon className="size-4 mr-2" />
                {transcription?.result ? t("regenerate") : t("transcribe")}
              </DropdownMenuItem>
            </MediaTranscriptionGenerateButton>

            {transcribed && (
              <TranscriptionEditButton>
                <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                  <PencilLineIcon className="size-4 mr-2" />
                  {t("edit")}
                </DropdownMenuItem>
              </TranscriptionEditButton>
            )}

            {transcribed && (
              <>
                <DropdownMenuSeparator />

                <DropdownMenuItem onClick={handleCopyFullText}>
                  <CopyIcon className="size-4 mr-2" />
                  {t("copyFullText")}
                </DropdownMenuItem>

                <DropdownMenuItem asChild>
                  <MediaTranscriptionPrint />
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};
