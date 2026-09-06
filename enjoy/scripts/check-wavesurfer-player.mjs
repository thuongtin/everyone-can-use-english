import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const componentSource = await readFile(
  path.join(root, "src/renderer/components/misc/wavesurfer-player.tsx"),
  "utf8"
);

assert.match(componentSource, /threshold:\s*0/);
assert.match(componentSource, /absolute inset-0/);
const containerStart = componentSource.indexOf('className="col-span-8 min-w-0 h-[80px]"');
assert.notEqual(containerStart, -1);
const containerEnd = componentSource.indexOf("/>", containerStart);
assert.notEqual(containerEnd, -1);
assert.doesNotMatch(
  componentSource.slice(containerStart, containerEnd),
  /\bhidden\b/
);
const missingSourceBranch = componentSource.slice(
  componentSource.indexOf("if (!isIntersecting || !src"),
  componentSource.indexOf("const uuid")
);
assert.match(missingSourceBranch, /setInitialized\(false\)/);
assert.match(missingSourceBranch, /setIsPlaying\(false\)/);
assert.match(missingSourceBranch, /setDuration\(0\)/);
assert.match(missingSourceBranch, /setCurrentTime\(0\)/);
assert.match(missingSourceBranch, /setError\(null\)/);

const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-wavesurfer-"));

try {
  const output = path.join(temp, "wavesurfer-lifecycle.mjs");
  await build({
    stdin: {
      contents: `export { createWavesurferLifecycle } from "./src/renderer/lib/wavesurfer-lifecycle.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });

  const { createWavesurferLifecycle } = await import(
    `${pathToFileURL(output).href}?test=${Date.now()}`
  );

  class FakeWaveSurfer {
    listeners = new Map();
    loads = [];
    destroyed = false;
    loadListenerCounts = [];

    on(event, listener) {
      const listeners = this.listeners.get(event) || new Set();
      listeners.add(listener);
      this.listeners.set(event, listeners);
      return () => listeners.delete(listener);
    }

    emit(event, ...args) {
      for (const listener of this.listeners.get(event) || []) {
        listener(...args);
      }
    }

    load(src) {
      this.loads.push(src);
      this.loadListenerCounts.push({
        ready: this.listeners.get("ready")?.size || 0,
        error: this.listeners.get("error")?.size || 0,
      });
      return Promise.resolve();
    }

    destroy() {
      this.destroyed = true;
    }
  }

  const tests = [];
  const test = async (name, callback) => {
    await callback();
    tests.push(name);
  };

  await test("registers ready and error listeners before loading", async () => {
    const instances = [];
    let readyDuration;
    const lifecycle = createWavesurferLifecycle({
      src: "fixture-a.mp3",
      create: () => {
        const instance = new FakeWaveSurfer();
        instances.push(instance);
        return instance;
      },
      handlers: {
        onReady: (_instance, duration) => {
          readyDuration = duration;
        },
      },
    });

    assert.equal(instances.length, 1);
    assert.deepEqual(instances[0].loadListenerCounts, [{ ready: 1, error: 1 }]);
    instances[0].emit("ready", 12);
    assert.equal(readyDuration, 12);
    lifecycle.destroy();
  });

  await test("does not throw when an error has no callback", async () => {
    const lifecycle = createWavesurferLifecycle({
      src: "missing.mp3",
      create: () => {
        const instance = new FakeWaveSurfer();
        instance.load = () => {
          instance.emit("error", new Error("fixture failure"));
          return Promise.reject(new Error("fixture failure"));
        };
        return instance;
      },
    });

    await Promise.resolve();
    lifecycle.destroy();
  });

  await test("retry creates a new instance and reloads the same URL", async () => {
    const instances = [];
    let readyCount = 0;
    let cleanupCount = 0;
    const lifecycle = createWavesurferLifecycle({
      src: "fixture-a.mp3",
      create: () => {
        const instance = new FakeWaveSurfer();
        instances.push(instance);
        return instance;
      },
      handlers: {
        onReady: () => {
          readyCount += 1;
          return () => {
            cleanupCount += 1;
          };
        },
      },
    });

    const first = instances[0];
    first.emit("ready", 5);
    assert.equal(readyCount, 1);
    await lifecycle.reload();

    const retry = instances[1];
    assert.notEqual(retry, first);
    assert.equal(first.destroyed, true);
    assert.deepEqual(retry.loads, ["fixture-a.mp3"]);
    first.emit("ready", 6);
    assert.equal(readyCount, 1);
    retry.emit("ready", 7);
    assert.equal(readyCount, 2);
    assert.equal(cleanupCount, 1);
    lifecycle.destroy();
    assert.equal(retry.destroyed, true);
    assert.equal(cleanupCount, 2);
    assert.equal(lifecycle.getInstance(), null);
  });

  await test("source changes destroy the old instance and load the new URL", async () => {
    const instances = [];
    let errorCount = 0;
    const lifecycle = createWavesurferLifecycle({
      src: "fixture-a.mp3",
      create: () => {
        const instance = new FakeWaveSurfer();
        instances.push(instance);
        return instance;
      },
      handlers: {
        onError: () => {
          errorCount += 1;
        },
      },
    });

    const first = instances[0];
    await lifecycle.reload("fixture-b.mp3");
    const second = instances[1];
    assert.equal(first.destroyed, true);
    assert.deepEqual(second.loads, ["fixture-b.mp3"]);
    first.emit("error", new Error("stale error"));
    assert.equal(errorCount, 0);
    lifecycle.destroy();
    assert.equal(second.destroyed, true);
  });

  console.log(
    `PASS: ${tests.length + 1} Wavesurfer lifecycle regression cases, including valid source to empty source state reset.`
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
