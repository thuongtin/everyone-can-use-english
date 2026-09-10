import { execFile as execFileCallback } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import ffprobePath from "@andrkrn/ffprobe-static";
import ffmpegPath from "ffmpeg-static";

import {
  CloudflareTranscribeError,
  MAX_CLOUDFLARE_AUDIO_BYTES,
  MAX_CLOUDFLARE_AUDIO_SECONDS,
} from "./service";

export const MAX_CLOUDFLARE_SOURCE_BYTES = 240_000_000;
export const CLOUDFLARE_TRANSCODE_TIMEOUT_MS = 8 * 60_000;
const PROBE_TIMEOUT_MS = 30_000;
const PROBE_OUTPUT_BYTES = 64 * 1024;
const TEMP_DIRECTORY_PREFIX = "cloudflare-transcribe-";

const execFile = promisify(execFileCallback);

export type PreparedCloudflareAudio = Readonly<{
  audio: Buffer;
  format: "mp3";
  duration: number;
}>;

export type PrepareCloudflareAudioOptions = Readonly<{
  cacheRoot: string;
  resolveAudioUrl: (audioUrl: string) => string;
  signal?: AbortSignal;
  ffmpegBinary?: string;
  ffprobeBinary?: string;
  transcodeTimeoutMs?: number;
}>;

type AudioProbe = Readonly<{
  codec: string;
  sampleRate: number;
  channels: number;
  bitRate: number | null;
  duration: number;
  format: string;
}>;

function invalidAudio(message: string): CloudflareTranscribeError {
  return new CloudflareTranscribeError("cf_invalid_audio", message);
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new CloudflareTranscribeError("cf_failed", "Transcription was cancelled.");
  }
}

function unpackedBinary(candidate: unknown, name: string): string {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) {
    throw new CloudflareTranscribeError("cf_failed", `${name} is unavailable.`);
  }
  return candidate.includes("app.asar.unpacked")
    ? candidate
    : candidate.replace("app.asar", "app.asar.unpacked");
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

async function probeAudio(
  binary: string,
  filePath: string,
  signal?: AbortSignal
): Promise<AudioProbe> {
  assertNotAborted(signal);
  let stdout: string;
  try {
    const result = await execFile(
      binary,
      [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        "-select_streams",
        "a:0",
        "-show_entries",
        "format=format_name,duration,bit_rate:stream=codec_name,sample_rate,channels,duration,bit_rate",
        filePath,
      ],
      {
        env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
        killSignal: "SIGKILL",
        maxBuffer: PROBE_OUTPUT_BYTES,
        signal,
        timeout: PROBE_TIMEOUT_MS,
        windowsHide: true,
      }
    );
    stdout = result.stdout;
  } catch (error) {
    if (signal?.aborted) {
      throw new CloudflareTranscribeError("cf_failed", "Transcription was cancelled.");
    }
    throw invalidAudio("The audio file could not be inspected.");
  }

  let parsed: {
    format?: { format_name?: unknown; duration?: unknown; bit_rate?: unknown };
    streams?: Array<{
      codec_name?: unknown;
      sample_rate?: unknown;
      channels?: unknown;
      duration?: unknown;
      bit_rate?: unknown;
    }>;
  };
  try {
    parsed = JSON.parse(stdout) as typeof parsed;
  } catch {
    throw invalidAudio("The audio probe returned invalid metadata.");
  }
  const stream = parsed.streams?.[0];
  const duration = numberValue(parsed.format?.duration) ?? numberValue(stream?.duration);
  const sampleRate = numberValue(stream?.sample_rate);
  const channels = numberValue(stream?.channels);
  const bitRate = numberValue(stream?.bit_rate) ?? numberValue(parsed.format?.bit_rate);
  if (!stream || duration === null || sampleRate === null || channels === null) {
    throw invalidAudio("The audio metadata is incomplete.");
  }
  return {
    codec: typeof stream.codec_name === "string" ? stream.codec_name : "",
    sampleRate,
    channels,
    bitRate,
    duration,
    format: typeof parsed.format?.format_name === "string" ? parsed.format.format_name : "",
  };
}

function validateDuration(duration: number): void {
  if (duration <= 0 || duration > MAX_CLOUDFLARE_AUDIO_SECONDS) {
    throw invalidAudio("The audio exceeds the 60 minute limit.");
  }
}

