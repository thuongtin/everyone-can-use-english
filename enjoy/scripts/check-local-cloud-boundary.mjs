import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-local-cloud-"));
const require = createRequire(import.meta.url);

const modelNames = [
  "audio",
  "video",
  "document",
  "recording",
  "note",
  "segment",
  "transcription",
  "pronunciation-assessment",
];

const forbiddenModelPatterns = [
  /from ["']@\/api["']/,
  /from ["'](?:@\/main|@main)\/storage["']/,
  /new Client\s*\(/,
  /async\s+(?:sync|upload)\s*\(/,
  /\.sync(?:Audio|Video|Document|Recording|Note|Segment|Transcription|PronunciationAssessment)\s*\(/,
  /\.delete(?:Audio|Video|Document|Recording|Note)\s*\(/,
  /storage\.put\s*\(/,
  /update\s*\(\s*\{\s*(?:syncedAt|uploadedAt)\s*:/,
];

const retiredIpcChannels = [
  "audios-upload",
  "videos-upload",
  "documents-upload",
  "recordings-sync",
  "recordings-sync-all",
  "recordings-upload",
  "segments-sync",
  "notes-sync",
];

try {
  assert.equal(
    existsSync(path.join(root, "src/main/storage.ts")),
    false,
    "Enjoy cloud storage module must be removed"
  );

  for (const modelName of modelNames) {
    const source = await readFile(
      path.join(root, "src/main/db/models", `${modelName}.ts`),
      "utf8"
    );
    for (const pattern of forbiddenModelPatterns) {
      assert.doesNotMatch(
        source,
        pattern,
        `${modelName} must not retain cloud sync/upload/delete code`
      );
    }
  }

  const handlerSources = await Promise.all(
    ["audios", "videos", "documents", "recordings", "segments", "notes"].map(
      (name) =>
        readFile(path.join(root, "src/main/db/handlers", `${name}-handler.ts`), "utf8")
    )
  );
  const handlerSource = handlerSources.join("\n");
  for (const channel of retiredIpcChannels) {
    assert.doesNotMatch(
      handlerSource,
      new RegExp(`ipcMain\\.(?:handle|removeHandler)\\(["']${channel}["']`),
      `${channel} must not remain registered`
    );
  }

  const resourcePolicyOutput = path.join(temp, "retired-resource.cjs");
  await build({
    entryPoints: [path.join(root, "src/renderer/lib/retired-resource.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: resourcePolicyOutput,
    logLevel: "silent",
  });
  const { displayableResourceUrl, resolveDisplayResource } = require(
    resourcePolicyOutput
  );
  assert.deepEqual(resolveDisplayResource("https://cdn.enjoy.bot/avatar.png"), {
    retired: true,
  });
  assert.deepEqual(resolveDisplayResource("//cdn.enjoy.bot/avatar.png"), {
    retired: true,
  });
  assert.deepEqual(
    resolveDisplayResource("https://enjoy-storage.baizhiheizi.com/file.mp3"),
    { retired: true }
  );
  assert.equal(
    displayableResourceUrl("enjoy://library/audios/local.mp3"),
    "enjoy://library/audios/local.mp3"
  );
  assert.equal(
    displayableResourceUrl("https://i.ytimg.com/vi/example/hqdefault.jpg"),
    "https://i.ytimg.com/vi/example/hqdefault.jpg"
  );

  const documentOutput = path.join(temp, "document.cjs");
  await build({
    entryPoints: [path.join(root, "src/main/db/models/document.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: documentOutput,
    logLevel: "silent",
    plugins: [
      {
        name: "local-document-test-modules",
        setup(builder) {
          const modules = {
            "@main/settings": `export default {
              userDataPath() { return ${JSON.stringify(temp)}; },
              getSync() { return "profile"; },
            };`,
            "@main/window": "export default { win: null };",
            "@main/logger":
              "export default { scope() { return { debug() {}, error() {} }; } };",
            "@/main/utils":
              "export const enjoyUrlToPath = value => value; export const hashFile = async () => 'hash';",
            "sequelize-typescript": `
              const decorator = () => () => {};
              export const AfterUpdate = decorator;
              export const AfterDestroy = decorator;
              export const Table = decorator;
              export const Column = decorator;
              export const Default = decorator;
              export const IsUUID = decorator;
              export const AfterCreate = decorator;
              export const Unique = decorator;
              export class Model {}
              export const DataType = { UUIDV4: "uuid-v4", UUID: "uuid", STRING: "string", JSON: "json", DATE: "date", VIRTUAL: "virtual" };
            `,
          };
          for (const [specifier, contents] of Object.entries(modules)) {
            const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            builder.onResolve({ filter: new RegExp(`^${escaped}$`) }, () => ({
              path: specifier,
              namespace: "local-document-test",
            }));
            builder.onLoad(
              { filter: /.*/, namespace: "local-document-test" },
              (args) => (args.path === specifier ? { contents, loader: "ts" } : null)
            );
          }
        },
      },
    ],
  });

  const { Document } = require(documentOutput);
  const localFile = path.join(temp, "document.txt");
  await writeFile(localFile, "local data");
  Document.removeLocalFile({ filePath: localFile });
  assert.equal(existsSync(localFile), false, "local delete hook must still remove bytes");

  console.info(
    "check-local-cloud-boundary: PASS (cloud module/calls/IPC removed; retired remote resources hidden; local document cleanup preserved)"
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
