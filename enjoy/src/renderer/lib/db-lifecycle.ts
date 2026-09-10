export type DbLifecycleState =
  | "connected"
  | "connecting"
  | "error"
  | "disconnected"
  | "reconnecting";

export type DbConnectionState = {
  state: DbLifecycleState;
  path?: string;
  error?: string | null;
  connectionId?: string;
  profileId?: string;
};

export type DbLifecycleUser = {
  id?: string | null;
};

export type DbLifecycleDependencies = {
  getUser: () => Promise<DbLifecycleUser | null | undefined>;
  getLibrary: () => Promise<string | null | undefined>;
  connect: () => Promise<DbConnectionState>;
  disconnect: (connectionId?: string) => Promise<void>;
};

export type DbLifecycleProbeResult =
  | { kind: "ready"; userId: string; library: string }
  | { kind: "unauthenticated" }
  | { kind: "not-ready" }
  | { kind: "probe-error"; error: unknown }
  | { kind: "stale" };

export type DbLifecycleConnectResult =
  | { kind: "connected"; connection: DbConnectionState; userId: string }
  | { kind: "unauthenticated" }
  | { kind: "not-ready" }
  | { kind: "probe-error"; error: unknown }
  | { kind: "connection-error"; error: unknown }
  | { kind: "retry"; connection: DbConnectionState }
  | { kind: "session-changed" }
  | { kind: "stale" };

export type DbLifecycle = {
  probe: () => Promise<DbLifecycleProbeResult>;
  connect: () => Promise<DbLifecycleConnectResult>;
  disconnect: () => Promise<void>;
  dispose: () => void;
};

const sameUserId = (left: string, right: string) => String(left) === String(right);

const enqueue = <T>(
  queue: { current: Promise<void> },
  operation: () => Promise<T>
): Promise<T> => {
  const result = queue.current.then(operation, operation);
  queue.current = result.then(
    (): void => undefined,
    (): void => undefined
  );
  return result;
};

