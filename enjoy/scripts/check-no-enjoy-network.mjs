import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-network-policy-contract-"));

try {
  const output = path.join(temp, "network-policy.mjs");
  await build({
    stdin: {
      contents: [
        'export * from "./src/lib/network-policy.ts";',
        'export * from "./src/main/network-policy.ts";',
      ].join("\n"),
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });
  const policy = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

  // Offline contract only: no request in this check is sent to Enjoy or the Internet.
  const retiredHostnames = [
    "enjoy.bot",
    "ENJOY.BOT",
    "enjoy.bot.",
    "api.enjoy.bot",
    "Deep.Sub.Enjoy.Bot.",
    "api.getenjoyapp.com",
    "API.GETENJOYAPP.COM.",
    "enjoy-storage.baizhiheizi.com",
  ];
  for (const hostname of retiredHostnames) {
    assert.equal(policy.isRetiredEnjoyHostname(hostname), true, hostname);
  }
  for (const hostname of [
    "notenjoy.bot",
    "enjoy.bot.example.com",
    "getenjoyapp.com",
    "www.getenjoyapp.com",
    "baizhiheizi.com",
    "other.baizhiheizi.com",
    "enjoy.example",
    "",
  ]) {
    assert.equal(policy.isRetiredEnjoyHostname(hostname), false, hostname);
  }

  for (const url of [
    "https://enjoy.bot/api/private?token=do-not-log",
    "wss://events.enjoy.bot/socket",
    "https://user:password@ENJOY.BOT./private",
    "https://api.getenjoyapp.com/v1",
    "https://enjoy-storage.baizhiheizi.com/object",
  ]) {
    assert.equal(policy.isRetiredEnjoyUrl(url), true, url);
  }
  for (const url of [
    "https://example.com/?next=https%3A%2F%2Fenjoy.bot%2Fapi",
    "https://enjoy.bot.example.com/",
    "https://getenjoyapp.com/",
    "not a URL",
  ]) {
    assert.equal(policy.isRetiredEnjoyUrl(url), false, url);
  }

  for (const mediaPath of [
    "/Users/example/Movies/lesson.mp4",
    "relative/audio.wav",
    "C:\\Users\\example\\lesson.mp4",
    "C:/Users/example/lesson.mp4",
  ]) {
    assert.equal(
      policy.assertLocalSubprocessMediaPath(mediaPath, {
        transport: "ffmpeg",
        operation: "contract.local-media",
      }),
      mediaPath,
    );
  }
  for (const mediaPath of [
    "https://provider.example/media.mp4",
    "  https://provider.example/media.mp4  ",
    "file:///Users/example/Movies/lesson.mp4",
    "concat:lesson-1.wav|lesson-2.wav",
    "pipe:0",
    "\\\\server\\share\\lesson.mp4",
    "//server/share/lesson.mp4",
    "  //server/share/lesson.mp4  ",
    "lesson\0secret.mp4",
    "",
  ]) {
    assert.throws(
      () => policy.assertLocalSubprocessMediaPath(mediaPath, {
        transport: "ffmpeg",
        operation: "contract.local-media",
      }),
      error => error.code === "non_local_media_path"
        && (!mediaPath || !error.message.includes(mediaPath)),
      mediaPath,
    );
  }
  const beforeRetiredMedia = policy.getNetworkPolicyDiagnostics();
  assert.throws(
    () => policy.assertLocalSubprocessMediaPath(
      "https://cdn.enjoy.bot/private.m3u8?token=do-not-log",
      { transport: "ffmpeg", operation: "contract.retired-media" },
    ),
    error => error.code === "retired_enjoy_host" && !error.message.includes("do-not-log"),
  );
  const afterRetiredMedia = policy.getNetworkPolicyDiagnostics();
  assert.equal(afterRetiredMedia.blockedAttemptCount, beforeRetiredMedia.blockedAttemptCount + 1);

  const beforeBlocked = policy.getNetworkPolicyDiagnostics();
  assert.throws(
    () => policy.assertAllowedNetworkUrl(
      "https://user:password@ENJOY.BOT./private?token=do-not-log",
      { transport: "node-fetch", operation: "contract.initial" },
    ),
    error => {
      assert.equal(error.code, "retired_enjoy_host");
      assert.equal(error.hostname, "enjoy.bot");
      assert.doesNotMatch(error.message, /password|private|token|do-not-log/);
      return true;
    },
  );
  const afterBlocked = policy.getNetworkPolicyDiagnostics();
  assert.equal(afterBlocked.blockedAttemptCount, beforeBlocked.blockedAttemptCount + 1);
  assert.equal(
    afterBlocked.blockedAttempts["node-fetch|contract.initial|enjoy.bot"],
    1,
  );

  const beforeLegacy = policy.getNetworkPolicyDiagnostics();
  policy.noteLegacyBackendAttempt({
    transport: "axios?credential=secret",
    operation: "webApi.config?key=secret",
    url: "https://api.enjoy.bot/config?key=secret",
  });
  const afterLegacy = policy.getNetworkPolicyDiagnostics();
  assert.equal(
    afterLegacy.legacyBackendOperationCount,
    beforeLegacy.legacyBackendOperationCount + 1,
  );
  const legacyKeys = Object.keys(afterLegacy.legacyBackendOperations);
  assert.equal(legacyKeys.some(key => key.includes("secret")), false);
  assert.equal(legacyKeys.some(key => key.endsWith("|api.enjoy.bot")), true);
  assert.equal(JSON.stringify(afterLegacy).includes("credential"), false);

  const calls = [];
  const positiveFetch = policy.createGuardedFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response("ok", { status: 200 });
  }, { transport: "node-fetch", operation: "contract.positive" });
  const positiveResponse = await positiveFetch("https://provider.example/v1/models", {
    headers: { Authorization: "Bearer provider-secret" },
  });
  assert.equal(await positiveResponse.text(), "ok");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://provider.example/v1/models");

  const requestInputCalls = [];
  const requestInputFetch = policy.createGuardedFetch(async (input, init) => {
    requestInputCalls.push({
      input,
      init,
      body: input instanceof Request ? await input.clone().text() : init?.body,
    });
    return new Response("request-ok", { status: 200 });
  }, { transport: "sdk-fetch", operation: "contract.request-input" });
  const requestInput = new Request("https://provider.example/v1/messages", {
    method: "POST",
    body: "request body fixture",
    headers: { Authorization: "Bearer request-secret", "Content-Type": "text/plain" },
  });
  assert.equal(await (await requestInputFetch(requestInput)).text(), "request-ok");
  assert.equal(requestInputCalls.length, 1);
  assert.equal(requestInputCalls[0].input, requestInput);
  assert.equal(requestInputCalls[0].input.method, "POST");
  assert.equal(requestInputCalls[0].input.headers.get("authorization"), "Bearer request-secret");
  assert.equal(requestInputCalls[0].body, "request body fixture");
  assert.equal(requestInputCalls[0].init.redirect, "manual");

  const requestRedirectCalls = [];
  const requestRedirectFetch = policy.createGuardedFetch(async (input, init) => {
    requestRedirectCalls.push({ input, init });
    if (requestRedirectCalls.length === 1) {
      return new Response(null, {
        status: 303,
        headers: { location: "https://other-provider.example/result" },
      });
    }
    return new Response("request-redirected", { status: 200 });
  }, { transport: "sdk-fetch", operation: "contract.request-redirect" });
  const redirectingRequest = new Request("https://provider.example/v1/jobs", {
    method: "POST",
    body: "request redirect fixture",
    headers: {
      Authorization: "Bearer request-secret",
      "Api-Key": "azure-secret",
      "X-Goog-Api-Key": "google-secret",
      "Content-Type": "text/plain",
    },
  });
  assert.equal(await (await requestRedirectFetch(redirectingRequest)).text(), "request-redirected");
  assert.equal(requestRedirectCalls.length, 2);
  assert.equal(String(requestRedirectCalls[1].input), "https://other-provider.example/result");
  assert.equal(requestRedirectCalls[1].init.method, "GET");
  assert.equal(requestRedirectCalls[1].init.body, undefined);
  assert.equal(new Headers(requestRedirectCalls[1].init.headers).has("authorization"), false);
  assert.equal(new Headers(requestRedirectCalls[1].init.headers).has("api-key"), false);
  assert.equal(new Headers(requestRedirectCalls[1].init.headers).has("x-goog-api-key"), false);
  assert.equal(new Headers(requestRedirectCalls[1].init.headers).has("content-type"), false);

  const streamingRedirectFetch = policy.createGuardedFetch(
    async () => new Response(null, {
      status: 307,
      headers: { location: "https://provider.example/retry" },
    }),
    { transport: "sdk-fetch", operation: "contract.streaming-redirect" },
  );
  await assert.rejects(
    streamingRedirectFetch(new Request("https://provider.example/upload", {
      method: "POST",
      body: "streamed request fixture",
    })),
    error => error.code === "redirect_body_not_replayable",
  );
  const putRedirectFetch = policy.createGuardedFetch(
    async () => new Response(null, {
      status: 302,
      headers: { location: "https://provider.example/put-retry" },
    }),
    { transport: "sdk-fetch", operation: "contract.put-streaming-redirect" },
  );
  await assert.rejects(
    putRedirectFetch(new Request("https://provider.example/put", {
      method: "PUT",
      body: "streamed PUT fixture",
    })),
    error => error.code === "redirect_body_not_replayable",
  );

  const opaqueRedirectFetch = policy.createGuardedFetch(
    async () => ({
      status: 0,
      type: "opaqueredirect",
      headers: { get: () => null },
    }),
    { transport: "renderer-fetch", operation: "contract.opaque-redirect" },
  );
  await assert.rejects(
    opaqueRedirectFetch("https://provider.example/redirect"),
    error => error.code === "redirect_uninspectable",
  );

  const redirectCalls = [];
  const redirectFetch = policy.createGuardedFetch(async (url, init) => {
    redirectCalls.push({ url: String(url), init });
    return new Response(null, {
      status: 302,
      headers: { location: "https://cdn.enjoy.bot/download?signature=secret" },
    });
  }, { transport: "node-fetch", operation: "contract.redirect" });
  await assert.rejects(
    redirectFetch("https://provider.example/start", {
      headers: { Authorization: "Bearer provider-secret" },
    }),
    error => error.code === "retired_enjoy_host" && !error.message.includes("secret"),
  );
  assert.equal(redirectCalls.length, 1);

  const malformedRedirectFetch = policy.createGuardedFetch(
    async () => new Response(null, {
      status: 302,
      headers: { location: "https://[signed-secret" },
    }),
    { transport: "node-fetch", operation: "contract.malformed-redirect" },
  );
  await assert.rejects(
    malformedRedirectFetch("https://provider.example/start"),
    error => error.code === "invalid_network_url" && !error.message.includes("signed-secret"),
  );

  const allowedRedirectCalls = [];
  const allowedRedirectFetch = policy.createGuardedFetch(async (url, init) => {
    allowedRedirectCalls.push({ url: String(url), init });
    if (allowedRedirectCalls.length === 1) {
      return new Response(null, {
        status: 307,
        headers: { location: "https://other-provider.example/next" },
      });
    }
    return new Response("redirected", { status: 200 });
  }, { transport: "sdk-fetch", operation: "contract.allowed-redirect" });
  const allowedRedirectResponse = await allowedRedirectFetch(
    "https://provider.example/start",
    {
      method: "POST",
      body: "safe fixture",
      headers: {
        Authorization: "Bearer provider-secret",
        "Api-Key": "azure-secret",
        "X-Api-Key": "provider-secret",
        "X-Goog-Api-Key": "google-secret",
        "X-Goog-User-Project": "billing-project",
        "Ocp-Apim-Subscription-Key": "azure-speech-secret",
        "X-Test": "kept",
      },
    },
  );
  assert.equal(await allowedRedirectResponse.text(), "redirected");
  assert.equal(allowedRedirectCalls.length, 2);
  const redirectedHeaders = new Headers(allowedRedirectCalls[1].init.headers);
  assert.equal(redirectedHeaders.has("authorization"), false);
  assert.equal(redirectedHeaders.has("api-key"), false);
  assert.equal(redirectedHeaders.has("x-api-key"), false);
  assert.equal(redirectedHeaders.has("x-goog-api-key"), false);
  assert.equal(redirectedHeaders.has("x-goog-user-project"), false);
  assert.equal(redirectedHeaders.has("ocp-apim-subscription-key"), false);
  assert.equal(redirectedHeaders.get("x-test"), "kept");
  assert.equal(allowedRedirectCalls[1].init.method, "POST");
  assert.equal(allowedRedirectCalls[1].init.body, "safe fixture");

  const sameOriginRedirectCalls = [];
  const sameOriginRedirectFetch = policy.createGuardedFetch(async (url, init) => {
    sameOriginRedirectCalls.push({ url: String(url), init });
    return sameOriginRedirectCalls.length === 1
      ? new Response(null, { status: 302, headers: { location: "/next" } })
      : new Response("same-origin", { status: 200 });
  }, { transport: "sdk-fetch", operation: "contract.same-origin-redirect" });
  await sameOriginRedirectFetch("https://provider.example/start", {
    headers: {
      Authorization: "Bearer provider-secret",
      "Api-Key": "provider-secret",
      "X-Goog-Api-Key": "provider-secret",
    },
  });
  assert.equal(
    new Headers(sameOriginRedirectCalls[1].init.headers).get("authorization"),
    "Bearer provider-secret",
  );
  assert.equal(
    new Headers(sameOriginRedirectCalls[1].init.headers).get("api-key"),
    "provider-secret",
  );
  assert.equal(
    new Headers(sameOriginRedirectCalls[1].init.headers).get("x-goog-api-key"),
    "provider-secret",
  );

  let installedListener;
  const fakeSession = {
    webRequest: {
      onBeforeRequest(listener) {
        installedListener = listener;
      },
    },
  };
  policy.installChromiumSessionNetworkPolicy(fakeSession, {
    transport: "chromium-classifier",
    operation: "classifier.asset",
    allowRequest: url => url.startsWith("http://127.0.0.1:43123/classifier/"),
  });
  assert.equal(typeof installedListener, "function");
  const invokeListener = url => new Promise(resolve => {
    installedListener({ url }, resolve);
  });
  assert.deepEqual(
    await invokeListener("http://127.0.0.1:43123/classifier/model.tflite"),
    { cancel: false },
  );
  assert.deepEqual(await invokeListener("https://provider.example/model"), { cancel: true });
  assert.deepEqual(await invokeListener("https://enjoy.bot/model"), { cancel: true });

  policy.installChromiumSessionNetworkPolicy(fakeSession, {
    transport: "chromium-sandbox",
    operation: "contract.throwing-allow-policy",
    allowRequest: () => { throw new Error("policy bug"); },
  });
  assert.deepEqual(await invokeListener("https://provider.example/model"), { cancel: true });

  let createdSessionListener;
  const defaultSession = {
    webRequest: { onBeforeRequest(listener) { installedListener = listener; } },
  };
  const fakeApp = {
    on(event, listener) {
      assert.equal(event, "session-created");
      createdSessionListener = listener;
    },
  };
  policy.installChromiumNetworkPolicy(fakeApp, defaultSession);
  assert.equal(typeof installedListener, "function");
  assert.equal(typeof createdSessionListener, "function");
  const laterSession = {
    webRequest: { onBeforeRequest(listener) { installedListener = listener; } },
  };
  createdSessionListener(laterSession);
  assert.deepEqual(await invokeListener("wss://socket.enjoy.bot/events"), { cancel: true });
  assert.deepEqual(await invokeListener("https://provider.example/events"), { cancel: false });

  console.info("check-no-enjoy-network: PASS (offline policy and adapter contracts; no live egress)");
} finally {
  await rm(temp, { recursive: true, force: true });
}
