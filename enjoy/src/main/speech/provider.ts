import OpenAI, { type ClientOptions } from "openai";
import * as azureSdk from "microsoft-cognitiveservices-speech-sdk";
import {
  buildOpenAiSpeechRequest,
  ensureAudioArrayBuffer,
  validateAzureTtsInput,
} from "../../lib/speech-models";
import {
  assertAllowedNetworkUrl,
  createGuardedFetch,
  type GuardedFetchInput,
} from "../../lib/network-policy";

export const MAX_SPEECH_BYTES = 64 * 1024 * 1024;
const MAX_SPEECH_TIMEOUT_MS = 60_000;
const DEFAULT_SPEECH_TIMEOUT_MS = MAX_SPEECH_TIMEOUT_MS;
const CLEANUP_TIMEOUT_MS = 250;
const AZURE_CLOSE_TIMEOUT_MS = 5_000;

export type SpeechProviderErrorCode =
  | "speech_cancelled"
  | "speech_timeout"
  | "speech_quota"
  | "speech_auth"
  | "speech_network"
  | "speech_failed";

export class SpeechProviderError extends Error {
  readonly code: SpeechProviderErrorCode;

  constructor(code: SpeechProviderErrorCode, message: string) {
    super(message);
    this.name = "SpeechProviderError";
    this.code = code;
  }
}

export type SpeechProviderConfiguration = Readonly<{
  engine: "openai" | "azure";
  model: string;
  voice: string;
}>;

export type SpeechSynthesisResult = Readonly<{
  bytes: Buffer;
  mimeType: "audio/mpeg" | "audio/wav";
  engine: SpeechProviderConfiguration["engine"];
  model: string;
  voice: string;
}>;

export interface SpeechProvider {
  readonly id: string;
  readonly model: string;
  readonly voice: string;
  synthesize(
    text: string,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<SpeechSynthesisResult>;
}

const fail = (code: SpeechProviderErrorCode, message: string): never => {
  throw new SpeechProviderError(code, message);
};

function boundedTimeout(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SPEECH_TIMEOUT_MS;
  }
  return Math.min(Math.floor(value), MAX_SPEECH_TIMEOUT_MS);
}

function errorProperty(error: unknown, property: string): unknown {
  if (!error || typeof error !== "object") return undefined;
  return (error as Record<string, unknown>)[property];
}

function isQuotaError(error: unknown): boolean {
  const status = errorProperty(error, "status");
  if (status === 402 || status === 429 || status === "402" || status === "429") return true;
  const code = errorProperty(error, "code");
  if (typeof code !== "string") return false;
  return new Set([
    "insufficient_quota",
    "billing_hard_limit_reached",
    "rate_limit_exceeded",
    "quota_exceeded",
  ]).has(code.toLowerCase());
}

function isTimeoutError(error: unknown, depth = 0): boolean {
  const name = errorProperty(error, "name");
  const code = errorProperty(error, "code");
  if ([name, code].some(
    (value) =>
      typeof value === "string" &&
      /timeout|timed.?out|etimedout/iu.test(value),
  )) return true;
  return depth < 2 && isTimeoutError(errorProperty(error, "cause"), depth + 1);
}

function isAbortError(error: unknown): boolean {
  const name = errorProperty(error, "name");
  return typeof name === "string" && /abort|cancel/iu.test(name);
}

function providerErrorFor(
  error: unknown,
  signal?: AbortSignal,
): SpeechProviderError {
  const status = errorProperty(error, "status");
  if (status === 401 || status === 403) {
    return new SpeechProviderError("speech_auth", "Speech provider authorization was rejected");
  }
  if (isTimeoutError(error)) {
    return new SpeechProviderError("speech_timeout", "Speech synthesis timed out");
  }
  if (signal?.aborted || isAbortError(error)) {
    return new SpeechProviderError(
      "speech_cancelled",
      "Speech synthesis was cancelled",
    );
  }
  if (isQuotaError(error)) {
    return new SpeechProviderError(
      "speech_quota",
      "Speech provider quota was unavailable",
    );
  }
  if (error instanceof OpenAI.APIConnectionError || errorProperty(error, "name") === "APIConnectionError") {
    return new SpeechProviderError("speech_network", "Speech provider connection failed");
  }
  return new SpeechProviderError("speech_failed", "Speech synthesis failed");
}

