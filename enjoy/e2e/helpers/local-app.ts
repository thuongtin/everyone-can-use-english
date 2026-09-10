import { chmod, copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseElectronApp } from "electron-playwright-helpers";
import { _electron as electron } from "playwright";
import type { ElectronApplication, Page, Request } from "playwright";
import type { TestInfo } from "@playwright/test";
import sqlitePackage from "sqlite3";

import { resolveE2EAppPath } from "./isolated-app";

// sqlite3 is CommonJS at runtime even though its declarations advertise named exports.
// eslint-disable-next-line import/no-named-as-default-member
const { Database: SqliteDatabase, OPEN_READONLY } = sqlitePackage;

export type LocalAppDirectories = Readonly<{
  settings: string;
  library: string;
  chromium: string;
}>;

export type LocalRuntimeIssues = Readonly<{
  pageErrors: readonly string[];
  pageConsoleErrors: readonly string[];
  mainConsoleErrors: readonly string[];
  mainStderrErrors: readonly string[];
}>;

export type LocalPageDiagnostic = Readonly<{
  source: "pageerror" | "console";
  provenance: "enjoy-renderer" | "external-webcontents";
  pageUrl: string;
  sourceUrl: string | null;
  message: string;
  classification?: "local-model-discovery-probe" | "offline-youtube-thumbnail";
}>;

export type LocalExpectedRuntimeDiagnostic = Readonly<{
  source: "pageerror" | "console" | "main-console" | "main-stderr";
  provenance: "enjoy-renderer" | "main-process";
  pageUrl?: string;
  sourceUrl?: string | null;
  requestResourceType?: "image";
  requestFailure?: "net::ERR_INTERNET_DISCONNECTED";
  message: string;
  classification: "local-model-discovery-probe" | "offline-audible-connectivity" | "offline-youtube-thumbnail" | "test-expected-runtime-error";
}>;

export type LocalRuntimeDiagnostics = Readonly<{
  unexpected: LocalRuntimeIssues;
  expected: readonly LocalExpectedRuntimeDiagnostic[];
  externalPages: readonly LocalPageDiagnostic[];
}>;

export type LocalApp = Readonly<{
  directories: LocalAppDirectories;
  databasePath: string;
  electronApp: ElectronApplication;
  page: Page;
  offline: boolean;
  restart(options?: { offline?: boolean }): Promise<void>;
  consumeExpectedRuntimeError(fragment: string): number;
  runtimeDiagnostics(): LocalRuntimeDiagnostics;
  clearRuntimeDiagnostics(): void;
  assertNoRuntimeIssues(): void;
  close(): Promise<void>;
}>;

const sensitiveEnvironmentKey = /(?:TOKEN|SECRET|PASSWORD|API_KEY|AUTH|COOKIE|CREDENTIAL|SESSION)/iu;
const maximumDiagnostics = 20;
const expectedLocalModelProbeUrls = new Set([
  "http://localhost:11434/api/tags",
  "http://localhost:1234/v1/models",
]);
const offlineAudibleConnectivityWarning = /^(?:\(node:\d+\) )?electron: Failed to load URL: https:\/\/www\.audible\.com\/adblbestsellers with error: ERR_(?:INTERNET_DISCONNECTED|PROXY_CONNECTION_FAILED)(?:\n\(Use `enjoy --trace-warnings \.\.\.` to show where the warning was created\))?$/u;

type RawPageDiagnostic = {
  page: Page;
  source: "pageerror" | "console";
  pageUrl: string;
  sourceUrl: string | null;
  message: string;
};

const copySafeEnvironment = (): Record<string, string> => {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || sensitiveEnvironmentKey.test(key)) continue;
    environment[key] = value;
  }
  delete environment.FORCE_COLOR;
  delete environment.NO_COLOR;
  return environment;
};

const sanitizeUrl = (value: string): string => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "file:") return `file://${parsed.pathname}`;
    return `${parsed.origin}${parsed.pathname || "/"}`;
  } catch {
    return "<redacted-url>";
  }
};

