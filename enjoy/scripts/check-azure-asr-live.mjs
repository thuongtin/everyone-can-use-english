import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

if (process.env.ENJOY_RUN_AZURE_ASR_LIVE !== "1") {
  console.info(JSON.stringify({ check: "azure-asr-live", status: "skipped", reason: "live-opt-in-required" }));
  process.exit(0);
}
const root = path.resolve(import.meta.dirname, "..");
const configPath = process.env.ENJOY_AZURE_CREDENTIAL_FILE || "";
const engine = process.env.ENJOY_AZURE_ASR_ENGINE || "";
assert.ok(["azure_mai", "azure_speech"].includes(engine), "Select one explicit Azure ASR engine");
const metadata = await lstat(configPath);
assert.ok(metadata.isFile() && !metadata.isSymbolicLink() && (metadata.mode & 0o777) === 0o600, "Use a private mode-0600 configuration file");
const config = JSON.parse(await readFile(configPath, "utf8"));
assert.ok(typeof config.key === "string" && config.key.length > 0, "Azure key is required");
const source = await readFile(path.join(root, "samples/jfk.wav"));
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-azure-asr-live-"));
const observations = [];
try {
  const modulePath = path.join(temp, "providers.mjs");
  await build({
    stdin: { contents: 'export * from "./src/main/learning-asr/providers.ts"; export { parsePcmWav } from "./src/main/learning-asr/audio-windows.ts";', resolveDir: root, loader: "ts" },
    bundle: true, platform: "node", format: "esm", outfile: modulePath, logLevel: "silent",
  });
  const { createLearningAsrProvider, parsePcmWav } = await import(pathToFileURL(modulePath).href);
  const pcm = parsePcmWav(source);
  const fetcher = async (url, init) => {
    const response = await fetch(url, init);
    const endpoint = new URL(url);
    observations.push({ host: endpoint.hostname, path: endpoint.pathname, status: response.status });
    return response;
  };
  const provider = createLearningAsrProvider(engine, { azure: { key: config.key, endpoint: config.endpoint, region: config.region } }, fetcher);
  const started = Date.now();
  const result = await provider.transcribe(source, { format: "wav", language: "en-US", duration: pcm.frameCount / pcm.sampleRate, signal: AbortSignal.timeout(120_000) });
  assert.ok(result.transcript.toLowerCase().includes("country"), "Expected JFK reference content");
  assert.ok(result.segments.length > 0, "Expected Azure phrase timestamps");
  console.info(JSON.stringify({ check: "azure-asr-live", status: "pass", engine, model: provider.model, durationMs: Date.now() - started, sourceSha256: createHash("sha256").update(source).digest("hex"), observations, result }));
} catch (error) {
  console.info(JSON.stringify({ check: "azure-asr-live", status: "fail", engine, code: typeof error.code === "string" ? error.code : "check_failed", observations }));
  process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
