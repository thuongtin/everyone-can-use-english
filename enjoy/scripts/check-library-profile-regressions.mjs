import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-library-profile-regressions-"));

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const findElement = (value, predicate) => {
  if (!value || typeof value !== "object") return null;
  if (predicate(value)) return value;
  const children = value.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
};

const uiStubs = {
  react: `
    export const createContext = () => ({ Provider: "ContextProvider" });
    export const forwardRef = (render) => {
      const Component = (props) => render(props, null);
      Component.displayName = "ForwardRef";
      return Component;
    };
    export const useContext = () => globalThis.__ENJOY_TEST_CONTEXT__;
    export const useEffect = () => {};
    export const useRef = (initial) => ({ current: initial });
    export const useState = (initial) => {
      const index = globalThis.__ENJOY_TEST_STATE_INDEX__++;
      const value = index === 1 && globalThis.__ENJOY_TEST_USER_OVERRIDE__ !== undefined
        ? globalThis.__ENJOY_TEST_USER_OVERRIDE__
        : initial;
      return [value, (next) => globalThis.__ENJOY_TEST_STATE_WRITES__.push(next)];
    };
  `,
  "react/jsx-runtime": `
    export const Fragment = "Fragment";
    export const jsx = (type, props) => typeof type === "function"
      ? type(props || {})
      : ({ type, props: props || {} });
    export const jsxs = jsx;
  `,
  "@renderer/components/ui": `
    export const Button = "Button";
    export const Dialog = "Dialog";
    export const DialogClose = "DialogClose";
    export const DialogContent = "DialogContent";
    export const DialogDescription = "DialogDescription";
    export const DialogFooter = "DialogFooter";
    export const DialogHeader = "DialogHeader";
    export const DialogTitle = "DialogTitle";
  `,
  "@renderer/context": `
    export const AppSettingsProviderContext = {};
    export const DbProviderContext = {};
  `,
  "@renderer/lib/utils": `
    export const cn = (...values) => values.filter(Boolean).join(" ");
  `,
  "@/constants/ui-language": `export const resolveUiLanguage = (value) => value || "vi";`,
  "@/constants": `
    export const DISTRIBUTION_CONFIG = {};
    export const WEB_API_URL = "http://localhost";
    export const LANGUAGES = [];
    export const IPA_MAPPINGS = {};
    export const LIBRARY_PATH_SUFFIX = "EnjoyLibrary";
  `,
  "@/constants/distribution": `export {};`,
  "@/api": `export class Client {}`,
  "@renderer/i18n": `export default { changeLanguage: () => {} };`,
  "ahoy.js": `export default { configure: () => {} };`,
  "@rails/actioncable": `export {};`,
  "@/types/enums": `export const UserSettingKeyEnum = { PROFILE: "profile" };`,
  "@renderer/components": `export const Deposit = "Deposit";`,
  sonner: `export const toast = { error: (...args) => globalThis.__ENJOY_TEST_TOASTS__.push(args) };`,
  i18next: `export const t = (key) => key;`,
  "lucide-react": `
    export const CheckIcon = "CheckIcon";
    export const ChevronDownIcon = "ChevronDownIcon";
    export const ExternalLinkIcon = "ExternalLinkIcon";
    export const EyeIcon = "EyeIcon";
    export const EyeOffIcon = "EyeOffIcon";
    export const FolderIcon = "FolderIcon";
    export const InfoIcon = "InfoIcon";
  `,
};

