import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-cloudflare-transcribe-"));

try {
  const output = path.join(temp, "service.mjs");
  await build({
    stdin: {
      contents: `export * from "./src/main/cloudflare-transcribe/service.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });
  const api = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
  assert.equal(api.CLOUDFLARE_TRANSCRIBE_MODEL, "@cf/openai/whisper-large-v3-turbo");
  assert.equal(api.MAX_CLOUDFLARE_AUDIO_BYTES, 30_000_000);
  assert.equal(api.MAX_CLOUDFLARE_RESPONSE_BYTES, 2_000_000);
  assert.equal(api.MAX_CLOUDFLARE_AUDIO_SECONDS, 3_601);
  assert.equal(api.DEFAULT_CLOUDFLARE_REQUEST_TIMEOUT_MS, 960_000);
  assert.equal(
    api.normalizeCloudflareBaseUrl("https://Enjoy-Test.Example.workers.dev/"),
    "https://enjoy-test.example.workers.dev"
  );
  for (const invalid of [
    "http://demo.example.workers.dev",
    "https://workers.dev",
    "https://demo.example.workers.dev/path",
    "https://demo.example.workers.dev?token=x",
    "https://user:pass@demo.example.workers.dev",
    "https://demo.example.com",
  ]) {
    assert.throws(() => api.normalizeCloudflareBaseUrl(invalid));
  }

  assert.deepEqual(
    api.normalizeCloudflareTranscribeResponse({
      ok: true,
      result: { text: " Hello. ", segments: [{ text: "Hello.", start: 0, end: 1 }] },
    }),
    { transcript: "Hello.", segments: [{ text: "Hello.", start: 0, end: 1 }] }
  );
  assert.deepEqual(
    api.normalizeCloudflareTranscribeResponse({
      ok: true,
      result: { text: "Use DTW.", segments: [{ text: "bad", start: 2, end: 1 }] },
    }),
    { transcript: "Use DTW.", segments: [] }
  );
  assert.throws(
    () => api.normalizeCloudflareTranscribeResponse({ text: "wrong envelope" }),
    (error) => error.code === "cf_invalid_response"
  );
  const oversizedBody = "x".repeat(api.MAX_CLOUDFLARE_RESPONSE_BYTES + 1);
  await assert.rejects(
    api.readBoundedCloudflareResponse(new Response(oversizedBody)),
    error => error.code === "cf_invalid_response"
  );
  await assert.rejects(
    api.readBoundedCloudflareResponse(
      new Response(oversizedBody, { headers: { "content-length": "1" } })
    ),
    error => error.code === "cf_invalid_response"
  );
  await assert.rejects(
    api.readBoundedCloudflareResponse(
      new Response("small", { headers: { "content-length": "2000001" } })
    ),
    error => error.code === "cf_invalid_response"
  );

  const calls = [];
  const progress = [];
  const wholeMp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00]);
  const service = api.createCloudflareTranscribeService({
    config: async () => ({
      baseUrl: "https://enjoy-workers-ai.ho-31c.workers.dev",
      token: "app-token-value",
    }),
    prepareAudio: async () => ({ audio: wholeMp3, format: "mp3", duration: 3_237 }),
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        ok: true,
        result: { text: "Hello.", segments: [{ text: "Hello.", start: 0, end: 1 }] },
      }), { status: 200 });
    },
  });
  const result = await service.transcribe(
    { jobId: "job-cloudflare", audioUrl: "enjoy://library/cache/audio.wav", language: "en-US" },
    { onProgress: event => progress.push(event) }
  );
  assert.equal(result.engine, "cloudflare-workers-ai");
  assert.equal(result.model, api.CLOUDFLARE_TRANSCRIBE_MODEL);
  assert.equal(result.transcript, "Hello.");
  assert.equal(calls[0].url, "https://enjoy-workers-ai.ho-31c.workers.dev/v1/transcriptions");
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.headers.Authorization, "Bearer app-token-value");
  assert.equal(calls[0].init.headers["Content-Type"], "audio/mpeg");
  assert.equal(calls[0].init.headers["X-Audio-Language"], "en");
  assert.equal(calls[0].init.body, wholeMp3);
  assert.deepEqual(Buffer.from(calls[0].init.body), wholeMp3);
  assert.equal(calls.length, 1);
  assert.deepEqual(progress.map(event => event.percent), [0, 100]);

  for (const [status, code] of [[400, "cf_invalid_audio"], [401, "cf_auth"], [403, "cf_auth"], [429, "cf_quota"], [504, "cf_timeout"], [502, "cf_failed"]]) {
    const failing = api.createCloudflareTranscribeService({
      config: async () => ({ baseUrl: "https://a.b.workers.dev", token: "app-token" }),
      prepareAudio: async () => ({ audio: wholeMp3, format: "mp3", duration: 1 }),
      fetch: async () => new Response(JSON.stringify({ ok: false, error: { code, message: "safe" } }), { status }),
    });
    await assert.rejects(
      failing.transcribe({ jobId: `job-${status}`, audioUrl: "x" }),
      error => error.code === code && !error.message.includes("app-token")
    );
  }

  const cancelled = new AbortController();
  let cancellationFetchCalled = false;
  const cancellationService = api.createCloudflareTranscribeService({
    config: async () => ({ baseUrl: "https://a.b.workers.dev", token: "app-token" }),
    prepareAudio: async () => {
      cancelled.abort();
      return { audio: wholeMp3, format: "mp3", duration: 1 };
    },
    fetch: async () => {
      cancellationFetchCalled = true;
      return new Response("{}");
    },
  });
  await assert.rejects(
    cancellationService.transcribe(
      { jobId: "job-cancelled", audioUrl: "x" },
      { signal: cancelled.signal }
    ),
    error => error.code === "cf_failed" && /cancelled/i.test(error.message)
  );
  assert.equal(cancellationFetchCalled, false);

  const retainedError = api.createCloudflareTranscribeService({
    config: async () => ({ baseUrl: "https://a.b.workers.dev", token: "app-token" }),
    prepareAudio: async () => {
      throw new api.CloudflareTranscribeError("cf_invalid_audio", "duration rejected");
    },
  });
  await assert.rejects(
    retainedError.transcribe({ jobId: "job-retained-error", audioUrl: "x" }),
    error => error.code === "cf_invalid_audio" && error.message === "duration rejected"
  );

  const timeoutService = api.createCloudflareTranscribeService({
    config: async () => ({ baseUrl: "https://a.b.workers.dev", token: "app-token" }),
    prepareAudio: async () => ({ audio: wholeMp3, format: "mp3", duration: 1 }),
    requestTimeoutMs: 5,
    fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  await assert.rejects(
    timeoutService.transcribe({ jobId: "job-request-timeout", audioUrl: "x" }),
    error => error.code === "cf_timeout"
  );

  const [configSource, ipcSource, genericSettingsSource, preloadSource, hookSource, settingsSource, formSource] = await Promise.all([
    readFile(path.join(root, "src/main/cloudflare-transcribe/config.ts"), "utf8"),
    readFile(path.join(root, "src/main/cloudflare-transcribe/ipc.ts"), "utf8"),
    readFile(path.join(root, "src/main/db/handlers/user-settings-handler.ts"), "utf8"),
    readFile(path.join(root, "src/preload.ts"), "utf8"),
    readFile(path.join(root, "src/renderer/hooks/use-transcribe.tsx"), "utf8"),
    readFile(path.join(root, "src/renderer/components/preferences/stt-settings.tsx"), "utf8"),
    readFile(path.join(root, "src/renderer/components/transcriptions/transcription-create-form.tsx"), "utf8"),
  ]);
  assert.match(configSource, /safeStorage\.encryptString/);
  assert.match(configSource, /safeStorage\.decryptString/);
  assert.match(configSource, /baseUrl !== stored\.baseUrl[\s\S]*!token/);
  assert.doesNotMatch(configSource, /token:\s*decryptToken[\s\S]*getCloudflareTranscribeConfig/);
  assert.doesNotMatch(ipcSource, /ipcMain\.handle\(START_CHANNEL/);
  assert.doesNotMatch(ipcSource, /ipcMain\.handle\(CANCEL_CHANNEL/);
  assert.match(ipcSource, /ipcMain\.handle\(CONFIG_GET_CHANNEL/);
  assert.match(ipcSource, /ipcMain\.handle\(CONFIG_SET_CHANNEL/);
  assert.match(genericSettingsSource, /isProtectedSetting\(key\)[\s\S]*getCloudflareTranscribeConfig/);
  assert.match(genericSettingsSource, /isProtectedSetting\(key\)[\s\S]*protected_user_setting/);
  assert.match(preloadSource, /cloudflare-transcribe-config-get/);
  assert.match(preloadSource, /cloudflare-transcribe-config-set/);
  assert.match(hookSource, /isLearningAsrEngine\(service\)/);
  assert.match(hookSource, /EnjoyApp\.learningAsr\.start/);
  assert.doesNotMatch(hookSource, /EnjoyApp\.cloudflareTranscribe\.start/);
  assert.match(settingsSource, /data-testid="cloudflare-worker-settings"/);
  assert.match(formSource, /data-testid="transcription-service-cloudflare-worker"/);

  console.log("Cloudflare transcription client checks passed.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
