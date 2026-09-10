import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";

import { pinExecutable, type ExecutablePin } from "./process-manager";
import type { NativeAgentProbe, NativeAgentProvider } from "./native-types";

const COMMAND_TIMEOUT_MS = 10_000;
const VERSION_OUTPUT_LIMIT_BYTES = 4 * 1024;
const STATUS_OUTPUT_LIMIT_BYTES = 64 * 1024;
const PROCESS_GROUP_GRACE_MS = 250;
const PROCESS_GROUP_KILL_WAIT_MS = 1_000;

const KNOWN_VERSIONS: Readonly<Record<NativeAgentProvider, readonly string[]>> = Object.freeze({
  codex: Object.freeze(["0.153.2", "0.153.4"]),
  claude: Object.freeze(["2.1.263", "2.1.266"]),
});

const COMMON_AUTH_ENV_KEYS = Object.freeze([
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "PATH",
  "LANG",
  "LC_ALL",
  "TERM",
  "TZ",
  "TMPDIR",
]);

const PROVIDER_AUTH_ENV_KEYS: Readonly<Record<NativeAgentProvider, readonly string[]>> = Object.freeze({
  codex: Object.freeze(["CODEX_HOME"]),
  claude: Object.freeze(["CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"]),
});

type NativeProbeReason =
  | "native_binary_missing"
  | "native_version_unsupported"
  | "native_auth_unconfirmed"
  | "native_probe_failed";

type BoundedCommandResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  timedOut: boolean;
  outputLimit: boolean;
  spawnFailed: boolean;
  cleanupVerified: boolean;
};

function isNativeAgentProvider(value: unknown): value is NativeAgentProvider {
  return value === "codex" || value === "claude";
}

function assertNativeAgentProvider(value: unknown): asserts value is NativeAgentProvider {
  if (!isNativeAgentProvider(value)) throw new TypeError("unsupported_provider");
}

/**
 * Keep only the host identity and profile-location variables that the native
 * CLI itself needs. Credential variables and all other host variables are
 * intentionally omitted. This is also the environment contract for adapters.
 */
export function nativeAuthEnvironment(
  provider: NativeAgentProvider,
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  assertNativeAgentProvider(provider);
  const names = [
    ...COMMON_AUTH_ENV_KEYS,
    ...PROVIDER_AUTH_ENV_KEYS[provider],
  ];
  const environment: Record<string, string> = {};
  for (const name of names) {
    const value = source[name];
    if (typeof value === "string") environment[name] = value;
  }
  return Object.freeze(environment) as Record<string, string>;
}

function addUniquePath(paths: string[], value: string): void {
  if (!value || value.includes("\0") || !isAbsolute(value)) return;
  if (!paths.includes(value)) paths.push(value);
}

function candidatePaths(provider: NativeAgentProvider, binaryPath?: string): string[] {
  const paths: string[] = [];
  const binaryName = provider;

  // A configured executable is accepted only as an absolute path. Relative
  // hints must never turn discovery into shell or login-shell resolution.
  if (binaryPath !== undefined) {
    if (typeof binaryPath === "string" && isAbsolute(binaryPath) && !binaryPath.includes("\0")) {
      paths.push(binaryPath);
    }
    return paths;
  }

  if (typeof process.env.PATH === "string") {
    for (const entry of process.env.PATH.split(delimiter)) {
      addUniquePath(paths, join(entry, binaryName));
    }
  }

  let home = process.env.HOME;
  if (!home) {
    try {
      home = homedir();
    } catch {
      home = undefined;
    }
  }
  if (home) addUniquePath(paths, join(home, ".local", "bin", binaryName));
  addUniquePath(paths, join("/opt/homebrew/bin", binaryName));
  addUniquePath(paths, join("/usr/local/bin", binaryName));
  return paths;
}

async function discoverNativeExecutableAt(
  provider: NativeAgentProvider,
  binaryPath: string | undefined,
  jobRoot: string,
): Promise<ExecutablePin | null> {
  assertNativeAgentProvider(provider);
  for (const candidate of candidatePaths(provider, binaryPath)) {
    try {
      return await pinExecutable(candidate, { jobRoot });
    } catch {
      // Discovery is best-effort. Invalid, missing and job-local candidates
      // are skipped without exposing filesystem or process diagnostics.
    }
  }
  return null;
}

