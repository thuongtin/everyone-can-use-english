import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import type { Stats } from "node:fs";
import {
  access,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  unlink,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";
import ffmpegPath from "ffmpeg-static";
import ffprobePath from "@andrkrn/ffprobe-static";

const execFile = promisify(execFileCallback);

export const LEARNING_ASSET_MAX_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 16_384;
const MAX_DECODED_IMAGE_BYTES = 128 * 1024 * 1024;
const MAX_AUDIO_DURATION_MS = 2 * 60 * 60 * 1000;
const MEDIA_PROBE_TIMEOUT_MS = 30_000;
const MEDIA_PROBE_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const READ_CHUNK_BYTES = 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const RELATIVE_PATH_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg|jpeg|webp|wav|mp3|ogg|webm)$/u;
const NOFOLLOW = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0;
const DIRECTORY = typeof fsConstants.O_DIRECTORY === "number" ? fsConstants.O_DIRECTORY : 0;

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;
const AUDIO_EXTENSIONS = ["wav", "mp3", "ogg", "webm"] as const;
const ASSET_EXTENSIONS = [...IMAGE_EXTENSIONS, ...AUDIO_EXTENSIONS] as const;
const assetPublishLocks = new Map<string, Promise<void>>();

export type LearningAssetKind = "image" | "audio";
export type LearningAssetExtension = (typeof ASSET_EXTENSIONS)[number];

export type LearningAssetMetadata = Readonly<{
  id: string;
  relativePath: string;
  kind: LearningAssetKind;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}>;

export type ImportBytesInput = Readonly<{
  id: string;
  kind: LearningAssetKind;
  bytes: Buffer;
}>;

export type ImportFileInput = Readonly<{
  id: string;
  kind: LearningAssetKind;
  sourcePath: string;
  approvedRoot: string;
}>;

export type LearningAssetStoreErrorCode =
  | "asset_conflict"
  | "asset_kind_mismatch"
  | "asset_path_invalid"
  | "asset_too_large"
  | "audio_probe_unavailable"
  | "image_decoder_unavailable"
  | "invalid_audio"
  | "invalid_image"
  | "invalid_id"
  | "invalid_input"
  | "invalid_root"
  | "not_initialized"
  | "source_not_approved"
  | "source_not_regular_file"
  | "staging_invalid";

export class LearningAssetStoreError extends Error {
  readonly code: LearningAssetStoreErrorCode;

  constructor(code: LearningAssetStoreErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LearningAssetStoreError";
    this.code = code;
  }
}

type AssetInspection = Readonly<{
  extension: LearningAssetExtension;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}>;

type ExistingAsset = Readonly<{
  relativePath: string;
  bytes: Buffer;
}>;

const fail = (
  code: LearningAssetStoreErrorCode,
  message: string,
  options?: { cause?: unknown },
): never => {
  throw new LearningAssetStoreError(code, message, options);
};

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === code;
}

function isMissingError(error: unknown): boolean {
  return isErrorCode(error, "ENOENT");
}

async function withAssetPublishLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = assetPublishLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  assetPublishLocks.set(key, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (assetPublishLocks.get(key) === current) assetPublishLocks.delete(key);
  }
}

function assertAbsolutePath(value: unknown, code: LearningAssetStoreErrorCode, label: string): string {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    fail(code, `${label} must be an absolute path`);
  }
  return path.normalize(value as string);
}

function normalizeId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    fail("invalid_id", "Asset id must be a UUID");
  }
  return (value as string).toLowerCase();
}

function assertKind(value: unknown): LearningAssetKind {
  if (value !== "image" && value !== "audio") {
    fail("invalid_input", "Asset kind must be image or audio");
  }
  return value as LearningAssetKind;
}

function assertBytes(value: unknown): Buffer {
  if (!Buffer.isBuffer(value) || value.length === 0) {
    fail("invalid_input", "Asset bytes must be a non-empty Buffer");
  }
  const bytes = value as Buffer;
  if (bytes.length > LEARNING_ASSET_MAX_BYTES) {
    fail("asset_too_large", `Asset exceeds ${LEARNING_ASSET_MAX_BYTES} bytes`);
  }
  return Buffer.from(bytes);
}

function isSymlink(stats: Stats): boolean {
  return stats.isSymbolicLink();
}

function sameNode(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size;
}

function pathSegments(target: string): string[] {
  const parsed = path.parse(target);
  const relative = path.relative(parsed.root, target);
  return relative ? relative.split(path.sep).filter(Boolean) : [];
}

