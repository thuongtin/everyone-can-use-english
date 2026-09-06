import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { ConversationChain } from "langchain/chains";
import { BufferMemory, ChatMessageHistory } from "langchain/memory";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { z } from "zod";

const root = path.resolve(import.meta.dirname, "..");
await mkdir(path.join(root, "tmp"), { recursive: true });
const temp = await mkdtemp(path.join(root, "tmp", "ai-runtime-"));
const originalFetch = globalThis.fetch;

const jsonResponse = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const streamResponse = (chunks, contentType) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": contentType },
  });
};

const getRequestUrl = (input) => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
};

const getRequestHeaders = (input, init) => {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
  return Object.fromEntries(headers.entries());
};

const readRequestBody = async (input, init) => {
  const body = init?.body ?? (input instanceof Request ? input.body : undefined);
  if (!body) return {};
  if (typeof body === "string") return JSON.parse(body);
  return JSON.parse(await new Response(body).text());
};

const makeChatPayload = (body, mode) => {
  let content = "fixture text";
  let finishReason = "stop";
  let refusal;

  if (mode === "json") content = '{"value":"fixture"}';
  if (mode === "lookup") content = '{"word":"fixture"}';
  if (mode === "malformed") content = "not-json";
  if (mode === "invalid-schema") content = '{"other":"fixture"}';
  if (mode === "incomplete-json") {
    content = '{"value":"partial"}';
    finishReason = "length";
  }
  if (mode === "incomplete-text") {
    content = "partial fixture";
    finishReason = "length";
  }
  if (mode === "incomplete") {
    content = null;
    refusal = "fixture refusal";
    finishReason = "length";
  }
  if (mode === "refusal-empty") {
    content = null;
    refusal = "fixture refusal";
    finishReason = "stop";
  }
  if (mode === "empty-completed") {
    content = "";
    finishReason = "stop";
  }
  if (mode === "empty") content = "";

  return {
    id: "chatcmpl-fixture",
    object: "chat.completion",
    model: body.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content, refusal },
        finish_reason: finishReason,
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  };
};

const makeResponsesPayload = (body, mode) => {
  let text = "fixture text";
  let status = "completed";
  let incompleteDetails;
  let content;

  if (mode === "json") text = '{"value":"fixture"}';
  if (mode === "lookup") text = '{"word":"fixture"}';
  if (mode === "malformed") text = "not-json";
  if (mode === "invalid-schema") text = '{"other":"fixture"}';
  if (mode === "group") text = "ChatAgent: fixture reply";
  if (mode === "incomplete-json") {
    text = '{"value":"partial"}';
    status = "incomplete";
    incompleteDetails = { reason: "max_output_tokens" };
  }
  if (mode === "incomplete-text") {
    text = "partial fixture";
    status = "incomplete";
    incompleteDetails = { reason: "max_output_tokens" };
  }
  if (mode === "incomplete" || mode === "empty") text = "";
  if (mode === "refusal-with-text") {
    text = '{"value":"partial"}';
    content = [
      { type: "output_text", text },
      { type: "refusal", refusal: "fixture refusal" },
    ];
  }

  return {
    id: "resp-fixture",
    object: "response",
    model: body.model,
    status,
    incomplete_details: incompleteDetails,
    output: [
      {
        type: "message",
        id: "msg-fixture",
        status: "completed",
        role: "assistant",
        content: content || [{ type: "output_text", text }],
      },
    ],
    output_text: text,
    usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
  };
};

const makeOllamaPayload = (body, mode) => {
  let content = "ollama fixture";
  if (mode === "ollama-json") content = '{"value":"ollama fixture"}';
  if (mode === "ollama-malformed") content = "not-json";
  return [
    JSON.stringify({
      model: body.model,
      created_at: "2026-09-06T00:00:00Z",
      message: { role: "assistant", content },
      done: false,
    }) + "\n",
    JSON.stringify({
      model: body.model,
      created_at: "2026-09-06T00:00:00Z",
      message: { role: "assistant", content: "" },
      done: true,
      prompt_eval_count: 1,
      eval_count: 2,
    }) + "\n",
  ];
};

