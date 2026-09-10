import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-learning-speech-config-"));
const output = path.join(temp, "speech-configuration.mjs");

const mockModules = {
  "user-setting": `
    const fixture = () => globalThis.__learningSpeechConfigurationFixture;
    export class UserSetting {
      static async get(key) {
        fixture().settingReads.push(key);
        return fixture().settings[key] ?? null;
      }
    }
  `,
  settings: `
    const fixture = () => globalThis.__learningSpeechConfigurationFixture;
    export default {
      getSync(key) {
        fixture().legacyReads.push(key);
        return fixture().legacySettings[key] ?? null;
      },
      apiUrl() {
        fixture().apiUrlReads += 1;
        return fixture().apiUrl;
      },
    };
  `,
  proxy: `
    const fixture = () => globalThis.__learningSpeechConfigurationFixture;
    export default function proxyAgent() {
      fixture().proxyReads += 1;
      return fixture().proxy;
    }
  `,
  provider: `
    const fixture = () => globalThis.__learningSpeechConfigurationFixture;
    export function createOpenAiSpeechProvider(params) {
      fixture().providerCalls.push({
        configuration: { ...params.configuration },
        configurationFrozen: Object.isFrozen(params.configuration),
        clientOptions: { ...params.clientOptions },
      });
      return {
        id: "openai",
        model: params.configuration.model,
        voice: params.configuration.voice,
        async synthesize() { throw new Error("network_not_allowed_in_test"); },
      };
    }
    export function createAzureSpeechProvider(params) {
      fixture().providerCalls.push({
        configuration: { ...params.configuration },
        configurationFrozen: Object.isFrozen(params.configuration),
        credentials: { ...params.credentials },
      });
      return Object.freeze({
        id: "azure",
        model: params.configuration.model,
        voice: params.configuration.voice,
        async synthesize() { throw new Error("network_not_allowed_in_test"); },
      });
    }
  `,
  "azure-config": `
    const fixture = () => globalThis.__learningSpeechConfigurationFixture;
    export async function getAzureSpeechCredentials() {
      fixture().azureCredentialReads += 1;
      if (!fixture().azureCredentials) throw new Error("speech_not_configured");
      return fixture().azureCredentials;
    }
  `,
};

function createFixture(overrides = {}) {
  const proxyFetch = async () => {
    throw new Error("network_not_allowed_in_test");
  };
  return {
    settings: {},
    legacySettings: {},
    azureCredentials: null,
    proxy: { httpAgent: { name: "fixture-agent" }, fetch: proxyFetch },
    settingReads: [],
    legacyReads: [],
    azureCredentialReads: 0,
    proxyReads: 0,
    providerCalls: [],
    ...overrides,
  };
}

