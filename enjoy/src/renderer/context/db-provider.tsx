import {
  createContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import log from "electron-log/renderer";
import {
  createDbLifecycle,
  type DbLifecycle,
  type DbLifecycleConnectResult,
  type DbLifecycleProbeResult,
} from "@renderer/lib/db-lifecycle";

const logger = log.scope("db-provider.tsx");

type DbStateEnum =
  | "connected"
  | "connecting"
  | "error"
  | "disconnected"
  | "reconnecting";
type DbProviderState = {
  state: DbStateEnum;
  path?: string;
  error?: string;
  connect?: () => Promise<DbLifecycleConnectResult>;
  disconnect?: () => Promise<void>;
  addDblistener?: (callback: (event: CustomEvent) => void) => void;
  removeDbListener?: (callback: (event: CustomEvent) => void) => void;
};

const initialState: DbProviderState = {
  state: "disconnected",
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Database lifecycle failed";
};

export const DbProviderContext = createContext<DbProviderState>(initialState);

export const DbProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<DbStateEnum>("disconnected");
  const [path, setPath] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const EnjoyApp = window.__ENJOY_APP__;
  const stateRef = useRef<DbStateEnum>("disconnected");
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectWhenReadyRef = useRef<(() => Promise<void>) | null>(null);
  const autoReconnectRef = useRef(false);
  const probeDisconnectedRef = useRef(true);
  const connectedUserIdRef = useRef<string | undefined>(undefined);
  const connectPromiseRef = useRef<
    Promise<DbLifecycleConnectResult> | null
  >(null);

  const lifecycle = useMemo<DbLifecycle>(
    () =>
      createDbLifecycle({
        getUser: EnjoyApp.appSettings.getUser,
        getLibrary: EnjoyApp.appSettings.getLibrary,
        connect: EnjoyApp.db.connect,
        disconnect: EnjoyApp.db.disconnect,
      }),
    [EnjoyApp]
  );

  const updateState = useCallback((nextState: DbStateEnum) => {
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  const scheduleReconnect = useCallback((delayMs: number) => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      void connectWhenReadyRef.current?.();
    }, delayMs);
  }, []);

  const connect = useCallback(async (): Promise<DbLifecycleConnectResult> => {
    if (stateRef.current === "connected" && connectedUserIdRef.current) {
      return {
        kind: "connected",
        connection: { state: "connected" },
        userId: connectedUserIdRef.current,
      };
    }
    if (connectPromiseRef.current) return connectPromiseRef.current;
    if (stateRef.current === "connecting") return { kind: "stale" };

    autoReconnectRef.current = true;
    probeDisconnectedRef.current = false;
    console.info("--- connecting db ---");
    updateState("connecting");
    setError(undefined);

    const connectOperation = (async () => {
      let result: DbLifecycleConnectResult;
      try {
        result = await lifecycle.connect();
      } catch (error) {
        result = { kind: "connection-error", error };
      }

      switch (result.kind) {
        case "connected":
          connectedUserIdRef.current = result.userId;
          updateState(result.connection.state);
          setPath(result.connection.path);
          setError(result.connection.error || undefined);
          return result;
        case "unauthenticated":
          connectedUserIdRef.current = undefined;
          autoReconnectRef.current = false;
          probeDisconnectedRef.current = false;
          updateState("disconnected");
          setPath(undefined);
          setError(undefined);
          return result;
        case "not-ready":
          connectedUserIdRef.current = undefined;
          autoReconnectRef.current = true;
          probeDisconnectedRef.current = false;
          updateState("reconnecting");
          scheduleReconnect(1000);
          return result;
        case "retry":
          connectedUserIdRef.current = undefined;
          autoReconnectRef.current = true;
          probeDisconnectedRef.current = false;
          updateState("reconnecting");
          setPath(result.connection.path);
          setError(result.connection.error || undefined);
          scheduleReconnect(1000);
          return result;
        case "session-changed":
          connectedUserIdRef.current = undefined;
          autoReconnectRef.current = false;
          probeDisconnectedRef.current = false;
          updateState("disconnected");
          setPath(undefined);
          setError(undefined);
          return result;
        case "stale":
          return result;
        case "probe-error":
        case "connection-error":
          connectedUserIdRef.current = undefined;
          autoReconnectRef.current = true;
          probeDisconnectedRef.current = false;
          updateState("error");
          setError(getErrorMessage(result.error));
          scheduleReconnect(5000);
          return result;
        default:
          return result;
      }
    })();
    connectPromiseRef.current = connectOperation;

    try {
      return await connectOperation;
    } finally {
      if (connectPromiseRef.current === connectOperation) {
        connectPromiseRef.current = null;
      }
    }
  }, [lifecycle, scheduleReconnect, updateState]);

  const handleProbeResult = useCallback(
    (result: DbLifecycleProbeResult) => {
      switch (result.kind) {
        case "ready":
          autoReconnectRef.current = true;
          probeDisconnectedRef.current = false;
          void connect();
          return;
        case "unauthenticated":
          autoReconnectRef.current = false;
          probeDisconnectedRef.current = false;
          if (stateRef.current !== "disconnected") {
            updateState("disconnected");
          }
          setPath(undefined);
          setError(undefined);
          return;
        case "not-ready":
          autoReconnectRef.current = true;
          probeDisconnectedRef.current = false;
          updateState("reconnecting");
          scheduleReconnect(1000);
          return;
        case "probe-error":
          autoReconnectRef.current = true;
          probeDisconnectedRef.current = false;
          updateState("error");
          setError(getErrorMessage(result.error));
          scheduleReconnect(5000);
          return;
        case "stale":
          return;
        default:
          return;
      }
    },
    [connect, scheduleReconnect, updateState]
  );

  const connectWhenReady = useCallback(async () => {
    let result: DbLifecycleProbeResult;
    try {
      result = await lifecycle.probe();
    } catch (error) {
      result = { kind: "probe-error", error };
    }

    handleProbeResult(result);
  }, [handleProbeResult, lifecycle]);
  connectWhenReadyRef.current = connectWhenReady;

  const disconnect = useCallback(async () => {
    autoReconnectRef.current = false;
    probeDisconnectedRef.current = false;
    connectPromiseRef.current = null;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    console.info("--- disconnecting db ---");
    connectedUserIdRef.current = undefined;
    updateState("disconnected");
    await lifecycle.disconnect();

    // A new login may have queued a connect while disconnect was closing the old session.
    if (stateRef.current === "disconnected") {
      setPath(undefined);
      setError(undefined);
    }
  }, [lifecycle, updateState]);

  useEffect(() => {
    console.info(
      "--- db state changed ---\n",
      `state: ${state};\n`,
      `path: ${path};\n`,
      `error: ${error};\n`
    );

    if (state === "connected" || state === "connecting") return;
    if (state === "disconnected" && !probeDisconnectedRef.current) return;
    if (state === "error" && !autoReconnectRef.current) return;

    scheduleReconnect(state === "error" ? 5000 : 1000);

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [error, path, scheduleReconnect, state]);

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      lifecycle.dispose();
    };
  }, [lifecycle]);

  const addDblistener = (callback: (event: CustomEvent) => void) => {
    document.addEventListener("db-on-transaction", callback);
  };

  const removeDbListener = (callback: (event: CustomEvent) => void) => {
    document.removeEventListener("db-on-transaction", callback);
  };

  useEffect(() => {
    if (state === "connected") {
      EnjoyApp.db.onTransaction((_event, state) => {
        logger.debug("db-on-transaction", state);

        const event = new CustomEvent("db-on-transaction", { detail: state });
        document.dispatchEvent(event);
      });
    }

    return () => {
      EnjoyApp.db.removeListeners();
    };
  }, [state]);

  return (
    <DbProviderContext.Provider
      value={{
        state,
        path,
        error,
        connect,
        disconnect,
        addDblistener,
        removeDbListener,
      }}
    >
      {children}
    </DbProviderContext.Provider>
  );
};
