import {
  AppSettingsProviderContext,
  MediaShadowProviderContext,
} from "@renderer/context";
import { useContext, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ScrollArea,
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  toast,
} from "@renderer/components/ui";
import { TimelineEntry } from "echogarden/dist/utilities/Timeline.d.js";
import { t } from "i18next";
import {
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  GaugeCircleIcon,
  MicIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react";
import { useRecordings } from "@renderer/hooks";
import { EjButton, EjIconButton } from "@renderer/components/enjoy";
import { formatDateTime, cn } from "@renderer/lib/utils";
import { scoreColor } from "@renderer/lib/design";
import {
  LoaderSpin,
  MediaCaption,
  RecordingDetail,
  WavesurferPlayer,
} from "@renderer/components";
import { splitCaptionWords } from "@renderer/components/medias/media-right-panel/caption-words";
import { LiveAudioVisualizer } from "react-audio-visualize";

export const MediaTranscriptionReadButton = (props: {
  children: React.ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const { media, transcription, setRecordingType } = useContext(
    MediaShadowProviderContext
  );

  useEffect(() => {
    if (open) {
      setRecordingType("transcription");
    } else {
      setRecordingType("segment");
    }
  }, [open]);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          {props.children ? (
            props.children
          ) : (
            <EjButton variant="secondary" size="sm" className="hidden lg:inline-flex">
              {t("readThrough")}
            </EjButton>
          )}
        </DialogTrigger>
        <DialogContent
          onPointerDownOutside={(event) => event.preventDefault()}
          className="flex h-5/6 max-w-screen-md flex-col border-ej-line bg-ej-bg p-0 shadow-ej xl:max-w-screen-lg"
        >
          <DialogTitle className="hidden">{t("readThrough")}</DialogTitle>
          <ScrollArea className="flex-1 px-6 pt-4">
            <div className="select-text mx-auto w-full max-w-prose">
              <h3 className="my-4 text-xl font-bold tracking-[-0.02em] text-ej-ink">
                {media.name}
              </h3>
              {open &&
                transcription.result.timeline.map(
                  (sentence: TimelineEntry, index: number) => (
                    <div key={index} className="flex flex-start space-x-2 mb-4">
                      <span className="min-w-max text-xs leading-8 text-ej-muted">
                        #{index + 1}
                      </span>
                      <MediaCaption
                        caption={sentence}
                        words={splitCaptionWords(sentence)}
                        currentSegmentIndex={index}
                        displayIpa={true}
                      />
                    </div>
                  )
                )}
            </div>
            <div className="mt-12">
              {open && <TranscriptionRecordingsList />}
            </div>
          </ScrollArea>
          <div className="h-16 border-t border-ej-line bg-ej-surface">
            {open && <RecorderButton />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

const TranscriptionRecordingsList = () => {
  const [deleting, setDeleting] = useState<RecordingType>(null);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const { media } = useContext(MediaShadowProviderContext);
  const [assessing, setAssessing] = useState<RecordingType>();

  const handleDelete = () => {
    if (!deleting) return;

    EnjoyApp.recordings.destroy(deleting.id);
  };

  const handleDownload = (recording: RecordingType) => {
    EnjoyApp.dialog
      .showSaveDialog({
        title: t("download"),
        defaultPath: recording.filename,
        filters: [
          {
            name: "Audio",
            extensions: [recording.filename.split(".").pop()],
          },
        ],
      })
      .then((savePath) => {
        if (!savePath) return;

        toast.promise(
          EnjoyApp.download.start(recording.src, savePath as string),
          {
            loading: t("downloadingFile", { file: recording.filename }),
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

  const { recordings, loading: loadingRecordings } = useRecordings(media, -1);

  if (loadingRecordings) {
    return <LoaderSpin />;
  }

  return (
    <div>
      {recordings.map((recording) => (
        <div
          key={recording.id}
          className="mx-auto w-full max-w-prose px-4 mb-4"
          id={recording.id}
        >
          <div className="flex items-center justify-end space-x-2 mb-2">
            <span className="text-xxs text-ej-muted">
              {formatDateTime(recording.createdAt)}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <EjIconButton size={24} aria-label={t("more")}>
                  <MoreHorizontalIcon className="size-3.5" />
                </EjIconButton>
              </DropdownMenuTrigger>

              <DropdownMenuContent>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => handleDownload(recording)}
                >
                  <DownloadIcon className="mr-2 size-3.5" />
                  <span>{t("download")}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => setAssessing(recording)}
                >
                  <GaugeCircleIcon
                    className="mr-2 size-3.5"
                    style={{
                      color: recording.pronunciationAssessment
                        ? scoreColor(
                            recording.pronunciationAssessment
                              .pronunciationScore
                          )
                        : undefined,
                    }}
                  />
                  <span>{t("pronunciationAssessment")}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer text-ej-bad"
                  onClick={() => setDeleting(recording)}
                >
                  <Trash2Icon className="mr-2 size-3.5" />
                  <span>{t("delete")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <WavesurferPlayer id={recording.id} src={recording.src} />
        </div>
      ))}

      <Sheet
        open={Boolean(assessing)}
        onOpenChange={(open) => {
          if (!open) setAssessing(undefined);
        }}
      >
        <SheetContent
          aria-describedby={undefined}
          side="bottom"
          className="max-h-content overflow-y-scroll rounded-t-[18px] border-ej-line bg-ej-bg shadow-ej"
          displayClose={false}
        >
          <SheetHeader className="-mt-4 mb-2 flex items-center justify-center">
            <SheetClose asChild>
              <EjIconButton aria-label={t("close")}>
                <ChevronDownIcon className="size-4" />
              </EjIconButton>
            </SheetClose>
          </SheetHeader>

          {assessing && <RecordingDetail recording={assessing} />}
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={!!deleting}
        onOpenChange={(value) => {
          if (value) return;
          setDeleting(null);
        }}
      >
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-bold text-ej-ink">
              {t("deleteRecording")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-ej-muted">
              {t("deleteRecordingConfirmation")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-ej-bad hover:opacity-90"
              onClick={handleDelete}
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const RecorderButton = () => {
  const {
    isRecording,
    isPaused,
    togglePauseResume,
    startRecording,
    cancelPendingRecording,
    stopRecording,
    mediaRecorder,
    recordingTime,
  } = useContext(MediaShadowProviderContext);
  const recordingRef = useRef(isRecording);
  recordingRef.current = isRecording;

  useEffect(() => {
    return () => {
      if (!recordingRef.current) cancelPendingRecording();
    };
  }, []);

  if (isRecording) {
    return (
      <div className="flex h-16 items-center justify-center px-6">
        <div className="flex items-center gap-2">
          <LiveAudioVisualizer
            mediaRecorder={mediaRecorder}
            barWidth={2}
            gap={2}
            width={250}
            height={30}
            fftSize={512}
            maxDecibels={-10}
            minDecibels={-80}
            smoothingTimeConstant={0.4}
          />
          <span className="font-code text-xs tabular-nums text-ej-muted">
            {Math.floor(recordingTime / 60)}:
            {String(recordingTime % 60).padStart(2, "0")}
          </span>
          <button
            type="button"
            onClick={togglePauseResume}
            className="inline-flex size-8 items-center justify-center rounded-full bg-ej-ink text-ej-bg shadow-ej transition-opacity duration-ej hover:opacity-90"
          >
            {isPaused ? (
              <PlayIcon
                data-tooltip-id="media-shadow-tooltip"
                data-tooltip-content={t("continue")}
                fill="currentColor"
                className="size-4"
              />
            ) : (
              <PauseIcon
                data-tooltip-id="media-shadow-tooltip"
                data-tooltip-content={t("pause")}
                fill="currentColor"
                className="size-4"
              />
            )}
          </button>
          <button
            type="button"
            data-tooltip-id="media-shadow-tooltip"
            data-tooltip-content={t("finish")}
            onClick={stopRecording}
            className="inline-flex size-8 items-center justify-center rounded-full bg-ej-ok text-white shadow-ej transition-opacity duration-ej hover:opacity-90"
          >
            <CheckIcon className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-16 items-center justify-center px-6">
      <button
        type="button"
        data-testid="media-transcription-record-button"
        className={cn(
          "inline-flex size-12 items-center justify-center rounded-full",
          "bg-ej-bad text-white shadow-ej transition-opacity duration-ej",
          "hover:opacity-90"
        )}
        onClick={() => startRecording()}
      >
        <MicIcon className="size-6" />
      </button>
    </div>
  );
};
