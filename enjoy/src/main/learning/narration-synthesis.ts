import { spawn, type ChildProcess } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import ffmpegPath from "ffmpeg-static";

import { NativeAgentError } from "../agents/native-types";
import {
  MAX_SPEECH_BYTES,
  SpeechProviderError,
  type SpeechProvider,
  type SpeechSynthesisResult,
} from "../speech/provider";
import { splitNarrationText } from "./narration-chunks";

const FFMPEG_TIMEOUT_MS = 30_000;
const PROCESS_KILL_GRACE_MS = 1_000;
const MAX_AUDIO_DURATION_SECONDS = 2 * 60 * 60;
const TEMP_DIRECTORY_PREFIX = "narration-";
const OUTPUT_LIMIT_RESERVE_BYTES = 1024 * 1024;
const FFMPEG_OUTPUT_LIMIT_BYTES = MAX_SPEECH_BYTES - OUTPUT_LIMIT_RESERVE_BYTES;
const OUTPUT_TRUNCATION_GUARD_BYTES = 1024 * 1024;

type AudioChunk = Readonly<{
  bytes: Buffer;
  extension: "mp3" | "wav";
  result: SpeechSynthesisResult;
}>;

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new NativeAgentError("native_cancelled");
}

function audioExtension(mimeType: SpeechSynthesisResult["mimeType"]): AudioChunk["extension"] {
  if (mimeType === "audio/mpeg") return "mp3";
  if (mimeType === "audio/wav") return "wav";
  throw new SpeechProviderError("speech_failed", "Speech provider returned an unsupported audio type");
}

function resolveFfmpegPath(): string {
  if (typeof ffmpegPath !== "string" || !path.isAbsolute(ffmpegPath)) {
    throw new NativeAgentError("native_process_failed");
  }
  return ffmpegPath.includes("app.asar.unpacked")
    ? ffmpegPath
    : ffmpegPath.replace("app.asar", "app.asar.unpacked");
}

function groupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitForGroupGone(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!groupExists(pid)) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  return !groupExists(pid);
}

async function terminateProcessGroup(child: ChildProcess): Promise<boolean> {
  const pid = child.pid;
  if (typeof pid !== "number" || pid <= 1) {
    try { child.kill("SIGKILL"); } catch { /* The process has already exited. */ }
    return true;
  }
  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      });
      await new Promise<void>((resolve) => {
        killer.once("error", resolve);
        killer.once("close", () => resolve());
      });
    } catch {
      try { child.kill("SIGKILL"); } catch { /* The process has already exited. */ }
    }
    return true;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try { child.kill("SIGTERM"); } catch { /* The process has already exited. */ }
  }
  if (await waitForGroupGone(pid, PROCESS_KILL_GRACE_MS)) return true;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try { child.kill("SIGKILL"); } catch { /* The process has already exited. */ }
  }
  return waitForGroupGone(pid, PROCESS_KILL_GRACE_MS);
}

function inspectPcmWav(bytes: Buffer): { durationSeconds: number } {
  if (
    bytes.length < 44
    || bytes.toString("ascii", 0, 4) !== "RIFF"
    || bytes.toString("ascii", 8, 12) !== "WAVE"
  ) throw new NativeAgentError("native_process_failed");

  let offset = 12;
  let byteRate = 0;
  let dataBytes = -1;
  let pcm = false;
  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString("ascii", offset, offset + 4);
    const chunkLength = bytes.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;
    const bodyEnd = bodyStart + chunkLength;
    if (bodyEnd > bytes.length) throw new NativeAgentError("native_process_failed");
    if (chunkId === "fmt " && chunkLength >= 16) {
      pcm = bytes.readUInt16LE(bodyStart) === 1;
      byteRate = bytes.readUInt32LE(bodyStart + 8);
    } else if (chunkId === "data") {
      dataBytes = chunkLength;
    }
    offset = bodyEnd + (chunkLength % 2);
  }
  if (!pcm || byteRate <= 0 || dataBytes < 0) throw new NativeAgentError("native_process_failed");
  return { durationSeconds: dataBytes / byteRate };
}

