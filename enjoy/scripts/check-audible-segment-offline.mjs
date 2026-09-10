import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-audible-segment-offline-"));

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

const testWindow = (() => {
  const listeners = new Map();
  return {
    addEventListener(name, listener) {
      const current = listeners.get(name) || new Set();
      current.add(listener);
      listeners.set(name, current);
    },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    dispatch(name) { for (const listener of listeners.get(name) || []) listener(); },
    listenerCount(name) { return listeners.get(name)?.size || 0; },
  };
})();

const resetHarness = context => {
  global.__ENJOY_AUDIBLE_EFFECTS__ = [];
  global.__ENJOY_AUDIBLE_STATE_WRITES__ = [];
  global.__ENJOY_AUDIBLE_CONTEXT__ = context;
};

try {
  const output = path.join(temp, "audible-segment.mjs");
  await build({
    stdin: {
      contents: `export { AudibleBooksSegment } from "./src/renderer/components/audios/audible-books-segment.tsx";`,
      resolveDir: root,
      loader: "tsx",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
    plugins: [{
      name: "audible-segment-stubs",
      setup(buildApi) {
        const stubs = {
          react: `
            export const useContext = () => globalThis.__ENJOY_AUDIBLE_CONTEXT__;
            export const useEffect = effect => globalThis.__ENJOY_AUDIBLE_EFFECTS__.push(effect);
            export const useState = initial => [initial, value => globalThis.__ENJOY_AUDIBLE_STATE_WRITES__.push(value)];
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
          `,
          "@renderer/components/enjoy": `export const EjSectionHeader = "EjSectionHeader";`,
          "@vidstack/react": `export const MediaPlayer = "MediaPlayer"; export const MediaProvider = "MediaProvider";`,
          "@vidstack/react/player/layouts/default": `
            export const DefaultAudioLayout = "DefaultAudioLayout";
            export const defaultLayoutIcons = {};
          `,
          "lucide-react": `export const LoaderIcon = "LoaderIcon";`,
          i18next: `export const t = value => value;`,
        };
        buildApi.onResolve({ filter: /.*/u }, args => Object.hasOwn(stubs, args.path)
          ? { path: args.path, namespace: "audible-segment-stub" }
          : null);
        buildApi.onLoad({ filter: /.*/u, namespace: "audible-segment-stub" }, args => ({
          contents: stubs[args.path],
          loader: "js",
        }));
      },
    }],
  });

  global.window = testWindow;
  Object.defineProperty(global, "navigator", {
    value: { onLine: false },
    configurable: true,
    writable: true,
  });
  const { AudibleBooksSegment } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

  const cachedBooks = [{ title: "Cached", language: "English" }];
  let cachedProviderCalls = 0;
  resetHarness({ EnjoyApp: {
    cacheObjects: { get: async () => cachedBooks, set: async () => {} },
    providers: { audible: { bestsellers: async () => { cachedProviderCalls += 1; } } },
  } });
  AudibleBooksSegment();
  const cleanupCached = global.__ENJOY_AUDIBLE_EFFECTS__[0]();
  await waitFor(() => global.__ENJOY_AUDIBLE_STATE_WRITES__.includes(cachedBooks), "Cached books were not shown offline");
  assert.equal(cachedProviderCalls, 0);
  assert.equal(typeof cleanupCached, "function");
  cleanupCached();
  assert.equal(testWindow.listenerCount("online"), 0);

  const onlineBooks = [
    { title: "English", language: "English" },
    { title: "Vietnamese", language: "Vietnamese" },
  ];
  const response = deferred();
  const cacheWrites = [];
  let providerCalls = 0;
  resetHarness({ EnjoyApp: {
    cacheObjects: { get: async () => null, set: async (...args) => { cacheWrites.push(args); } },
    providers: { audible: { bestsellers: async () => { providerCalls += 1; return response.promise; } } },
  } });
  AudibleBooksSegment();
  const cleanupRetry = global.__ENJOY_AUDIBLE_EFFECTS__[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(providerCalls, 0, "Offline render must not create an Audible scrape");
  global.navigator.onLine = true;
  testWindow.dispatch("online");
  await waitFor(() => providerCalls === 1, "Online event did not retry Audible");
  response.resolve({ books: onlineBooks });
  await waitFor(() => global.__ENJOY_AUDIBLE_STATE_WRITES__.some(value => value?.[0]?.title === "English"), "English books were not displayed");
  assert.deepEqual(global.__ENJOY_AUDIBLE_STATE_WRITES__.at(-1), [onlineBooks[0]]);
  assert.equal(cacheWrites.length, 1);
  cleanupRetry();

  const unmountedResponse = deferred();
  let unmountedCalls = 0;
  resetHarness({ EnjoyApp: {
    cacheObjects: { get: async () => null, set: async () => {} },
    providers: { audible: { bestsellers: async () => { unmountedCalls += 1; return unmountedResponse.promise; } } },
  } });
  AudibleBooksSegment();
  const cleanupUnmounted = global.__ENJOY_AUDIBLE_EFFECTS__[0]();
  await waitFor(() => unmountedCalls === 1, "Online Audible request did not start");
  cleanupUnmounted();
  unmountedResponse.resolve({ books: onlineBooks });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(global.__ENJOY_AUDIBLE_STATE_WRITES__, []);
  assert.equal(testWindow.listenerCount("online"), 0);

  console.info("check-audible-segment-offline: PASS (offline cache, no scrape, online retry, unmount guard)");
} finally {
  delete global.__ENJOY_AUDIBLE_EFFECTS__;
  delete global.__ENJOY_AUDIBLE_STATE_WRITES__;
  delete global.__ENJOY_AUDIBLE_CONTEXT__;
  delete global.window;
  delete global.navigator;
  await rm(temp, { recursive: true, force: true });
}
