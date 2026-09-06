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
      disconnect: async () => {
        disconnectCalls.push("disconnect");
      },
    });

    const connectResult = lifecycle.connect();
    await connectStarted.promise;
    const disconnectResult = lifecycle.disconnect();
    connection.resolve({ state: "connected", path: "library-1/db.sqlite" });

    assert.deepEqual(await connectResult, { kind: "stale" });
    await disconnectResult;
    assert.deepEqual(disconnectCalls, ["disconnect", "disconnect"]);
    lifecycle.dispose();
  });

  await test("logout invalidates a deferred user probe before it can connect", async () => {
    const user = deferred();
    const disconnectCalls = [];
    const lifecycle = createDbLifecycle({
      getUser: () => user.promise,
      getLibrary: async () => "library-1",
      connect: async () => ({ state: "connected", path: "library-1/db.sqlite" }),
      disconnect: async () => {
        disconnectCalls.push("disconnect");
      },
    });

    const connectResult = lifecycle.connect();
    await nextTurn();
    const disconnectResult = lifecycle.disconnect();
    user.resolve({ id: "user-1" });

    assert.deepEqual(await connectResult, { kind: "stale" });
    await disconnectResult;
    assert.deepEqual(disconnectCalls, ["disconnect"]);
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
      connect: async () => ({ state: "connected", path: "library-1/db.sqlite" }),
      disconnect: async () => {
        disconnectCalls.push("disconnect");
      },
    });

    assert.deepEqual(await lifecycle.connect(), { kind: "session-changed" });
    assert.deepEqual(disconnectCalls, ["disconnect"]);
    lifecycle.dispose();
  });

  await test(
    "AppSettings skips stale sync after logout while connect is pending",
    async () => {
      const connection = deferred();
      const connectStarted = deferred();
      let active = true;
      let localProfileCalls = 0;
      let persistProfileCalls = 0;
      let cableCalls = 0;
      let applyProfileCalls = 0;

      const syncPromise = syncDbSession("user-1", null, {
        connect: () => {
          connectStarted.resolve();
          return connection.promise;
        },
        isActive: () => active,
        persistAuthenticatedProfile: async () => {
          persistProfileCalls += 1;
        },
        createCable: async () => {
          cableCalls += 1;
        },
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
      assert.equal(persistProfileCalls, 0);
      assert.equal(cableCalls, 0);
      assert.equal(applyProfileCalls, 0);
    }
  );

  console.info(`check-db-lifecycle: PASS (${tests.length} serialized lifecycle cases)`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
