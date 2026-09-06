import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-ai-providers-"));

try {
  const output = path.join(temp, "ai-providers.mjs");
  await build({
    stdin: {
      contents: `export {
  AI_PROVIDER_CATALOG,
  createDefaultProviderConfigs,
  createGptProviders,
  discoverLocalModels,
  getEnjoyAiRemoteConfig,
  isLegacyProviderModel,
  normalizeModelList,
  normalizeProviderConfig,
  providerSupportsOption,
  resolveGptEngineBootstrap,
  resolveProviderModel,
  resolveProviderSwitchBaseUrl,
} from "./src/lib/ai-providers.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });

  const {
    AI_PROVIDER_CATALOG,
    createDefaultProviderConfigs,
    createGptProviders,
    discoverLocalModels,
    getEnjoyAiRemoteConfig,
    isLegacyProviderModel,
    normalizeModelList,
    normalizeProviderConfig,
    providerSupportsOption,
    resolveGptEngineBootstrap,
    resolveProviderModel,
    resolveProviderSwitchBaseUrl,
  } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

  assert.deepEqual(normalizeModelList(" gpt-4o, gpt-4o, custom "), [
    "gpt-4o",
    "custom",
  ]);
  assert.deepEqual(normalizeModelList([" a ", "", "a", "b,c"]), [
    "a",
    "b",
    "c",
  ]);

  const defaults = createDefaultProviderConfigs();
  assert.deepEqual(Object.keys(defaults), [
    "enjoyai",
    "openai",
    "gemini",
    "deepseek",
    "openrouter",
    "ollama",
    "lmstudio",
  ]);
  assert.equal(defaults.lmstudio.baseUrl, "http://localhost:1234/v1");

  const savedOpenAi = normalizeProviderConfig("openai", {
    key: "fake-key",
    baseUrl: "https://openai.invalid/v1",
    models: " custom-a, custom-a ",
    transcriptionModel: "whisper-1",
  });
  assert.deepEqual(savedOpenAi, {
    name: "openai",
    key: "fake-key",
    baseUrl: "https://openai.invalid/v1",
    models: "custom-a",
    transcriptionModel: "whisper-1",
  });
  assert.throws(
    () => normalizeProviderConfig("historical-provider", {}),
    /Unsupported AI provider/
  );
  assert.equal(
    normalizeProviderConfig("lmstudio", { key: "fake-lmstudio-token" }).key,
    "fake-lmstudio-token"
  );
  assert.equal(normalizeProviderConfig("ollama", { key: "fake-other-key" }).key, undefined);

  const storedEngine = resolveGptEngineBootstrap(
    { name: "gemini", models: { default: "gemini-3.8-flash" } },
    { key: "fake-openai-key", models: "gpt-5.6-luna" }
  );
  assert.deepEqual(storedEngine, {
    engine: { name: "gemini", models: { default: "gemini-3.8-flash" } },
    shouldPersist: false,
  });
  assert.deepEqual(
    resolveGptEngineBootstrap(undefined, {
      key: "fake-openai-key",
      models: "gpt-5.6-luna, gpt-4o",
    }),
    {
      engine: { name: "openai", models: { default: "gpt-5.6-luna" } },
      shouldPersist: true,
    }
  );
  assert.deepEqual(
    resolveGptEngineBootstrap(undefined, {
      key: "",
      models: "gpt-5.6-luna",
    }),
    {
      engine: { name: "enjoyai", models: { default: "gpt-4o" } },
      shouldPersist: false,
    }
  );

  const remote = getEnjoyAiRemoteConfig({
    enjoyai: {
      models: ["remote-model"],
      configurable: ["model", "temperature", "baseUrl", "key"],
      key: "must-be-ignored",
    },
    openai: { models: ["must-not-be-used"] },
    baseUrl: "https://must-not-be-used.invalid",
  });
  assert.deepEqual(remote, {
    models: ["remote-model"],
    configurable: ["model", "temperature"],
  });

  const providers = createGptProviders(
    {
      ...defaults,
      openai: savedOpenAi,
      ollama: normalizeProviderConfig("ollama", {
        baseUrl: "http://ollama.invalid",
        models: "saved-local",
      }),
    },
    { openai: { models: ["must-not-be-used"] } },
    { ollama: ["discovered-local"] }
  );
  assert.equal(providers.openai.models.includes("custom-a"), true);
  assert.equal(providers.openai.models.includes("must-not-be-used"), false);
  assert.equal(providers.ollama.models.includes("saved-local"), true);
  assert.equal(providers.ollama.models.includes("discovered-local"), true);
  assert.equal(providers.ollama.baseUrl, "http://ollama.invalid");
  assert.deepEqual(createGptProviders(defaults).ollama.models, []);
  assert.deepEqual(createGptProviders(defaults).lmstudio.models, []);
  assert.equal(resolveProviderModel([], "gpt-4o"), undefined);
  assert.equal(resolveProviderModel(["local-model"], "gpt-4o"), "local-model");
  assert.equal(
    resolveProviderModel(["local-model"], "local-model"),
    "local-model"
  );
  assert.equal(
    resolveProviderModel(["local-model"], " local-model "),
    "local-model"
  );
  assert.equal(
    resolveProviderSwitchBaseUrl(
      "openai",
      "gemini",
      "https://openai.invalid/v1"
    ),
    undefined
  );
  assert.equal(
    resolveProviderSwitchBaseUrl(
      "openai",
      "openai",
      " https://openai.invalid/v1 "
    ),
    "https://openai.invalid/v1"
  );
  assert.equal(
    resolveProviderSwitchBaseUrl("openai", "ollama", undefined),
    undefined
  );
  assert.equal(providers.openrouter.models[0], "anthropic/claude-sonnet-5");
  assert.equal(providers.enjoyai.models.includes("chatgpt-4o-latest"), false);
  assert.equal(isLegacyProviderModel("enjoyai", "gpt-4o-mini"), false);
  assert.equal(isLegacyProviderModel("enjoyai", "gpt-4o"), false);
  assert.equal(isLegacyProviderModel("enjoyai", "chatgpt-4o-latest"), true);
  assert.equal(isLegacyProviderModel("openai", "gpt-5.6-luna"), false);

  assert.equal(
    providerSupportsOption("openai", "temperature", "gpt-5.6-luna"),
    false
  );
  assert.equal(
    providerSupportsOption("openai", "temperature", "gpt-4o"),
    true
  );
  assert.equal(
    providerSupportsOption(
      "openrouter",
      "numberOfChoices",
      "anthropic/claude-sonnet-5"
    ),
    false
  );
  assert.equal(providerSupportsOption("lmstudio", "frequencyPenalty"), false);

  const providersWithRemoteSubset = createGptProviders(defaults, {
    enjoyai: { models: ["remote-model"], configurable: ["model"] },
  });
  const restrictedEnjoyAi = providersWithRemoteSubset.enjoyai;
  assert.equal(restrictedEnjoyAi.models.includes("gpt-4o-mini"), true);
  assert.equal(restrictedEnjoyAi.models.includes("remote-model"), true);
  assert.equal(
    providerSupportsOption(
      "enjoyai",
      "model",
      "remote-model",
      restrictedEnjoyAi
    ),
    true
  );
  assert.equal(
    providerSupportsOption(
      "enjoyai",
      "temperature",
      "remote-model",
      restrictedEnjoyAi
    ),
    false
  );
  assert.equal(
    providerSupportsOption(
      "openai",
      "temperature",
      "gpt-4o",
      providersWithRemoteSubset.openai
    ),
    true
  );
  assert.deepEqual(
    createGptProviders(defaults, { enjoyai: { configurable: [] } }).enjoyai
      .configurable,
    []
  );

  const ollamaRequests = [];
  const ollamaModels = await discoverLocalModels(
    "ollama",
    "http://localhost:11434/",
    async (url) => {
      ollamaRequests.push(url);
      return {
        ok: true,
        json: async () => ({ models: [{ name: "llama3" }, { name: "qwen" }] }),
      };
    }
  );
  assert.deepEqual(ollamaModels, ["llama3", "qwen"]);
  assert.deepEqual(ollamaRequests, ["http://localhost:11434/api/tags"]);

  const lmStudioModels = await discoverLocalModels(
    "lmstudio",
    "http://localhost:1234/v1",
    async (_url, options) => {
      assert.equal(options?.headers, undefined);
      return {
        ok: true,
        json: async () => ({ data: [{ id: "qwen2.5" }, { id: "llama3.2" }] }),
      };
    }
  );
  assert.deepEqual(lmStudioModels, ["qwen2.5", "llama3.2"]);

  let lmStudioTokenHeaders;
  const lmStudioTokenModels = await discoverLocalModels(
    "lmstudio",
    "http://localhost:1234/v1",
    async (_url, options) => {
      lmStudioTokenHeaders = options?.headers;
      return {
        ok: true,
        json: async () => ({ data: [{ id: "token-model" }] }),
      };
    },
    1500,
    " fake-lmstudio-token "
  );
  assert.deepEqual(lmStudioTokenModels, ["token-model"]);
  assert.deepEqual(lmStudioTokenHeaders, {
    Authorization: "Bearer fake-lmstudio-token",
  });

  let ollamaHeaders;
  const ollamaWithOtherKey = await discoverLocalModels(
    "ollama",
    "http://localhost:11434",
    async (_url, options) => {
      ollamaHeaders = options?.headers;
      return {
        ok: true,
        json: async () => ({ models: [{ name: "local-model" }] }),
      };
    },
    1500,
    "fake-openai-key"
  );
  assert.deepEqual(ollamaWithOtherKey, ["local-model"]);
  assert.equal(ollamaHeaders, undefined);

  assert.equal(
    await discoverLocalModels("ollama", "http://localhost:11434", async () => ({
      ok: true,
      json: async () => ({ malformed: true }),
    })),
    null
  );
  assert.equal(
    await discoverLocalModels(
      "ollama",
      "http://localhost:11434",
      () => new Promise(() => {}),
      5
    ),
    null
  );
  assert.equal(
    await discoverLocalModels(
      "ollama",
      "http://localhost:11434",
      async () => ({
        ok: true,
        json: async () => new Promise(() => {}),
      }),
      5
    ),
    null
  );

  assert.equal(AI_PROVIDER_CATALOG.gemini.defaultBaseUrl, "https://generativelanguage.googleapis.com/v1beta/openai");
  console.log("PASS: provider registry, safe remote config, local discovery, capability filtering, and persistence preservation.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
