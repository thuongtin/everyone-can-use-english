import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { connect as connectNet, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { findLatestBuild, parseElectronApp } from "electron-playwright-helpers";
import { _electron as electron } from "playwright";
import type { ElectronApplication, Page } from "playwright";

export const MOCK_FIXTURE_LABEL = "isolated-offline-mock";

type MockRequest = {
  method: string;
  url: string;
  source: "direct" | "proxy";
};

type NodeServer = HttpServer | HttpsServer;

type MockServer = {
  httpOrigin: string;
  wsOrigin: string;
  proxyOrigin: string;
  requests: MockRequest[];
  proxyRequests: string[];
  requestsBeforeGuard: string[];
  close: () => Promise<void>;
};

export type IsolatedAppDirectories = {
  settings: string;
  library: string;
  chromium: string;
};

export type RuntimeIssues = {
  pageErrors: string[];
  pageConsoleErrors: string[];
  mainConsoleErrors: string[];
  mainProcessExitCode: number | null;
  signalCode: NodeJS.Signals | null;
  mainStderr: string[];
  unexpectedMainStderr: string[];
  requestsBeforeGuard: string[];
};

export type IsolatedApp = {
  readonly directories: IsolatedAppDirectories;
  readonly mockFixtureLabel: string;
  readonly mockHttpOrigin: string;
  readonly mockWsOrigin: string;
  readonly blockedRemoteRequests: readonly string[];
  readonly mockRequests: readonly MockRequest[];
  readonly proxyRequests: readonly string[];
  readonly electronApp: ElectronApplication;
  readonly page: Page;
  restart: () => Promise<void>;
  consumeExpectedErrors: (expected: { pageConsoleErrors?: string[]; mainConsoleErrors?: string[] }) => void;
  assertNoRuntimeIssues: () => void;
  close: () => Promise<void>;
};

const execFile = promisify(execFileCallback);
const helperDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(helperDirectory, "../..");

const sensitiveEnvironmentKey = /(?:TOKEN|SECRET|PASSWORD|API_KEY|AUTH|COOKIE|CREDENTIAL|SESSION)/i;

const copySafeEnvironment = () => {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || sensitiveEnvironmentKey.test(key)) continue;
    environment[key] = value;
  }
  return environment;
};

const sanitizeNetworkUrl = (value: string) => {
  try {
    const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
    const parsed = new URL(value, "http://isolated.invalid");
    const pathname = parsed.pathname || "/";
    return hasScheme ? `${parsed.origin}${pathname}` : pathname;
  } catch {
    return "<invalid-url>";
  }
};

const sanitizeDiagnosticText = (value: string) =>
  value.replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, (url) => sanitizeNetworkUrl(url));

const getMockPath = (value: string) => {
  try {
    return new URL(value, "http://isolated.invalid").pathname || "/";
  } catch {
    return "/";
  }
};

const closeServer = async (server: NodeServer | undefined) => {
  if (!server || !server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (!error || (error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING") {
        resolve();
        return;
      }
      reject(error);
    });
  });
};

const listenOnLoopback = async (server: NodeServer) => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Isolated network server did not expose a TCP address");
  }
  return address.port;
};

const makeCertificate = async (certificateDirectory: string) => {
  const keyPath = path.join(certificateDirectory, "key.pem");
  const certificatePath = path.join(certificateDirectory, "certificate.pem");
  await execFile("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-sha256",
    "-keyout",
    keyPath,
    "-out",
    certificatePath,
    "-days",
    "1",
    "-subj",
    "/CN=enjoy.bot",
    "-addext",
    "subjectAltName=DNS:enjoy.bot,DNS:*.enjoy.bot,IP:127.0.0.1",
  ]);
  return {
    key: await readFile(keyPath),
    cert: await readFile(certificatePath),
  };
};

