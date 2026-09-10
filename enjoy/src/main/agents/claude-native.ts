import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LEARNING_MCP_TOOL_NAMES } from "../learning/tool-registry";
import {
  NativeAgentError,
  type NativeAgentAdapter,
  type NativeAgentEvent,
  type NativeAgentRequest,
  type NativeAgentResult,
} from "./native-types";
import { configuredNativeProxyEnvironment } from "./proxy-environment";
import {
  ProcessManager,
  type ManagedProcess,
  type ProcessResult,
} from "./process-manager";

type JsonObject = Record<string, unknown>;
type ClaudeStreamEvent = JsonObject;

export const CLAUDE_MCP_SERVER_NAME = "enjoy";

/** Claude prefixes an MCP tool with the configured server name. */
export const LEARNING_CLAUDE_TOOL_NAMES = Object.freeze(
  LEARNING_MCP_TOOL_NAMES.map((name) => {
    // Claude Code normalizes dots in MCP tool names to underscores after it
    // adds the server prefix, for example enjoy.get_job_status becomes
    // mcp__enjoy__enjoy_get_job_status.
    const toolName = name.replace(/\./gu, "_");
    return `mcp__${CLAUDE_MCP_SERVER_NAME}__${toolName}`;
  }),
);

const LEARNING_CLAUDE_TOOL_SET = new Set(LEARNING_CLAUDE_TOOL_NAMES);
const CLAUDE_STRUCTURED_OUTPUT_TOOL = "StructuredOutput";
const CLAUDE_CONTEXT_TOOL = "mcp__enjoy__enjoy_get_job_context";
const CLAUDE_SUBMIT_TOOL_SET = new Set(
  LEARNING_CLAUDE_TOOL_NAMES.filter((name) => name.includes("__enjoy_submit_")),
);
const DEFAULT_TIMEOUT_MS = 600_000;
const MAX_TIMEOUT_MS = 600_000;

const AUTH_FAILURE_PATTERNS = [
  /\bnot authenticated\b/u,
  /\bunauthori[sz]ed\b/u,
  /\bauth(?:entication|orization)?\b/u,
  /\blog(?:in|ged in)\b/u,
  /\bcredential(?:s)?\b/u,
  /\boauth\b/u,
  /\bapi key\b/u,
];

const QUOTA_FAILURE_PATTERNS = [
  /\bquota\b/u,
  /\brate[ -]?limit\b/u,
  /\btoo many requests\b/u,
  /\boverloaded\b/u,
  /\bcapacity\b/u,
  /\bbilling\b/u,
  /\binsufficient (?:credit|fund|balance)/u,
  /\busage limit\b/u,
];

export type ClaudeInvocation = {
  command?: string;
  args: string[];
  allowedTools: readonly string[];
};

/** Build the literal argv used by Claude print mode. */
export function buildClaudeInvocation(options: {
  command?: string;
  mcpConfigPath: string;
  settingsPath: string;
  prompt: string;
  outputSchema?: Record<string, unknown>;
}): ClaudeInvocation {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--input-format",
    "text",
    "--verbose",
    "--restricted",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    options.mcpConfigPath,
    "--settings",
    options.settingsPath,
    "--tools",
    "",
    "--allowed-tools",
    ...LEARNING_CLAUDE_TOOL_NAMES,
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--no-chrome",
  ];

  if (options.outputSchema !== undefined) {
    args.push("--json-schema", JSON.stringify(options.outputSchema));
  }
  args.push(options.prompt);

  return {
    command: options.command,
    args,
    allowedTools: LEARNING_CLAUDE_TOOL_NAMES,
  };
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function hasOwn(value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function contentBlocks(event: ClaudeStreamEvent): JsonObject[] {
  const message = isObject(event.message) ? event.message : undefined;
  const content = Array.isArray(message?.content)
    ? message.content
    : Array.isArray(event.content)
      ? event.content
      : [];
  return content.filter(isObject);
}

function collectToolNames(event: ClaudeStreamEvent): string[] {
  const names: string[] = [];
  for (const block of contentBlocks(event)) {
    if ((block.type === "tool_use" || block.type === "tool_result") && typeof block.name === "string") {
      names.push(block.name);
    }
    if (block.type === "tool_result" && typeof block.tool_name === "string") {
      names.push(block.tool_name);
    }
  }
  for (const key of ["tool_name", "toolName"]) {
    if (typeof event[key] === "string") names.push(event[key] as string);
  }
  return [...new Set(names)];
}

function collectText(event: ClaudeStreamEvent): string[] {
  const values: string[] = [];
  for (const block of contentBlocks(event)) {
    if (block.type === "text" && typeof block.text === "string") values.push(block.text);
  }

  const nested = isObject(event.event) ? event.event : undefined;
  const delta = nested && isObject(nested.delta) ? nested.delta : undefined;
  if (nested?.type === "content_block_delta" && typeof delta?.text === "string") {
    values.push(delta.text);
  }
  return values;
}

function stringifyValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  try {
    const text = JSON.stringify(value);
    return text === undefined ? undefined : text;
  } catch {
    return undefined;
  }
}

