import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { Sequelize } from "sequelize";

const root = path.resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(path.join(root, ".tmp-migration-backup-"));
let original;
let restored;
try {
  const output = path.join(temporary, "backup.mjs");
  await build({ entryPoints: [path.join(root, "src/main/db/migration-backup.ts")], outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  const { createMigrationBackup } = await import(pathToFileURL(output).href);
  const databasePath = path.join(temporary, "profile.sqlite");
  original = new Sequelize({ dialect: "sqlite", storage: databasePath, logging: false });
  await original.query("PRAGMA journal_mode=WAL");
  await original.query("CREATE TABLE saved (id INTEGER PRIMARY KEY, content TEXT NOT NULL)");
  await original.query("INSERT INTO saved VALUES (1, 'custom prompt preserved')");
  const backupDirectory = path.join(temporary, "backup");
  const receipt = await createMigrationBackup({ sequelize: original, databasePath, backupDirectory });
  const snapshot = path.join(backupDirectory, receipt.filename);
  assert.equal(receipt.sha256, createHash("sha256").update(await readFile(snapshot)).digest("hex"));
  assert.equal((await stat(snapshot)).mode & 0o777, 0o600);
  await original.query("UPDATE saved SET content = 'new value' WHERE id=1");
  restored = new Sequelize({ dialect: "sqlite", storage: snapshot, logging: false });
  const [rows] = await restored.query("SELECT * FROM saved");
  assert.deepEqual(rows, [{ id: 1, content: "custom prompt preserved" }]);
  const [integrity] = await restored.query("PRAGMA integrity_check");
  assert.deepEqual(integrity, [{ integrity_check: "ok" }]);
  await assert.rejects(() => createMigrationBackup({ sequelize: original, databasePath, backupDirectory: databasePath }), /EEXIST|ENOTDIR/);
  console.log("PASS: migration snapshot includes WAL rows, preserves originals, has restricted file mode and verified integrity; failed backup rejects.");
} finally {
  await restored?.close();
  await original?.close();
  await rm(temporary, { recursive: true, force: true });
}
