import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-youtube-segment-offline-"));

const deferred = () => {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
};

const waitFor = async (predicate, message) => {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise(resolve => setImmediate(resolve));
  }
};

const resetHarness = context => {
  global.__ENJOY_YOUTUBE_EFFECTS__ = [];
  global.__ENJOY_YOUTUBE_STATE_WRITES__ = [];
  global.__ENJOY_YOUTUBE_CONTEXT__ = context;
};

const makeWindow = () => {
  const listeners = new Map();
  return {
    addEventListener(name, listener) {
      const current = listeners.get(name) || new Set();
      current.add(listener);
      listeners.set(name, current);
    },
    removeEventListener(name, listener) {
      listeners.get(name)?.delete(listener);
    },
    dispatch(name) {
      for (const listener of listeners.get(name) || []) listener();
    },
    listenerCount(name) {
      return listeners.get(name)?.size || 0;
    },
  };
};

try {
  const output = path.join(temp, "youtube-segment.mjs");
  await build({
    stdin: {
      contents: `export { YoutubeVideosSegment } from "./src/renderer/components/videos/youtube-videos-segment.tsx";`,
      resolveDir: root,
      loader: "tsx",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
    plugins: [{
      name: "youtube-segment-stubs",
      setup(buildApi) {
        const stubs = {
          react: `
            export const useContext = () => globalThis.__ENJOY_YOUTUBE_CONTEXT__;
            export const useEffect = (effect) => globalThis.__ENJOY_YOUTUBE_EFFECTS__.push(effect);
            export const useState = (initial) => [initial, value => globalThis.__ENJOY_YOUTUBE_STATE_WRITES__.push(value)];
          `,
          "react/jsx-runtime": `
            export const Fragment = "Fragment";
            export const jsx = (type, props) => ({ type, props: props || {} });
            export const jsxs = jsx;
          `,
          "@renderer/context": `export const AppSettingsProviderContext = {};`,
          "react-router-dom": `export const useNavigate = () => () => {};`,
          "@renderer/components/ui": `
            export const Button = "Button";
            export const Dialog = "Dialog";
            export const DialogHeader = "DialogHeader";
            export const DialogTitle = "DialogTitle";
            export const DialogContent = "DialogContent";
            export const DialogFooter = "DialogFooter";
            export const Progress = "Progress";
            export const toast = { error: () => {} };
          `,
          "@renderer/components/enjoy": `export const EjSectionHeader = "EjSectionHeader";`,
          "lucide-react": `export const LoaderIcon = "LoaderIcon";`,
          i18next: `export const t = value => value;`,
        };
        buildApi.onResolve({ filter: /.*/u }, args => (
          Object.hasOwn(stubs, args.path)
            ? { path: args.path, namespace: "youtube-segment-stub" }
            : null
        ));
        buildApi.onLoad({ filter: /.*/u, namespace: "youtube-segment-stub" }, args => ({
          contents: stubs[args.path],
          loader: "js",
        }));
      },
    }],
  });

  const testWindow = makeWindow();
  global.window = testWindow;
  Object.defineProperty(global, "navigator", {
    value: { onLine: false },
    configurable: true,
    writable: true,
  });
  const { YoutubeVideosSegment } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

  const cachedChannel = { name: "Cached", videos: [{ videoId: "cached", title: "Cached video", thumbnail: "local" }] };
  let cachedProviderCalls = 0;
  resetHarness({ EnjoyApp: {
    cacheObjects: { get: async () => cachedChannel, set: async () => {} },
    providers: { youtube: { videos: async () => { cachedProviderCalls += 1; } } },
  } });
  YoutubeVideosSegment({ channel: "@cached" });
  const cleanupCached = global.__ENJOY_YOUTUBE_EFFECTS__[0]();
  await waitFor(() => global.__ENJOY_YOUTUBE_STATE_WRITES__.includes(cachedChannel), "Cached channel was not shown offline");
  assert.equal(cachedProviderCalls, 0);
  assert.equal(typeof cleanupCached, "function");
  assert.equal(testWindow.listenerCount("online"), 1);
  cleanupCached();
  assert.equal(testWindow.listenerCount("online"), 0);

  const onlineResult = { name: "Online", videos: [{ videoId: "online", title: "Online video", thumbnail: "https://i.ytimg.com/fixture.jpg" }] };
  const onlineResponse = deferred();
  const cacheWrites = [];
  let providerCalls = 0;
  resetHarness({ EnjoyApp: {
    cacheObjects: {
      get: async () => null,
      set: async (...args) => { cacheWrites.push(args); },
    },
    providers: { youtube: { videos: async () => { providerCalls += 1; return onlineResponse.promise; } } },
  } });
  YoutubeVideosSegment({ channel: "@retry" });
  const cleanupRetry = global.__ENJOY_YOUTUBE_EFFECTS__[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(providerCalls, 0, "Offline render must not create a YouTube scrape");
  global.navigator.onLine = true;
  testWindow.dispatch("online");
  await waitFor(() => providerCalls === 1, "Online event did not retry the uncached channel");
  onlineResponse.resolve(onlineResult);
  await waitFor(() => global.__ENJOY_YOUTUBE_STATE_WRITES__.includes(onlineResult), "Online result was not displayed");
  assert.equal(cacheWrites.length, 1);
  cleanupRetry();

  const unmountedResponse = deferred();
  let unmountedProviderCalls = 0;
  resetHarness({ EnjoyApp: {
    cacheObjects: { get: async () => null, set: async () => {} },
    providers: { youtube: { videos: async () => { unmountedProviderCalls += 1; return unmountedResponse.promise; } } },
  } });
  YoutubeVideosSegment({ channel: "@unmounted" });
  const cleanupUnmounted = global.__ENJOY_YOUTUBE_EFFECTS__[0]();
  await waitFor(() => unmountedProviderCalls === 1, "Online channel request did not start");
  cleanupUnmounted();
  unmountedResponse.resolve(onlineResult);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(global.__ENJOY_YOUTUBE_STATE_WRITES__, []);
  assert.equal(testWindow.listenerCount("online"), 0);

  console.info("check-youtube-segment-offline: PASS (offline cache, no offline scrape, online retry, unmount guard)");
} finally {
  delete global.__ENJOY_YOUTUBE_EFFECTS__;
  delete global.__ENJOY_YOUTUBE_STATE_WRITES__;
  delete global.__ENJOY_YOUTUBE_CONTEXT__;
  delete global.window;
  delete global.navigator;
  await rm(temp, { recursive: true, force: true });
}
