import { t } from "i18next";
import { useState, useEffect, useContext } from "react";
import { AppSettingsProviderContext } from "@renderer/context";
import {
  Button,
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogContent,
  DialogFooter,
  Progress,
  toast,
} from "@renderer/components/ui";
import { useNavigate } from "react-router-dom";
import { LoaderIcon } from "lucide-react";
import { EjSectionHeader } from "@renderer/components/enjoy";

export const YoutubeVideosSegment = (props: { channel: string }) => {
  const { channel } = props;
  const navigate = useNavigate();
  const { EnjoyApp } = useContext(AppSettingsProviderContext);
  const [youtubeChannel, setYoutubeChannel] = useState<YoutubeChannelType>();
  const [selectedVideo, setSelectedVideo] = useState<YoutubeVideoType | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState(null);

  const addToLibrary = () => {
    if (!selectedVideo || submitting) return;
    const url = `https://www.youtube.com/watch?v=${selectedVideo?.videoId}`;
    setSubmitting(true);
    setProgress(0);

    EnjoyApp.videos
      .create(url, {
        name: selectedVideo?.title,
      })
      .then((record) => {
        if (!record) return;

        navigate(`/videos/${record.id}`);
      })
      .catch((error) => toast.error(error.message))
      .finally(() => {
        setSubmitting(false);
      });
  };

  useEffect(() => {
    let active = true;
    let requestInFlight = false;
    const cacheKey = `youtube-channel-${channel}-v2`;

    const fetchYoutubeVideos = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const cachedChannel = await EnjoyApp.cacheObjects.get(cacheKey);
        if (!active) return;
        if (cachedChannel) {
          setYoutubeChannel(cachedChannel);
          return;
        }
        if (!navigator.onLine) return;

        const nextChannel = await EnjoyApp.providers.youtube.videos(channel);
        if (!active || !nextChannel) return;
        await EnjoyApp.cacheObjects.set(cacheKey, nextChannel, 60 * 10);
        if (active) setYoutubeChannel(nextChannel);
      } catch (error) {
        if (active) console.error(error);
      } finally {
        requestInFlight = false;
      }
    };

    const handleOnline = () => {
      void fetchYoutubeVideos();
    };

    window.addEventListener("online", handleOnline);
    void fetchYoutubeVideos();
    return () => {
      active = false;
      window.removeEventListener("online", handleOnline);
    };
  }, [EnjoyApp, channel]);

  useEffect(() => {
    EnjoyApp.download.onState((_, downloadState) => {
      const { state, received, speed } = downloadState;
      if (state === "progressing") {
        setProgress(received);
        setDownloadSpeed(speed);
      }
    });

    return () => {
      EnjoyApp.download.removeAllListeners();
    };
  }, [submitting]);

  if (!youtubeChannel?.videos.length) return null;

  return (
    <>
      <EjSectionHeader
        title={`${t("from")} YouTube ${youtubeChannel.name || channel}`}
      />
      <div className="ej-row ej-row-wide pb-1">
        {youtubeChannel.videos.map((video) => (
          <YoutubeVideoCard
            key={video.videoId}
            video={video}
            onClick={() => setSelectedVideo(video)}
          />
        ))}
      </div>

      <Dialog
        open={Boolean(selectedVideo)}
        onOpenChange={(value) => {
          if (!value) setSelectedVideo(null);
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t("downloadVideo")}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center mb-4 bg-ej-surface2 rounded-lg">
            <div className="aspect-square h-28 overflow-hidden rounded-l-lg">
              <img
                src={selectedVideo?.thumbnail}
                alt={selectedVideo?.title}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 py-3 px-4 h-28">
              <div className="text-lg font-semibold ">
                {selectedVideo?.title}
              </div>
              <div className="text-xs line-clamp-1 mb-2 text-right">
                {selectedVideo?.duration}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() =>
                EnjoyApp.shell.openExternal(
                  `https://www.youtube.com/watch?v=${selectedVideo?.videoId}`
                )
              }
              className="mr-auto"
            >
              {t("open")}
            </Button>

            <Button onClick={() => setSelectedVideo(null)} variant="secondary">
              {t("cancel")}
            </Button>

            <Button onClick={() => addToLibrary()} disabled={submitting}>
              {submitting && (
                <LoaderIcon className="w-4 h-4 animate-spin mr-2" />
              )}
              {submitting
                ? progress < 100
                  ? t("downloading")
                  : t("importing")
                : t("downloadVideo")}
            </Button>
          </DialogFooter>
          {submitting && (
            <div>
              <Progress value={progress} className="mb-2" />
              <div className="text-xs line-clamp-1 mb-2 text-right">
                {downloadSpeed}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

const YoutubeVideoCard = (props: {
  video: YoutubeVideoType;
  onClick?: () => void;
}) => {
  const { video, onClick } = props;

  return (
    <div onClick={onClick} className="group cursor-pointer min-w-0">
      <div className="aspect-video rounded-xl overflow-hidden border border-ej-line bg-ej-surface2 relative transition-transform duration-ej group-hover:-translate-y-[3px] group-hover:shadow-ej">
        <img
          src={video.thumbnail}
          alt={video.title}
          loading="lazy"
          className="object-cover w-full h-full"
        />
        <span className="absolute left-2 top-2 h-[18px] px-1.5 rounded-md bg-[#ff0000] text-[10px] font-bold uppercase text-white flex items-center">
          YouTube
        </span>
        {video.duration && (
          <span className="absolute right-2 bottom-2 h-[18px] px-1.5 rounded-md bg-black/55 text-[10px] font-semibold text-white flex items-center ej-tabular">
            {video.duration}
          </span>
        )}
      </div>
      <div className="mt-2 text-[13px] font-semibold text-ej-ink leading-snug line-clamp-2">
        {video.title}
      </div>
    </div>
  );
};
