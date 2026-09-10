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
      contents: `export * from "./src/main/providers/youtube-video-parser.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });

  const { extractYoutubeVideos, extractYoutubeChannel } = await import(
    `${pathToFileURL(output).href}?test=${Date.now()}`
  );

  const validData = {
    metadata: {
      channelMetadataRenderer: {
        title: "DOAC",
      },
    },
    ...withContents([
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
    ]),
  };

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

  assert.deepEqual(extractYoutubeChannel?.(withInitialData(validData)), {
    name: "DOAC",
    videos: [
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
    ],
  });

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

  const providerOutput = path.join(temp, "youtube-provider.mjs");
  await build({
    stdin: {
      contents: `export { YoutubeProvider } from "./src/main/providers/youtube-provider.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: providerOutput,
    logLevel: "silent",
    plugins: [{
      name: "youtube-provider-lifecycle-stubs",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^electron$/u }, () => ({ path: "electron", namespace: "youtube-provider-stub" }));
        buildApi.onResolve({ filter: /^@main\/logger$/u }, () => ({ path: "logger", namespace: "youtube-provider-stub" }));
        buildApi.onLoad({ filter: /^electron$/u, namespace: "youtube-provider-stub" }, () => ({
          loader: "js",
          contents: `
            import { EventEmitter } from "node:events";
            class FakeWebContents extends EventEmitter {
              destroyed = false;
              scenario = globalThis.__ENJOY_YOUTUBE_SCENARIOS__.shift();
              loadURL(url) {
                globalThis.__ENJOY_YOUTUBE_RECORDS__.listenerCounts.push({
                  failed: this.listenerCount("did-fail-load"),
                  stopped: this.listenerCount("did-stop-loading"),
                });
                return this.scenario.load(this, url);
              }
              executeJavaScript() {
                globalThis.__ENJOY_YOUTUBE_RECORDS__.executeCount += 1;
                return this.scenario.execute?.() ?? Promise.resolve("<html>fixture</html>");
              }
              isDestroyed() { return this.destroyed; }
              close() {
                if (this.destroyed) throw new Error("webContents closed twice");
                this.destroyed = true;
                globalThis.__ENJOY_YOUTUBE_RECORDS__.closeCount += 1;
                globalThis.__ENJOY_YOUTUBE_RECORDS__.remainingListeners.push({
                  failed: this.listenerCount("did-fail-load"),
                  stopped: this.listenerCount("did-stop-loading"),
                });
              }
            }
            export class WebContentsView { webContents = new FakeWebContents(); }
            export const ipcMain = { handle: (_name, handler) => { globalThis.__ENJOY_YOUTUBE_IPC_HANDLER__ = handler; } };
          `,
        }));
        buildApi.onLoad({ filter: /^logger$/u, namespace: "youtube-provider-stub" }, () => ({
          loader: "js",
          contents: `export default { scope: () => ({
            debug: (...args) => globalThis.__ENJOY_YOUTUBE_LOGS__.debug.push(args),
            warn: (...args) => globalThis.__ENJOY_YOUTUBE_LOGS__.warn.push(args),
            error: (...args) => globalThis.__ENJOY_YOUTUBE_LOGS__.error.push(args),
          }) };`,
        }));
      },
    }],
  });

  const resetProviderHarness = (...scenarios) => {
    global.__ENJOY_YOUTUBE_SCENARIOS__ = scenarios;
    global.__ENJOY_YOUTUBE_RECORDS__ = {
      closeCount: 0,
      executeCount: 0,
      listenerCounts: [],
      remainingListeners: [],
    };
    global.__ENJOY_YOUTUBE_LOGS__ = { debug: [], warn: [], error: [] };
  };
  const offlineRace = {
    load(contents, url) {
      return new Promise((_resolve, reject) => queueMicrotask(() => {
        contents.emit("did-stop-loading");
        contents.emit("did-fail-load", {}, -106, "ERR_INTERNET_DISCONNECTED", url, true);
        reject(new Error("ERR_INTERNET_DISCONNECTED"));
      }));
    },
  };
  const unexpectedFailure = {
    load(contents, url) {
      return new Promise((_resolve, reject) => queueMicrotask(() => {
        contents.emit("did-fail-load", {}, -2, "ERR_FAILED", url, true);
        reject(new Error("ERR_FAILED"));
      }));
    },
  };
  const successfulLoad = {
    load(contents) {
      return new Promise(resolve => queueMicrotask(() => {
        contents.emit("did-stop-loading");
        resolve();
      }));
    },
    execute: () => Promise.resolve("<html>successful fixture</html>"),
  };
  const executionFailure = {
    ...successfulLoad,
    execute: () => Promise.reject(new TypeError("fixture execute failure")),
  };
  const timeout = { load: () => new Promise(() => {}) };

  const { YoutubeProvider } = await import(`${pathToFileURL(providerOutput).href}?test=${Date.now()}`);
  resetProviderHarness(offlineRace);
  const offlineProvider = new YoutubeProvider(25);
  assert.equal(await offlineProvider.scrape("https://www.youtube.com/@offline/videos"), "");
  assert.deepEqual(global.__ENJOY_YOUTUBE_RECORDS__.listenerCounts, [{ failed: 1, stopped: 1 }]);
  assert.equal(global.__ENJOY_YOUTUBE_RECORDS__.executeCount, 0);
  assert.equal(global.__ENJOY_YOUTUBE_RECORDS__.closeCount, 1);
  assert.equal(global.__ENJOY_YOUTUBE_LOGS__.warn.length, 0);
  assert.equal(global.__ENJOY_YOUTUBE_LOGS__.error.length, 0);
  assert.deepEqual(global.__ENJOY_YOUTUBE_RECORDS__.remainingListeners, [{ failed: 0, stopped: 0 }]);

  resetProviderHarness(offlineRace);
  const offlineChannel = await new YoutubeProvider(25).videos("@offline");
  assert.deepEqual(offlineChannel.videos, []);
  assert.equal(offlineChannel.name, undefined);
  assert.equal(global.__ENJOY_YOUTUBE_LOGS__.warn.length, 0);
  assert.equal(global.__ENJOY_YOUTUBE_LOGS__.error.length, 0);

  resetProviderHarness(successfulLoad);
  assert.equal(
    await new YoutubeProvider(25).scrape("https://www.youtube.com/@success/videos"),
    "<html>successful fixture</html>",
  );
  assert.equal(global.__ENJOY_YOUTUBE_RECORDS__.executeCount, 1);
  assert.equal(global.__ENJOY_YOUTUBE_RECORDS__.closeCount, 1);
  assert.deepEqual(global.__ENJOY_YOUTUBE_RECORDS__.remainingListeners, [{ failed: 0, stopped: 0 }]);

  resetProviderHarness(unexpectedFailure);
  const unavailableProvider = new YoutubeProvider(25);
  unavailableProvider.registerIpcHandlers();
  const unavailableChannel = await global.__ENJOY_YOUTUBE_IPC_HANDLER__({}, "@failed");
  assert.deepEqual(unavailableChannel.videos, []);
  assert.equal(global.__ENJOY_YOUTUBE_RECORDS__.executeCount, 0);
  assert.equal(global.__ENJOY_YOUTUBE_RECORDS__.closeCount, 1);
  assert.equal(global.__ENJOY_YOUTUBE_LOGS__.warn.length, 1);
  assert.match(global.__ENJOY_YOUTUBE_LOGS__.warn[0].join(" "), /YouTube suggestions unavailable.*ERR_FAILED/u);
  assert.equal(global.__ENJOY_YOUTUBE_LOGS__.error.length, 0);
  assert.deepEqual(global.__ENJOY_YOUTUBE_RECORDS__.remainingListeners, [{ failed: 0, stopped: 0 }]);

  resetProviderHarness(timeout);
  const timeoutChannel = await new YoutubeProvider(10).videos("@timeout");
  assert.deepEqual(timeoutChannel.videos, []);
  assert.equal(global.__ENJOY_YOUTUBE_RECORDS__.executeCount, 0);
  assert.equal(global.__ENJOY_YOUTUBE_RECORDS__.closeCount, 1);
  assert.match(global.__ENJOY_YOUTUBE_LOGS__.warn[0].join(" "), /suggestions unavailable.*timed out/iu);
  assert.equal(global.__ENJOY_YOUTUBE_LOGS__.error.length, 0);
  assert.deepEqual(global.__ENJOY_YOUTUBE_RECORDS__.remainingListeners, [{ failed: 0, stopped: 0 }]);

  resetProviderHarness(executionFailure);
  const programmingFailureProvider = new YoutubeProvider(25);
  programmingFailureProvider.registerIpcHandlers();
  assert.equal(await global.__ENJOY_YOUTUBE_IPC_HANDLER__({}, "@execute-failure"), undefined);
  assert.equal(global.__ENJOY_YOUTUBE_RECORDS__.executeCount, 1);
  assert.equal(global.__ENJOY_YOUTUBE_RECORDS__.closeCount, 1);
  assert.equal(global.__ENJOY_YOUTUBE_LOGS__.warn.length, 1);
  assert.equal(global.__ENJOY_YOUTUBE_LOGS__.error.length, 1);
  assert.match(String(global.__ENJOY_YOUTUBE_LOGS__.error[0][0]), /fixture execute failure/u);

  console.log("PASS: YouTube parsing plus scrape lifecycle, best-effort navigation, timeout, and execution errors.");
} finally {
  delete global.__ENJOY_YOUTUBE_SCENARIOS__;
  delete global.__ENJOY_YOUTUBE_RECORDS__;
  delete global.__ENJOY_YOUTUBE_LOGS__;
  delete global.__ENJOY_YOUTUBE_IPC_HANDLER__;
  await rm(temp, { recursive: true, force: true });
}