function assertAudioBytes(value: unknown, mimeType: SpeechSynthesisResult["mimeType"]): Buffer {
  let bytes: Buffer;
  try {
    const arrayBuffer = ensureAudioArrayBuffer(value);
    bytes = Buffer.from(arrayBuffer);
  } catch {
    return fail("speech_failed", "Speech provider returned invalid audio");
  }

  if (bytes.length > MAX_SPEECH_BYTES) {
    return fail("speech_failed", "Speech provider audio is too large");
  }
  if (mimeType === "audio/wav" && !isWav(bytes)) {
    return fail("speech_failed", "Speech provider returned invalid WAV audio");
  }
  if (mimeType === "audio/mpeg" && !isMp3(bytes)) {
    return fail("speech_failed", "Speech provider returned invalid MP3 audio");
  }
  return bytes;
}

async function cancelAudioReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    // A broken or synthetic Response must not make cancellation itself
    // unbounded. The fetch controller still owns the transport abort.
    await Promise.race([
      reader.cancel(),
      new Promise<void>((resolve) => setTimeout(resolve, CLEANUP_TIMEOUT_MS)),
    ]);
  } catch {
    // The reader is already closed or errored. There is no further cleanup
    // action available at this layer.
  }
}

type AudioBodyIterator = AsyncIterator<unknown> & {
  return?: (value?: unknown) => Promise<IteratorResult<unknown>> | IteratorResult<unknown>;
};

type AudioBody = {
  getReader?: () => ReadableStreamDefaultReader<Uint8Array>;
  [Symbol.asyncIterator]?: () => AudioBodyIterator;
  cancel?: () => void | Promise<void>;
  destroy?: () => void;
};

async function cancelAudioBody(
  body: AudioBody,
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
  iterator: AudioBodyIterator | undefined,
): Promise<void> {
  if (reader) {
    await cancelAudioReader(reader);
    return;
  }
  try {
    body.destroy?.();
  } catch {
    // The Node stream may already be destroyed.
  }
  try {
    await Promise.race([
      Promise.resolve().then(() => body.cancel?.()),
      Promise.resolve().then(() => iterator?.return?.()),
      new Promise<void>((resolve) => setTimeout(resolve, CLEANUP_TIMEOUT_MS)),
    ]);
  } catch {
    // Closing the transport is best effort after an abort or byte-limit hit.
  }
}

async function readBoundedAudioResponse(
  response: Response,
  signal?: AbortSignal,
  abort?: () => void,
): Promise<Buffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > MAX_SPEECH_BYTES
    ) {
      abort?.();
      return fail("speech_failed", "Speech provider audio is too large");
    }
  }

  if (!response.body) {
    abort?.();
    return fail("speech_failed", "Speech provider returned an invalid audio response");
  }

  const body = response.body as unknown as AudioBody;
  const reader = body.getReader?.();
  const iterator = reader ? undefined : body[Symbol.asyncIterator]?.();
  if (!reader && !iterator) {
    abort?.();
    return fail("speech_failed", "Speech provider returned an invalid audio response");
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const cancelOnAbort = () => {
    void cancelAudioBody(body, reader, iterator);
  };
  signal?.addEventListener("abort", cancelOnAbort, { once: true });
  try {
    const appendChunk = (value: unknown): void => {
      if (!(value instanceof Uint8Array) || value.byteLength === 0) return;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_SPEECH_BYTES) {
        throw new SpeechProviderError(
          "speech_failed",
          "Speech provider audio is too large",
        );
      }
      chunks.push(value);
    };

    if (reader) {
      while (true) {
        if (signal?.aborted) {
          await cancelAudioBody(body, reader, iterator);
          fail("speech_cancelled", "Speech synthesis was cancelled");
        }
        const { done, value } = await reader.read();
        if (done) break;
        appendChunk(value);
      }
    } else if (iterator) {
      while (true) {
        if (signal?.aborted) {
          await cancelAudioBody(body, reader, iterator);
          fail("speech_cancelled", "Speech synthesis was cancelled");
        }
        const { done, value } = await iterator.next();
        if (done) break;
        appendChunk(value);
      }
    }
  } catch (error) {
    if (error instanceof SpeechProviderError) {
      abort?.();
      await cancelAudioBody(body, reader, iterator);
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancelOnAbort);
    reader?.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

function isWav(bytes: Buffer): boolean {
  return (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WAVE"
  );
}

function isMp3(bytes: Buffer): boolean {
  if (
    bytes.length >= 10 &&
    bytes.subarray(0, 3).toString("ascii") === "ID3"
  ) {
    return (
      bytes[3] < 0xff &&
      bytes[4] < 0xff &&
      bytes[6] < 0x80 &&
      bytes[7] < 0x80 &&
      bytes[8] < 0x80 &&
      bytes[9] < 0x80
    );
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || (bytes[1] & 0xe0) !== 0xe0) {
    return false;
  }
  const version = (bytes[1] >> 3) & 0x03;
  const layer = (bytes[1] >> 1) & 0x03;
  const bitrate = (bytes[2] >> 4) & 0x0f;
  const sampleRate = (bytes[2] >> 2) & 0x03;
  return version !== 1 && layer !== 0 && bitrate !== 0 && bitrate !== 0x0f && sampleRate !== 3;
}

function validateConfiguration(configuration: SpeechProviderConfiguration): SpeechProviderConfiguration {
  if (!configuration || (configuration.engine !== "openai" && configuration.engine !== "azure")) {
    return fail("speech_failed", "Speech provider engine is invalid");
  }
  if (typeof configuration.model !== "string" || !configuration.model.trim()) {
    return fail("speech_failed", "Speech provider model is required");
  }
  if (typeof configuration.voice !== "string" || !configuration.voice.trim()) {
    return fail("speech_failed", "Speech provider voice is required");
  }
  return configuration;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    fail("speech_cancelled", "Speech synthesis was cancelled");
  }
}

