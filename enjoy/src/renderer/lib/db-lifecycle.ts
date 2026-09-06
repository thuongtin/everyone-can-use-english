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
};

export type DbLifecycleUser = {
  id?: string | null;
};

export type DbLifecycleDependencies = {
  getUser: () => Promise<DbLifecycleUser | null | undefined>;
  getLibrary: () => Promise<string | null | undefined>;
  connect: () => Promise<DbConnectionState>;
  disconnect: () => Promise<void>;
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

const sameUserId = (left: string, right: string) => left === right;

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

  const isCurrent = (intent: number) => !disposed && generation === intent;

  const disconnectQuietly = async () => {
    try {
      await dependencies.disconnect();
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
        await disconnectQuietly();
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

      let currentUser: DbLifecycleUser | null | undefined;
      try {
        currentUser = await dependencies.getUser();
      } catch (error) {
        await disconnectQuietly();
        return isCurrent(intent)
          ? { kind: "probe-error", error }
          : { kind: "stale" };
      }
      if (!isCurrent(intent)) {
        await disconnectQuietly();
        return { kind: "stale" };
      }
      if (!currentUser?.id) {
        await disconnectQuietly();
        return { kind: "unauthenticated" };
      }
      if (!sameUserId(currentUser.id, user.id)) {
        await disconnectQuietly();
        return { kind: "session-changed" };
      }

      let currentLibrary: string | null | undefined;
      try {
        currentLibrary = await dependencies.getLibrary();
      } catch (error) {
        await disconnectQuietly();
        return isCurrent(intent)
          ? { kind: "probe-error", error }
          : { kind: "stale" };
      }
      if (!isCurrent(intent)) {
        await disconnectQuietly();
        return { kind: "stale" };
      }
      if (!currentLibrary) {
        await disconnectQuietly();
        return { kind: "not-ready" };
      }
      if (currentLibrary !== library) {
        await disconnectQuietly();
        return { kind: "session-changed" };
      }

      return { kind: "connected", connection, userId: user.id };
    });
  };

  const disconnect = async () => {
    generation += 1;
    await enqueue(queue, async () => {
      await dependencies.disconnect();
    });
  };

  const dispose = () => {
    disposed = true;
    generation += 1;
  };

  return { probe, connect, disconnect, dispose };
};
