import { Buffer } from "node:buffer";

const MODEL = "@cf/openai/whisper-large-v3-turbo";
const MAX_JSON_BODY_BYTES = 40_000_000;
const MAX_MP3_BODY_BYTES = 30_000_000;
const MAX_AUDIO_SECONDS = 3_601;
const DEFAULT_DEADLINE_MS = 900_000;
const MAX_TEXT_LENGTH = 100_000;
const MAX_SEGMENT_TEXT_LENGTH = 10_000;
const MAX_SEGMENTS = 10_000;
const SEGMENT_END_TOLERANCE_SECONDS = 0.02;
const MPEG2_LAYER3_BITRATES_KBPS = Object.freeze([
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
]);

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

class PublicError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

class DeadlineError extends Error {}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function errorResponse(status, code, message) {
  return jsonResponse({ ok: false, error: { code, message } }, status);
}

function invalidAudio() {
  return new PublicError(400, "cf_invalid_audio", "Invalid audio payload.");
}

async function sha256(value) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

async function tokensMatch(provided, expected) {
  const [left, right] = await Promise.all([sha256(provided), sha256(expected)]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function authenticate(request, env) {
  if (typeof env.ENJOY_CLIENT_TOKEN !== "string" || env.ENJOY_CLIENT_TOKEN.length < 32) {
    throw new PublicError(502, "cf_failed", "Transcription service unavailable.");
  }

  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ") || header.length <= 7) {
    throw new PublicError(401, "cf_auth", "Authentication required.");
  }

  const provided = header.slice(7);
  if (!(await tokensMatch(provided, env.ENJOY_CLIENT_TOKEN))) {
    throw new PublicError(403, "cf_auth", "Invalid credentials.");
  }
}

function validateDeclaredLength(request, maxBytes) {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
      throw invalidAudio();
    }
    return parsedLength;
  }
  return null;
}

async function readBoundedText(request, maxBytes) {
  validateDeclaredLength(request, maxBytes);

  if (!request.body) {
    throw invalidAudio();
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const textChunks = [];
  let totalLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalLength += value.byteLength;
      if (totalLength > maxBytes) {
        await reader.cancel("request body too large");
        throw invalidAudio();
      }
      textChunks.push(decoder.decode(value, { stream: true }));
    }
    textChunks.push(decoder.decode());
  } catch (error) {
    if (error instanceof PublicError) throw error;
    throw invalidAudio();
  } finally {
    reader.releaseLock();
  }
  return textChunks.join("");
}

async function readBoundedBytes(request, maxBytes) {
  const declaredLength = validateDeclaredLength(request, maxBytes);
  if (!request.body) throw invalidAudio();

  const reader = request.body.getReader();
  const storage = Buffer.allocUnsafe(declaredLength ?? maxBytes);
  let totalLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalLength += value.byteLength;
      if (totalLength > maxBytes) {
        await reader.cancel("request body too large");
        throw invalidAudio();
      }
      if (totalLength > storage.byteLength) {
        await reader.cancel("content length mismatch");
        throw invalidAudio();
      }
      storage.set(value, totalLength - value.byteLength);
    }
  } catch (error) {
    if (error instanceof PublicError) throw error;
    throw invalidAudio();
  } finally {
    reader.releaseLock();
  }
  if (totalLength === 0) throw invalidAudio();
  if (declaredLength !== null && totalLength !== declaredLength) throw invalidAudio();
  return storage.subarray(0, totalLength);
}

function parseJsonBody(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalidAudio();
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw invalidAudio();
  }
  if (typeof parsed.audio !== "string" || parsed.audio.length === 0) {
    throw invalidAudio();
  }
  if (
    parsed.language !== undefined &&
    (typeof parsed.language !== "string" || !/^[A-Za-z]{2,3}$/.test(parsed.language))
  ) {
    throw invalidAudio();
  }

  return {
    audio: parsed.audio,
    language: parsed.language?.toLowerCase(),
  };
}