export function createOpenAiSpeechProvider(params: {
  configuration: SpeechProviderConfiguration;
  clientOptions: ClientOptions;
}): SpeechProvider {
  const configuration = validateConfiguration(params.configuration);
  const clientOptions = params.clientOptions;
  if (!clientOptions || typeof clientOptions.apiKey !== "string" || !clientOptions.apiKey.trim()) {
    return fail("speech_failed", "OpenAI speech API key is required");
  }

  const configuredBaseURL =
    typeof clientOptions.baseURL === "string" && clientOptions.baseURL.trim()
      ? clientOptions.baseURL.trim()
      : "https://api.openai.com/v1";
  assertAllowedNetworkUrl(configuredBaseURL, {
    transport: "openai-speech-sdk",
    operation: "configure",
  });
  const fetchImplementation = clientOptions.fetch ?? globalThis.fetch.bind(globalThis);
  const providerFetch = createGuardedFetch(
    fetchImplementation as unknown as (
      input: GuardedFetchInput,
      init?: RequestInit,
    ) => Promise<Response>,
    { transport: "openai-speech-sdk", operation: "request" },
  );

  let providerRequest;
  try {
    providerRequest = buildOpenAiSpeechRequest({
      engine: configuration.engine,
      model: configuration.model,
      voice: configuration.voice,
      text: "provider configuration validation",
    });
  } catch {
    return fail("speech_failed", "OpenAI speech configuration is invalid");
  }

  const client = new OpenAI({
    ...clientOptions,
    apiKey: clientOptions.apiKey.trim(),
    baseURL: configuredBaseURL,
    fetch: providerFetch as unknown as ClientOptions["fetch"],
    maxRetries: 0,
    // The provider owns the deadline so it can return a stable timeout code.
    timeout: MAX_SPEECH_TIMEOUT_MS,
  });
  const timeoutMs = boundedTimeout(clientOptions.timeout);

  const provider: SpeechProvider = {
    id: "openai",
    model: providerRequest.model,
    voice: providerRequest.voice,
    async synthesize(text, options = {}) {
      const signal = options.signal;
      assertNotAborted(signal);
      const controller = new AbortController();
      let timeoutReached = false;
      const forwardAbort = () => controller.abort();
      signal?.addEventListener("abort", forwardAbort, { once: true });
      const timer = setTimeout(() => {
        timeoutReached = true;
        controller.abort();
      }, timeoutMs);
      let request;
      try {
        request = buildOpenAiSpeechRequest({
          engine: configuration.engine,
          model: configuration.model,
          voice: configuration.voice,
          text,
        });
        const response = await client.audio.speech.create(request, {
          signal: controller.signal,
        });
        if (timeoutReached) {
          return fail("speech_timeout", "Speech synthesis timed out");
        }
        if (signal?.aborted) {
          return fail("speech_cancelled", "Speech synthesis was cancelled");
        }
        const bytes = assertAudioBytes(
          await readBoundedAudioResponse(
            response,
            controller.signal,
            () => controller.abort(),
          ),
          "audio/mpeg",
        );
        if (timeoutReached) {
          return fail("speech_timeout", "Speech synthesis timed out");
        }
        if (signal?.aborted) {
          return fail("speech_cancelled", "Speech synthesis was cancelled");
        }
        return {
          bytes,
          mimeType: "audio/mpeg",
          engine: configuration.engine,
          model: request.model,
          voice: request.voice,
        };
      } catch (error) {
        if (error instanceof SpeechProviderError) throw error;
        if (timeoutReached) {
          throw new SpeechProviderError("speech_timeout", "Speech synthesis timed out");
        }
        throw providerErrorFor(error, signal);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", forwardAbort);
      }
    },
  };
  return Object.freeze(provider);
}

