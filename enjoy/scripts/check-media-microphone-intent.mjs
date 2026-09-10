import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-microphone-intent-"));

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

try {
  const output = path.join(temp, "microphone-intent.mjs");
  const providerSource = await readFile(
    path.join(root, "src/renderer/context/media-shadow-provider.tsx"),
    "utf8"
  );
  const intentStart = providerSource.indexOf(
    "export type MicrophoneRecordingIntentOptions"
  );
  const intentEnd = providerSource.indexOf(
    "export const MediaShadowProviderContext"
  );
  assert.notEqual(
    intentStart,
    -1,
    "media shadow provider must export the microphone intent controller"
  );
  assert.ok(intentEnd > intentStart, "microphone intent controller must be complete");

  await build({
    stdin: {
      contents: providerSource.slice(intentStart, intentEnd),
      resolveDir: root,
      loader: "tsx",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });

  const { createMicrophoneRecordingIntent } = await import(
    `${pathToFileURL(output).href}?test=${Date.now()}`
  );
  const [recordButtonSource, readButtonSource, lookupSource] = await Promise.all([
    readFile(
      path.join(
        root,
        "src/renderer/components/medias/media-bottom-panel/media-current-recording.tsx"
      ),
      "utf8"
    ),
    readFile(
      path.join(
        root,
        "src/renderer/components/medias/media-left-panel/media-transcription-read-button.tsx"
      ),
      "utf8"
    ),
    readFile(
      path.join(root, "src/renderer/components/widgets/lookup/lookup-widget.tsx"),
      "utf8"
    ),
  ]);

  const tests = [];
  const test = async (name, callback) => {
    await callback();
    tests.push(name);
  };

  await test("mounted media recording controls do not request access directly", async () => {
    assert.equal(recordButtonSource.match(/mediaAccess\("microphone"\)/g)?.length || 0, 0);
    assert.equal(readButtonSource.match(/mediaAccess\("microphone"\)/g)?.length || 0, 0);
    assert.equal(lookupSource.match(/mediaAccess\("microphone"\)/g)?.length || 0, 1);
    assert.match(lookupSource, /createMicrophoneRecordingIntent\(\{/);
    assert.match(readButtonSource, /cancelPendingRecording\(\)/);
  });

  await test("mount, open, switch, and playback do not request microphone access", async () => {
    let accessRequests = 0;
    let scope = "video-1";
    const intent = createMicrophoneRecordingIntent({
      requestAccess: async () => {
        accessRequests += 1;
        return true;
      },
      startRecording: () => {},
      getScope: () => scope,
      onDenied: () => {},
      onError: () => {},
    });

    intent.syncRecordingState(false);
    scope = "video-2";
    intent.invalidate();
    intent.syncRecordingState(false);
    await settle();

    assert.equal(accessRequests, 0);
  });

  await test("one record intent makes one access request and starts once", async () => {
    const permission = deferred();
    let accessRequests = 0;
    let starts = 0;
    const intent = createMicrophoneRecordingIntent({
      requestAccess: () => {
        accessRequests += 1;
        return permission.promise;
      },
      startRecording: () => {
        starts += 1;
      },
      getScope: () => "video-1",
      onDenied: () => {},
      onError: () => {},
    });

    void intent.requestStart();
    void intent.requestStart();
    assert.equal(accessRequests, 1);
    permission.resolve(true);
    await settle();

    assert.equal(starts, 1);
    void intent.requestStart();
    assert.equal(accessRequests, 1);
  });

  await test("denial and errors return to idle so the user can retry", async () => {
    const permissions = [false, true, true];
    let accessRequests = 0;
    let denied = 0;
    let errors = 0;
    let starts = 0;
    const intent = createMicrophoneRecordingIntent({
      requestAccess: async () => permissions[accessRequests++],
      startRecording: () => {
        starts += 1;
      },
      getScope: () => "video-1",
      onDenied: () => {
        denied += 1;
      },
      onError: () => {
        errors += 1;
      },
    });

    await intent.requestStart();
    await intent.requestStart();
    intent.recorderRejected(new DOMException("device busy", "NotReadableError"));
    await intent.requestStart();

    assert.equal(accessRequests, 3);
    assert.equal(denied, 1);
    assert.equal(errors, 1);
    assert.equal(starts, 2);
  });

  await test("permission resolving after unmount or media switch cannot start recording", async () => {
    const unmountedPermission = deferred();
    const switchedPermission = deferred();
    let scope = "video-1";
    let starts = 0;

    const unmountedIntent = createMicrophoneRecordingIntent({
      requestAccess: () => unmountedPermission.promise,
      startRecording: () => {
        starts += 1;
      },
      getScope: () => scope,
      onDenied: () => {},
      onError: () => {},
    });
    void unmountedIntent.requestStart();
    unmountedIntent.invalidate();
    unmountedPermission.resolve(true);
    await settle();

    const switchedIntent = createMicrophoneRecordingIntent({
      requestAccess: () => switchedPermission.promise,
      startRecording: () => {
        starts += 1;
      },
      getScope: () => scope,
      onDenied: () => {},
      onError: () => {},
    });
    void switchedIntent.requestStart();
    scope = "video-2";
    switchedPermission.resolve(true);
    await settle();

    assert.equal(starts, 0);
  });

  console.info(
    `check-media-microphone-intent: PASS (${tests.length} intent and lifecycle checks)`
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
