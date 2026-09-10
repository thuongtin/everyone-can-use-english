import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { extractFile } from "@electron/asar";
import type { Page } from "@playwright/test";

import { encodePcmWindow, parsePcmWav, planAudioWindows, type AudioWindow } from "../../src/main/learning-asr/audio-windows";
import { planSeamGeometry, planTranscriptAlignment } from "../../src/main/learning-asr/service";
import type { LearningAsrResult, StudyTimelineEntry } from "../../src/types/learning-asr";
import { launchLocalApp, type LocalApp } from "./local-app";

const execFileAsync = promisify(execFile);

export const PROVIDER_FIXTURE_ENDPOINT = "https://asr-offline-fixture.workers.dev/v1/transcriptions";
export const PROVIDER_FIXTURE_BASE_URL = "https://asr-offline-fixture.workers.dev";
export const PROVIDER_FIXTURE_SENTINEL = "offline-fixture-not-a-credential";
export const PROVIDER_BOUNDARY_LABEL = "deterministic-packaged-provider-boundary-fixture";
export const JFK_REFERENCE = "And so, my fellow Americans, ask not what your country can do for you, ask what you can do for your country.";
export const SOURCE_CAPTURE_SHA256 = "07fc9a801db549f5b95da1153115a97b7bbd9e48844c317462157a3ceaa08ec4";
export const JFK_SOURCE_SHA256 = "59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e";
export const BUILD9_SERVICE_SHA256 = "4e1b2857517b5b05b2863b60a8ca971407bdb3a7ed46169fea43de16d6d718e9";
export const BUILD8_SPEECH_COVERAGE_SHA256 = "14c51da3d0e73708989d0e78b7b4d39fea3bcadc0642d93da68210f4faed2b1d";
export const YAMNET_MODEL_SHA256 = "10c95ea3eb9a7bb4cb8bddf6feb023250381008177ac162ce169694d05c317de";
export const BUILD9_ASAR_SHA256 = "953d22ad80334ecb38052e636a8e5048a7e211346c2efb21583d1892f0b0462a";

export type ProviderTranscriptFixture = Readonly<{
  transcript: string;
  segments: readonly Readonly<{ text: string; start: number; end: number }>[];
}>;

export type ProviderResponseFixture = Readonly<{
  id: string;
  format: "mp3" | "wav";
  audioSha256: string;
  response: ProviderTranscriptFixture;
  maximumCalls: number;
}>;

export type ProviderBoundaryObservation = Readonly<{
  requests: readonly Readonly<{
    ordinal: number;
    format: "mp3" | "wav" | "unknown";
    audioSha256: string;
    bytes: number;
    responseId: string | null;
    outcome: "fixture-response" | "rejected";
    sourceMatches: readonly Readonly<{ startSample: number; endSample: number }>[];
  }>[];
  rejectedUrls: readonly string[];
  undiciNetworkRequests: readonly string[];
  nodeHttpRequests: readonly string[];
}>;

export type ComposedAsrFixture = Readonly<{
  directory: string;
  sourcePath: string;
  sourceWav: Buffer;
  sourceSha256: string;
  introSeconds: number;
  silenceSeconds: number;
  separatorSeconds: number;
  tailSeconds: number;
  repeatCount: number;
  repeatStarts: readonly number[];
  duration: number;
  wholeSuccess: ProviderTranscriptFixture;
  wholeFallback: ProviderTranscriptFixture;
  cleanup(): Promise<void>;
}>;

export type PipelineManifest = Readonly<{
  wav: Buffer;
  sourceSha256: string;
  duration: number;
  sampleRate: number;
  sourceSamples: number;
  windows: readonly AudioWindow[];
  windowFixtures: readonly ProviderResponseFixture[];
  wholeMp3Sha256: string;
  wholeMp3Bytes: number;
  wholeBlocks: ReturnType<typeof planTranscriptAlignment>;
  expectedResumeIndex: number;
  expectedPrefixEndSample: number;
  expectedSeam: ReturnType<typeof planSeamGeometry>;
  windowTranscriptGeometry: readonly Readonly<{
    windowIndex: number;
    repeatIndexes: readonly number[];
    clippedPrefixRepeatIndex: number | null;
    clippedSuffixRepeatIndex: number | null;
    transcriptSha256: string;
  }>[];
}>;

export type Build9Identity = Readonly<{
  appPath: string;
  asarSha256: string;
  serviceSourceSha256: string;
  speechCoverageSourceSha256: string;
  sourceModelSha256: string;
  packagedModelSha256: string;
  codesignVerified: boolean;
}>;

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