async function resolveSource(
  audioUrl: string,
  cacheRootValue: string,
  resolveAudioUrl: (audioUrl: string) => string
): Promise<{ cacheRoot: string; sourcePath: string }> {
  if (!audioUrl.startsWith("enjoy://library/cache/")) {
    throw invalidAudio("Cloudflare transcription only accepts trusted cache audio.");
  }
  let cacheRoot: string;
  let requestedPath: string;
  let sourcePath: string;
  try {
    cacheRoot = await realpath(cacheRootValue);
    requestedPath = resolveAudioUrl(audioUrl);
    const requestedStat = await lstat(requestedPath);
    if (requestedStat.isSymbolicLink()) {
      throw invalidAudio("Symbolic links are not accepted as transcription audio.");
    }
    sourcePath = await realpath(requestedPath);
  } catch (error) {
    if (error instanceof CloudflareTranscribeError) throw error;
    throw invalidAudio("The audio file could not be read.");
  }
  const relative = path.relative(cacheRoot, sourcePath);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    path.extname(sourcePath).toLowerCase() !== ".wav"
  ) {
    throw invalidAudio("The audio is outside the trusted cache.");
  }
  const sourceStat = await stat(sourcePath);
  if (!sourceStat.isFile()) throw invalidAudio("The audio is not a file.");
  if (sourceStat.size <= 0 || sourceStat.size > MAX_CLOUDFLARE_SOURCE_BYTES) {
    throw invalidAudio("The source audio is too large.");
  }
  return { cacheRoot, sourcePath };
}

async function transcode(
  binary: string,
  sourcePath: string,
  outputPath: string,
  signal: AbortSignal | undefined,
  timeout: number
): Promise<void> {
  assertNotAborted(signal);
  try {
    await execFile(
      binary,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-i",
        sourcePath,
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-dn",
        "-map_metadata",
        "-1",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "64k",
        "-f",
        "mp3",
        outputPath,
      ],
      {
        env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
        killSignal: "SIGKILL",
        maxBuffer: PROBE_OUTPUT_BYTES,
        signal,
        timeout,
        windowsHide: true,
      }
    );
  } catch (error) {
    if (signal?.aborted) {
      throw new CloudflareTranscribeError("cf_failed", "Transcription was cancelled.");
    }
    const timedOut = (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true;
    if (timedOut) {
      throw new CloudflareTranscribeError("cf_timeout", "Audio preparation timed out.");
    }
    throw invalidAudio("The audio could not be prepared for Cloudflare.");
  }
}

export async function prepareCloudflareAudio(
  audioUrl: string,
  options: PrepareCloudflareAudioOptions
): Promise<PreparedCloudflareAudio> {
  assertNotAborted(options.signal);
  const { cacheRoot, sourcePath } = await resolveSource(
    audioUrl,
    options.cacheRoot,
    options.resolveAudioUrl
  );
  const ffmpeg = unpackedBinary(options.ffmpegBinary ?? ffmpegPath, "ffmpeg");
  const ffprobe = unpackedBinary(options.ffprobeBinary ?? ffprobePath, "ffprobe");
  try {
    await Promise.all([
      access(ffmpeg, fsConstants.X_OK),
      access(ffprobe, fsConstants.X_OK),
    ]);
  } catch {
    throw new CloudflareTranscribeError("cf_failed", "Audio preparation tools are unavailable.");
  }

  const source = await probeAudio(ffprobe, sourcePath, options.signal);
  validateDuration(source.duration);
  if (
    source.codec !== "pcm_s16le" ||
    source.sampleRate !== 16_000 ||
    (source.channels !== 1 && source.channels !== 2) ||
    !source.format.split(",").includes("wav")
  ) {
    throw invalidAudio("Cloudflare transcription requires 16 kHz mono or stereo PCM16 WAV audio.");
  }

  let temporaryDirectory: string | undefined;
  try {
    assertNotAborted(options.signal);
    temporaryDirectory = await mkdtemp(path.join(cacheRoot, TEMP_DIRECTORY_PREFIX));
    const outputPath = path.join(temporaryDirectory, "audio.mp3");
    await transcode(
      ffmpeg,
      sourcePath,
      outputPath,
      options.signal,
      options.transcodeTimeoutMs ?? CLOUDFLARE_TRANSCODE_TIMEOUT_MS
    );
    assertNotAborted(options.signal);
    const output = await probeAudio(ffprobe, outputPath, options.signal);
    validateDuration(output.duration);
    if (
      output.codec !== "mp3" ||
      output.sampleRate !== 16_000 ||
      output.channels !== 1 ||
      output.bitRate === null ||
      output.bitRate < 56_000 ||
      output.bitRate > 72_000 ||
      !output.format.split(",").includes("mp3") ||
      Math.abs(output.duration - source.duration) > 2
    ) {
      throw invalidAudio("The prepared Cloudflare audio is invalid.");
    }
    const outputStat = await stat(outputPath);
    if (!outputStat.isFile() || outputStat.size <= 0 || outputStat.size > MAX_CLOUDFLARE_AUDIO_BYTES) {
      throw invalidAudio("The prepared audio is too large for one Cloudflare Worker request.");
    }
    const audio = await readFile(outputPath);
    if (audio.length !== outputStat.size || audio.length > MAX_CLOUDFLARE_AUDIO_BYTES) {
      throw invalidAudio("The prepared audio could not be read safely.");
    }
    return { audio, format: "mp3", duration: output.duration };
  } finally {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}