function decodeBase64(value) {
  if (value.length % 4 !== 0) {
    throw invalidAudio();
  }

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const contentLength = value.length - padding;
  if (
    contentLength % 4 === 1 ||
    value.indexOf("=") !== (padding === 0 ? -1 : contentLength)
  ) {
    throw invalidAudio();
  }

  const decodedLength = (value.length / 4) * 3 - padding;
  if (decodedLength <= 0 || decodedLength > MAX_JSON_BODY_BYTES) {
    throw invalidAudio();
  }

  try {
    const bytes = Buffer.from(value, "base64");
    if (bytes.byteLength !== decodedLength) throw invalidAudio();
    return bytes;
  } catch {
    throw invalidAudio();
  }
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function parsePcmWav(bytes) {
  if (bytes.byteLength < 44 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
    throw invalidAudio();
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffLength = view.getUint32(4, true) + 8;
  if (riffLength !== bytes.byteLength) {
    throw invalidAudio();
  }

  let format;
  let dataLength;
  for (let offset = 12; offset + 8 <= bytes.byteLength; ) {
    const chunkId = ascii(bytes, offset, 4);
    const chunkLength = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + chunkLength + (chunkLength % 2);
    if (nextOffset > bytes.byteLength) {
      throw invalidAudio();
    }

    if (chunkId === "fmt " && format === undefined) {
      if (chunkLength < 16) throw invalidAudio();
      format = {
        audioFormat: view.getUint16(dataOffset, true),
        channels: view.getUint16(dataOffset + 2, true),
        sampleRate: view.getUint32(dataOffset + 4, true),
        byteRate: view.getUint32(dataOffset + 8, true),
        blockAlign: view.getUint16(dataOffset + 12, true),
        bitsPerSample: view.getUint16(dataOffset + 14, true),
      };
    } else if (chunkId === "data" && dataLength === undefined) {
      dataLength = chunkLength;
    }
    offset = nextOffset;
  }

  if (!format || dataLength === undefined || dataLength === 0) {
    throw invalidAudio();
  }

  const expectedBlockAlign = format.channels * 2;
  if (
    format.audioFormat !== 1 ||
    (format.channels !== 1 && format.channels !== 2) ||
    format.sampleRate !== 16_000 ||
    format.bitsPerSample !== 16 ||
    format.blockAlign !== expectedBlockAlign ||
    format.byteRate !== format.sampleRate * expectedBlockAlign ||
    dataLength % expectedBlockAlign !== 0
  ) {
    throw invalidAudio();
  }

  const duration = dataLength / format.byteRate;
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_AUDIO_SECONDS) {
    throw invalidAudio();
  }

  return { duration };
}

function parseId3v2Size(bytes) {
  if (bytes.byteLength < 10) throw invalidAudio();
  const majorVersion = bytes[3];
  const revision = bytes[4];
  const flags = bytes[5];
  const allowedFlags = majorVersion === 4 ? 0xf0 : majorVersion === 3 ? 0xe0 : majorVersion === 2 ? 0xc0 : -1;
  if (allowedFlags < 0 || revision === 0xff || (flags & ~allowedFlags) !== 0) {
    throw invalidAudio();
  }
  const sizeBytes = bytes.subarray(6, 10);
  if (sizeBytes.some((value) => (value & 0x80) !== 0)) throw invalidAudio();
  const bodySize =
    sizeBytes[0] * 0x20_0000 +
    sizeBytes[1] * 0x4000 +
    sizeBytes[2] * 0x80 +
    sizeBytes[3];
  const footerSize = majorVersion === 4 && (flags & 0x10) !== 0 ? 10 : 0;
  const totalSize = 10 + bodySize + footerSize;
  if (totalSize > bytes.byteLength) throw invalidAudio();
  return totalSize;
}

function parseMp3(bytes) {
  if (bytes.byteLength < 4) throw invalidAudio();
  let offset = 0;
  if (ascii(bytes, 0, Math.min(3, bytes.byteLength)) === "ID3") {
    offset = parseId3v2Size(bytes);
  }

  let frameCount = 0;
  while (offset < bytes.byteLength) {
    const remaining = bytes.byteLength - offset;
    if (remaining === 128 && ascii(bytes, offset, 3) === "TAG") {
      offset = bytes.byteLength;
      break;
    }
    if (remaining < 4) throw invalidAudio();

    const first = bytes[offset];
    const second = bytes[offset + 1];
    const third = bytes[offset + 2];
    const fourth = bytes[offset + 3];
    const versionBits = (second >> 3) & 0x03;
    const layerBits = (second >> 1) & 0x03;
    const bitrateIndex = (third >> 4) & 0x0f;
    const sampleRateIndex = (third >> 2) & 0x03;
    const padding = (third >> 1) & 0x01;
    const channelMode = (fourth >> 6) & 0x03;
    const emphasis = fourth & 0x03;

    if (
      first !== 0xff ||
      (second & 0xe0) !== 0xe0 ||
      versionBits !== 2 ||
      layerBits !== 1 ||
      bitrateIndex === 0 ||
      bitrateIndex === 15 ||
      sampleRateIndex !== 2 ||
      channelMode !== 3 ||
      emphasis === 2
    ) {
      throw invalidAudio();
    }

    const bitrateKbps = MPEG2_LAYER3_BITRATES_KBPS[bitrateIndex];
    const frameLength = Math.floor((72_000 * bitrateKbps) / 16_000) + padding;
    if (frameLength < 4 || offset + frameLength > bytes.byteLength) {
      throw invalidAudio();
    }
    offset += frameLength;
    frameCount += 1;
    if ((frameCount * 576) / 16_000 > MAX_AUDIO_SECONDS) throw invalidAudio();
  }

  if (frameCount === 0 || offset !== bytes.byteLength) throw invalidAudio();
  const duration = (frameCount * 576) / 16_000;
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_AUDIO_SECONDS) {
    throw invalidAudio();
  }
  return { duration, frameCount };
}