async function runFfmpeg(
  executable: string,
  args: readonly string[],
  cwd: string,
  signal: AbortSignal,
): Promise<void> {
  assertNotAborted(signal);
  const child = spawn(executable, args, {
    cwd,
    detached: process.platform !== "win32",
    env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });

  let timedOut = false;
  let cancelled = false;
  let cleanupVerified = true;
  let termination: Promise<boolean> | undefined;
  let resolveStopped!: (verified: boolean) => void;
  const stopped = new Promise<boolean>((resolve) => {
    resolveStopped = resolve;
  });
  const stop = (): Promise<boolean> => {
    if (!termination) {
      termination = terminateProcessGroup(child);
      void termination.then(resolveStopped);
    }
    return termination;
  };
  const abort = (): void => {
    cancelled = true;
    void stop();
  };
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    void stop();
  }, FFMPEG_TIMEOUT_MS);

  let spawnError: unknown;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("error", (error) => {
      spawnError = error;
      resolve({ code: null, signal: null });
    });
    child.once("close", (code, closeSignal) => resolve({ code, signal: closeSignal }));
  });
  const outcome = await Promise.race([
    exited.then((exit) => ({ kind: "exit" as const, exit })),
    stopped.then((verified) => ({ kind: "stopped" as const, verified })),
  ]);
  clearTimeout(timer);
  signal.removeEventListener("abort", abort);
  if (termination) cleanupVerified = await termination;
  if (!cleanupVerified) throw new NativeAgentError("native_cleanup_failed", async () => {
    if (!await terminateProcessGroup(child)) throw new Error("Process group is still running");
  });
  if (cancelled || signal.aborted) throw new NativeAgentError("native_cancelled");
  if (timedOut) throw new NativeAgentError("native_timeout");
  if (outcome.kind !== "exit" || spawnError || outcome.exit.code !== 0 || outcome.exit.signal !== null) {
    throw new NativeAgentError("native_process_failed");
  }
}

async function mergeChunks(
  chunks: readonly AudioChunk[],
  privateHome: string,
  signal: AbortSignal,
): Promise<SpeechSynthesisResult> {
  const executable = resolveFfmpegPath();
  try {
    await access(executable, fsConstants.X_OK);
  } catch {
    throw new NativeAgentError("native_process_failed");
  }

  let tempDirectory: string | undefined;
  let failure: unknown;
  try {
    assertNotAborted(signal);
    tempDirectory = await mkdtemp(path.join(privateHome, TEMP_DIRECTORY_PREFIX));
    await chmod(tempDirectory, 0o700);
    const fileNames: string[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      assertNotAborted(signal);
      const fileName = `chunk-${String(index).padStart(6, "0")}.${chunks[index].extension}`;
      await writeFile(path.join(tempDirectory, fileName), chunks[index].bytes, { mode: 0o600, flag: "wx" });
      fileNames.push(fileName);
    }
    const concatList = fileNames.map((fileName) => `file '${fileName}'`).join("\n") + "\n";
    await writeFile(path.join(tempDirectory, "chunks.txt"), concatList, { mode: 0o600, flag: "wx" });
    await writeFile(path.join(tempDirectory, "merged.wav"), Buffer.alloc(0), { mode: 0o600, flag: "wx" });
    await runFfmpeg(executable, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-protocol_whitelist", "file,pipe",
      "-f", "concat", "-safe", "1", "-i", "chunks.txt",
      "-map", "0:a:0", "-vn", "-sn", "-dn",
      "-t", String(MAX_AUDIO_DURATION_SECONDS),
      "-fs", String(FFMPEG_OUTPUT_LIMIT_BYTES),
      "-c:a", "pcm_s16le", "-f", "wav", "merged.wav",
    ], tempDirectory, signal);
    assertNotAborted(signal);
    const bytes = await readFile(path.join(tempDirectory, "merged.wav"));
    if (
      bytes.length === 0
      || bytes.length > MAX_SPEECH_BYTES
      || bytes.length >= FFMPEG_OUTPUT_LIMIT_BYTES - OUTPUT_TRUNCATION_GUARD_BYTES
    ) {
      throw new SpeechProviderError("speech_failed", "Merged narration exceeds the audio size limit");
    }
    const inspection = inspectPcmWav(bytes);
    if (!Number.isFinite(inspection.durationSeconds) || inspection.durationSeconds >= MAX_AUDIO_DURATION_SECONDS) {
      throw new SpeechProviderError("speech_failed", "Merged narration exceeds the duration limit");
    }
    const first = chunks[0].result;
    return { bytes, mimeType: "audio/wav", engine: first.engine, model: first.model, voice: first.voice };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (tempDirectory) {
      const cleanup = async (): Promise<void> => {
        await rm(tempDirectory!, { recursive: true, force: true });
      };
      if (failure instanceof NativeAgentError && failure.code === "native_cleanup_failed") {
        const processCleanup = failure.cleanup;
        // eslint-disable-next-line no-unsafe-finally -- Retain cleanup ownership instead of reporting an incomplete cancellation.
        throw new NativeAgentError("native_cleanup_failed", async () => {
          await processCleanup?.();
          await cleanup();
        });
      }
      try {
        await cleanup();
      } catch {
        // eslint-disable-next-line no-unsafe-finally -- A successful synthesis is not accepted until private temporary files are cleaned up.
        throw new NativeAgentError("native_cleanup_failed", cleanup);
      }
    }
  }
}

