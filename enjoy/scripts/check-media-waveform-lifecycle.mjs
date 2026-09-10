import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-media-waveform-"));

try {
  const output = path.join(temp, "media-waveform-lifecycle.mjs");
  await build({
    stdin: {
      contents: `export { isValidMediaWaveformCache, publishPreparedMediaWaveform, resolveMediaWaveformCache, resolveMediaWaveformDuration, startMediaWaveformLifecycle } from "./src/renderer/lib/media-waveform-lifecycle.ts";`,
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
    isValidMediaWaveformCache,
    publishPreparedMediaWaveform,
    resolveMediaWaveformCache,
    resolveMediaWaveformDuration,
    startMediaWaveformLifecycle,
  } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

  assert.equal(resolveMediaWaveformDuration(11, 12), 11);
  assert.equal(resolveMediaWaveformDuration(null, 12), 12);
  assert.equal(resolveMediaWaveformDuration(Number.NaN, 12), 12);
  assert.equal(resolveMediaWaveformDuration(Infinity, 12), 12);
  assert.equal(resolveMediaWaveformDuration(0, -1), undefined);

  const validWaveform = {
    duration: 11,
    sampleRate: 8_000,
    peaks: [0, 0.25, -0.25],
    frequencies: [null, 120, 125],
  };
  assert.equal(isValidMediaWaveformCache(validWaveform), true);
  assert.equal(isValidMediaWaveformCache({}), false);
  assert.equal(isValidMediaWaveformCache({ ...validWaveform, duration: Infinity }), false);
  assert.equal(isValidMediaWaveformCache({ ...validWaveform, sampleRate: 0 }), false);
  assert.equal(isValidMediaWaveformCache({ ...validWaveform, peaks: [] }), false);
  assert.equal(isValidMediaWaveformCache({ ...validWaveform, peaks: [0, Number.NaN] }), false);
  assert.equal(isValidMediaWaveformCache({ ...validWaveform, frequencies: undefined }), false);
  assert.equal(isValidMediaWaveformCache({ ...validWaveform, frequencies: [120, "bad"] }), false);

  const published = [];
  let saveAttempts = 0;
  const rejectedSave = publishPreparedMediaWaveform({
    value: validWaveform,
    publish: value => { published.push(value); },
    save: async () => {
      saveAttempts += 1;
      throw new Error("disk full");
    },
  });
  assert.deepEqual(published, [validWaveform]);
  await rejectedSave;
  assert.equal(saveAttempts, 1);

  let stalePublished = false;
  let staleSaved = false;
  await publishPreparedMediaWaveform({
    value: validWaveform,
    isCurrent: () => false,
    publish: () => { stalePublished = true; },
    save: async () => { staleSaved = true; },
  });
  assert.equal(stalePublished, false);
  assert.equal(staleSaved, false);

  class OrderedPlayer {
    listeners = new Map();
    destroyed = false;
    order = [];

    on(event, listener) {
      this.order.push(`subscribe:${event}`);
      const listeners = this.listeners.get(event) || new Set();
      listeners.add(listener);
      this.listeners.set(event, listeners);
      return () => {
        this.order.push(`unsubscribe:${event}`);
        listeners.delete(listener);
      };
    }

    emit(event, ...args) {
      for (const listener of this.listeners.get(event) || []) listener(...args);
    }

    destroy() {
      this.order.push("destroy");
      this.destroyed = true;
    }
  }

  const player = new OrderedPlayer();
  let readyCount = 0;
  const lifecycle = startMediaWaveformLifecycle({
    create: () => player,
    load: async instance => {
      instance.order.push("load");
      instance.emit("ready", 11);
    },
    onReady: () => { readyCount += 1; },
  });
  await lifecycle.loaded;
  assert.equal(readyCount, 1);
  assert.ok(player.order.indexOf("subscribe:ready") < player.order.indexOf("load"));
  assert.ok(player.order.indexOf("subscribe:error") < player.order.indexOf("load"));

  lifecycle.dispose();
  player.emit("ready", 12);
  player.emit("error", new Error("late error"));
  assert.equal(readyCount, 1);
  assert.equal(player.destroyed, true);
  assert.ok(player.order.indexOf("unsubscribe:ready") < player.order.indexOf("destroy"));

  class AutoLoadPlayer extends OrderedPlayer {
    constructor() {
      super();
      queueMicrotask(() => {
        this.order.push("constructor:auto-load");
        this.emit("ready", 11);
      });
    }
  }
  const autoLoad = new AutoLoadPlayer();
  let autoReadyCount = 0;
  const autoLifecycle = startMediaWaveformLifecycle({
    create: () => autoLoad,
    load: () => {},
    onReady: () => { autoReadyCount += 1; },
  });
  await Promise.resolve();
  assert.equal(autoReadyCount, 1);
  assert.ok(autoLoad.order.indexOf("subscribe:ready") < autoLoad.order.indexOf("constructor:auto-load"));
  autoLifecycle.dispose();

  const stale = new OrderedPlayer();
  let currentRevision = 1;
  let staleReadyCount = 0;
  const staleLifecycle = startMediaWaveformLifecycle({
    create: () => stale,
    load: async () => {},
    isCurrent: () => currentRevision === 1,
    onReady: () => { staleReadyCount += 1; },
  });
  currentRevision = 2;
  stale.emit("ready", 11);
  assert.equal(staleReadyCount, 0);
  staleLifecycle.dispose();

  let brokenCacheValue = "unresolved";
  const brokenCache = resolveMediaWaveformCache({
    load: async () => { throw new Error("broken waveform JSON"); },
    onResolved: value => { brokenCacheValue = value; },
  });
  await brokenCache.resolved;
  assert.equal(brokenCacheValue, null);

  let staleCacheCalled = false;
  let resolveStaleCache;
  const staleCache = resolveMediaWaveformCache({
    load: () => new Promise(resolve => { resolveStaleCache = resolve; }),
    isCurrent: () => false,
    onResolved: () => { staleCacheCalled = true; },
  });
  await Promise.resolve();
  resolveStaleCache({ duration: 11 });
  await staleCache.resolved;
  assert.equal(staleCacheCalled, false);
  staleCache.dispose();

  console.log("PASS: waveform cache validation, best-effort save, listener ordering and stale cleanup.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
