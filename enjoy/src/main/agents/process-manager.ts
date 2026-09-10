import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createReadStream, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { assertAllowedNetworkUrl } from "@/lib/network-policy";

/** A stable, non-secret identity for an executable selected by the user. */
export interface ExecutablePin {
  path: string;
  realpath: string;
  sha256: string;
  size: number;
  mtimeMs: number;
}

export type ProcessResultReason =
  | "completed"
  | "process_exit"
  | "cancelled"
  | "timeout"
  | "output_limit"
  | "protocol_error"
  | "spawn_failed";

export interface ProcessResult {
  id: string;
  reason: ProcessResultReason;
  eventCount: number;
  stdoutBytes: number;
  stderrBytes: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  groupCleanupVerified: boolean;
  errorCode?: string;
}

export interface ProcessStartOptions<T = unknown> {
  /** Only a previously pinned executable may be spawned. */
  executable: ExecutablePin;
  args?: readonly string[];
  /** Explicit job working directory. It must be inside the manager job root. */
  cwd: string;
  env?: Record<string, string | undefined>;
  /** Restricted to the fixed allowlist. Unknown names are ignored. */
  envAllowlist?: readonly string[];
  timeoutMs?: number;
  maxLineBytes?: number;
  maxOutputBytes?: number;
  killGraceMs?: number;
  onMessage?: (message: T) => void;
  signal?: AbortSignal;
  /** Raw byte streams are reserved for framed protocols such as ACP. */
  protocol?: "jsonl" | "bytes";
}

export type ProcessByteStreams = Readonly<{
  writable: WritableStream<Uint8Array>;
  readable: ReadableStream<Uint8Array>;
}>;

export interface ManagedProcess {
  id: string;
  readonly pid: number | undefined;
  readonly result: Promise<ProcessResult>;
  write(message: unknown): Promise<void>;
  cancel(): Promise<ProcessResult>;
}

export interface ManagedByteProcess extends ManagedProcess {
  readonly streams: ProcessByteStreams;
}

export type ProcessAuthMode = "isolated" | "existing-codex" | "existing-claude";

export interface ProcessManagerOptions {
  jobRoot?: string;
  /** App-owned profile directory, outside jobRoot and distinct from the host HOME. */
  isolatedHome: string;
  /** Select the private profile or an existing native CLI identity. */
  authMode?: ProcessAuthMode;
  envAllowlist?: readonly string[];
  maxLineBytes?: number;
  maxOutputBytes?: number;
  killGraceMs?: number;
}

export class ProcessManagerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProcessManagerError";
    this.code = code;
  }
}

function assertPrivateEnvironmentPath(key: string, value: string, isolatedHome: string): string {
  if (!isAbsolute(value) || value.includes("\0")) {
    throw new ProcessManagerError("invalid_environment", `${key} must be an absolute private path`);
  }
  if (!isWithin(value, isolatedHome)) {
    throw new ProcessManagerError("invalid_environment", `${key} must be inside isolatedHome`);
  }
  return resolve(value);
}

const STANDARD_ENV_KEYS = Object.freeze([
  "PATH",
  "LANG",
  "LC_ALL",
  "TERM",
  "TZ",
]);

const PROXY_ENV_KEYS = Object.freeze([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
]);
const PROXY_URL_ENV_KEYS = new Set(PROXY_ENV_KEYS.filter((key) => key.toLowerCase() !== "no_proxy"));

const SCOPED_ENV_KEYS = Object.freeze([
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "ANTHROPIC_CONFIG_DIR",
  "ENJOY_MCP_TOKEN",
  "CODEX_PATH",
  "CODEX_CONFIG",
  "INITIAL_AGENT_MODE",
  "NO_BROWSER",
  "CLAUDE_CODE_EXECUTABLE",
  ...PROXY_ENV_KEYS,
]);

const DEFAULT_ENV_ALLOWLIST = Object.freeze([
  ...STANDARD_ENV_KEYS,
  ...SCOPED_ENV_KEYS,
]);

