import { useState, useEffect, useContext } from "react";
import {
  DbProviderContext,
  AppSettingsProviderContext,
} from "@renderer/context";
import { AudioCard, MediaAddButton } from "@renderer/components";
import { EjSectionHeader, EjSeeAllLink } from "@renderer/components/enjoy";
import { t } from "i18next";

export const AudiosSegment = (props: { limit?: number }) => {
  const { limit = 10 } = props;
  const [audios, setAudios] = useState<AudioType[]>([]);
  const { addDblistener, removeDbListener } = useContext(DbProviderContext);
  const { EnjoyApp } = useContext(AppSettingsProviderContext);

  useEffect(() => {
    fetchResources();
    addDblistener(onAudioUpdate);

    return () => {
      removeDbListener(onAudioUpdate);
    };
  }, []);

  const fetchResources = async () => {
    const resources = await EnjoyApp.audios.findAll({
      limit,
    });
    if (!resources) return;

    setAudios(resources);
  };

  const onAudioUpdate = (event: CustomEvent) => {
    const { record, action, model } = event.detail || {};
    if (model !== "Audio") return;
    if (!record) return;

    if (action === "create") {
      setAudios([record as AudioType, ...audios]);
    } else if (action === "destroy") {
      setAudios(audios.filter((r) => r.id !== record.id));
    }
  };

  return (
    <section>
      <EjSectionHeader
        title={t("home.audios")}
        count={t("home.audiosCount", { count: audios.length })}
        action={<EjSeeAllLink to="/audios" label={t("home.seeAll")} />}
      />

      {audios.length === 0 ? (
        <div className="flex items-center justify-center h-40 rounded-ej-lg border border-dashed border-ej-line2 bg-ej-surface/40">
          <MediaAddButton type="Audio" />
        </div>
      ) : (
        <div className="ej-row pb-1">
          {audios.map((audio) => (
            <AudioCard key={audio.id} audio={audio} />
          ))}
        </div>
      )}
    </section>
  );
};
