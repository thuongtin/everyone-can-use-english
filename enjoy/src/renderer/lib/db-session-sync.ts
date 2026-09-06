import type { DbLifecycleConnectResult } from "./db-lifecycle";

export type DbSessionProfile = Pick<UserType, "id" | "name">;

export type DbSessionSyncDependencies = {
  connect: () => Promise<DbLifecycleConnectResult | undefined>;
  isActive: () => boolean;
  persistAuthenticatedProfile: () => Promise<void>;
  createCable: () => Promise<void>;
  getLocalProfile: () => Promise<DbSessionProfile | null | undefined>;
  applyLocalProfile: (profile: DbSessionProfile) => Promise<void> | void;
};

export type DbSessionSyncResult =
  | { kind: "synced" }
  | { kind: "stale" }
  | { kind: "not-connected" };

export const syncDbSession = async (
  sessionUserId: string,
  accessToken: string | null | undefined,
  dependencies: DbSessionSyncDependencies
): Promise<DbSessionSyncResult> => {
  const connectResult = await dependencies.connect();
  if (!dependencies.isActive()) return { kind: "stale" };
  if (
    connectResult?.kind !== "connected" ||
    connectResult.userId !== sessionUserId
  ) {
    return { kind: "not-connected" };
  }

  if (accessToken) {
    await dependencies.persistAuthenticatedProfile();
    if (!dependencies.isActive()) return { kind: "stale" };
    await dependencies.createCable();
    if (!dependencies.isActive()) return { kind: "stale" };
    return { kind: "synced" };
  }

  const profile = await dependencies.getLocalProfile();
  if (
    !dependencies.isActive() ||
    !profile?.id ||
    profile.id !== sessionUserId
  ) {
    return { kind: "stale" };
  }
  await dependencies.applyLocalProfile(profile);
  if (!dependencies.isActive()) return { kind: "stale" };
  return { kind: "synced" };
};