async function ensureDirectoryPath(target: string): Promise<void> {
  const parsed = path.parse(target);
  let current = parsed.root;
  for (const segment of pathSegments(target)) {
    current = path.join(current, segment);
    let stats: Stats;
    try {
      stats = await lstat(current);
    } catch (error) {
      if (!isMissingError(error)) throw error;
      try {
        await mkdir(current);
      } catch (mkdirError) {
        if (!isErrorCode(mkdirError, "EEXIST")) throw mkdirError;
      }
      stats = await lstat(current);
    }
    if (isSymlink(stats) || !stats.isDirectory()) {
      fail("invalid_root", `Directory component is not a real directory: ${current}`);
    }
  }
  const finalStats = await lstat(target);
  if (isSymlink(finalStats) || !finalStats.isDirectory()) {
    fail("invalid_root", `Expected a real directory: ${target}`);
  }
}

async function ensureExistingPathComponents(target: string): Promise<Stats> {
  const parsed = path.parse(target);
  let current = parsed.root;
  const segments = pathSegments(target);
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const stats = await lstat(current);
    if (isSymlink(stats)) {
      fail("source_not_approved", `Symlink path component is not allowed: ${current}`);
    }
    if (index < segments.length - 1 && !stats.isDirectory()) {
      fail("source_not_approved", `Parent path component is not a directory: ${current}`);
    }
    if (index === segments.length - 1) return stats;
  }
  return await lstat(target);
}

function assertWithin(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("source_not_approved", "Source path is outside the approved root");
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validDimension(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_IMAGE_DIMENSION;
}

function assertDimension(width: number, height: number, format: string): void {
  if (!validDimension(width) || !validDimension(height)) {
    fail("invalid_image", `${format} dimensions are outside 1..${MAX_IMAGE_DIMENSION}`);
  }
}

function assertDecodedImageSize(width: number, height: number, format: string): void {
  if (width * height * 4 > MAX_DECODED_IMAGE_BYTES) {
    fail("invalid_image", `${format} decoded pixels exceed the image size limit`);
  }
}

function isPng(bytes: Buffer): boolean {
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

function inspectPng(bytes: Buffer): AssetInspection {
  let offset = 8;
  let sawHeader = false;
  let sawData = false;
  let sawEnd = false;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const compressed: Buffer[] = [];

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail("invalid_image", "PNG chunk is truncated");
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (dataEnd < dataStart || crcEnd > bytes.length) fail("invalid_image", "PNG chunk exceeds file bounds");
    const data = bytes.subarray(dataStart, dataEnd);
    const expectedCrc = bytes.readUInt32BE(dataEnd);
    const actualCrc = crc32(Buffer.concat([type, data]));
    if (actualCrc !== expectedCrc) fail("invalid_image", "PNG chunk CRC is invalid");

    const name = type.toString("ascii");
    if (!sawHeader && name !== "IHDR") fail("invalid_image", "PNG must begin with IHDR");
    if (name === "IHDR") {
      if (sawHeader || length !== 13) fail("invalid_image", "PNG IHDR is invalid");
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0 || data[12] > 1) fail("invalid_image", "PNG compression or interlace method is invalid");
      interlace = data[12];
      const legalDepths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (!legalDepths[colorType]?.includes(bitDepth)) fail("invalid_image", "PNG color type or bit depth is invalid");
      assertDimension(width, height, "PNG");
      sawHeader = true;
    } else if (name === "IDAT") {
      if (!sawHeader || sawEnd) fail("invalid_image", "PNG IDAT placement is invalid");
      sawData = true;
      compressed.push(data);
    } else if (name === "IEND") {
      if (length !== 0 || sawEnd) fail("invalid_image", "PNG IEND is invalid");
      sawEnd = true;
      offset = crcEnd;
      break;
    }
    offset = crcEnd;
  }

  if (!sawHeader || !sawData || !sawEnd || offset !== bytes.length) fail("invalid_image", "PNG is truncated or has trailing data");
  assertDecodedImageSize(width, height, "PNG");
  const samples = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  const passRows = interlace === 0
    ? [{ width, height }]
    : [
        [0, 0, 8, 8],
        [4, 0, 8, 8],
        [0, 4, 4, 8],
        [2, 0, 4, 4],
        [0, 2, 2, 4],
        [1, 0, 2, 2],
        [0, 1, 1, 2],
      ].flatMap(([startX, startY, stepX, stepY]) => {
        const passWidth = width <= startX ? 0 : Math.ceil((width - startX) / stepX);
        const passHeight = height <= startY ? 0 : Math.ceil((height - startY) / stepY);
        return passWidth > 0 && passHeight > 0 ? [{ width: passWidth, height: passHeight }] : [];
      });
  const expectedLength = passRows.reduce((total, pass) => {
    const rowBytes = Math.ceil((pass.width * samples * bitDepth) / 8);
    return total + (rowBytes + 1) * pass.height;
  }, 0);
  if (expectedLength > MAX_DECODED_IMAGE_BYTES) fail("invalid_image", "PNG scanline data exceeds the decoded image size limit");
  let decoded: Buffer;
  try {
    decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: MAX_DECODED_IMAGE_BYTES });
  } catch (error) {
    return fail("invalid_image", "PNG image data cannot be decoded", { cause: error });
  }
  if (decoded.length !== expectedLength) fail("invalid_image", "PNG scanline data is truncated or malformed");
  return { extension: "png", mimeType: "image/png", width, height, durationMs: null };
}

