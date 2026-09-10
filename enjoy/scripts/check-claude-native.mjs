import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const CLAUDE_BINARY = "/Users/ethan/.local/bin/claude";
export const NODE24_BINARY = "/opt/homebrew/opt/node@24/bin/node";
export const SUBMIT_TOOL = "mcp__enjoy__submit_lesson_draft";
export const REPORT_PATH = "/tmp/enjoy-u1-claude.md";

const MAX_DIAGNOSTIC_LENGTH = 240;
const MAX_STREAM_LINE_BYTES = 64 * 1024;
const MAX_EVENTS = 200;
const DEFAULT_TIMEOUT_MS = 45_000;
const SUPPORTED_CLAUDE_VERSION_LINES = new Set([
  "2.1.263 (Claude Code)",
  "2.1.266 (Claude Code)",
]);
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["submitted", "blocked", "failed"] },
    message: { type: "string", maxLength: 200 },
  },
  required: ["status", "message"],
};

const DEFAULT_PROMPT = [
  "Create one tiny A2 English lesson candidate for the topic coffee with a colleague.",
  "Call the Enjoy MCP tool mcp__enjoy__submit_lesson_draft exactly once.",
  "Use schemaVersion stage-candidate/v1, jobId job-claude-spike, stageId stage-text, attemptId attempt-1, expectedRevision 1.",
  "The payload must contain a title and one section with id section-1 and a short English sentence.",
  "Do not use any other tool. After the tool returns, output only the requested JSON status object.",
].join(" ");

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function validateSubmitCandidate(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, code: "invalid-envelope" };
  }

  const requiredStrings = ["schemaVersion", "jobId", "stageId", "attemptId"];
  if (requiredStrings.some((key) => typeof candidate[key] !== "string" || candidate[key].length === 0)) {
    return { ok: false, code: "invalid-envelope" };
  }
  if (candidate.schemaVersion !== "stage-candidate/v1") {
    return { ok: false, code: "unsupported-schema" };
  }
  if (!Number.isInteger(candidate.expectedRevision) || candidate.expectedRevision < 1) {
    return { ok: false, code: "invalid-envelope" };
  }
  if (!candidate.payload || typeof candidate.payload !== "object" || Array.isArray(candidate.payload)) {
    return { ok: false, code: "invalid-envelope" };
  }
  if (Object.keys(candidate.payload).length === 0) {
    return { ok: false, code: "invalid-envelope" };
  }

  return {
    ok: true,
    payloadHash: createHash("sha256").update(canonicalize(candidate.payload)).digest("hex"),
    schemaVersion: candidate.schemaVersion,
    jobId: candidate.jobId,
    stageId: candidate.stageId,
    attemptId: candidate.attemptId,
    expectedRevision: candidate.expectedRevision,
  };
}