export const createDbLifecycle = (
  dependencies: DbLifecycleDependencies
): DbLifecycle => {
  const queue = { current: Promise.resolve() };
  let generation = 0;
  let disposed = false;
  let activeConnection: DbConnectionState | undefined;
  let activeConnectionId: string | undefined;
  let activeUserId: string | undefined;
  let activeLibrary: string | undefined;

  const clearActiveConnection = () => {
    activeConnection = undefined;
    activeConnectionId = undefined;
    activeUserId = undefined;
    activeLibrary = undefined;
  };

  const isCurrent = (intent: number) => !disposed && generation === intent;

  const disconnectQuietly = async (connectionId?: string) => {
    try {
      await dependencies.disconnect(connectionId);
    } catch {
      // Preserve the original stale outcome while best-effort closing the connection.
    }
  };

  const probe = (): Promise<DbLifecycleProbeResult> => {
    if (disposed) return Promise.resolve({ kind: "stale" });

    const intent = ++generation;
    return enqueue(queue, async () => {
      if (!isCurrent(intent)) return { kind: "stale" };

      let user: DbLifecycleUser | null | undefined;
      try {
        user = await dependencies.getUser();
      } catch (error) {
        return isCurrent(intent)
          ? { kind: "probe-error", error }
          : { kind: "stale" };
      }
      if (!isCurrent(intent)) return { kind: "stale" };
      if (!user?.id) return { kind: "unauthenticated" };

      let library: string | null | undefined;
      try {
        library = await dependencies.getLibrary();
      } catch (error) {
        return isCurrent(intent)
          ? { kind: "probe-error", error }
          : { kind: "stale" };
      }
      if (!isCurrent(intent)) return { kind: "stale" };
      if (!library) return { kind: "not-ready" };

      return { kind: "ready", userId: user.id, library };
    });
  };

  const connect = (): Promise<DbLifecycleConnectResult> => {
    if (disposed) return Promise.resolve({ kind: "stale" });

    const intent = ++generation;
    return enqueue(queue, async () => {
      if (!isCurrent(intent)) return { kind: "stale" };

      let user: DbLifecycleUser | null | undefined;
      try {
        user = await dependencies.getUser();
      } catch (error) {
        return isCurrent(intent)
          ? { kind: "probe-error", error }
          : { kind: "stale" };
      }
      if (!isCurrent(intent)) return { kind: "stale" };
      if (!user?.id) return { kind: "unauthenticated" };

      let library: string | null | undefined;
      try {
        library = await dependencies.getLibrary();
      } catch (error) {
        return isCurrent(intent)
          ? { kind: "probe-error", error }
          : { kind: "stale" };
      }
      if (!isCurrent(intent)) return { kind: "stale" };
      if (!library) return { kind: "not-ready" };

      if (activeConnection && activeUserId && activeLibrary) {
        if (sameUserId(activeUserId, user.id) && activeLibrary === library) {
          return {
            kind: "connected",
            connection: activeConnection,
            userId: activeUserId,
          };
        }

        await disconnectQuietly(activeConnectionId);
        clearActiveConnection();
        if (!isCurrent(intent)) return { kind: "stale" };
      }

      let connection: DbConnectionState;
      try {
        connection = await dependencies.connect();
      } catch (error) {
        if (!isCurrent(intent)) {
          await disconnectQuietly();
          return { kind: "stale" };
        }
        return { kind: "connection-error", error };
      }
      if (!isCurrent(intent)) {
        await disconnectQuietly(connection.connectionId);
        return { kind: "stale" };
      }

      if (connection.state === "error") {
        return {
          kind: "connection-error",
          error: connection.error || "Database connection failed",
        };
      }
      if (connection.state !== "connected") {
        return { kind: "retry", connection };
      }

      if (
        !connection.connectionId
        || !connection.profileId
        || !sameUserId(connection.profileId, user.id)
      ) {
        await disconnectQuietly(connection.connectionId);
        return { kind: "session-changed" };
      }

      let currentUser: DbLifecycleUser | null | undefined;
      try {
        currentUser = await dependencies.getUser();
      } catch (error) {
        await disconnectQuietly(connection.connectionId);
        return isCurrent(intent)
          ? { kind: "probe-error", error }
          : { kind: "stale" };
      }
      if (!isCurrent(intent)) {
        await disconnectQuietly(connection.connectionId);
        return { kind: "stale" };
      }
      if (!currentUser?.id) {
        await disconnectQuietly(connection.connectionId);
        return { kind: "unauthenticated" };
      }
      if (!sameUserId(currentUser.id, user.id)) {
        await disconnectQuietly(connection.connectionId);
        return { kind: "session-changed" };
      }

      let currentLibrary: string | null | undefined;
      try {
        currentLibrary = await dependencies.getLibrary();
      } catch (error) {
        await disconnectQuietly(connection.connectionId);
        return isCurrent(intent)
          ? { kind: "probe-error", error }
          : { kind: "stale" };
      }
      if (!isCurrent(intent)) {
        await disconnectQuietly(connection.connectionId);
        return { kind: "stale" };
      }
      if (!currentLibrary) {
        await disconnectQuietly(connection.connectionId);
        return { kind: "not-ready" };
      }
      if (currentLibrary !== library) {
        await disconnectQuietly(connection.connectionId);
        return { kind: "session-changed" };
      }

      activeConnection = connection;
      activeConnectionId = connection.connectionId;
      activeUserId = connection.profileId;
      activeLibrary = currentLibrary;
      return { kind: "connected", connection, userId: connection.profileId };
    });
  };

  const disconnect = async () => {
    const connectionId = activeConnectionId;
    clearActiveConnection();
    generation += 1;
    await enqueue(queue, async () => {
      await dependencies.disconnect(connectionId);
    });
  };

  const dispose = () => {
    disposed = true;
    generation += 1;
  };

  return { probe, connect, disconnect, dispose };
};
