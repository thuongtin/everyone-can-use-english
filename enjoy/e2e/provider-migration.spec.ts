/* eslint-disable no-empty-pattern -- Electron fixtures do not use a browser fixture. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { launchLocalApp, queryLocalDatabase, writeReceipt } from "./helpers/local-app";

const source = process.env.ENJOY_LEGACY_PROFILE_SNAPSHOT;
const profileId = process.env.ENJOY_LEGACY_PROFILE_ID || "26015977";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

test("legacy profile copy preserves historical rows and repeats migration safely", async ({}, testInfo) => {
  test.skip(!source, "Set ENJOY_LEGACY_PROFILE_SNAPSHOT to an existing read-only SQLite backup");
  test.setTimeout(180_000);
  const sourcePath = path.resolve(source!);
  const sourceHash = createHash("sha256").update(await readFile(sourcePath)).digest("hex");
  const tables = await queryLocalDatabase<{ name: string }>(sourcePath,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const baseline: { name: string; columns: string[]; count: number; digest: string }[] = [];
  for (const { name } of tables) {
    if (["SequelizeMeta", "cache_objects", "user_settings"].includes(name)) continue;
    const columns = (await queryLocalDatabase<{ name: string }>(sourcePath, `PRAGMA table_info(${quote(name)})`)).map(c => c.name);
    const rows = await queryLocalDatabase(sourcePath, `SELECT ${columns.map(quote).join(",")} FROM ${quote(name)}`);
    baseline.push({ name, columns, count: rows.length, digest: digest(rows.map(digest).sort()) });
  }
  const originalSettings = await queryLocalDatabase<{ key: string; value: unknown }>(sourcePath, "SELECT key, value FROM user_settings ORDER BY key");
  const preservedSettings = originalSettings.filter(row => !["gpt_engine", "stt_engine", "tts_config", "profile"].includes(row.key))
    .map(row => ({ key: row.key, digest: digest(row.value) }));
  const fixture = await launchLocalApp({ offline: true, seed: { databasePath: sourcePath, profileId, assets: [] } });
  const verify = async () => {
    await expect(fixture.page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });
    expect(path.resolve(fixture.databasePath)).not.toBe(sourcePath);
    expect(await fixture.page.evaluate(async () => (await window.__ENJOY_APP__.appSettings.getUser()).id)).toBe(profileId);
    const receipts = [];
    for (const table of baseline) {
      const rows = await queryLocalDatabase(fixture.databasePath, `SELECT ${table.columns.map(quote).join(",")} FROM ${quote(table.name)}`);
      const receipt = { table: table.name, count: rows.length, digest: digest(rows.map(digest).sort()) };
      expect(receipt.count, `${table.name} count`).toBe(table.count);
      expect(receipt.digest, `${table.name} historical row hash`).toBe(table.digest);
      receipts.push(receipt);
    }
    const settings = await queryLocalDatabase<{ key: string; value: unknown }>(fixture.databasePath, "SELECT key, value FROM user_settings ORDER BY key");
    const decode = (value: unknown) => { try { return JSON.parse(String(value)); } catch { return value; } };
    const oldTts = decode(originalSettings.find(row => row.key === "tts_config")?.value);
    const nextTts = decode(settings.find(row => row.key === "tts_config")?.value);
    if (oldTts && typeof oldTts === "object" && oldTts.engine === "enjoyai") {
      expect(nextTts?.engine).toBe("needs-selection");
    }
    const oldGpt = decode(originalSettings.find(row => row.key === "gpt_engine")?.value);
    if (oldGpt && typeof oldGpt === "object" && oldGpt.name === "deepseek") {
      expect(digest(settings.find(row => row.key === "gpt_engine")?.value)).toBe(digest(originalSettings.find(row => row.key === "gpt_engine")?.value));
    }
    for (const expected of preservedSettings) {
      expect(digest(settings.find(row => row.key === expected.key)?.value), `preserved setting ${expected.key}`).toBe(expected.digest);
    }
    return { tables: receipts, settingsDigest: digest(settings), preservedSettingKeys: preservedSettings.map(row => row.key) };
  };
  let primaryError: unknown;
  try {
    const first = await verify();
    await fixture.restart({ offline: true });
    const second = await verify();
    expect(second.settingsDigest).toBe(first.settingsDigest);
    expect(createHash("sha256").update(await readFile(sourcePath)).digest("hex")).toBe(sourceHash);
    await writeReceipt(testInfo, "legacy-provider-migration.json", {
      sourceHash, profileId, historicalTables: first.tables,
      preservedSettingKeys: first.preservedSettingKeys,
      repeatedMigrationStable: true, originalSnapshotUnchanged: true,
      limits: ["Offline copied database; media bytes were not copied", "Does not prove old application rollback or live inference"],
      runtime: fixture.runtimeDiagnostics(),
    });
    fixture.assertNoRuntimeIssues();
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await fixture.close().catch(error => { if (!primaryError) throw error; });
  }
});
