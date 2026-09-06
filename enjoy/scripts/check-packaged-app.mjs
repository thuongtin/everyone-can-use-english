import assert from "node:assert/strict";
import { access, lstat, readdir } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile, listPackage } from "@electron/asar";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const recursiveNodeModulesPattern = /(?:^|[\\/])node_modules[\\/]node_modules(?:[\\/]|$)/;
const requiredModules = [
  "fs-extra",
  "universalify",
  "sqlite3",
  "sequelize",
  "onnxruntime-node",
];
const dictionaryCases = [
  { direction: "en-vi", word: "learn", expected: "Học" },
  { direction: "vi-en", word: "học", expected: "to study; to learn" },
];
const formatRecursivePaths = (paths) => {
  const preview = paths.slice(0, 20).join(", ");
  return paths.length > 20 ? `${preview}, ... (${paths.length} total)` : preview;
};

const isDirectory = async (candidate) => {
  return (await lstat(candidate)).isDirectory();
};

const isFile = async (candidate) => {
  return (await lstat(candidate)).isFile();
};

const resolveAppBundle = async (input) => {
  const candidate = path.resolve(input);
  const stats = await lstat(candidate);
  if (stats.isDirectory() && candidate.endsWith(".app")) return candidate;

  if (!stats.isDirectory()) {
    throw new Error(`ENJOY_E2E_APP_PATH must point to an app bundle or build directory: ${candidate}`);
  }

  const children = await readdir(candidate, { withFileTypes: true });
  const appBundle = children.find(
    (entry) => entry.isDirectory() && entry.name.endsWith(".app")
  );
  if (!appBundle) {
    throw new Error(`No .app bundle found in ${candidate}`);
  }
  return path.join(candidate, appBundle.name);
};

const walkTree = async (root) => {
  const matches = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(root, fullPath);
      if (recursiveNodeModulesPattern.test(relativePath)) {
        matches.push(relativePath);
      }
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await visit(fullPath);
      }
    }
  };

  await visit(root);
  return matches;
};

const findUnpackedFile = async (root, fileName) => {
  const matches = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.name === fileName && entry.isFile()) matches.push(fullPath);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await visit(fullPath);
      }
    }
  };

  await visit(root);
  return matches;
};

const resolveElectronNode = async () => {
  const candidates = [];
  if (process.env.ENJOY_ELECTRON_NODE_PATH) {
    candidates.push(path.resolve(process.env.ENJOY_ELECTRON_NODE_PATH));
  }

  const requireFromScript = createRequire(import.meta.url);
  try {
    const electronPackage = path.dirname(requireFromScript.resolve("electron/package.json"));
    candidates.push(
      path.join(electronPackage, "dist", "Electron.app", "Contents", "MacOS", "Electron"),
      path.join(electronPackage, "dist", "electron"),
      path.join(electronPackage, "dist", "Electron.exe")
    );
  } catch {
    // The explicit environment path is enough when the package is not local.
  }

  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(
    "Could not find an Electron Node-mode runtime. Set ENJOY_ELECTRON_NODE_PATH."
  );
};