/** Find and pin a canonical native CLI executable without invoking a shell. */
export async function discoverNativeExecutable(
  provider: NativeAgentProvider,
  binaryPath?: string,
): Promise<ExecutablePin | null> {
  assertNativeAgentProvider(provider);
  const directory = await mkdtemp(join(tmpdir(), "enjoy-native-probe-"));
  try {
    return await discoverNativeExecutableAt(provider, binaryPath, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function groupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitForGroupGone(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!groupExists(pid)) return true;
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 10));
  }
  return !groupExists(pid);
}

/** Stop only the detached process group owned by this probe. */
async function terminateOwnedProcessGroup(child: ChildProcess): Promise<boolean> {
  const pid = child.pid;
  if (typeof pid !== "number" || pid <= 1) {
    try {
      child.kill("SIGTERM");
    } catch {
      // The child already exited.
    }
    return true;
  }

  if (process.platform === "win32") {
    try {
      child.kill("SIGTERM");
    } catch {
      // The child already exited.
    }
    return true;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // The process group already exited.
    }
  }
  if (await waitForGroupGone(pid, PROCESS_GROUP_GRACE_MS)) return true;

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // The process group already exited.
    }
  }
  return waitForGroupGone(pid, PROCESS_GROUP_KILL_WAIT_MS);
}

function asBuffer(chunk: Buffer | string): Buffer {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
}

function runBoundedCommand(
  executable: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    captureStdout: boolean;
    maxStdoutBytes: number;
  },
): Promise<BoundedCommandResult> {
  return new Promise((resolveResult) => {
    let child: ChildProcess | undefined;
    let closeObserved = false;
    let settled = false;
    let finalisationStarted = false;
    let timedOut = false;
    let outputLimit = false;
    let spawnFailed = false;
    let exitCode: number | null = null;
    let signal: NodeJS.Signals | null = null;
    let cleanupPromise: Promise<boolean> | undefined;
    let stdoutBytes = 0;
    const stdoutChunks: Buffer[] = [];

    const ensureCleanup = (): Promise<boolean> => {
      if (!cleanupPromise) {
        cleanupPromise = child
          ? terminateOwnedProcessGroup(child).catch(() => false)
          : Promise.resolve(true);
      }
      return cleanupPromise;
    };

    const settle = () => {
      if (settled || finalisationStarted) return;
      if (!closeObserved && !timedOut && !outputLimit && !spawnFailed) return;
      finalisationStarted = true;
      void ensureCleanup().then((cleanupVerified) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolveResult({
          exitCode,
          signal,
          stdout: outputLimit ? "" : Buffer.concat(stdoutChunks).toString("utf8"),
          timedOut,
          outputLimit,
          spawnFailed,
          cleanupVerified,
        });
      });
    };

    const stop = (kind: "timeout" | "output_limit") => {
      if (kind === "timeout") timedOut = true;
      else outputLimit = true;
      void ensureCleanup();
      settle();
    };

    const timer = setTimeout(() => stop("timeout"), COMMAND_TIMEOUT_MS);

    try {
      child = spawn(executable, [...args], {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", options.captureStdout ? "pipe" : "ignore", "ignore"],
        windowsHide: true,
      });
    } catch {
      spawnFailed = true;
      closeObserved = true;
      settle();
      return;
    }

    child.once("error", () => {
      if (closeObserved) return;
      spawnFailed = true;
      void ensureCleanup();
      settle();
    });
    child.once("close", (code, signalName) => {
      closeObserved = true;
      exitCode = code;
      signal = signalName;
      void ensureCleanup();
      settle();
    });

    if (options.captureStdout && child.stdout) {
      child.stdout.on("data", (chunk: Buffer | string) => {
        if (settled || outputLimit || timedOut) return;
        const data = asBuffer(chunk);
        stdoutBytes += data.byteLength;
        if (stdoutBytes > options.maxStdoutBytes) {
          stop("output_limit");
          return;
        }
        stdoutChunks.push(data);
      });
    }

    settle();
  });
}

/**
 * Parse only the complete, provider-specific --version line. A loose search
 * through logs could turn arbitrary output into a compatibility claim.
 */
export function parseNativeVersion(
  provider: NativeAgentProvider,
  output: string,
): string | null {
  assertNativeAgentProvider(provider);
  const value = output.trim();
  const versionPattern = "([0-9]+\\.[0-9]+\\.[0-9]+)";
  const patterns = provider === "codex"
    ? [new RegExp(`^codex-cli\\s+${versionPattern}$`, "i"), new RegExp(`^codex\\s+${versionPattern}$`, "i")]
    : [new RegExp(`^${versionPattern}\\s+\\(Claude Code\\)$`, "i"), new RegExp(`^claude(?:-code)?\\s+${versionPattern}$`, "i")];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match?.[1]) return match[1];
  }
  return null;
}