export async function synthesizeNarration(input: {
  provider: SpeechProvider;
  text: string;
  privateHome: string;
  signal: AbortSignal;
}): Promise<SpeechSynthesisResult> {
  assertNotAborted(input.signal);
  if (!path.isAbsolute(input.privateHome) || input.privateHome.includes("\0")) {
    throw new NativeAgentError("native_workspace_failed");
  }
  const expectedModel = input.provider.model;
  const expectedVoice = input.provider.voice;
  const sourceChunks = splitNarrationText(input.text);
  const synthesized: AudioChunk[] = [];
  let cumulativeBytes = 0;
  let expectedEngine: SpeechSynthesisResult["engine"] | undefined;

  for (const chunk of sourceChunks) {
    if (!/\S/u.test(chunk.text)) continue;
    assertNotAborted(input.signal);
    if (input.provider.model !== expectedModel || input.provider.voice !== expectedVoice) {
      throw new SpeechProviderError("speech_failed", "Speech provider configuration changed during narration synthesis");
    }
    const result = await input.provider.synthesize(chunk.text, { signal: input.signal });
    assertNotAborted(input.signal);
    if (
      input.provider.model !== expectedModel
      || input.provider.voice !== expectedVoice
      || result.model !== expectedModel
      || result.voice !== expectedVoice
      || (expectedEngine !== undefined && result.engine !== expectedEngine)
    ) {
      throw new SpeechProviderError("speech_failed", "Speech provider configuration changed during narration synthesis");
    }
    if (!Buffer.isBuffer(result.bytes) || result.bytes.length === 0) {
      throw new SpeechProviderError("speech_failed", "Speech provider returned invalid audio bytes");
    }
    cumulativeBytes += result.bytes.length;
    if (cumulativeBytes > MAX_SPEECH_BYTES) {
      throw new SpeechProviderError("speech_failed", "Narration exceeds the audio size limit");
    }
    expectedEngine = result.engine;
    synthesized.push({ bytes: Buffer.from(result.bytes), extension: audioExtension(result.mimeType), result });
  }

  assertNotAborted(input.signal);
  if (synthesized.length === 1) return synthesized[0].result;
  if (synthesized.length === 0) {
    throw new SpeechProviderError("speech_failed", "Narration contains no synthesizable text");
  }
  return mergeChunks(synthesized, input.privateHome, input.signal);
}
