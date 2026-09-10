import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const buildRoot = await mkdtemp(path.join(root, ".tmp-narration-synthesis-build-"));
const privateRoot = await mkdtemp(path.join(root, ".tmp-narration-private-"));
const tests = [];
const test = async (name, action) => {
  await action();
  tests.push(name);
};

function makeWav(durationMs, frequency = 440) {
  const sampleRate = 8_000;
  const samples = Math.round(sampleRate * durationMs / 1_000);
  const dataBytes = samples * 2;
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(36 + dataBytes, 4);
  bytes.write("WAVEfmt ", 8, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples; index += 1) {
    bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * index / sampleRate) * 8_000), 44 + index * 2);
  }
  return bytes;
}

function providerFor(calls, options = {}) {
  const provider = {
    id: "mock",
    model: "mock-model",
    voice: "mock-voice",
    async synthesize(text, request = {}) {
      calls.push({ text, model: provider.model, voice: provider.voice, signal: request.signal });
      if (options.synthesize) return options.synthesize(text, request, calls.length);
      return {
        bytes: makeWav(options.durationMs ?? 120, 400 + calls.length * 40),
        mimeType: "audio/wav",
        engine: "openai",
        model: provider.model,
        voice: provider.voice,
      };
    },
  };
  return provider;
}

async function emptyDirectory(directory) {
  assert.deepEqual(await readdir(directory), []);
}

