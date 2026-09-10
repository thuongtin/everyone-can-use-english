/* eslint-disable no-empty-pattern -- Electron owns the browser fixture. */
import { expect, test } from "@playwright/test";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { launchLocalApp, writeReceipt, type LocalApp } from "./helpers/local-app";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test("packaged Chromium download and main SDK have observable positive and denied redirect controls", async ({}, info) => {
  test.skip(process.env.ENJOY_RUN_NETWORK_TRANSPORT_CONTROLS !== "1", "Explicit transport controls required");
  test.setTimeout(120_000);
  const directory = await mkdtemp(path.join(os.tmpdir(), "enjoy-network-controls-"));
  const mp3Path = path.join(directory, "control.mp3");
  await promisify(execFile)(ffmpegPath!, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5", "-c:a", "libmp3lame", "-y", mp3Path]);
  const mp3 = await readFile(mp3Path);
  const received: { path: string; method: string; fixtureAuthorization: boolean }[] = [];
  let redirectSpeech = false;
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    received.push({ path: pathname, method: request.method || "", fixtureAuthorization: request.headers.authorization === "Bearer fixture-transport-key" });
    request.resume();
    response.setHeader("Access-Control-Allow-Origin", "*");
    if (pathname === "/redirect" || (pathname === "/v1/audio/speech" && redirectSpeech)) {
      response.writeHead(302, { Location: "https://api.enjoy.bot/transport-control" }).end();
    } else if (pathname === "/v1/audio/speech" || pathname === "/download") {
      response.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": mp3.length, ...(pathname === "/download" ? { "Content-Disposition": 'attachment; filename="control.mp3"' } : {}) }).end(mp3);
    } else response.writeHead(200, { "Content-Type": "text/plain" }).end("transport-positive");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Loopback server did not start");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let app: LocalApp | undefined;
  let closeError: unknown;
  try {
    app = await launchLocalApp();
    const page = app.page;
    await expect(page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });
    const initial = await page.evaluate(() => window.__ENJOY_APP__.app.networkPolicyDiagnostics());
    expect(initial.blockedAttemptCount).toBe(0);
    expect(initial.legacyBackendOperationCount).toBe(0);
    expect(await page.evaluate(async url => (await fetch(`${url}/chromium`)).text(), baseUrl)).toBe("transport-positive");
    const savedPath = await page.evaluate(({ url, savePath }) => window.__ENJOY_APP__.download.start(`${url}/download`, savePath), {
      url: baseUrl, savePath: path.join(app.directories.settings, "download.mp3"),
    });
    expect(hash(await readFile(savedPath!))).toBe(hash(mp3));
    await page.evaluate(async url => {
      await window.__ENJOY_APP__.userSettings.set("openai", { name: "openai", key: "fixture-transport-key", baseUrl: `${url}/v1` });
    }, baseUrl);
    const speechInput = { sourceId: randomUUID(), sourceType: "Message", text: "Transport fixture only.", configuration: { engine: "openai", model: "tts-1", voice: "alloy" } };
    const speech = await page.evaluate(input => window.__ENJOY_APP__.speeches.generate(input), speechInput);
    expect(speech.id).toBeTruthy();
    expect(received.some(row => row.path === "/v1/audio/speech" && row.fixtureAuthorization)).toBe(true);
    const nodeFetchText = await app.electronApp.evaluate(async (_electron, url) =>
      (await fetch(`${url}/node-fetch`)).text(), baseUrl);
    expect(nodeFetchText).toBe("transport-positive");
    const positivePolicy = await page.evaluate(() => window.__ENJOY_APP__.app.networkPolicyDiagnostics());
    expect(positivePolicy.observedRequests["node:http|127.0.0.1"]).toBeGreaterThanOrEqual(1);
    expect(positivePolicy.observedRequests["undici|127.0.0.1"]).toBeGreaterThanOrEqual(1);
    expect(positivePolicy.blockedAttemptCount).toBe(0);
    expect(positivePolicy.legacyBackendOperationCount).toBe(0);

    redirectSpeech = true;
    const sdkNegative = await page.evaluate(async input => {
      try { await window.__ENJOY_APP__.speeches.generate(input); return false; }
      catch { return true; }
    }, { ...speechInput, sourceId: randomUUID() });
    expect(sdkNegative).toBe(true);
    const afterSdk = await page.evaluate(() => window.__ENJOY_APP__.app.networkPolicyDiagnostics());
    expect(afterSdk.blockedAttemptCount).toBe(positivePolicy.blockedAttemptCount + 1);
    expect(await page.evaluate(async url => {
      try { await fetch(`${url}/redirect`); return false; } catch { return true; }
    }, baseUrl)).toBe(true);
    const afterChromium = await page.evaluate(() => window.__ENJOY_APP__.app.networkPolicyDiagnostics());
    expect(afterChromium.blockedAttemptCount).toBe(afterSdk.blockedAttemptCount + 1);
    expect(received.filter(row => row.path === "/v1/audio/speech")).toHaveLength(2);
    expect(received.filter(row => row.path === "/redirect")).toHaveLength(1);
    expect(Object.keys(afterChromium.observedRequests).filter(key => /\|(?:[^|]*\.)?enjoy\.bot$/u.test(key))).toEqual([]);
    app.consumeExpectedRuntimeError("Speech provider connection failed");
    app.consumeExpectedRuntimeError("Blocked retired Enjoy host api.enjoy.bot");
    app.consumeExpectedRuntimeError("https://api.enjoy.bot/transport-control:0:0");
    await writeReceipt(info, "network-transport-controls.json", {
      scope: "Disposable loopback transport controls, not live provider quality",
      positive: { chromiumFetch: true, chromiumDownloadByteHash: hash(mp3), mainOpenAiSdk: true, nodeHttp: true, undici: true },
      negative: { sdkRedirectRejected: true, chromiumRedirectRejected: true },
      policy: { initial, positivePolicy, afterSdk, afterChromium },
      loopbackRequests: received,
      gaps: ["Native child process egress is not observed by this receipt", "Azure Speech SDK requires its own configured live control"],
      runtime: app.runtimeDiagnostics(),
    });
    app.assertNoRuntimeIssues();
  } finally {
    if (app) {
      await writeReceipt(info, "transport-runtime.json", app.runtimeDiagnostics()).catch(() => undefined);
      await app.close().catch(error => { closeError = error; });
    }
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
  if (closeError) throw closeError;
});
