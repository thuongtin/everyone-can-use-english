/* eslint-disable no-empty-pattern -- Electron acceptance uses its own packaged-app fixture. */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page, type Request } from "@playwright/test";

import {
  launchLocalApp,
  sanitizeLocalDiagnostic,
  writeReceipt,
  type LocalApp,
} from "./helpers/local-app";

type NetworkPolicyDiagnostics = Readonly<{
  blockedAttemptCount: number;
  legacyBackendOperationCount: number;
  observedRequestCount: number;
  observedRequests: Readonly<Record<string, number>>;
  blockedAttempts: Readonly<Record<string, number>>;
  legacyBackendOperations: Readonly<Record<string, number>>;
}>;

type ChromiumObservation = Readonly<{
  phase: string;
  source: "playwright-request" | "performance-resource";
  protocol: string;
  hostname: string;
  resourceType: string;
}>;

type ChromiumObserver = Readonly<{
  setPhase: (phase: string) => void;
}>;

type ReconnectServer = Readonly<{
  origin: string;
  requests: string[];
  close: () => Promise<void>;
}>;

type StaticRoute = Readonly<{
  name: string;
  path: string;
  settledPath?: string;
  ready:
    | { kind: "testId"; value: string }
    | { kind: "heading"; value?: string }
    | { kind: "input" }
    | { kind: "layout" };
}>;

type PolicyWindow = Window & typeof globalThis & {
  __ENJOY_RENDERER_NETWORK_POLICY__: () => NetworkPolicyDiagnostics;
  __ENJOY_APP__: {
    app: {
      networkPolicyDiagnostics: () => Promise<NetworkPolicyDiagnostics>;
    };
    view: {
      load: (url: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
    };
  };
};

const acceptanceEnabled = process.env.ENJOY_RUN_NO_ENJOY_NETWORK_ACCEPTANCE === "1";
const idleEnvironmentValue = process.env.ENJOY_NO_ENJOY_NETWORK_IDLE_MS ?? "600000";
if (!/^\d+$/u.test(idleEnvironmentValue)) {
  throw new Error("ENJOY_NO_ENJOY_NETWORK_IDLE_MS must be a non-negative integer");
}
const idleWindowMs = Number(idleEnvironmentValue);
if (!Number.isSafeInteger(idleWindowMs)) {
  throw new Error("ENJOY_NO_ENJOY_NETWORK_IDLE_MS is outside the safe integer range");
}

const exposedRoutes: readonly StaticRoute[] = [
  { name: "landing", path: "/landing", settledPath: "/", ready: { kind: "layout" } },
  { name: "dictionary", path: "/dictionary", ready: { kind: "testId", value: "bilingual-panel" } },
  { name: "home", path: "/", ready: { kind: "heading" } },
  { name: "chats", path: "/chats", ready: { kind: "input" } },
  { name: "profile", path: "/profile", ready: { kind: "testId", value: "profile-page" } },
  { name: "conversations", path: "/conversations", ready: { kind: "testId", value: "conversation-new-button" } },
  { name: "pronunciation-assessments", path: "/pronunciation_assessments", ready: { kind: "testId", value: "pronunciation-assessments-page" } },
  { name: "new-pronunciation-assessment", path: "/pronunciation_assessments/new", ready: { kind: "heading", value: "Đánh giá mới" } },
  { name: "vocabulary", path: "/vocabulary", ready: { kind: "testId", value: "vocabulary-page" } },
  { name: "audios", path: "/audios", ready: { kind: "heading", value: "Âm thanh" } },
  { name: "videos", path: "/videos", ready: { kind: "heading", value: "Video" } },
  { name: "documents", path: "/documents", ready: { kind: "heading", value: "Tài liệu" } },
  { name: "learning-studio", path: "/learning-studio", ready: { kind: "testId", value: "learning-studio" } },
  { name: "stories", path: "/stories", ready: { kind: "heading", value: "Bài đọc" } },
  { name: "notes", path: "/notes", ready: { kind: "heading" } },
] as const;
const exposedSurfaces = [...exposedRoutes.map(route => route.name), "preferences"] as const;
const retiredAliases = new Set([
  "api.getenjoyapp.com",
  "enjoy-storage.baizhiheizi.com",
]);

const closeServer = (server: Server): Promise<void> => new Promise((resolve, reject) => {
  server.close(error => {
    if (error) reject(error);
    else resolve();
  });
});

const startReconnectServer = async (): Promise<ReconnectServer> => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method || "GET"} ${new URL(request.url || "/", "http://loopback.invalid").pathname}`);
    response.statusCode = 200;
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end("reconnected");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => closeServer(server),
  };
};

const isRetiredHostname = (hostname: string): boolean => {
  const normalized = hostname.trim().toLowerCase().replace(/\.+$/u, "");
  return normalized === "enjoy.bot"
    || normalized.endsWith(".enjoy.bot")
    || retiredAliases.has(normalized);
};

const observationFromUrl = (
  phase: string,
  source: ChromiumObservation["source"],
  value: string,
  resourceType: string,
): ChromiumObservation | undefined => {
  try {
    const url = new URL(value);
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return undefined;
    return {
      phase,
      source,
      protocol: url.protocol,
      hostname: url.hostname.toLowerCase(),
      resourceType,
    };
  } catch {
    return undefined;
  }
};

const observeChromiumRequests = (
  app: LocalApp,
  phase: string,
  observations: ChromiumObservation[],
): ChromiumObserver => {
  let activePhase = phase;
  app.electronApp.context().on("request", (request: Request) => {
    const observation = observationFromUrl(
      activePhase,
      "playwright-request",
      request.url(),
      request.resourceType(),
    );
    if (observation) observations.push(observation);
  });
  return { setPhase: nextPhase => { activePhase = nextPhase; } };
};

const collectPerformanceResources = async (
  page: Page,
  phase: string,
  observations: ChromiumObservation[],
): Promise<void> => {
  const resources = await page.evaluate(() => {
    const entries = performance.getEntriesByType("resource").map(entry => ({
      name: entry.name,
      initiatorType: (entry as PerformanceResourceTiming).initiatorType || "resource",
    }));
    performance.clearResourceTimings();
    return entries;
  });
  for (const resource of resources) {
    const observation = observationFromUrl(
      phase,
      "performance-resource",
      resource.name,
      resource.initiatorType,
    );
    if (observation) observations.push(observation);
  }
};

const openRoute = async (page: Page, route: StaticRoute): Promise<void> => {
  await page.evaluate(nextRoute => {
    window.location.hash = nextRoute;
  }, route.path);
  await expect.poll(() => page.evaluate(() => window.location.hash))
    .toBe(`#${route.settledPath ?? route.path}`);

  if (route.ready.kind === "testId") {
    const ready = page.getByTestId(route.ready.value);
    // Empty conversations expose the same action in the toolbar and empty state.
    await expect(route.name === "conversations" ? ready.first() : ready).toBeVisible();
  } else if (route.ready.kind === "heading") {
    const heading = route.ready.value
      ? page.getByRole("heading", { name: route.ready.value, exact: true })
      : page.locator("#main-panel-content h1").first();
    await expect(heading).toBeVisible();
  } else if (route.ready.kind === "input") {
    await expect(page.locator("#main-panel-content input").first()).toBeVisible();
  } else {
    await expect(page.getByTestId("layout-home")).toBeVisible();
  }
};

