import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { Sequelize } from "sequelize";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(root, ".tmp-enjoy-learning-asset-protocol-"));
const migrationPath = path.join(root, "src/main/db/migrations/1788701024340-create-learning-studio.js");
const mapBriefMigrationPath = path.join(root, "src/main/db/migrations/1788789600000-add-learning-map-brief.js");
const tests = [];
const test = async (name, action) => {
  await action();
  tests.push(name);
};

const uuid = "abcdefab-cdef-4abc-8def-abcdefabcdef";
const uuid2 = "22222222-2222-4222-8222-222222222222";
const uuid3 = "33333333-3333-4333-8333-333333333333";
const slotId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const payload = Buffer.from("learning asset bytes");
const sha256 = createHash("sha256").update(payload).digest("hex");

async function openDatabase(databasePath) {
  const sequelize = new Sequelize({ dialect: "sqlite", storage: databasePath, logging: false });
  const migration = await import(`${pathToFileURL(migrationPath).href}?test=${Date.now()}-${Math.random()}`);
  await migration.up({ context: sequelize.getQueryInterface() });
  const mapBriefMigration = await import(`${pathToFileURL(mapBriefMigrationPath).href}?test=${Date.now()}-${Math.random()}`);
  await mapBriefMigration.up({ context: sequelize.getQueryInterface() });
  return sequelize;
}

