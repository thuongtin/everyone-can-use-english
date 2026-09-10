import { useState, useEffect, useContext } from "react";
import {
  DbProviderContext,
  AppSettingsProviderContext,
} from "@renderer/context";
import { VideoCard, MediaAddButton } from "@renderer/components";
import { EjSectionHeader, EjSeeAllLink } from "@renderer/components/enjoy";
import { t } from "i18next";

export const VideosSegment = (props: { limit?: number }) => {
  const { limit = 10 } = props;
  const [videos, setVideos] = useState<VideoType[]>([]);
  const { addDblistener, removeDbListener } = useContext(DbProviderContext);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);

  useEffect(() => {
    fetchVideos();
    addDblistener(onVideosUpdate);

    return () => {
      removeDbListener(onVideosUpdate);
    };
  }, []);

  const fetchVideos = async () => {
    const videos = await EnjoyApp.videos.findAll({
      limit,
    });
    if (!videos) return;

    setVideos(videos);
  };

  const onVideosUpdate = (event: CustomEvent) => {
    const { record, action, model } = event.detail || {};
    if (model !== "Video") return;
    if (!record) return;

    if (action === "create") {
      setVideos([record as VideoType, ...videos]);
    } else if (action === "destroy") {
      setVideos(videos.filter((r) => r.id !== record.id));
    }
  };

  return (
    <section>
      <EjSectionHeader
        title={t("home.videos")}
        count={t("home.videosCount", { count: videos.length })}
        action={<EjSeeAllLink to="/videos" label={t("home.seeAll")} />}
      />

      {videos.length === 0 ? (
        <div className="flex items-center justify-center h-40 rounded-ej-lg border border-dashed border-ej-line2 bg-ej-surface/40">
          <MediaAddButton type="Video" />
        </div>
      ) : (
        <div className="ej-row ej-row-wide pb-1">
          {videos.map((video) => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
      )}
    </section>
  );
};
