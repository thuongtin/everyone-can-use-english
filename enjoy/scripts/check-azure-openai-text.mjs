#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(root, ".tmp-azure-openai-text-"));
const output = path.join(temp, "azure-openai-text.mjs");
const originalFetch = globalThis.fetch;

try {
  await build({
    stdin: {
      contents: `
        export { textCommand } from "./src/commands/text.command.ts";
        export { jsonCommand } from "./src/commands/json.command.ts";
        export { suggestLessonBriefWithAzure } from "./src/lib/learning-brief-suggestion-azure.ts";
        export { resolveAzureLearningModel } from "./src/lib/learning-azure-config.ts";
        export {
          getChatModelRequestPolicy,
          resolveAzureOpenAiBaseUrl,
        } from "./src/lib/chat-model.ts";
        export {
          AI_PROVIDER_CATALOG,
          createDefaultProviderConfigs,
          createGptProviders,
          normalizeProviderConfig,
        } from "./src/lib/ai-providers.ts";
        export { z } from "zod";
      `,
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

  const production = await import(
    `${pathToFileURL(output).href}?test=${Date.now()}`
  );

  assert.equal(
    production.resolveAzureOpenAiBaseUrl(
      "https://resource.openai.azure.com/"
    ),
    "https://resource.openai.azure.com/openai/v1"
  );
  assert.equal(
    production.resolveAzureOpenAiBaseUrl(
      "https://account.services.ai.azure.com"
    ),
    "https://account.services.ai.azure.com/openai/v1"
  );
  assert.equal(
    production.resolveAzureOpenAiBaseUrl(
      "https://gateway.example.com/azure/openai/v1/"
    ),
    "https://gateway.example.com/azure/openai/v1"
  );
  assert.throws(
    () => production.resolveAzureOpenAiBaseUrl("http://resource.openai.azure.com"),
    /HTTPS/
  );
  assert.throws(
    () => production.resolveAzureOpenAiBaseUrl("https://user:secret@gateway.example.com"),
    /credential/
  );

  const policy = production.getChatModelRequestPolicy({
    provider: "azure-openai",
    baseUrl: "https://resource.openai.azure.com",
    modelName: "english-coach-production",
    temperature: 0.7,
  });
  assert.deepEqual(policy, {
    provider: "azure-openai",
    modelName: "english-coach-production",
    protocol: "chat-completions",
    useResponsesApi: false,
    omitSamplingParameters: true,
  });
  assert.throws(
    () =>
      production.getChatModelRequestPolicy({
        provider: "azure-openai",
        modelName: "english-coach-production",
      }),
    /Base URL/
  );

  const defaults = production.createDefaultProviderConfigs();
  assert.equal(defaults["azure-openai"].models, "");
  assert.equal(defaults["azure-openai"].baseUrl, undefined);
  assert.deepEqual(production.AI_PROVIDER_CATALOG["azure-openai"].models, []);

  const saved = production.normalizeProviderConfig("azure-openai", {
    key: "test-key",
    baseUrl: "https://resource.openai.azure.com",
    models: "english-coach-production, lesson-authoring",
  });
  const catalog = production.createGptProviders({ "azure-openai": saved });
  assert.deepEqual(catalog["azure-openai"].models, [
    "english-coach-production",
    "lesson-authoring",
  ]);
  assert.equal(production.resolveAzureLearningModel(saved, {
    name: "azure-openai",
    models: { default: "lesson-authoring" },
  }), "lesson-authoring");
  assert.equal(production.resolveAzureLearningModel(saved, {
    name: "azure-openai",
    models: { default: "removed-deployment" },
  }), "english-coach-production");

  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = input instanceof URL
      ? input.toString()
      : typeof input === "string"
        ? input
        : input.url;
    const headers = new Headers(init.headers);
    const body = JSON.parse(String(init.body));
    requests.push({ url, headers, body });
    const content = JSON.stringify(body).includes("Suggest vocabulary targets")
      ? JSON.stringify({ targets: [{
          term: "order coffee",
          sense: "ask for a coffee",
          definition: "To ask a cafe worker for a coffee.",
          translationVi: "gọi cà phê",
          example: "I order coffee before work.",
        }] })
      : body.response_format ? '{"answer":"ok"}' : "Xin chào";
    return new Response(
      JSON.stringify({
        id: `chatcmpl-${requests.length}`,
        object: "chat.completion",
        created: 1,
        model: body.model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const options = {
    provider: "azure-openai",
    key: "test-key",
    baseUrl: "https://resource.openai.azure.com",
    modelName: "english-coach-production",
    temperature: 0.7,
    frequencyPenalty: 0.5,
    presencePenalty: 0.5,
    numberOfChoices: 3,
    maxTokens: 321,
  };
  assert.equal(await production.textCommand("Hello", options), "Xin chào");
  assert.deepEqual(
    await production.jsonCommand("Return JSON", {
      ...options,
      schema: production.z.object({ answer: production.z.string() }),
    }),
    { answer: "ok" }
  );
  const suggested = await production.suggestLessonBriefWithAzure({
    topic: "",
    keywords: ["order coffee"],
    level: "A2",
    length: "short",
    imageCount: 0,
    audio: false,
  }, options, new AbortController().signal);
  assert.equal(suggested.targets[0].term, "order coffee");
  assert.equal(suggested.targets[0].evidence.status, "unverified");

  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.equal(
      request.url,
      "https://resource.openai.azure.com/openai/v1/chat/completions"
    );
    assert.equal(request.headers.get("api-key"), "test-key");
    assert.equal(request.headers.has("authorization"), false);
    assert.equal(request.body.model, "english-coach-production");
    assert.equal("temperature" in request.body, false);
    assert.equal("top_p" in request.body, false);
    assert.equal("frequency_penalty" in request.body, false);
    assert.equal("presence_penalty" in request.body, false);
    assert.equal("n" in request.body, false);
    assert.equal("max_tokens" in request.body, false);
    assert.equal(request.body.max_completion_tokens, 321);
  }
  assert.deepEqual(requests[1].body.response_format, { type: "json_object" });
  assert.equal("response_format" in requests[2].body, false);

  console.log(
    "Azure OpenAI text check passed: v1 URL, deployment routing, api-key auth, sampling omission, text, JSON, and Learning Studio brief suggestion"
  );
} finally {
  globalThis.fetch = originalFetch;
  await rm(temp, { recursive: true, force: true });
}