async function bundleEntry(outfile) {
  await build({
    entryPoints: [path.join(root, "src/main/learning/asset-protocol.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    external: ["sequelize"],
    logLevel: "silent",
  });
}

try {
  const output = path.join(temp, "asset-protocol.mjs");
  await bundleEntry(output);
  const protocolModule = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
  const scopeModule = await (async () => {
    const scopeOutput = path.join(temp, "profile-scope.mjs");
    await build({
      entryPoints: [path.join(root, "src/main/learning/profile-scope.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: scopeOutput,
      logLevel: "silent",
    });
    return import(`${pathToFileURL(scopeOutput).href}?test=${Date.now()}`);
  })();
  const modelsModule = await (async () => {
    const modelsOutput = path.join(temp, "learning-models.mjs");
    await build({
      entryPoints: [path.join(root, "src/main/db/learning-models.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: modelsOutput,
      external: ["sequelize"],
      logLevel: "silent",
    });
    return import(`${pathToFileURL(modelsOutput).href}?test=${Date.now()}`);
  })();

  const { LearningAssetProtocol, learningAssetUrl, parseLearningAssetUrl } = protocolModule;
  const { LearningProfileScope } = scopeModule;
  const { createLearningModels } = modelsModule;

  await test("round-trips canonical URLs and rejects authority, encoding, path, and stale-context aliases", async () => {
    const context = { profileId: "profile-a", connectionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    const relativePath = `${uuid}.png`;
    const url = learningAssetUrl(context, relativePath);
    assert.equal(url, `enjoy://library/learning-assets/${context.connectionId}/${relativePath}`);
    assert.equal(parseLearningAssetUrl(url, context), relativePath);
    for (const candidate of [
      url.replace("enjoy://library", "http://library"),
      url.replace("enjoy://library", "enjoy://other"),
      url.replace("enjoy://library", "enjoy://user:pass@library"),
      `${url}?download=1`,
      `${url}#fragment`,
      url.replace(`${uuid}.png`, `${uuid.toUpperCase()}.png`),
      url.replace(`${uuid}.png`, `${uuid}%2Epng`),
      url.replace(`${uuid}.png`, `${uuid}.png/extra`),
      url.replace(context.connectionId, `${context.connectionId.slice(0, -1)}0`),
    ]) {
      assert.throws(() => parseLearningAssetUrl(candidate, context), (error) => /^learning_asset_(url|context)_/.test(error?.code ?? ""));
    }
    assert.throws(() => learningAssetUrl(context, `${uuid}.jpeg`), { code: "learning_asset_url_invalid" });
  });

  const databasePath = path.join(temp, "protocol.sqlite");
  const assetRoot = path.join(temp, "assets");
  const filePath = path.join(assetRoot, `${uuid}.png`);
  const unknownFilePath = path.join(assetRoot, `${uuid3}.png`);
  const sequelize = await openDatabase(databasePath);
  const models = createLearningModels(sequelize);
  const scope = new LearningProfileScope("profile-a", assetRoot);
  const assets = {
    resolve: (relativePath) => path.join(assetRoot, relativePath),
    read: (relativePath) => readFile(path.join(assetRoot, relativePath)),
  };
  await mkdir(assetRoot, { recursive: true });
  await writeFile(filePath, payload);
  await writeFile(unknownFilePath, payload);
  await models.GeneratedAsset.create({
    id: uuid2,
    profileId: "profile-a",
    slotId,
    relativePath: `${uuid2}.png`,
    kind: "image",
    mimeType: "image/png",
    sha256,
    sizeBytes: payload.length,
    width: 1,
    height: 1,
    durationMs: null,
    provenance: {},
  });
  await models.GeneratedAsset.create({
    id: uuid,
    profileId: "profile-a",
    slotId,
    relativePath: `${uuid}.png`,
    kind: "image",
    mimeType: "image/png",
    sha256,
    sizeBytes: payload.length,
    width: 1,
    height: 1,
    durationMs: null,
    provenance: {},
  });
  const protocol = new LearningAssetProtocol({ scope, models, assets });
  const url = learningAssetUrl(scope.context, `${uuid}.png`);
  const recordedUrl = learningAssetUrl(scope.context, `${uuid2}.png`);

  await test("serves a database-authorized file with cache and integrity headers", async () => {
    const response = await protocol.handle(new Request(url));
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), payload);
    assert.equal(response.headers.get("Content-Type"), "image/png");
    assert.equal(response.headers.get("Content-Length"), String(payload.length));
    assert.equal(response.headers.get("Accept-Ranges"), "bytes");
    assert.equal(response.headers.get("ETag"), `"${sha256}"`);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  await test("serves HEAD and a single byte range without exposing filesystem paths", async () => {
    const head = await protocol.handle(new Request(url, { method: "HEAD" }));
    assert.equal(head.status, 200);
    assert.equal(head.body, null);
    assert.equal(head.headers.get("Content-Length"), String(payload.length));
    const range = await protocol.handle(new Request(url, { headers: { Range: "bytes=1-4" } }));
    assert.equal(range.status, 206);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), payload.subarray(1, 5));
    assert.equal(range.headers.get("Content-Range"), `bytes 1-4/${payload.length}`);
    assert.equal(range.headers.get("Content-Length"), "4");
    const suffixHead = await protocol.handle(new Request(url, { method: "HEAD", headers: { Range: "bytes=-4" } }));
    assert.equal(suffixHead.status, 206);
    assert.equal(suffixHead.body, null);
    assert.equal(suffixHead.headers.get("Content-Range"), `bytes ${payload.length - 4}-${payload.length - 1}/${payload.length}`);
    assert.equal(suffixHead.headers.get("Content-Length"), "4");
    for (const rangeValue of ["bytes=0-1,3-4", "bytes=99-100", "bytes=4-1", "bytes=-0", "bytes=-1-2"]) {
      const invalid = await protocol.handle(new Request(url, { headers: { Range: rangeValue } }));
      assert.equal(invalid.status, 416);
      assert.equal(invalid.headers.get("Content-Range"), `bytes */${payload.length}`);
      const errorBody = await invalid.text();
      assert.equal(errorBody.includes(assetRoot), false);
    }
  });

  await test("requires an asset row, matching MIME and checksum, and returns generic errors", async () => {
    const unknownUrl = learningAssetUrl(scope.context, `${uuid3}.png`);
    const unknown = await protocol.handle(new Request(unknownUrl));
    assert.equal(unknown.status, 404);
    await models.GeneratedAsset.update({ mimeType: "audio/mpeg" }, { where: { id: uuid2, profileId: "profile-a" } });
    assert.equal((await protocol.handle(new Request(recordedUrl))).status, 404);
    await models.GeneratedAsset.update({ mimeType: "image/png", sha256: "0".repeat(64) }, { where: { id: uuid2, profileId: "profile-a" } });
    assert.equal((await protocol.handle(new Request(recordedUrl))).status, 404);
    await models.GeneratedAsset.update({ sha256 }, { where: { id: uuid2, profileId: "profile-a" } });
    await rm(filePath);
    const missing = await protocol.handle(new Request(url));
    assert.equal(missing.status, 404);
    const body = await missing.text();
    assert.equal(body.includes(assetRoot), false);
    assert.equal(body.includes(".png"), false);
  });

  await test("rejects stale connection, closed profile, and unsupported methods before data access", async () => {
    const staleUrl = url;
    const otherScope = new LearningProfileScope("profile-a", assetRoot);
    const otherProtocol = new LearningAssetProtocol({ scope: otherScope, models, assets });
    assert.equal((await otherProtocol.handle(new Request(staleUrl))).status, 403);
    await otherScope.quiesce();
    assert.equal((await otherProtocol.handle(new Request(learningAssetUrl(otherScope.context, `${uuid}.png`)))).status, 403);
    assert.equal((await protocol.handle(new Request(url, { method: "POST" }))).status, 405);
    await scope.quiesce();
    await sequelize.close();
  });

  console.log(`PASS: ${tests.length} learning asset protocol cases.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