function stringifyStructuredValue(value: unknown): string | undefined {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? undefined : text;
  } catch {
    return undefined;
  }
}

function resultText(event: ClaudeStreamEvent): string | undefined {
  for (const key of ["structured_output", "structuredOutput"]) {
    if (hasOwn(event, key)) return stringifyStructuredValue(event[key]);
  }
  for (const key of ["result", "text"]) {
    const text = stringifyValue(event[key]);
    if (text !== undefined) return text;
  }
  const text = collectText(event).join("");
  return text.length > 0 ? text : undefined;
}

function failureHint(event: ClaudeStreamEvent): string {
  const values: string[] = [];
  for (const key of ["subtype", "result", "error", "message", "stop_reason", "stopReason"]) {
    const value = event[key];
    if (typeof value === "string") values.push(value);
    else if (isObject(value)) {
      for (const nestedKey of ["code", "type", "message"]) {
        if (typeof value[nestedKey] === "string") values.push(value[nestedKey] as string);
      }
    }
  }
  return values.join(" ").slice(0, 1_024).toLowerCase();
}

type ResultSummary = {
  seen: boolean;
  isError: boolean;
  text?: string;
  model: string | null;
  failureHint: string;
};

function newResultSummary(): ResultSummary {
  return { seen: false, isError: false, model: null, failureHint: "" };
}

function observeResult(summary: ResultSummary, event: ClaudeStreamEvent): void {
  const subtype = stringValue(event.subtype)?.toLowerCase() || "";
  summary.seen = true;
  summary.isError = event.is_error === true || subtype.includes("error") || subtype.includes("fail");
  summary.text = resultText(event);
  summary.model = stringValue(event.model) || null;
  summary.failureHint = failureHint(event);
}

type CatalogCheck = {
  code?: "native_catalog" | "native_mcp";
};

function inspectCatalog(
  event: ClaudeStreamEvent,
  hasMcp: boolean,
  allowStructuredOutput: boolean,
): CatalogCheck {
  if (event.type !== "system" || event.subtype !== "init") return {};

  if (!Array.isArray(event.tools) || event.tools.some((tool) => typeof tool !== "string")) {
    return { code: "native_catalog" };
  }
  const tools = event.tools as string[];
  if (tools.some((tool) => !LEARNING_CLAUDE_TOOL_SET.has(tool) && !(allowStructuredOutput && tool === CLAUDE_STRUCTURED_OUTPUT_TOOL))) {
    return { code: "native_catalog" };
  }

  if (!Array.isArray(event.plugins) || event.plugins.length > 0) return { code: "native_catalog" };

  if (!Array.isArray(event.mcp_servers)) return { code: "native_catalog" };
  const servers = event.mcp_servers;
  if (servers.some((server) => !isObject(server) || typeof server.name !== "string" || typeof server.status !== "string")) {
    return { code: "native_catalog" };
  }
  const namedServers = servers as JsonObject[];
  if (namedServers.some((server) => server.name !== CLAUDE_MCP_SERVER_NAME)) {
    return { code: "native_catalog" };
  }

  const connected = namedServers.some(
    (server) => server.name === CLAUDE_MCP_SERVER_NAME && server.status === "connected",
  );
  if (hasMcp && !connected) return { code: "native_mcp" };
  const appTools = tools.filter((tool) => LEARNING_CLAUDE_TOOL_SET.has(tool));
  if (hasMcp && (!appTools.includes(CLAUDE_CONTEXT_TOOL) || !appTools.some((tool) => CLAUDE_SUBMIT_TOOL_SET.has(tool)))) {
    return { code: "native_mcp" };
  }
  const hasNonInternalTool = appTools.length > 0;
  if (!hasMcp && (connected || hasNonInternalTool)) return { code: "native_catalog" };
  return {};
}

