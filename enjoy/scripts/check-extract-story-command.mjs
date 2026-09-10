/* global globalThis */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(path.join(root, ".tmp-extract-story-command-"));

try {
  const output = path.join(temporary, "extract-story-command.mjs");
  await build({
    stdin: {
      contents:
        'export { extractStoryCommand } from "./src/commands/extract-story.command.ts";',
      resolveDir: root,
      loader: "ts",
    },
    alias: { "@": path.join(root, "src") },
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
    plugins: [
      {
        name: "capture-json-command-contract",
        setup(pluginBuild) {
          pluginBuild.onResolve(
            { filter: /^\.\/json\.command$/u },
            () => ({ path: "json-command", namespace: "capture" }),
          );
          pluginBuild.onLoad(
            { filter: /.*/u, namespace: "capture" },
            () => ({
              loader: "js",
              contents: `
export const jsonCommand = async (prompt, options) => {
  globalThis.__ENJOY_EXTRACT_STORY_CAPTURE__ = {
    prompt,
    schema: options.schema,
    provider: options.provider,
    modelName: options.modelName,
  };
  return options.schema.parse({ words: ["meticulous"], idioms: [] });
};
`,
            }),
          );
        },
      },
    ],
  });

  globalThis.__ENJOY_EXTRACT_STORY_CAPTURE__ = undefined;
  const { extractStoryCommand } = await import(
    `${pathToFileURL(output).href}?contract=${Date.now()}`
  );
  const result = await extractStoryCommand(
    "The meticulous botanist catalogued an orchid.",
    "en-US",
    { provider: "deepseek", modelName: "deepseek-v4-flash" },
  );
  assert.deepEqual(result, { words: ["meticulous"], idioms: [] });

  const capture = globalThis.__ENJOY_EXTRACT_STORY_CAPTURE__;
  assert.ok(capture);
  assert.equal(capture.provider, "deepseek");
  assert.equal(capture.modelName, "deepseek-v4-flash");
  assert.match(capture.prompt, /"words"\s*:\s*\["word1",\s*"word2"\]/u);
  assert.match(capture.prompt, /"idioms"\s*:\s*\[\]/u);
  assert.match(capture.prompt, /both required properties, "words" and "idioms"/u);
  assert.match(capture.prompt, /If the article has no idioms, return an empty "idioms" array/u);
  assert.doesNotMatch(capture.prompt, /(?:^|\s)idiom\s*:/u);
  assert.doesNotMatch(capture.prompt, /```/u);

  assert.deepEqual(
    capture.schema.parse({ words: ["orchid"], idioms: [] }),
    { words: ["orchid"], idioms: [] },
  );
  assert.throws(() => capture.schema.parse({ words: ["orchid"] }));
  assert.throws(() =>
    capture.schema.parse({ words: ["orchid"], idiom: [] }),
  );
  assert.throws(() =>
    capture.schema.parse({ words: "orchid", idioms: [] }),
  );

  console.info(
    "check-extract-story-command: PASS (formatted prompt and required Zod arrays)",
  );
} finally {
  delete globalThis.__ENJOY_EXTRACT_STORY_CAPTURE__;
  await rm(temporary, { recursive: true, force: true });
}
