import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-hotkeys-"));

try {
  const output = path.join(temp, "hotkey-map.mjs");
  await build({
    stdin: {
      contents: `export { mergeWithPreference } from "./src/renderer/lib/hotkey-map.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });

  const { mergeWithPreference } = await import(
    `${pathToFileURL(output).href}?test=${Date.now()}`
  );
  const defaults = {
    OpenPreferences: "Control+Comma",
    OpenCopilot: "Control+L",
    PlayOrPause: "Space",
  };

  assert.deepEqual(mergeWithPreference({}, defaults), defaults);
  assert.deepEqual(mergeWithPreference(null, defaults), defaults);
  assert.deepEqual(mergeWithPreference(["malformed"], defaults), defaults);
  assert.deepEqual(mergeWithPreference({ constructor: "Q" }, defaults), defaults);
  assert.deepEqual(mergeWithPreference({ OpenCopilot: "Alt+L" }, defaults), {
    ...defaults,
    OpenCopilot: "Alt+L",
  });
  assert.deepEqual(
    mergeWithPreference(
      {
        OpenPreferences: "",
        OpenCopilot: null,
        PlayOrPause: 42,
        Unknown: "Alt+X",
      },
      defaults
    ),
    {
      ...defaults,
      OpenPreferences: "",
    }
  );

  console.info("check-hotkeys-settings: PASS (empty and malformed persisted maps)");
} finally {
  await rm(temp, { recursive: true, force: true });
}