const FIXED_ENV_KEYS = new Set(DEFAULT_ENV_ALLOWLIST);
const HOST_ENV_KEYS = new Set(STANDARD_ENV_KEYS);
const PRIVATE_PATH_ENV_KEYS = new Set([
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "ANTHROPIC_CONFIG_DIR",
]);
const NATIVE_IDENTITY_ENV_KEYS = Object.freeze([
  "HOME",
  "USER",
  "LOGNAME",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
]);
const NATIVE_PROFILE_ENV_KEYS_BY_MODE: Record<Exclude<ProcessAuthMode, "isolated">, readonly string[]> = {
  "existing-codex": ["CODEX_HOME"],
  "existing-claude": ["CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"],
};

const DEFAULT_MAX_LINE_BYTES = 1_048_576;
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1_048_576;
const DEFAULT_KILL_GRACE_MS = 1_000;

function assertFinitePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ProcessManagerError("invalid_option", `${name} must be a finite positive number`);
  }
  return Math.floor(value);
}

function assertAuthMode(value: ProcessAuthMode | undefined): ProcessAuthMode {
  if (value === undefined) return "isolated";
  if (value === "isolated" || value === "existing-codex" || value === "existing-claude") return value;
  throw new ProcessManagerError("invalid_option", "authMode is unsupported");
}

function snapshotNativeIdentity(source: NodeJS.ProcessEnv, authMode: ProcessAuthMode): Record<string, string> {
  if (authMode === "isolated") return {};
  const profileKeys = NATIVE_PROFILE_ENV_KEYS_BY_MODE[authMode];
  const keys = ["HOME", "USER", "LOGNAME", ...profileKeys];
  return Object.fromEntries(keys
    .filter((key) => typeof source[key] === "string")
    .map((key) => [key, source[key] as string]));
}

function assertNoNativeIdentityOverrides(
  overrides: Record<string, string | undefined> | undefined,
  authMode: ProcessAuthMode,
): void {
  if (authMode === "isolated" || !overrides) return;
  for (const key of NATIVE_IDENTITY_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      throw new ProcessManagerError("invalid_environment", `${key} cannot be overridden in ${authMode}`);
    }
  }
}

function canonicalDirectory(directory: string, name: string): string {
  if (!isAbsolute(directory)) {
    throw new ProcessManagerError("invalid_path", `${name} must be absolute`);
  }
  try {
    const stats = statSync(directory);
    if (!stats.isDirectory()) {
      throw new ProcessManagerError("invalid_path", `${name} must be a directory`);
    }
    return realpathSync(directory);
  } catch (error) {
    if (error instanceof ProcessManagerError) throw error;
    throw new ProcessManagerError("invalid_path", `${name} is unavailable`);
  }
}

function isWithin(candidate: string, parent: string): boolean {
  const normalise = (value: string) => process.platform === "darwin"
    ? value.replace(/^\/private(?=\/|$)/, "")
    : value;
  const child = normalise(resolve(candidate));
  const base = normalise(resolve(parent));
  const difference = relative(base, child);
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference));
}

function digestFile(filePath: string): Promise<string> {
  return new Promise((resolveDigest, rejectDigest) => {
    const hash = createHash("sha256");
    const input = createReadStream(filePath);
    input.on("data", (chunk: Buffer) => hash.update(chunk));
    input.once("error", rejectDigest);
    input.once("end", () => resolveDigest(hash.digest("hex")));
  });
}

/**
 * Pin a user-selected executable before a job is allowed to spawn it.
 * The returned identity contains no command output or credentials.
 */