function isJpeg(bytes: Buffer): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function isSofMarker(marker: number): boolean {
  return (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
}

function inspectJpeg(bytes: Buffer): AssetInspection {
  let offset = 2;
  let width: number | null = null;
  let height: number | null = null;
  let sawScan = false;
  let sawEnd = false;

  scan: while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) fail("invalid_image", "JPEG marker is malformed");
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) fail("invalid_image", "JPEG is truncated after marker prefix");
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) {
      sawEnd = true;
      break;
    }
    if (marker === 0x00) fail("invalid_image", "JPEG contains an unexpected stuffed byte");
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (offset + 2 > bytes.length) fail("invalid_image", "JPEG segment length is truncated");
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) fail("invalid_image", "JPEG segment exceeds file bounds");
    const dataStart = offset + 2;
    const dataEnd = offset + length;
    if (isSofMarker(marker)) {
      if (length < 8) fail("invalid_image", "JPEG frame header is truncated");
      height = bytes.readUInt16BE(dataStart + 1);
      width = bytes.readUInt16BE(dataStart + 3);
      assertDimension(width, height, "JPEG");
      const components = bytes[dataStart + 5];
      if (!components) fail("invalid_image", "JPEG has no color components");
    }
    offset = dataEnd;
    if (marker === 0xda) {
      sawScan = true;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const markerStart = offset;
        while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
        if (offset >= bytes.length) fail("invalid_image", "JPEG entropy data is truncated");
        const nextMarker = bytes[offset];
        if (nextMarker === 0x00 || (nextMarker >= 0xd0 && nextMarker <= 0xd7)) {
          offset += 1;
          continue;
        }
        if (nextMarker === 0xd9) {
          offset += 1;
          sawEnd = true;
          break scan;
        }
        offset = markerStart;
        break;
      }
    }
  }

  if (width === null || height === null || !sawScan || !sawEnd || offset !== bytes.length) fail("invalid_image", "JPEG is truncated or missing EOI");
  const imageWidth = width as number;
  const imageHeight = height as number;
  assertDecodedImageSize(imageWidth, imageHeight, "JPEG");
  return { extension: "jpg", mimeType: "image/jpeg", width: imageWidth, height: imageHeight, durationMs: null };
}

function isWebp(bytes: Buffer): boolean {
  return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

function inspectWebp(bytes: Buffer): AssetInspection {
  if (bytes.length < 12 || bytes.readUInt32LE(4) + 8 !== bytes.length) fail("invalid_image", "WebP RIFF length is invalid");
  let offset = 12;
  let width: number | null = null;
  let height: number | null = null;
  let hasImageData = false;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail("invalid_image", "WebP chunk header is truncated");
    const name = bytes.subarray(offset, offset + 4).toString("ascii");
    const length = bytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const next = dataEnd + (length % 2);
    if (dataEnd < dataStart || next > bytes.length) fail("invalid_image", "WebP chunk exceeds file bounds");
    const data = bytes.subarray(dataStart, dataEnd);
    if (name === "VP8 ") {
      if (data.length < 10 || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) fail("invalid_image", "WebP VP8 frame is invalid");
      width = data.readUInt16LE(6) & 0x3fff;
      height = data.readUInt16LE(8) & 0x3fff;
      hasImageData = true;
    } else if (name === "VP8L") {
      if (data.length < 5 || data[0] !== 0x2f) fail("invalid_image", "WebP VP8L frame is invalid");
      const bits = (data[1] | (data[2] << 8) | (data[3] << 16) | (data[4] << 24)) >>> 0;
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
      hasImageData = true;
    } else if (name === "VP8X") {
      if (data.length < 10) fail("invalid_image", "WebP VP8X frame is truncated");
      width = 1 + data[4] + (data[5] << 8) + (data[6] << 16);
      height = 1 + data[7] + (data[8] << 8) + (data[9] << 16);
    } else if (name === "ANMF") {
      hasImageData = true;
    }
    offset = next;
  }
  if (width === null || height === null || !hasImageData) return fail("invalid_image", "WebP has no decodable image frame");
  const imageWidth = width;
  const imageHeight = height;
  assertDimension(imageWidth, imageHeight, "WebP");
  assertDecodedImageSize(imageWidth, imageHeight, "WebP");
  return { extension: "webp", mimeType: "image/webp", width: imageWidth, height: imageHeight, durationMs: null };
}

