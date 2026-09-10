import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Sequelize } from "sequelize";

export async function createMigrationBackup(options: {
  sequelize: Sequelize;
  databasePath: string;
  backupDirectory: string;
}): Promise<{ filename: string; sha256: string; size: number }> {
  await mkdir(options.backupDirectory, { recursive: true, mode: 0o700 });
  const filename = `${path.basename(options.databasePath)}.before-remove-enjoy-${Date.now()}-${randomUUID()}.sqlite`;
  const destination = path.join(options.backupDirectory, filename);
  // SQLite writes a consistent snapshot, including committed WAL data.
  await options.sequelize.query("VACUUM INTO $destination", { bind: { destination } });
  await chmod(destination, 0o600);
  const bytes = await readFile(destination);
  const receipt = {
    filename,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: (await stat(destination)).size,
  };
  if (!receipt.size) throw new Error("Required migration backup is empty");
  await writeFile(`${destination}.json`, JSON.stringify(receipt, null, 2), { mode: 0o600, flag: "wx" });
  return receipt;
}