export async function pinExecutable(
  executablePath: string,
  options: { jobRoot?: string } = {},
): Promise<ExecutablePin> {
  if (!isAbsolute(executablePath)) {
    throw new ProcessManagerError("invalid_executable", "executable must be an absolute path");
  }
  const jobRoot = canonicalDirectory(options.jobRoot || process.cwd(), "jobRoot");
  if (isWithin(executablePath, jobRoot)) {
    throw new ProcessManagerError("invalid_executable", "executable must be outside the job root");
  }
  let canonical: string;
  let stats: ReturnType<typeof statSync>;
  try {
    canonical = realpathSync(executablePath);
    stats = statSync(canonical);
  } catch {
    throw new ProcessManagerError("invalid_executable", "executable is unavailable");
  }
  if (!stats.isFile()) {
    throw new ProcessManagerError("invalid_executable", "executable must be a regular file");
  }
  if ((stats.mode & 0o111) === 0) {
    throw new ProcessManagerError("invalid_executable", "executable is not executable");
  }
  if (isWithin(canonical, jobRoot)) {
    throw new ProcessManagerError("invalid_executable", "executable must be outside the job root");
  }
  let sha256: string;
  try {
    sha256 = await digestFile(canonical);
  } catch {
    throw new ProcessManagerError("invalid_executable", "executable cannot be hashed");
  }
  return Object.freeze({
    path: canonical,
    realpath: canonical,
    sha256,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  });
}

/** Build a child environment without inheriting arbitrary host variables. */
export function buildAllowlistedEnv(options: {
  baseEnv?: NodeJS.ProcessEnv;
  overrides?: Record<string, string | undefined>;
  allowlist?: readonly string[];
} = {}): Record<string, string> {
  const requested = new Set(options.allowlist || DEFAULT_ENV_ALLOWLIST);
  const allowlist = new Set([...requested].filter((key) => FIXED_ENV_KEYS.has(key)));
  const source = options.baseEnv || process.env;
  const overrides = options.overrides || {};
  const output: Record<string, string> = {};
  for (const key of allowlist) {
    // Standard host variables may come from the supplied base environment. Private
    // profile and capability variables must always be explicitly supplied by main.
    const value = HOST_ENV_KEYS.has(key) && !Object.prototype.hasOwnProperty.call(overrides, key)
      ? source[key]
      : overrides[key];
    if (typeof value === "string") output[key] = value;
  }
  for (const key of PROXY_URL_ENV_KEYS) {
    const value = output[key];
    if (!value) continue;
    try {
      assertAllowedNetworkUrl(value, {
        transport: "native-subprocess",
        operation: "proxy-env",
      });
    } catch (error) {
      const code = error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : "invalid_environment";
      throw new ProcessManagerError(code, "The native subprocess proxy is not allowed");
    }
  }
  return output;
}

/** Remove sensitive values while retaining a short, useful diagnostic. */
export function sanitizeDiagnostic(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value).replace(/[\r\n\t]+/g, " ").trim();
  text = text
    .replace(/authorization\s*:\s*bearer\s+[^\s,;]+/gi, "authorization: [redacted]")
    .replace(/(?:api[_-]?key|token|secret|password|auth(?:entication|orization)?)[=:]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/https?:\/\/[^\s]+/gi, "[url-redacted]");
  return text.slice(0, 240);
}

function safeArgs(args: readonly string[] | undefined): string[] {
  const values = [...(args || [])];
  for (const value of values) {
    if (value.includes("\0")) throw new ProcessManagerError("invalid_arguments", "arguments cannot contain NUL");
  }
  return values;
}

function safeExecutablePath(executable: ExecutablePin, jobRoot: string): string {
  if (!executable || executable.path !== executable.realpath || !isAbsolute(executable.realpath) || executable.realpath.includes("\0") || !/^[a-f0-9]{64}$/.test(executable.sha256) || !Number.isFinite(executable.size) || !Number.isFinite(executable.mtimeMs)) {
    throw new ProcessManagerError("invalid_executable", "a valid executable pin is required");
  }
  try {
    const canonical = realpathSync(executable.realpath);
    const stats = statSync(canonical);
    if (!stats.isFile() || (stats.mode & 0o111) === 0 || isWithin(canonical, jobRoot)) {
      throw new Error("invalid executable");
    }
    if (canonical !== executable.realpath || stats.size !== executable.size || stats.mtimeMs !== executable.mtimeMs) {
      throw new Error("executable changed");
    }
    const currentHash = createHash("sha256").update(readFileSync(canonical)).digest("hex");
    if (currentHash !== executable.sha256) throw new Error("executable changed");
    return canonical;
  } catch {
    throw new ProcessManagerError("invalid_executable", "executable pin changed or is unavailable");
  }
}

function groupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    // EPERM means the group exists but is not signalable by this process.
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

/** Stop the owned process group and wait until the group no longer exists. */
async function terminateProcessGroup(child: ChildProcessWithoutNullStreams, graceMs: number): Promise<boolean> {
  const pid = child.pid;
  if (typeof pid !== "number" || pid <= 1) {
    try { child.kill("SIGTERM"); } catch { /* The process has already exited. */ }
    return true;
  }
  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      });
      await new Promise<void>((resolveKill) => {
        killer.once("error", resolveKill);
        killer.once("close", () => resolveKill());
      });
    } catch {
      try { child.kill("SIGTERM"); } catch { /* The process has already exited. */ }
    }
    return waitForGroupGone(pid, Math.max(graceMs, 100));
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try { child.kill("SIGTERM"); } catch { /* The process has already exited. */ }
  }
  if (await waitForGroupGone(pid, graceMs)) return true;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try { child.kill("SIGKILL"); } catch { /* The process has already exited. */ }
  }
  // Keep the ownership check attached to this stop operation. No timer survives
  // the promise, so a later PID reuse cannot receive a delayed signal.
  return waitForGroupGone(pid, Math.max(graceMs * 10, 1_000));
}

class FailedManagedProcess implements ManagedProcess {
  readonly id = randomUUID();
  readonly pid: number | undefined = undefined;
  readonly result: Promise<ProcessResult>;

  constructor(errorCode: string) {
    this.result = Promise.resolve({
      id: this.id,
      reason: "spawn_failed",
      eventCount: 0,
      stdoutBytes: 0,
      stderrBytes: 0,
      exitCode: null,
      signal: null,
      groupCleanupVerified: true,
      errorCode: sanitizeDiagnostic(errorCode) || "spawn_failed",
    });
  }

  cancel(): Promise<ProcessResult> { return this.result; }

  write(): Promise<void> {
    return Promise.reject(new ProcessManagerError("process_closed", "process is not running"));
  }
}

class ManagedProcessImpl<T> implements ManagedProcess {
  readonly id = randomUUID();
  private child: ChildProcessWithoutNullStreams | undefined;
  private byteStreams: ProcessByteStreams | undefined;
  private resolveResult!: (result: ProcessResult) => void;
  private readonly resultPromise: Promise<ProcessResult>;
  private settled = false;
  private requestedReason: ProcessResultReason | undefined;
  private timeout: NodeJS.Timeout | undefined;
  private abortCleanup: (() => void) | undefined;
  private stdoutDecoder = new TextDecoder("utf-8", { fatal: true });
  private stdoutBuffer = "";
  private stdoutBytes = 0;
  private stderrBytes = 0;
  private eventCount = 0;
  private exitCode: number | null = null;
  private signal: NodeJS.Signals | null = null;
  private stopIssued = false;
  private stopPromise: Promise<void> | undefined;
  private stopCompleted = false;
  private groupCleanupVerified = false;
  private pendingSettleCode: string | undefined;
  private readonly maxLineBytes: number;
  private readonly maxOutputBytes: number;
  private readonly killGraceMs: number;
  private readonly onMessage?: (message: T) => void;
  private readonly protocol: "jsonl" | "bytes";
  private readonly executable: string;
  private readonly args: string[];
  private readonly cwd: string;
  private readonly env: Record<string, string>;
  private ownedPid: number | undefined;