export type AzureSpeechCredentials = Readonly<{
  subscriptionKey: string;
  region: string;
}>;

type AzureSpeechSynthesizer = {
  speakTextAsync(
    text: string,
    completed: (result: unknown) => void,
    failed: (error: unknown) => void,
  ): void;
  close(
    completed?: () => void,
    failed?: (error: string) => void,
  ): void | Promise<void>;
};

export type AzureSpeechSdkFactory = Readonly<{
  createSpeechConfig(subscriptionKey: string, region: string, voice: string): unknown;
  createSynthesizer(config: unknown): AzureSpeechSynthesizer;
  completedReason: unknown;
}>;

function createNativeAzureSpeechSdkFactory(): AzureSpeechSdkFactory {
  return {
    createSpeechConfig(subscriptionKey, region, voice) {
      const config = azureSdk.SpeechConfig.fromSubscription(subscriptionKey, region);
      config.speechSynthesisVoiceName = voice;
      config.speechSynthesisOutputFormat =
        azureSdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm;
      return config;
    },
    createSynthesizer(config) {
      return new azureSdk.SpeechSynthesizer(config as azureSdk.SpeechConfig, null);
    },
    completedReason: azureSdk.ResultReason.SynthesizingAudioCompleted,
  };
}

async function boundedCleanup(
  operation: () => void | Promise<void>,
  timeoutMs = CLEANUP_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Speech cleanup timed out")),
          timeoutMs,
        );
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function safeClose(
  synthesizer: AzureSpeechSynthesizer | undefined,
  timeoutMs: number,
): Promise<boolean> {
  if (!synthesizer) return true;
  return boundedCleanup(
    () =>
      new Promise<void>((resolve, reject) => {
        let settled = false;
        const complete = (): void => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const failed = (error: string): void => {
          if (settled) return;
          settled = true;
          reject(new Error(error || "Speech synthesizer close failed"));
        };
        try {
          const result = synthesizer.close(complete, failed);
          if (result && typeof (result as Promise<void>).then === "function") {
            void result.then(complete, failed);
          } else if (synthesizer.close.length === 0) {
            // Test seams and synchronous implementations can expose a
            // zero-argument close method. The native SDK declares callback
            // parameters and completes through `completed` above.
            complete();
          }
        } catch (error) {
          failed(error instanceof Error ? error.message : String(error));
        }
      }),
    timeoutMs,
  );
}

function timeoutError(): SpeechProviderError {
  return new SpeechProviderError("speech_timeout", "Speech synthesis timed out");
}

function cancellationError(): SpeechProviderError {
  return new SpeechProviderError(
    "speech_cancelled",
    "Speech synthesis was cancelled",
  );
}

