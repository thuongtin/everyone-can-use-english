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
    "openai",
    "azure-openai",
    "gemini",
    "vertex-express",
    "deepseek",
    "openrouter",
    "ollama",
    "lmstudio",
    "codex-acp",
    "claude-acp",
  ]);
  assert.equal(defaults.lmstudio.baseUrl, "http://localhost:1234/v1");
  assert.equal(defaults["azure-openai"].baseUrl, undefined);
  assert.deepEqual(AI_PROVIDER_CATALOG.gemini, {
    id: "gemini",
    name: "Gemini",
    descriptionKey: "aiProviders.gemini.description",
    models: ["gemini-3.8-flash", "gemini-3.5-flash-lite"],
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    acceptsApiKey: true,
    configurable: [
      "model",
      "baseUrl",
      "roleDefinition",
      "temperature",
      "numberOfChoices",
      "maxTokens",
      "frequencyPenalty",
      "presencePenalty",
      "historyBufferSize",
      "tts",
    ],
    modelCapabilities: {
      "gemini-3.8-flash": {
        numberOfChoices: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
      "gemini-3.5-flash-lite": {
        numberOfChoices: false,
        frequencyPenalty: false,
        presencePenalty: false,
      },
    },
  });
  assert.deepEqual(AI_PROVIDER_CATALOG["vertex-express"], {
    id: "vertex-express",
    name: "Vertex AI Express",
    descriptionKey: "aiProviders.vertexExpress.description",
    models: [],
    defaultBaseUrl: "https://aiplatform.googleapis.com/v1",
    acceptsApiKey: true,
    configurable: [
      "model",
      "roleDefinition",
      "temperature",
      "maxTokens",
      "historyBufferSize",
    ],
  });
  assert.deepEqual(defaults["vertex-express"], {
    name: "vertex-express",
    key: undefined,
    baseUrl: "https://aiplatform.googleapis.com/v1",
    models: "",
  });
  assert.equal(providerSupportsOption("vertex-express", "model"), true);
  assert.equal(providerSupportsOption("vertex-express", "baseUrl"), false);
  assert.equal(providerSupportsOption("vertex-express", "tts"), false);
  assert.deepEqual(AI_PROVIDER_CATALOG["azure-openai"].models, []);
  assert.equal(
    providerSupportsOption("azure-openai", "temperature", "deployment-alias"),
    false
  );
  assert.equal(
    providerSupportsOption("azure-openai", "maxTokens", "deployment-alias"),
    true
  );

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
  assert.deepEqual(
    normalizeProviderConfig("vertex-express", {
      key: "fake-vertex-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      models: " explicit-model, explicit-model ",
    }),
    {
      name: "vertex-express",
      key: "fake-vertex-key",
      baseUrl: "https://aiplatform.googleapis.com/v1",
      models: "explicit-model",
    }
  );

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
      engine: { name: "needs-selection", models: { default: "" } },
      shouldPersist: false,
    }
  );
  assert.deepEqual(
    resolveGptEngineBootstrap(
      { name: "retired-provider", models: { default: "custom-model" } },
      undefined
    ),
    {
      engine: { name: "needs-selection", models: { default: "" } },
      shouldPersist: false,
    }
  );
  assert.deepEqual(
    resolveGptEngineBootstrap(
      { name: "openai", models: { default: "custom-model" } },
      undefined
    ),
    {
      engine: { name: "openai", models: { default: "custom-model" } },
      shouldPersist: false,
    }
  );
  assert.deepEqual(
    resolveGptEngineBootstrap(undefined, {
      key: "",
      models: "gpt-5.6-luna",
    }),
    {
      engine: { name: "needs-selection", models: { default: "" } },
      shouldPersist: false,
    }
  );

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
  assert.deepEqual(createGptProviders(defaults)["vertex-express"].models, []);
  assert.deepEqual(
    createGptProviders({
      ...defaults,
      "vertex-express": normalizeProviderConfig("vertex-express", {
        key: "fake-vertex-key",
        models: "publisher-model",
      }),
    })["vertex-express"].models,
    ["publisher-model"]
  );
  const separateGoogleProviders = createGptProviders({
    ...defaults,
    gemini: normalizeProviderConfig("gemini", {
      key: "fake-gemini-key",
      baseUrl: "https://gemini-gateway.invalid/v1",
      models: "custom-gemini-model",
    }),
    "vertex-express": {
      name: "vertex-express",
      key: "fake-vertex-key",
      baseUrl: "https://must-not-be-used.invalid/v1",
      models: "custom-vertex-model",
    },
  });
  assert.equal(
    separateGoogleProviders.gemini.baseUrl,
    "https://gemini-gateway.invalid/v1"
  );
  assert.equal(
    separateGoogleProviders["vertex-express"].baseUrl,
    "https://aiplatform.googleapis.com/v1"
  );
  assert.equal(
    separateGoogleProviders.gemini.models.includes("custom-vertex-model"),
    false
  );
  assert.equal(
    separateGoogleProviders["vertex-express"].models.includes(
      "custom-gemini-model"
    ),
    false
  );
  assert.deepEqual(createGptProviders(defaults)["codex-acp"].models, []);
  assert.deepEqual(
    createGptProviders(
      {
        ...defaults,
        "codex-acp": { name: "codex-acp", models: "stale-model" },
      },
      undefined,
      { "codex-acp": ["discovered-model"] }
    )["codex-acp"].models,
    ["discovered-model"]
  );
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
  assert.equal("enjoyai" in providers, false);
  assert.equal(isLegacyProviderModel("enjoyai", "gpt-4o-mini"), true);
  assert.equal(isLegacyProviderModel("enjoyai", "gpt-4o"), true);
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
  assert.equal("enjoyai" in providersWithRemoteSubset, false);
  assert.equal(providerSupportsOption("enjoyai", "model"), false);
  assert.equal(
    providerSupportsOption(
      "openai",
      "temperature",
      "gpt-4o",
      providersWithRemoteSubset.openai
    ),
    true
  );
  assert.equal(
    "enjoyai" in createGptProviders(defaults, { enjoyai: { configurable: [] } }),
    false
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
