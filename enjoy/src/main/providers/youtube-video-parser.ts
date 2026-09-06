export type YoutubeVideo = {
  title: string;
  thumbnail: string;
  videoId: string;
  duration?: string;
};

type RecordValue = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null;

const readJsonObject = (source: string, fromIndex: number) => {
  const start = source.indexOf("{", fromIndex);
  if (start < 0) return;

  let depth = 0;
  let escaped = false;
  let inString = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
};

const readInitialData = (html: string): unknown => {
  if (!html) return;

  const assignment = /(?:var\s+|let\s+|const\s+)?ytInitialData\s*=\s*/g;
  const scripts = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let initialData: unknown;
  let scriptMatch: RegExpExecArray | null;

  while (initialData === undefined && (scriptMatch = scripts.exec(html)) !== null) {
    const script = scriptMatch[1];
    assignment.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = assignment.exec(script)) !== null) {
      const json = readJsonObject(script, match.index + match[0].length);
      if (!json) continue;

      try {
        initialData = JSON.parse(json);
        break;
      } catch {
        continue;
      }
    }
  }

  return initialData;
};

const readText = (value: unknown) => {
  if (typeof value === "string") return value.trim();
  if (!isRecord(value)) return;

  if (typeof value.content === "string") return value.content.trim();
  if (typeof value.simpleText === "string") return value.simpleText.trim();

  if (Array.isArray(value.runs)) {
    const text = value.runs
      .filter(isRecord)
      .map((run) => (typeof run.text === "string" ? run.text : ""))
      .join("")
      .trim();
    if (text) return text;
  }
};

const readThumbnail = (value: unknown) => {
  if (!isRecord(value)) return;

  const thumbnails = Array.isArray(value.thumbnails)
    ? value.thumbnails
    : Array.isArray(value.sources)
      ? value.sources
      : [];

  for (const thumbnail of [...thumbnails].reverse()) {
    if (!isRecord(thumbnail) || typeof thumbnail.url !== "string") continue;
    const url = thumbnail.url.trim();
    if (url) return url;
  }
};

const readLockupDuration = (value: RecordValue) => {
  const thumbnailViewModel = value.contentImage;
  if (!isRecord(thumbnailViewModel)) return;
  const thumbnail = thumbnailViewModel.thumbnailViewModel;
  if (!isRecord(thumbnail) || !Array.isArray(thumbnail.overlays)) return;

  for (const overlay of thumbnail.overlays) {
    if (!isRecord(overlay)) continue;
    const bottomOverlay = overlay.thumbnailBottomOverlayViewModel;
    if (!isRecord(bottomOverlay) || !Array.isArray(bottomOverlay.badges)) {
      continue;
    }

    for (const badge of bottomOverlay.badges) {
      if (!isRecord(badge)) continue;
      const badgeViewModel = badge.thumbnailBadgeViewModel;
      if (!isRecord(badgeViewModel)) continue;
      const text = readText(badgeViewModel.text);
      if (text) return text;
    }
  }
};

const readVideoContents = (data: unknown): unknown[] => {
  if (!isRecord(data) || !isRecord(data.contents)) return [];

  const browseResults = data.contents.twoColumnBrowseResultsRenderer;
  if (!isRecord(browseResults) || !Array.isArray(browseResults.tabs)) return [];

  for (const tab of browseResults.tabs) {
    if (!isRecord(tab) || !isRecord(tab.tabRenderer)) continue;
    const content = tab.tabRenderer.content;
    if (!isRecord(content) || !isRecord(content.richGridRenderer)) continue;
    if (Array.isArray(content.richGridRenderer.contents)) {
      return content.richGridRenderer.contents;
    }
  }

  return [];
};

const readVideo = (value: unknown): YoutubeVideo | undefined => {
  if (!isRecord(value) || !isRecord(value.richItemRenderer)) return;

  const content = value.richItemRenderer.content;
  if (!isRecord(content)) return;

  if (isRecord(content.lockupViewModel)) {
    const lockup = content.lockupViewModel;
    if (lockup.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") return;

    const videoId = typeof lockup.contentId === "string" ? lockup.contentId.trim() : "";
    const metadata = lockup.metadata;
    const lockupMetadata = isRecord(metadata)
      ? metadata.lockupMetadataViewModel
      : undefined;
    const title = isRecord(lockupMetadata)
      ? readText(lockupMetadata.title)
      : undefined;
    const thumbnail = readThumbnail(
      isRecord(lockup.contentImage)
        ? isRecord(lockup.contentImage.thumbnailViewModel)
          ? lockup.contentImage.thumbnailViewModel.image
          : undefined
        : undefined
    );
    if (!videoId || !title || !thumbnail) return;

    const video: YoutubeVideo = { title, thumbnail, videoId };
    const duration = readLockupDuration(lockup);
    if (duration) video.duration = duration;
    return video;
  }

  if (!isRecord(content.videoRenderer)) return;

  const renderer = content.videoRenderer;
  const videoId = typeof renderer.videoId === "string" ? renderer.videoId.trim() : "";
  const title = readText(renderer.title);
  const thumbnail = readThumbnail(renderer.thumbnail);
  if (!videoId || !title || !thumbnail) return;

  const video: YoutubeVideo = { title, thumbnail, videoId };
  const duration = readText(renderer.lengthText);
  if (duration) video.duration = duration;
  return video;
};

export const extractYoutubeVideos = (html: string): YoutubeVideo[] => {
  const data = readInitialData(html);
  return readVideoContents(data).flatMap((item) => {
    const video = readVideo(item);
    return video ? [video] : [];
  });
};
