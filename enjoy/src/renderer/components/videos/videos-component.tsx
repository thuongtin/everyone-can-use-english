import { useEffect, useState, useReducer, useContext } from "react";
import {
  VideoCard,
  MediaAddButton,
  MediaTable,
  VideoEditForm,
  LoaderSpin,
} from "@renderer/components";
import { t } from "i18next";
import {
  Button,
  AlertDialog,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  toast,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
  DialogDescription,
  AlertDialogTrigger,
} from "@renderer/components/ui";
import {
  DbProviderContext,
  AppSettingsProviderContext,
} from "@renderer/context";
import { LayoutGridIcon, LayoutListIcon } from "lucide-react";
import {
  EJ_CONTROL_CLASS,
  EjEmptyState,
  EjMediaGrid,
  EjPageHeader,
  EjSearchInput,
  EjToolbar,
  Segmented,
} from "@renderer/components/enjoy";
import { videosReducer } from "@renderer/reducers";
import { useDebounce } from "@uidotdev/usehooks";
import { LANGUAGES } from "@/constants";

export const VideosComponent = () => {
  const { addDblistener, removeDbListener } = useContext(DbProviderContext);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);

  const [videos, dispatchVideos] = useReducer(videosReducer, []);
  const [hasMore, setHasMore] = useState(true);

  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState<string | null>("all");
  const [orderBy, setOrderBy] = useState<string | null>("updatedAtDesc");
  const debouncedQuery = useDebounce(query, 500);

  const [editing, setEditing] = useState<Partial<VideoType> | null>(null);
  const [deleting, setDeleting] = useState<Partial<VideoType> | null>(null);
  const [loading, setLoading] = useState(false);

  const [tab, setTab] = useState("grid");

  useEffect(() => {
    addDblistener(onVideosUpdate);

    return () => {
      removeDbListener(onVideosUpdate);
    };
  }, []);

  useEffect(() => {
    EnjoyApp.cacheObjects.get("videos-page-tab").then((value) => {
      if (value) {
        setTab(value);
      }
    });
  }, []);

  useEffect(() => {
    EnjoyApp.cacheObjects.set("videos-page-tab", tab);
  }, [tab]);

  const fetchVideos = async (options?: { offset: number }) => {
    if (loading) return;
    const { offset = videos.length } = options || {};

    setLoading(true);
    const limit = 20;

    let order = [];
    switch (orderBy) {
      case "updatedAtDesc":
        order = [["updatedAt", "DESC"]];
        break;
      case "createdAtDesc":
        order = [["createdAt", "DESC"]];
        break;
      case "createdAtAsc":
        order = [["createdAt", "ASC"]];
        break;
      case "recordingsDurationDesc":
        order = [["recordingsDuration", "DESC"]];
        break;
      case "recordingsCountDesc":
        order = [["recordingsCount", "DESC"]];
        break;
      default:
        order = [["updatedAt", "DESC"]];
    }
    let where = {};
    if (language != "all") {
      where = { language };
    }

    EnjoyApp.videos
      .findAll({
        offset,
        limit,
        order,
        where,
        query: debouncedQuery,
      })
      .then((_videos) => {
        setHasMore(_videos.length >= limit);

        if (offset === 0) {
          dispatchVideos({ type: "set", records: _videos });
        } else {
          dispatchVideos({ type: "append", records: _videos });
        }
      })
      .catch((err) => {
        toast.error(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const onVideosUpdate = (event: CustomEvent) => {
    const { record, action, model } = event.detail || {};
    if (!record) return;

    if (model === "Video") {
      if (action === "destroy") {
        dispatchVideos({ type: "destroy", record });
      } else if (action === "create") {
        dispatchVideos({ type: "create", record });
      } else if (action === "update") {
        dispatchVideos({ type: "update", record });
      }
    } else if (model === "Transcription" && action === "update") {
      dispatchVideos({
        type: "update",
        record: {
          id: record.targetId,
          transcribing: record.state === "processing",
          transcribed: record.state === "finished",
        },
      });
    }
  };

  useEffect(() => {
    fetchVideos({ offset: 0 });
  }, [debouncedQuery, language, orderBy]);

  return (
    <>
      <EjPageHeader
        title={t("library.videos")}
        description={t("library.videosDescription")}
        actions={
          <>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="secondary" size="sm">
                  {t("cleanUp")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>{t("cleanUp")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("cleanUpConfirmation")}
                </AlertDialogDescription>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      EnjoyApp.videos
                        .cleanUp()
                        .then(() => toast.success(t("cleanedUpSuccessfully")))
                    }
                  >
                    {t("confirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <MediaAddButton type="Video" />
          </>
        }
      />

      <EjToolbar>
        <EjSearchInput
          value={query}
          onChange={setQuery}
          placeholder={t("library.searchPlaceholder")}
        />

        <Select value={language} onValueChange={setLanguage}>
          <SelectTrigger className={`${EJ_CONTROL_CLASS} w-[128px]`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">{t("allLanguages")}</SelectItem>
              {LANGUAGES.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  {lang.code}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select value={orderBy} onValueChange={setOrderBy}>
          <SelectTrigger className={`${EJ_CONTROL_CLASS} w-[176px]`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="updatedAtDesc">{t("updatedAtDesc")}</SelectItem>
              <SelectItem value="createdAtDesc">{t("createdAtDesc")}</SelectItem>
              <SelectItem value="createdAtAsc">{t("createdAtAsc")}</SelectItem>
              <SelectItem value="recordingsDurationDesc">
                {t("recordingsDurationDesc")}
              </SelectItem>
              <SelectItem value="recordingsCountDesc">
                {t("recordingsCountDesc")}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-ej-muted ej-tabular">
            {t("library.itemsCount", { count: videos.length })}
          </span>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              {
                value: "grid",
                title: t("library.gridView"),
                label: <LayoutGridIcon className="size-3.5" />,
              },
              {
                value: "list",
                title: t("library.listView"),
                label: <LayoutListIcon className="size-3.5" />,
              },
            ]}
          />
        </div>
      </EjToolbar>

      {videos.length === 0 ? (
        loading ? (
          <LoaderSpin />
        ) : (
          <EjEmptyState
            title={t("library.empty")}
            description={t("library.emptyDescription")}
            actions={<MediaAddButton type="Video" />}
          />
        )
      ) : tab === "grid" ? (
        <EjMediaGrid wide>
          {videos.map((video) => (
            <VideoCard
              video={video}
              key={video.id}
              onEdit={() => setEditing(video)}
              onDelete={() => setDeleting(video)}
            />
          ))}
        </EjMediaGrid>
      ) : (
        <MediaTable
          kind="videos"
          items={videos}
          onEdit={(video) => setEditing(video)}
          onDelete={(video) => setDeleting(video)}
        />
      )}

      {!loading && hasMore && videos.length > 0 && (
        <div className="flex items-center justify-center mt-6">
          <Button variant="link" onClick={() => fetchVideos()}>
            {t("loadMore")}
          </Button>
        </div>
      )}

      <Dialog
        open={!!editing}
        onOpenChange={(value) => {
          if (value) return;
          setEditing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editResource")}</DialogTitle>
            <DialogDescription className="sr-only">
              edit video
            </DialogDescription>
          </DialogHeader>

          <VideoEditForm
            video={editing}
            onCancel={() => setEditing(null)}
            onFinish={() => setEditing(null)}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(value) => {
          if (value) return;
          setDeleting(null);
        }}
      >
        <AlertDialogContent className="max-w-[420px]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteResource")}</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="break-all">
                {t("deleteResourceConfirmation", {
                  name: deleting?.name || "",
                })}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-ej-bad"
              onClick={() => {
                if (!deleting) return;
                EnjoyApp.videos
                  .destroy(deleting.id)
                  .catch((err) => toast.error(err.message))
                  .finally(() => setDeleting(null));
              }}
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
