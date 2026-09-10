#!/usr/bin/env node
/* global globalThis */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-vertex-express-"));
const output = path.join(temp, "vertex-express.cjs");

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const sseResponse = (chunks) => {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
};

const vertexPayload = ({
  text = "Xin chào",
  finishReason = "STOP",
  promptFeedback,
  candidates = true,
  usage = true,
} = {}) => ({
  ...(candidates
    ? { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason }] }
    : {}),
  ...(promptFeedback ? { promptFeedback } : {}),
  ...(usage
    ? { usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3, totalTokenCount: 10 } }
    : {}),
  modelVersion: "gemini-fixture-version",
  responseId: "fixture-response-id",
});

try {
  await build({
    stdin: {
      contents: `
        export {
          assertChatModelResponseComplete,
          createChatModel,
          getChatModelRequestPolicy,
          getChatModelText,
        } from "./src/lib/chat-model.ts";
        export { jsonCommand } from "./src/commands/json.command.ts";
        export {
          VertexExpressChatModel,
          resolveVertexExpressBaseUrl,
          validateVertexExpressModelId,
        } from "./src/lib/vertex-express-chat-model.ts";
        export {
          AIMessage,
          HumanMessage,
          SystemMessage,
          ToolMessage,
          coerceMessageLikeToMessage,
        } from "@langchain/core/messages";
        export { z } from "zod";
      `,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: output,
    logLevel: "silent",
  });

  const runtime = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
  const {
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
    coerceMessageLikeToMessage,
    VertexExpressChatModel,
    assertChatModelResponseComplete,
    createChatModel,
    getChatModelRequestPolicy,
    getChatModelText,
    jsonCommand,
    resolveVertexExpressBaseUrl,
    validateVertexExpressModelId,
    z,
  } = runtime;

  const tests = [];
  const test = async (name, callback) => {
    await callback();
    tests.push(name);
  };

  await test("provider policy is explicit and distinct", () => {
    assert.deepEqual(
      getChatModelRequestPolicy({ provider: "vertex-express", modelName: "gemini-2.5-flash" }),
      {
        provider: "vertex-express",
        modelName: "gemini-2.5-flash",
        protocol: "vertex-express",
        useResponsesApi: false,
        omitSamplingParameters: false,
      }
    );
    assert.equal(resolveVertexExpressBaseUrl(), "https://aiplatform.googleapis.com");
    assert.equal(
      resolveVertexExpressBaseUrl("https://aiplatform.googleapis.com/"),
      "https://aiplatform.googleapis.com"
    );
    assert.equal(
      resolveVertexExpressBaseUrl("https://aiplatform.googleapis.com/v1"),
      "https://aiplatform.googleapis.com"
    );
    const catalogModel = createChatModel({
      provider: "vertex-express",
      key: "fixture-catalog-key",
      baseUrl: "https://aiplatform.googleapis.com/v1",
      modelName: "gemini-2.5-flash",
    });
    assert.equal(catalogModel._llmType(), "vertex-express");
    assert.equal(catalogModel.model, "gemini-2.5-flash");
  });

  await test("configuration rejects unsafe values before fetch", () => {
    let fetchCount = 0;
    const fetch = async () => {
      fetchCount += 1;
      return jsonResponse(vertexPayload());
    };
    for (const model of ["", "../model", "gemini-", "publishers/google/models/gemini", "gemini?key=x", "gemini:generateContent", "gemini%2Fother", " model "] ) {
      assert.throws(
        () => new VertexExpressChatModel({ apiKey: "fixture-key", model, fetch }),
        /model ID không hợp lệ/
      );
    }
    for (const baseUrl of [
      "http://aiplatform.googleapis.com",
      "https://evil.example",
      "https://aiplatform.googleapis.com/v2",
      "https://aiplatform.googleapis.com?key=leak",
      "https://user:pass@aiplatform.googleapis.com",
    ]) {
      assert.throws(
        () => new VertexExpressChatModel({ apiKey: "fixture-key", model: "gemini-safe", baseUrl, fetch }),
        /Base URL|endpoint/
      );
    }
    assert.throws(
      () => new VertexExpressChatModel({ apiKey: " ", model: "gemini-safe", fetch }),
      /API key/
    );
    assert.equal(fetchCount, 0);
    assert.equal(validateVertexExpressModelId("gemini-2.5-flash"), "gemini-2.5-flash");
  });

  await test("pre-abort rejects before fetch", async () => {
    let fetchCount = 0;
    const controller = new AbortController();
    controller.abort();
    const model = new VertexExpressChatModel({
      apiKey: "fixture-key",
      model: "gemini-safe",
      fetch: async () => {
        fetchCount += 1;
        return jsonResponse(vertexPayload());
      },
    });
    await assert.rejects(model.invoke("hello", { signal: controller.signal }), { name: "AbortError" });
    assert.equal(fetchCount, 0);
  });

  await test("native text request preserves roles, parts, config, and secret placement", async () => {
    const captures = [];
    const model = new VertexExpressChatModel({
      apiKey: "fixture-secret-key",
      model: "gemini-2.5-flash",
      temperature: 0.25,
      maxTokens: 123,
      frequencyPenalty: 0.1,
      presencePenalty: 0.2,
      fetch: async (input, init) => {
        captures.push({ url: String(input), init, body: JSON.parse(init.body) });
        return jsonResponse(vertexPayload());
      },
    });
    const response = await model.invoke([
      new SystemMessage({ content: [{ type: "text", text: "System one" }, { type: "text", text: "System two" }] }),
      coerceMessageLikeToMessage(["developer", "Developer rule"]),
      new HumanMessage({ content: [{ type: "text", text: "User A" }, { type: "text", text: "User B" }] }),
      new AIMessage("Prior answer"),
      new HumanMessage("Latest question"),
    ]);
    assert.equal(captures.length, 1);
    const capture = captures[0];
    assert.equal(
      capture.url,
      "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent"
    );
    assert.equal(capture.init.redirect, "manual", "guarded fetch must own redirects");
    assert.equal(new Headers(capture.init.headers).get("x-goog-api-key"), "fixture-secret-key");
    assert.equal(new URL(capture.url).search, "");
    assert.equal(new Headers(capture.init.headers).has("authorization"), false);
    assert.deepEqual(capture.body.systemInstruction, {
      parts: [{ text: "System one" }, { text: "System two" }, { text: "Developer rule" }],
    });
    assert.deepEqual(capture.body.contents, [
      { role: "user", parts: [{ text: "User A" }, { text: "User B" }] },
      { role: "model", parts: [{ text: "Prior answer" }] },
      { role: "user", parts: [{ text: "Latest question" }] },
    ]);
    assert.deepEqual(capture.body.generationConfig, {
      temperature: 0.25,
      maxOutputTokens: 123,
      frequencyPenalty: 0.1,
      presencePenalty: 0.2,
    });
    assert.equal(getChatModelText(response), "Xin chào");
    assert.deepEqual(response.usage_metadata, {
      input_tokens: 7,
      output_tokens: 3,
      total_tokens: 10,
    });
    assert.equal(response.response_metadata.finish_reason, "STOP");
    assert.equal(response.response_metadata.status, "completed");
    assertChatModelResponseComplete(response);
  });

  await test("native JSON schema remains optional and Zod is final validation", async () => {
    const captures = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      captures.push({ url: String(input), headers: new Headers(init.headers), body: JSON.parse(init.body) });
      return jsonResponse(vertexPayload({ text: '{"word":"xin chào"}' }));
    };
    try {
      const schema = z.object({ word: z.string(), phonetic: z.string().optional() });
      const result = await jsonCommand("Return a word", {
        provider: "vertex-express",
        key: "fixture-json-key",
        modelName: "gemini-json",
        schema,
      });
      assert.deepEqual(result, { word: "xin chào" });
      assert.equal(captures.length, 1);
      assert.equal(captures[0].body.generationConfig.responseMimeType, "application/json");
      assert.equal(captures[0].body.generationConfig.responseJsonSchema.type, "object");
      assert.deepEqual(captures[0].body.generationConfig.responseJsonSchema.required, ["word"]);
      assert.equal("$schema" in captures[0].body.generationConfig.responseJsonSchema, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await test("unsupported multimodal and tool inputs never reach fetch", async () => {
    let fetchCount = 0;
    const model = new VertexExpressChatModel({
      apiKey: "fixture-key",
      model: "gemini-safe",
      fetch: async () => {
        fetchCount += 1;
        return jsonResponse(vertexPayload());
      },
    });
    await assert.rejects(
      model.invoke([new HumanMessage({ content: [{ type: "image_url", image_url: "https://example.invalid/a.png" }] })]),
      (error) => error?.code === "vertex_express_unsupported_content"
    );
    await assert.rejects(
      model.invoke([new ToolMessage({ content: "tool result", tool_call_id: "call-1" })]),
      (error) => error?.code === "vertex_express_unsupported_message_role"
    );
    await assert.rejects(
      model.invoke("hello", { tool_choice: "auto" }),
      (error) => error?.code === "vertex_express_unsupported_tools"
    );
    await assert.rejects(
      model.invoke("hello", { responseMimeType: "image/png" }),
      (error) => error?.code === "vertex_express_unsupported_response_mime_type"
    );
    assert.equal(fetchCount, 0);
  });

  await test("completion boundaries expose MAX_TOKENS, refusal, and empty", async () => {
    const fixtures = [
      [vertexPayload({ text: "partial", finishReason: "MAX_TOKENS" }), /status:incomplete/],
      [vertexPayload({ text: "partial", finishReason: "NEW_BLOCK_REASON" }), /status:incomplete/],
      [vertexPayload({ candidates: false, promptFeedback: { blockReason: "SAFETY", blockReasonMessage: "raw refusal text" } }), /status:incomplete/],
      [vertexPayload({ text: "", finishReason: "STOP" }), /status:incomplete/],
    ];
    for (const [payload, issue] of fixtures) {
      const model = new VertexExpressChatModel({
        apiKey: "fixture-key",
        model: "gemini-safe",
        fetch: async () => jsonResponse(payload),
      });
      const response = await model.invoke("hello");
      assert.throws(() => assertChatModelResponseComplete(response), issue);
    }
  });

  await test("HTTP and malformed-response errors are sanitized", async () => {
    const secretBody = "SECRET_RAW_PROVIDER_BODY";
    for (const [response, expected] of [
      [jsonResponse({ error: { status: "PERMISSION_DENIED", message: secretBody } }, 403), /HTTP 403 PERMISSION_DENIED/],
      [jsonResponse({ error: { status: "UNRECOGNIZED", message: secretBody } }, 500), /HTTP 500\)$/],
      [new Response(secretBody, { status: 200 }), /JSON không hợp lệ/],
    ]) {
      const model = new VertexExpressChatModel({
        apiKey: "fixture-key",
        model: "gemini-safe",
        fetch: async () => response,
      });
      await assert.rejects(model.invoke("hello"), (error) => {
        assert.match(error.message, expected);
        assert.doesNotMatch(error.message, /SECRET_RAW_PROVIDER_BODY|fixture-key/);
        return true;
      });
    }
  });

  await test("redirects are rejected without replaying the key", async () => {
    const captures = [];
    const model = new VertexExpressChatModel({
      apiKey: "fixture-key",
      model: "gemini-safe",
      fetch: async (input, init) => {
        captures.push({ input: String(input), key: new Headers(init.headers).get("x-goog-api-key") });
        return new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } });
      },
    });
    await assert.rejects(model.invoke("hello"), /network_error/);
    assert.deepEqual(captures, [{
      input: "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-safe:generateContent",
      key: "fixture-key",
    }]);
  });

  await test("in-flight abort rejects even when fixture fetch stays pending", async () => {
    let capturedSignal;
    const model = new VertexExpressChatModel({
      apiKey: "fixture-key",
      model: "gemini-safe",
      fetch: async (_input, init) => {
        capturedSignal = init.signal;
        return new Promise(() => undefined);
      },
    });
    const controller = new AbortController();
    const pending = model.invoke("wait", { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.notEqual(capturedSignal, controller.signal);
    assert.equal(capturedSignal.aborted, true);
  });

  await test("split SSE chunks stream text, finish metadata, and usage", async () => {
    const events = [
      `data: ${JSON.stringify(vertexPayload({ text: "Xin ", finishReason: null, usage: false }))}\n\n`,
      `data: ${JSON.stringify(vertexPayload({ text: "chào", finishReason: "STOP" }))}\n\n`,
    ].join("");
    const cuts = [events.slice(0, 5), events.slice(5, 31), events.slice(31, 79), events.slice(79)];
    let request;
    const model = new VertexExpressChatModel({
      apiKey: "fixture-key",
      model: "gemini-stream",
      fetch: async (input, init) => {
        request = { input: String(input), init };
        return sseResponse(cuts);
      },
    });
    const chunks = [];
    const callbackTokens = [];
    for await (const chunk of await model.stream("hello", {
      callbacks: [{ handleLLMNewToken: (token) => callbackTokens.push(token) }],
    })) {
      chunks.push(chunk);
    }
    assert.equal(chunks.map((chunk) => chunk.content).join(""), "Xin chào");
    assert.equal(callbackTokens.join(""), "Xin chào");
    assert.equal(
      request.input,
      "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-stream:streamGenerateContent?alt=sse"
    );
    assert.equal(request.init.redirect, "manual");
    assert.equal(chunks.at(-1).response_metadata.finish_reason, "STOP");
    assert.equal(chunks.at(-1).response_metadata.status, "completed");
    assert.deepEqual(chunks.at(-1).usage_metadata, {
      input_tokens: 7,
      output_tokens: 3,
      total_tokens: 10,
    });
  });

  await test("abort after a partial stream never becomes success", async () => {
    const encoder = new TextEncoder();
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(vertexPayload({ text: "partial", finishReason: null, usage: false }))}\n\n`));
      },
      cancel() {},
    }), { headers: { "content-type": "text/event-stream" } });
    const model = new VertexExpressChatModel({
      apiKey: "fixture-key",
      model: "gemini-stream",
      fetch: async () => response,
    });
    const controller = new AbortController();
    const seen = [];
    await assert.rejects(async () => {
      for await (const chunk of await model.stream("hello", { signal: controller.signal })) {
        seen.push(chunk.content);
        if (seen.join("") === "partial") controller.abort();
      }
    }, { name: "AbortError" });
    assert.equal(seen.join(""), "partial");
  });

  await test("early iterator return cancels the SSE body and internal request", async () => {
    const encoder = new TextEncoder();
    let cancelCount = 0;
    let requestSignal;
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(vertexPayload({ text: "first", finishReason: null, usage: false }))}\n\n`));
      },
      cancel() {
        cancelCount += 1;
      },
    }), { headers: { "content-type": "text/event-stream" } });
    const model = new VertexExpressChatModel({
      apiKey: "fixture-key",
      model: "gemini-stream",
      fetch: async (_input, init) => {
        requestSignal = init.signal;
        return response;
      },
    });
    const externalController = new AbortController();
    const activeAbortListeners = new Set();
    const externalSignal = externalController.signal;
    const addEventListener = externalSignal.addEventListener.bind(externalSignal);
    const removeEventListener = externalSignal.removeEventListener.bind(externalSignal);
    Object.defineProperties(externalSignal, {
      addEventListener: {
        value(type, listener, options) {
          if (type === "abort") activeAbortListeners.add(listener);
          return addEventListener(type, listener, options);
        },
      },
      removeEventListener: {
        value(type, listener, options) {
          if (type === "abort") activeAbortListeners.delete(listener);
          return removeEventListener(type, listener, options);
        },
      },
    });
    const stream = await model.stream("hello", { signal: externalController.signal });
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    assert.equal(first.value.content, "first");
    assert.equal(requestSignal.aborted, false);
    await iterator.return();
    assert.equal(cancelCount, 1);
    assert.equal(requestSignal.aborted, true);
    assert.equal(externalController.signal.aborted, false);
    assert.equal(activeAbortListeners.size, 0);
  });

  await test("existing Gemini provider stays on direct OpenAI-compatible request", async () => {
    const captures = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      captures.push({ url: String(input), body: JSON.parse(init.body) });
      return jsonResponse({
        id: "fixture",
        object: "chat.completion",
        model: "gemini-fixture",
        choices: [{ index: 0, message: { role: "assistant", content: "existing" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    };
    try {
      const response = await createChatModel({
        provider: "gemini",
        key: "fixture-gemini-key",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        modelName: "gemini-3.8-flash",
      }).invoke("hello");
      assert.equal(getChatModelText(response), "existing");
      assert.equal(
        captures[0].url,
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
      );
      assert.equal(captures[0].body.model, "gemini-3.8-flash");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  console.info(`check-vertex-express-chat-model: PASS (${tests.length} contract groups)`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
