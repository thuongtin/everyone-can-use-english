import { useContext, useRef, useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogHeader,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogTrigger,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuContent,
  toast,
  RadioGroup,
  RadioGroupItem,
  Label,
} from "@renderer/components/ui";
import { EjButton, EjIconButton } from "@renderer/components/enjoy";
import {
  AppSettingsProviderContext,
  HotKeysSettingsProviderContext,
  MediaShadowProviderContext,
} from "@renderer/context";
import {
  MicIcon,
  MoreHorizontalIcon,
  SquareMenuIcon,
  Trash2Icon,
} from "lucide-react";
import { t } from "i18next";
import { formatDateTime, formatDuration, cn } from "@renderer/lib/utils";
import { scoreChipClass } from "@renderer/lib/design";

export const MediaRecordings = () => {
  const { currentHotkeys } = useContext(HotKeysSettingsProviderContext);
  const containerRef = useRef<HTMLDivElement>();
  const {
    recordings = [],
    currentRecording,
    setCurrentRecording,
    currentSegmentIndex,
    transcription,
    media,
  } = useContext(MediaShadowProviderContext);

  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const [selectedRecording, setSelectedRecording] = useState(null);
  const [deleteBulkType, setDeleteBulkType] = useState("noAssessments");

  const handleDelete = () => {
    if (!selectedRecording) return;

    EnjoyApp.recordings.destroy(selectedRecording.id).catch((err) => {
      toast.error(err.message);
    });
  };

  const recordingsWithoutAssessment = recordings.filter(
    (r) => !r.pronunciationAssessment
  );
  const recordingsWithScoreLessThan90 = recordings.filter(
    (r) =>
      !r.pronunciationAssessment ||
      r.pronunciationAssessment.pronunciationScore < 90
  );
  const recordingsWithScoreLessThan80 = recordings.filter(
    (r) =>
      !r.pronunciationAssessment ||
      r.pronunciationAssessment.pronunciationScore < 80
  );

  const handleDestroyBulk = () => {
    let ids: string[] = [];
    if (deleteBulkType === "noAssessments") {
      ids = recordingsWithoutAssessment.map((r) => r.id);
    } else if (deleteBulkType === "scoreLessThan90") {
      ids = recordingsWithScoreLessThan90.map((r) => r.id);
    } else if (deleteBulkType === "scoreLessThan80") {
      ids = recordingsWithScoreLessThan80.map((r) => r.id);
    } else if (deleteBulkType === "all") {
      ids = recordings.map((r) => r.id);
    }

    if (ids.length === 0) {
      toast.error(t("noRecordingsToDelete"));
      return;
    }

    EnjoyApp.recordings
      .destroyBulk({
        ids,
        targetId: media.id,
        targetType: media.mediaType,
      })
      .then(() => {
        toast.success(t("recordingsDeletedSuccessfully"));
      })
      .catch((err) => {
        toast.error(err.message);
      });
  };

  const handleExport = async () => {
    try {
      const url = await EnjoyApp.recordings.export(media.id, media.mediaType);
      const filename = `Recording(${media.name}).mp3`;

      EnjoyApp.dialog
        .showSaveDialog({
          title: t("download"),
          defaultPath: filename,
          filters: [
            {
              name: "Audio",
              extensions: ["mp3"],
            },
          ],
        })
        .then((savePath) => {
          if (!savePath) return;

          toast.promise(EnjoyApp.download.start(url, savePath as string), {
            loading: t("downloadingFile", { file: filename }),
            success: () => t("downloadedSuccessfully"),
            error: t("downloadFailed"),
            position: "bottom-right",
          });
        })
        .catch((err) => {
          if (err) toast.error(err.message);
        });
    } catch (error) {
      toast.error(error.message);
    }
  };

  useEffect(() => {
    setCurrentRecording(recordings[0]);
  }, [currentSegmentIndex, recordings]);

  return (
    <div ref={containerRef} data-testid="media-recordings-result">
      <div className="mb-1.5 flex items-center justify-between gap-2 px-4">
        <span className="ej-label">
          #{currentSegmentIndex + 1}/{transcription?.result?.timeline?.length}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <EjIconButton aria-label={t("more")}>
              <SquareMenuIcon className="size-4" />
            </EjIconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <EjButton
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                  >
                    {t("export")}
                  </EjButton>
                </AlertDialogTrigger>
                <AlertDialogContent aria-describedby={undefined}>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-base font-bold text-ej-ink">
                      {t("exportRecordings")}
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-xs text-ej-muted">
                      {t("exportRecordingsConfirmation")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={handleExport}>
                      {t("export")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <EjButton
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                  >
                    {t("bulkDelete")}
                  </EjButton>
                </AlertDialogTrigger>
                <AlertDialogContent aria-describedby={undefined}>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-base font-bold text-ej-ink">
                      {t("bulkDelete")}
                    </AlertDialogTitle>
                    <AlertDialogDescription className="mb-3 text-xs text-ej-muted">
                      {t("bulkDeleteRecordingsConfirmation")}
                    </AlertDialogDescription>
                    <RadioGroup
                      value={deleteBulkType}
                      onValueChange={(value) => setDeleteBulkType(value)}
                      className="gap-2"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem
                          value="noAssessments"
                          id="noAssessments"
                        />
                        <Label
                          htmlFor="noAssessments"
                          className="text-xs font-normal text-ej-ink"
                        >
                          {t("deleteRecordingsWithoutAssessment")}(
                          {recordingsWithoutAssessment.length})
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem
                          value="scoreLessThan90"
                          id="scoreLessThan90"
                        />
                        <Label
                          htmlFor="scoreLessThan90"
                          className="text-xs font-normal text-ej-ink"
                        >
                          {t("deleteRecordingsWithScoreLessThan90")}(
                          {recordingsWithScoreLessThan90.length})
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem
                          value="scoreLessThan80"
                          id="scoreLessThan80"
                        />
                        <Label
                          htmlFor="scoreLessThan80"
                          className="text-xs font-normal text-ej-ink"
                        >
                          {t("deleteRecordingsWithScoreLessThan80")}(
                          {recordingsWithScoreLessThan80.length})
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="all" id="all" />
                        <Label
                          htmlFor="all"
                          className="text-xs font-normal text-ej-bad"
                        >
                          {t("deleteAllRecordings")}({recordings.length})
                        </Label>
                      </div>
                    </RadioGroup>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-ej-bad hover:opacity-90"
                      onClick={handleDestroyBulk}
                    >
                      {t("delete")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {recordings.length == 0 && (
        <div
          className="px-6 py-8 text-center text-xs leading-relaxed text-ej-muted"
          dangerouslySetInnerHTML={{
            __html: t("noRecordingForThisSegmentYet", {
              key: currentHotkeys.StartOrStopRecording?.toUpperCase(),
            }),
          }}
        ></div>
      )}

      <div className="flex flex-col gap-1 px-2">
        {recordings.map((recording) => {
          const score =
            recording.pronunciationAssessment?.result &&
            recording.pronunciationAssessment.pronunciationScore;

          return (
            <div
              key={recording.id}
              role="button"
              tabIndex={0}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-2 rounded-ej border px-2.5 py-2",
                "transition-colors duration-ej",
                recording.id === currentRecording?.id
                  ? "border-ej-accent bg-ej-accent-soft"
                  : "border-transparent hover:bg-ej-surface2"
              )}
              style={{
                // The md5 stripe keeps each take visually identifiable.
                borderLeftColor: `#${recording.md5.substr(0, 6)}`,
                borderLeftWidth: 3,
              }}
              onClick={() => {
                setCurrentRecording(recording);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                setCurrentRecording(recording);
              }}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <MicIcon
                  className={cn(
                    "size-3.5 shrink-0",
                    recording.id === currentRecording?.id
                      ? "text-ej-accent-ink"
                      : "text-ej-muted"
                  )}
                />
                <span className="truncate text-xs font-semibold text-ej-ink">
                  {formatDuration(recording.duration, "ms")}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {typeof score === "number" && (
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-xxs font-bold tabular-nums",
                      scoreChipClass(score)
                    )}
                  >
                    {score}
                  </span>
                )}
                <span className="text-xxs text-ej-muted">
                  {formatDateTime(recording.createdAt)}
                </span>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <EjIconButton size={22} aria-label={t("more")}>
                      <MoreHorizontalIcon className="size-3.5" />
                    </EjIconButton>
                  </DropdownMenuTrigger>

                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="cursor-pointer text-ej-bad"
                      onClick={() => setSelectedRecording(recording)}
                    >
                      <Trash2Icon className="mr-2 size-3.5" />
                      <span>{t("delete")}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          );
        })}
      </div>

      <AlertDialog
        open={Boolean(selectedRecording)}
        onOpenChange={(value) => {
          if (value) return;
          setSelectedRecording(null);
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