function isWav(bytes: Buffer): boolean {
  return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WAVE";
}

function isOgg(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes.subarray(0, 4).toString("ascii") === "OggS";
}

function isWebm(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
}

function isMp3(bytes: Buffer): boolean {
  if (bytes.length >= 3 && bytes.subarray(0, 3).toString("ascii") === "ID3") {
    return bytes.length >= 10 && bytes[3] < 0xff && bytes[4] < 0xff && bytes[6] < 0x80 && bytes[7] < 0x80 && bytes[8] < 0x80 && bytes[9] < 0x80;
  }
  if (bytes.length < 2 || bytes[0] !== 0xff || (bytes[1] & 0xe0) !== 0xe0) return false;
  const version = (bytes[1] >> 3) & 0x03;
  const layer = (bytes[1] >> 1) & 0x03;
  const bitrate = (bytes[2] >> 4) & 0x0f;
  const sampleRate = (bytes[2] >> 2) & 0x03;
  return version !== 1 && layer !== 0 && bitrate !== 0 && bitrate !== 0x0f && sampleRate !== 3;
}

function hasKnownAudioMagic(bytes: Buffer): boolean {
  return isWav(bytes) || isOgg(bytes) || isWebm(bytes) || isMp3(bytes);
}

function detectAudio(bytes: Buffer): Pick<AssetInspection, "extension" | "mimeType"> {
  if (isWav(bytes)) return { extension: "wav", mimeType: "audio/wav" };
  if (isMp3(bytes)) return { extension: "mp3", mimeType: "audio/mpeg" };
  if (isOgg(bytes)) return { extension: "ogg", mimeType: "audio/ogg" };
  if (isWebm(bytes)) return { extension: "webm", mimeType: "audio/webm" };
  return fail("invalid_audio", "Audio bytes do not have a supported container signature");
}

function inspectImage(bytes: Buffer): AssetInspection {
  if (isPng(bytes)) return inspectPng(bytes);
  if (isJpeg(bytes)) return inspectJpeg(bytes);
  if (isWebp(bytes)) return inspectWebp(bytes);
  if (hasKnownAudioMagic(bytes)) fail("asset_kind_mismatch", "Audio bytes cannot be imported as an image");
  return fail("invalid_image", "Image bytes do not have a supported PNG, JPEG, or WebP signature");
}

function formatNameMatches(extension: LearningAssetExtension, formatName: string): boolean {
  const names = formatName.split(",").map((name) => name.trim().toLowerCase());
  if (extension === "wav") return names.includes("wav");
  if (extension === "mp3") return names.includes("mp3");
  if (extension === "ogg") return names.includes("ogg") || names.includes("oga");
  return names.includes("webm") || names.includes("matroska");
}

function parseDurationMs(value: unknown): number | null {
  const duration = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  if (!Number.isFinite(duration) || duration < 0) return null;
  const durationMs = duration * 1000;
  if (!Number.isFinite(durationMs)) return Number.POSITIVE_INFINITY;
  return Math.round(durationMs);
}

