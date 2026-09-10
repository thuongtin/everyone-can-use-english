/* eslint-disable no-empty-pattern -- Electron fixtures do not use a browser fixture. */
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  backupLocalDatabase,
  launchLocalApp,
  queryLocalDatabase,
  writeReceipt,
} from "./helpers/local-app";

const source = process.env.ENJOY_LEGACY_PROFILE_SNAPSHOT;
const profileId = process.env.ENJOY_LEGACY_PROFILE_ID || "26015977";
const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value) ?? "undefined").digest("hex");
const fileDigest = async (filePath: string): Promise<string> =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

type SchemaRow = Readonly<{
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
}>;

type TableReceipt = Readonly<{
  name: string;
  columnDigest: string;
  rowCount: number;
  rowDigest: string;
}>;

type DatabaseSnapshot = Readonly<{
  schemaDigest: string;
  tables: readonly TableReceipt[];
  tableCount: number;
  rowCount: number;
  dataDigest: string;
}>;

const snapshotDatabase = async (databasePath: string): Promise<DatabaseSnapshot> => {
  const schema = await queryLocalDatabase<SchemaRow>(
    databasePath,
    "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name, tbl_name",
  );
  const tables = schema.filter(row => row.type === "table");
  const receipts: TableReceipt[] = [];
  for (const table of tables) {
    const columns = await queryLocalDatabase<{ name: string }>(
      databasePath,
      `PRAGMA table_info(${quote(table.name)})`,
    );
    const columnNames = columns.map(column => column.name);
    const rows = await queryLocalDatabase(
      databasePath,
      `SELECT ${columnNames.map(quote).join(",")} FROM ${quote(table.name)}`,
    );
    receipts.push({
      name: table.name,
      columnDigest: digest(columnNames),
      rowCount: rows.length,
      rowDigest: digest(rows.map(row => digest(row)).sort()),
    });
  }
  return {
    schemaDigest: digest(schema),
    tables: receipts,
    tableCount: receipts.length,
    rowCount: receipts.reduce((total, table) => total + table.rowCount, 0),
    dataDigest: digest(receipts),
  };
};

