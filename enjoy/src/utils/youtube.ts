import { UserSettingKeyEnum } from "@/types/enums";

const youtubeHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "gaming.youtube.com",
]);

const validVideoId = /^[A-Za-z0-9_-]{11}$/;
const validHandle = /^@[^/?#\s]+$/;

export const CUSTOM_YOUTUBE_CHANNELS_SETTING_KEY =
  UserSettingKeyEnum.YOUTUBE_CHANNELS;
export const LEGACY_CUSTOM_YOUTUBE_CHANNELS_CACHE_KEY =
  "home-custom-youtube-channels";

type YoutubeChannelSettingsStore = {
  get: (key: UserSettingKeyEnum) => Promise<unknown>;
  set: (key: UserSettingKeyEnum, value: string[]) => Promise<unknown>;
};

type YoutubeChannelCacheStore = {
  get: (key: string) => Promise<unknown>;
};

const getVideoId = (url: URL): string | undefined => {
  if (url.hostname === "youtu.be") return url.pathname.split("/")[1];
  if (!youtubeHosts.has(url.hostname)) return;

  if (url.pathname === "/watch") return url.searchParams.get("v") || undefined;

  const [firstSegment, videoId] = url.pathname.split("/").filter(Boolean);
  return ["embed", "shorts", "v"].includes(firstSegment) ? videoId : undefined;
};

export const getYoutubeThumbnailUrl = (source?: string): string | undefined => {
  if (!source) return;

  try {
    const videoId = getVideoId(new URL(source));
    if (!videoId || !validVideoId.test(videoId)) return;
    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  } catch {
    return;
  }
};

export const normalizeYoutubeChannel = (value?: string): string | undefined => {
  const input = value?.trim();
  if (!input) return;
  if (validHandle.test(input)) return input;

  try {
    const url = new URL(input);
    if (!youtubeHosts.has(url.hostname)) return;

    const [firstSegment, channelId] = url.pathname.split("/").filter(Boolean);
    if (validHandle.test(firstSegment)) return firstSegment;
    if (
      ["channel", "c", "user"].includes(firstSegment) &&
      channelId &&
      !/[/?#\s]/.test(channelId)
    ) {
      return `${firstSegment}/${channelId}`;
    }
  } catch {
    return;
  }
};

export const normalizeYoutubeChannels = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  return [
    ...new Map(
      value.flatMap((channel) =>
        typeof channel === "string" ? [normalizeYoutubeChannel(channel)] : []
      )
        .filter((channel): channel is string => Boolean(channel))
        .map((channel) => [channel.toLowerCase(), channel])
    ).values(),
  ];
};

export const saveCustomYoutubeChannels = async (
  settings: YoutubeChannelSettingsStore,
  channels: string[]
) => {
  await settings.set(
    CUSTOM_YOUTUBE_CHANNELS_SETTING_KEY,
    normalizeYoutubeChannels(channels)
  );
};

export const loadCustomYoutubeChannels = async (
  settings: YoutubeChannelSettingsStore,
  legacyCache?: YoutubeChannelCacheStore
) => {
  const storedChannels = await settings.get(CUSTOM_YOUTUBE_CHANNELS_SETTING_KEY);
  if (storedChannels !== null) return normalizeYoutubeChannels(storedChannels);
  if (!legacyCache) return [];

  const legacyChannels = normalizeYoutubeChannels(
    await legacyCache.get(LEGACY_CUSTOM_YOUTUBE_CHANNELS_CACHE_KEY)
  );
  if (legacyChannels.length) {
    await saveCustomYoutubeChannels(settings, legacyChannels);
  }
  return legacyChannels;
};