try {
  await build({
    stdin: {
      contents: `export * from "./src/main/learning/speech-configuration.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
    plugins: [
      {
        name: "learning-speech-configuration-fixtures",
        setup(pluginBuild) {
          const mocks = [
            ["@main/db/models/user-setting", "user-setting"],
            ["@main/settings", "settings"],
            ["@main/proxy-agent", "proxy"],
            ["@main/speech/provider", "provider"],
            ["@main/speech/azure-config", "azure-config"],
          ];
          for (const [specifier, mock] of mocks) {
            pluginBuild.onResolve(
              { filter: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}$`) },
              () => ({ path: mock, namespace: "fixture" }),
            );
          }
          pluginBuild.onResolve({ filter: /^@\// }, (args) => ({
            path: path.join(root, "src", args.path.slice(2)) + ".ts",
          }));
          pluginBuild.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents: mockModules[args.path],
            loader: "ts",
          }));
        },
      },
    ],
  });

  const {
    LearningSpeechConfigurationError,
    createConfiguredLearningSpeechProvider,
  } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
  const tests = [];
  const test = async (name, callback) => {
    await callback();
    tests.push(name);
  };

  await test("does not select a paid speech provider when TTS is unconfigured", async () => {
    const fixture = createFixture();
    globalThis.__learningSpeechConfigurationFixture = fixture;

    assert.equal(await createConfiguredLearningSpeechProvider(), null);
    assert.deepEqual(fixture.settingReads, ["tts_config"]);
    assert.equal(fixture.legacyReads.length, 0);
    assert.equal(fixture.azureCredentialReads, 0);
    assert.equal(fixture.proxyReads, 0);
    assert.equal(fixture.providerCalls.length, 0);
  });

  await test("uses canonical direct OpenAI settings and the configured TTS override", async () => {
    const fetch = async () => {
      throw new Error("network_not_allowed_in_test");
    };
    const fixture = createFixture({
      settings: {
        tts_config: {
          engine: " OpenAI ",
          model: " openai/gpt-4o-mini-tts ",
          voice: "alloy",
          baseUrl: " https://tts.example.test/v1 ",
        },
        openai: { key: " configured-key ", baseUrl: "https://saved.example.test/v1" },
      },
      proxy: { httpAgent: { name: "configured-agent" }, fetch },
    });
    globalThis.__learningSpeechConfigurationFixture = fixture;

    const provider = await createConfiguredLearningSpeechProvider();
    assert.ok(provider);
    assert.equal(Object.isFrozen(provider), true);
    assert.deepEqual(fixture.settingReads, ["tts_config", "openai"]);
    assert.deepEqual(fixture.legacyReads, []);
    assert.equal(fixture.providerCalls.length, 1);
    assert.deepEqual(fixture.providerCalls[0].configuration, {
      engine: "openai",
      model: "gpt-4o-mini-tts",
      voice: "alloy",
    });
    assert.equal(fixture.providerCalls[0].configurationFrozen, true);
    assert.equal(fixture.providerCalls[0].clientOptions.apiKey, "configured-key");
    assert.equal(fixture.providerCalls[0].clientOptions.baseURL, "https://tts.example.test/v1");
    assert.equal(fixture.providerCalls[0].clientOptions.httpAgent, fixture.proxy.httpAgent);
    assert.equal(fixture.providerCalls[0].clientOptions.fetch, fetch);
  });

  await test("falls back to legacy OpenAI settings only when canonical settings are missing", async () => {
    const fixture = createFixture({
      settings: {
        tts_config: { engine: "openai", model: "tts-1-hd", voice: "nova" },
      },
      legacySettings: {
        openai: { key: "legacy-key", baseUrl: " https://legacy.example.test/v1 " },
      },
    });
    globalThis.__learningSpeechConfigurationFixture = fixture;

    await createConfiguredLearningSpeechProvider();
    assert.deepEqual(fixture.legacyReads, ["openai"]);
    assert.equal(fixture.providerCalls[0].clientOptions.apiKey, "legacy-key");
    assert.equal(fixture.providerCalls[0].clientOptions.baseURL, "https://legacy.example.test/v1");

    const cleared = createFixture({
      settings: {
        tts_config: { engine: "openai", model: "tts-1", voice: "echo" },
        openai: { key: "" },
      },
      legacySettings: { openai: { key: "must-not-be-used" } },
    });
    globalThis.__learningSpeechConfigurationFixture = cleared;
    await assert.rejects(
      createConfiguredLearningSpeechProvider(),
      (error) =>
        error instanceof LearningSpeechConfigurationError &&
        error.code === "speech_not_configured",
    );
    assert.deepEqual(cleared.legacyReads, []);
    assert.equal(cleared.providerCalls.length, 0);
  });

  await test("rejects legacy EnjoyAI speech instead of reviving a backend session", async () => {
    const fixture = createFixture({
      settings: {
        tts_config: {
          engine: "enjoyai",
          model: "openai/tts-1",
          voice: "shimmer",
        },
      },
    });
    globalThis.__learningSpeechConfigurationFixture = fixture;

    await assert.rejects(
      createConfiguredLearningSpeechProvider(),
      (error) => error instanceof LearningSpeechConfigurationError,
    );
    assert.equal(fixture.providerCalls.length, 0);
    assert.equal(fixture.azureCredentialReads, 0);
  });

  await test("creates direct Azure narration only from dedicated credentials", async () => {
    const fixture = createFixture({
      settings: {
        tts_config: {
          engine: "azure",
          model: "azure/speech",
          voice: "en-US-JennyNeural",
        },
      },
      azureCredentials: { subscriptionKey: "direct-key", region: "eastus" },
    });
    globalThis.__learningSpeechConfigurationFixture = fixture;

    const provider = await createConfiguredLearningSpeechProvider();
    assert.equal(provider.id, "azure");
    assert.equal(fixture.azureCredentialReads, 1);
    assert.equal(fixture.proxyReads, 0);
    assert.deepEqual(fixture.providerCalls[0], {
      configuration: {
        engine: "azure",
        model: "azure/speech",
        voice: "en-US-JennyNeural",
      },
      configurationFrozen: true,
      credentials: { subscriptionKey: "direct-key", region: "eastus" },
    });

    fixture.azureCredentials = null;
    await assert.rejects(
      createConfiguredLearningSpeechProvider(),
      (error) => error instanceof LearningSpeechConfigurationError,
    );
  });

  await test("reports malformed configured speech with a stable error code", async () => {
    for (const ttsConfig of [
      "openai",
      { engine: "unknown", model: "tts-1", voice: "alloy" },
      { engine: "openai", model: "unknown", voice: "alloy" },
      { engine: "openai", model: "tts-1", voice: "unknown" },
    ]) {
      const fixture = createFixture({
        settings: {
          tts_config: ttsConfig,
          openai: { key: "configured-key" },
        },
      });
      globalThis.__learningSpeechConfigurationFixture = fixture;
      await assert.rejects(
        createConfiguredLearningSpeechProvider(),
        (error) =>
          error instanceof LearningSpeechConfigurationError &&
          error.code === "speech_not_configured",
      );
    }
  });

  console.log(`check-learning-speech-configuration: PASS (${tests.length} cases)`);
} finally {
  delete globalThis.__learningSpeechConfigurationFixture;
  await rm(temp, { recursive: true, force: true });
}
