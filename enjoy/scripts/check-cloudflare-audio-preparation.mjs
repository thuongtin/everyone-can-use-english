import assert from "node:assert/strict";
import { access, mkdtemp, open, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import ffmpegBinary from "ffmpeg-static";
import ffprobeBinary from "@andrkrn/ffprobe-static";
import {
  MAX_AUDIO_SECONDS as workerMaxAudioSeconds,
  parseMp3 as parseWorkerMp3,
} from "../../services/enjoy-workers-ai/src/index.js";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-cloudflare-audio-"));
const cache = path.join(temp, "cache");
const outside = path.join(temp, "outside");

const writeSparseWav = async (filePath, seconds, channels = 1) => {
  const sampleRate = 16_000;
  const dataLength = seconds * sampleRate * channels * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);
  const handle = await open(filePath, "wx");
  try {
    await handle.write(header, 0, header.length, 0);
    await handle.truncate(44 + dataLength);
  } finally {
    await handle.close();
  }
};

try {
  await Promise.all([
    access(ffmpegBinary),
    access(ffprobeBinary),
    import("node:fs/promises").then(({ mkdir }) => Promise.all([
      mkdir(cache, { recursive: true }),
      mkdir(outside, { recursive: true }),
    ])),
  ]);
  const output = path.join(temp, "preparation.mjs");
  await build({
    stdin: {
      contents: `export * from "./src/main/cloudflare-transcribe/preparation.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
    plugins: [{
      name: "static-media-binaries",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^ffmpeg-static$/u }, () => ({
          path: "ffmpeg-static",
          namespace: "media-binary",
        }));
        buildApi.onResolve({ filter: /^@andrkrn\/ffprobe-static$/u }, () => ({
          path: "ffprobe-static",
          namespace: "media-binary",
        }));
        buildApi.onLoad({ filter: /.*/u, namespace: "media-binary" }, args => ({
          contents: `export default ${JSON.stringify(args.path === "ffmpeg-static" ? ffmpegBinary : ffprobeBinary)};`,
          loader: "js",
        }));
      },
    }],
  });
  const api = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
  assert.equal(api.MAX_CLOUDFLARE_SOURCE_BYTES, 240_000_000);
  assert.equal(api.CLOUDFLARE_TRANSCODE_TIMEOUT_MS, 480_000);

  const resolveAudioUrl = audioUrl => path.join(cache, decodeURIComponent(audioUrl.split("/").at(-1)));
  const common = { cacheRoot: cache, resolveAudioUrl, ffmpegBinary, ffprobeBinary };

  const shortWav = path.join(cache, "short.wav");
  await writeSparseWav(shortWav, 1);
  const shortPrepared = await api.prepareCloudflareAudio(
    "enjoy://library/cache/short.wav",
    common
  );
  assert.equal(shortPrepared.format, "mp3");
  assert.ok(shortPrepared.duration >= 1 && shortPrepared.duration < 2);

  const longWav = path.join(cache, "whole-53m.wav");
  await writeSparseWav(longWav, 53 * 60 + 57);
  const originalSize = (await stat(longWav)).size;
  const prepared = await api.prepareCloudflareAudio(
    "enjoy://library/cache/whole-53m.wav",
    common
  );
  assert.equal(prepared.format, "mp3");
  assert.ok(prepared.duration >= 3_236 && prepared.duration <= 3_239);
  assert.ok(prepared.audio.length > 20_000_000);
  assert.ok(prepared.audio.length <= 30_000_000);
  const workerLongDuration = parseWorkerMp3(prepared.audio).duration;
  assert.ok(workerLongDuration >= 3_237 && workerLongDuration <= 3_238);
  assert.ok(workerLongDuration <= workerMaxAudioSeconds);
  assert.equal((await stat(longWav)).size, originalSize);
  assert.equal((await readdir(cache)).some(name => name.startsWith("cloudflare-transcribe-")), false);

  const boundaryWav = path.join(cache, "boundary-3600s.wav");
  await writeSparseWav(boundaryWav, 3_600);
  const boundaryPrepared = await api.prepareCloudflareAudio(
    "enjoy://library/cache/boundary-3600s.wav",
    common
  );
  const workerBoundaryDuration = parseWorkerMp3(boundaryPrepared.audio).duration;
  assert.ok(workerBoundaryDuration >= 3_600);
  assert.ok(workerBoundaryDuration <= workerMaxAudioSeconds);

  const tooLong = path.join(cache, "too-long.wav");
  await writeSparseWav(tooLong, 3_602);
  await assert.rejects(
    api.prepareCloudflareAudio("enjoy://library/cache/too-long.wav", common),
    error => error.code === "cf_invalid_audio" && /60 minute/i.test(error.message)
  );

  const oversized = path.join(cache, "oversized.wav");
  await writeFile(oversized, Buffer.from("RIFF"));
  const oversizedHandle = await open(oversized, "r+");
  await oversizedHandle.truncate(api.MAX_CLOUDFLARE_SOURCE_BYTES + 1);
  await oversizedHandle.close();
  await assert.rejects(
    api.prepareCloudflareAudio("enjoy://library/cache/oversized.wav", common),
    error => error.code === "cf_invalid_audio" && /source audio is too large/i.test(error.message)
  );

  const outsideWav = path.join(outside, "escape.wav");
  await writeSparseWav(outsideWav, 1);
  await symlink(outsideWav, path.join(cache, "escape.wav"));
  await assert.rejects(
    api.prepareCloudflareAudio("enjoy://library/cache/escape.wav", common),
    error => error.code === "cf_invalid_audio" && /symbolic links/i.test(error.message)
  );
  await assert.rejects(
    api.prepareCloudflareAudio("file:///outside.wav", common),
    error => error.code === "cf_invalid_audio" && /trusted cache/i.test(error.message)
  );

  const cancelWav = path.join(cache, "cancel.wav");
  await writeSparseWav(cancelWav, 3_600, 2);
  const controller = new AbortController();
  const cancellation = api.prepareCloudflareAudio(
    "enjoy://library/cache/cancel.wav",
    { ...common, signal: controller.signal }
  );
  setTimeout(() => controller.abort(), 1);
  await assert.rejects(
    cancellation,
    error => error.code === "cf_failed" && /cancelled/i.test(error.message)
  );
  assert.equal((await readdir(cache)).some(name => name.startsWith("cloudflare-transcribe-")), false);

  console.log(
    `Cloudflare audio preparation checks passed (Worker parser: 53:57=${workerLongDuration.toFixed(3)}s, boundary=${workerBoundaryDuration.toFixed(3)}s).`
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
