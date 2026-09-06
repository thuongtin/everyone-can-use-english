import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-youtube-parser-"));

const videoItem = ({
  videoId,
  title,
  thumbnail = "https://img.example.test/default.jpg",
  duration,
}) => ({
  richItemRenderer: {
    content: {
      videoRenderer: {
        videoId,
        title: { runs: [{ text: title }] },
        thumbnail: { thumbnails: [{ url: thumbnail }] },
        ...(duration ? { lengthText: { simpleText: duration } } : {}),
      },
    },
  },
});

const lockupVideoItem = ({
  videoId,
  title,
  thumbnail,
  duration,
}) => ({
  richItemRenderer: {
    content: {
      lockupViewModel: {
        contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
        contentId: videoId,
        metadata: {
          lockupMetadataViewModel: {
            title: { content: title },
          },
        },
        contentImage: {
          thumbnailViewModel: {
            image: { sources: [{ url: thumbnail }] },
            overlays: [
              {
                thumbnailBottomOverlayViewModel: {
                  badges: [
                    { thumbnailBadgeViewModel: { text: duration } },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  },
});

const withInitialData = (data) =>
  `<html><body><script>var ytInitialData = ${JSON.stringify(data)};</script></body></html>`;

const withContents = (contents) => ({
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              richGridRenderer: { contents },
            },
          },
        },
      ],
    },
  },
});

try {
  const output = path.join(temp, "youtube-video-parser.mjs");
  await build({
    stdin: {
      contents: `export { extractYoutubeVideos } from "./src/main/providers/youtube-video-parser.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });

  const { extractYoutubeVideos } = await import(
    `${pathToFileURL(output).href}?test=${Date.now()}`
  );

  const validData = withContents([
    videoItem({
      videoId: "video-one",
      title: "First video",
      thumbnail: "https://img.example.test/first.jpg",
      duration: "1:23",
    }),
    { richItemRenderer: { content: { adSlotRenderer: {} } } },
    { richItemRenderer: { content: { reelItemRenderer: {} } } },
    { continuationItemRenderer: { trigger: "CONTINUATION_TRIGGER_ON_SCROLL_END" } },
    videoItem({
      videoId: "video-two",
      title: "Second video",
      thumbnail: "https://img.example.test/second.jpg",
    }),
    lockupVideoItem({
      videoId: "video-three",
      title: "Current YouTube video",
      thumbnail: "https://img.example.test/third.jpg",
      duration: "8:19",
    }),
  ]);

  const videos = extractYoutubeVideos(withInitialData(validData));
  assert.deepEqual(videos, [
    {
      title: "First video",
      thumbnail: "https://img.example.test/first.jpg",
      videoId: "video-one",
      duration: "1:23",
    },
    {
      title: "Second video",
      thumbnail: "https://img.example.test/second.jpg",
      videoId: "video-two",
    },
    {
      title: "Current YouTube video",
      thumbnail: "https://img.example.test/third.jpg",
      videoId: "video-three",
      duration: "8:19",
    },
  ]);

  const malformedFields = withContents([
    videoItem({ videoId: "", title: "Missing id" }),
    videoItem({ videoId: "missing-title", title: "" }),
    videoItem({ videoId: "missing-thumbnail", title: "Missing thumbnail", thumbnail: "" }),
    videoItem({ videoId: "valid-after-malformed", title: "Valid after malformed" }),
  ]);
  assert.deepEqual(extractYoutubeVideos(withInitialData(malformedFields)), [
    {
      title: "Valid after malformed",
      thumbnail: "https://img.example.test/default.jpg",
      videoId: "valid-after-malformed",
    },
  ]);

  assert.deepEqual(
    extractYoutubeVideos(withInitialData({ contents: {} })),
    []
  );
  assert.deepEqual(
    extractYoutubeVideos(
      "<script>var ytInitialData = {invalid json};</script>"
    ),
    []
  );
  assert.deepEqual(extractYoutubeVideos("<html><body>No data</body></html>"), []);

  console.log("PASS: YouTube fixture parsing, invalid rich items, missing fields, missing tabs, invalid JSON, and empty HTML.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