function getProviderText(response) {
  if (typeof response?.text === "string") return response.text;
  if (typeof response?.transcription_info?.text === "string") {
    return response.transcription_info.text;
  }
  return undefined;
}

function getProviderSegments(response) {
  if (Array.isArray(response?.segments)) return response.segments;
  if (Array.isArray(response?.transcription_info?.segments)) {
    return response.transcription_info.segments;
  }
  return [];
}

function normalizeResponse(response, duration) {
  if (!response || typeof response !== "object") {
    throw new PublicError(502, "cf_invalid_response", "Invalid transcription response.");
  }

  const rawText = getProviderText(response);
  if (typeof rawText !== "string" || rawText.length > MAX_TEXT_LENGTH) {
    throw new PublicError(502, "cf_invalid_response", "Invalid transcription response.");
  }
  const text = rawText.trim();
  if (text.length === 0) {
    throw new PublicError(400, "cf_no_speech", "No speech detected.");
  }

  const rawSegments = getProviderSegments(response);
  if (rawSegments.length > MAX_SEGMENTS) {
    throw new PublicError(502, "cf_invalid_response", "Invalid transcription response.");
  }

  const segments = [];
  let previousStart = -1;
  for (const segment of rawSegments) {
    const segmentText = typeof segment?.text === "string" ? segment.text.trim() : undefined;
    const start = segment?.start;
    const end = segment?.end;
    const boundedEnd = typeof end === "number" ? Math.min(end, duration) : end;
    if (
      segmentText === undefined ||
      segmentText.length > MAX_SEGMENT_TEXT_LENGTH ||
      typeof start !== "number" ||
      typeof end !== "number" ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      start < previousStart ||
      start > duration ||
      boundedEnd < start ||
      end - duration > SEGMENT_END_TOLERANCE_SECONDS
    ) {
      throw new PublicError(502, "cf_invalid_response", "Invalid transcription response.");
    }
    previousStart = start;
    segments.push({ text: segmentText, start, end: boundedEnd });
  }

  return { text, segments };
}

function runWithDeadline(operation, deadlineMs) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineError()), deadlineMs);
  });
  return Promise.race([operation, deadline]).finally(() => clearTimeout(timer));
}