function parseTimestampSeconds(value: unknown): number | null {
  const timestamp = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

function packetDurationMs(packets: Array<{ pts_time?: unknown; dts_time?: unknown; duration_time?: unknown }>): number | null {
  let firstTimestamp = Number.POSITIVE_INFINITY;
  let lastTimestamp = Number.NEGATIVE_INFINITY;
  let lastPacketEnd = Number.NEGATIVE_INFINITY;
  for (const packet of packets) {
    const timestamp = parseTimestampSeconds(packet.pts_time) ?? parseTimestampSeconds(packet.dts_time);
    if (timestamp === null) continue;
    firstTimestamp = Math.min(firstTimestamp, timestamp);
    lastTimestamp = Math.max(lastTimestamp, timestamp);
    const packetDuration = parseTimestampSeconds(packet.duration_time);
    if (packetDuration !== null && packetDuration >= 0) {
      lastPacketEnd = Math.max(lastPacketEnd, timestamp + packetDuration);
    }
  }
  if (!Number.isFinite(firstTimestamp) || !Number.isFinite(lastTimestamp)) return null;
  const endTimestamp = Math.max(lastTimestamp, lastPacketEnd);
  const durationMs = Math.round((endTimestamp - firstTimestamp) * 1000);
  return Number.isFinite(durationMs) ? durationMs : Number.POSITIVE_INFINITY;
}

function asUnpackedBinary(candidate: string | null): string | null {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) return null;
  return candidate.includes("app.asar.unpacked") ? candidate : candidate.replace("app.asar", "app.asar.unpacked");
}

function mediaEnvironment(): NodeJS.ProcessEnv {
  return { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" };
}

async function findFfmpeg(): Promise<string> {
  const candidate = asUnpackedBinary(typeof ffmpegPath === "string" ? ffmpegPath : null);
  if (candidate) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Fall through to the explicit unavailable error.
    }
  }
  return fail("image_decoder_unavailable", "No approved absolute ffmpeg binary is available");
}

async function findFfprobe(): Promise<string> {
  const candidates = [
    asUnpackedBinary(typeof ffprobePath === "string" ? ffprobePath : null),
    "/opt/homebrew/bin/ffprobe",
    "/usr/local/bin/ffprobe",
    "/usr/bin/ffprobe",
  ].filter((candidate): candidate is string => candidate !== null);
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next explicitly known path.
    }
  }
  return fail("audio_probe_unavailable", "No approved absolute ffprobe binary is available");
}

async function decodeImageFile(filePath: string): Promise<void> {
  const decoder = await findFfmpeg();
  try {
    await execFile(decoder, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-protocol_whitelist",
      "file,pipe",
      "-max_alloc",
      String(MAX_DECODED_IMAGE_BYTES),
      "-threads",
      "1",
      "-i",
      filePath,
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-f",
      "null",
      "-",
    ], {
      env: mediaEnvironment(),
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024,
      timeout: MEDIA_PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return fail("image_decoder_unavailable", "The approved ffmpeg binary is unavailable", { cause: error });
    return fail("invalid_image", "ffmpeg could not decode the image", { cause: error });
  }
}

async function runFfprobe(probe: string, args: string[], filePath: string): Promise<string> {
  try {
    const result = await execFile(probe, [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      ...args,
      filePath,
    ], {
      env: mediaEnvironment(),
      killSignal: "SIGKILL",
      maxBuffer: MEDIA_PROBE_MAX_BUFFER_BYTES,
      timeout: MEDIA_PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
    return result.stdout;
  } catch (error) {
    return fail("invalid_audio", "ffprobe rejected the audio file", { cause: error });
  }
}

async function inspectAudioFile(filePath: string, detected: Pick<AssetInspection, "extension" | "mimeType">): Promise<AssetInspection> {
  const probe = await findFfprobe();
  const stdout = await runFfprobe(probe, [
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    "-select_streams",
    "a:0",
    "-show_entries",
    "format=format_name,duration:stream=codec_type,duration",
  ], filePath);
  let parsed: { format?: { format_name?: unknown; duration?: unknown }; streams?: Array<{ codec_type?: unknown; duration?: unknown }> };
  try {
    parsed = JSON.parse(stdout) as typeof parsed;
  } catch (error) {
    return fail("invalid_audio", "ffprobe returned malformed metadata", { cause: error });
  }
  const formatName = typeof parsed.format?.format_name === "string" ? parsed.format.format_name : "";
  if (!formatNameMatches(detected.extension, formatName)) fail("invalid_audio", "Audio container does not match its detected signature");
  const audioStream = parsed.streams?.find((stream) => stream.codec_type === "audio");
  if (!audioStream) return fail("invalid_audio", "Audio file has no decodable audio stream");
  let durationMs = parseDurationMs(audioStream.duration) ?? parseDurationMs(parsed.format?.duration);
  if (durationMs === null && detected.extension === "webm") {
    const packetStdout = await runFfprobe(probe, [
      "-print_format",
      "json",
      "-show_packets",
      "-select_streams",
      "a:0",
      "-show_entries",
      "packet=pts_time,dts_time,duration_time",
    ], filePath);
    let packetData: { packets?: Array<{ pts_time?: unknown; dts_time?: unknown; duration_time?: unknown }> };
    try {
      packetData = JSON.parse(packetStdout) as typeof packetData;
    } catch (error) {
      return fail("invalid_audio", "ffprobe returned malformed packet metadata", { cause: error });
    }
    durationMs = packetDurationMs(packetData.packets ?? []);
  }
  if (durationMs === null || !Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > MAX_AUDIO_DURATION_MS) {
    fail("invalid_audio", "Audio duration must be positive and no more than two hours");
  }
  return { ...detected, width: null, height: null, durationMs };
}

async function writeExclusive(filePath: string, bytes: Buffer): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(filePath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | NOFOLLOW, 0o600);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.write(bytes, offset, bytes.length - offset, offset);
      if (result.bytesWritten <= 0) throw new Error("No progress while writing asset");
      offset += result.bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle?.close().catch((): undefined => undefined);
  }
}

async function readBounded(handle: FileHandle): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  let position = 0;
  while (true) {
    const remaining = LEARNING_ASSET_MAX_BYTES - total;
    const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining + 1));
    const result = await handle.read(buffer, 0, buffer.length, position);
    if (result.bytesRead === 0) break;
    total += result.bytesRead;
    if (total > LEARNING_ASSET_MAX_BYTES) fail("asset_too_large", `Asset exceeds ${LEARNING_ASSET_MAX_BYTES} bytes`);
    chunks.push(buffer.subarray(0, result.bytesRead));
    position += result.bytesRead;
  }
  if (total === 0) fail("invalid_input", "Asset file is empty");
  return Buffer.concat(chunks, total);
}

