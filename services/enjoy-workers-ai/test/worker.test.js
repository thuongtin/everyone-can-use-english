import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_DEADLINE_MS,
  handleRequest,
  MAX_AUDIO_SECONDS,
  MAX_JSON_BODY_BYTES,
  MAX_MP3_BODY_BYTES,
  MODEL,
  parseMp3,
} from "../src/index.js";

const TOKEN = "test-client-token-at-least-32-characters";

function wavBase64({ seconds = 0.1, channels = 1, sampleRate = 16_000 } = {}) {
  const dataLength = Math.floor(seconds * sampleRate) * channels * 2;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  const write = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };
  write(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataLength, true);
  return Buffer.from(bytes).toString("base64");
}

function request(body, token = TOKEN, headers = {}) {
  return new Request("https://worker.example/v1/transcriptions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function mp3Buffer(seconds, { id3 = false } = {}) {
  const samplesPerFrame = 576;
  const frameDuration = samplesPerFrame / 16_000;
  const frameCount = Math.ceil(seconds / frameDuration);
  const frameLength = 36;
  const tagLength = id3 ? 10 : 0;
  const bytes = Buffer.alloc(tagLength + frameCount * frameLength);
  if (id3) {
    bytes.set([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  }
  for (let offset = tagLength; offset < bytes.length; offset += frameLength) {
    bytes.set([0xff, 0xf3, 0x18, 0xc0], offset);
  }
  return bytes;
}

function mp3Request(body, token = TOKEN, headers = {}) {
  return new Request("https://worker.example/v1/transcriptions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "audio/mpeg",
      ...headers,
    },
    body,
  });
}

function env(run) {
  return { ENJOY_CLIENT_TOKEN: TOKEN, AI: { run } };
}

async function captureWarnings(operation) {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (entry) => warnings.push(entry);
  try {
    return { result: await operation(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

test("health is public and does not call AI", async () => {
  let calls = 0;
  const response = await handleRequest(new Request("https://worker.example/health"), env(async () => { calls += 1; }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    model: MODEL,
    capabilities: {
      acceptedFormats: ["audio/mpeg", "application/json"],
      maxAudioSeconds: MAX_AUDIO_SECONDS,
      maxAudioBytes: { audioMpeg: MAX_MP3_BODY_BYTES, json: MAX_JSON_BODY_BYTES },
      deadlineMs: DEFAULT_DEADLINE_MS,
    },
  });
  assert.equal(calls, 0);
});

test("rejects missing and incorrect auth without calling AI", async () => {
  let calls = 0;
  const binding = env(async () => { calls += 1; });
  const missing = await handleRequest(
    new Request("https://worker.example/v1/transcriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audio: wavBase64() }),
    }),
    binding,
  );
  const wrong = await handleRequest(request({ audio: wavBase64() }, "wrong-token-value"), binding);
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).error.code, "cf_auth");
  assert.equal(wrong.status, 403);
  assert.equal((await wrong.json()).error.code, "cf_auth");
  assert.equal(calls, 0);
});

test("rejects bad JSON, malformed base64, and incompatible WAV without AI", async () => {
  let calls = 0;
  const binding = env(async () => { calls += 1; });
  const badJson = await handleRequest(
    new Request("https://worker.example/v1/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: "{",
    }),
    binding,
  );
  const badBase64 = await handleRequest(request({ audio: "not base64" }), binding);
  const badWav = await handleRequest(request({ audio: wavBase64({ sampleRate: 44_100 }) }), binding);
  for (const response of [badJson, badBase64, badWav]) {
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "cf_invalid_audio");
  }
  assert.equal(calls, 0);
});

test("normalizes valid text and ordered segments", async () => {
  let captured;
  const response = await handleRequest(
    request({ audio: wavBase64({ seconds: 1 }), language: "EN" }),
    env(async (model, input) => {
      captured = { model, input };
      return {
        text: "  hello world  ",
        segments: [
          { text: " hello ", start: 0, end: 0.4 },
          { text: "world", start: 0.4, end: 1 },
        ],
      };
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    result: {
      text: "hello world",
      segments: [
        { text: "hello", start: 0, end: 0.4 },
        { text: "world", start: 0.4, end: 1 },
      ],
    },
  });
  assert.equal(captured.model, MODEL);
  assert.equal(captured.input.language, "en");
  assert.equal(captured.input.task, "transcribe");
});

test("accepts the full 323.63975 second stereo probe without chunking", async () => {
  const audio = wavBase64({ seconds: 323.63975, channels: 2 });
  assert.equal(Buffer.from(audio, "base64").byteLength, 20_712_988);
  const response = await handleRequest(
    request({ audio, language: "vi" }),
    env(async (_model, input) => {
      assert.equal(input.audio.length, audio.length);
      return { text: "xin chào", segments: [{ text: "xin chào", start: 0, end: 323.63975 }] };
    }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.text, "xin chào");
});

test("enforces the stream body cap without relying on Content-Length", async () => {
  let calls = 0;
  const chunk = new Uint8Array(1_000_000);
  const body = new ReadableStream({
    start(controller) {
      for (let index = 0; index <= MAX_JSON_BODY_BYTES / chunk.byteLength; index += 1) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  const response = await handleRequest(
    new Request("https://worker.example/v1/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body,
      duplex: "half",
    }),
    env(async () => { calls += 1; }),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "cf_invalid_audio");
  assert.equal(calls, 0);
});

test("accepts a valid mono 16kHz Layer III MP3 longer than 600 seconds", async () => {
  const audio = mp3Buffer(601, { id3: true });
  const parsed = parseMp3(audio);
  assert.ok(parsed.duration > 600);
  let captured;
  const response = await handleRequest(
    mp3Request(audio, TOKEN, { "x-audio-language": "EN" }),
    env(async (model, input) => {
      captured = { model, input };
      return { text: "long audio", segments: [{ text: "long audio", start: 0, end: 601 }] };
    }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.text, "long audio");
  assert.equal(captured.model, MODEL);
  assert.equal(captured.input.language, "en");
  assert.equal(captured.input.audio, audio.toString("base64"));
});

test("accepts the existing real 53 minute MP3 fixture in the local parser", () => {
  const fixture = readFileSync(
    new URL("../../../enjoy/tmp/whisper-tiny-53min/full-audio.mp3", import.meta.url),
  );
  const parsed = parseMp3(fixture);
  assert.equal(fixture.byteLength, 25_903_156);
  assert.equal(parsed.frameCount, 89_941);
  assert.equal(parsed.duration, 3_237.876);
});

test("rejects MP3 duration beyond 3601 seconds before inference", async () => {
  let calls = 0;
  const response = await handleRequest(
    mp3Request(mp3Buffer(3_601.01)),
    env(async () => { calls += 1; }),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "cf_invalid_audio");
  assert.equal(calls, 0);
});

test("rejects malformed and truncated MP3 before inference", async () => {
  let calls = 0;
  const binding = env(async () => { calls += 1; });
  const malformed = await handleRequest(mp3Request(Buffer.from("not an mp3")), binding);
  const valid = mp3Buffer(1);
  const truncated = await handleRequest(mp3Request(valid.subarray(0, valid.length - 1)), binding);
  const invalidId3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x80, 0, 0, 0]);
  const badTag = await handleRequest(mp3Request(invalidId3), binding);
  for (const response of [malformed, truncated, badTag]) {
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "cf_invalid_audio");
  }
  assert.equal(calls, 0);
});

test("enforces the binary stream cap and auth before inference", async () => {
  let calls = 0;
  const binding = env(async () => { calls += 1; });
  const missingAuth = await handleRequest(
    new Request("https://worker.example/v1/transcriptions", {
      method: "POST",
      headers: { "content-type": "audio/mpeg" },
      body: mp3Buffer(1),
    }),
    binding,
  );
  const chunk = new Uint8Array(1_000_000);
  const body = new ReadableStream({
    start(controller) {
      for (let index = 0; index <= MAX_MP3_BODY_BYTES / chunk.byteLength; index += 1) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  const tooLarge = await handleRequest(
    new Request("https://worker.example/v1/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "audio/mpeg" },
      body,
      duplex: "half",
    }),
    binding,
  );
  assert.equal(missingAuth.status, 401);
  assert.equal(tooLarge.status, 400);
  assert.equal((await tooLarge.json()).error.code, "cf_invalid_audio");
  assert.equal(calls, 0);
});

test("accepts text without provider segments for client DTW fallback", async () => {
  const response = await handleRequest(
    request({ audio: wavBase64() }),
    env(async () => ({ text: "fallback text" })),
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).result.segments, []);
});

test("maps true empty transcription to cf_no_speech", async () => {
  const response = await handleRequest(
    request({ audio: wavBase64() }),
    env(async () => ({ text: "   ", segments: [] })),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "cf_no_speech", message: "No speech detected." },
  });
});

test("rejects out-of-bounds provider segments", async () => {
  const response = await handleRequest(
    request({ audio: wavBase64({ seconds: 0.1 }) }),
    env(async () => ({ text: "hello", segments: [{ text: "hello", start: 0, end: 0.2 }] })),
  );
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, "cf_invalid_response");
});

test("clamps a provider segment end rounded up by less than 20ms", async () => {
  const response = await handleRequest(
    request({ audio: wavBase64({ seconds: 323.63975, channels: 2 }) }),
    env(async () => ({
      text: "hello",
      segments: [{ text: "hello", start: 317, end: 323.64 }],
    })),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.segments[0].end, 323.63975);
});

test("maps provider quota without exposing provider text", async () => {
  const { result: response, warnings } = await captureWarnings(() =>
    handleRequest(
      request({ audio: wavBase64() }),
      env(async () => {
        const error = new Error("account quota includes private provider details");
        error.status = 429;
        error.code = "7505";
        throw error;
      }),
    ),
  );
  assert.equal(response.status, 429);
  const payload = await response.json();
  assert.equal(payload.error.code, "cf_quota");
  assert.equal(JSON.stringify(payload).includes("private"), false);
  assert.deepEqual(warnings, [{ event: "inference_failed", status: 429, errorCode: "7505" }]);
});

test("classifies a provider input-size rejection without logging its message", async () => {
  const { result: response, warnings } = await captureWarnings(() =>
    handleRequest(
      request({ audio: wavBase64() }),
      env(async () => {
        const error = new Error("audio too long: private upstream details");
        error.status = 400;
        throw error;
      }),
    ),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "cf_invalid_audio");
  assert.deepEqual(warnings, [{ event: "inference_failed", status: 400, errorCode: "unknown" }]);
});

test("returns bounded deadline timeout", async () => {
  const { result: response, warnings } = await captureWarnings(() =>
    handleRequest(
      request({ audio: wavBase64() }),
      env(() => new Promise(() => {})),
      { deadlineMs: 5 },
    ),
  );
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error.code, "cf_timeout");
  assert.deepEqual(warnings, [{ event: "inference_failed", status: null, errorCode: "deadline" }]);
});
