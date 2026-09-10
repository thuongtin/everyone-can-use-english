import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-db-lifecycle-"));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

try {
  const output = path.join(temp, "db-lifecycle.mjs");
  await build({
    stdin: {
      contents: `export { createDbLifecycle } from "./src/renderer/lib/db-lifecycle.ts";
export { syncDbSession } from "./src/renderer/lib/db-session-sync.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });

  const { createDbLifecycle, syncDbSession } = await import(
    `${pathToFileURL(output).href}?test=${Date.now()}`
  );
  const tests = [];
  const test = async (name, callback) => {
    await callback();
    tests.push(name);
  };

  await test("logout invalidates an in-flight connect and serializes disconnect", async () => {
    const connection = deferred();
    const connectStarted = deferred();
    const disconnectCalls = [];
    const lifecycle = createDbLifecycle({
      getUser: async () => ({ id: "user-1" }),
      getLibrary: async () => "library-1",
      connect: () => {
        connectStarted.resolve();
        return connection.promise;
      },
      disconnect: async (connectionId) => {
        disconnectCalls.push(connectionId);
      },
    });

    const connectResult = lifecycle.connect();
    await connectStarted.promise;
    const disconnectResult = lifecycle.disconnect();
    connection.resolve({ state: "connected", path: "library-1/db.sqlite", connectionId: "connection-1", profileId: "user-1" });

    assert.deepEqual(await connectResult, { kind: "stale" });
    await disconnectResult;
    assert.deepEqual(disconnectCalls, ["connection-1", undefined]);
    lifecycle.dispose();
  });

  await test("logout invalidates a deferred user probe before it can connect", async () => {
    const user = deferred();
    const disconnectCalls = [];
    const lifecycle = createDbLifecycle({
      getUser: () => user.promise,
      getLibrary: async () => "library-1",
      connect: async () => ({ state: "connected", path: "library-1/db.sqlite" }),
      disconnect: async (connectionId) => {
        disconnectCalls.push(connectionId);
      },
    });

    const connectResult = lifecycle.connect();
    await nextTurn();
    const disconnectResult = lifecycle.disconnect();
    user.resolve({ id: "user-1" });

    assert.deepEqual(await connectResult, { kind: "stale" });
    await disconnectResult;
    assert.deepEqual(disconnectCalls, [undefined]);
    lifecycle.dispose();
  });

  await test("rejecting a readiness probe is retryable and does not poison the next probe", async () => {
    let attempts = 0;
    const lifecycle = createDbLifecycle({
      getUser: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary settings failure");
        return { id: "user-1" };
      },
      getLibrary: async () => "library-1",
      connect: async () => ({ state: "connected", path: "library-1/db.sqlite" }),
      disconnect: async () => {},
    });

    assert.equal((await lifecycle.probe()).kind, "probe-error");
    assert.deepEqual(await lifecycle.probe(), {
      kind: "ready",
      userId: "user-1",
      library: "library-1",
    });
    lifecycle.dispose();
  });

  await test("a session change after connect closes the stale database", async () => {
    let userRead = 0;
    const disconnectCalls = [];
    const lifecycle = createDbLifecycle({
      getUser: async () => {
        userRead += 1;
        return { id: userRead === 1 ? "user-1" : "user-2" };
      },
      getLibrary: async () => "library-1",
      connect: async () => ({ state: "connected", path: "library-1/db.sqlite", connectionId: "connection-1", profileId: "user-1" }),
      disconnect: async (connectionId) => {
        disconnectCalls.push(connectionId);
      },
    });

    assert.deepEqual(await lifecycle.connect(), { kind: "session-changed" });
    assert.deepEqual(disconnectCalls, ["connection-1"]);
    lifecycle.dispose();
  });

  await test("retains the actual connection receipt on repeated connect", async () => {
    let connectCalls = 0;
    const receipt = { state: "connected", path: "library-1/db.sqlite", connectionId: "connection-1", profileId: "user-1" };
    const lifecycle = createDbLifecycle({
      getUser: async () => ({ id: "user-1" }),
      getLibrary: async () => "library-1",
      connect: async () => { connectCalls += 1; return receipt; },
      disconnect: async () => {},
    });
    const first = await lifecycle.connect();
    const second = await lifecycle.connect();
    assert.equal(first.kind, "connected");
    assert.deepEqual(second, first);
    assert.equal(connectCalls, 1);
    lifecycle.dispose();
  });

  await test("passes the stale response token when a connect is invalidated", async () => {
    const connection = deferred();
    const connectStarted = deferred();
    const disconnectCalls = [];
    const lifecycle = createDbLifecycle({
      getUser: async () => ({ id: "user-1" }),
      getLibrary: async () => "library-1",
      connect: () => {
        connectStarted.resolve();
        return connection.promise;
      },
      disconnect: async (connectionId) => { disconnectCalls.push(connectionId); },
    });
    const pending = lifecycle.connect();
    await connectStarted.promise;
    const logout = lifecycle.disconnect();
    connection.resolve({ state: "connected", path: "library-1/db.sqlite", connectionId: "stale-connection", profileId: "user-1" });
    assert.deepEqual(await pending, { kind: "stale" });
    await logout;
    assert.deepEqual(disconnectCalls, ["stale-connection", undefined]);
    lifecycle.dispose();
  });

  await test("captures the old token so a queued new connection survives disconnect", async () => {
    const closing = deferred();
    const disconnectCalls = [];
    let connectCalls = 0;
    const lifecycle = createDbLifecycle({
      getUser: async () => ({ id: "user-1" }),
      getLibrary: async () => "library-1",
      connect: async () => ({ state: "connected", path: "library-1/db.sqlite", connectionId: `connection-${++connectCalls}`, profileId: "user-1" }),
      disconnect: async (connectionId) => { disconnectCalls.push(connectionId); if (connectionId === "connection-1") await closing.promise; },
    });
    assert.equal((await lifecycle.connect()).kind, "connected");
    const disconnect = lifecycle.disconnect();
    const reconnect = lifecycle.connect();
    closing.resolve();
    assert.equal((await disconnect), undefined);
    const connected = await reconnect;
    assert.equal(connected.kind, "connected");
    assert.deepEqual(disconnectCalls, ["connection-1"]);
    assert.equal(connected.connection.connectionId, "connection-2");
    lifecycle.dispose();
  });

  await test("rejects a main connection whose profile differs from the account", async () => {
    const disconnectCalls = [];
    const lifecycle = createDbLifecycle({
      getUser: async () => ({ id: "user-1" }),
      getLibrary: async () => "library-1",
      connect: async () => ({ state: "connected", path: "library-1/db.sqlite", connectionId: "wrong-profile", profileId: "user-2" }),
      disconnect: async (connectionId) => { disconnectCalls.push(connectionId); },
    });
    assert.deepEqual(await lifecycle.connect(), { kind: "session-changed" });
    assert.deepEqual(disconnectCalls, ["wrong-profile"]);
    lifecycle.dispose();
  });

  await test(
    "AppSettings skips stale sync after logout while connect is pending",
    async () => {
      const connection = deferred();
      const connectStarted = deferred();
      let active = true;
      let localProfileCalls = 0;
      let applyProfileCalls = 0;

      const syncPromise = syncDbSession("user-1", {
        connect: () => {
          connectStarted.resolve();
          return connection.promise;
        },
        isActive: () => active,
        getLocalProfile: async () => {
          localProfileCalls += 1;
          return { id: "user-1", name: "Fixture" };
        },
        applyLocalProfile: async () => {
          applyProfileCalls += 1;
        },
      });

      await connectStarted.promise;
      active = false;
      connection.resolve({
        kind: "connected",
        connection: { state: "connected" },
        userId: "user-1",
      });

      assert.deepEqual(await syncPromise, { kind: "stale" });
      assert.equal(localProfileCalls, 0);
      assert.equal(applyProfileCalls, 0);
    }
  );

  console.info(`check-db-lifecycle: PASS (${tests.length} serialized lifecycle cases)`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