async function syncDirectory(directoryPath: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(directoryPath, fsConstants.O_RDONLY | DIRECTORY);
    await handle.sync();
  } catch (error) {
    const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
    if (code !== "EINVAL" && code !== "ENOTSUP" && code !== "EISDIR") throw error;
  } finally {
    await handle?.close().catch((): undefined => undefined);
  }
}

export class LearningAssetStore {
  private readonly root: string;
  private readonly stagingRoot: string;
  private initialized = false;

  constructor(root: string) {
    const normalizedRoot = assertAbsolutePath(root, "invalid_root", "Asset store root");
    if (normalizedRoot === path.parse(normalizedRoot).root) fail("invalid_root", "Asset store root must not be a filesystem root");
    this.root = normalizedRoot;
    this.stagingRoot = path.join(this.root, ".staging");
  }

  async initialize(): Promise<void> {
    await ensureDirectoryPath(this.root);
    await ensureDirectoryPath(this.stagingRoot);
    this.initialized = true;
  }

  resolve(relativePath: string): string {
    this.assertRelativePath(relativePath);
    return path.join(this.root, relativePath);
  }

  async importBytes(input: ImportBytesInput): Promise<LearningAssetMetadata> {
    const id = normalizeId(input?.id);
    const kind = assertKind(input?.kind);
    const bytes = assertBytes(input?.bytes);
    await this.requireInitialized();

    let inspection: AssetInspection;
    let probePath: string | undefined;
    try {
      if (kind === "image") {
        inspection = inspectImage(bytes);
        probePath = path.join(this.stagingRoot, `.decode-${id}-${randomBytes(12).toString("hex")}.tmp`);
        await writeExclusive(probePath, bytes);
        await decodeImageFile(probePath);
      } else {
        const detected = detectAudio(bytes);
        probePath = path.join(this.stagingRoot, `.probe-${id}-${randomBytes(12).toString("hex")}.tmp`);
        await writeExclusive(probePath, bytes);
        inspection = await inspectAudioFile(probePath, detected);
      }
    } finally {
      if (probePath) await unlink(probePath).catch((): undefined => undefined);
    }

    return this.publish(id, kind, bytes, inspection);
  }