  constructor(
    private readonly manager: AgentProcessManager,
    options: ProcessStartOptions<T>,
    defaults: {
      jobRoot: string;
      isolatedHome: string;
      authMode: ProcessAuthMode;
      envAllowlist: readonly string[];
      maxLineBytes: number;
      maxOutputBytes: number;
      killGraceMs: number;
      nativeIdentity: Readonly<Record<string, string>>;
    },
  ) {
    this.resultPromise = new Promise((resolveResult) => { this.resolveResult = resolveResult; });
    this.maxLineBytes = assertFinitePositive(options.maxLineBytes ?? defaults.maxLineBytes, "maxLineBytes");
    this.maxOutputBytes = assertFinitePositive(options.maxOutputBytes ?? defaults.maxOutputBytes, "maxOutputBytes");
    this.killGraceMs = assertFinitePositive(options.killGraceMs ?? defaults.killGraceMs, "killGraceMs");
    this.onMessage = options.onMessage;
    this.protocol = options.protocol ?? "jsonl";
    if (this.protocol === "bytes" && this.onMessage) {
      throw new ProcessManagerError("invalid_option", "byte protocol cannot use onMessage");
    }
    this.args = safeArgs(options.args);
    this.cwd = canonicalDirectory(options.cwd, "cwd");
    if (!isWithin(this.cwd, defaults.jobRoot)) {
      throw new ProcessManagerError("invalid_path", "cwd must be inside the job root");
    }
    this.executable = safeExecutablePath(options.executable, defaults.jobRoot);
    assertNoNativeIdentityOverrides(options.env, defaults.authMode);
    this.env = buildAllowlistedEnv({
      baseEnv: process.env,
      overrides: options.env,
      allowlist: options.envAllowlist || defaults.envAllowlist,
    });
    if (defaults.authMode === "isolated") {
      this.env.HOME = defaults.isolatedHome;
      for (const key of PRIVATE_PATH_ENV_KEYS) {
        const value = options.env?.[key];
        if (value !== undefined) this.env[key] = assertPrivateEnvironmentPath(key, value, defaults.isolatedHome);
      }
    } else {
      Object.assign(this.env, defaults.nativeIdentity);
    }
    const duration = options.timeoutMs === undefined ? undefined : assertFinitePositive(options.timeoutMs, "timeoutMs");
    this.manager.register(this as unknown as ManagedProcessImpl<unknown>);
    this.start(duration, options.signal);
  }

  get pid(): number | undefined { return this.child?.pid ?? undefined; }

  get result(): Promise<ProcessResult> { return this.resultPromise; }

  get streams(): ProcessByteStreams {
    if (!this.byteStreams) {
      throw new ProcessManagerError("process_closed", "byte streams are unavailable");
    }
    return this.byteStreams;
  }

  cancel(): Promise<ProcessResult> {
    this.requestStop("cancelled");
    return this.resultPromise;
  }

  write(message: unknown): Promise<void> {
    if (this.settled || this.stopIssued || !this.child?.stdin || this.child.stdin.destroyed) {
      return Promise.reject(new ProcessManagerError("process_closed", "process is not running"));
    }
    let serialized: string | undefined;
    try {
      if (message === null || typeof message !== "object" || Array.isArray(message)) {
        throw new Error("JSONL message must be an object");
      }
      serialized = JSON.stringify(message);
      if (!serialized) throw new Error("message is not serializable");
    } catch {
      return Promise.reject(new ProcessManagerError("protocol_error", "message is not valid JSONL"));
    }
    const payload = `${serialized}\n`;
    if (Buffer.byteLength(payload, "utf8") > this.maxLineBytes) {
      return Promise.reject(new ProcessManagerError("output_limit", "message exceeds the JSONL line limit"));
    }
    const stdin = this.child.stdin;
    return new Promise<void>((resolveWrite, rejectWrite) => {
      let settledWrite = false;
      const cleanup = () => {
        stdin.off("error", onError);
        stdin.off("close", onClose);
        stdin.off("drain", onDrain);
      };
      const resolveOnce = () => {
        if (settledWrite) return;
        settledWrite = true;
        cleanup();
        resolveWrite();
      };
      const rejectOnce = () => {
        if (settledWrite) return;
        settledWrite = true;
        cleanup();
        rejectWrite(new ProcessManagerError("process_closed", "process input closed"));
      };
      const onError = () => rejectOnce();
      const onClose = () => rejectOnce();
      const onDrain = () => resolveOnce();
      stdin.once("error", onError);
      stdin.once("close", onClose);
      try {
        const accepted = stdin.write(payload, "utf8", () => resolveOnce());
        if (!accepted) stdin.once("drain", onDrain);
        else resolveOnce();
      } catch {
        rejectOnce();
      }
    });
  }