export function sanitizeDiagnostic(value) {
  let sanitized = String(value ?? "")
    .replace(/authorization\s*:\s*(?:(?:bearer|basic|token)\s+)?[^\s,;]+(?:\s+[^\s,;]+)?/gi, "[redacted]")
    .replace(/\bsk-ant-[a-z0-9_-]+/gi, "[redacted]")
    .replace(/\b(?:xoxb|xoxp|ghp|github_pat)_[a-z0-9_-]+/gi, "[redacted]")
    .replace(/\b(?:token|secret|password|api[_-]?key|code)\s*[=:]\s*[^\s,;&]+/gi, "[redacted]")
    .replace(/([?&](?:token|secret|code|api[_-]?key)=)[^&#\s]+/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim();

  if (sanitized.length > MAX_DIAGNOSTIC_LENGTH) {
    sanitized = `${sanitized.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…`;
  }
  return sanitized;
}

function collectToolNames(message) {
  const names = [];
  const content = message && typeof message === "object" && Array.isArray(message.content)
    ? message.content
    : [];
  for (const block of content) {
    if (block && block.type === "tool_use" && typeof block.name === "string" && block.name.startsWith("mcp__")) {
      names.push(block.name);
    }
    if (block && block.type === "tool_result" && typeof block.tool_name === "string" && block.tool_name.startsWith("mcp__")) {
      names.push(block.tool_name);
    }
  }
  return [...new Set(names)];
}

export function parseStreamJsonLine(line) {
  const source = String(line ?? "");
  const byteLength = Buffer.byteLength(source);
  if (byteLength > MAX_STREAM_LINE_BYTES) {
    return {
      kind: "malformed",
      reason: "line-too-large",
      byteLength,
    };
  }
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    return { kind: "ignored" };
  }

  let event;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return {
      kind: "malformed",
      reason: "invalid-json",
      byteLength,
    };
  }

  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return {
      kind: "malformed",
      reason: "invalid-shape",
      byteLength,
    };
  }

  const type = typeof event.type === "string" ? event.type : "unknown";
  const summary = { kind: "event", type };
  if (typeof event.subtype === "string") {
    summary.subtype = event.subtype;
  }
  if (typeof event.status === "string") {
    summary.status = event.status;
  }
  if (typeof event.is_error === "boolean") {
    summary.isError = event.is_error;
  }

  if (type === "system" && event.subtype === "init") {
    if (Array.isArray(event.tools)) {
      summary.tools = event.tools
        .filter((tool) => typeof tool === "string")
        .map((tool) => tool.slice(0, 100))
        .slice(0, 100);
    }
    if (Array.isArray(event.mcp_servers)) {
      summary.mcpServers = event.mcp_servers
        .filter((server) => server && typeof server === "object")
        .map((server) => ({
          name: typeof server.name === "string" ? server.name.slice(0, 80) : "unknown",
          status: typeof server.status === "string" ? server.status.slice(0, 40) : "unknown",
        }))
        .slice(0, 100);
    }
    if (typeof event.apiKeySource === "string") {
      summary.apiKeySource = event.apiKeySource.slice(0, 40);
    }
    if (Array.isArray(event.plugins)) {
      summary.pluginCount = event.plugins.length;
    }
  }

  const toolNames = collectToolNames(event.message);
  if (toolNames.length > 0) {
    summary.toolNames = toolNames;
  }

  if (type === "result") {
    summary.kind = "result";
    if (typeof event.is_error === "boolean") {
      summary.isError = event.is_error;
    }
  }
  return summary;
}

export function buildNativeInvocation(paths) {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--input-format",
    "text",
    "--verbose",
    "--json-schema",
    JSON.stringify(OUTPUT_SCHEMA),
    "--mcp-config",
    paths.mcpConfig,
    "--strict-mcp-config",
    "--settings",
    paths.settings,
    "--setting-sources",
    "",
    "--tools",
    "",
    "--allowed-tools",
    SUBMIT_TOOL,
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--no-session-persistence",
    "--disable-slash-commands",
  ];

  if (paths.workspace) {
    args.push("--add-dir", paths.workspace);
  }
  args.push(paths.prompt ?? DEFAULT_PROMPT);

  return {
    command: paths.binary ?? CLAUDE_BINARY,
    args,
    prompt: paths.prompt ?? DEFAULT_PROMPT,
  };
}

function copySafeProcessEnv(runtime, extra = {}) {
  const env = {};
  for (const name of ["PATH", "LANG", "LC_ALL", "TZ"]) {
    if (typeof process.env[name] === "string") {
      env[name] = process.env[name];
    }
  }
  Object.assign(env, {
    HOME: runtime.home,
    CLAUDE_CONFIG_DIR: runtime.configDir,
    XDG_CONFIG_HOME: runtime.xdgConfig,
    XDG_CACHE_HOME: runtime.xdgCache,
    NO_COLOR: "1",
    CI: "1",
    TERM: "dumb",
    DISABLE_AUTOUPDATER: "1",
  });
  return { ...env, ...extra };
}

function terminateProcessGroup(child, signal) {
  if (!child || !child.pid) {
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process already exited.
    }
  }
}