function callEvent(onEvent: NativeAgentRequest["onEvent"], event: NativeAgentEvent): void {
  try {
    onEvent?.(event);
  } catch {
    // A renderer callback must not change process ownership or protocol handling.
  }
}

function validateRequest(request: NativeAgentRequest): void {
  if (!request || typeof request !== "object") throw new NativeAgentError("native_invalid_request");
  if (typeof request.prompt !== "string") throw new NativeAgentError("native_invalid_request");
  if (!request.executable || typeof request.executable.path !== "string") {
    throw new NativeAgentError("native_invalid_request");
  }
  if (request.mcp) {
    if (typeof request.mcp.url !== "string" || typeof request.mcp.token !== "string" || request.mcp.token.length === 0) {
      throw new NativeAgentError("native_mcp");
    }
    if (/[\0\r\n]/u.test(request.mcp.url) || /[\0\r\n]/u.test(request.mcp.token)) {
      throw new NativeAgentError("native_mcp");
    }
    try {
      const url = new URL(request.mcp.url);
      if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
        throw new Error("unsupported MCP URL");
      }
    } catch {
      throw new NativeAgentError("native_mcp");
    }
  }
}

function timeoutFor(request: NativeAgentRequest): number {
  const requested = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(requested) || requested <= 0) throw new NativeAgentError("native_timeout");
  return Math.min(Math.floor(requested), MAX_TIMEOUT_MS);
}

type AppOwnedRuntime = {
  root: string;
  settingsPath: string;
  mcpConfigPath: string;
};

async function createAppOwnedRuntime(request: NativeAgentRequest): Promise<AppOwnedRuntime> {
  const root = await mkdtemp(join(tmpdir(), "enjoy-claude-native-"));
  try {
    const settingsPath = join(root, "settings.json");
    const mcpConfigPath = join(root, "mcp.json");
    const servers = request.mcp
      ? {
        [CLAUDE_MCP_SERVER_NAME]: {
          type: "http",
          url: request.mcp.url,
          headers: { Authorization: `Bearer ${request.mcp.token}` },
        },
      }
      : {};
    await writeFile(settingsPath, "{}\n", { encoding: "utf8", mode: 0o600 });
    await writeFile(mcpConfigPath, `${JSON.stringify({ mcpServers: servers })}\n`, { encoding: "utf8", mode: 0o600 });
    await Promise.all([
      chmod(settingsPath, 0o600),
      chmod(mcpConfigPath, 0o600),
    ]);
    return { root, settingsPath, mcpConfigPath };
  } catch (error) {
    await rm(root, { recursive: true, force: true }).catch((): undefined => undefined);
    throw error;
  }
}

function classifyFailure(processResult: ProcessResult, result: ResultSummary): string {
  const hint = result.failureHint;
  if (QUOTA_FAILURE_PATTERNS.some((pattern) => pattern.test(hint))) return "native_quota";
  if (AUTH_FAILURE_PATTERNS.some((pattern) => pattern.test(hint))) return "native_auth";
  switch (processResult.reason) {
    case "cancelled": return "native_cancelled";
    case "timeout": return "native_timeout";
    case "output_limit": return "native_output_limit";
    case "protocol_error": return "native_protocol";
    case "spawn_failed": return "native_launch";
    case "process_exit": return "native_error";
    case "completed": return result.isError ? "native_error" : "native_protocol";
    default: return "native_error";
  }
}

function asNativeError(error: unknown, fallback = "native_error"): NativeAgentError {
  if (error instanceof NativeAgentError) return error;
  return new NativeAgentError(fallback);
}

