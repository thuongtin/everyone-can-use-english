import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-browser-store-check-"));
try {
  const output = path.join(temp, "store.mjs");
  await build({ entryPoints: [path.join(root, "src/main/local-browser-storage.ts")], bundle: true, platform: "node", format: "esm", outfile: output, logLevel: "silent" });
  const { prepareLocalBrowserStorage } = await import(pathToFileURL(output).href);
  await writeFile(path.join(temp, "Cookies"), "legacy-encrypted-cookie-fixture");
  await writeFile(path.join(temp, "settings.json"), '{"library":"unchanged"}');
  const directory = prepareLocalBrowserStorage(temp);
  assert.equal(directory, path.join(temp, "local-browser-v1"));
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal(prepareLocalBrowserStorage(temp), directory);
  assert.equal(await readFile(path.join(temp, "Cookies"), "utf8"), "legacy-encrypted-cookie-fixture");
  assert.equal(await readFile(path.join(temp, "settings.json"), "utf8"), '{"library":"unchanged"}');
  await rm(directory, { recursive: true });
  await symlink(os.tmpdir(), directory);
  assert.throws(() => prepareLocalBrowserStorage(temp), /Invalid local browser storage/);
  console.info("check-local-browser-storage: PASS (fresh namespace, legacy store intact, private permissions, symlink rejected; packaged Keychain still needs runtime verification)");
} finally { await rm(temp, { recursive: true, force: true }); }