export async function verifyBuild9Identity(options: {
  appPath: string;
  repositoryRoot: string;
}): Promise<Build9Identity> {
  const asarPath = path.join(options.appPath, "Contents/Resources/app.asar");
  const servicePath = path.join(options.repositoryRoot, "enjoy/src/main/learning-asr/service.ts");
  const speechCoveragePath = path.join(options.repositoryRoot, "enjoy/src/main/learning-asr/speech-coverage.ts");
  const sourceModelPath = path.join(options.repositoryRoot, "enjoy/lib/asr-classifier/yamnet.tflite");
  const [asar, service, speechCoverage, sourceModel] = await Promise.all([
    readFile(asarPath),
    readFile(servicePath),
    readFile(speechCoveragePath),
    readFile(sourceModelPath),
  ]);
  const packagedModel = extractFile(asarPath, ".vite/renderer/asr_classifier/model/yamnet.tflite");
  const identity = {
    appPath: options.appPath,
    asarSha256: sha256(asar),
    serviceSourceSha256: sha256(service),
    speechCoverageSourceSha256: sha256(speechCoverage),
    sourceModelSha256: sha256(sourceModel),
    packagedModelSha256: sha256(packagedModel),
    codesignVerified: false,
  };
  if (identity.asarSha256 !== BUILD9_ASAR_SHA256) throw new Error("build9_asar_identity_mismatch");
  if (identity.serviceSourceSha256 !== BUILD9_SERVICE_SHA256) throw new Error("build9_service_source_mismatch");
  if (identity.speechCoverageSourceSha256 !== BUILD8_SPEECH_COVERAGE_SHA256) throw new Error("build9_speech_coverage_source_mismatch");
  if (identity.sourceModelSha256 !== YAMNET_MODEL_SHA256 || identity.packagedModelSha256 !== YAMNET_MODEL_SHA256) {
    throw new Error("build9_yamnet_identity_mismatch");
  }
  await execFileAsync("/usr/bin/codesign", ["--verify", "--deep", "--strict", options.appPath], {
    env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
  });
  return { ...identity, codesignVerified: true };
}

function encodeMonoPcm16(sampleRate: number, pcm: Buffer): Buffer {
  const output = Buffer.allocUnsafe(44 + pcm.length);
  output.write("RIFF", 0, 4, "ascii");
  output.writeUInt32LE(36 + pcm.length, 4);
  output.write("WAVEfmt ", 8, 8, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36, 4, "ascii");
  output.writeUInt32LE(pcm.length, 40);
  pcm.copy(output, 44);
  return output;
}

function monoSlice(source: Buffer, seconds: number): Buffer {
  const parsed = parsePcmWav(source);
  if (parsed.sampleRate !== 16_000) throw new Error("fixture_source_sample_rate_changed");
  const frames = Math.min(parsed.frameCount, Math.round(seconds * parsed.sampleRate));
  const output = Buffer.allocUnsafe(frames * 2);
  for (let frame = 0; frame < frames; frame += 1) {
    let total = 0;
    for (let channel = 0; channel < parsed.channels; channel += 1) {
      total += parsed.pcm.readInt16LE(frame * parsed.blockAlign + channel * 2);
    }
    output.writeInt16LE(Math.max(-32_768, Math.min(32_767, Math.round(total / parsed.channels))), frame * 2);
  }
  return output;
}

function repeatedTranscript(count: number): string {
  return Array.from({ length: count }, () => JFK_REFERENCE).join(" ");
}

function fallbackFaultText(): string {
  return Array.from({ length: 256 }, (_unused, index) => `xylophone${index + 1}`).join(" ");
}