function providerErrorResponse(error) {
  const rawStatus = typeof error?.status === "number" ? error.status : undefined;
  const rawCode = typeof error?.code === "number" || typeof error?.code === "string" ? String(error.code) : "";
  const safeCode = /^[A-Za-z0-9_-]{1,32}$/.test(rawCode) ? rawCode : "unknown";
  console.warn({
    event: "inference_failed",
    status: Number.isInteger(rawStatus) ? rawStatus : null,
    errorCode: error instanceof DeadlineError ? "deadline" : safeCode,
  });

  if (error instanceof DeadlineError) {
    return errorResponse(504, "cf_timeout", "Transcription timed out.");
  }

  const status = rawStatus;
  const code = rawCode;
  const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";
  if (
    (status === 400 || status === 413) &&
    /input.{0,12}(?:too large|too long)|payload.{0,12}too large|request.{0,12}too large|audio.{0,12}(?:too large|too long)|duration.{0,12}(?:limit|exceed)/.test(message)
  ) {
    return errorResponse(400, "cf_invalid_audio", "Invalid audio payload.");
  }
  if (status === 429 || code === "7505" || /quota|rate limit|too many requests|neurons/.test(message)) {
    return errorResponse(429, "cf_quota", "Transcription quota exceeded.");
  }
  if (status === 408 || status === 504 || error?.name === "AbortError" || /timed? out|timeout/.test(message)) {
    return errorResponse(504, "cf_timeout", "Transcription timed out.");
  }
  return errorResponse(502, "cf_failed", "Transcription service failed.");
}

async function transcribe(request, env, deadlineMs) {
  await authenticate(request, env);

  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  let audio;
  let language;
  let duration;
  if (contentType === "application/json") {
    const body = parseJsonBody(await readBoundedText(request, MAX_JSON_BODY_BYTES));
    let audioBytes = decodeBase64(body.audio);
    duration = parsePcmWav(audioBytes).duration;
    audio = body.audio;
    language = body.language;
    audioBytes = null;
  } else if (contentType === "audio/mpeg") {
    const languageHeader = request.headers.get("x-audio-language");
    if (languageHeader !== null && !/^[A-Za-z]{2,3}$/.test(languageHeader)) {
      throw invalidAudio();
    }
    let audioBytes = await readBoundedBytes(request, MAX_MP3_BODY_BYTES);
    duration = parseMp3(audioBytes).duration;
    audio = audioBytes.toString("base64");
    language = languageHeader?.toLowerCase();
    audioBytes = null;
  } else {
    throw invalidAudio();
  }

  const input = { audio, task: "transcribe", vad_filter: true };
  if (language) input.language = language;

  let response;
  try {
    response = await runWithDeadline(env.AI.run(MODEL, input), deadlineMs);
  } catch (error) {
    return providerErrorResponse(error);
  }

  const result = normalizeResponse(response, duration);
  return jsonResponse({ ok: true, result });
}

export async function handleRequest(request, env, options = {}) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return jsonResponse({
      ok: true,
      model: MODEL,
      capabilities: {
        acceptedFormats: ["audio/mpeg", "application/json"],
        maxAudioSeconds: MAX_AUDIO_SECONDS,
        maxAudioBytes: {
          audioMpeg: MAX_MP3_BODY_BYTES,
          json: MAX_JSON_BODY_BYTES,
        },
        deadlineMs: DEFAULT_DEADLINE_MS,
      },
    });
  }
  if (request.method !== "POST" || url.pathname !== "/v1/transcriptions") {
    return errorResponse(404, "cf_failed", "Route not found.");
  }

  try {
    return await transcribe(request, env, options.deadlineMs ?? DEFAULT_DEADLINE_MS);
  } catch (error) {
    if (error instanceof PublicError) {
      return errorResponse(error.status, error.code, error.message);
    }
    return errorResponse(502, "cf_failed", "Transcription service failed.");
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};

export {
  DEFAULT_DEADLINE_MS,
  MAX_AUDIO_SECONDS,
  MAX_JSON_BODY_BYTES,
  MAX_MP3_BODY_BYTES,
  MODEL,
  normalizeResponse,
  parseMp3,
  parsePcmWav,
};
