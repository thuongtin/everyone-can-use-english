import type { DbLifecycleConnectResult } from "./db-lifecycle";

export type DbSessionProfile = Pick<UserType, "id" | "name" | "nameSource">;

export type DbSessionSyncDependencies = {
  connect: () => Promise<DbLifecycleConnectResult | undefined>;
  isActive: () => boolean;
  getLocalProfile: () => Promise<DbSessionProfile | null | undefined>;
  applyLocalProfile: (profile: DbSessionProfile) => Promise<void> | void;
};

export type DbSessionSyncResult =
  | { kind: "synced" }
  | { kind: "stale" }
  | { kind: "not-connected" };

export const syncDbSession = async (
  sessionProfile: string | DbSessionProfile,
  dependencies: DbSessionSyncDependencies
): Promise<DbSessionSyncResult> => {
  const sessionUserId = String(
    typeof sessionProfile === "string" ? sessionProfile : sessionProfile.id
  );
  const connectResult = await dependencies.connect();
  if (!dependencies.isActive()) return { kind: "stale" };
  if (
    connectResult?.kind !== "connected" ||
    connectResult.userId !== sessionUserId
  ) {
    return { kind: "not-connected" };
  }

  const profile = await dependencies.getLocalProfile();
  if (
    !dependencies.isActive() ||
    !profile?.id ||
    String(profile.id) !== String(sessionUserId)
  ) {
    return { kind: "stale" };
  }
  const currentProfile =
    typeof sessionProfile === "string"
      ? profile
      : !sessionProfile.nameSource || sessionProfile.nameSource === "explicit"
        ? {
          ...profile,
          name: sessionProfile.name?.trim() || profile.name,
          ...(sessionProfile.nameSource ? { nameSource: "explicit" as const } : {}),
        }
        : {
          ...profile,
          nameSource: "database" as const,
        };
  await dependencies.applyLocalProfile(currentProfile);
  if (!dependencies.isActive()) return { kind: "stale" };
  return { kind: "synced" };
};
