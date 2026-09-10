/* global globalThis:readonly */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-azure-speech-config-"));
const output = path.join(temp, "azure-config.mjs");

try {
  await build({
    stdin: {
      contents: `export * from "./src/main/speech/azure-config.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
    plugins: [{
      name: "azure-config-fixture",
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "fixture" }));
        pluginBuild.onResolve({ filter: /^@main\/db\/models$/ }, () => ({ path: "models", namespace: "fixture" }));
        pluginBuild.onResolve({ filter: /^@\/types\/enums$/ }, () => ({ path: "enums", namespace: "fixture" }));
        pluginBuild.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          loader: "js",
          contents: args.path === "electron" ? `
            const fixture = () => globalThis.__azureSpeechConfigFixture;
            export const safeStorage = {
              isEncryptionAvailable() { return fixture().encryptionAvailable; },
              encryptString(value) { fixture().encryptCalls += 1; return Buffer.from("encrypted:" + value); },
              decryptString(value) { fixture().decryptCalls += 1; return Buffer.from(value).toString().replace(/^encrypted:/, ""); },
            };
          ` : args.path === "models" ? `
            const fixture = () => globalThis.__azureSpeechConfigFixture;
            export class UserSetting {
              static async get() { return fixture().stored; }
              static async set(_key, value) { fixture().stored = value; }
            }
          ` : `export const UserSettingKeyEnum = { AZURE_SPEECH: "azure_speech" };`,
        }));
      },
    }],
  });

  const api = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
  const fixture = {
    stored: null,
    encryptionAvailable: true,
    encryptCalls: 0,
    decryptCalls: 0,
  };
  globalThis.__azureSpeechConfigFixture = fixture;

  assert.deepEqual(await api.getAzureSpeechConfig(), { region: "", endpoint: "", configured: false, transcriptionConfigured: false });
  assert.equal(fixture.decryptCalls, 0);
  assert.deepEqual(
    await api.setAzureSpeechConfig({ region: " EastUS ", key: " direct-key " }),
    { region: "eastus", endpoint: "", configured: true, transcriptionConfigured: false },
  );
  assert.equal(fixture.stored.region, "eastus");
  assert.notEqual(fixture.stored.encryptedKey, "direct-key");
  assert.equal(fixture.encryptCalls, 1);
  assert.deepEqual(await api.getAzureSpeechConfig(), { region: "eastus", endpoint: "", configured: true, transcriptionConfigured: false });
  assert.equal(fixture.decryptCalls, 0);
  assert.deepEqual(await api.getAzureSpeechCredentials(), {
    subscriptionKey: "direct-key",
    region: "eastus",
    endpoint: "",
  });
  assert.equal(fixture.decryptCalls, 1);

  await assert.rejects(
    api.setAzureSpeechConfig({ region: "westus" }),
    /Enter the Azure Speech key again/,
  );
  const speechEndpoint = "https://example.cognitiveservices.azure.com";
  assert.deepEqual(await api.setAzureSpeechConfig({ endpoint: speechEndpoint }), {
    region: "eastus", endpoint: speechEndpoint, configured: true, transcriptionConfigured: true,
  });
  assert.equal((await api.getAzureSpeechCredentials()).endpoint, speechEndpoint);
  const endpointOnly = await api.setAzureSpeechConfig({ region: "", key: "endpoint-only-key" });
  assert.equal(endpointOnly.configured, false);
  assert.equal(endpointOnly.transcriptionConfigured, true);
  assert.deepEqual(await api.getAzureTranscriptionCredentials(), { key: "endpoint-only-key", endpoint: speechEndpoint, region: undefined });
  await assert.rejects(api.getAzureSpeechCredentials(), /not configured/);
  await api.setAzureSpeechConfig({ region: "eastus", key: "direct-key" });
  for (const endpoint of ["http://example.cognitiveservices.azure.com", "https://example.com", "https://user:pass@example.cognitiveservices.azure.com", "https://example.cognitiveservices.azure.com/path", "https://example.cognitiveservices.azure.com?key=secret"]) {
    await assert.rejects(api.setAzureSpeechConfig({ endpoint }), /HTTPS endpoint/);
  }
  await assert.rejects(api.setAzureSpeechConfig({ endpoint: "https://other.cognitiveservices.azure.com" }), /key again/);
  assert.equal((await api.getAzureSpeechConfig()).endpoint, speechEndpoint);
  fixture.encryptionAvailable = false;
  await assert.rejects(
    api.setAzureSpeechConfig({ region: "eastus", key: "replacement" }),
    /Secure credential storage is unavailable/,
  );
  await assert.rejects(
    api.getAzureSpeechCredentials(),
    /Secure credential storage is unavailable/,
  );

  const source = await readFile(path.join(root, "src/main/speech/azure-config.ts"), "utf8");
  assert.doesNotMatch(source, /accessToken|enjoyAiApiKey|apiUrl/);
  console.info("check-direct-speech-config: PASS (secure storage and no-fallback contract)");
} finally {
  delete globalThis.__azureSpeechConfigFixture;
  await rm(temp, { recursive: true, force: true });
}