  private start(timeoutMs: number | undefined, signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
      this.requestedReason = "cancelled";
      this.settle();
      return;
    }
    try {
      this.child = spawn(this.executable, this.args, {
        cwd: this.cwd,
        env: this.env,
        shell: false,
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      this.ownedPid = this.child.pid ?? undefined;
      if (this.protocol === "bytes") {
        this.byteStreams = Object.freeze({
          writable: Writable.toWeb(this.child.stdin) as WritableStream<Uint8Array>,
          readable: Readable.toWeb(this.child.stdout) as ReadableStream<Uint8Array>,
        });
      }
    } catch (error) {
      this.requestedReason = "spawn_failed";
      this.exitCode = null;
      this.signal = null;
      this.settle(error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined);
      return;
    }
    this.child.stderr.on("data", (chunk: Buffer | string) => {
      this.stderrBytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
      if (this.stdoutBytes + this.stderrBytes > this.maxOutputBytes) this.requestStop("output_limit");
    });
    this.child.stdout.on("data", (chunk: Buffer | string) => {
      const bytes = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
      if (this.protocol === "bytes") {
        this.stdoutBytes += bytes;
        if (this.stdoutBytes + this.stderrBytes > this.maxOutputBytes) this.requestStop("output_limit");
      } else {
        this.consumeStdout(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
    });
    this.child.once("error", (error: NodeJS.ErrnoException) => {
      if (!this.settled && !this.child?.pid) {
        this.requestedReason = "spawn_failed";
        this.settle(error.code);
      }
    });
    this.child.once("close", (code, signalName) => {
      this.exitCode = code;
      this.signal = signalName;
      this.flushDecoder();
      if (!this.requestedReason) this.requestedReason = code === 0 ? "completed" : "process_exit";
      this.ensureCleanup(this.child as ChildProcessWithoutNullStreams);
      this.settle();
    });
    if (timeoutMs !== undefined) {
      this.timeout = setTimeout(() => this.requestStop("timeout"), timeoutMs);
    }
    if (signal) {
      const onAbort = () => this.requestStop("cancelled");
      signal.addEventListener("abort", onAbort, { once: true });
      this.abortCleanup = () => signal.removeEventListener("abort", onAbort);
    }
  }

  private consumeStdout(chunk: Buffer): void {
    if (this.settled || this.requestedReason) return;
    this.stdoutBytes += chunk.byteLength;
    if (this.stdoutBytes + this.stderrBytes > this.maxOutputBytes) {
      this.requestStop("output_limit");
      return;
    }
    let text: string;
    try {
      text = this.stdoutDecoder.decode(chunk, { stream: true });
    } catch {
      this.requestStop("protocol_error");
      return;
    }
    this.stdoutBuffer += text;
    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      if (this.requestedReason || this.settled) return;
      let line = this.stdoutBuffer.slice(0, newlineIndex);
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (Buffer.byteLength(line, "utf8") > this.maxLineBytes) {
        this.requestStop("output_limit");
        return;
      }
      this.consumeLine(line);
      if (this.settled) return;
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
    if (Buffer.byteLength(this.stdoutBuffer, "utf8") > this.maxLineBytes) this.requestStop("output_limit");
  }

  private flushDecoder(): void {
    if (this.settled || this.requestedReason) return;
    try {
      this.stdoutBuffer += this.stdoutDecoder.decode();
    } catch {
      this.requestedReason ||= "protocol_error";
      return;
    }
    if (this.stdoutBuffer.length > 0) {
      const line = this.stdoutBuffer.endsWith("\r") ? this.stdoutBuffer.slice(0, -1) : this.stdoutBuffer;
      this.stdoutBuffer = "";
      if (Buffer.byteLength(line, "utf8") > this.maxLineBytes) {
        this.requestedReason ||= "output_limit";
      } else {
        this.consumeLine(line);
      }
    }
  }

  private consumeLine(line: string): void {
    if (line.trim() === "") {
      this.requestStop("protocol_error");
      return;
    }
    let message: T;
    try {
      message = JSON.parse(line) as T;
      if (message === null || typeof message !== "object" || Array.isArray(message)) throw new Error("JSONL message must be an object");
    } catch {
      this.requestStop("protocol_error");
      return;
    }
    this.eventCount += 1;
    try {
      this.onMessage?.(message);
    } catch {
      this.requestStop("protocol_error");
    }
  }

  private requestStop(reason: ProcessResultReason): void {
    if (this.settled) return;
    this.requestedReason ||= reason;
    if (!this.child) {
      this.settle();
      return;
    }
    this.ensureCleanup(this.child);
  }

  private ensureCleanup(child: ChildProcessWithoutNullStreams): void {
    if (this.stopIssued) return;
    this.stopIssued = true;
    this.stopPromise = terminateProcessGroup(child, this.killGraceMs)
      .then((verified) => { this.groupCleanupVerified = verified; })
      .catch(() => { this.groupCleanupVerified = false; })
      .finally(() => { this.stopCompleted = true; });
    this.stopPromise.then(() => {
      if (!this.settled) this.settle(this.pendingSettleCode);
    });
  }

  private settle(errorCode?: string): void {
    if (this.settled) return;
    if (this.stopPromise && !this.stopCompleted) {
      this.pendingSettleCode ||= errorCode;
      return;
    }
    this.settled = true;
    if (this.timeout) clearTimeout(this.timeout);
    this.abortCleanup?.();
    this.abortCleanup = undefined;
    const reason = this.requestedReason || "process_exit";
    this.resolveResult({
      id: this.id,
      reason,
      eventCount: this.eventCount,
      stdoutBytes: this.stdoutBytes,
      stderrBytes: this.stderrBytes,
      exitCode: this.exitCode,
      signal: this.signal,
      groupCleanupVerified: this.groupCleanupVerified || !this.stopPromise,
      ...(errorCode ? { errorCode } : {}),
    });
    this.manager.onFinished(this.id, this.groupCleanupVerified || !this.stopPromise, this.ownedPid);
  }
}

export class AgentProcessManager {
  private readonly jobRoot: string;
  private readonly isolatedHome: string;
  private readonly actualHome: string | undefined;
  private readonly authMode: ProcessAuthMode;
  private readonly nativeIdentity: Readonly<Record<string, string>>;
  private readonly envAllowlist: readonly string[];
  private readonly maxLineBytes: number;
  private readonly maxOutputBytes: number;
  private readonly killGraceMs: number;
  private readonly active = new Map<string, ManagedProcessImpl<unknown>>();
  private readonly failedCleanup = new Map<string, number>();
  private closed = false;
  private shutdownPromise: Promise<void> | undefined;

  constructor(options: Partial<ProcessManagerOptions> = {}) {
    this.jobRoot = canonicalDirectory(options.jobRoot || process.cwd(), "jobRoot");
    if (!options.isolatedHome) {
      throw new ProcessManagerError("invalid_path", "isolatedHome is required");
    }
    this.authMode = assertAuthMode(options.authMode);
    this.actualHome = process.env.HOME;
    this.nativeIdentity = Object.freeze(snapshotNativeIdentity(process.env, this.authMode));
    this.isolatedHome = canonicalDirectory(options.isolatedHome, "isolatedHome");
    if (isWithin(this.isolatedHome, this.jobRoot)) {
      throw new ProcessManagerError("invalid_path", "isolatedHome must be outside jobRoot");
    }
    if (this.actualHome) {
      try {
        if (realpathSync(this.actualHome) === this.isolatedHome) {
          throw new ProcessManagerError("invalid_path", "isolatedHome must differ from host HOME");
        }
      } catch (error) {
        if (error instanceof ProcessManagerError) throw error;
      }
    }
    this.envAllowlist = options.envAllowlist || DEFAULT_ENV_ALLOWLIST;
    this.maxLineBytes = assertFinitePositive(options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES, "maxLineBytes");
    this.maxOutputBytes = assertFinitePositive(options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES, "maxOutputBytes");
    this.killGraceMs = assertFinitePositive(options.killGraceMs ?? DEFAULT_KILL_GRACE_MS, "killGraceMs");
  }

  get isShutdown(): boolean { return this.closed; }

  spawn<T = unknown>(options: ProcessStartOptions<T> & { protocol: "bytes" }): ManagedByteProcess;
  spawn<T = unknown>(options: ProcessStartOptions<T>): ManagedProcess;
  spawn<T = unknown>(options: ProcessStartOptions<T>): ManagedProcess {
    if (this.closed) throw new ProcessManagerError("manager_shutdown", "process manager is shut down");
    try {
      return new ManagedProcessImpl<T>(this, options, {
        jobRoot: this.jobRoot,
        isolatedHome: this.isolatedHome,
        authMode: this.authMode,
        envAllowlist: this.envAllowlist,
        maxLineBytes: this.maxLineBytes,
        maxOutputBytes: this.maxOutputBytes,
        killGraceMs: this.killGraceMs,
        nativeIdentity: this.nativeIdentity,
      }) as ManagedProcess;
    } catch (error) {
      return new FailedManagedProcess(error instanceof ProcessManagerError ? error.code : "spawn_failed");
    }
  }

  async run<T = unknown>(options: ProcessStartOptions<T>): Promise<ProcessResult> {
    return this.spawn(options).result;
  }

  cancel(id: string): Promise<ProcessResult> {
    const active = this.active.get(id);
    if (!active) return Promise.reject(new ProcessManagerError("unknown_process", "process is not active"));
    return active.cancel();
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.closed = true;
    this.shutdownPromise = (async () => {
      await Promise.all([...this.active.values()].map((process): Promise<void> => process.cancel().then((): void => undefined)));
      await this.retryFailedCleanup();
    })();
    this.shutdownPromise.catch(() => {
      // Let the caller observe process_cleanup_failed, then permit a later
      // shutdown call to retry the retained process-group ownership record.
      this.shutdownPromise = undefined;
    });
    return this.shutdownPromise;
  }

  private async retryFailedCleanup(): Promise<void> {
    for (const [id, pid] of this.failedCleanup) {
      if (!groupExists(pid)) {
        this.failedCleanup.delete(id);
      }
    }
    if (this.failedCleanup.size > 0) {
      throw new ProcessManagerError("process_cleanup_failed", "owned process group cleanup is still pending");
    }
  }

  onFinished(id: string, cleanupVerified: boolean, pid: number | undefined): void {
    this.active.delete(id);
    if (cleanupVerified || pid === undefined) this.failedCleanup.delete(id);
    else this.failedCleanup.set(id, pid);
  }

  register(process: ManagedProcessImpl<unknown>): void {
    this.active.set(process.id, process);
  }
}

export { AgentProcessManager as ProcessManager };
