import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = path.join(root, "tmp/dictionary-tests");
await mkdir(temp, { recursive: true });
await build({
  entryPoints: [path.join(root, "src/main/bilingual-store.ts"), path.join(root, "src/constants/bilingual-dictionaries.ts")],
  outdir: temp, bundle: true, platform: "node", format: "esm", packages: "external", outExtension: { ".js": ".mjs" },
});
const { BilingualStore } = await import(pathToFileURL(path.join(temp, "main/bilingual-store.mjs")));
const { getDefaultDictionary } = await import(pathToFileURL(path.join(temp, "constants/bilingual-dictionaries.mjs")));
const manifest = JSON.parse(await readFile(path.join(root, "dictionaries/manifest.json"), "utf8"));
for (const dictionary of manifest.dictionaries) {
  const database = await readFile(path.join(root, "lib/dictionaries", `${dictionary.direction}.sqlite`));
  assert.equal(createHash("sha256").update(database).digest("hex"), dictionary.databaseSha256);
}
const store = new BilingualStore(path.join(root, "lib/dictionaries"));
const gloss = entries => entries.flatMap(entry => entry.senses.flatMap(sense => sense.glosses)).join("; ");
try {
  assert.match(gloss(await store.lookup("en-vi", "hello")), /chào/i);
  assert.match(gloss(await store.lookup("en-vi", "learn")), /học/i);
  const learned = await store.lookup("en-vi", "learn");
  assert.doesNotMatch(gloss(learned), /guộc duỵu/);
  assert.ok(learned.some(entry => entry.ipa.some(ipa => ipa.text === "/lɝn/")));
  const bank = await store.lookup("en-vi", "bank");
  assert.ok(bank.some(entry => entry.ipa.some(ipa => ipa.labels.includes("/æ/ raising"))));
  for (const word of ["bọn", "bất nhẫn"]) {
    assert.ok((await store.lookup("vi-en", word)).every(entry => entry.senses.every(sense => sense.examples.length === 0)));
  }
  assert.match(gloss(await store.lookup("en-vi", "bank")), /ngân hàng/i);
  assert.match(gloss(await store.lookup("vi-en", "học")), /learn|study/i);
  assert.match(gloss(await store.lookup("vi-en", "ngân hàng")), /bank/i);
  assert.match(gloss(await store.lookup("vi-en", "xin chào")), /hello|greet/i);
  assert.deepEqual(await store.lookup("vi-en", "  NGÂN   HÀNG  ".normalize("NFD")), await store.lookup("vi-en", "ngân hàng"));
  assert.notDeepEqual(await store.lookup("vi-en", "ma"), await store.lookup("vi-en", "má"));
  assert.deepEqual(await store.lookup("en-vi", "not-a-real-entry-927614"), []);
  assert.deepEqual(await store.lookup("en-vi", "' OR 1=1 --"), []);
  assert.deepEqual(await store.lookup("en-vi", "<script>alert(1)</script>"), []);
  await assert.rejects(store.lookup("../en-vi", "hello"), /Unsupported/);
  await assert.rejects(store.lookup("en-vi", "x".repeat(201)), /Invalid/);
  const concurrent = await Promise.all(Array.from({ length: 30 }, (_, i) => store.lookup(i % 2 ? "en-vi" : "vi-en", i % 2 ? "hello" : "học")));
  assert.ok(concurrent.every(entries => entries.length));
  const options = ["en-vi", "vi-en", "ai", "ccalecd", "my-mdict"];
  assert.equal(getDefaultDictionary("", options, "en-US"), "en-vi");
  assert.equal(getDefaultDictionary("vi-en", options, "en-US"), "vi-en");
  assert.equal(getDefaultDictionary("ccalecd", options, "en-US"), "ccalecd");
  assert.equal(getDefaultDictionary("my-mdict", options, "en-US"), "my-mdict");
  assert.equal(getDefaultDictionary("removed", options, "en-US"), "en-vi");
  assert.equal(getDefaultDictionary("", options, "ja-JP"), "ai");
  console.log("PASS: real bilingual data, phrases, NFC, accents, missing words, SQL parameters, invalid input, concurrency, default selection and legacy preferences.");
} finally { await store.close(); }