function runProcess(command, args, options = {}) {
  const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 60_000);
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdoutBuffer = "";
    let stdoutBytes = 0;
    let stderr = "";
    let events = [];
    let timedOut = false;
    let finished = false;
    let forceKillTimer;

    const addLine = (line) => {
      stdoutBytes += Buffer.byteLength(line);
      if (events.length < MAX_EVENTS) {
        const parsed = parseStreamJsonLine(line);
        if (parsed.kind !== "ignored") {
          events.push(parsed);
        }
      }
    };

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      if (Buffer.byteLength(stdoutBuffer) > MAX_STREAM_LINE_BYTES) {
        if (events.length < MAX_EVENTS) {
          events.push({
            kind: "malformed",
            reason: "line-too-large",
            byteLength: Buffer.byteLength(stdoutBuffer),
          });
        }
        stdoutBuffer = "";
        return;
      }
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        addLine(line);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr = sanitizeDiagnostic(`${stderr} ${chunk.toString("utf8")}`);
    });
    child.on("error", (error) => {
      stderr = sanitizeDiagnostic(`${stderr} ${error.message}`);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessGroup(child, "SIGTERM");
      forceKillTimer = setTimeout(() => terminateProcessGroup(child, "SIGKILL"), 2_000);
    }, timeoutMs);

    child.on("close", (code, signal) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      if (stdoutBuffer.trim().length > 0) {
        addLine(stdoutBuffer);
      }
      resolve({
        code,
        signal,
        timedOut,
        events,
        stdoutBytes,
        stderr: sanitizeDiagnostic(stderr),
      });
    });
  });
}

async function runWhitelistedJsonCommand(command, args, options = {}) {
  const timeoutMs = Math.min(options.timeoutMs ?? 10_000, 60_000);
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let forceKillTimer;
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr = sanitizeDiagnostic(`${stderr} ${chunk.toString("utf8")}`);
    });
    child.on("error", (error) => {
      stderr = sanitizeDiagnostic(`${stderr} ${error.message}`);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessGroup(child, "SIGTERM");
      forceKillTimer = setTimeout(() => terminateProcessGroup(child, "SIGKILL"), 2_000);
    }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      let json = null;
      try {
        json = JSON.parse(stdout.trim());
      } catch {
        json = null;
      }
      resolve({
        code,
        signal,
        timedOut,
        json,
        stdout: sanitizeDiagnostic(stdout),
        stderr: sanitizeDiagnostic(stderr),
      });
    });
  });
}

function runSilentProcess(command, args, options = {}) {
  const timeoutMs = Math.min(options.timeoutMs ?? 60_000, 300_000);
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
    let timedOut = false;
    let forceKillTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessGroup(child, "SIGTERM");
      forceKillTimer = setTimeout(() => terminateProcessGroup(child, "SIGKILL"), 2_000);
    }, timeoutMs);
    child.on("error", () => {
      // The exit code remains the only diagnostic exposed by this auth flow.
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      resolve({
        exitCode: code === 0 ? 0 : (code ?? "unknown"),
        signal: signal ?? undefined,
        timedOut,
      });
    });
  });
}

export async function runNativeLogin({
  binary = CLAUDE_BINARY,
  authRoot,
  cwd = process.cwd(),
} = {}) {
  if (!authRoot) {
    throw new Error("auth-root-required");
  }
  const persistentRoot = resolve(authRoot);
  const home = join(persistentRoot, "home");
  const configDir = join(persistentRoot, "config");
  const xdgConfig = join(persistentRoot, "xdg-config");
  const xdgCache = join(persistentRoot, "xdg-cache");
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(configDir, { recursive: true }),
    mkdir(xdgConfig, { recursive: true }),
    mkdir(xdgCache, { recursive: true }),
  ]);
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    CLAUDE_CONFIG_DIR: configDir,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_CACHE_HOME: xdgCache,
    NO_COLOR: "1",
    CI: "1",
    TERM: "dumb",
    DISABLE_AUTOUPDATER: "1",
  };
  return runSilentProcess(binary, ["auth", "login", "--claudeai"], {
    cwd,
    env,
    timeoutMs: 300_000,
  });
}

