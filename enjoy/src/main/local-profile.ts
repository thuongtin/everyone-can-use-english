import {
  constants,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import path from "node:path";

export { LOCAL_PROFILE_MODE } from "@/constants/runtime";
export const DEFAULT_LOCAL_PROFILE_ID = "local";
export const DEFAULT_LOCAL_PROFILE_NAME = "Local";

export type LocalProfileNameSource = "explicit" | "discovered" | "default" | "database";
export type LocalProfile = {
  id: string;
  name: string;
  nameSource?: LocalProfileNameSource;
};

const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/u;

export const normalizeLocalProfile = (value: unknown): LocalProfile | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { id?: unknown; name?: unknown; nameSource?: unknown };
  const id = String(candidate.id ?? "");
  if (!PROFILE_ID_PATTERN.test(id)) return null;
  const name = typeof candidate.name === "string" && candidate.name.trim()
    ? candidate.name.trim()
    : DEFAULT_LOCAL_PROFILE_NAME;
  const nameSource = ["explicit", "discovered", "default", "database"].includes(
    String(candidate.nameSource),
  )
    ? candidate.nameSource as LocalProfileNameSource
    : undefined;
  return nameSource ? { id, name, nameSource } : { id, name };
};

export const discoverLocalProfiles = (
  library: string,
  databaseNames: readonly string[],
): LocalProfile[] => {
  if (!existsSync(library)) return [];
  return readdirSync(library, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && PROFILE_ID_PATTERN.test(entry.name))
    .filter((entry) => databaseNames.some((name) => existsSync(path.join(library, entry.name, name))))
    .map((entry) => ({
      id: entry.name,
      name: DEFAULT_LOCAL_PROFILE_NAME,
      nameSource: "discovered" as const,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
};

export const resolveInitialLocalProfile = (
  current: unknown,
  discovered: readonly LocalProfile[],
): LocalProfile | null => {
  const stored = normalizeLocalProfile(current);
  if (stored) return stored;
  if (discovered.length > 1) return null;
  return discovered[0] || {
    id: DEFAULT_LOCAL_PROFILE_ID,
    name: DEFAULT_LOCAL_PROFILE_NAME,
    nameSource: "default",
  };
};

export const resolveProfileForLibrary = (
  current: unknown,
  discovered: readonly LocalProfile[],
): LocalProfile | null => {
  const stored = normalizeLocalProfile(current);
  if (stored && discovered.some((profile) => profile.id === stored.id)) {
    return stored;
  }
  return resolveInitialLocalProfile(null, discovered);
};

const uniqueBackupPath = (candidate: string): string => {
  let destination = candidate;
  let sequence = 1;
  while (existsSync(destination)) {
    destination = `${candidate}.${sequence}`;
    sequence += 1;
  }
  return destination;
};

const backupPath = (source: string, suffix: string): string =>
  uniqueBackupPath(`${source}.${suffix}.${Date.now().toString().padStart(13, "0")}.bak`);

export const backupSettingsFile = (settingsFile: string): string | null => {
  if (!existsSync(settingsFile)) return null;
  const destination = backupPath(settingsFile, "local-profile");
  copyFileSync(settingsFile, destination, constants.COPYFILE_EXCL);
  chmodSync(destination, 0o600);
  return destination;
};

export const backupDisconnectedProfile = (
  library: string,
  profileId: string,
  databaseNames: readonly string[],
): string | null => {
  const profileRoot = path.join(library, profileId);
  const databases = databaseNames
    .map((name) => path.join(profileRoot, name))
    .filter((candidate) => existsSync(candidate));
  if (!databases.length) return null;

  const destination = uniqueBackupPath(
    path.join(
      profileRoot,
      "backup",
      `local-profile-pointer-${Date.now().toString().padStart(13, "0")}`,
    ),
  );
  mkdirSync(destination, { recursive: true });
  chmodSync(path.dirname(destination), 0o700);
  chmodSync(destination, 0o700);
  for (const database of databases) {
    for (const source of [database, `${database}-wal`, `${database}-shm`]) {
      if (existsSync(source)) {
        copyFileSync(source, path.join(destination, path.basename(source)), constants.COPYFILE_EXCL);
        chmodSync(path.join(destination, path.basename(source)), 0o600);
      }
    }
  }
  return destination;
};
