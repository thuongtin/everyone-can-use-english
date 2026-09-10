import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(root, ".tmp-enjoy-learning-assets-"));
const uuid = "11111111-1111-4111-8111-111111111111";
const uuid2 = "22222222-2222-4222-8222-222222222222";
const uuid3 = "33333333-3333-4333-8333-333333333333";
const uuid4 = "44444444-4444-4444-8444-444444444444";
const uuid5 = "55555555-5555-4555-8555-555555555555";
const uuid6 = "66666666-6666-4666-8666-666666666666";
const uuid7 = "77777777-7777-4777-8777-777777777777";

const tests = [];
const test = async (name, action) => {
  await action();
  tests.push(name);
};

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBytes, data]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([header, body, crc]);
}

function makePng(width, height, rgba) {
  const scanlines = [];
  for (let row = 0; row < height; row += 1) {
    scanlines.push(Buffer.from([0]));
    for (let column = 0; column < width; column += 1) scanlines.push(Buffer.from(rgba));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(scanlines))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const validImage = makePng(2, 1, [255, 0, 0, 255]);
const alternateImage = makePng(1, 1, [0, 255, 0, 255]);
const validWebp = Buffer.from("UklGRkIAAABXRUJQVlA4IDYAAAAwAgCdASoDAAIAAIAOJaACdLoB+AH4AARoAAD+/A2j/774Zb3b/0Jf/ue7+7Av7nu/+5nAAAA=", "base64");
const validJpegFixture = await readFile(path.join(root, "assets", "default-img.jpg"));

try {
  const output = path.join(temp, "asset-store.mjs");
  await build({
    entryPoints: [path.join(root, "src/main/learning/asset-store.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    external: ["@andrkrn/ffprobe-static", "ffmpeg-static"],
    logLevel: "silent",
  });

  const { LEARNING_ASSET_MAX_BYTES, LearningAssetStore } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
  const storeRoot = path.join(temp, "assets");
  const sourceRoot = path.join(temp, "approved");
  const outsideRoot = path.join(temp, "outside");
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(outsideRoot, { recursive: true });
  await writeFile(path.join(outsideRoot, "secret.bin"), Buffer.from("outside"));
  const store = new LearningAssetStore(storeRoot);

  await test("rejects use before initialization and initializes a real root", async () => {
    assert.equal(store.resolve(`${uuid}.png`), path.join(storeRoot, `${uuid}.png`));
    await assert.rejects(() => store.read(`${uuid}.png`), { code: "not_initialized" });
    await store.initialize();
    assert.equal((await stat(storeRoot)).isDirectory(), true);
    assert.equal((await stat(path.join(storeRoot, ".staging"))).isDirectory(), true);
  });

  await test("imports a real PNG and reports dimensions, MIME, checksum, and size", async () => {
    const metadata = await store.importBytes({ id: uuid, kind: "image", bytes: validImage });
    assert.equal(metadata.relativePath, `${uuid}.png`);
    assert.equal(metadata.mimeType, "image/png");
    assert.equal(metadata.width, 2);
    assert.equal(metadata.height, 1);
    assert.equal(metadata.durationMs, null);
    assert.equal(metadata.sizeBytes, validImage.length);
    assert.equal(metadata.sha256.length, 64);
    assert.deepEqual(await store.read(metadata.relativePath), validImage);
  });

  await test("imports JPEG and WebP using their actual magic and dimensions", async () => {
    const jpegMetadata = await store.importBytes({ id: uuid5, kind: "image", bytes: validJpegFixture });
    assert.deepEqual({ extension: jpegMetadata.relativePath.slice(-4), mimeType: jpegMetadata.mimeType, width: jpegMetadata.width, height: jpegMetadata.height }, {
      extension: ".jpg",
      mimeType: "image/jpeg",
      width: 254,
      height: 142,
    });
    const webpMetadata = await store.importBytes({ id: uuid6, kind: "image", bytes: validWebp });
    assert.deepEqual({ extension: webpMetadata.relativePath.slice(-5), mimeType: webpMetadata.mimeType, width: webpMetadata.width, height: webpMetadata.height }, {
      extension: ".webp",
      mimeType: "image/webp",
      width: 3,
      height: 2,
    });
  });

  await test("rejects truncated and CRC-corrupted images", async () => {
    await assert.rejects(() => store.importBytes({ id: uuid2, kind: "image", bytes: validImage.subarray(0, -4) }), { code: "invalid_image" });
    const corrupted = Buffer.from(validImage);
    corrupted[corrupted.length - 12] ^= 1;
    await assert.rejects(() => store.importBytes({ id: uuid2, kind: "image", bytes: corrupted }), { code: "invalid_image" });
    await assert.rejects(() => store.importBytes({ id: uuid2, kind: "image", bytes: Buffer.from("not-an-image") }), { code: "invalid_image" });
  });

  await test("rejects known audio as image and enforces the byte limit", async () => {
    const wav = await readFile(path.join(root, "samples", "jfk.wav"));
    await assert.rejects(() => store.importBytes({ id: uuid2, kind: "image", bytes: wav }), { code: "asset_kind_mismatch" });
    await assert.rejects(() => store.importBytes({ id: uuid2, kind: "image", bytes: Buffer.alloc(LEARNING_ASSET_MAX_BYTES + 1) }), { code: "asset_too_large" });
  });

  await test("imports WAV and MP3 through an approved absolute ffprobe", async () => {
    const wav = await readFile(path.join(root, "samples", "jfk.wav"));
    const mp3 = await readFile(path.join(root, "samples", "speech.mp3"));
    const wavMetadata = await store.importBytes({ id: uuid2, kind: "audio", bytes: wav });
    assert.equal(wavMetadata.relativePath, `${uuid2}.wav`);
    assert.equal(wavMetadata.mimeType, "audio/wav");
    assert.equal(wavMetadata.width, null);
    assert.equal(wavMetadata.height, null);
    assert.equal(wavMetadata.durationMs, 11000);
    const mp3Metadata = await store.importBytes({ id: uuid3, kind: "audio", bytes: mp3 });
    assert.equal(mp3Metadata.relativePath, `${uuid3}.mp3`);
    assert.equal(mp3Metadata.mimeType, "audio/mpeg");
    assert.ok((mp3Metadata.durationMs ?? 0) > 0);
  });

  await test("rejects duplicate UUIDs with different bytes and keeps idempotent duplicates", async () => {
    const repeated = await store.importBytes({ id: uuid, kind: "image", bytes: validImage });
    assert.equal(repeated.relativePath, `${uuid}.png`);
    await assert.rejects(() => store.importBytes({ id: uuid, kind: "image", bytes: alternateImage }), { code: "asset_conflict" });
  });

  await test("serializes concurrent UUID publishes across different extensions", async () => {
    const wav = await readFile(path.join(root, "samples", "jfk.wav"));
    const outcomes = await Promise.allSettled([
      store.importBytes({ id: uuid7, kind: "image", bytes: validImage }),
      store.importBytes({ id: uuid7, kind: "audio", bytes: wav }),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === "rejected" && outcome.reason?.code === "asset_conflict").length, 1);
    const stored = await Promise.all([
      stat(path.join(storeRoot, `${uuid7}.png`)).catch(() => null),
      stat(path.join(storeRoot, `${uuid7}.wav`)).catch(() => null),
    ]);
    assert.equal(stored.filter(Boolean).length, 1);
  });

  await test("imports a regular source only when it is canonically inside approvedRoot", async () => {
    const source = path.join(sourceRoot, "payload.bin");
    await writeFile(source, validImage);
    const metadata = await store.importFile({ id: uuid4, kind: "image", sourcePath: source, approvedRoot: sourceRoot });
    assert.equal(metadata.relativePath, `${uuid4}.png`);
    await assert.rejects(() => store.importFile({ id: uuid4, kind: "image", sourcePath: path.join(outsideRoot, "secret.bin"), approvedRoot: sourceRoot }), { code: "source_not_approved" });
    await assert.rejects(() => store.importFile({ id: uuid4, kind: "image", sourcePath: path.join(sourceRoot, "missing.bin"), approvedRoot: sourceRoot }), /ENOENT|no such file/i);
  });

  await test("rejects source symlinks and parent symlinks", async () => {
    const source = path.join(sourceRoot, "payload-symlink.bin");
    await writeFile(source, validImage);
    const sourceLink = path.join(sourceRoot, "payload-link.bin");
    await symlink(source, sourceLink);
    await assert.rejects(() => store.importFile({ id: uuid2, kind: "image", sourcePath: sourceLink, approvedRoot: sourceRoot }), { code: "source_not_approved" });
    const parentLink = path.join(temp, "approved-link");
    await symlink(sourceRoot, parentLink, "dir");
    await assert.rejects(() => store.importFile({ id: uuid2, kind: "image", sourcePath: path.join(parentLink, "payload-symlink.bin"), approvedRoot: parentLink }), { code: "source_not_approved" });
  });

  await test("rejects traversal, non-allowlisted paths, and final symlink attacks", async () => {
    assert.throws(() => store.resolve("../secret.png"), { code: "asset_path_invalid" });
    assert.throws(() => store.resolve(`${uuid}.txt`), { code: "asset_path_invalid" });
    const external = path.join(outsideRoot, "external.png");
    await writeFile(external, Buffer.from("secret"));
    const finalLink = path.join(storeRoot, `${uuid2}.png`);
    await symlink(external, finalLink);
    await assert.rejects(() => store.read(`${uuid2}.png`), { code: "asset_path_invalid" });
    await assert.rejects(() => store.remove(`${uuid2}.png`), { code: "asset_path_invalid" });
    assert.equal((await readFile(external)).toString(), "secret");
    await unlink(finalLink);
  });

  await test("cleans stale staging files without following links", async () => {
    const stale = path.join(storeRoot, ".staging", "stale.stage");
    await writeFile(stale, Buffer.from("stale"));
    const stagingLink = path.join(storeRoot, ".staging", "outside-link");
    await symlink(path.join(outsideRoot, "secret.bin"), stagingLink);
    await store.cleanupStaging();
    assert.deepEqual(await readdir(path.join(storeRoot, ".staging")), []);
  });

  await test("rejects a symlink store root and symlink staging root", async () => {
    const realRoot = path.join(temp, "real-root");
    const rootLink = path.join(temp, "root-link");
    await mkdir(realRoot);
    await symlink(realRoot, rootLink, "dir");
    await assert.rejects(() => new LearningAssetStore(rootLink).initialize(), { code: "invalid_root" });
    const stagingReal = path.join(temp, "staging-real");
    const stagingStore = path.join(temp, "staging-store");
    await mkdir(stagingStore);
    await mkdir(stagingReal);
    await rm(path.join(stagingStore, ".staging"), { recursive: true, force: true });
    await symlink(stagingReal, path.join(stagingStore, ".staging"), "dir");
    await assert.rejects(() => new LearningAssetStore(stagingStore).initialize(), { code: "invalid_root" });
  });

  await test("removes an imported asset and leaves the outside file untouched", async () => {
    await store.remove(`${uuid4}.png`);
    await assert.rejects(() => store.read(`${uuid4}.png`), /ENOENT|no such file/i);
    assert.equal((await readFile(path.join(outsideRoot, "secret.bin"))).toString(), "outside");
  });

  console.log(`PASS: ${tests.length} learning asset store cases.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