try {
  const output = path.join(temp, "ai-runtime.mjs");
  await build({
    stdin: {
      contents: `export {
  assertChatModelResponseComplete,
  createChatModel,
  getChatModelContent,
  getChatModelRequestPolicy,
  getChatModelText,
  isOfficialOpenAIEndpoint,
} from "./src/lib/chat-model.ts";
export { jsonCommand } from "./src/commands/json.command.ts";
export { lookupCommand } from "./src/commands/lookup.command.ts";
export { textCommand } from "./src/commands/text.command.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    alias: { "@": path.join(root, "src") },
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });

  const captures = [];
  let mode = "text";

  globalThis.fetch = async (input, init = {}) => {
    const url = getRequestUrl(input);
    const body = await readRequestBody(input, init);
    const headers = getRequestHeaders(input, init);
    captures.push({ url, body, headers });

    if (mode === "error") {
      return jsonResponse({ error: { message: "fixture failure" } }, 500);
    }

    if (url.endsWith("/api/chat")) {
      return streamResponse(
        makeOllamaPayload(body, mode),
        "application/x-ndjson"
      );
    }

    if (mode === "stream") {
      const firstChunk = {
        id: "chatcmpl-stream-fixture",
        object: "chat.completion.chunk",
        model: body.model,
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "stream fixture" },
            finish_reason: null,
          },
        ],
      };
      const finalChunk = {
        id: "chatcmpl-stream-fixture",
        object: "chat.completion.chunk",
        model: body.model,
        choices: [
          { index: 0, delta: {}, finish_reason: "stop" },
        ],
      };
      return streamResponse(
        [`data: ${JSON.stringify(firstChunk)}\n\n`, `data: ${JSON.stringify(finalChunk)}\n\n`, "data: [DONE]\n\n"],
        "text/event-stream"
      );
    }

    if (url.endsWith("/responses")) {
      return jsonResponse(makeResponsesPayload(body, mode));
    }

    return jsonResponse(makeChatPayload(body, mode));
  };

  // OpenAI 4.x captures its default fetch implementation when the module is
  // imported, so install the fixture transport before importing the bundle.
  const {
    assertChatModelResponseComplete,
    createChatModel,
    getChatModelRequestPolicy,
    getChatModelText,
    isOfficialOpenAIEndpoint,
    jsonCommand,
    lookupCommand,
    textCommand,
  } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

  const tests = [];
  const test = async (name, callback) => {
    await callback();
    tests.push(name);
  };
  const schema = z.object({ value: z.string() });

  const invokeConversationText = async (nextMode) => {
    mode = nextMode;
    captures.length = 0;
    const chain = new ConversationChain({
      llm: createChatModel({
        provider: "openai",
        key: "fake-conversation-key",
        baseUrl: "https://proxy.example/v1",
        modelName: "gpt-4o",
      }),
      memory: new BufferMemory({
        chatHistory: new ChatMessageHistory(),
        memoryKey: "history",
        returnMessages: true,
      }),
      prompt: ChatPromptTemplate.fromMessages([
        ["system", "You are a fixture assistant."],
        new MessagesPlaceholder("history"),
        ["human", "{input}"],
      ]),
      verbose: false,
    });
    let generations = [];
    await chain.call(
      { input: "hello" },
      [{ handleLLMEnd: async (output) => { generations = output.generations[0] || []; } }]
    );
    for (const generation of generations) {
      assertChatModelResponseComplete(generation);
    }
    const text = getChatModelText(generations[0]?.message ?? generations[0]).trim();
    if (!text) throw new Error("AI returned an empty response");
    return text;
  };

  await test("endpoint and provider policy", () => {
    assert.equal(isOfficialOpenAIEndpoint("https://api.openai.com/v1"), true);
    assert.equal(isOfficialOpenAIEndpoint("https://proxy.example/v1"), false);
    assert.deepEqual(
      getChatModelRequestPolicy({
        provider: "openai",
        modelName: "gpt-5.6-luna",
        baseUrl: "https://api.openai.com/v1",
      }),
      {
        provider: "openai",
        modelName: "gpt-5.6-luna",
        protocol: "responses",
        useResponsesApi: true,
        reasoningEffort: "low",
        omitSamplingParameters: true,
      }
    );
    assert.throws(
      () => getChatModelRequestPolicy({ provider: "unknown-provider" }),
      /Unsupported AI provider: unknown-provider/
    );
  });

  await test("EnjoyAI requires a resolved endpoint before fetch", () => {
    mode = "text";
    captures.length = 0;
    assert.throws(
      () =>
        createChatModel({
          provider: "enjoyai",
          key: "fake-enjoy-token",
          modelName: "gpt-4o",
        }),
      /EnjoyAI endpoint is required/
    );
    assert.equal(captures.length, 0);
  });

  await test("EnjoyAI uses the resolved canonical endpoint", async () => {
    mode = "text";
    captures.length = 0;
    await createChatModel({
      provider: "enjoyai",
      key: "fake-enjoy-token",
      baseUrl: "https://enjoy.example/api/ai",
      modelName: "gpt-4o",
    }).invoke("hello");
    assert.equal(captures[0].url, "https://enjoy.example/api/ai/chat/completions");
    assert.equal(captures[0].headers.authorization, "Bearer fake-enjoy-token");
  });

  await test("explicit Ollama requires a selected model before fetch", () => {
    mode = "text";
    captures.length = 0;
    assert.throws(
      () =>
        createChatModel({
          provider: "ollama",
          baseUrl: "http://127.0.0.1:11434",
        }),
      /ollama model is required/
    );
    assert.equal(captures.length, 0);
  });

  await test("explicit LM Studio requires a selected model before fetch", () => {
    mode = "text";
    captures.length = 0;
    assert.throws(
      () =>
        createChatModel({
          provider: "lmstudio",
          baseUrl: "http://127.0.0.1:1234/v1",
          modelName: " ",
        }),
      /lmstudio model is required/
    );
    assert.equal(captures.length, 0);
  });

  await test("official OpenAI Responses request", async () => {
    mode = "text";
    captures.length = 0;
    const model = createChatModel({
      provider: "openai",
      key: "fake-openai-key",
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5.6-luna",
      temperature: 0.2,
      maxTokens: 321,
      frequencyPenalty: 0.4,
      presencePenalty: 0.5,
      numberOfChoices: 8,
    });
    const response = await model.invoke("hello");
    assert.equal(getChatModelText(response), "fixture text");
    assert.equal(captures.length, 1);
    const request = captures[0];
    assert.equal(request.url, "https://api.openai.com/v1/responses");
    assert.equal(request.headers.authorization, "Bearer fake-openai-key");
    assert.equal(request.body.model, "gpt-5.6-luna");
    assert.equal(request.body.store, false);
    assert.deepEqual(request.body.reasoning, { effort: "low" });
    assert.equal(request.body.max_output_tokens, 321);
    assert.equal("temperature" in request.body, false);
    assert.equal("top_p" in request.body, false);
    assert.equal("frequency_penalty" in request.body, false);
    assert.equal("presence_penalty" in request.body, false);
    assert.equal("n" in request.body, false);
  });

  await test("Responses content blocks normalize for group replies", async () => {
    mode = "group";
    captures.length = 0;
    const response = await createChatModel({
      provider: "openai",
      key: "fake-group-key",
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5.6-luna",
    }).invoke("hello");
    const content = getChatModelText(response)
      .replace(/^ChatAgent:/, "")
      .trim();
    assert.equal(content, "fixture reply");
    assert.equal(captures[0].url, "https://api.openai.com/v1/responses");
  });

  await test("ConversationChain rejects a nonempty incomplete Responses reply", async () => {
    mode = "incomplete-text";
    captures.length = 0;
    const chain = new ConversationChain({
      llm: createChatModel({
        provider: "openai",
        key: "fake-conversation-key",
        baseUrl: "https://api.openai.com/v1",
        modelName: "gpt-5.6-luna",
      }),
      memory: new BufferMemory({
        chatHistory: new ChatMessageHistory(),
        memoryKey: "history",
        returnMessages: true,
      }),
      prompt: ChatPromptTemplate.fromMessages([
        ["system", "You are a fixture assistant."],
        new MessagesPlaceholder("history"),
        ["human", "{input}"],
      ]),
      verbose: false,
    });
    let generations = [];
    await assert.rejects(
      async () => {
        await chain.call(
          { input: "hello" },
          [{ handleLLMEnd: async (output) => { generations = output.generations[0] || []; } }]
        );
        for (const generation of generations) {
          assertChatModelResponseComplete(generation);
        }
      },
      /status:incomplete/
    );
    assert.equal(getChatModelText(generations[0]), "partial fixture");
  });

  await test("ConversationChain rejects Chat refusal with null content", async () => {
    await assert.rejects(
      () => invokeConversationText("refusal-empty"),
      /empty response/
    );
    assert.equal(captures[0].url, "https://proxy.example/v1/chat/completions");
  });

  await test("ConversationChain rejects an empty completed Chat response", async () => {
    await assert.rejects(
      () => invokeConversationText("empty-completed"),
      /empty response/
    );
    assert.equal(captures[0].url, "https://proxy.example/v1/chat/completions");
  });

  await test("OpenAI custom proxy stays on Chat Completions", async () => {
    mode = "text";
    captures.length = 0;
    await createChatModel({
      provider: "openai",
      key: "fake-proxy-key",
      baseUrl: "https://proxy.example/v1",
      modelName: "gpt-5.6-terra",
      temperature: 0.2,
      maxTokens: 123,
      numberOfChoices: 9,
    }).invoke("hello");
    const request = captures[0];
    assert.equal(request.url, "https://proxy.example/v1/chat/completions");
    assert.equal(request.headers.authorization, "Bearer fake-proxy-key");
    assert.equal(request.body.model, "gpt-5.6-terra");
    assert.equal(request.body.max_tokens, 123);
    assert.equal("temperature" in request.body, false);
    assert.equal("frequency_penalty" in request.body, false);
    assert.equal("presence_penalty" in request.body, false);
    assert.equal("n" in request.body, false);
    assert.equal("store" in request.body, false);
  });

  await test("Gemini, DeepSeek, and OpenRouter request policies", async () => {
    mode = "text";
    captures.length = 0;
    await createChatModel({
      provider: "gemini",
      key: "fake-gemini-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      modelName: "gemini-3.8-flash",
      temperature: 0.2,
      numberOfChoices: 4,
    }).invoke("hello");
    let request = captures.at(-1);
    assert.equal(request.body.model, "gemini-3.8-flash");
    assert.equal(request.body.reasoning_effort, "low");
    assert.equal(request.body.n, undefined);

    await createChatModel({
      provider: "deepseek",
      key: "fake-deepseek-key",
      baseUrl: "https://api.deepseek.com",
      modelName: "deepseek-v4-thinking",
    }).invoke("hello");
    request = captures.at(-1);
    assert.equal(request.body.model, "deepseek-v4-thinking");
    assert.equal("reasoning_effort" in request.body, false);

    await createChatModel({
      provider: "openrouter",
      key: "fake-openrouter-key",
      baseUrl: "https://openrouter.ai/api/v1",
      modelName: "anthropic/claude-sonnet-5",
      temperature: 0.2,
      frequencyPenalty: 0.3,
      presencePenalty: 0.4,
      numberOfChoices: 7,
    }).invoke("hello");
    request = captures.at(-1);
    assert.equal(request.body.model, "anthropic/claude-sonnet-5");
    assert.equal("temperature" in request.body, false);
    assert.equal("frequency_penalty" in request.body, false);
    assert.equal("presence_penalty" in request.body, false);
    assert.equal("n" in request.body, false);
  });

  await test("keyless LM Studio and native Ollama", async () => {
    mode = "text";
    captures.length = 0;
    await createChatModel({
      provider: "lmstudio",
      baseUrl: "http://127.0.0.1:1234/v1",
      modelName: "local-model",
    }).invoke("hello");
    let request = captures.at(-1);
    assert.equal(request.url, "http://127.0.0.1:1234/v1/chat/completions");
    assert.equal("authorization" in request.headers, false);
    assert.equal(request.body.model, "local-model");

    await createChatModel({
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      modelName: "local-llama",
      maxTokens: 32,
    }).invoke("hello");
    request = captures.at(-1);
    assert.equal(request.url, "http://127.0.0.1:11434/api/chat");
    assert.equal(request.body.model, "local-llama");
    assert.equal(request.body.stream, true);
    assert.equal(request.body.options.num_predict, 32);
    assert.equal("authorization" in request.headers, false);
  });

  await test("text command and system prompt", async () => {
    mode = "text";
    captures.length = 0;
    const result = await textCommand("hello", {
      provider: "openai",
      key: "fake-text-key",
      baseUrl: "https://proxy.example/v1",
      modelName: "gpt-4o",
      systemPrompt: "You are a fixture assistant.",
    });
    assert.equal(result, "fixture text");
    assert.equal(captures[0].body.messages[0].role, "system");
    assert.equal(
      captures[0].body.messages[0].content,
      "You are a fixture assistant."
    );
    assert.equal(captures[0].body.temperature, 0);
  });

  await test("JSON command validates schema on Responses", async () => {
    mode = "json";
    captures.length = 0;
    const result = await jsonCommand("Return the fixture object", {
      provider: "openai",
      key: "fake-json-key",
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5.6-luna",
      schema,
    });
    assert.deepEqual(result, { value: "fixture" });
    assert.equal(captures[0].url, "https://api.openai.com/v1/responses");
    assert.equal(captures[0].body.text.format.type, "json_object");
    assert.equal("schema" in captures[0].body.text.format, false);
  });

  await test("JSON command keeps the sampling default on compatible models", async () => {
    mode = "json";
    captures.length = 0;
    const result = await jsonCommand("Return the fixture object", {
      provider: "openai",
      key: "fake-json-proxy-key",
      baseUrl: "https://proxy.example/v1",
      modelName: "gpt-4o",
      schema,
    });
    assert.deepEqual(result, { value: "fixture" });
    assert.equal(captures[0].body.temperature, 0);
  });

  await test("lookup optional schema uses JSON mode and keeps partial data", async () => {
    mode = "lookup";
    captures.length = 0;
    const result = await lookupCommand(
      { word: "fixture", context: "fixture context" },
      {
        provider: "openai",
        key: "fake-lookup-key",
        baseUrl: "https://api.openai.com/v1",
        modelName: "gpt-5.6-luna",
      }
    );
    assert.equal(result.word, "fixture");
    assert.equal(captures[0].body.text.format.type, "json_object");
    assert.equal("schema" in captures[0].body.text.format, false);
  });

  await test("JSON command rejects malformed, incomplete, invalid, and transport errors", async () => {
    mode = "malformed";
    await assert.rejects(
      () =>
        jsonCommand("Return JSON", {
          provider: "openai",
          key: "fake-json-key",
          baseUrl: "https://proxy.example/v1",
          modelName: "gpt-4o",
          schema,
        }),
      /malformed JSON/
    );

    mode = "incomplete";
    await assert.rejects(
      () =>
        jsonCommand("Return JSON", {
          provider: "openai",
          key: "fake-json-key",
          baseUrl: "https://proxy.example/v1",
          modelName: "gpt-4o",
          schema,
        }),
      /incomplete|refused/
    );

    mode = "incomplete-json";
    captures.length = 0;
    await assert.rejects(
      () =>
        jsonCommand("Return JSON", {
          provider: "openai",
          key: "fake-json-key",
          baseUrl: "https://proxy.example/v1",
          modelName: "gpt-4o",
          schema,
        }),
      /finish_reason:length/
    );
    assert.equal(captures[0].body.temperature, 0);

    mode = "incomplete-json";
    captures.length = 0;
    await assert.rejects(
      () =>
        jsonCommand("Return JSON", {
          provider: "openai",
          key: "fake-json-key",
          baseUrl: "https://api.openai.com/v1",
          modelName: "gpt-5.6-luna",
          schema,
        }),
      /status:incomplete/
    );
    assert.equal(captures[0].url, "https://api.openai.com/v1/responses");

    mode = "incomplete-text";
    captures.length = 0;
    await assert.rejects(
      () =>
      textCommand("Return text", {
          provider: "openai",
          key: "fake-text-key",
          baseUrl: "https://api.openai.com/v1",
          modelName: "gpt-5.6-luna",
        }),
      /status:incomplete/
    );

    mode = "refusal-with-text";
    captures.length = 0;
    await assert.rejects(
      () =>
        jsonCommand("Return JSON", {
          provider: "openai",
          key: "fake-json-key",
          baseUrl: "https://api.openai.com/v1",
          modelName: "gpt-5.6-luna",
          schema,
        }),
      /incomplete or refused \(refusal\)/
    );

    mode = "invalid-schema";
    await assert.rejects(
      () =>
        jsonCommand("Return JSON", {
          provider: "openai",
          key: "fake-json-key",
          baseUrl: "https://proxy.example/v1",
          modelName: "gpt-4o",
          schema,
        }),
      /Required|value/
    );

    mode = "error";
    await assert.rejects(
      () =>
        jsonCommand("Return JSON", {
          provider: "openai",
          key: "fake-json-key",
          baseUrl: "https://proxy.example/v1",
          modelName: "gpt-4o",
          schema,
        }),
      /500|fixture failure/i
    );
  });

  await test("Ollama JSON format and validation", async () => {
    mode = "ollama-json";
    captures.length = 0;
    const result = await jsonCommand("Return JSON", {
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      modelName: "local-llama",
      schema,
    });
    assert.deepEqual(result, { value: "ollama fixture" });
    assert.equal(typeof captures[0].body.format, "object");

    mode = "ollama-malformed";
    await assert.rejects(
      () =>
        jsonCommand("Return JSON", {
          provider: "ollama",
          baseUrl: "http://127.0.0.1:11434",
          modelName: "local-llama",
          schema,
        }),
      /malformed JSON/
    );
  });

  await test("Chat Completions streaming remains compatible", async () => {
    mode = "stream";
    captures.length = 0;
    const model = createChatModel({
      provider: "openai",
      key: "fake-stream-key",
      baseUrl: "https://proxy.example/v1",
      modelName: "gpt-4o",
    });
    const chunks = [];
    for await (const chunk of await model.stream("hello")) {
      if (typeof chunk.content === "string") chunks.push(chunk.content);
    }
    assert.equal(chunks.join(""), "stream fixture");
    assert.equal(captures[0].body.stream, true);
    assert.equal("stream_options" in captures[0].body, false);
  });

  await test("text command rejects an empty response", async () => {
    mode = "empty";
    await assert.rejects(
      () =>
        textCommand("hello", {
          provider: "openai",
          key: "fake-text-key",
          baseUrl: "https://proxy.example/v1",
          modelName: "gpt-4o",
        }),
      /empty response/
    );
  });

  console.info(`check-ai-runtime: PASS (${tests.length} transport and validation cases)`);
} finally {
  globalThis.fetch = originalFetch;
  await rm(temp, { recursive: true, force: true });
}