try {
  const output = path.join(temp, "regressions.mjs");
  await build({
    stdin: {
      contents: `
        export { LibrarySettings } from "./src/renderer/components/preferences/library-settings.tsx";
        export { AppSettingsProvider } from "./src/renderer/context/app-settings-provider.tsx";
        export { syncDbSession } from "./src/renderer/lib/db-session-sync.ts";
      `,
      resolveDir: root,
      loader: "tsx",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
    plugins: [
      {
        name: "renderer-test-stubs",
        setup(buildApi) {
          buildApi.onResolve({ filter: /.*/ }, (args) => {
            if (Object.hasOwn(uiStubs, args.path)) {
              return { path: args.path, namespace: "renderer-test-stub" };
            }
            return null;
          });
          buildApi.onLoad({ filter: /.*/, namespace: "renderer-test-stub" }, (args) => ({
            contents: uiStubs[args.path],
            loader: "js",
          }));
        },
      },
    ],
  });

  const settingsWriteError = new Error("settings write failed");
  global.__ENJOY_TEST_FAIL_SETTINGS_WRITE__ = true;
  global.__ENJOY_TEST_PROFILE_WRITES__ = [];
  global.__ENJOY_TEST_STATE_INDEX__ = 0;
  global.__ENJOY_TEST_STATE_WRITES__ = [];
  global.__ENJOY_TEST_USER_OVERRIDE__ = undefined;
  global.__ENJOY_TEST_UNREGISTER_PROFILE_AFTER_POINTER__ = false;
  global.__ENJOY_TEST_PROFILE_HANDLER_AVAILABLE__ = true;
  global.window = {
    __ENJOY_APP__: {
      appSettings: {
        setUser: async () => {
          if (global.__ENJOY_TEST_FAIL_SETTINGS_WRITE__) throw settingsWriteError;
          if (global.__ENJOY_TEST_UNREGISTER_PROFILE_AFTER_POINTER__) {
            global.__ENJOY_TEST_PROFILE_HANDLER_AVAILABLE__ = false;
          }
        },
      },
      userSettings: {
        set: async (key, value) => {
          if (!global.__ENJOY_TEST_PROFILE_HANDLER_AVAILABLE__) {
            throw new Error("No handler registered for user-settings-set");
          }
          global.__ENJOY_TEST_PROFILE_WRITES__.push({ key, value });
        },
      },
    },
  };
  global.__ENJOY_TEST_TOASTS__ = [];

  const { AppSettingsProvider, LibrarySettings, syncDbSession } = await import(
    `${pathToFileURL(output).href}?test=${Date.now()}`
  );

  global.__ENJOY_TEST_CONTEXT__ = {
    state: "connected",
    connect: async () => {},
    disconnect: async () => {},
  };
  global.__ENJOY_TEST_STATE_INDEX__ = 0;
  const providerTree = AppSettingsProvider({ children: null });
  await assert.rejects(
    providerTree.props.value.login({ id: "user-1", name: "Renamed profile" }),
    settingsWriteError
  );
  assert.equal(global.__ENJOY_TEST_TOASTS__.length, 1);

  global.__ENJOY_TEST_FAIL_SETTINGS_WRITE__ = false;
  global.__ENJOY_TEST_STATE_INDEX__ = 0;
  global.__ENJOY_TEST_USER_OVERRIDE__ = { id: "user-1", name: "Before" };
  const renamedProviderTree = AppSettingsProvider({ children: null });
  await renamedProviderTree.props.value.login({ id: "user-1", name: "Local" });
  assert.deepEqual(global.__ENJOY_TEST_PROFILE_WRITES__, [{
    key: "profile",
    value: { id: "user-1", name: "Local", nameSource: "explicit" },
  }]);

  global.__ENJOY_TEST_PROFILE_WRITES__ = [];
  global.__ENJOY_TEST_STATE_WRITES__ = [];
  global.__ENJOY_TEST_STATE_INDEX__ = 0;
  global.__ENJOY_TEST_USER_OVERRIDE__ = null;
  global.__ENJOY_TEST_UNREGISTER_PROFILE_AFTER_POINTER__ = true;
  global.__ENJOY_TEST_PROFILE_HANDLER_AVAILABLE__ = true;
  const chooserProviderTree = AppSettingsProvider({ children: null });
  await chooserProviderTree.props.value.login({ id: "chosen-profile", name: "Alice" });
  assert.deepEqual(global.__ENJOY_TEST_PROFILE_WRITES__, []);
  assert.ok(global.__ENJOY_TEST_STATE_WRITES__.some((value) =>
    value?.id === "chosen-profile" && value?.name === "Alice"
  ));

  const successfulSwitchEvents = [];
  global.__ENJOY_TEST_CONTEXT__ = {
    state: "connected",
    connect: async () => successfulSwitchEvents.push("reconnect-old"),
    disconnect: async () => successfulSwitchEvents.push("disconnect-old"),
  };
  global.__ENJOY_TEST_PROFILE_WRITES__ = [];
  global.__ENJOY_TEST_STATE_WRITES__ = [];
  global.__ENJOY_TEST_STATE_INDEX__ = 0;
  global.__ENJOY_TEST_USER_OVERRIDE__ = { id: "old-profile", name: "Old" };
  global.__ENJOY_TEST_PROFILE_HANDLER_AVAILABLE__ = true;
  const switchProviderTree = AppSettingsProvider({ children: null });
  await switchProviderTree.props.value.login({ id: "new-profile", name: "New" });
  assert.deepEqual(successfulSwitchEvents, ["disconnect-old"]);
  assert.deepEqual(global.__ENJOY_TEST_PROFILE_WRITES__, []);
  assert.ok(global.__ENJOY_TEST_STATE_WRITES__.some((value) =>
    value?.id === "new-profile" && value?.name === "New"
  ));

  const switchEvents = [];
  global.__ENJOY_TEST_CONTEXT__ = {
    state: "connected",
    connect: async () => switchEvents.push("reconnect-old"),
    disconnect: async () => switchEvents.push("disconnect-old"),
  };
  global.__ENJOY_TEST_FAIL_SETTINGS_WRITE__ = true;
  global.__ENJOY_TEST_UNREGISTER_PROFILE_AFTER_POINTER__ = false;
  global.__ENJOY_TEST_PROFILE_HANDLER_AVAILABLE__ = true;
  global.__ENJOY_TEST_STATE_INDEX__ = 0;
  global.__ENJOY_TEST_USER_OVERRIDE__ = { id: "old-profile", name: "Old" };
  const failedSwitchTree = AppSettingsProvider({ children: null });
  await assert.rejects(
    failedSwitchTree.props.value.login({ id: "new-profile", name: "New" }),
    settingsWriteError,
  );
  assert.deepEqual(switchEvents, ["disconnect-old", "reconnect-old"]);

  global.__ENJOY_TEST_FAIL_SETTINGS_WRITE__ = false;
  global.__ENJOY_TEST_UNREGISTER_PROFILE_AFTER_POINTER__ = false;
  global.__ENJOY_TEST_USER_OVERRIDE__ = undefined;

  const libraryChange = deferred();
  const events = [];
  global.__ENJOY_TEST_CONTEXT__ = {
    libraryPath: "/old/EnjoyLibrary",
    setLibraryPath: async (nextPath) => {
      events.push(`provider:${nextPath}`);
      await libraryChange.promise;
      events.push("provider:done");
    },
    EnjoyApp: {
      dialog: { showOpenDialog: async () => ["/new"] },
      appSettings: {
        setLibrary: () => {
          throw new Error("LibrarySettings bypassed the AppSettings handler");
        },
        getLibrary: async () => {
          events.push("read-library");
          return "/new/EnjoyLibrary";
        },
      },
      app: { relaunch: () => events.push("relaunch") },
      shell: { openPath: () => {} },
    },
  };

  const tree = LibrarySettings();
  const editButton = findElement(
    tree,
    (element) => element.type === "button" && element.props?.children === "settings.change"
  );
  assert.ok(editButton, "The edit library button should be rendered");
  const chooseLibrary = editButton.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["provider:/new"]);
  libraryChange.resolve();
  await chooseLibrary;
  assert.deepEqual(events, [
    "provider:/new",
    "provider:done",
    "read-library",
    "relaunch",
  ]);

  const appliedProfiles = [];
  const result = await syncDbSession(
    { id: "user-1", name: "Renamed profile" },
    {
      connect: async () => ({
        kind: "connected",
        connection: { state: "connected" },
        userId: "user-1",
      }),
      isActive: () => true,
      getLocalProfile: async () => ({ id: "user-1", name: "Old profile" }),
      applyLocalProfile: async (profile) => appliedProfiles.push(profile),
    }
  );

  assert.deepEqual(result, { kind: "synced" });
  assert.deepEqual(appliedProfiles, [{ id: "user-1", name: "Renamed profile" }]);

  const recoveredProfiles = [];
  await syncDbSession(
    { id: "orphan-1", name: "Local", nameSource: "discovered" },
    {
      connect: async () => ({
        kind: "connected",
        connection: { state: "connected" },
        userId: "orphan-1",
      }),
      isActive: () => true,
      getLocalProfile: async () => ({ id: "orphan-1", name: "Alice" }),
      applyLocalProfile: async (profile) => recoveredProfiles.push(profile),
    }
  );
  assert.deepEqual(recoveredProfiles, [
    { id: "orphan-1", name: "Alice", nameSource: "database" },
  ]);

  const explicitlyNamedLocal = [];
  await syncDbSession(
    { id: "explicit-local", name: "Local", nameSource: "explicit" },
    {
      connect: async () => ({
        kind: "connected",
        connection: { state: "connected" },
        userId: "explicit-local",
      }),
      isActive: () => true,
      getLocalProfile: async () => ({ id: "explicit-local", name: "Alice" }),
      applyLocalProfile: async (profile) => explicitlyNamedLocal.push(profile),
    }
  );
  assert.deepEqual(explicitlyNamedLocal, [
    { id: "explicit-local", name: "Local", nameSource: "explicit" },
  ]);

  console.info("check-library-profile-regressions: PASS (profile errors, library await, explicit and recovered names)");
} finally {
  delete global.__ENJOY_TEST_CONTEXT__;
  delete global.__ENJOY_TEST_TOASTS__;
  delete global.__ENJOY_TEST_FAIL_SETTINGS_WRITE__;
  delete global.__ENJOY_TEST_PROFILE_WRITES__;
  delete global.__ENJOY_TEST_STATE_INDEX__;
  delete global.__ENJOY_TEST_STATE_WRITES__;
  delete global.__ENJOY_TEST_USER_OVERRIDE__;
  delete global.__ENJOY_TEST_UNREGISTER_PROFILE_AFTER_POINTER__;
  delete global.__ENJOY_TEST_PROFILE_HANDLER_AVAILABLE__;
  delete global.window;
  await rm(temp, { recursive: true, force: true });
}