const createMockServer = async (): Promise<MockServer> => {
  const requests: MockRequest[] = [];
  const proxyRequests: string[] = [];
  const requestsBeforeGuard: string[] = [];
  const certificateDirectory = await mkdtemp(path.join(os.tmpdir(), "enjoy-e2e-certificate-"));
  let networkGuardReady = false;
  const connectedSockets = new Set<Socket>();
  const trackSocket = (socket: Socket) => {
    connectedSockets.add(socket);
    socket.once("close", () => connectedSockets.delete(socket));
  };
  const noteNetworkRequest = (url: string) => {
    const sanitizedUrl = sanitizeNetworkUrl(url);
    if (!networkGuardReady) requestsBeforeGuard.push(sanitizedUrl);
    return sanitizedUrl;
  };

  let httpServer: HttpServer | undefined;
  let httpsServer: HttpsServer | undefined;
  let proxyServer: HttpServer | undefined;
  try {
    const respondMock = (
      request: IncomingMessage,
      response: ServerResponse,
      source: MockRequest["source"]
    ) => {
      const requestUrl = request.url || "/";
      requests.push({
        method: request.method || "GET",
        url: sanitizeNetworkUrl(requestUrl),
        source,
      });
      const requestPath = getMockPath(requestUrl);
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json; charset=utf-8");

      if (requestPath.startsWith("/api/config/bugsnag_api_key")) {
        response.end("null");
        return;
      }

      if (requestPath.startsWith("/api/config/ipa_mappings")) {
        response.end("null");
        return;
      }

      if (requestPath.startsWith("/api/config/app_version")) {
        response.end(JSON.stringify({}));
        return;
      }

      if (requestPath.startsWith("/api/config/ytb_channels")) {
        response.end(JSON.stringify([]));
        return;
      }

      response.end(JSON.stringify({}));
    };

    const rejectWebSocket = (
      request: IncomingMessage,
      socket: Socket,
      source: MockRequest["source"]
    ) => {
      const requestUrl = request.url || "/";
      requests.push({ method: "WS", url: sanitizeNetworkUrl(requestUrl), source });
      socket.end("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n");
    };

    httpServer = createHttpServer((request, response) => {
      noteNetworkRequest(request.url || "/");
      respondMock(request, response, "direct");
    });
    httpServer.on("upgrade", (request, socket) => {
      trackSocket(socket);
      noteNetworkRequest(request.url || "/");
      rejectWebSocket(request, socket, "direct");
    });
    httpServer.on("connection", trackSocket);

    const certificate = await makeCertificate(certificateDirectory);
    httpsServer = createHttpsServer(certificate, (request, response) => {
      noteNetworkRequest(request.url || "/");
      respondMock(request, response, "proxy");
    });
    httpsServer.on("upgrade", (request, socket) => {
      trackSocket(socket);
      noteNetworkRequest(request.url || "/");
      rejectWebSocket(request, socket, "proxy");
    });
    httpsServer.on("connection", trackSocket);

    const httpPort = await listenOnLoopback(httpServer);
    const httpsPort = await listenOnLoopback(httpsServer);
    proxyServer = createHttpServer((request, response) => {
      const targetUrl = request.url || "/";
      proxyRequests.push(noteNetworkRequest(targetUrl));
      respondMock(request, response, "proxy");
    });
    proxyServer.on("connect", (request, clientSocket, head) => {
      trackSocket(clientSocket);
      const targetUrl = `https://${request.url || "unknown"}`;
      proxyRequests.push(noteNetworkRequest(targetUrl));
      const upstreamSocket = connectNet(httpsPort, "127.0.0.1");
      trackSocket(upstreamSocket);
      upstreamSocket.once("connect", () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\nConnection: keep-alive\r\n\r\n");
        if (head.length > 0) upstreamSocket.write(head);
        clientSocket.pipe(upstreamSocket);
        upstreamSocket.pipe(clientSocket);
      });
      const closeTunnel = () => {
        clientSocket.destroy();
        upstreamSocket.destroy();
      };
      clientSocket.once("error", closeTunnel);
      upstreamSocket.once("error", closeTunnel);
    });
    proxyServer.on("connection", trackSocket);
    const proxyPort = await listenOnLoopback(proxyServer);
    networkGuardReady = true;

    return {
      httpOrigin: `http://127.0.0.1:${httpPort}`,
      wsOrigin: `ws://127.0.0.1:${httpPort}`,
      proxyOrigin: `http://127.0.0.1:${proxyPort}`,
      requests,
      proxyRequests,
      requestsBeforeGuard,
      close: async () => {
        networkGuardReady = true;
        for (const socket of connectedSockets) socket.destroy();
        await Promise.all([
          closeServer(proxyServer),
          closeServer(httpsServer),
          closeServer(httpServer),
        ]);
        await rm(certificateDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    for (const socket of connectedSockets) socket.destroy();
    await Promise.all([
      closeServer(proxyServer).catch(() => undefined),
      closeServer(httpsServer).catch(() => undefined),
      closeServer(httpServer).catch(() => undefined),
    ]);
    await rm(certificateDirectory, { recursive: true, force: true });
    throw error;
  }
};

const isRemoteNetworkUrl = (value: string, mockServer: MockServer) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
    return false;
  }

  return url.origin !== mockServer.httpOrigin && url.origin !== mockServer.wsOrigin;
};

