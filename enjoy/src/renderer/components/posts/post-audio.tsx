import { useEffect, useState, useContext } from "react";
import { AppSettingsProviderContext } from "@renderer/context";
import { Button } from "@renderer/components/ui";
import { STORAGE_WORKER_ENDPOINTS } from "@/constants";
import { t } from "i18next";
import { XCircleIcon } from "lucide-react";
import { UniversalPlayer, WavesurferPlayer } from "@renderer/components";
import {
  getCurrentPostAudioSegment,
  isStorageAudioSource,
  requestPostAudioTranscription,
} from "@renderer/lib/post-audio-transcription";

export const PostAudio = (props: {
  audio: Partial<MediumType>;
  height?: number;
}) => {
  const { audio, height = 80 } = props;
  const [currentTime, setCurrentTime] = useState<number>(0);
  const { webApi } = useContext(AppSettingsProviderContext);
  const [transcription, setTranscription] = useState<TranscriptionType>();
  const [error, setError] = useState<string>(null);

  const currentTranscription = getCurrentPostAudioSegment(
    transcription,
    currentTime
  );

  useEffect(() => {
    let active = true;
    setTranscription(undefined);
    setCurrentTime(0);
    setError(null);
    if (!webApi || !audio.md5) return;

    requestPostAudioTranscription(webApi, audio.md5, () => active)
      .then((item) => {
        if (active) setTranscription(item);
      })
      .catch(() => {
        if (active) setTranscription(undefined);
      });

    return () => {
      active = false;
    };
  }, [webApi, audio.md5]);

  if (error) {
    return (
      <div className="w-full rounded-lg p-4 border">
        <div className="flex items-center justify-center mb-2">
          <XCircleIcon className="w-4 h-4 text-destructive" />
        </div>
        <div className="select-text break-all text-center text-sm text-muted-foreground mb-4">
          {error}
        </div>
        <div className="flex items-center justify-center">
          <Button onClick={() => setError(null)}>{t("retry")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {audio.sourceUrl &&
        (isStorageAudioSource(audio.sourceUrl, STORAGE_WORKER_ENDPOINTS) ? (
          <WavesurferPlayer
            setCurrentTime={setCurrentTime}
            id={audio.id}
            src={audio.sourceUrl}
            height={height}
            onError={(err) => setError(err.message)}
          />
        ) : (
          <UniversalPlayer
            src={audio.sourceUrl}
            onTimeUpdate={(time) => {
              setCurrentTime(time);
            }}
            onError={(err) => setError(err.message)}
          />
        ))}

      {currentTranscription && (
        <div className="mt-2 bg-muted px-4 py-2 rounded">
          <div className="text-muted-foreground text-center font-serif">
            {currentTranscription.text}
          </div>
        </div>
      )}

      {audio.coverUrl && (
        <div className="mt-2">
          <img src={audio.coverUrl} className="w-full rounded" />
        </div>
      )}
    </div>
  );
};
