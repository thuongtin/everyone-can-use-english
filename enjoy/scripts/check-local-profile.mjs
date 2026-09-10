import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-local-profile-"));
const require = createRequire(import.meta.url);

const virtualModulePlugin = (modules) => ({
  name: "local-profile-test-modules",
  setup(builder) {
    for (const [specifier, contents] of Object.entries(modules)) {
      const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      builder.onResolve({ filter: new RegExp(`^${escaped}$`) }, () => ({
        path: specifier,
        namespace: "local-profile-test",
      }));
      builder.onLoad({ filter: /.*/, namespace: "local-profile-test" }, (args) =>
        args.path === specifier ? { contents, loader: "ts" } : null
      );
    }
  },
});

try {
  const output = path.join(temp, "local-profile.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src/main/local-profile.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });
  const localProfile = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

  assert.deepEqual(localProfile.normalizeLocalProfile({ id: "12345678", name: "Previous user" }), {
    id: "12345678",
    name: "Previous user",
  });
  assert.deepEqual(localProfile.normalizeLocalProfile({ id: "local" }), {
    id: "local",
    name: "Local",
  });
  assert.equal(localProfile.normalizeLocalProfile({ id: "../escape" }), null);
  assert.equal(localProfile.LOCAL_PROFILE_MODE, true);
  assert.deepEqual(localProfile.resolveInitialLocalProfile(null, []), {
    id: "local",
    name: "Local",
    nameSource: "default",
  });
  assert.deepEqual(
    localProfile.resolveProfileForLibrary(
      { id: "12345678", name: "Renamed" },
      [{ id: "12345678", name: "Local" }],
    ),
    { id: "12345678", name: "Renamed" },
  );
  assert.deepEqual(
    localProfile.resolveProfileForLibrary(
      { id: "missing", name: "Old library" },
      [{ id: "12345678", name: "Local" }],
    ),
    { id: "12345678", name: "Local" },
  );
  assert.deepEqual(
    localProfile.resolveProfileForLibrary(
      { id: "missing", name: "Old library" },
      [],
    ),
    { id: "local", name: "Local", nameSource: "default" },
  );
  assert.deepEqual(
    localProfile.resolveInitialLocalProfile(null, [{ id: "12345678", name: "Local" }]),
    { id: "12345678", name: "Local" },
  );
  assert.equal(
    localProfile.resolveInitialLocalProfile(null, [
      { id: "12345678", name: "Local" },
      { id: "87654321", name: "Local" },
    ]),
    null,
  );

  const library = path.join(temp, "EnjoyLibrary");
  await mkdir(path.join(library, "12345678"), { recursive: true });
  await mkdir(path.join(library, "local"), { recursive: true });
  await mkdir(path.join(library, "unrelated"), { recursive: true });
  await writeFile(path.join(library, "12345678", "enjoy_database.sqlite"), "old-profile");
  await writeFile(path.join(library, "local", "enjoy_database_dev.sqlite"), "new-profile");

  assert.deepEqual(
    localProfile.discoverLocalProfiles(library, ["enjoy_database.sqlite", "enjoy_database_dev.sqlite"]),
    [
      { id: "12345678", name: "Local", nameSource: "discovered" },
      { id: "local", name: "Local", nameSource: "discovered" },
    ],
  );

  const settings = path.join(temp, "settings.json");
  await writeFile(settings, '{"user":{"id":"12345678"}}');
  await chmod(settings, 0o644);
  const settingsBackup = localProfile.backupSettingsFile(settings);
  assert.ok(settingsBackup);
  assert.equal(await readFile(settingsBackup, "utf8"), '{"user":{"id":"12345678"}}');
  assert.equal((await stat(settingsBackup)).mode & 0o777, 0o600);

  await writeFile(path.join(library, "12345678", "enjoy_database.sqlite-wal"), "pending-wal");
  await writeFile(path.join(library, "12345678", "enjoy_database_dev.sqlite"), "development-profile");
  const profileBackup = localProfile.backupDisconnectedProfile(
    library,
    "12345678",
    ["enjoy_database.sqlite", "enjoy_database_dev.sqlite"],
  );
  assert.ok(profileBackup);
  assert.equal(await readFile(path.join(profileBackup, "enjoy_database.sqlite"), "utf8"), "old-profile");
  assert.equal(await readFile(path.join(profileBackup, "enjoy_database.sqlite-wal"), "utf8"), "pending-wal");
  assert.equal(await readFile(path.join(profileBackup, "enjoy_database_dev.sqlite"), "utf8"), "development-profile");
  assert.equal((await stat(profileBackup)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(profileBackup, "enjoy_database.sqlite"))).mode & 0o777, 0o600);
  assert.equal((await stat(path.join(profileBackup, "enjoy_database.sqlite-wal"))).mode & 0o777, 0o600);

  const oldLibrary = path.join(temp, "old", "EnjoyLibrary");
  const targetLibrary = path.join(temp, "target", "EnjoyLibrary");
  const failedLibrary = path.join(temp, "failed", "EnjoyLibrary");
  const chooserLibrary = path.join(temp, "chooser", "EnjoyLibrary");
  const settingsFile = path.join(temp, "settings-handler.json");
  await mkdir(path.join(oldLibrary, "old-profile"), { recursive: true });
  await mkdir(path.join(targetLibrary, "target-profile"), { recursive: true });
  await mkdir(path.join(failedLibrary, "failed-profile"), { recursive: true });
  await mkdir(path.join(chooserLibrary, "profile-a"), { recursive: true });
  await mkdir(path.join(chooserLibrary, "profile-b"), { recursive: true });
  await writeFile(path.join(oldLibrary, "old-profile", "enjoy_database.sqlite"), "old");
  await writeFile(path.join(targetLibrary, "target-profile", "enjoy_database.sqlite"), "target");
  await writeFile(path.join(failedLibrary, "failed-profile", "enjoy_database.sqlite"), "failed");
  await writeFile(path.join(chooserLibrary, "profile-a", "enjoy_database.sqlite"), "a");
  await writeFile(path.join(chooserLibrary, "profile-b", "enjoy_database.sqlite"), "b");
  await writeFile(settingsFile, "settings");

  global.__settingsState = {
    library: oldLibrary,
    user: { id: "missing-profile", name: "Stale pointer" },
    retained: { key: "value" },
  };
  global.__settingsWrites = [];
  global.__failOnSettingsWrite = null;
  global.__settingsHandlers = new Map();
  global.__dbCalls = [];
  global.__failNextConnect = false;

  const settingsOutput = path.join(temp, "settings.cjs");
  await build({
    entryPoints: [path.join(projectRoot, "src/main/settings.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: settingsOutput,
    logLevel: "silent",
    plugins: [virtualModulePlugin({
      "electron-settings": `
        const api = {
          configure() {},
          getSync(key) {
            if (key === undefined) return structuredClone(globalThis.__settingsState);
            return key.split(".").reduce((value, part) => value?.[part], globalThis.__settingsState);
          },
          setSync(...args) {
            globalThis.__settingsWrites.push(args);
            if (globalThis.__failOnSettingsWrite === globalThis.__settingsWrites.length) {
              throw new Error("settings mutation failed");
            }
            if (args.length === 1) globalThis.__settingsState = structuredClone(args[0]);
            else globalThis.__settingsState[args[0]] = structuredClone(args[1]);
          },
          unsetSync(key) { delete globalThis.__settingsState[key]; },
          file() { return ${JSON.stringify(settingsFile)}; },
        };
        export default api;
      `,
      electron: `
        export const ipcMain = { handle(name, callback) { globalThis.__settingsHandlers.set(name, callback); } };
        export const app = { isPackaged: true, getPath() { return ${JSON.stringify(temp)}; } };
      `,
      "@/constants": `
        export const LIBRARY_PATH_SUFFIX = "EnjoyLibrary";
        export const DATABASE_NAME = "enjoy_database";
        export const WEB_API_URL = "https://cloud.invalid";
      `,
      "@/types/enums": `export const AppSettingsKeyEnum = {
        LIBRARY: "library", USER: "user", API_URL: "apiUrl"
      };`,
      "@main/db": `
        const db = {
          async withDisconnected(change) { globalThis.__dbCalls.push("disconnect"); await change(); },
          async connect() {
            globalThis.__dbCalls.push("connect");
            if (globalThis.__failNextConnect) {
              globalThis.__failNextConnect = false;
              throw new Error("target database failed");
            }
          },
        };
        export default db;
      `,
    })],
  });
  const appSettings = require(settingsOutput).default;
  appSettings.registerIpcHandlers();
  const getUser = global.__settingsHandlers.get("app-settings-get-user");
  const setLibrary = global.__settingsHandlers.get("app-settings-set-library");
  assert.deepEqual(getUser(), {
    id: "old-profile",
    name: "Local",
    nameSource: "discovered",
  });
  assert.deepEqual(global.__settingsState.user, {
    id: "old-profile",
    name: "Local",
    nameSource: "discovered",
  });
  assert.equal(typeof setLibrary, "function");

  await setLibrary(null, targetLibrary);
  assert.equal(global.__settingsState.library, targetLibrary);
  assert.deepEqual(global.__settingsState.user, {
    id: "target-profile",
    name: "Local",
    nameSource: "discovered",
  });
  assert.equal(global.__settingsWrites.at(-1).length, 1);
  assert.deepEqual(global.__dbCalls, ["disconnect", "connect"]);

  global.__failNextConnect = true;
  await assert.rejects(() => setLibrary(null, failedLibrary), /target database failed/);
  assert.equal(global.__settingsState.library, targetLibrary);
  assert.deepEqual(global.__settingsState.user, {
    id: "target-profile",
    name: "Local",
    nameSource: "discovered",
  });
  assert.deepEqual(global.__dbCalls.slice(-4), ["disconnect", "connect", "disconnect", "connect"]);

  const writesBeforeMutationFailure = global.__settingsWrites.length;
  global.__failOnSettingsWrite = writesBeforeMutationFailure + 1;
  await assert.rejects(() => setLibrary(null, failedLibrary), /settings mutation failed/);
  assert.equal(global.__settingsState.library, targetLibrary);
  assert.deepEqual(global.__settingsState.user, {
    id: "target-profile",
    name: "Local",
    nameSource: "discovered",
  });
  assert.deepEqual(global.__settingsState.retained, { key: "value" });
  assert.equal(global.__dbCalls.at(-1), "connect");

  global.__failOnSettingsWrite = null;
  const dbCallsBeforeChooser = global.__dbCalls.length;
  await setLibrary(null, chooserLibrary);
  assert.equal(global.__settingsState.library, chooserLibrary);
  assert.equal(Object.hasOwn(global.__settingsState, "user"), false);
  assert.deepEqual(global.__settingsState.retained, { key: "value" });
  assert.deepEqual(global.__dbCalls.slice(dbCallsBeforeChooser), ["disconnect"]);

  console.info("check-local-profile: PASS (identity, discovery, complete backups, library rollback)");
} finally {
  delete global.__settingsState;
  delete global.__settingsHandlers;
  delete global.__settingsWrites;
  delete global.__failOnSettingsWrite;
  delete global.__dbCalls;
  delete global.__failNextConnect;
  await rm(temp, { recursive: true, force: true });
}
