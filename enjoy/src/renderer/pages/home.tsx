import {
  AudiosSegment,
  AudibleBooksSegment,
  DocumentsSegment,
  VideosSegment,
  YoutubeVideosSegment,
  EnrollmentSegment,
} from "@renderer/components";
import { useContext, useEffect, useRef, useState } from "react";
import { AppSettingsProviderContext } from "@renderer/context";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  toast,
} from "@renderer/components/ui";
import { t } from "i18next";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { normalizeYoutubeChannel } from "@/utils/youtube";

const DEFAULT_YOUTUBE_CHANNELS = ["@TED", "@CNN", "@nytimes"];
const CUSTOM_YOUTUBE_CHANNELS_KEY = "home-custom-youtube-channels";

const normalizedChannels = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((channel) =>
        typeof channel === "string" ? [normalizeYoutubeChannel(channel)] : []
      ).filter((channel): channel is string => Boolean(channel))
    : [];

const uniqueChannels = (channels: string[]) =>
  [...new Map(channels.map((channel) => [channel.toLowerCase(), channel])).values()];

export default () => {
  const [suggestedChannels, setSuggestedChannels] = useState<string[]>(
    DEFAULT_YOUTUBE_CHANNELS
  );
  const [customChannels, setCustomChannels] = useState<string[]>([]);
  const customChannelsChanged = useRef(false);

  const { webApi, EnjoyApp } = useContext(AppSettingsProviderContext);

  const channels = uniqueChannels([...suggestedChannels, ...customChannels]);

  useEffect(() => {
    let active = true;

    EnjoyApp.cacheObjects
      .get(CUSTOM_YOUTUBE_CHANNELS_KEY)
      .then((storedChannels) => {
        if (!active || customChannelsChanged.current) return;
        setCustomChannels(uniqueChannels(normalizedChannels(storedChannels)));
      });

    if (!webApi) return () => {
      active = false;
    };

    webApi.config("ytb_channels").then((channels) => {
      if (!active) return;

      const configuredChannels = uniqueChannels(normalizedChannels(channels));
      if (configuredChannels.length) setSuggestedChannels(configuredChannels);
    });

    return () => {
      active = false;
    };
  }, [EnjoyApp, webApi]);

  const addChannel = (input: string) => {
    const channel = normalizeYoutubeChannel(input);
    if (!channel) {
      toast.error(t("invalidYoutubeChannel"));
      return false;
    }
    if (channels.some((existing) => existing.toLowerCase() === channel.toLowerCase())) {
      toast.error(t("youtubeChannelAlreadyAdded"));
      return false;
    }

    const nextChannels = [...customChannels, channel];
    customChannelsChanged.current = true;
    setCustomChannels(nextChannels);
    EnjoyApp.cacheObjects.set(CUSTOM_YOUTUBE_CHANNELS_KEY, nextChannels);
    toast.success(t("youtubeChannelAdded"));
    return true;
  };

  const removeChannel = (channel: string) => {
    const nextChannels = customChannels.filter((item) => item !== channel);
    customChannelsChanged.current = true;
    setCustomChannels(nextChannels);
    EnjoyApp.cacheObjects.set(CUSTOM_YOUTUBE_CHANNELS_KEY, nextChannels);
  };

  return (
    <div className="w-full relative">
      <AuthorizationStatusBar />
      <div className="max-w-5xl mx-auto px-4 py-6 lg:px-8">
        <div className="space-y-4">
          <EnrollmentSegment />
          <AudiosSegment />
          <VideosSegment />
          <DocumentsSegment />
          <AudibleBooksSegment />
          <YoutubeChannelManager
            channels={customChannels}
            onAdd={addChannel}
            onRemove={removeChannel}
          />
          {channels.map((channel) => (
            <YoutubeVideosSegment key={channel} channel={channel} />
          ))}
        </div>
      </div>
    </div>
  );
};

const YoutubeChannelManager = (props: {
  channels: string[];
  onAdd: (input: string) => boolean;
  onRemove: (channel: string) => void;
}) => {
  const { channels, onAdd, onRemove } = props;
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");

  const submit = () => {
    if (!onAdd(input)) return;
    setInput("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PlusIcon className="mr-2 size-4" />
        {t("addYoutubeChannel")}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addYoutubeChannel")}</DialogTitle>
          <DialogDescription>{t("youtubeChannelDescription")}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            value={input}
            placeholder={t("youtubeChannelPlaceholder")}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              submit();
            }}
          />
          <Button onClick={submit}>{t("confirm")}</Button>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium">{t("yourYoutubeChannels")}</div>
          {channels.length ? (
            channels.map((channel) => (
              <div
                key={channel}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <span className="truncate">{channel}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("removeYoutubeChannel")}
                  onClick={() => onRemove(channel)}
                >
                  <Trash2Icon className="size-4 text-destructive" />
                </Button>
              </div>
            ))
          ) : (
            <div className="text-sm text-muted-foreground">{t("noYoutubeChannels")}</div>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const AuthorizationStatusBar = () => {
  const { user, logout } = useContext(AppSettingsProviderContext);
  if (!user) return null;

  if (!user.accessToken) {
    return (
      <div className="bg-destructive text-white py-2 px-4 h-10 flex items-center sticky top-0 z-10">
        <span className="text-sm">{t("authorizationExpired")}</span>
        <Button
          variant="outline"
          size="sm"
          className="ml-2 py-1 px-2 text-xs h-auto w-auto"
          onClick={logout}
        >
          {t("reLogin")}
        </Button>
      </div>
    );
  }

  return null;
};
