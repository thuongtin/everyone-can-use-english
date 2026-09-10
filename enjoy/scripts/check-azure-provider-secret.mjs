/* global globalThis */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-azure-secret-check-"));
try {
  const output = path.join(temp, "secret.mjs");
  await build({
    entryPoints: [path.join(root, "src/main/azure-provider-secret.ts")],
    bundle: true, platform: "node", format: "esm", outfile: output, logLevel: "silent",
    plugins: [{ name: "secure-storage-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
        export const safeStorage = {
          isEncryptionAvailable: () => globalThis.__azureEncryptionAvailable,
          encryptString: value => Buffer.from('encrypted:' + value),
          decryptString: value => {
            const decoded = value.toString();
            if (!decoded.startsWith('encrypted:')) throw new Error('fixture failure');
            return decoded.slice(10);
          }
        };
      ` }));
    } }],
  });
  const { encodeAzureProviderSecret: encode, decodeAzureProviderSecret: decode, readAzureProviderConfig: read } = await import(pathToFileURL(output).href);
  globalThis.__azureEncryptionAvailable = true;
  const input = { name: "azure-openai", models: "custom-deployment", key: " sample-key " };
  const stored = encode(input);
  assert.equal(stored.key, undefined);
  assert.notEqual(stored.encryptedKey, input.key.trim());
  assert.deepEqual(decode(stored), { name: "azure-openai", models: "custom-deployment", key: "sample-key" });
  assert.equal(input.key, " sample-key ");
  assert.deepEqual(encode({ name: "azure-openai", key: "", encryptedKey: "injected" }), { name: "azure-openai" });
  assert.throws(() => decode({ encryptedKey: Buffer.from("bad").toString("base64") }), /could not be decrypted/);
  globalThis.__azureEncryptionAvailable = false;
  assert.throws(() => encode(input), /unavailable/);
  assert.throws(() => decode(stored), /unavailable/);
  assert.deepEqual(read(stored), { name: "azure-openai", models: "custom-deployment", credentialError: "azure_key_unavailable" });
  assert.equal(read(stored).key, undefined);
  assert.equal(read(stored).encryptedKey, undefined);
  assert.throws(() => encode({ ...read(stored), key: "", models: "changed-deployment" }), /Enter the Azure key again/);
  assert.deepEqual(read(null), { credentialError: "azure_key_unavailable" });
  globalThis.__azureEncryptionAvailable = true;
  assert.deepEqual(read(stored), { name: "azure-openai", models: "custom-deployment", key: "sample-key" });
  const recovered = encode({ ...read({ name: "azure-openai", encryptedKey: "corrupt" }), key: "replacement-key" });
  assert.equal(read(recovered).key, "replacement-key");
  assert.equal(read(recovered).credentialError, undefined);
  console.info("check-azure-provider-secret: PASS (encrypted storage, round trip, clear, corrupt key and unavailable storage)");
} finally {
  delete globalThis.__azureEncryptionAvailable;
  await rm(temp, { recursive: true, force: true });
}
