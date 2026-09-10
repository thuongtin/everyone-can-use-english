import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-youtube-channel-settings-"));

const createStore = (initialValues = {}) => {
  const values = new Map(Object.entries(initialValues));
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
  };
};

try {
  const output = path.join(temp, "youtube.mjs");
  await build({
    stdin: {
      contents: `export * from "./src/utils/youtube.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });

  const {
    loadCustomYoutubeChannels,
    saveCustomYoutubeChannels,
    CUSTOM_YOUTUBE_CHANNELS_SETTING_KEY,
  } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

  const settings = createStore();
  await saveCustomYoutubeChannels?.(settings, ["@veritasium"]);
  assert.deepEqual(
    await loadCustomYoutubeChannels?.(settings),
    ["@veritasium"],
    "a channel saved through settings remains available to a new app session"
  );

  const legacyChannels = createStore({
    "home-custom-youtube-channels": ["https://www.youtube.com/@TED/videos"],
  });
  const migratedSettings = createStore();
  assert.deepEqual(
    await loadCustomYoutubeChannels?.(migratedSettings, legacyChannels),
    ["@TED"],
    "previously cached channels migrate to durable settings"
  );
  assert.deepEqual(
    await migratedSettings.get(CUSTOM_YOUTUBE_CHANNELS_SETTING_KEY),
    ["@TED"]
  );

  console.log("PASS: custom YouTube channels persist through settings and migrate legacy cache values");
} finally {
  await rm(temp, { recursive: true, force: true });
}