  async importFile(input: ImportFileInput): Promise<LearningAssetMetadata> {
    const id = normalizeId(input?.id);
    const kind = assertKind(input?.kind);
    const sourcePath = assertAbsolutePath(input?.sourcePath, "source_not_approved", "Source path");
    const approvedRoot = assertAbsolutePath(input?.approvedRoot, "source_not_approved", "Approved root");
    const approvedStats = await ensureExistingPathComponents(approvedRoot);
    if (isSymlink(approvedStats) || !approvedStats.isDirectory()) fail("source_not_approved", "Approved root must be a real directory");
    const sourceStats = await ensureExistingPathComponents(sourcePath);
    if (isSymlink(sourceStats) || !sourceStats.isFile()) fail("source_not_regular_file", "Source must be a regular file and cannot be a symlink");
    const canonicalRoot = await realpath(approvedRoot);
    const canonicalSource = await realpath(sourcePath);
    assertWithin(canonicalRoot, canonicalSource);

    let handle: FileHandle | undefined;
    let bytes: Buffer;
    try {
      handle = await open(sourcePath, fsConstants.O_RDONLY | NOFOLLOW);
      const openedStats = await handle.stat();
      if (!sameNode(sourceStats, openedStats)) fail("source_not_approved", "Source file changed while opening");
      bytes = await readBounded(handle);
      const afterReadStats = await handle.stat();
      if (!sameNode(openedStats, afterReadStats)) fail("source_not_approved", "Source file changed while reading");
    } finally {
      await handle?.close().catch((): undefined => undefined);
    }
    const sourceAfter = await ensureExistingPathComponents(sourcePath);
    if (isSymlink(sourceAfter) || !sameNode(sourceStats, sourceAfter)) fail("source_not_approved", "Source file identity changed after reading");
    const canonicalSourceAfter = await realpath(sourcePath);
    assertWithin(canonicalRoot, canonicalSourceAfter);
    return this.importBytes({ id, kind, bytes });
  }

  async read(relativePath: string): Promise<Buffer> {
    this.assertRelativePath(relativePath);
    await this.requireInitialized();
    await ensureDirectoryPath(this.root);
    const filePath = this.resolve(relativePath);
    const pathStats = await lstat(filePath);
    if (isSymlink(pathStats) || !pathStats.isFile()) fail("asset_path_invalid", "Asset path must be a regular file");
    let handle: FileHandle | undefined;
    try {
      handle = await open(filePath, fsConstants.O_RDONLY | NOFOLLOW);
      const openedStats = await handle.stat();
      if (!sameNode(pathStats, openedStats)) fail("asset_path_invalid", "Asset file changed while opening");
      const bytes = await readBounded(handle);
      const afterReadStats = await handle.stat();
      if (!sameNode(openedStats, afterReadStats)) fail("asset_path_invalid", "Asset file changed while reading");
      await ensureDirectoryPath(this.root);
      return bytes;
    } finally {
      await handle?.close().catch((): undefined => undefined);
    }
  }

  async remove(relativePath: string): Promise<void> {
    this.assertRelativePath(relativePath);
    await this.requireInitialized();
    await ensureDirectoryPath(this.root);
    const filePath = this.resolve(relativePath);
    let stats: Stats;
    try {
      stats = await lstat(filePath);
    } catch (error) {
      if (isMissingError(error)) return;
      throw error;
    }
    if (isSymlink(stats) || !stats.isFile()) fail("asset_path_invalid", "Asset path must be a regular file");
    await unlink(filePath);
    await syncDirectory(this.root);
  }

  async cleanupStaging(): Promise<void> {
    await this.requireInitialized();
    await ensureDirectoryPath(this.stagingRoot);
    const entries = await readdir(this.stagingRoot);
    for (const name of entries) {
      const entryPath = path.join(this.stagingRoot, name);
      const stats = await lstat(entryPath);
      if (stats.isDirectory() && !stats.isSymbolicLink()) fail("staging_invalid", `Unexpected staging directory: ${name}`);
      await unlink(entryPath);
    }
    await syncDirectory(this.stagingRoot);
  }

  async cleanupUnreferenced(referencedPaths: readonly string[]): Promise<string[]> {
    await this.requireInitialized();
    if (!Array.isArray(referencedPaths)) fail("invalid_input", "Referenced asset paths must be an array");
    const referenced = new Set(
      referencedPaths.filter((relativePath): relativePath is string => (
        typeof relativePath === "string"
        && RELATIVE_PATH_PATTERN.test(relativePath)
        && path.normalize(relativePath) === relativePath
      )),
    );
    const canonicalRoot = await realpath(this.root);
    const removed: string[] = [];
    for (const name of await readdir(this.root)) {
      if (!RELATIVE_PATH_PATTERN.test(name) || referenced.has(name)) continue;
      const filePath = this.resolve(name);
      let initialStats: Stats;
      try {
        initialStats = await lstat(filePath);
      } catch (error) {
        if (isMissingError(error)) continue;
        throw error;
      }
      if (isSymlink(initialStats) || !initialStats.isFile()) continue;
      let canonicalPath: string;
      try {
        canonicalPath = await realpath(filePath);
      } catch (error) {
        if (isMissingError(error)) continue;
        throw error;
      }
      if (canonicalPath !== filePath || !canonicalPath.startsWith(`${canonicalRoot}${path.sep}`)) continue;
      let latestStats: Stats;
      try {
        latestStats = await lstat(filePath);
      } catch (error) {
        if (isMissingError(error)) continue;
        throw error;
      }
      if (isSymlink(latestStats) || !latestStats.isFile() || !sameNode(initialStats, latestStats)) continue;
      await unlink(filePath);
      removed.push(name);
    }
    if (removed.length > 0) await syncDirectory(this.root);
    return removed;
  }