const installMainNetworkGuard = async (
  electronApp: ElectronApplication,
  mockServer: MockServer
) => {
  try {
    await electronApp.evaluate(
      ({ session }, origins) => {
        const redirectToMock = (value: string, origin: string) => {
          const url = new URL(value);
          return `${origin}${url.pathname || "/"}`;
        };
        session.defaultSession.webRequest.onBeforeRequest(
          { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
          (details, callback) => {
            try {
              const url = new URL(details.url);
              if (origins.includes(url.origin)) {
                callback({});
                return;
              }

              if (url.protocol === "http:" || url.protocol === "https:") {
                callback({ redirectURL: redirectToMock(details.url, origins[0]) });
                return;
              }

              callback({ cancel: true });
            } catch {
              callback({ cancel: true });
            }
          }
        );
      },
      [mockServer.httpOrigin, mockServer.wsOrigin]
    );
  } catch {
    // Older Electron versions may reject WebSocket URL filters. HTTP requests
    // still use the local mock origin through the launch environment and proxy.
    await electronApp.evaluate(
      ({ session }, origins) => {
        const redirectToMock = (value: string, origin: string) => {
          const url = new URL(value);
          return `${origin}${url.pathname || "/"}`;
        };
        session.defaultSession.webRequest.onBeforeRequest(
          { urls: ["http://*/*", "https://*/*"] },
          (details, callback) => {
            try {
              const url = new URL(details.url);
              callback(
                origins.includes(url.origin)
                  ? {}
                  : { redirectURL: redirectToMock(details.url, origins[0]) }
              );
            } catch {
              callback({ cancel: true });
            }
          }
        );
      },
      [mockServer.httpOrigin, mockServer.wsOrigin]
    );
    console.info(`[${MOCK_FIXTURE_LABEL}] WebSocket main guard fallback`);
  }
};

const installContextNetworkGuard = async (
  electronApp: ElectronApplication,
  mockServer: MockServer,
  blockedRemoteRequests: string[]
) => {
  const context = electronApp.context();
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (isRemoteNetworkUrl(url, mockServer)) {
      // Keep the defense-in-depth route local. The prelaunch proxy is the
      // hermetic boundary, so this rewrite does not expose the original URL.
      const parsed = new URL(url);
      blockedRemoteRequests.push(sanitizeNetworkUrl(url));
      await route.continue({ url: `${mockServer.httpOrigin}${parsed.pathname || "/"}` });
      return;
    }
    await route.continue();
  });

  const contextWithWebSocket = context as typeof context & {
    routeWebSocket?: (
      url: string | RegExp,
      handler: (route: { url: () => string; close: () => void; connectToServer: () => void }) => void
    ) => Promise<void>;
  };
  if (typeof contextWithWebSocket.routeWebSocket === "function") {
    await contextWithWebSocket.routeWebSocket(/^(ws|wss):\/\//, (route) => {
      if (isRemoteNetworkUrl(route.url(), mockServer)) {
        blockedRemoteRequests.push(sanitizeNetworkUrl(route.url()));
        // The loopback proxy terminates the connection locally.
        route.connectToServer();
      } else {
        route.connectToServer();
      }
    });
  }
};

const makeLaunchEnvironment = (directories: IsolatedAppDirectories, mockServer: MockServer) => ({
  ...copySafeEnvironment(),
  CI: "e2e",
  ENJOY_E2E_FIXTURE_LABEL: MOCK_FIXTURE_LABEL,
  SETTINGS_PATH: directories.settings,
  LIBRARY_PATH: directories.library,
  WEB_API_URL: mockServer.httpOrigin,
  WS_URL: mockServer.wsOrigin,
});

