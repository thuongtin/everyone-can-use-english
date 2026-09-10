import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(root, ".tmp-learning-narration-"));
const output = path.join(temp, "narration.mjs");
const tests = [];
const test = async (name, callback) => {
  await callback();
  tests.push(name);
};

const readRequest = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

const listen = async (server) => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}/v1`;
};

const closeServer = async (server) => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(() => resolve()));
};

const fixtureMp3 = Buffer.from([
  0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xff, 0xfb, 0x90, 0x64,
]);
const fixtureWav = Buffer.from("RIFF\x10\x00\x00\x00WAVEfmt ", "binary");

try {
  await build({
    stdin: {
      contents: `export * from "./src/main/speech/provider.ts"; export * from "./src/main/learning/narration-chunks.ts"; export * from "./src/lib/network-policy.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });

  const {
    createAzureSpeechProvider,
    createOpenAiSpeechProvider,
    getNetworkPolicyDiagnostics,
    MAX_SPEECH_BYTES,
    SpeechProviderError,
    splitNarrationText,
  } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

  await test("splits long, unusual, and Unicode text into ordered bounded source slices", () => {
    const source = [
      "First paragraph has a sentence that is intentionally longer than the small test limit.",
      "\n\n",
      "A verylongwordwithoutanyspacesmustfallbacktocodepoints.",
      "\n",
      "Emoji 😀 keeps surrogate pairs intact. Câu tiếng Việt vẫn giữ nguyên dấu.",
    ].join("");
    const chunks = splitNarrationText(source, 17);
    assert.ok(chunks.length > 4);
    assert.deepEqual(chunks.map(({ index }) => index), chunks.map((_, index) => index));
    for (const chunk of chunks) {
      assert.ok([...chunk.text].length <= 17);
      assert.equal(source.slice(chunk.startOffset, chunk.endOffset), chunk.text);
      assert.ok(chunk.endOffset > chunk.startOffset);
    }
    assert.equal(
      chunks.map(({ text }) => text).join("").replace(/\s/gu, ""),
      source.trim().replace(/\s/gu, ""),
    );
    assert.equal(chunks.some(({ text }) => text.includes("😀")), true);

    const exactSource = " \n😀  Câu có dấu.\t\n ";
    const exactChunks = splitNarrationText(exactSource, 3);
    assert.equal(exactChunks.map(({ text }) => text).join(""), exactSource);
    assert.equal(exactChunks[0].startOffset, 0);
    assert.equal(exactChunks.at(-1)?.endOffset, exactSource.length);
    for (const [index, chunk] of exactChunks.entries()) {
      assert.ok([...chunk.text].length <= 3);
      assert.equal(chunk.startOffset, index === 0 ? 0 : exactChunks[index - 1].endOffset);
      assert.equal(exactSource.slice(chunk.startOffset, chunk.endOffset), chunk.text);
    }
  });

  await test("rejects empty input and invalid limits", () => {
    assert.throws(() => splitNarrationText(""));
    assert.throws(() => splitNarrationText(" \n\t"));
    assert.throws(() => splitNarrationText("hello", 0));
    assert.throws(() => splitNarrationText("hello", 1.5));
  });

  const requestLog = [];
  let mode = "success";
  let oversizeClosed = false;
  const server = createServer(async (request, response) => {
    const body = await readRequest(request);
    requestLog.push({ body, headers: request.headers, url: request.url });
    if (mode === "auth") {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "sk-private-response-canary" } }));
      return;
    }
    if (mode === "network") {
      request.socket.destroy();
      return;
    }
    if (mode === "quota") {
      response.writeHead(429, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { code: "insufficient_quota" } }));
      return;
    }
    if (mode === "invalid") {
      response.writeHead(200, { "content-type": "audio/mpeg" });
      response.end(Buffer.from([1, 2, 3]));
      return;
    }
    if (mode === "delay") {
      setTimeout(() => {
        if (!response.destroyed) {
          response.writeHead(200, { "content-type": "audio/mpeg" });
          response.end(fixtureMp3);
        }
      }, 120);
      return;
    }
    if (mode === "oversize") {
      response.writeHead(200, { "content-type": "audio/mpeg" });
      response.on("close", () => {
        oversizeClosed = true;
      });
      const chunk = Buffer.alloc(1024 * 1024, 0x41);
      for (let index = 0; index <= MAX_SPEECH_BYTES / chunk.length; index += 1) {
        if (response.destroyed) break;
        response.write(chunk);
      }
      if (!response.destroyed) {
        setTimeout(() => response.end(), 1_000);
      }
      return;
    }
    response.writeHead(200, { "content-type": "audio/mpeg" });
    response.end(fixtureMp3);
  });
  const baseURL = await listen(server);
  const configuration = {
    engine: "openai",
    model: "gpt-4o-mini-tts",
    voice: "alloy",
  };

  try {
    await test("blocks retired OpenAI-compatible aliases during provider configuration", () => {
      const before = getNetworkPolicyDiagnostics().blockedAttemptCount;
      assert.throws(
        () => createOpenAiSpeechProvider({
          configuration,
          clientOptions: {
            apiKey: "sk-u8-config-canary",
            baseURL: "https://api.getenjoyapp.com/v1",
          },
        }),
        (error) => error?.code === "retired_enjoy_host",
      );
      assert.equal(getNetworkPolicyDiagnostics().blockedAttemptCount, before + 1);
    });

    await test("blocks retired redirect aliases before forwarding the OpenAI request", async () => {
      const before = getNetworkPolicyDiagnostics().blockedAttemptCount;
      const calls = [];
      const provider = createOpenAiSpeechProvider({
        configuration,
        clientOptions: {
          apiKey: "sk-u8-redirect-canary",
          baseURL: "https://speech-origin.invalid/v1",
          fetch: async (input, init) => {
            calls.push({ input: String(input), init });
            return new Response(null, {
              status: 302,
              headers: { location: "https://enjoy.bot/retired-speech" },
            });
          },
        },
      });
      await assert.rejects(
        provider.synthesize("Retired redirect fixture."),
        (error) => error instanceof SpeechProviderError && error.code === "speech_network",
      );
      assert.equal(calls.length, 1);
      assert.equal(getNetworkPolicyDiagnostics().blockedAttemptCount, before + 1);
    });

    await test("removes authorization before following a cross-origin redirect", async () => {
      const calls = [];
      const provider = createOpenAiSpeechProvider({
        configuration,
        clientOptions: {
          apiKey: "sk-u8-cross-origin-canary",
          baseURL: "https://speech-origin.invalid/v1",
          fetch: async (input, init = {}) => {
            const headers = new Headers(init.headers);
            calls.push({
              authorization: headers.get("authorization"),
              url: String(input),
            });
            if (calls.length === 1) {
              return new Response(null, {
                status: 302,
                headers: { location: "https://speech-target.invalid/audio" },
              });
            }
            return new Response(fixtureMp3, {
              status: 200,
              headers: { "content-type": "audio/mpeg" },
            });
          },
        },
      });
      const result = await provider.synthesize("Cross-origin redirect fixture.");
      assert.deepEqual(result.bytes, fixtureMp3);
      assert.equal(calls.length, 2);
      assert.equal(calls[0].authorization, "Bearer sk-u8-cross-origin-canary");
      assert.equal(calls[1].authorization, null);
      assert.match(calls[1].url, /^https:\/\/speech-target\.invalid\/audio$/u);
    });

    await test("uses the OpenAI SDK against a local HTTP fixture without retries", async () => {
      mode = "success";
      requestLog.length = 0;
      const provider = createOpenAiSpeechProvider({
        configuration,
        clientOptions: {
          apiKey: "sk-u8-canary-key",
          baseURL,
          maxRetries: 9,
          timeout: 60_000,
        },
      });
      const result = await provider.synthesize("A local fixture sentence.");
      assert.equal(provider.id, "openai");
      assert.equal(provider.model, "gpt-4o-mini-tts");
      assert.equal(result.mimeType, "audio/mpeg");
      assert.deepEqual(result.bytes, fixtureMp3);
      assert.equal(result.engine, "openai");
      assert.equal(result.model, "gpt-4o-mini-tts");
      assert.equal(result.voice, "alloy");
      assert.equal(requestLog.length, 1);
      assert.equal(requestLog[0].url, "/v1/audio/speech");
      assert.equal(requestLog[0].headers.authorization, "Bearer sk-u8-canary-key");
      assert.deepEqual(JSON.parse(requestLog[0].body), {
        input: "A local fixture sentence.",
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        response_format: "mp3",
      });
      assert.equal(requestLog[0].body.includes("sk-u8-canary-key"), false);
    });

    await test("maps quota failures without fallback or hidden retries", async () => {
      mode = "quota";
      requestLog.length = 0;
      const provider = createOpenAiSpeechProvider({
        configuration,
        clientOptions: {
          apiKey: "sk-u8-quota-canary",
          baseURL,
          timeout: 1_000,
        },
      });
      await assert.rejects(
        provider.synthesize("Quota fixture."),
        (error) => error instanceof SpeechProviderError && error.code === "speech_quota",
      );
      assert.equal(requestLog.length, 1);
    });

    await test("maps cancellation and timeout without retrying the request", async () => {
      mode = "delay";
      requestLog.length = 0;
      const provider = createOpenAiSpeechProvider({
        configuration,
        clientOptions: {
          apiKey: "sk-u8-cancel-canary",
          baseURL,
          timeout: 1_000,
        },
      });
      const controller = new AbortController();
      const cancelled = provider.synthesize("Cancel fixture.", { signal: controller.signal });
      setTimeout(() => controller.abort(), 15);
      await assert.rejects(
        cancelled,
        (error) => error instanceof SpeechProviderError && error.code === "speech_cancelled",
      );
      assert.equal(requestLog.length, 1);

      requestLog.length = 0;
      const timed = createOpenAiSpeechProvider({
        configuration,
        clientOptions: {
          apiKey: "sk-u8-timeout-canary",
          baseURL,
          timeout: 20,
        },
      });
      await assert.rejects(
        timed.synthesize("Timeout fixture."),
        (error) => error instanceof SpeechProviderError && error.code === "speech_timeout",
      );
      assert.equal(requestLog.length, 1);
    });

    await test("classifies authorization and connection failures without raw provider output", async () => {
      for (const [scenario, code] of [["auth", "speech_auth"], ["network", "speech_network"]]) {
        mode = scenario;
        const provider = createOpenAiSpeechProvider({ configuration, clientOptions: { apiKey: "sk-test-canary", baseURL } });
        await assert.rejects(provider.synthesize("Classification fixture."), error => error instanceof SpeechProviderError && error.code === code && !error.message.includes("canary"));
      }
    });

    await test("rejects invalid provider bytes and missing API keys without leaking secrets", async () => {
      mode = "invalid";
      const provider = createOpenAiSpeechProvider({
        configuration,
        clientOptions: {
          apiKey: "sk-u8-invalid-canary",
          baseURL,
        },
      });
      await assert.rejects(
        provider.synthesize("Invalid fixture."),
        (error) => error instanceof SpeechProviderError && error.code === "speech_failed",
      );
      assert.throws(
        () => createOpenAiSpeechProvider({
          configuration,
          clientOptions: { baseURL },
        }),
        (error) => error instanceof SpeechProviderError && error.code === "speech_failed" && !error.message.includes("sk-u8"),
      );
    });

    await test("rejects chunked audio over the byte limit and closes the response", async () => {
      mode = "oversize";
      oversizeClosed = false;
      const provider = createOpenAiSpeechProvider({
        configuration,
        clientOptions: {
          apiKey: "sk-u8-oversize-canary",
          baseURL,
          timeout: 5_000,
        },
      });
      await assert.rejects(
        provider.synthesize("Oversize fixture."),
        (error) => error instanceof SpeechProviderError && error.code === "speech_failed",
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(oversizeClosed, true);
    });
  } finally {
    await closeServer(server);
  }

  await test("uses direct Azure subscription credentials and validates WAV output", async () => {
    const calls = [];
    const sdkFactory = {
      completedReason: "completed",
      createSpeechConfig(subscriptionKey, region, voice) {
        calls.push(["config", subscriptionKey, region, voice]);
        return { subscriptionKey, region, voice };
      },
      createSynthesizer(config) {
        calls.push(["synthesizer", config]);
        return {
          speakTextAsync(text, completed) {
            calls.push(["speak", text]);
            queueMicrotask(() => completed({ reason: "completed", audioData: fixtureWav }));
          },
          close(completed) {
            calls.push(["close"]);
            queueMicrotask(completed);
          },
        };
      },
    };
    const provider = createAzureSpeechProvider({
      configuration: { engine: "azure", model: "azure/speech", voice: "en-US-JennyNeural" },
      credentials: { subscriptionKey: "direct-key", region: "EastUS" },
      sdkFactory,
    });
    const result = await provider.synthesize("Azure fixture.");
    assert.equal(result.mimeType, "audio/wav");
    assert.deepEqual(result.bytes, fixtureWav);
    assert.deepEqual(calls[0], ["config", "direct-key", "eastus", "en-US-JennyNeural"]);
    assert.equal(result.engine, "azure");
  });

  await test("cancels direct Azure synthesis and ignores late callbacks", async () => {
    let complete;
    const calls = [];
    const sdkFactory = {
      completedReason: "completed",
      createSpeechConfig() {
        return {};
      },
      createSynthesizer() {
        return {
          speakTextAsync(_text, onComplete) {
            complete = onComplete;
          },
          close() {
            calls.push(["close"]);
          },
        };
      },
    };
    const provider = createAzureSpeechProvider({
      configuration: { engine: "azure", model: "azure/speech", voice: "en-US-JennyNeural" },
      credentials: { subscriptionKey: "direct-key", region: "eastus" },
      sdkFactory,
      timeoutMs: 1_000,
    });
    const controller = new AbortController();
    const pending = provider.synthesize("Cancel Azure.", { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    await assert.rejects(
      pending,
      (error) => error instanceof SpeechProviderError && error.code === "speech_cancelled",
    );
    complete?.({ reason: "completed", audioData: fixtureWav });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.filter(([kind]) => kind === "close").length, 1);
  });

  await test("allows the native Azure WebSocket close callback to settle", async () => {
    let closeCompleted = false;
    const sdkFactory = {
      completedReason: "completed",
      createSpeechConfig() {
        return {};
      },
      createSynthesizer() {
        return {
          speakTextAsync(_text, onComplete) {
            queueMicrotask(() => onComplete({ reason: "completed", audioData: fixtureWav }));
          },
          close(onComplete) {
            setTimeout(() => {
              closeCompleted = true;
              onComplete();
            }, 550);
          },
        };
      },
    };
    const provider = createAzureSpeechProvider({
      configuration: { engine: "azure", model: "azure/speech", voice: "en-US-JennyNeural" },
      credentials: { subscriptionKey: "direct-key", region: "eastus" },
      sdkFactory,
    });
    const result = await provider.synthesize("Delayed close fixture.");
    assert.equal(result.mimeType, "audio/wav");
    assert.equal(closeCompleted, true);
  });

  await test("rejects Azure success when close reports a failure", async () => {
    const sdkFactory = {
      completedReason: "completed",
      createSpeechConfig() {
        return {};
      },
      createSynthesizer() {
        return {
          speakTextAsync(_text, onComplete) {
            queueMicrotask(() => onComplete({ reason: "completed", audioData: fixtureWav }));
          },
          close(_onComplete, onError) {
            queueMicrotask(() => onError("fixture close failure"));
          },
        };
      },
    };
    const provider = createAzureSpeechProvider({
      configuration: { engine: "azure", model: "azure/speech", voice: "en-US-JennyNeural" },
      credentials: { subscriptionKey: "direct-key", region: "eastus" },
      sdkFactory,
    });
    await assert.rejects(
      provider.synthesize("Rejected close fixture."),
      (error) => error instanceof SpeechProviderError && error.code === "speech_failed",
    );
  });

  await test("waits for Azure close before reporting cancellation", async () => {
    const controller = new AbortController();
    let closeCompleted = false;
    const sdkFactory = {
      completedReason: "completed",
      createSpeechConfig() {
        return {};
      },
      createSynthesizer() {
        return {
          speakTextAsync(_text, onComplete) {
            queueMicrotask(() => onComplete({ reason: "completed", audioData: fixtureWav }));
          },
          close(onComplete) {
            controller.abort();
            setTimeout(() => {
              closeCompleted = true;
              onComplete();
            }, 20);
          },
        };
      },
    };
    const provider = createAzureSpeechProvider({
      configuration: { engine: "azure", model: "azure/speech", voice: "en-US-JennyNeural" },
      credentials: { subscriptionKey: "direct-key", region: "eastus" },
      sdkFactory,
    });
    await assert.rejects(
      provider.synthesize("Cancel during close fixture.", { signal: controller.signal }),
      (error) => error instanceof SpeechProviderError && error.code === "speech_cancelled",
    );
    assert.equal(closeCompleted, true);
  });

  await test("bounds Azure close cleanup and never reports success after cleanup failure", async () => {
    const sdkFactory = {
      completedReason: "completed",
      createSpeechConfig() {
        return {};
      },
      createSynthesizer() {
        return {
          speakTextAsync(_text, onComplete) {
            queueMicrotask(() => onComplete({ reason: "completed", audioData: fixtureWav }));
          },
          close() {
            return new Promise(() => {});
          },
        };
      },
    };
    const provider = createAzureSpeechProvider({
      configuration: { engine: "azure", model: "azure/speech", voice: "en-US-JennyNeural" },
      credentials: { subscriptionKey: "direct-key", region: "eastus" },
      sdkFactory,
    });
    const startedAt = Date.now();
    await assert.rejects(
      provider.synthesize("Close cleanup fixture."),
      (error) => error instanceof SpeechProviderError && error.code === "speech_failed",
    );
    assert.ok(Date.now() - startedAt < 6_500);
  });

  await test("rejects missing or legacy Azure credentials without provider calls", () => {
    assert.throws(
      () => createAzureSpeechProvider({
        configuration: { engine: "azure", model: "azure/speech", voice: "en-US-JennyNeural" },
        credentials: { subscriptionKey: "", region: "eastus" },
      }),
      (error) => error instanceof SpeechProviderError && error.code === "speech_failed",
    );
    assert.throws(
      () => createAzureSpeechProvider({
        configuration: { engine: "enjoyai", model: "azure/speech", voice: "en-US-JennyNeural" },
        credentials: { subscriptionKey: "legacy-token", region: "eastus" },
      }),
      (error) => error instanceof SpeechProviderError && error.code === "speech_failed",
    );
  });

  console.info(`check-learning-narration: PASS (${tests.length} deterministic cases; Azure uses the explicit test seam, no paid inference)`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
