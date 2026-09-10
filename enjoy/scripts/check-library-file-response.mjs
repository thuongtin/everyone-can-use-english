import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "library-file-response-"));

async function bytes(response) {
  return Buffer.from(await response.arrayBuffer());
}

try {
  const output = path.join(temporaryDirectory, "library-file-response.cjs");
  await build({
    entryPoints: [path.join(root, "src/main/library-file-response.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: output,
    logLevel: "silent",
  });
  const { serveLibraryFile } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

  const payload = Buffer.from(Array.from({ length: 128 }, (_, index) => index));
  const mediaPath = path.join(temporaryDirectory, "sample.mp3");
  const emptyPath = path.join(temporaryDirectory, "empty.bin");
  const unknownPath = path.join(temporaryDirectory, "sample.unknown-extension");
  await Promise.all([
    writeFile(mediaPath, payload),
    writeFile(emptyPath, Buffer.alloc(0)),
    writeFile(unknownPath, payload.subarray(0, 5)),
  ]);

  const full = await serveLibraryFile(new Request("https://library.invalid/media"), mediaPath);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("Accept-Ranges"), "bytes");
  assert.equal(full.headers.get("Content-Length"), String(payload.length));
  assert.equal(full.headers.get("Content-Type"), "audio/mpeg");
  assert.equal(full.headers.get("Content-Range"), null);
  assert.deepEqual(await bytes(full), payload);

  const closed = await serveLibraryFile(new Request("https://library.invalid/media", {
    headers: { Range: "bytes=44-59" },
  }), mediaPath);
  assert.equal(closed.status, 206);
  assert.equal(closed.headers.get("Content-Range"), "bytes 44-59/128");
  assert.equal(closed.headers.get("Content-Length"), "16");
  assert.deepEqual(await bytes(closed), payload.subarray(44, 60));

  const open = await serveLibraryFile(new Request("https://library.invalid/media", {
    headers: { Range: "bytes=120-" },
  }), mediaPath);
  assert.equal(open.status, 206);
  assert.equal(open.headers.get("Content-Range"), "bytes 120-127/128");
  assert.deepEqual(await bytes(open), payload.subarray(120));

  const suffix = await serveLibraryFile(new Request("https://library.invalid/media", {
    headers: { Range: "bytes=-8" },
  }), mediaPath);
  assert.equal(suffix.status, 206);
  assert.equal(suffix.headers.get("Content-Range"), "bytes 120-127/128");
  assert.deepEqual(await bytes(suffix), payload.subarray(120));

  const clamped = await serveLibraryFile(new Request("https://library.invalid/media", {
    headers: { Range: "bytes=120-999" },
  }), mediaPath);
  assert.equal(clamped.status, 206);
  assert.equal(clamped.headers.get("Content-Range"), "bytes 120-127/128");
  assert.deepEqual(await bytes(clamped), payload.subarray(120));

  for (const range of [
    "bytes=", "bytes=9-2", "bytes=128-", "bytes=-0", "bytes=0-1,2-3",
    "items=0-1", "bytes=abc-def", "bytes=999999999999999999999999-",
  ]) {
    const invalid = await serveLibraryFile(new Request("https://library.invalid/media", {
      headers: { Range: range },
    }), mediaPath);
    assert.equal(invalid.status, 416, range);
    assert.equal(invalid.headers.get("Accept-Ranges"), "bytes");
    assert.equal(invalid.headers.get("Content-Range"), "bytes */128");
    assert.equal(invalid.headers.get("Content-Length"), "0");
    assert.equal((await bytes(invalid)).length, 0);
  }

  const fullHead = await serveLibraryFile(new Request("https://library.invalid/media", { method: "HEAD" }), mediaPath);
  assert.equal(fullHead.status, 200);
  assert.equal(fullHead.headers.get("Content-Length"), "128");
  assert.equal((await bytes(fullHead)).length, 0);

  const rangeHead = await serveLibraryFile(new Request("https://library.invalid/media", {
    method: "HEAD",
    headers: { Range: "bytes=44-59" },
  }), mediaPath);
  assert.equal(rangeHead.status, 206);
  assert.equal(rangeHead.headers.get("Content-Range"), "bytes 44-59/128");
  assert.equal(rangeHead.headers.get("Content-Length"), "16");
  assert.equal((await bytes(rangeHead)).length, 0);

  const empty = await serveLibraryFile(new Request("https://library.invalid/empty"), emptyPath);
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.get("Content-Length"), "0");
  assert.equal((await bytes(empty)).length, 0);
  const emptyRange = await serveLibraryFile(new Request("https://library.invalid/empty", {
    headers: { Range: "bytes=0-" },
  }), emptyPath);
  assert.equal(emptyRange.status, 416);
  assert.equal(emptyRange.headers.get("Content-Range"), "bytes */0");

  const unknown = await serveLibraryFile(new Request("https://library.invalid/unknown"), unknownPath);
  assert.equal(unknown.headers.get("Content-Type"), "application/octet-stream");
  assert.deepEqual(await bytes(unknown), payload.subarray(0, 5));

  const missingPath = path.join(temporaryDirectory, "private-user-name-secret.mp3");
  const missing = await serveLibraryFile(new Request("https://library.invalid/missing"), missingPath);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("Content-Length"), "0");
  assert.equal((await bytes(missing)).length, 0);
  assert.ok(![...missing.headers].some(([name, value]) => `${name}:${value}`.includes(missingPath)));

  const directory = await serveLibraryFile(new Request("https://library.invalid/directory"), temporaryDirectory);
  assert.equal(directory.status, 404);

  const unsupported = await serveLibraryFile(new Request("https://library.invalid/media", { method: "POST" }), mediaPath);
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get("Allow"), "GET, HEAD");

  const disposablePath = path.join(temporaryDirectory, "disposable.bin");
  await writeFile(disposablePath, Buffer.alloc(1024 * 1024, 7));
  const disposable = await serveLibraryFile(new Request("https://library.invalid/disposable"), disposablePath);
  const reader = disposable.body.getReader();
  const firstChunk = await reader.read();
  assert.equal(firstChunk.done, false);
  await reader.cancel("test disposal");
  await rm(disposablePath, { force: true });

  assert.deepEqual(await readFile(mediaPath), payload, "Serving must not modify the source file");
  console.info("PASS: streamed library responses support full, HEAD, byte ranges, generic errors, MIME and cancellation disposal");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