const runElectronProbe = async ({ electronNode, asarPath, dictionaryPaths }) => {
  const probe = String.raw`
const path = require("node:path");
const payload = JSON.parse(process.argv[1]);
const moduleRoot = path.join(payload.asarPath, "node_modules");
const modules = {};

for (const name of payload.requiredModules) {
  const loaded = require(path.join(moduleRoot, name));
  modules[name] = { loaded: true, type: typeof loaded };
}

const fsExtra = require(path.join(moduleRoot, "fs-extra"));
if (typeof fsExtra.pathExistsSync !== "function") {
  throw new Error("fs-extra did not expose pathExistsSync");
}

const universalify = require(path.join(moduleRoot, "universalify"));
if (typeof universalify.fromCallback !== "function") {
  throw new Error("universalify did not expose fromCallback");
}

const sequelize = require(path.join(moduleRoot, "sequelize"));
if (typeof sequelize !== "function") {
  throw new Error("sequelize did not load as a constructor");
}

const ort = require(path.join(moduleRoot, "onnxruntime-node"));
const backends = ort.listSupportedBackends();
if (!Array.isArray(backends) || backends.length === 0) {
  throw new Error("onnxruntime-node did not report a native backend");
}

const sqlite3 = require(path.join(moduleRoot, "sqlite3"));
const query = (databasePath, word) => new Promise((resolve, reject) => {
  let database;
  const fail = (error) => {
    if (database) database.close(() => {});
    reject(error);
  };

  database = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY, (openError) => {
    if (openError) return fail(openError);
    database.get("SELECT word, data FROM entries WHERE word = ?", [word], (error, row) => {
      if (error) return fail(error);
      if (!row) return fail(new Error("Dictionary row was not found: " + word));
      let entries;
      try {
        entries = JSON.parse(row.data);
      } catch (parseError) {
        return fail(parseError);
      }
      if (!Array.isArray(entries) || entries.length === 0) {
        return fail(new Error("Dictionary row has no entries: " + word));
      }
      database.close((closeError) => {
        if (closeError) return reject(closeError);
        resolve({ word: row.word, entries });
      });
    });
  });
});

Promise.all(payload.dictionaryCases.map(async (item) => {
  const result = await query(payload.dictionaryPaths[item.direction], item.word);
  const serialized = JSON.stringify(result.entries);
  if (!serialized.includes(item.expected)) {
    throw new Error("Dictionary meaning mismatch for " + item.direction + ": " + item.word);
  }
  return {
    direction: item.direction,
    word: result.word,
    entryCount: result.entries.length,
    expectedMeaning: item.expected,
  };
})).then((dictionaries) => {
  process.stdout.write(JSON.stringify({ modules, backends, dictionaries }) + "\n");
}).catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
`;

  const child = spawn(electronNode, ["-e", probe, JSON.stringify({
    asarPath,
    dictionaryPaths,
    dictionaryCases,
    requiredModules,
  })], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      ELECTRON_NO_ATTACH_CONSOLE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

  if (result.code !== 0) {
    throw new Error(
      `Electron Node-mode probe failed with code ${result.code ?? "null"}${result.signal ? ` (${result.signal})` : ""}: ${stderr.trim()}`
    );
  }

  const outputLines = stdout.trim().split(/\r?\n/).filter(Boolean);
  const output = outputLines.at(-1);
  if (!output) throw new Error("Electron Node-mode probe returned no JSON output");
  return JSON.parse(output);
};

const inputPath = process.env.ENJOY_E2E_APP_PATH || process.argv[2];
if (!inputPath) {
  throw new Error("Set ENJOY_E2E_APP_PATH to the final .app or build directory");
}

const appBundle = await resolveAppBundle(inputPath);
const resourcesPath = path.join(appBundle, "Contents", "Resources");
const asarPath = path.join(resourcesPath, "app.asar");
const unpackedPath = path.join(resourcesPath, "app.asar.unpacked");
assert.equal(await isFile(asarPath), true, `Missing ASAR: ${asarPath}`);
assert.equal(await isDirectory(unpackedPath), true, `Missing unpacked resources: ${unpackedPath}`);

const asarEntries = listPackage(asarPath);
const asarRecursivePaths = asarEntries.filter((entry) => recursiveNodeModulesPattern.test(entry));
const unpackedRecursivePaths = await walkTree(unpackedPath);
assert.equal(
  asarRecursivePaths.length,
  0,
  `ASAR contains recursive node_modules paths: ${formatRecursivePaths(asarRecursivePaths)}`
);
assert.equal(
  unpackedRecursivePaths.length,
  0,
  `Unpacked resources contain recursive node_modules paths: ${formatRecursivePaths(unpackedRecursivePaths)}`
);

const packageJson = JSON.parse(extractFile(asarPath, "package.json").toString("utf8"));
const missingModules = requiredModules.filter(
  (name) => !asarEntries.includes(`/node_modules/${name}/package.json`)
);
assert.deepEqual(missingModules, [], `Missing modules in ASAR: ${missingModules.join(", ")}`);

const dictionaryPaths = {};
for (const item of dictionaryCases) {
  const matches = await findUnpackedFile(unpackedPath, `${item.direction}.sqlite`);
  assert.equal(
    matches.length,
    1,
    `Expected exactly one unpacked ${item.direction}.sqlite, found ${matches.length}`
  );
  assert.ok(
    matches[0].includes(`${path.sep}dictionaries${path.sep}`),
    `Unpacked ${item.direction}.sqlite is outside a dictionaries directory`
  );
  dictionaryPaths[item.direction] = matches[0];
}

const electronNode = await resolveElectronNode();
const probe = await runElectronProbe({ electronNode, asarPath, dictionaryPaths });
assert.equal(packageJson.name, "enjoy", "Packaged package.json has an unexpected name");

console.info(JSON.stringify({
  verifier: "check-packaged-app",
  appBundle,
  asarPath,
  unpackedPath,
  electronNode,
  recursivePaths: { asar: asarRecursivePaths, unpacked: unpackedRecursivePaths },
  requiredModules: probe.modules,
  nativeBackends: probe.backends,
  dictionaries: probe.dictionaries,
}, null, 2));
console.info("check-packaged-app: PASS");
