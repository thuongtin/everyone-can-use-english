import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), "enjoy-youtube-thumbnail-")
);

try {
  const output = path.join(temporaryDirectory, "youtube.mjs");
  let getYoutubeThumbnailUrl;
  let normalizeYoutubeChannel;

  try {
    await build({
      entryPoints: [path.join(root, "src/utils/youtube.ts")],
      outfile: output,
      bundle: true,
      platform: "node",
      format: "esm",
      logLevel: "silent",
    });
    ({ getYoutubeThumbnailUrl, normalizeYoutubeChannel } = await import(
      pathToFileURL(output).href
    ));
  } catch {
    // The assertion below makes a missing thumbnail resolver an expected RED failure.
  }

  assert.equal(typeof getYoutubeThumbnailUrl, "function");
  assert.equal(typeof normalizeYoutubeChannel, "function");

  assert.equal(
    getYoutubeThumbnailUrl("https://www.youtube.com/watch?v=YCldrsmxi_s"),
    "https://i.ytimg.com/vi/YCldrsmxi_s/hqdefault.jpg"
  );
  assert.equal(
    getYoutubeThumbnailUrl("https://youtu.be/M7lc1UVf-VE?t=43"),
    "https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg"
  );
  assert.equal(
    getYoutubeThumbnailUrl("https://m.youtube.com/shorts/dQw4w9WgXcQ"),
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
  );
  assert.equal(getYoutubeThumbnailUrl("https://example.com/watch?v=YCldrsmxi_s"), undefined);
  assert.equal(getYoutubeThumbnailUrl("https://www.youtube.com/watch?v=invalid"), undefined);

  assert.equal(normalizeYoutubeChannel("@TED"), "@TED");
  assert.equal(
    normalizeYoutubeChannel("https://www.youtube.com/@veritasium/videos"),
    "@veritasium"
  );
  assert.equal(
    normalizeYoutubeChannel("https://www.youtube.com/channel/UCsooa4yRKGN_zEE8iknghZA"),
    "channel/UCsooa4yRKGN_zEE8iknghZA"
  );
  assert.equal(normalizeYoutubeChannel("https://example.com/@TED"), undefined);
  assert.equal(normalizeYoutubeChannel("https://www.youtube.com/watch?v=YCldrsmxi_s"), undefined);

  console.log("PASS: resolves official thumbnails and canonical channel paths for YouTube only");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