function parseClaudeAuthStatus(output: string): boolean {
  try {
    const parsed: unknown = JSON.parse(output);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    return (parsed as { loggedIn?: unknown }).loggedIn === true;
  } catch {
    return false;
  }
}

function probeResult(
  provider: NativeAgentProvider,
  executable: ExecutablePin | null,
  version: string | null,
  authenticated: boolean,
  reason: NativeProbeReason | null,
): NativeAgentProbe {
  // Auth status proves only that the selected CLI identity is available. It
  // does not prove inference acceptance, quota, MCP access or image bytes.
  const compatible = version !== null && KNOWN_VERSIONS[provider].includes(version);
  const ready = compatible && authenticated;
  return Object.freeze({
    provider,
    executable,
    version,
    authenticated,
    text: ready,
    image: ready && provider === "codex",
    reason,
  });
}

/** Probe a known native CLI using bounded, status-only commands. */
export async function probeNativeAgent(
  provider: NativeAgentProvider,
  options: { binaryPath?: string; cwd?: string } = {},
): Promise<NativeAgentProbe> {
  assertNativeAgentProvider(provider);
  // Finder can launch the app with cwd="/". It is not a job directory and
  // must never become the executable exclusion boundary for a status probe.
  if (options.cwd) return probeNativeAgentAt(provider, options.binaryPath, resolve(options.cwd));
  const directory = await mkdtemp(join(tmpdir(), "enjoy-native-probe-"));
  const lifecycle = { cleanupVerified: true };
  try {
    return await probeNativeAgentAt(provider, options.binaryPath, directory, lifecycle);
  } finally {
    // Keep ownership of the directory if a bounded probe could not verify exit.
    if (lifecycle.cleanupVerified) await rm(directory, { recursive: true, force: true });
  }
}

async function probeNativeAgentAt(
  provider: NativeAgentProvider,
  binaryPath: string | undefined,
  cwd: string,
  lifecycle?: { cleanupVerified: boolean },
): Promise<NativeAgentProbe> {
  let executable: ExecutablePin | null;
  try {
    executable = await discoverNativeExecutableAt(provider, binaryPath, cwd);
  } catch {
    return probeResult(provider, null, null, false, "native_probe_failed");
  }
  if (!executable) return probeResult(provider, null, null, false, "native_binary_missing");

  const environment = nativeAuthEnvironment(provider);
  let versionResult: BoundedCommandResult;
  try {
    versionResult = await runBoundedCommand(executable.path, ["--version"], {
      cwd,
      env: environment,
      captureStdout: true,
      maxStdoutBytes: VERSION_OUTPUT_LIMIT_BYTES,
    });
  } catch {
    return probeResult(provider, executable, null, false, "native_probe_failed");
  }
  if (lifecycle && !versionResult.cleanupVerified) lifecycle.cleanupVerified = false;
  if (versionResult.timedOut
    || versionResult.outputLimit
    || versionResult.spawnFailed
    || !versionResult.cleanupVerified
    || versionResult.exitCode !== 0) {
    return probeResult(provider, executable, null, false, "native_probe_failed");
  }

  const version = parseNativeVersion(provider, versionResult.stdout);
  if (!version || !KNOWN_VERSIONS[provider].includes(version)) {
    return probeResult(provider, executable, version, false, "native_version_unsupported");
  }

  const authArgs: readonly string[] = provider === "codex"
    ? ["login", "status"]
    : ["auth", "status", "--json"];
  let authResult: BoundedCommandResult;
  try {
    authResult = await runBoundedCommand(executable.path, authArgs, {
      cwd,
      env: environment,
      captureStdout: provider === "claude",
      maxStdoutBytes: STATUS_OUTPUT_LIMIT_BYTES,
    });
  } catch {
    return probeResult(provider, executable, version, false, "native_probe_failed");
  }
  if (lifecycle && !authResult.cleanupVerified) lifecycle.cleanupVerified = false;
  if (authResult.timedOut || authResult.outputLimit || authResult.spawnFailed || !authResult.cleanupVerified) {
    return probeResult(provider, executable, version, false, "native_probe_failed");
  }

  const authenticated = authResult.exitCode === 0
    && (provider === "codex" || parseClaudeAuthStatus(authResult.stdout));
  return probeResult(
    provider,
    executable,
    version,
    authenticated,
    authenticated ? null : "native_auth_unconfirmed",
  );
}

export { KNOWN_VERSIONS as NATIVE_KNOWN_VERSIONS };