const sanitizeDiagnosticUrl = (value: string): string => {
  if (!value) return "<unknown>";
  return sanitizeUrl(value);
};

export const sanitizeLocalDiagnostic = (value: string): string => value
  .replaceAll(String.fromCharCode(27), "")
  .replace(/(?:https?|wss?):\/\/[^\s"'<>]+/giu, sanitizeUrl)
  .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/giu, "$1 <redacted>")
  .replace(/\b(token|secret|password|api[_-]?key|credential)\s*[:=]\s*[^\s,;]+/giu, "$1=<redacted>")
  .trim();

const appendDiagnostic = (target: string[], value: string): void => {
  const sanitized = sanitizeLocalDiagnostic(value);
  if (!sanitized || target.includes(sanitized)) return;
  if (target.length < maximumDiagnostics) target.push(sanitized);
};

const makeDirectories = async (): Promise<LocalAppDirectories> => ({
  settings: await mkdtemp(path.join(os.tmpdir(), "enjoy-local-acp-settings-")),
  library: await mkdtemp(path.join(os.tmpdir(), "enjoy-local-acp-library-")),
  chromium: await mkdtemp(path.join(os.tmpdir(), "enjoy-local-acp-chromium-")),
});

const removeDirectories = async (directories: LocalAppDirectories): Promise<void> => {
  const outcomes = await Promise.allSettled(
    Object.values(directories).map(directory => rm(directory, { recursive: true, force: true })),
  );
  const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
  if (rejected) throw rejected.reason;
};

const launchEnvironment = (directories: LocalAppDirectories, offline: boolean): Record<string, string> => ({
  ...copySafeEnvironment(),
  CI: "e2e",
  SETTINGS_PATH: directories.settings,
  LIBRARY_PATH: path.join(directories.library, "EnjoyLibrary"),
  ...(offline
    ? {
        WEB_API_URL: "http://127.0.0.1:9",
        WS_URL: "ws://127.0.0.1:9",
      }
    : {}),
});

const mainStderrLooksUnhandled = (line: string): boolean =>
  /(?:uncaught|unhandled|fatal|error occurred in handler|error:)/iu.test(line)
  && !/^DevTools listening on /iu.test(line);

export async function launchLocalApp(options: {
  offline?: boolean;
  seed?: Readonly<{
    databasePath: string;
    profileId?: string;
    assets: readonly Readonly<{ sourcePath: string; relativePath: string }>[];
  }>;
} = {}): Promise<LocalApp> {
  const profileId = options.seed?.profileId || "local";
  if (!/^[A-Za-z0-9_-]+$/u.test(profileId)) throw new Error("Invalid seed profile ID");
  const directories = await makeDirectories();
  const pageDiagnostics: RawPageDiagnostic[] = [];
  const consumedExpectedDiagnostics: LocalExpectedRuntimeDiagnostic[] = [];
  const archivedExpectedDiagnostics: LocalExpectedRuntimeDiagnostic[] = [];
  const archivedExternalPageDiagnostics: LocalPageDiagnostic[] = [];
  const mainConsoleErrors: string[] = [];
  const mainStderrErrors: string[] = [];
  const observedPages = new Set<Page>();
  const pageDiagnosticCounts = new Map<Page, number>();
  const failedOfflineYoutubeImages = new Map<Page, Set<string>>();
  let electronApp: ElectronApplication | undefined;
  let page: Page | undefined;
  let offline = options.offline === true;
  let closing = false;
  let closed = false;
  let actualLibraryPath: string | undefined;

  const appendPageDiagnostic = (diagnostic: RawPageDiagnostic): void => {
    const duplicate = pageDiagnostics.some(existing =>
      existing.page === diagnostic.page
      && existing.source === diagnostic.source
      && existing.sourceUrl === diagnostic.sourceUrl
      && existing.message === diagnostic.message);
    if (duplicate) return;
    const count = pageDiagnosticCounts.get(diagnostic.page) ?? 0;
    if (count >= maximumDiagnostics) return;
    pageDiagnostics.push(diagnostic);
    pageDiagnosticCounts.set(diagnostic.page, count + 1);
  };

  const observeFailedRequest = (candidate: Page, request: Request): void => {
    if (!offline || request.resourceType() !== "image" || request.failure()?.errorText !== "net::ERR_INTERNET_DISCONNECTED") return;
    const requestUrl = request.url();
    try {
      const parsed = new URL(requestUrl);
      if (parsed.protocol !== "https:" || parsed.hostname !== "i.ytimg.com") return;
      if (!/^\/vi\/[A-Za-z0-9_-]{11}\/(?:hq720|hqdefault)\.jpg$/u.test(parsed.pathname) || parsed.search || parsed.hash) return;
    } catch {
      return;
    }
    const recorded = failedOfflineYoutubeImages.get(candidate) ?? new Set<string>();
    recorded.add(requestUrl);
    failedOfflineYoutubeImages.set(candidate, recorded);
  };

  const observePage = (candidate: Page): void => {
    if (observedPages.has(candidate)) return;
    observedPages.add(candidate);
    candidate.on("requestfailed", request => observeFailedRequest(candidate, request));
    candidate.on("pageerror", error => {
      appendPageDiagnostic({
        page: candidate,
        source: "pageerror",
        pageUrl: candidate.url(),
        sourceUrl: null,
        message: sanitizeLocalDiagnostic(`${error.name}: ${error.message}\n${error.stack || ""}`),
      });
    });
    candidate.on("console", message => {
      if (message.type() === "error") {
        const location = message.location();
        const sourceUrl = location.url || null;
        appendPageDiagnostic({
          page: candidate,
          source: "console",
          pageUrl: candidate.url(),
          sourceUrl,
          message: sanitizeLocalDiagnostic(`${message.text()}\n${sourceUrl || "<unknown>"}:${location.lineNumber}:${location.columnNumber}`),
        });
      }
    });
  };

  const launch = async (): Promise<void> => {
    const appInfo = parseElectronApp(resolveE2EAppPath());
    electronApp = await electron.launch({
      executablePath: appInfo.executable,
      cwd: "/",
      args: [
        appInfo.main,
        `--user-data-dir=${directories.chromium}`,
        // Offline asset acceptance can require a cold HTTP path without Chromium disk cache.
        ...(process.env.ENJOY_E2E_DISABLE_HTTP_CACHE === "1" ? ["--disable-http-cache"] : []),
        ...(offline ? ["--proxy-server=http://127.0.0.1:9"] : []),
      ],
      env: launchEnvironment(directories, offline),
    });
    if (offline) await electronApp.context().setOffline(true);
    electronApp.on("window", observePage);
    electronApp.on("console", message => {
      if (message.type() === "error") appendDiagnostic(mainConsoleErrors, message.text());
    });
    electronApp.process().stderr?.on("data", chunk => {
      for (const line of String(chunk).split(/\r?\n/u)) {
        if (!closing && mainStderrLooksUnhandled(line)) appendDiagnostic(mainStderrErrors, line);
      }
    });
    page = await electronApp.firstWindow();
    observePage(page);
    if (offline) await page.context().setOffline(true);
    await page.waitForFunction(() => Boolean(window.__ENJOY_APP__?.appSettings));
    const configuredLibraryPath = await page.evaluate(() => window.__ENJOY_APP__.appSettings.getLibrary());
    const [libraryRoot, configuredLibrary] = await Promise.all([
      realpath(directories.library),
      realpath(configuredLibraryPath),
    ]);
    const relativeLibrary = path.relative(libraryRoot, configuredLibrary);
    if (relativeLibrary.startsWith("..") || path.isAbsolute(relativeLibrary)) {
      throw new Error("Packaged app selected a library outside the isolated fixture");
    }
    actualLibraryPath = configuredLibrary;
  };

  const isSubjectRenderer = (diagnostic: RawPageDiagnostic): boolean => {
    if (diagnostic.page !== page) return false;
    try {
      return new URL(diagnostic.page.url()).protocol === "file:";
    } catch {
      return false;
    }
  };

  const isExpectedLocalModelProbe = (diagnostic: RawPageDiagnostic): boolean =>
    isSubjectRenderer(diagnostic)
    && diagnostic.source === "console"
    && diagnostic.sourceUrl !== null
    && expectedLocalModelProbeUrls.has(diagnostic.sourceUrl)
    && /Failed to load resource: net::ERR_(?:CONNECTION_REFUSED|INTERNET_DISCONNECTED)/u.test(diagnostic.message);

  const isExpectedOfflineYoutubeThumbnail = (diagnostic: RawPageDiagnostic): boolean =>
    offline
    && isSubjectRenderer(diagnostic)
    && diagnostic.source === "console"
    && diagnostic.sourceUrl !== null
    && failedOfflineYoutubeImages.get(diagnostic.page)?.has(diagnostic.sourceUrl) === true
    && diagnostic.message.split("\n", 1)[0] === "Failed to load resource: net::ERR_INTERNET_DISCONNECTED";

  const isExpectedPageDiagnostic = (diagnostic: RawPageDiagnostic): boolean =>
    isExpectedLocalModelProbe(diagnostic) || isExpectedOfflineYoutubeThumbnail(diagnostic);

  const isExpectedOfflineAudibleWarning = (message: string): boolean =>
    offline && offlineAudibleConnectivityWarning.test(message);

  const issues = (): LocalRuntimeIssues => ({
    pageErrors: pageDiagnostics
      .filter(diagnostic => isSubjectRenderer(diagnostic) && !isExpectedPageDiagnostic(diagnostic) && diagnostic.source === "pageerror")
      .map(diagnostic => diagnostic.message),
    pageConsoleErrors: pageDiagnostics
      .filter(diagnostic => isSubjectRenderer(diagnostic) && !isExpectedPageDiagnostic(diagnostic) && diagnostic.source === "console")
      .map(diagnostic => diagnostic.message),
    mainConsoleErrors: mainConsoleErrors.filter(message => !isExpectedOfflineAudibleWarning(message)),
    mainStderrErrors: mainStderrErrors.filter(message => !isExpectedOfflineAudibleWarning(message)),
  });

  const toPageDiagnostic = (diagnostic: RawPageDiagnostic): LocalPageDiagnostic => ({
    source: diagnostic.source,
    provenance: isSubjectRenderer(diagnostic) ? "enjoy-renderer" : "external-webcontents",
    pageUrl: sanitizeDiagnosticUrl(diagnostic.pageUrl),
    sourceUrl: diagnostic.sourceUrl ? sanitizeDiagnosticUrl(diagnostic.sourceUrl) : null,
    message: diagnostic.message,
    ...(isExpectedLocalModelProbe(diagnostic)
      ? { classification: "local-model-discovery-probe" as const }
      : isExpectedOfflineYoutubeThumbnail(diagnostic)
        ? { classification: "offline-youtube-thumbnail" as const }
        : {}),
  });

  const currentExpectedDiagnostics = (): LocalExpectedRuntimeDiagnostic[] => [
    ...pageDiagnostics
        .filter(isExpectedPageDiagnostic)
        .map(diagnostic => ({
          source: diagnostic.source,
          provenance: "enjoy-renderer" as const,
          pageUrl: sanitizeDiagnosticUrl(diagnostic.pageUrl),
          sourceUrl: diagnostic.sourceUrl ? sanitizeDiagnosticUrl(diagnostic.sourceUrl) : null,
          message: diagnostic.message,
          classification: isExpectedLocalModelProbe(diagnostic)
            ? "local-model-discovery-probe" as const
            : "offline-youtube-thumbnail" as const,
          ...(isExpectedOfflineYoutubeThumbnail(diagnostic)
            ? {
                requestResourceType: "image" as const,
                requestFailure: "net::ERR_INTERNET_DISCONNECTED" as const,
              }
            : {}),
        })),
    ...consumedExpectedDiagnostics,
    ...mainConsoleErrors
      .filter(isExpectedOfflineAudibleWarning)
      .map(message => ({
        source: "main-console" as const,
        provenance: "main-process" as const,
        sourceUrl: "https://www.audible.com/adblbestsellers",
        message,
        classification: "offline-audible-connectivity" as const,
      })),
    ...mainStderrErrors
      .filter(isExpectedOfflineAudibleWarning)
      .map(message => ({
        source: "main-stderr" as const,
        provenance: "main-process" as const,
        sourceUrl: "https://www.audible.com/adblbestsellers",
        message,
        classification: "offline-audible-connectivity" as const,
      })),
  ];

  const currentExternalPageDiagnostics = (): LocalPageDiagnostic[] => pageDiagnostics
    .filter(diagnostic => !isSubjectRenderer(diagnostic))
    .map(toPageDiagnostic);

  const runtimeDiagnostics = (): LocalRuntimeDiagnostics => ({
    unexpected: issues(),
    expected: [...archivedExpectedDiagnostics, ...currentExpectedDiagnostics()],
    externalPages: [...archivedExternalPageDiagnostics, ...currentExternalPageDiagnostics()],
  });

  const clearActiveRuntimeDiagnostics = (): void => {
    pageDiagnostics.length = 0;
    pageDiagnosticCounts.clear();
    failedOfflineYoutubeImages.clear();
    consumedExpectedDiagnostics.length = 0;
    mainConsoleErrors.length = 0;
    mainStderrErrors.length = 0;
  };

  const clearRuntimeDiagnostics = (): void => {
    clearActiveRuntimeDiagnostics();
    archivedExpectedDiagnostics.length = 0;
    archivedExternalPageDiagnostics.length = 0;
  };

  const assertNoRuntimeIssues = (): void => {
    const found = issues();
    if (Object.values(found).every(values => values.length === 0)) return;
    throw new Error(`Local packaged app reported runtime errors:\n${JSON.stringify(found, null, 2)}`);
  };

  try {
    if (options.seed) {
      const profileDirectory = path.join(directories.library, "EnjoyLibrary", profileId);
      const assetDirectory = path.join(profileDirectory, "learning-assets");
      await mkdir(assetDirectory, { recursive: true });
      await copyFile(options.seed.databasePath, path.join(profileDirectory, "enjoy_database.sqlite"));
      for (const asset of options.seed.assets) {
        if (!/^[A-Za-z0-9-]+\.(?:png|jpg|jpeg|webp)$/iu.test(asset.relativePath)) {
          throw new Error("Seed asset must have a plain image filename");
        }
        await copyFile(asset.sourcePath, path.join(assetDirectory, asset.relativePath));
      }
    }
    await launch();
  } catch (error) {
    closing = true;
    await electronApp?.close().catch(() => undefined);
    await removeDirectories(directories).catch(() => undefined);
    throw error;
  }

  const fixture: LocalApp = {
    directories,
    get databasePath() {
      if (!actualLibraryPath) throw new Error("Local library path is not ready");
      return path.join(actualLibraryPath, profileId, "enjoy_database.sqlite");
    },
    get electronApp() {
      if (!electronApp) throw new Error("Local Electron app is not running");
      return electronApp;
    },
    get page() {
      if (!page) throw new Error("Local Electron page is not ready");
      return page;
    },
    get offline() {
      return offline;
    },
    restart: async (restartOptions = {}) => {
      if (closed) throw new Error("Cannot restart a closed local app");
      assertNoRuntimeIssues();
      archivedExpectedDiagnostics.push(...currentExpectedDiagnostics());
      archivedExternalPageDiagnostics.push(...currentExternalPageDiagnostics());
      clearActiveRuntimeDiagnostics();
      closing = true;
      await electronApp?.close();
      electronApp = undefined;
      page = undefined;
      observedPages.clear();
      closing = false;
      offline = restartOptions.offline === true;
      await launch();
    },
    consumeExpectedRuntimeError: (fragment: string) => {
      const matches: string[] = [];
      for (let index = pageDiagnostics.length - 1; index >= 0; index -= 1) {
        const diagnostic = pageDiagnostics[index];
        if (!isSubjectRenderer(diagnostic) || !diagnostic.message.includes(fragment)) continue;
        matches.push(diagnostic.message);
        consumedExpectedDiagnostics.push({
          source: diagnostic.source,
          provenance: "enjoy-renderer",
          pageUrl: sanitizeDiagnosticUrl(diagnostic.pageUrl),
          sourceUrl: diagnostic.sourceUrl ? sanitizeDiagnosticUrl(diagnostic.sourceUrl) : null,
          message: diagnostic.message,
          classification: "test-expected-runtime-error",
        });
        pageDiagnostics.splice(index, 1);
      }
      for (const [source, values] of [
        ["main-console", mainConsoleErrors],
        ["main-stderr", mainStderrErrors],
      ] as const) {
        for (let index = values.length - 1; index >= 0; index -= 1) {
          if (!values[index].includes(fragment)) continue;
          const message = values[index];
          matches.push(message);
          consumedExpectedDiagnostics.push({
            source,
            provenance: "main-process",
            message,
            classification: "test-expected-runtime-error",
          });
          values.splice(index, 1);
        }
      }
      return matches.length;
    },
    runtimeDiagnostics,
    clearRuntimeDiagnostics,
    assertNoRuntimeIssues,
    close: async () => {
      if (closed) return;
      closed = true;
      let runtimeFailure: unknown;
      try {
        assertNoRuntimeIssues();
      } catch (error) {
        runtimeFailure = error;
      }
      closing = true;
      let closeFailure: unknown;
      try {
        await electronApp?.close();
      } catch (error) {
        closeFailure = error;
      } finally {
        await removeDirectories(directories);
      }
      if (runtimeFailure) throw runtimeFailure;
      if (closeFailure) throw closeFailure;
    },
  };
  return fixture;
}

export async function writeReceipt(testInfo: TestInfo, name: string, payload: unknown): Promise<string> {
  if (path.basename(name) !== name || !name.endsWith(".json")) throw new Error("Invalid receipt filename");
  const receiptPath = testInfo.outputPath(name);
  await writeFile(receiptPath, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600, flag: "w" });
  await testInfo.attach(name, { path: receiptPath, contentType: "application/json" });
  return receiptPath;
}

