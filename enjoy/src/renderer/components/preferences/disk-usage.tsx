import { t } from "i18next";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Separator,
  ScrollArea,
  RadioGroup,
  RadioGroupItem,
  Label,
  Progress,
  toast,
} from "@renderer/components/ui";
import { useContext, useEffect, useMemo, useState } from "react";
import { AppSettingsProviderContext } from "@/renderer/context";
import { humanFileSize } from "@/utils";
import { LoaderIcon, Trash2Icon } from "lucide-react";
import { SettingButton, SettingGroup } from "./settings-primitives";

/** The four buckets the bar shows, in the order they are stacked. */
const BUCKETS = [
  { key: "audio", labelKey: "settings.usageAudio", color: "bg-ej-accent", dot: "bg-ej-accent", names: ["audios", "speeches"] },
  { key: "video", labelKey: "settings.usageVideo", color: "bg-ej-ok", dot: "bg-ej-ok", names: ["videos"] },
  { key: "recordings", labelKey: "settings.usageRecordings", color: "bg-ej-warn", dot: "bg-ej-warn", names: ["recordings", "segments"] },
  { key: "cache", labelKey: "settings.usageCache", color: "bg-ej-line2", dot: "bg-ej-line2", names: ["cache", "waveforms", "logs"] },
] as const;