const decode = (value: unknown): unknown => {
  try {
    return JSON.parse(String(value));
  } catch {
    return value;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const legacySelectionRows = (
  settings: readonly Readonly<{ key: string; value: unknown }>[],
): readonly Readonly<{ key: string; value: unknown }>[] => settings.filter(row => {
  const value = decode(row.value);
  if (row.key === "gpt_engine") return isRecord(value) && value.name === "enjoyai";
  if (row.key === "stt_engine") return value === "enjoy_azure" || value === "enjoy_cloudflare";
  return row.key === "tts_config" && isRecord(value) && value.engine === "enjoyai";
});

test("a migrated legacy profile can be restored byte-for-byte from its immutable snapshot", async ({}, testInfo) => {
  test.skip(!source, "Set ENJOY_LEGACY_PROFILE_SNAPSHOT to an existing read-only SQLite backup");
  test.setTimeout(180_000);

  const sourcePath = path.resolve(source!);
  const sourceHash = await fileDigest(sourcePath);
  const baseline = await snapshotDatabase(sourcePath);
  const baselineIntegrity = await queryLocalDatabase<{ integrity_check: string }>(
    sourcePath,
    "PRAGMA integrity_check",
  );
  expect(baselineIntegrity).toEqual([{ integrity_check: "ok" }]);

  const baselineSettings = await queryLocalDatabase<{ key: string; value: unknown }>(
    sourcePath,
    "SELECT key, value FROM user_settings ORDER BY key",
  );
  const legacyRows = legacySelectionRows(baselineSettings);
  expect(legacyRows.length, "snapshot must contain a legacy provider selection").toBeGreaterThan(0);
  const legacySelectionDigest = digest(legacyRows.map(row => ({
    key: row.key,
    valueDigest: digest(row.value),
  })));

  const rollbackRoot = await mkdtemp(path.join(os.tmpdir(), "enjoy-provider-rollback-"));
  await chmod(rollbackRoot, 0o700);
  const rollbackDatabase = path.join(rollbackRoot, "migrated.sqlite");
  let fixture: Awaited<ReturnType<typeof launchLocalApp>> | undefined;
  let fixtureClosed = false;
  let primaryError: unknown;
  try {
    fixture = await launchLocalApp({
      offline: true,
      seed: { databasePath: sourcePath, profileId, assets: [] },
    });
    await expect(fixture.page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });
    expect(path.resolve(fixture.databasePath)).not.toBe(sourcePath);
    expect(await fixture.page.evaluate(async () =>
      (await window.__ENJOY_APP__.appSettings.getUser()).id)).toBe(profileId);

    const migratedSettings = await queryLocalDatabase<{ key: string; value: unknown }>(
      fixture.databasePath,
      "SELECT key, value FROM user_settings ORDER BY key",
    );
    const migrationMarker = decode(
      migratedSettings.find(row => row.key === "provider_selection_migration_v1")?.value,
    );
    expect(isRecord(migrationMarker) && migrationMarker.status).toBe("completed");
    for (const legacyRow of legacyRows) {
      const migratedRow = migratedSettings.find(row => row.key === legacyRow.key);
      expect(digest(migratedRow?.value), `migration changed ${legacyRow.key}`).not.toBe(digest(legacyRow.value));
    }

    await backupLocalDatabase(fixture.databasePath, rollbackDatabase);
    expect((await stat(rollbackRoot)).mode & 0o777).toBe(0o700);
    expect((await stat(rollbackDatabase)).mode & 0o777).toBe(0o600);
    const migratedHash = await fileDigest(rollbackDatabase);
    const migrated = await snapshotDatabase(rollbackDatabase);
    expect(migrated.dataDigest).not.toBe(baseline.dataDigest);

    fixture.assertNoRuntimeIssues();
    await fixture.close();
    fixtureClosed = true;

    await copyFile(sourcePath, rollbackDatabase);
    await chmod(rollbackDatabase, 0o600);
    await Promise.all([
      rm(`${rollbackDatabase}-wal`, { force: true }),
      rm(`${rollbackDatabase}-shm`, { force: true }),
      rm(`${rollbackDatabase}-journal`, { force: true }),
    ]);

    const restoredHash = await fileDigest(rollbackDatabase);
    expect(restoredHash).toBe(sourceHash);
    expect((await stat(rollbackDatabase)).mode & 0o777).toBe(0o600);
    const restoredIntegrity = await queryLocalDatabase<{ integrity_check: string }>(
      rollbackDatabase,
      "PRAGMA integrity_check",
    );
    expect(restoredIntegrity).toEqual([{ integrity_check: "ok" }]);
    const restored = await snapshotDatabase(rollbackDatabase);
    expect(restored).toEqual(baseline);

    const restoredSettings = await queryLocalDatabase<{ key: string; value: unknown }>(
      rollbackDatabase,
      "SELECT key, value FROM user_settings ORDER BY key",
    );
    expect(digest(legacySelectionRows(restoredSettings).map(row => ({
      key: row.key,
      valueDigest: digest(row.value),
    })))).toBe(legacySelectionDigest);
    expect(await fileDigest(sourcePath)).toBe(sourceHash);

    await writeReceipt(testInfo, "legacy-provider-rollback.json", {
      sourceHash,
      migratedHash,
      restoredHash,
      schemaDigest: restored.schemaDigest,
      dataDigest: restored.dataDigest,
      tableCount: restored.tableCount,
      rowCount: restored.rowCount,
      legacySelectionCount: legacyRows.length,
      legacySelectionDigest,
      limits: [
        "Storage restore was exercised only on an isolated copied database",
        "Compatibility with an older Enjoy executable was not exercised",
      ],
    });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (fixture && !fixtureClosed) {
      await fixture.close().catch(error => {
        if (!primaryError) throw error;
      });
    }
    await rm(rollbackRoot, { recursive: true, force: true }).catch(error => {
      if (!primaryError) throw error;
    });
  }
});