export async function backupLocalDatabase(databasePath: string, destination: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const database = new SqliteDatabase(databasePath, error => {
      if (error) { reject(error); return; }
      type Backup = {
        step(pages: number, callback: (stepError: Error | null) => void): void;
        finish(callback: (finishError: Error | null) => void): void;
      };
      const databaseWithBackup = database as typeof database & {
        backup(path: string, callback: (initializeError: Error | null) => void): Backup;
      };
      const finish = (operationError: Error | null): void => {
        backup.finish(finishError => {
          database.close(closeError => {
            const failure = operationError || finishError || closeError;
            if (failure) reject(failure);
            else resolve();
          });
        });
      };
      const backup = databaseWithBackup.backup(destination, initializeError => {
        if (initializeError) { finish(initializeError); return; }
        backup.step(-1, stepError => finish(stepError));
      });
    });
  });
  await chmod(destination, 0o600);
}

export function queryLocalDatabase<Row extends Record<string, unknown>>(
  databasePath: string,
  sql: string,
  parameters: readonly unknown[] = [],
): Promise<Row[]> {
  return new Promise((resolve, reject) => {
    const database = new SqliteDatabase(databasePath, OPEN_READONLY, openError => {
      if (openError) {
        reject(openError);
        return;
      }
      database.all(sql, [...parameters], (queryError, rows: Row[]) => {
        database.close(closeError => {
          if (queryError) reject(queryError);
          else if (closeError) reject(closeError);
          else resolve(rows);
        });
      });
    });
  });
}
