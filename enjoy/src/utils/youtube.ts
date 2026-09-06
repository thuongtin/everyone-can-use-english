const youtubeHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "gaming.youtube.com",
]);

const validVideoId = /^[A-Za-z0-9_-]{11}$/;
const validHandle = /^@[^/?#\s]+$/;

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