const observePage = (
  candidate: Page,
  pageErrors: string[],
  pageConsoleErrors: string[]
) => {
  candidate.on("pageerror", (error) => {
    pageErrors.push(sanitizeDiagnosticText(`${error.name}: ${error.message}\n${error.stack || ""}`));
  });
  candidate.on("console", (message) => {
    if (message.type() === "error") pageConsoleErrors.push(sanitizeDiagnosticText(message.text()));
  });
};

const isBenignMainStderr = (line: string) =>
  /^DevTools listening on ws:\/\/127\.0\.0\.1:\d+\/?$/i.test(line);

export const resolveE2EAppPath = () => {
  const explicitPath = process.env.ENJOY_E2E_APP_PATH;
  if (explicitPath) return path.resolve(explicitPath);
  return findLatestBuild(path.join(projectRoot, "out"));
};

export const launchIsolatedApp = async (): Promise<IsolatedApp> => {
  const directories: IsolatedAppDirectories = {
    settings: await mkdtemp(path.join(os.tmpdir(), "enjoy-e2e-settings-")),
    library: await mkdtemp(path.join(os.tmpdir(), "enjoy-e2e-library-")),
    chromium: await mkdtemp(path.join(os.tmpdir(), "enjoy-e2e-chromium-")),
  };
  let mockServer: MockServer;
  try {
    mockServer = await createMockServer();
  } catch (error) {
    await Promise.all(
      Object.values(directories).map((directory) => rm(directory, { recursive: true, force: true }))
    );
    throw error;
  }

  const blockedRemoteRequests: string[] = [];
  let electronApp: ElectronApplication | undefined;
  let appProcess: ReturnType<ElectronApplication["process"]> | undefined;
  let page: Page | undefined;
  let closed = false;
  const pageErrors: string[] = [];
  const pageConsoleErrors: string[] = [];
  const mainConsoleErrors: string[] = [];
  const mainStderr: string[] = [];
  const unexpectedMainStderr: string[] = [];
  let processLifecycle: { closing: boolean } | undefined;
  const observedPages = new Set<Page>();

  const observeAppPage = (candidate: Page) => {
    if (observedPages.has(candidate)) return;
    observedPages.add(candidate);
    observePage(candidate, pageErrors, pageConsoleErrors);
  };

  const launch = async () => {
    const lifecycle = { closing: false };
    processLifecycle = lifecycle;
    const appInfo = parseElectronApp(resolveE2EAppPath());
    electronApp = await electron.launch({
      args: [
        appInfo.main,
        `--user-data-dir=${directories.chromium}`,
        `--proxy-server=${mockServer.proxyOrigin}`,
        "--proxy-bypass-list=<-loopback>",
        "--ignore-certificate-errors",
        // This credential-free fixture must not open the user's macOS Keychain.
        ...(process.platform === "darwin" ? ["--use-mock-keychain"] : []),
      ],
      executablePath: appInfo.executable,
      env: makeLaunchEnvironment(directories, mockServer),
    });
    appProcess = electronApp.process();

    electronApp.on("window", (windowPage) => observeAppPage(windowPage));
    electronApp.on("console", (message) => {
      if (message.type() === "error") mainConsoleErrors.push(sanitizeDiagnosticText(message.text()));
    });
    appProcess.stderr?.on("data", (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        const text = sanitizeDiagnosticText(line.trim());
        if (!text) continue;
        mainStderr.push(text);
        const inspectorShutdown = lifecycle.closing && (
          /^Debugger ending on ws:\/\/127\.0\.0\.1:\d+\/[a-f\d-]+$/i.test(text) ||
          text === "For help, see: https://nodejs.org/en/docs/inspector"
        );
        if (!isBenignMainStderr(text) && !inspectorShutdown) {
          unexpectedMainStderr.push(text);
        }
      }
    });

    // The proxy is already listening before launch. These listeners are
    // defense in depth for requests created after Electron starts.
    await installMainNetworkGuard(electronApp, mockServer);
    await installContextNetworkGuard(electronApp, mockServer, blockedRemoteRequests);
    page = await electronApp.firstWindow();
    observeAppPage(page);
    console.info(`[${MOCK_FIXTURE_LABEL}] App launched with isolated settings/library/chromium paths`);
  };

  try {
    await launch();
  } catch (error) {
    await electronApp?.close().catch(() => undefined);
    await mockServer.close().catch(() => undefined);
    await Promise.all(
      Object.values(directories).map((directory) => rm(directory, { recursive: true, force: true }))
    );
    throw error;
  }

  const fixture: IsolatedApp = {
    get directories() {
      return directories;
    },
    get mockFixtureLabel() {
      return MOCK_FIXTURE_LABEL;
    },
    get mockHttpOrigin() {
      return mockServer.httpOrigin;
    },
    get mockWsOrigin() {
      return mockServer.wsOrigin;
    },
    get blockedRemoteRequests() {
      return [...blockedRemoteRequests];
    },
    get mockRequests() {
      return [...mockServer.requests];
    },
    get proxyRequests() {
      return [...mockServer.proxyRequests];
    },
    get electronApp() {
      if (!electronApp) throw new Error("Isolated Electron app is not running");
      return electronApp;
    },
    get page() {
      if (!page) throw new Error("Isolated Electron page is not ready");
      return page;
    },
    restart: async () => {
      if (closed) throw new Error("Cannot restart a closed isolated app");
      fixture.assertNoRuntimeIssues();
      if (processLifecycle) processLifecycle.closing = true;
      await electronApp?.close();
      fixture.assertNoRuntimeIssues();
      electronApp = undefined;
      page = undefined;
      observedPages.clear();
      await launch();
    },
    consumeExpectedErrors: (expected) => {
      const plain = (line: string) => line.replace(/\u001b\[[\d;]*m/g, "").trim();
      const consume = (values: string[], expectedLine: string, firstLine = false) => {
        const matching = values.map((value, index) => ({ value, index }))
          .filter(({ value }) => plain(firstLine ? value.split("\n")[0] : value) === expectedLine);
        if (matching.length !== 1) throw new Error(`Expected exactly one runtime error: ${expectedLine}; found ${matching.length}`);
        values.splice(matching[0].index, 1);
        return matching[0].value;
      };
      for (const line of expected.pageConsoleErrors ?? []) consume(pageConsoleErrors, line);
      for (const line of expected.mainConsoleErrors ?? []) {
        const message = consume(mainConsoleErrors, line, true);
        // Electron mirrors an IPC exception and its stack to stderr.
        for (const part of message.split("\n").map(plain).filter(Boolean)) {
          const index = unexpectedMainStderr.findIndex(value => plain(value) === part);
          if (index !== -1) unexpectedMainStderr.splice(index, 1);
        }
      }
    },
    assertNoRuntimeIssues: () => {
      const process = appProcess;
      const issues: RuntimeIssues = {
        pageErrors: [...pageErrors],
        pageConsoleErrors: [...pageConsoleErrors],
        mainConsoleErrors: [...mainConsoleErrors],
        mainProcessExitCode: process?.exitCode ?? null,
        signalCode: process?.signalCode ?? null,
        mainStderr: [...mainStderr],
        unexpectedMainStderr: [...unexpectedMainStderr],
        requestsBeforeGuard: [...mockServer.requestsBeforeGuard],
      };
      const hasProcessFailure = issues.mainProcessExitCode !== null && issues.mainProcessExitCode !== 0;
      if (
        issues.pageErrors.length > 0 ||
        issues.pageConsoleErrors.length > 0 ||
        issues.mainConsoleErrors.length > 0 ||
        issues.unexpectedMainStderr.length > 0 ||
        issues.signalCode !== null ||
        hasProcessFailure ||
        issues.requestsBeforeGuard.length > 0
      ) {
        throw new Error(`Runtime issues in ${MOCK_FIXTURE_LABEL}: ${JSON.stringify({
          issues,
          mockRequests: mockServer.requests,
          proxyRequests: mockServer.proxyRequests,
          blockedRemoteRequests,
        }, null, 2)}`);
      }
    },
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        if (processLifecycle) processLifecycle.closing = true;
        await electronApp?.close();
        fixture.assertNoRuntimeIssues();
      } finally {
        electronApp = undefined;
        page = undefined;
        await mockServer.close().catch(() => undefined);
        await Promise.all(
          Object.values(directories).map((directory) => rm(directory, { recursive: true, force: true }))
        );
      }
    },
  };

  return fixture;
};
