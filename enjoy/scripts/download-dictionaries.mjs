#!/usr/bin/env node
// Prepare the pinned, bundled dictionaries without a network dependency.
import { readFile, mkdir, writeFile, rename, copyFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const source = path.resolve(import.meta.dirname, "../dictionaries");
const destination = path.resolve(import.meta.dirname, "../lib/dictionaries");
const manifest = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8"));
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
await mkdir(destination, { recursive: true });
for (const dictionary of manifest.dictionaries) {
  const archive = await readFile(path.join(source, dictionary.file));
  if (hash(archive) !== dictionary.sha256) throw new Error(`Dictionary archive checksum mismatch: ${dictionary.direction}`);
  const target = path.join(destination, `${dictionary.direction}.sqlite`);
  const existing = await readFile(target).catch(() => null);
  if (!existing || hash(existing) !== dictionary.databaseSha256) {
    const database = gunzipSync(archive);
    if (hash(database) !== dictionary.databaseSha256) throw new Error(`Dictionary database checksum mismatch: ${dictionary.direction}`);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, database);
    await rename(temporary, target);
  }
  console.info(`Dictionary ready: ${dictionary.direction} (${dictionary.words} headwords)`);
}
for (const file of ["manifest.json", "NOTICE.md", "LICENSE-CC-BY-SA-4.0.txt", "editorial-corrections.json"]) {
  await copyFile(path.join(source, file), path.join(destination, file));
}