/** Native Claude Code text adapter with explicit, per-job MCP policy. */
export class ClaudeNativeAgent implements NativeAgentAdapter {
  async run(request: NativeAgentRequest): Promise<NativeAgentResult> {
    validateRequest(request);
    const proxyEnvironment = configuredNativeProxyEnvironment();
    const timeoutMs = timeoutFor(request);
    const runtime = await createAppOwnedRuntime(request).catch((error) => {
      throw asNativeError(error, "native_mcp");
    });
    let manager: ProcessManager | undefined;
    let processResult: ProcessResult | undefined;
    let managed: ManagedProcess | undefined;
    let catalogError: NativeAgentError | undefined;
    let cancelRequested = false;
    let catalogSeen = false;
    const assistantText: string[] = [];
    const result = newResultSummary();
    const allowedToolSet = new Set([
      ...LEARNING_CLAUDE_TOOL_NAMES,
      ...(request.outputSchema ? [CLAUDE_STRUCTURED_OUTPUT_TOOL] : []),
    ]);

    const stopWith = (code: "native_catalog" | "native_mcp") => {
      if (!catalogError) catalogError = new NativeAgentError(code);
      cancelRequested = true;
      if (managed) void managed.cancel();
    };

    const onMessage = (message: ClaudeStreamEvent): void => {
      if (!isObject(message)) return;
      if (message.type === "system" && message.subtype === "init") {
        if (catalogSeen) {
          stopWith("native_catalog");
          return;
        }
        catalogSeen = true;
        const catalog = inspectCatalog(message, Boolean(request.mcp), Boolean(request.outputSchema));
        if (catalog.code) {
          stopWith(catalog.code);
          return;
        }
      }

      const toolNames = collectToolNames(message);
      if (toolNames.some((name) => !allowedToolSet.has(name))) {
        stopWith("native_catalog");
        return;
      }
      for (const toolName of toolNames) {
        if (toolName !== CLAUDE_STRUCTURED_OUTPUT_TOOL) callEvent(request.onEvent, { type: "tool", toolName });
      }

      if (message.type === "assistant" || message.type === "stream_event") {
        const chunks = collectText(message);
        if (chunks.length > 0) {
          assistantText.push(...chunks);
          for (const text of chunks) {
            callEvent(request.onEvent, { type: "text", text });
          }
        }
      }
      if (message.type === "result") observeResult(result, message);
    };

    callEvent(request.onEvent, { type: "started" });
    let failure: NativeAgentError | undefined;
    let output: NativeAgentResult | undefined;
    try {
      manager = new ProcessManager({
        jobRoot: request.workspace,
        isolatedHome: request.privateHome,
        authMode: "existing-claude",
      });
      const invocation = buildClaudeInvocation({
        mcpConfigPath: runtime.mcpConfigPath,
        settingsPath: runtime.settingsPath,
        prompt: request.prompt,
        outputSchema: request.outputSchema,
      });
      managed = manager.spawn<ClaudeStreamEvent>({
        executable: request.executable,
        cwd: request.workspace,
        args: invocation.args,
        timeoutMs,
        signal: request.signal,
        env: proxyEnvironment,
        onMessage,
      });
      if (cancelRequested) void managed.cancel();
      processResult = await managed.result;

      if (catalogError) {
        failure = catalogError;
      } else if (request.signal?.aborted || processResult.reason === "cancelled") {
        failure = new NativeAgentError("native_cancelled");
      } else if (result.isError) {
        failure = new NativeAgentError(classifyFailure(processResult, result));
      } else if (!catalogSeen || !result.seen) {
        failure = new NativeAgentError("native_protocol");
      } else if (processResult.reason !== "completed") {
        failure = new NativeAgentError(classifyFailure(processResult, result));
      } else {
        const text = result.text ?? assistantText.join("");
        output = {
          provider: "claude",
          text,
          images: [],
          model: result.model,
        };
      }
    } catch (error) {
      failure = asNativeError(error);
    }

    const cleanup = async (): Promise<void> => {
      // Keep app-owned settings and MCP credentials until the process group is
      // verified as gone. A retryable error retains the files for this cleanup
      // callback instead of deleting them while a child may still read them.
      if (manager) await manager.shutdown();
      await rm(runtime.root, { recursive: true, force: true });
    };
    try {
      await cleanup();
    } catch {
      throw new NativeAgentError("native_cleanup_failed", cleanup);
    }

    if (failure) throw failure;
    if (!output) throw new NativeAgentError("native_error");
    callEvent(request.onEvent, { type: "completed" });
    return output;
  }
}