const formatTime = (date: Date) =>
  `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;

export const DiskUsage = () => {
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const [usage, setUsage] = useState<DiskUsageType>([]);
  const [free, setFree] = useState<number>(0);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [pendingRecordings, setPendingRecordings] = useState<number>(0);

  const refresh = () => {
    EnjoyApp.app
      .diskUsage()
      .then((result) => {
        setUsage(result);
        setCheckedAt(new Date());
      })
      .catch((err) => toast.error(err.message));
    EnjoyApp.app.diskFree().then(setFree).catch(() => setFree(0));
    EnjoyApp.recordings
      .statsForDeleteBulk()
      .then((stats) => setPendingRecordings(stats.noAssessment.length))
      .catch(() => setPendingRecordings(0));
  };

  useEffect(refresh, []);

  const { total, sizes } = useMemo(() => {
    const sizeOf = (name: string) =>
      usage.find((item) => item.name === name)?.size || 0;
    const sizes = BUCKETS.map((bucket) =>
      bucket.names.reduce((sum, name) => sum + sizeOf(name), 0)
    );
    // `library` is the parent folder of everything else, counting it would
    // double every byte.
    const total = usage
      .filter((item) => item.name !== "library")
      .reduce((sum, item) => sum + item.size, 0);

    return { total, sizes };
  }, [usage]);

  return (
    <SettingGroup
      title={t("settings.diskUsage")}
      meta={
        checkedAt
          ? t("settings.diskUsageMeta", { time: formatTime(checkedAt) })
          : undefined
      }
    >
      <div className="rounded-ej border border-ej-line bg-ej-surface px-4 py-3.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[22px] font-bold tracking-[-0.01em] text-ej-ink ej-tabular">
            {humanFileSize(total)}
          </span>
          {free > 0 && (
            <span className="text-[11.5px] text-ej-muted">
              {t("settings.freeSpace", { size: humanFileSize(free) })}
            </span>
          )}
        </div>

        <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-[5px] bg-ej-surface2">
          {BUCKETS.map((bucket, index) => (
            <div
              key={bucket.key}
              className={`rounded-sm ${bucket.color}`}
              style={{
                width: total > 0 ? `${(sizes[index] / total) * 100}%` : "0%",
              }}
            />
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {BUCKETS.map((bucket, index) => (
            <div key={bucket.key} className="flex items-center gap-1.5">
              <span className={`size-2 shrink-0 rounded-full ${bucket.dot}`} />
              <span className="text-[11px] text-ej-muted">
                {t(bucket.labelKey)}
              </span>
              <span className="ml-auto text-[12.5px] font-semibold text-ej-ink ej-tabular">
                {humanFileSize(sizes[index])}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ej-line pt-3">
          <span className="text-[11px] text-ej-muted">
            {t("settings.oldRecordings", { count: pendingRecordings })}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <UsageDetail />
            <ReleaseDiskSpace onDeleted={refresh} />
          </div>
        </div>
      </div>
    </SettingGroup>
  );
};

const UsageDetail = () => {
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<DiskUsageType>([]);
  const [loading, setLoading] = useState(false);

  const { EnjoyApp } = useContext(AppSettingsProviderContext);

  const openPath = async (filePath: string) => {
    if (filePath?.match(/.+\.json$/)) {
      await EnjoyApp.shell.openPath(filePath.split("/").slice(0, -1).join("/"));
    } else if (filePath) {
      await EnjoyApp.shell.openPath(filePath);
    }
  };

  useEffect(() => {
    if (open) {
      setLoading(true);
      EnjoyApp.app
        .diskUsage()
        .then((usage) => {
          setUsage(usage);
        })
        .catch((err) => {
          toast.error(err.message);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <SettingButton>{t("settings.usageDetail")}</SettingButton>
      </DialogTrigger>
      <DialogContent className={loading ? "" : "h-3/5"}>
        {loading && (
          <div className="flex items-center justify-center">
            <LoaderIcon className="w-6 h-6 animate-spin" />
          </div>
        )}
        {!loading && (
          <>
            <DialogHeader>
              <DialogTitle>{t("diskUsage")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("diskUsageDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="h-full overflow-hidden">
              <ScrollArea className="h-full px-4">
                <div className="grid gap-4">
                  {usage.map((item) => (
                    <div key={item.name}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-2">
                            <Badge>/{item.path.split("/").pop()}</Badge>
                            <div className="text-sm text-ej-muted">
                              {humanFileSize(item.size)}
                            </div>
                          </div>
                          <div className="text-sm">
                            {t(`libraryDescriptions.${item.name}`)}
                          </div>
                        </div>
                        <Button
                          onClick={() => openPath(item.path)}
                          variant="secondary"
                          size="sm"
                        >
                          {t("open")}
                        </Button>
                      </div>
                      <Separator className="my-2" />
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

const ReleaseDiskSpace = (props: { onDeleted: () => void }) => {
  const [open, setOpen] = useState(false);
  const [abortController, setAbortController] =
    useState<AbortController | null>(null);

  const [deleteBulkType, setDeleteBulkType] = useState("noAssessment");
  const [stats, setStats] = useState<{
    noAssessment: string[];
    scoreLessThan90: string[];
    scoreLessThan80: string[];
    all: string[];
  }>({
    noAssessment: [],
    scoreLessThan90: [],
    scoreLessThan80: [],
    all: [],
  });
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState<string[]>([]);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);

  const refreshStats = () => {
    EnjoyApp.recordings.statsForDeleteBulk().then((s) => {
      setStats(s);
    });
  };

  const handleDestroyBulk = async () => {
    const pendings = stats[deleteBulkType as keyof typeof stats];
    if (pendings.length === 0) {
      toast.warning(t("noRecordingsToDelete"));
      return;
    }

    setDeleting(true);
    const controller = new AbortController();
    setAbortController(controller);

    // seperate pendings into chunks of 100
    const chunks = [];
    for (let i = 0; i < pendings.length; i += 100) {
      chunks.push(pendings.slice(i, i + 100));
    }

    try {
      for (const chunk of chunks) {
        if (controller.signal.aborted) {
          break;
        }
        await EnjoyApp.recordings.destroyBulk({
          ids: chunk,
        });
        setDeleted((prev) => [...prev, ...chunk]);
      }
    } catch (error) {
      if (error.name === "AbortError") {
        toast.warning(t("bulkDeleteAborted"));
      } else {
        toast.error(t(error.message));
      }
    } finally {
      refreshStats();
      props.onDeleted();
      setDeleting(false);
      setAbortController(null);
    }
  };

  useEffect(() => {
    if (open) {
      refreshStats();
    } else {
      setDeleted([]);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      abortController?.abort();
    };
  }, [abortController]);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <SettingButton danger>
          <Trash2Icon className="size-3" />
          {t("settings.freeUp")}
        </SettingButton>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("bulkDeleteRecordings")}</AlertDialogTitle>
          <AlertDialogDescription className="mb-4">
            {t("bulkDeleteRecordingsConfirmation")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <RadioGroup
          className="mb-4"
          value={deleteBulkType}
          onValueChange={(value) => setDeleteBulkType(value)}
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="noAssessment" id="noAssessment" />
            <Label htmlFor="noAssessment">
              {t("deleteRecordingsWithoutAssessment")}(
              {stats.noAssessment.length})
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="scoreLessThan90" id="scoreLessThan90" />
            <Label htmlFor="scoreLessThan90">
              {t("deleteRecordingsWithScoreLessThan90")}(
              {stats.scoreLessThan90.length})
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="scoreLessThan80" id="scoreLessThan80" />
            <Label htmlFor="scoreLessThan80">
              {t("deleteRecordingsWithScoreLessThan80")}(
              {stats.scoreLessThan80.length})
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="all" id="all" />
            <Label htmlFor="all" className="text-ej-bad">
              {t("deleteAllRecordings")}({stats.all.length})
            </Label>
          </div>
        </RadioGroup>
        {deleting && (
          <div className="mb-4">
            <Progress
              value={deleted.length}
              max={stats[deleteBulkType as keyof typeof stats].length}
              className="mb-4"
            />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <Button disabled={deleting} onClick={handleDestroyBulk}>
            {deleting && <LoaderIcon className="w-4 h-4 mr-2 animate-spin" />}
            {deleting ? t("deleting") : t("delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