const visitExposedSurfaces = async (page: Page): Promise<void> => {
  for (const route of exposedRoutes) await openRoute(page, route);
  await page.locator("#preferences-button").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cơ bản", exact: true }).click();
  await expect(page.getByText("Dịch vụ AI", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Nâng cao", exact: true }).click();
  await expect(page.getByText("Azure Speech và MAI Transcribe", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Cấu hình chi tiết dịch vụ/u }).click();
  await expect(page.getByText("Dịch vụ AI chép lời", { exact: true })).toBeVisible();
  await expect(page.getByText("Dịch vụ chuyển văn bản thành giọng nói", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
};

const readPolicyDiagnostics = (page: Page): Promise<Readonly<{
  renderer: NetworkPolicyDiagnostics;
  main: NetworkPolicyDiagnostics;
}>> => page.evaluate(async () => {
  const policyWindow = window as PolicyWindow;
  return {
    renderer: policyWindow.__ENJOY_RENDERER_NETWORK_POLICY__(),
    main: await policyWindow.__ENJOY_APP__.app.networkPolicyDiagnostics(),
  };
});

const expectNormalPolicy = (diagnostics: Awaited<ReturnType<typeof readPolicyDiagnostics>>): void => {
  for (const policy of [diagnostics.renderer, diagnostics.main]) {
    expect(policy.blockedAttemptCount).toBe(0);
    expect(policy.legacyBackendOperationCount).toBe(0);
    expect(Object.keys(policy.observedRequests).filter(key => isRetiredHostname(key.split("|").at(-1) || ""))).toEqual([]);
  }
};

test.describe.configure({ mode: "serial" });
test.skip(!acceptanceEnabled, "Explicit ten-minute packaged network acceptance required");

let app: LocalApp | undefined;
let reconnectServer: ReconnectServer | undefined;
const chromiumObservations: ChromiumObservation[] = [];
const phaseDiagnostics: Array<Readonly<{
  phase: string;
  renderer: NetworkPolicyDiagnostics;
  main: NetworkPolicyDiagnostics;
}>> = [];

test.beforeAll(async () => {
  reconnectServer = await startReconnectServer();
  try {
    app = await launchLocalApp();
  } catch (error) {
    await reconnectServer.close();
    reconnectServer = undefined;
    throw error;
  }
});

test.afterAll(async () => {
  let appFailure: unknown;
  try {
    await app?.close();
  } catch (error) {
    appFailure = error;
  }
  await reconnectServer?.close();
  if (appFailure) throw appFailure;
});

test("fresh packaged profile stays detached through routes, idle, offline, reconnect and restart", async ({}, info) => {
  test.setTimeout(idleWindowMs + 240_000);
  info.annotations.push({
    type: "coverage",
    description: "Chromium requests are observed by Playwright and renderer performance entries; Node/SDK and subprocess egress need transport-specific acceptance controls",
  });

  let chromiumObserver = observeChromiumRequests(app!, "fresh-online", chromiumObservations);
  for (const phase of ["fresh-online", "offline", "reconnected", "full-restart"] as const) {
    if (phase === "offline") {
      await app!.restart({ offline: true });
      chromiumObserver = observeChromiumRequests(app!, phase, chromiumObservations);
    } else if (phase === "reconnected") {
      chromiumObserver.setPhase(phase);
      const proxyResolution = await app!.electronApp.evaluate(
        async ({ session }, target) => {
          await session.defaultSession.setProxy({ mode: "direct" });
          return session.defaultSession.resolveProxy(target);
        },
        `${reconnectServer!.origin}/reconnect`,
      );
      expect(proxyResolution).toMatch(/(?:^|;)DIRECT(?:;|$)/u);
      await app!.page.context().setOffline(false);
      const reconnectControl = await app!.page.evaluate(async target => {
        const response = await fetch(target);
        return { status: response.status, body: await response.text() };
      }, `${reconnectServer!.origin}/reconnect`);
      expect(reconnectControl).toEqual({ status: 200, body: "reconnected" });
      expect(reconnectServer!.requests).toContain("GET /reconnect");
    } else if (phase === "full-restart") {
      await app!.restart({ offline: false });
      chromiumObserver = observeChromiumRequests(app!, phase, chromiumObservations);
    }
    await expect(app!.page.getByTestId("layout-home")).toBeVisible({ timeout: 30_000 });
    await visitExposedSurfaces(app!.page);
    if (phase === "fresh-online") await app!.page.waitForTimeout(idleWindowMs);
    await collectPerformanceResources(app!.page, phase, chromiumObservations);

    const diagnostics = await readPolicyDiagnostics(app!.page);
    expectNormalPolicy(diagnostics);
    phaseDiagnostics.push({ phase, ...diagnostics });
    app!.assertNoRuntimeIssues();
  }

  const retiredObservations = chromiumObservations.filter(observation =>
    isRetiredHostname(observation.hostname));
  expect(retiredObservations).toEqual([]);

  await writeReceipt(info, "no-enjoy-network-normal.json", {
    pass: true,
    packagedFreshProfile: true,
    phases: phaseDiagnostics,
    exposedSurfaces,
    staticRoutes: exposedRoutes.map(route => ({
      name: route.name,
      requestedPath: route.path,
      settledPath: route.settledPath ?? route.path,
    })),
    lifecycle: {
      offlineRestart: true,
      sameProcessReconnect: true,
      directProxyAndLoopbackControl: reconnectServer!.requests.includes("GET /reconnect"),
      fullRestartAfterReconnect: true,
    },
    idleWindowMs,
    chromium: {
      observationCount: chromiumObservations.length,
      observedHosts: [...new Set(chromiumObservations.map(observation => observation.hostname))].sort(),
      retiredHostObservationCount: retiredObservations.length,
      observations: chromiumObservations,
    },
    coverage: {
      chromium: "observed",
      nodeSdk: "main diagnostics_channel HTTP/HTTPS and undici observations; positive controls in network-transport-controls receipt",
      subprocess: "not instrumented by this Playwright receipt",
    },
  });
});

test("negative control is rejected before a real Enjoy request", async ({}, info) => {
  test.setTimeout(30_000);
  const beforeObservationCount = chromiumObservations.length;
  const before = await readPolicyDiagnostics(app!.page);
  const blocked = await app!.page.evaluate(async () => {
    const policyWindow = window as PolicyWindow;
    try {
      await policyWindow.__ENJOY_APP__.view.load(
        "https://user:password@enjoy.bot/private?token=negative-control-secret",
        { x: 0, y: 0, width: 100, height: 100 },
      );
      return { rejected: false, message: "" };
    } catch (error) {
      return {
        rejected: true,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });
  const after = await readPolicyDiagnostics(app!.page);
  const newObservations = chromiumObservations.slice(beforeObservationCount);

  expect(blocked.rejected).toBe(true);
  expect(blocked.message).toContain("Blocked retired Enjoy host enjoy.bot");
  expect(blocked.message).not.toMatch(/password|private|token|negative-control-secret/u);
  expect(after.main.blockedAttemptCount).toBe(before.main.blockedAttemptCount + 1);
  expect(after.main.blockedAttempts["webview|load|enjoy.bot"]).toBe(1);
  expect(after.main.legacyBackendOperationCount).toBe(before.main.legacyBackendOperationCount);
  expect(after.renderer).toEqual(before.renderer);
  expect(newObservations.filter(observation => isRetiredHostname(observation.hostname))).toEqual([]);

  app!.consumeExpectedRuntimeError("Blocked retired Enjoy host enjoy.bot");
  app!.assertNoRuntimeIssues();
  await writeReceipt(info, "no-enjoy-network-negative-control.json", {
    pass: true,
    rejectedBeforeEgress: true,
    listenerOverrideInstalledByTest: false,
    error: sanitizeLocalDiagnostic(blocked.message),
    networkPolicy: { before, after },
    chromiumObservationDelta: newObservations,
  });
});