export async function createComposedAsrFixture(options: {
  jfkPath: string;
  sourceCapturePath: string;
}): Promise<ComposedAsrFixture> {
  const [jfk, sourceCapture] = await Promise.all([
    readFile(options.jfkPath),
    readFile(options.sourceCapturePath),
  ]);
  if (sha256(jfk) !== JFK_SOURCE_SHA256) throw new Error("jfk_fixture_source_changed");
  if (sha256(sourceCapture) !== SOURCE_CAPTURE_SHA256) throw new Error("instrumental_fixture_source_changed");
  const jfkParsed = parsePcmWav(jfk);
  if (jfkParsed.sampleRate !== 16_000 || jfkParsed.channels !== 1 || jfkParsed.frameCount !== 176_000) {
    throw new Error("jfk_fixture_geometry_changed");
  }

  const introSeconds = 3.7;
  const silenceSeconds = 41.3;
  const separatorSeconds = 29;
  const tailSeconds = 1;
  const repeatCount = 2;
  const intro = monoSlice(sourceCapture, introSeconds);
  const leadSilence = Buffer.alloc(silenceSeconds * 16_000 * 2);
  const separator = Buffer.alloc(separatorSeconds * 16_000 * 2);
  const tail = Buffer.alloc(tailSeconds * 16_000 * 2);
  const repeatStarts = [45, 85];
  const chunks: Buffer[] = [intro, leadSilence, jfkParsed.pcm, separator, jfkParsed.pcm, tail];
  const sourceWav = encodeMonoPcm16(16_000, Buffer.concat(chunks));
  const duration = parsePcmWav(sourceWav).frameCount / 16_000;
  const segments = repeatStarts.map(start => ({ text: JFK_REFERENCE, start, end: start + 11 }));
  const fallbackSegments = segments.map((segment, index) => ({
    ...segment,
    text: index === 1 ? fallbackFaultText() : segment.text,
  }));
  const directory = await mkdtemp(path.join(os.tmpdir(), "enjoy-packaged-asr-fixture-"));
  const sourcePath = path.join(directory, "deterministic-composed-fixture.wav");
  await writeFile(sourcePath, sourceWav, { mode: 0o600 });
  return {
    directory,
    sourcePath,
    sourceWav,
    sourceSha256: sha256(sourceWav),
    introSeconds,
    silenceSeconds,
    separatorSeconds,
    tailSeconds,
    repeatCount,
    repeatStarts,
    duration,
    wholeSuccess: { transcript: repeatedTranscript(repeatCount), segments },
    wholeFallback: {
      transcript: fallbackSegments.map(segment => segment.text).join(" "),
      segments: fallbackSegments,
    },
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

export async function readPipelineWav(page: Page, sourcePath: string): Promise<{
  audioUrl: string;
  wav: Buffer;
}> {
  const result = await page.evaluate(async (input) => {
    const audioUrl = await window.__ENJOY_APP__.echogarden.transcode(input);
    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error("pipeline_wav_read_failed");
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return { audioUrl, base64: btoa(binary) };
  }, sourcePath);
  return { audioUrl: result.audioUrl, wav: Buffer.from(result.base64, "base64") };
}

async function prepareWholeMp3(wav: Buffer, directory: string, ffmpegPath: string): Promise<Buffer> {
  const wavPath = path.join(directory, "pipeline.wav");
  const mp3Path = path.join(directory, "whole.mp3");
  await writeFile(wavPath, wav, { mode: 0o600 });
  await execFileAsync(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-i", wavPath,
    "-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "-1",
    "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "64k", "-f", "mp3", mp3Path,
  ], { env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" } });
  return readFile(mp3Path);
}

function transcriptForWindow(window: AudioWindow, repeatStarts: readonly number[]): {
  transcript: string;
  repeatIndexes: number[];
  clippedPrefixRepeatIndex: number | null;
  clippedSuffixRepeatIndex: number | null;
} {
  const start = window.startSample / window.sampleRate;
  const end = window.endSample / window.sampleRate;
  const parts: string[] = [];
  const repeatIndexes: number[] = [];
  let clippedPrefixRepeatIndex: number | null = null;
  let clippedSuffixRepeatIndex: number | null = null;
  for (const [repeatIndex, repeatStart] of repeatStarts.entries()) {
    const repeatEnd = repeatStart + 11;
    if (repeatEnd <= start + 1e-6 || repeatStart >= end - 1e-6) continue;
    if (repeatStart >= start - 1e-6 && repeatEnd <= end + 1e-6) {
      parts.push(JFK_REFERENCE);
      repeatIndexes.push(repeatIndex);
      continue;
    }
    const visiblePrefixSeconds = end - repeatStart;
    // Frozen offline DTW baseline for the byte-locked JFK source ends "my" at
    // 1.24s and starts "fellow" at 1.25s. This corridor keeps three complete
    // overlap anchors without claiming the clipped next word.
    if (repeatStart >= start - 1e-6 && visiblePrefixSeconds >= 1.24 && visiblePrefixSeconds < 1.6) {
      if (clippedPrefixRepeatIndex !== null) throw new Error(`fixture_window_has_multiple_clipped_prefixes:${window.index}`);
      parts.push(JFK_WINDOW_PREFIX);
      repeatIndexes.push(repeatIndex);
      clippedPrefixRepeatIndex = repeatIndex;
      continue;
    }
    const visibleSuffixSeconds = repeatEnd - start;
    // The same frozen baseline starts the final complete phrase at 9.62s. The
    // preceding "do" crosses this window edge, so it is intentionally omitted.
    if (repeatStart < start && visibleSuffixSeconds >= 1.38 && visibleSuffixSeconds < 1.5) {
      if (clippedSuffixRepeatIndex !== null) throw new Error(`fixture_window_has_multiple_clipped_suffixes:${window.index}`);
      parts.push(JFK_WINDOW_SUFFIX);
      repeatIndexes.push(repeatIndex);
      clippedSuffixRepeatIndex = repeatIndex;
      continue;
    }
    throw new Error(`fixture_window_has_unsupported_partial_speech:${window.index}:${repeatIndex}`);
  }
  if (!parts.length) return { transcript: "", repeatIndexes, clippedPrefixRepeatIndex, clippedSuffixRepeatIndex };
  return { transcript: parts.join(" "), repeatIndexes, clippedPrefixRepeatIndex, clippedSuffixRepeatIndex };
}

export async function createPipelineManifest(options: {
  wav: Buffer;
  directory: string;
  ffmpegPath: string;
  repeatStarts: readonly number[];
  wholeTranscript: ProviderTranscriptFixture;
}): Promise<PipelineManifest> {
  const parsed = parsePcmWav(options.wav);
  const duration = parsed.frameCount / parsed.sampleRate;
  const windows = planAudioWindows(parsed);
  const wholeMp3 = await prepareWholeMp3(options.wav, options.directory, options.ffmpegPath);
  const wholeBlocks = planTranscriptAlignment(options.wholeTranscript, parsed);
  if (!wholeBlocks || wholeBlocks.length < 2) throw new Error("fixture_whole_plan_not_multi_block");
  const expectedPrefixEndSample = wholeBlocks[0].endSample;
  const expectedResumeIndex = windows.findIndex(window => window.coreEndSample > expectedPrefixEndSample);
  if (expectedResumeIndex < 1) throw new Error("fixture_does_not_resume_after_window_zero");
  const prefixRange = { startSample: 0, endSample: expectedPrefixEndSample };
  const expectedSeam = planSeamGeometry(prefixRange, windows[expectedResumeIndex], true);
  const resumedWindow = windows[expectedResumeIndex];
  const firstRepeatSample = Math.round(options.repeatStarts[0] * parsed.sampleRate);
  if (
    windows.length !== 2
    || expectedResumeIndex !== 1
    || resumedWindow.endSample - resumedWindow.startSample > 60 * parsed.sampleRate
    || options.repeatStarts.some(start => start < resumedWindow.startSample / parsed.sampleRate || start + 11 > resumedWindow.endSample / parsed.sampleRate)
    || expectedSeam.overlapStartSample > firstRepeatSample
    || expectedSeam.overlapEndSample < firstRepeatSample + Math.round(3.27 * parsed.sampleRate)
  ) throw new Error("fixture_two_window_fallback_geometry_changed");
  const windowTranscriptGeometry: PipelineManifest["windowTranscriptGeometry"] = [];
  const windowFixtures = windows.flatMap(window => {
    const audio = encodePcmWindow(parsed, window);
    const plannedTranscript = transcriptForWindow(window, options.repeatStarts);
    if (!plannedTranscript.transcript) return [];
    windowTranscriptGeometry.push({
      windowIndex: window.index,
      repeatIndexes: plannedTranscript.repeatIndexes,
      clippedPrefixRepeatIndex: plannedTranscript.clippedPrefixRepeatIndex,
      clippedSuffixRepeatIndex: plannedTranscript.clippedSuffixRepeatIndex,
      transcriptSha256: sha256(plannedTranscript.transcript),
    });
    return [{
      id: `window-${window.index}`,
      format: "wav" as const,
      audioSha256: sha256(audio),
      response: { transcript: plannedTranscript.transcript, segments: [] },
      maximumCalls: 1,
    }];
  });
  return {
    wav: options.wav,
    sourceSha256: sha256(options.wav),
    duration,
    sampleRate: parsed.sampleRate,
    sourceSamples: parsed.frameCount,
    windows,
    windowFixtures,
    wholeMp3Sha256: sha256(wholeMp3),
    wholeMp3Bytes: wholeMp3.length,
    wholeBlocks,
    expectedResumeIndex,
    expectedPrefixEndSample,
    expectedSeam,
    windowTranscriptGeometry,
  };
}

export async function installProviderBoundary(
  app: LocalApp,
  responses: readonly ProviderResponseFixture[],
  sourceWav: Buffer,
): Promise<void> {
  await app.electronApp.context().route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.protocol === "file:" || url.protocol === "enjoy:" || url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      await route.continue();
    } else {
      await route.abort("internetdisconnected");
    }
  });
  await app.electronApp.evaluate(async (_electron, fixture) => {
    const crypto = process.getBuiltinModule("node:crypto");
    const diagnostics = process.getBuiltinModule("node:diagnostics_channel");
    const scope = globalThis as typeof globalThis & {
      __ENJOY_PACKAGED_ASR_FIXTURE__?: {
        requests: Array<{
          ordinal: number;
          format: "mp3" | "wav" | "unknown";
          audioSha256: string;
          bytes: number;
          responseId: string | null;
          outcome: "fixture-response" | "rejected";
          sourceMatches: Array<{ startSample: number; endSample: number }>;
        }>;
        rejectedUrls: string[];
        undiciNetworkRequests: string[];
        nodeHttpRequests: string[];
      };
    };
    const observation = {
      requests: [],
      rejectedUrls: [],
      undiciNetworkRequests: [],
      nodeHttpRequests: [],
    } as NonNullable<typeof scope.__ENJOY_PACKAGED_ASR_FIXTURE__>;
    scope.__ENJOY_PACKAGED_ASR_FIXTURE__ = observation;
    const counts: Record<string, number> = {};
    const hash = (bytes: Uint8Array): string => crypto.createHash("sha256").update(bytes).digest("hex");
    const pcm = (wav: Uint8Array) => {
      const buffer = Buffer.from(wav);
      if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") return null;
      let cursor = 12;
      let blockAlign = 0;
      let data: Buffer | null = null;
      while (cursor + 8 <= buffer.length) {
        const name = buffer.toString("ascii", cursor, cursor + 4);
        const size = buffer.readUInt32LE(cursor + 4);
        const body = cursor + 8;
        if (body + size > buffer.length) return null;
        if (name === "fmt " && size >= 16) blockAlign = buffer.readUInt16LE(body + 12);
        if (name === "data") data = buffer.subarray(body, body + size);
        cursor = body + size + (size % 2);
      }
      return blockAlign > 0 && data ? { blockAlign, data } : null;
    };
    const source = pcm(Buffer.from(fixture.sourceWavBase64, "base64"));
    if (!source) throw new Error("provider_boundary_invalid_source_wav");
    const sourceMatches = (wav: Uint8Array): Array<{ startSample: number; endSample: number }> => {
      const candidate = pcm(wav);
      if (!candidate || candidate.blockAlign !== source.blockAlign || candidate.data.length === 0) return [];
      const matches: Array<{ startSample: number; endSample: number }> = [];
      let cursor = 0;
      while (matches.length < 64) {
        const offset = source.data.indexOf(candidate.data, cursor);
        if (offset < 0) break;
        if (offset % source.blockAlign === 0) {
          const startSample = offset / source.blockAlign;
          matches.push({ startSample, endSample: startSample + candidate.data.length / source.blockAlign });
        }
        cursor = offset + 1;
      }
      return matches;
    };
    diagnostics.channel("undici:request:create").subscribe((message: unknown) => {
      const origin = String((message as { request?: { origin?: unknown } })?.request?.origin || "");
      observation.undiciNetworkRequests.push(origin);
    });
    diagnostics.channel("http.client.request.start").subscribe((message: unknown) => {
      const request = (message as { request?: { getHeader?: (name: string) => unknown } })?.request;
      observation.nodeHttpRequests.push(String(request?.getHeader?.("host") || ""));
    });
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      if (url !== fixture.endpoint || (init?.method || "GET").toUpperCase() !== "POST") {
        observation.rejectedUrls.push(url);
        throw new Error("provider_boundary_rejected_url");
      }
      const headers = new Headers(init?.headers);
      if (headers.get("authorization") !== `Bearer ${fixture.sentinel}`) {
        observation.rejectedUrls.push(url);
        throw new Error("provider_boundary_rejected_authorization");
      }
      const contentType = headers.get("content-type") || "";
      let format: "mp3" | "wav" | "unknown" = "unknown";
      let bytes = new Uint8Array();
      if (contentType === "audio/mpeg" && (Buffer.isBuffer(init?.body) || init?.body instanceof Uint8Array)) {
        format = "mp3";
        bytes = new Uint8Array(init.body as Uint8Array);
      } else if (contentType === "application/json" && typeof init?.body === "string") {
        const parsed = JSON.parse(init.body) as { audio?: unknown };
        if (typeof parsed.audio === "string") {
          format = "wav";
          bytes = Buffer.from(parsed.audio, "base64");
        }
      }
      const audioSha256 = hash(bytes);
      const response = fixture.responses.find(item => item.format === format && item.audioSha256 === audioSha256);
      const ordinal = observation.requests.length + 1;
      const matches = format === "wav" ? sourceMatches(bytes) : [];
      if (!response || bytes.byteLength === 0 || (counts[response?.id || ""] || 0) >= (response?.maximumCalls || 0)) {
        observation.requests.push({ ordinal, format, audioSha256, bytes: bytes.byteLength, responseId: response?.id || null, outcome: "rejected", sourceMatches: matches });
        throw new Error("provider_boundary_rejected_audio");
      }
      counts[response.id] = (counts[response.id] || 0) + 1;
      observation.requests.push({ ordinal, format, audioSha256, bytes: bytes.byteLength, responseId: response.id, outcome: "fixture-response", sourceMatches: matches });
      return new Response(JSON.stringify({ ok: true, result: { text: response.response.transcript, segments: response.response.segments } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  }, { endpoint: PROVIDER_FIXTURE_ENDPOINT, sentinel: PROVIDER_FIXTURE_SENTINEL, responses, sourceWavBase64: sourceWav.toString("base64") });
  // Chromium offline mode also blocks the production classifier's ephemeral
  // loopback origin. The allowlist route is already active and main fetch is
  // already fail-closed, so re-enable only the traffic that passes those guards.
  await app.electronApp.context().setOffline(false);
}

export async function providerBoundaryObservation(app: LocalApp): Promise<ProviderBoundaryObservation> {
  return app.electronApp.evaluate(() => {
    const scope = globalThis as typeof globalThis & { __ENJOY_PACKAGED_ASR_FIXTURE__?: ProviderBoundaryObservation };
    if (!scope.__ENJOY_PACKAGED_ASR_FIXTURE__) throw new Error("provider_boundary_not_installed");
    return scope.__ENJOY_PACKAGED_ASR_FIXTURE__;
  });
}

export async function configureFixtureProvider(page: Page): Promise<void> {
  const config = await page.evaluate(async ({ baseUrl, token }) => {
    const saved = await window.__ENJOY_APP__.cloudflareTranscribe.setConfig({ baseUrl, token });
    return { saved, reread: await window.__ENJOY_APP__.cloudflareTranscribe.getConfig() };
  }, { baseUrl: PROVIDER_FIXTURE_BASE_URL, token: PROVIDER_FIXTURE_SENTINEL });
  if (!config.saved.configured || !config.reread.configured || config.reread.baseUrl !== PROVIDER_FIXTURE_BASE_URL) {
    throw new Error("provider_fixture_config_not_persisted");
  }
}

export async function startLearningAsr(page: Page, audioUrl: string): Promise<{
  response: Awaited<ReturnType<typeof window.__ENJOY_APP__.learningAsr.start>>;
  progress: { events: number; maximumPercent: number; stages: string[] };
}> {
  return page.evaluate(async ({ fixtureAudioUrl }) => {
    const api = window.__ENJOY_APP__;
    const context = await api.learning.getContext();
    const jobId = `fixture_${crypto.randomUUID()}`;
    const progress = { events: 0, maximumPercent: 0, stages: [] as string[] };
    const unsubscribe = api.learningAsr.onProgress((_event, update) => {
      if (update.jobId !== jobId) return;
      progress.events += 1;
      progress.maximumPercent = Math.max(progress.maximumPercent, update.percent);
      if (!progress.stages.includes(update.stage)) progress.stages.push(update.stage);
    });
    try {
      const response = await api.learningAsr.start({
        jobId,
        profileId: context.profileId,
        connectionId: context.connectionId,
        audioUrl: fixtureAudioUrl,
        service: "cloudflare_workers_ai",
        language: "en-US",
      });
      return { response, progress };
    } finally {
      unsubscribe();
    }
  }, { fixtureAudioUrl: audioUrl });
}

export function flattenWords(result: LearningAsrResult): StudyTimelineEntry[] {
  return result.timeline.flatMap(sentence => sentence.timeline.filter(entry => entry.type === "word"));
}

export async function launchPackagedFixtureApp(): Promise<LocalApp> {
  return launchLocalApp({ offline: true });
}
