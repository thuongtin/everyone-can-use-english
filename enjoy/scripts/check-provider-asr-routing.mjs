import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), "enjoy-provider-asr-routing-"),
);

try {
  const selectionOutput = path.join(temporaryDirectory, "selection.mjs");
  await build({
    entryPoints: [path.join(root, "src/lib/provider-selection-migration.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: selectionOutput,
    logLevel: "silent",
  });
  const selection = await import(
    `${pathToFileURL(selectionOutput).href}?test=${Date.now()}`
  );

  for (const legacy of ["enjoy_azure", "enjoy_cloudflare"]) {
    assert.deepEqual(selection.resolveTranscriptionProviderSelection(legacy), {
      status: "needs-selection",
      reason: "legacy-provider",
    });
  }
  assert.deepEqual(selection.resolveTranscriptionProviderSelection(null), {
    status: "unconfigured",
  });
  for (const configured of [
    "local",
    "cloudflare_workers_ai",
    "mai_transcribe",
    "azure_mai",
    "azure_speech",
    "openai",
  ]) {
    assert.deepEqual(
      selection.resolveTranscriptionProviderSelection(configured),
      { status: "configured", value: configured },
    );
  }

  const providerOutput = path.join(temporaryDirectory, "providers.mjs");
  await build({
    entryPoints: [path.join(root, "src/main/learning-asr/providers.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: providerOutput,
    logLevel: "silent",
  });
  const providers = await import(
    `${pathToFileURL(providerOutput).href}?test=${Date.now()}`
  );
  assert.throws(
    () =>
      providers.createLearningAsrProvider("openai", {
        openai: {
          key: "must-not-leak",
          baseUrl: "https://api.enjoy.bot/v1",
          model: "whisper-1",
        },
      }),
    (error) =>
      error?.code === "retired_enjoy_host" &&
      !error.message.includes("must-not-leak"),
  );

  const hookSource = await readFile(
    path.join(root, "src/renderer/hooks/use-transcribe.tsx"),
    "utf8",
  );
  for (const retiredPath of [
    "AI_WORKER_ENDPOINT",
    "generateSpeechToken",
    "transcribeByAzureAi",
    "transcribeByCloudflareAi",
    "dangerouslyAllowBrowser",
    "EnjoyApp.maiTranscribe",
    "EnjoyApp.cloudflareTranscribe",
  ]) {
    assert.equal(
      hookSource.includes(retiredPath),
      false,
      `Renderer transcription must not retain ${retiredPath}`,
    );
  }
  assert.match(hookSource, /EnjoyApp\.learningAsr\.start/u);
  assert.match(hookSource, /profileId,/u);
  assert.match(hookSource, /connectionId,/u);
  assert.match(hookSource, /resolveTranscriptionProviderSelection/u);

  const chatFormSource = await readFile(
    path.join(root, "src/renderer/components/chats/chat-form.tsx"),
    "utf8",
  );
  assert.doesNotMatch(chatFormSource, /ENJOY_(?:AZURE|CLOUDFLARE)/u);
  for (const engine of [
    "LOCAL",
    "CLOUDFLARE_WORKERS_AI",
    "MAI_TRANSCRIBE",
    "AZURE_MAI",
    "AZURE_SPEECH",
    "OPENAI",
  ]) {
    assert.match(chatFormSource, new RegExp(`SttEngineOptionEnum\\.${engine}`, "u"));
  }

  const listSource = await readFile(
    path.join(
      root,
      "src/renderer/components/transcriptions/transcriptions-list.tsx",
    ),
    "utf8",
  );
  assert.doesNotMatch(listSource, /webApi|DownloadCloud|downloadTranscriptFromCloud/u);

  for (const ipcPath of ["src/main/cloudflare-transcribe/ipc.ts"]) {
    const ipcSource = await readFile(path.join(root, ipcPath), "utf8");
    assert.doesNotMatch(
      ipcSource,
      /ipcMain\.handle\(START_CHANNEL/u,
      `${ipcPath} must not expose a direct inference channel`,
    );
    assert.doesNotMatch(
      ipcSource,
      /ipcMain\.handle\(CANCEL_CHANNEL/u,
      `${ipcPath} must not expose a direct cancellation channel`,
    );
  }

  const learningAsrIpcSource = await readFile(
    path.join(root, "src/main/learning-asr/ipc.ts"),
    "utf8",
  );
  assert.match(learningAsrIpcSource, /runtime\.scope\.registerCancellation/u);
  assert.match(learningAsrIpcSource, /runtime\.scope\.run/u);
  assert.match(learningAsrIpcSource, /getRuntime\(\) !== runtime/u);
  assert.doesNotMatch(learningAsrIpcSource, /settings\.userDataPath\(\)/u);

  const transcriptionHookSource = await readFile(
    path.join(root, "src/renderer/hooks/use-transcriptions.tsx"),
    "utf8",
  );
  assert.match(transcriptionHookSource, /boundConnection\.profileId !== connectionRef\.current\.profileId/u);
  assert.match(transcriptionHookSource, /boundConnection\.connectionId !== connectionRef\.current\.connectionId/u);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log("Provider ASR routing checks passed.");