try {
  const entry = path.join(buildRoot, "entry.ts");
  await writeFile(entry, [
    `export * from ${JSON.stringify(path.join(root, "src/main/learning/narration-synthesis.ts"))};`,
    `export * from ${JSON.stringify(path.join(root, "src/main/learning/asset-store.ts"))};`,
    `export * from ${JSON.stringify(path.join(root, "src/main/speech/provider.ts"))};`,
  ].join("\n"));
  const output = path.join(buildRoot, "entry.mjs");
  await build({
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    target: "node20",
  });
  const { LearningAssetStore, SpeechProviderError, synthesizeNarration } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

  await test("returns the provider result unchanged for one chunk", async () => {
    const calls = [];
    const result = {
      bytes: makeWav(100), mimeType: "audio/wav", engine: "openai", model: "mock-model", voice: "mock-voice",
    };
    const provider = providerFor(calls, { synthesize: async () => result });
    const actual = await synthesizeNarration({ provider, text: "A short narration.", privateHome: privateRoot, signal: new AbortController().signal });
    assert.equal(actual, result);
    assert.deepEqual(calls.map(({ text }) => text), ["A short narration."]);
    await emptyDirectory(privateRoot);
  });

  await test("synthesizes exact bounded chunks in order and decodes a valid merged WAV", async () => {
    const calls = [];
    const text = `${"😀word ".repeat(700)}First section.\n\n${"second ".repeat(700)}Last section.`;
    const provider = providerFor(calls, { durationMs: 150 });
    const result = await synthesizeNarration({ provider, text, privateHome: privateRoot, signal: new AbortController().signal });
    assert.ok(calls.length > 1);
    assert.equal(calls.map(({ text: chunk }) => chunk).join(""), text);
    assert.ok(calls.every(({ text: chunk }) => Array.from(chunk).length <= 3_800));
    assert.ok(calls.every(({ model, voice }) => model === "mock-model" && voice === "mock-voice"));
    assert.equal(result.mimeType, "audio/wav");
    assert.equal(result.bytes.toString("ascii", 0, 4), "RIFF");
    const assetRoot = path.join(privateRoot, "assets");
    await mkdir(assetRoot, { recursive: true });
    const store = new LearningAssetStore(assetRoot);
    await store.initialize();
    const imported = await store.importBytes({
      id: "11111111-1111-4111-8111-111111111111",
      kind: "audio",
      bytes: result.bytes,
    });
    assert.equal(imported.mimeType, "audio/wav");
    assert.ok(imported.durationMs >= calls.length * 140);
    assert.ok(imported.durationMs <= calls.length * 170);
    await rm(assetRoot, { recursive: true, force: true });
    await emptyDirectory(privateRoot);
  });

  await test("cancels before synthesis without calling the provider or creating temp files", async () => {
    const controller = new AbortController();
    controller.abort();
    const calls = [];
    await assert.rejects(
      synthesizeNarration({ provider: providerFor(calls), text: "Cancelled.", privateHome: privateRoot, signal: controller.signal }),
      { code: "native_cancelled" },
    );
    assert.equal(calls.length, 0);
    await emptyDirectory(privateRoot);
  });

  await test("cancels during synthesis without starting another chunk or creating temp files", async () => {
    const controller = new AbortController();
    const calls = [];
    const provider = providerFor(calls, {
      synthesize: async (_text, { signal }) => {
        controller.abort();
        assert.equal(signal.aborted, true);
        throw new SpeechProviderError("speech_cancelled", "cancelled");
      },
    });
    await assert.rejects(
      synthesizeNarration({ provider, text: `${"one ".repeat(1_000)}${"two ".repeat(1_000)}`, privateHome: privateRoot, signal: controller.signal }),
      { code: "speech_cancelled" },
    );
    assert.equal(calls.length, 1);
    await emptyDirectory(privateRoot);
  });

  await test("propagates provider errors and leaves no temp files", async () => {
    const calls = [];
    const provider = providerFor(calls, {
      synthesize: async (_text, _request, callNumber) => {
        if (callNumber === 2) throw new SpeechProviderError("speech_quota", "quota");
        return { bytes: makeWav(100), mimeType: "audio/wav", engine: "openai", model: "mock-model", voice: "mock-voice" };
      },
    });
    await assert.rejects(
      synthesizeNarration({ provider, text: `${"first ".repeat(900)}${"second ".repeat(900)}`, privateHome: privateRoot, signal: new AbortController().signal }),
      { code: "speech_quota" },
    );
    assert.equal(calls.length, 2);
    await emptyDirectory(privateRoot);
  });

  await test("returns retryable cleanup failure without hanging or deleting owned files", async () => {
    const executable = path.join(buildRoot, "mock-ffmpeg");
    await writeFile(executable, "mock");
    await chmod(executable, 0o700);
    const deniedEntry = path.join(buildRoot, "cleanup-denied-entry.ts");
    await writeFile(deniedEntry, `export * from ${JSON.stringify(path.join(root, "src/main/learning/narration-synthesis.ts"))};`);
    const deniedOutput = path.join(buildRoot, "cleanup-denied.mjs");
    await build({
      entryPoints: [deniedEntry],
      outfile: deniedOutput,
      bundle: true,
      packages: "external",
      platform: "node",
      format: "esm",
      target: "node20",
      plugins: [{
        name: "denied-process-cleanup",
        setup(buildApi) {
          buildApi.onResolve({ filter: /^node:child_process$/u }, () => ({ path: "child-process", namespace: "cleanup-test" }));
          buildApi.onResolve({ filter: /^ffmpeg-static$/u }, () => ({ path: "ffmpeg", namespace: "cleanup-test" }));
          buildApi.onLoad({ filter: /.*/, namespace: "cleanup-test" }, ({ path: modulePath }) => ({
            contents: modulePath === "ffmpeg"
              ? `export default ${JSON.stringify(executable)};`
              : [
                `import { EventEmitter } from "node:events";`,
                `export function spawn() {`,
                `  const child = new EventEmitter();`,
                `  child.pid = 424242;`,
                `  child.kill = () => true;`,
                `  return child;`,
                `}`,
              ].join("\n"),
            loader: "js",
          }));
          buildApi.onLoad({ filter: /narration-synthesis\.ts$/u }, async ({ path: sourcePath }) => {
            const source = await readFile(sourcePath, "utf8");
            const contents = source
              .replace("const FFMPEG_TIMEOUT_MS = 30_000;", "const FFMPEG_TIMEOUT_MS = 20;")
              .replace("const PROCESS_KILL_GRACE_MS = 1_000;", "const PROCESS_KILL_GRACE_MS = 5;");
            assert.notEqual(contents, source);
            return { contents, loader: "ts" };
          });
        },
      }],
    });
    const { synthesizeNarration: synthesizeWithDeniedCleanup } = await import(`${pathToFileURL(deniedOutput).href}?test=${Date.now()}`);
    const originalKill = process.kill;
    process.kill = ((pid, signal) => {
      if (pid === -424242) return true;
      return originalKill(pid, signal);
    });
    let cleanupError;
    const startedAt = Date.now();
    try {
      await synthesizeWithDeniedCleanup({
        provider: providerFor([]),
        text: `${"first ".repeat(700)}${"second ".repeat(700)}`,
        privateHome: privateRoot,
        signal: new AbortController().signal,
      });
      assert.fail("Expected cleanup denial");
    } catch (error) {
      cleanupError = error;
    } finally {
      process.kill = originalKill;
    }
    assert.equal(cleanupError?.code, "native_cleanup_failed");
    assert.equal(typeof cleanupError?.cleanup, "function");
    assert.ok(Date.now() - startedAt < 1_000);
    const retained = (await readdir(privateRoot)).filter((name) => name.startsWith("narration-"));
    assert.equal(retained.length, 1);
    process.kill = ((pid, signal) => {
      if (pid === -424242) return true;
      return originalKill(pid, signal);
    });
    try {
      await assert.rejects(cleanupError.cleanup(), /still running/u);
    } finally {
      process.kill = originalKill;
    }
    assert.deepEqual((await readdir(privateRoot)).filter((name) => name.startsWith("narration-")), retained);
    await rm(path.join(privateRoot, retained[0]), { recursive: true, force: true });
    await emptyDirectory(privateRoot);
  });

  console.log(`Narration synthesis checks passed (${tests.length}): ${tests.join(", ")}`);
} finally {
  await rm(buildRoot, { recursive: true, force: true });
  await rm(privateRoot, { recursive: true, force: true });
}