  private async requireInitialized(): Promise<void> {
    if (!this.initialized) fail("not_initialized", "Call initialize() before using the asset store");
    await ensureDirectoryPath(this.root);
    await ensureDirectoryPath(this.stagingRoot);
  }

  private assertRelativePath(relativePath: unknown): asserts relativePath is string {
    if (typeof relativePath !== "string" || !RELATIVE_PATH_PATTERN.test(relativePath) || path.isAbsolute(relativePath) || path.normalize(relativePath) !== relativePath) {
      fail("asset_path_invalid", "Asset path must be a canonical UUID.ext relative path");
    }
  }

  private async findExisting(id: string): Promise<ExistingAsset[]> {
    const existing: ExistingAsset[] = [];
    for (const extension of ASSET_EXTENSIONS) {
      const relativePath = `${id}.${extension}`;
      const filePath = this.resolve(relativePath);
      let stats: Stats;
      try {
        stats = await lstat(filePath);
      } catch (error) {
        if (isMissingError(error)) continue;
        throw error;
      }
      if (isSymlink(stats) || !stats.isFile()) fail("asset_path_invalid", `Existing asset is not a regular file: ${relativePath}`);
      existing.push({ relativePath, bytes: await this.read(relativePath) });
    }
    return existing;
  }

  private async publish(id: string, kind: LearningAssetKind, bytes: Buffer, inspection: AssetInspection): Promise<LearningAssetMetadata> {
    return withAssetPublishLock(`${this.root}\0${id}`, () => this.publishUnlocked(id, kind, bytes, inspection));
  }

  private async publishUnlocked(id: string, kind: LearningAssetKind, bytes: Buffer, inspection: AssetInspection): Promise<LearningAssetMetadata> {
    await ensureDirectoryPath(this.root);
    await ensureDirectoryPath(this.stagingRoot);
    const existing = await this.findExisting(id);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    for (const candidate of existing) {
      const candidateHash = createHash("sha256").update(candidate.bytes).digest("hex");
      if (candidateHash === sha256 && candidate.bytes.equals(bytes)) {
        return this.metadata(id, candidate.relativePath, kind, inspection, sha256, bytes.length);
      }
      fail("asset_conflict", `Asset id already exists with different bytes: ${id}`);
    }

    const relativePath = `${id}.${inspection.extension}`;
    const filePath = this.resolve(relativePath);
    const stagePath = path.join(this.stagingRoot, `.${relativePath}.${randomBytes(12).toString("hex")}.stage`);
    await writeExclusive(stagePath, bytes);
    try {
      await ensureDirectoryPath(this.root);
      await ensureDirectoryPath(this.stagingRoot);
      try {
        // link() publishes without replacing an existing path; unlinking the staged name completes the atomic no-replace move.
        await link(stagePath, filePath);
      } catch (error) {
        if (!isErrorCode(error, "EEXIST")) throw error;
        const raced = await this.findExisting(id);
        for (const candidate of raced) {
          if (candidate.bytes.equals(bytes)) {
            return this.metadata(id, candidate.relativePath, kind, inspection, sha256, bytes.length);
          }
        }
        fail("asset_conflict", `Asset id already exists with different bytes: ${id}`);
      }
      await syncDirectory(this.root);
    } finally {
      await unlink(stagePath).catch((): undefined => undefined);
    }
    return this.metadata(id, relativePath, kind, inspection, sha256, bytes.length);
  }

  private metadata(id: string, relativePath: string, kind: LearningAssetKind, inspection: AssetInspection, sha256: string, sizeBytes: number): LearningAssetMetadata {
    return Object.freeze({
      id,
      relativePath,
      kind,
      mimeType: inspection.mimeType,
      sha256,
      sizeBytes,
      width: inspection.width,
      height: inspection.height,
      durationMs: inspection.durationMs,
    });
  }
}