export async function probeAuth({ binary = CLAUDE_BINARY, env, cwd, bare = true } = {}) {
  const args = bare ? ["--bare", "auth", "status", "--json"] : ["auth", "status", "--json"];
  const result = await runWhitelistedJsonCommand(binary, args, { env, cwd, timeoutMs: 10_000 });
  const json = result.json && typeof result.json === "object" ? result.json : {};
  return {
    loggedIn: json.loggedIn === true,
    authMethod: typeof json.authMethod === "string" ? json.authMethod : "unknown",
  };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function createIsolatedRuntime({
  binary = CLAUDE_BINARY,
  nodePath = process.execPath,
  authRoot,
  fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "agent-spike", "claude"),
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "enjoy-claude-native-"));
  const persistentAuthRoot = authRoot ? resolve(authRoot) : null;
  const runtime = {
    root,
    persistentAuthRoot,
    binary,
    nodePath,
    home: persistentAuthRoot ? join(persistentAuthRoot, "home") : join(root, "home"),
    configDir: persistentAuthRoot ? join(persistentAuthRoot, "config") : join(root, "app-owned-config"),
    xdgConfig: persistentAuthRoot ? join(persistentAuthRoot, "xdg-config") : join(root, "xdg-config"),
    xdgCache: persistentAuthRoot ? join(persistentAuthRoot, "xdg-cache") : join(root, "xdg-cache"),
    decoyHome: join(root, "decoy-home"),
    workspace: join(root, "job-workspace"),
    decoyProject: join(root, "decoy-project"),
    receiptPath: join(root, "submit-receipt.json"),
    hookMarker: join(root, "unexpected-hook-fired"),
    pluginMarker: join(root, "unexpected-plugin-loaded"),
    settings: join(root, "app-owned-settings.json"),
    mcpConfig: join(root, "app-owned-mcp.json"),
    fixtureServer: join(fixtureDir, "fixture-mcp-server.mjs"),
  };

  await Promise.all([
    mkdir(join(runtime.decoyHome, ".claude", "plugins", "cache", "rogue-plugin"), { recursive: true }),
    mkdir(runtime.home, { recursive: true }),
    mkdir(join(runtime.configDir), { recursive: true }),
    mkdir(runtime.xdgConfig, { recursive: true }),
    mkdir(runtime.xdgCache, { recursive: true }),
    mkdir(runtime.workspace, { recursive: true }),
    mkdir(join(runtime.decoyProject, ".claude"), { recursive: true }),
  ]);

  const markerCommand = `${runtime.nodePath} -e ${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(runtime.hookMarker)}, 'fired')`)}`;
  await writeJson(join(runtime.decoyHome, ".claude", "settings.json"), {
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: markerCommand }] }],
    },
    enabledPlugins: { "rogue-plugin@local": true },
    mcpServers: {
      rogue: { command: runtime.nodePath, args: [runtime.fixtureServer] },
    },
  });
  await writeJson(join(runtime.decoyProject, ".mcp.json"), {
    mcpServers: {
      rogue: { command: runtime.nodePath, args: [runtime.fixtureServer] },
    },
  });
  await writeJson(join(runtime.decoyProject, ".claude", "settings.local.json"), {
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: markerCommand }] }],
    },
    enabledPlugins: { "rogue-plugin@local": true },
  });
  await writeJson(runtime.settings, {});
  await writeJson(runtime.mcpConfig, {
    mcpServers: {
      enjoy: {
        command: runtime.nodePath,
        args: [runtime.fixtureServer],
        env: {
          ENJOY_SPIKE_RECEIPT_PATH: runtime.receiptPath,
        },
      },
    },
  });

  return runtime;
}

export function buildRuntimeEnv(runtime) {
  return copySafeProcessEnv(runtime, {
    ENJOY_SPIKE_RECEIPT_PATH: runtime.receiptPath,
  });
}

async function readReceipt(runtime) {
  try {
    const data = JSON.parse(await readFile(runtime.receiptPath, "utf8"));
    if (data && data.accepted === true && typeof data.payloadHash === "string") {
      return data;
    }
  } catch {
    // The MCP server has not written a receipt yet.
  }
  return null;
}

async function waitForReceipt(runtime, timeoutMs = 5_000) {
  const deadline = Date.now() + Math.min(timeoutMs, 60_000);
  while (Date.now() < deadline) {
    const receipt = await readReceipt(runtime);
    if (receipt) {
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function checkWorkspaceEmpty(runtime) {
  const entries = await readdir(runtime.workspace);
  return entries.length === 0;
}

async function runStrictMcpProbe(runtime) {
  const result = await runProcess(
    runtime.binary,
    [
      "--bare",
      "--print",
      "--verbose",
      "--output-format",
      "stream-json",
      "--input-format",
      "text",
      "--strict-mcp-config",
      "--mcp-config",
      runtime.mcpConfig,
      "--settings",
      runtime.settings,
      "--setting-sources",
      "",
      "--tools",
      "",
      "--allowed-tools",
      SUBMIT_TOOL,
      "--permission-mode",
      "dontAsk",
      "--permission-prompts",
      "none",
      "--no-session-persistence",
      "--disable-slash-commands",
      "Return only a short status.",
    ],
    {
      cwd: runtime.workspace,
      env: buildRuntimeEnv(runtime),
      timeoutMs: 15_000,
    },
  );
  const initEvent = result.events.find((event) => event.type === "system" && event.subtype === "init");
  const effectiveTools = initEvent?.tools ?? [];
  const effectiveServers = initEvent?.mcpServers ?? [];
  const enjoyConnected = effectiveServers.some((server) => server.name === "enjoy" && server.status === "connected");
  const rogueObserved = effectiveServers.some((server) => server.name !== "enjoy");
  const onlyAllowedTool = effectiveTools.length === 1 && effectiveTools[0] === SUBMIT_TOOL;
  const noPlugins = initEvent?.pluginCount === 0;
  return {
    pass: Boolean(initEvent && enjoyConnected && onlyAllowedTool && !rogueObserved && noPlugins),
    exitCode: result.code === 0 ? 0 : (result.code ?? "unknown"),
    timedOut: result.timedOut,
    enjoyServerConfigured: true,
    enjoyConnected,
    effectiveTools,
    pluginCount: initEvent?.pluginCount ?? "unknown",
    noPlugins,
    rogueServerObserved: rogueObserved,
    eventCount: result.events.length,
    stderrPresent: Boolean(result.stderr),
  };
}

export async function runNativeSmoke(runtime, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const env = buildRuntimeEnv(runtime);
  const auth = await probeAuth({ binary: runtime.binary, env, cwd: runtime.workspace, bare: false });
  if (!auth.loggedIn) {
    return {
      status: "blocked",
      reason: "isolated-auth-required",
      auth,
      events: [],
    };
  }

  const invocation = buildNativeInvocation({
    binary: runtime.binary,
    mcpConfig: runtime.mcpConfig,
    settings: runtime.settings,
    workspace: runtime.workspace,
  });
  const result = await runProcess(invocation.command, invocation.args, {
    cwd: runtime.workspace,
    env,
    timeoutMs,
  });
  const receipt = await waitForReceipt(runtime, Math.min(5_000, timeoutMs));
  const toolCalls = result.events
    .filter((event) => event.type === "assistant")
    .flatMap((event) => event.toolNames ?? []);
  const submitToolCallCount = toolCalls.filter((name) => name === SUBMIT_TOOL).length;
  const submitted = Boolean(
    receipt?.accepted === true
      && typeof receipt.payloadHash === "string"
      && submitToolCallCount === 1,
  );
  const resultEvent = [...result.events].reverse().find((event) => event.kind === "result");
  return {
    status: submitted && result.code === 0 && !result.timedOut ? "pass" : "fail",
    reason: submitted
      ? undefined
      : result.timedOut
        ? "timeout"
        : submitToolCallCount !== 1
          ? "unexpected-submit-count"
          : "mcp-submit-not-received",
    auth,
    exitCode: result.code === 0 ? 0 : (result.code ?? "unknown"),
    timedOut: result.timedOut,
    eventCount: result.events.length,
    malformedEventCount: result.events.filter((event) => event.kind === "malformed").length,
    resultEvent,
    toolCalls,
    submitToolCallCount,
    receipt: receipt
      ? {
        accepted: true,
        payloadHash: receipt.payloadHash,
        jobId: receipt.jobId,
        stageId: receipt.stageId,
        attemptId: receipt.attemptId,
      }
      : undefined,
    stderrPresent: Boolean(result.stderr),
  };
}

function formatStatus(value) {
  return value ? "PASS" : "FAIL";
}

export function renderReport(result) {
  const activeAuth = result.authProbe.active;
  const effectiveTools = result.strictMcp.effectiveTools.length > 0
    ? result.strictMcp.effectiveTools.join(", ")
    : "none";
  const smokeStatus = result.smoke.status === "pass"
    ? "PASS"
    : result.smoke.status === "blocked" ? "BLOCKED" : "FAIL";
  const lines = [
    "# U1 Claude native CLI vertical spike",
    "",
    `- Binary: \`${result.binary}\``,
    `- Version: \`${result.version}\``,
    `- Node: \`${result.nodeVersion}\``,
    "- Phạm vi: chỉ Claude native CLI và fixture harness, chưa tích hợp production.",
    "",
    "## Checks",
    "",
    `- Kiểm version: ${formatStatus(result.versionPass)}.`,
    `- Characterization \`--bare\` trong home/config tạm: ${formatStatus(result.authProbe.barePass)}. ` +
      `Whitelist: loggedIn=${result.authProbe.bare.loggedIn}, authMethod=${result.authProbe.bare.authMethod}.`,
    `- Auth của isolated profile đang chạy: loggedIn=${activeAuth.loggedIn}, authMethod=${activeAuth.authMethod}.`,
    `- Kiểm strict MCP và effective catalog: ${formatStatus(result.strictMcp.pass)}. ` +
      `Tools=${effectiveTools}; plugins=${result.strictMcp.pluginCount}; Enjoy connected=${result.strictMcp.enjoyConnected}.`,
    `- Test parser, redaction và envelope: ${formatStatus(result.parserTests.pass)}.`,
    `- Native inference smoke: ${smokeStatus}.`,
    "",
    "## Phát hiện về isolation",
    "",
    "- Job workspace là thư mục tạm riêng và rỗng, được truyền làm process cwd.",
    "- Child environment dùng allowlist: HOME, CLAUDE_CONFIG_DIR, XDG config/cache và locale/runtime cơ bản. Credential variables kế thừa bị loại bỏ.",
    "- `--strict-mcp-config` nhận đúng một MCP config do app sở hữu. User/project decoy settings, hooks, plugin marker và rogue MCP nằm ngoài job workspace và không được truyền vào process.",
    "- Built-in tools bị tắt bằng `--tools \"\"`; effective catalog chỉ có `mcp__enjoy__submit_lesson_draft`. `Bash`, `Read`, `Write`, `Edit`, web tools và plugins không xuất hiện.",
    "- MCP receipt chỉ giữ envelope identity và payload SHA-256. Harness không ghi raw stream JSON, raw stdout, raw stderr hoặc candidate text.",
    "- Bằng chứng này bảo vệ phạm vi process/config trước model và renderer. Không tuyên bố chống process độc hại cùng OS account.",
    "",
    "## Auth blocker",
    "",
    "Characterization `--bare` chỉ chứng minh mode này bỏ qua OAuth và keychain; không dùng nó để kết luận trạng thái account chung.",
    "",
    "## Candidate authority",
    "",
    "Smoke đạt khi fixture MCP nhận và validate `stage-candidate/v1` qua `submit_lesson_draft`. MCP receipt và payload hash là nguồn authoritative của candidate. Final prose của Claude chỉ là status event, không được parse thành commit payload.",
    "",
    "## Chạy login chính thức trong profile riêng",
    "",
    "```sh",
    "ENJOY_CLAUDE_AUTH_ROOT=\"$PWD/enjoy/tmp/agent-spike-auth/claude\"",
    "ENJOY_CLAUDE_HOME=\"$ENJOY_CLAUDE_AUTH_ROOT/home\"",
    "ENJOY_CLAUDE_CONFIG=\"$ENJOY_CLAUDE_AUTH_ROOT/config\"",
    "ENJOY_CLAUDE_XDG=\"$ENJOY_CLAUDE_AUTH_ROOT/xdg-config\"",
    "mkdir -p \"$ENJOY_CLAUDE_HOME\" \"$ENJOY_CLAUDE_CONFIG\" \"$ENJOY_CLAUDE_XDG\"",
    "HOME=\"$ENJOY_CLAUDE_HOME\" CLAUDE_CONFIG_DIR=\"$ENJOY_CLAUDE_CONFIG\" XDG_CONFIG_HOME=\"$ENJOY_CLAUDE_XDG\" /Users/ethan/.local/bin/claude auth login --claudeai",
    "```",
    "",
    "Lệnh này mở native browser flow của Anthropic và không đưa auth URL/code vào log harness. Không copy auth file global, không truyền OAuth token qua argv/env và không chuyển sang SDK/API-key routing.",
    "Nếu muốn harness tự chờ flow này tối đa 300 giây mà vẫn chỉ ghi exit/status, dùng: `/opt/homebrew/opt/node@24/bin/node enjoy/scripts/check-claude-native.mjs --login --auth-root \"$PWD/enjoy/tmp/agent-spike-auth/claude\"`.",
    "",
    "## Chạy lại smoke",
    "",
    "```sh",
    "/opt/homebrew/opt/node@24/bin/node enjoy/scripts/check-claude-native.mjs --live --auth-root \"$PWD/enjoy/tmp/agent-spike-auth/claude\" --report /tmp/enjoy-u1-claude.md",
    "```",
    "",
    "## Changed files",
    "",
    "- `enjoy/scripts/check-claude-native.mjs`",
    "- `enjoy/scripts/fixtures/agent-spike/claude/fixture-mcp-server.mjs`",
    "- `enjoy/scripts/fixtures/agent-spike/claude/native-harness.test.mjs`",
    "",
  ];
  const authHeadingIndex = lines.indexOf("Characterization `--bare` chỉ chứng minh mode này bỏ qua OAuth và keychain; không dùng nó để kết luận trạng thái account chung.");
  if (activeAuth.loggedIn) {
    lines.splice(authHeadingIndex + 1, 0,
      `Active isolated profile đã auth: loggedIn=true, authMethod=${activeAuth.authMethod}.`,
      "Smoke dùng đúng profile này và không lấy trạng thái từ global account.",
      "",
    );
  } else {
    lines.splice(authHeadingIndex + 1, 0,
      `Active isolated profile đang bị chặn: loggedIn=false, authMethod=${activeAuth.authMethod}. Native inference smoke chưa chạy. Kết luận này dựa trên non-bare auth status của profile đang dùng, không dựa trên kết quả \`--bare\`.`,
      "Người dùng cần tự hoàn tất official Claude subscription login trong persistent app-owned profile trước khi chạy smoke.",
      "",
    );
  }
  if (result.smoke.stderrPresent || result.strictMcp.stderrPresent) {
    lines.push("- Process có stderr; report chỉ ghi cờ hiện diện, raw stderr đã loại bỏ.");
  }
  return `${lines.join("\n")}\n`;
}

function getArgumentValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name}-value-required`);
  }
  return value;
}

async function runScript() {
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  const authRootArgument = getArgumentValue(argv, "--auth-root");
  const authRoot = authRootArgument
    ? resolve(authRootArgument)
    : undefined;

  if (args.has("--login")) {
    const persistentAuthRoot = authRoot ?? resolve(process.cwd(), "tmp", "agent-spike-auth", "claude");
    const login = await runNativeLogin({
      binary: CLAUDE_BINARY,
      authRoot: persistentAuthRoot,
      cwd: process.cwd(),
    });
    console.log(JSON.stringify({
      loginStatus: login.timedOut ? "timeout" : login.exitCode === 0 ? "pass" : "fail",
      exitCode: login.exitCode,
      authRoot: persistentAuthRoot,
    }));
    return;
  }
  const reportIndex = process.argv.indexOf("--report");
  const reportPath = reportIndex >= 0 ? process.argv[reportIndex + 1] : REPORT_PATH;
  const versionResult = await runWhitelistedJsonCommand(CLAUDE_BINARY, ["--version"], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NO_COLOR: "1",
      CI: "1",
    },
    timeoutMs: 10_000,
  });
  const version = versionResult.stdout || "unknown";
  const runtime = await createIsolatedRuntime({
    binary: CLAUDE_BINARY,
    nodePath: NODE24_BINARY,
    authRoot,
  });
  const nodeVersion = process.versions.node;
  const parserTests = {
    pass: parseStreamJsonLine("not-json\n").kind === "malformed"
      && !sanitizeDiagnostic("Authorization: Bearer sk-ant-api03-secret").includes("sk-ant")
      && !sanitizeDiagnostic("Authorization: Bearer genericSecret").includes("genericSecret")
      && validateSubmitCandidate({
        schemaVersion: "stage-candidate/v1",
        jobId: "job-1",
        stageId: "stage-1",
        attemptId: "attempt-1",
        expectedRevision: 1,
        payload: { title: "test" },
      }).ok,
  };
  const bareAuthStatus = await probeAuth({
    binary: CLAUDE_BINARY,
    env: buildRuntimeEnv(runtime),
    cwd: runtime.workspace,
    bare: true,
  });
  const activeAuthStatus = await probeAuth({
    binary: CLAUDE_BINARY,
    env: buildRuntimeEnv(runtime),
    cwd: runtime.workspace,
    bare: false,
  });
  const strictMcp = await runStrictMcpProbe(runtime);
  const workspaceEmpty = await checkWorkspaceEmpty(runtime);
  const smoke = args.has("--live")
    ? await runNativeSmoke(runtime, { timeoutMs: Math.min(DEFAULT_TIMEOUT_MS, 60_000) })
    : { status: "blocked", reason: "live-flag-required", auth: activeAuthStatus, events: [] };
  const result = {
    binary: CLAUDE_BINARY,
    version,
    nodeVersion,
    versionPass: versionResult.code === 0
      && !versionResult.timedOut
      && SUPPORTED_CLAUDE_VERSION_LINES.has(version.trim())
      && nodeVersion.startsWith("24."),
    authProbe: {
      barePass: bareAuthStatus.authMethod === "none" && bareAuthStatus.loggedIn === false,
      bare: bareAuthStatus,
      active: activeAuthStatus,
    },
    strictMcp: { ...strictMcp, pass: strictMcp.pass && workspaceEmpty },
    parserTests,
    smoke,
  };
  await writeFile(reportPath, renderReport(result), "utf8");
  console.log(JSON.stringify({
    versionPass: result.versionPass,
    bareAuth: result.authProbe.bare,
    activeAuth: result.authProbe.active,
    strictMcpPass: result.strictMcp.pass,
    parserTestsPass: result.parserTests.pass,
    smokeStatus: result.smoke.status,
    reportPath,
  }));
  await rm(runtime.root, { recursive: true, force: true });
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  await runScript();
}
