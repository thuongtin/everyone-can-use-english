/* eslint-disable no-empty-pattern -- Electron acceptance uses its own packaged-app fixture. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "@playwright/test";

import {
  launchLocalApp,
  queryLocalDatabase,
  writeReceipt,
} from "./helpers/local-app";

const PROFILE_A = { id: "migration-profile-a", name: "Migration Profile A" };
const PROFILE_B = { id: "migration-profile-b", name: "Migration Profile B" };
const STORY_ID = "72c31e62-6bee-4e8a-9c36-1e4c3804ed47";
const MIGRATION_KEY = "provider_selection_migration_v1";
const SETTING_KEYS = ["gpt_engine", "stt_engine", "tts_config", MIGRATION_KEY] as const;

const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value) ?? "undefined").digest("hex");
const fileDigest = async (filePath: string): Promise<string> =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");
const decode = (value: unknown): unknown => {
  try {
    return JSON.parse(String(value));
  } catch {
    return value;
  }
};

type ProfilePaths = Readonly<{ root: string; database: string; marker: string }>;
type ProfileEvidence = Readonly<{
  profileId: string;
  rowDigest: string;
  fileHash: string;
  settingsDigest: string;
  migrationDigest: string;
}>;

const waitForHome = async (page: Page): Promise<void> => {
  await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });
};

const waitForProfileProbes = async (page: Page, profileId?: string): Promise<void> => {
  await page.evaluate(async (expectedProfileId) => {
    const bridge = window.__ENJOY_APP__;
    await bridge.acp.status();
    if (expectedProfileId && (await bridge.appSettings.getUser())?.id !== expectedProfileId) {
      throw new Error(`Profile ${expectedProfileId} changed while waiting for startup probes`);
    }
  }, profileId);
};

const switchProfile = async (
  page: Page,
  profile: Readonly<{ id: string; name: string }>,
): Promise<ProfilePaths> => {
  const profilePaths = await page.evaluate(async (nextProfile) => {
    const bridge = window.__ENJOY_APP__;
    if (await bridge.appSettings.getUser()) await bridge.acp.status();
    await bridge.appSettings.setUser({ ...nextProfile, nameSource: "explicit" });
    const connection = await bridge.db.connect();
    if (connection.state !== "connected" || connection.profileId !== nextProfile.id) {
      throw new Error(`Could not connect profile ${nextProfile.id}: ${connection.state}`);
    }
    const root = await bridge.appSettings.getUserDataPath();
    if (!root) throw new Error(`Profile ${nextProfile.id} has no data path`);
    return {
      root,
      database: connection.path,
    };
  }, profile);
  await page.reload();
  await waitForHome(page);
  await waitForProfileProbes(page, profile.id);
  await expect.poll(() => page.evaluate(async () =>
    (await window.__ENJOY_APP__.appSettings.getUser())?.id)).toBe(profile.id);
  return {
    ...profilePaths,
    marker: path.join(profilePaths.root, "migration-profile-marker.bin"),
  };
};

const reconnectCurrentProfile = async (page: Page, profileId: string): Promise<void> => {
  await waitForProfileProbes(page, profileId);
  await page.evaluate(async (expectedProfileId) => {
    const bridge = window.__ENJOY_APP__;
    const current = await bridge.db.connect();
    if (current.state !== "connected" || current.profileId !== expectedProfileId || !current.connectionId) {
      throw new Error(`Profile ${expectedProfileId} is not connected`);
    }
    await bridge.db.disconnect(current.connectionId);
    const reconnected = await bridge.db.connect();
    if (reconnected.state !== "connected" || reconnected.profileId !== expectedProfileId) {
      throw new Error(`Could not reconnect profile ${expectedProfileId}`);
    }
  }, profileId);
  await page.reload();
  await waitForHome(page);
  await waitForProfileProbes(page, profileId);
};

const seedProfile = async (
  page: Page,
  input: Readonly<{
    profile: Readonly<{ id: string; name: string }>;
    title: string;
    content: string;
    fileBytes: string;
    settings: Readonly<Record<string, unknown>>;
  }>,
): Promise<ProfilePaths> => {
  const paths = await switchProfile(page, input.profile);
  await mkdir(paths.root, { recursive: true });
  await writeFile(paths.marker, input.fileBytes, { encoding: "utf8", mode: 0o600, flag: "wx" });
  const sourceUrl = pathToFileURL(paths.marker).href;
  await page.evaluate(async ({ profile, title, content, settings, storyId, sourceUrl }) => {
    const bridge = window.__ENJOY_APP__;
    const setSetting = bridge.userSettings.set as unknown as
      (key: string, value: unknown) => Promise<void>;
    await setSetting("profile", { ...profile, nameSource: "explicit" });
    for (const [key, value] of Object.entries(settings)) await setSetting(key, value);
    await setSetting("provider_selection_migration_v1", null);
    await bridge.localStudy.stories.create({
      id: storyId,
      title,
      content,
      html: `<article><p>${content}</p></article>`,
      metadata: { fixture: profile.id },
      extraction: { words: [profile.id], idioms: [] },
      extracted: true,
      provenance: {
        source: "file",
        sourceUrl,
      },
    });
  }, { ...input, storyId: STORY_ID, sourceUrl });
  return paths;
};

const readProfileEvidence = async (
  page: Page,
  paths: ProfilePaths,
  expected: Readonly<{
    profileId: string;
    content: string;
    settings: Readonly<Record<string, unknown>>;
  }>,
): Promise<ProfileEvidence> => {
  const settingKeys = Array.from(new Set([...Object.keys(expected.settings), MIGRATION_KEY]));
  const runtime = await page.evaluate(async ({ storyId, settingKeys }) => {
    const bridge = window.__ENJOY_APP__;
    const getSetting = bridge.userSettings.get as unknown as (key: string) => Promise<unknown>;
    const [user, story, ...settings] = await Promise.all([
      bridge.appSettings.getUser(),
      bridge.localStudy.stories.get(storyId),
      ...settingKeys.map(key => getSetting(key)),
    ]);
    return {
      userId: user?.id,
      story,
      settings: Object.fromEntries(settingKeys.map((key, index) => [key, settings[index]])),
      userDataPath: await bridge.appSettings.getUserDataPath(),
    };
  }, { storyId: STORY_ID, settingKeys });

  expect(runtime.userId).toBe(expected.profileId);
  expect(path.resolve(runtime.userDataPath)).toBe(path.resolve(paths.root));
  expect(runtime.story.id).toBe(STORY_ID);
  expect(runtime.story.content).toBe(expected.content);
  expect(runtime.story.provenance.sourceUrl).toBe(pathToFileURL(paths.marker).href);
  for (const [key, value] of Object.entries(expected.settings)) {
    expect(runtime.settings[key], `${expected.profileId} setting ${key}`).toEqual(value);
  }
  const marker = runtime.settings[MIGRATION_KEY] as { status?: unknown } | null;
  expect(marker?.status).toBe("completed");

  const rows = await queryLocalDatabase<Record<string, unknown>>(
    paths.database,
    `SELECT id, profile_id, title, content, html, metadata, extraction, extracted, starred, provenance
       FROM local_stories WHERE id = ?`,
    [STORY_ID],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].profile_id).toBe(expected.profileId);
  expect(rows[0].content).toBe(expected.content);

  return {
    profileId: expected.profileId,
    rowDigest: digest(rows[0]),
    fileHash: await fileDigest(paths.marker),
    settingsDigest: digest(Object.fromEntries(
      Object.entries(runtime.settings).filter(([key]) => key !== MIGRATION_KEY),
    )),
    migrationDigest: digest(marker),
  };
};

test("fresh and multi-profile provider migration stays isolated across reconnect and restart", async ({}, testInfo) => {
  test.setTimeout(180_000);
  testInfo.annotations.push({
    type: "local-fixture",
    description: "Packaged app, offline disposable library, two synthetic profiles and SQLite databases",
  });

  const fixture = await launchLocalApp({ offline: true });
  let primaryError: unknown;
  try {
    await waitForHome(fixture.page);
    const fresh = await fixture.page.evaluate(async (settingKeys) => {
      const bridge = window.__ENJOY_APP__;
      const getSetting = bridge.userSettings.get as unknown as (key: string) => Promise<unknown>;
      const settings = await Promise.all(settingKeys.map(key => getSetting(key)));
      return {
        profileId: (await bridge.appSettings.getUser())?.id,
        settings: Object.fromEntries(settingKeys.map((key, index) => [key, settings[index]])),
      };
    }, SETTING_KEYS);
    expect(fresh.profileId).toBe("local");
    expect(fresh.settings.gpt_engine).toBeNull();
    expect(fresh.settings.stt_engine).toBeNull();
    expect(fresh.settings.tts_config).toBeNull();
    expect(fresh.settings[MIGRATION_KEY]).toMatchObject({
      version: 1,
      status: "completed",
      backup: {},
      updates: {},
    });

    const legacyGpt = {
      name: "enjoyai",
      models: { default: "gpt-4o", lookup: "legacy-lookup-a" },
      roleDefinition: "Synthetic legacy prompt for profile A",
    };
    const legacyTts = {
      engine: "enjoyai",
      model: "openai/tts-1",
      voice: "alloy",
      language: "en-US",
    };
    const validGpt = {
      name: "gemini",
      models: {
        default: "gemini-custom-b",
        lookup: "gemini-lookup-b",
        translate: "gemini-translate-b",
        analyze: "gemini-analyze-b",
        extractStory: "gemini-story-b",
      },
      roleDefinition: "Synthetic custom prompt for profile B",
    };
    const validOpenAi = {
      name: "openai",
      baseUrl: "https://api.openai.com/v1",
      models: "gpt-custom-b",
      model: "gpt-custom-b",
      transcriptionModel: "gpt-transcribe",
    };
    const validGemini = {
      name: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      models: "gemini-custom-b",
      model: "gemini-custom-b",
    };
    const validTts = {
      engine: "openai",
      model: "gpt-4o-mini-tts",
      voice: "nova",
      language: "en-US",
    };

    const pathsA = await seedProfile(fixture.page, {
      profile: PROFILE_A,
      title: "Profile A migration story",
      content: "Profile A keeps its own synthetic migration text.",
      fileBytes: "profile-a-owned-file-bytes\n",
      settings: {
        gpt_engine: legacyGpt,
        stt_engine: "enjoy_azure",
        tts_config: legacyTts,
      },
    });
    const pathsB = await seedProfile(fixture.page, {
      profile: PROFILE_B,
      title: "Profile B migration story",
      content: "Profile B keeps a different synthetic provider text.",
      fileBytes: "profile-b-owned-file-bytes\n",
      settings: {
        gpt_engine: validGpt,
        stt_engine: "openai",
        tts_config: validTts,
        openai: validOpenAi,
        gemini: validGemini,
      },
    });
    expect(path.resolve(pathsA.database)).not.toBe(path.resolve(pathsB.database));
    expect(path.resolve(pathsA.root)).not.toBe(path.resolve(pathsB.root));

    await switchProfile(fixture.page, PROFILE_A);
    const expectedA = {
      profileId: PROFILE_A.id,
      content: "Profile A keeps its own synthetic migration text.",
      settings: {
        gpt_engine: { name: "needs-selection", models: { default: "" } },
        stt_engine: "needs-selection",
        tts_config: { engine: "needs-selection" },
      },
    };
    const aAfterMigration = await readProfileEvidence(fixture.page, pathsA, expectedA);
    const aMarker = decode((await queryLocalDatabase<{ value: unknown }>(
      pathsA.database,
      "SELECT value FROM user_settings WHERE key = ?",
      [MIGRATION_KEY],
    ))[0]?.value) as { backup?: Record<string, unknown> };
    expect(aMarker.backup).toEqual({
      gptEngine: legacyGpt,
      sttEngine: "enjoy_azure",
      ttsConfig: legacyTts,
    });

    await reconnectCurrentProfile(fixture.page, PROFILE_A.id);
    expect(await readProfileEvidence(fixture.page, pathsA, expectedA)).toEqual(aAfterMigration);

    await switchProfile(fixture.page, PROFILE_B);
    const expectedB = {
      profileId: PROFILE_B.id,
      content: "Profile B keeps a different synthetic provider text.",
      settings: {
        gpt_engine: validGpt,
        stt_engine: "openai",
        tts_config: validTts,
        openai: validOpenAi,
        gemini: validGemini,
      },
    };
    const bAfterMigration = await readProfileEvidence(fixture.page, pathsB, expectedB);
    const bMarker = decode((await queryLocalDatabase<{ value: unknown }>(
      pathsB.database,
      "SELECT value FROM user_settings WHERE key = ?",
      [MIGRATION_KEY],
    ))[0]?.value);
    expect(bMarker).toMatchObject({
      version: 1,
      status: "completed",
      backup: {},
      updates: {},
    });
    expect(aAfterMigration.rowDigest).not.toBe(bAfterMigration.rowDigest);
    expect(aAfterMigration.fileHash).not.toBe(bAfterMigration.fileHash);
    expect(aAfterMigration.settingsDigest).not.toBe(bAfterMigration.settingsDigest);

    await switchProfile(fixture.page, PROFILE_A);
    expect(await readProfileEvidence(fixture.page, pathsA, expectedA)).toEqual(aAfterMigration);

    await fixture.restart({ offline: true });
    await waitForHome(fixture.page);
    expect(await readProfileEvidence(fixture.page, pathsA, expectedA)).toEqual(aAfterMigration);

    await switchProfile(fixture.page, PROFILE_B);
    expect(await readProfileEvidence(fixture.page, pathsB, expectedB)).toEqual(bAfterMigration);
    const sessions = await fixture.page.evaluate(() => window.__ENJOY_APP__.appSettings.getSessions());
    expect(sessions.map(session => session.id)).toEqual(
      expect.arrayContaining([PROFILE_A.id, PROFILE_B.id]),
    );

    const policy = await fixture.page.evaluate(() =>
      window.__ENJOY_APP__.app.networkPolicyDiagnostics());
    expect(policy.blockedAttemptCount).toBe(0);
    expect(policy.legacyBackendOperationCount).toBe(0);
    fixture.assertNoRuntimeIssues();

    await writeReceipt(testInfo, "provider-migration-profiles.json", {
      packaged: true,
      offline: true,
      sameDisposableLibrary: true,
      fresh: {
        profileId: fresh.profileId,
        textSelectionDefault: "needs-selection",
        transcriptionSelectionDefault: null,
        synthesisSelectionDefault: "needs-selection",
        persistedProviderValuesAbsent: true,
        migrationDigest: digest(fresh.settings[MIGRATION_KEY]),
      },
      profiles: [aAfterMigration, bAfterMigration],
      sameStoryIdAcrossDistinctDatabases: STORY_ID,
      legacyProfileMigrated: true,
      validBindingsAndPromptPreserved: true,
      reconnectStable: true,
      switchBackStable: true,
      fullRestartStable: true,
      networkPolicy: {
        blockedAttemptCount: policy.blockedAttemptCount,
        legacyBackendOperationCount: policy.legacyBackendOperationCount,
      },
      limits: [
        "Synthetic provider configuration only; no provider inference or credential was used",
        "Disposable packaged-app profiles only; no real user library was opened",
      ],
      runtime: fixture.runtimeDiagnostics(),
    });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await fixture.close().catch(error => {
      if (!primaryError) throw error;
    });
  }
});