export function createAzureSpeechProvider(params: {
  configuration: SpeechProviderConfiguration;
  credentials: AzureSpeechCredentials;
  timeoutMs?: number;
  /** Test-only SDK seam. Production callers should omit this property. */
  sdkFactory?: AzureSpeechSdkFactory;
}): SpeechProvider {
  const configuration = validateConfiguration(params.configuration);
  if (configuration.engine !== "azure") {
    return fail("speech_failed", "Azure speech requires the Azure engine");
  }
  const subscriptionKey = params.credentials?.subscriptionKey?.trim();
  const region = params.credentials?.region?.trim().toLowerCase();
  if (!subscriptionKey || !region || !/^[a-z0-9-]+$/u.test(region)) {
    return fail("speech_failed", "Azure Speech credentials are required");
  }
  const sdkFactory = params.sdkFactory ?? createNativeAzureSpeechSdkFactory();
  let providerRequest;
  try {
    providerRequest = validateAzureTtsInput({
      model: configuration.model,
      voice: configuration.voice,
      text: "provider configuration validation",
    });
  } catch {
    return fail("speech_failed", "Azure speech configuration is invalid");
  }
  const timeoutMs = boundedTimeout(params.timeoutMs);

  const provider: SpeechProvider = {
    id: "azure",
    model: providerRequest.model,
    voice: providerRequest.voice,
    async synthesize(text, options = {}) {
      const signal = options.signal;
      assertNotAborted(signal);
      let request;
      try {
        request = validateAzureTtsInput({
          model: configuration.model,
          voice: configuration.voice,
          text,
        });
      } catch {
        return fail("speech_failed", "Azure speech request is invalid");
      }

      const controller = new AbortController();
      let timeoutReached = false;
      let synthesizer: AzureSpeechSynthesizer | undefined;
      let synthesisResult: SpeechSynthesisResult | undefined;
      let closeSucceeded = true;
      const forwardAbort = () => controller.abort();
      signal?.addEventListener("abort", forwardAbort, { once: true });
      const timer = setTimeout(() => {
        timeoutReached = true;
        controller.abort();
      }, timeoutMs);
      try {
        const speechConfig = sdkFactory.createSpeechConfig(
          subscriptionKey,
          region,
          request.voice,
        );
        synthesizer = sdkFactory.createSynthesizer(speechConfig);
        if (controller.signal.aborted) {
          return fail(
            timeoutReached ? "speech_timeout" : "speech_cancelled",
            timeoutReached ? "Speech synthesis timed out" : "Speech synthesis was cancelled",
          );
        }

        const abortPromise = new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            "abort",
            () => reject(timeoutReached ? timeoutError() : cancellationError()),
            { once: true },
          );
        });
        const synthesisPromise = new Promise<unknown>((resolve, reject) => {
          try {
            synthesizer?.speakTextAsync(
              request.text,
              (result) => resolve(result),
              () => reject(new Error("Azure speech synthesis failed")),
            );
          } catch {
            reject(new Error("Azure speech synthesis failed"));
          }
        });
        const result = (await Promise.race([synthesisPromise, abortPromise])) as {
          reason?: unknown;
          audioData?: unknown;
        };
        if (controller.signal.aborted) {
          return fail(
            timeoutReached ? "speech_timeout" : "speech_cancelled",
            timeoutReached ? "Speech synthesis timed out" : "Speech synthesis was cancelled",
          );
        }
        if (result?.reason !== sdkFactory.completedReason) {
          return fail("speech_failed", "Azure speech synthesis did not complete");
        }
        const bytes = assertAudioBytes(result.audioData, "audio/wav");
        if (controller.signal.aborted) {
          return fail(
            timeoutReached ? "speech_timeout" : "speech_cancelled",
            timeoutReached ? "Speech synthesis timed out" : "Speech synthesis was cancelled",
          );
        }
        synthesisResult = {
          bytes,
          mimeType: "audio/wav",
          engine: configuration.engine,
          model: request.model,
          voice: request.voice,
        };
      } catch (error) {
        if (error instanceof SpeechProviderError) throw error;
        if (timeoutReached) {
          throw timeoutError();
        }
        throw providerErrorFor(error, signal ?? controller.signal);
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", forwardAbort);
        closeSucceeded = await safeClose(synthesizer, AZURE_CLOSE_TIMEOUT_MS);
      }
      if (!closeSucceeded) {
        throw new SpeechProviderError(
          "speech_failed",
          "Speech synthesis cleanup did not complete",
        );
      }
      assertNotAborted(signal);
      return synthesisResult as SpeechSynthesisResult;
    },
  };
  return Object.freeze(provider);
}
