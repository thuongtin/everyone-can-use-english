import {
  PROTOCOL_VERSION,
  client,
  methods,
  ndJsonStream,
  type ClientConnection,
  type NewSessionRequest,
  type NewSessionResponse,
  type RequestPermissionRequest,
  type SessionConfigOption,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, realpath, stat } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { LEARNING_MCP_TOOL_NAMES } from "../learning/tool-registry";
import {
  AgentProcessManager,
  pinExecutable,
  type ExecutablePin,
  type ManagedByteProcess,
  type ManagedProcess,
} from "./process-manager";
import {
  NativeAgentError,
  type NativeAgentEvent,
  type NativeAgentProvider,
  type NativeAgentRequest,
} from "./native-types";
import { configuredNativeProxyEnvironment } from "./proxy-environment";

const require = createRequire(import.meta.url);
const DEFAULT_TIMEOUT_MS = 600_000;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const CANCEL_GRACE_MS = 1_000;
const CLOSE_TIMEOUT_MS = 2_000;
const ACP_PACKAGES: Readonly<Record<NativeAgentProvider, Readonly<{
  name: string;
  entry: string;
  version: string;
}>>> = Object.freeze({
  codex: { name: "@agentclientprotocol/codex-acp", entry: "@agentclientprotocol/codex-acp", version: "1.10.0" },
  claude: { name: "@agentclientprotocol/claude-agent-acp", entry: "@agentclientprotocol/claude-agent-acp/dist/index.js", version: "0.75.1" },
});
const LEARNING_TOOL_SET = new Set<string>(LEARNING_MCP_TOOL_NAMES);

export type AcpModelOption = Readonly<{ id: string; name: string }>;

export type AcpSessionResult = Readonly<{
  text: string;
  model: string | null;
  models: readonly AcpModelOption[];
  sessionId: string;
}>;

type AcpSessionInput = Pick<
  NativeAgentRequest,
  "executable" | "workspace" | "privateHome" | "mcp" | "model" | "systemPrompt" | "signal" | "timeoutMs" | "onEvent"
> & Readonly<{
  provider: NativeAgentProvider;
  prompt?: string;
}>;

type ToolIdentity = Readonly<{
  server: string | null;
  tool: string | null;
  display: string | null;
}>;

type AdapterPin = Readonly<{
  path: string;
  sha256: string;
  size: number;
  mtimeMs: number;
}>;

const SAFETY_SYSTEM_PROMPT = "Answer only the supplied request. Do not access files, terminals, browsers, accounts, or services. Use only the Enjoy MCP tools supplied for this session when present.";

function systemPromptFor(input: AcpSessionInput): string {
  const supplied = input.systemPrompt?.trim();
  return supplied ? `${SAFETY_SYSTEM_PROMPT}\n\n${supplied}` : SAFETY_SYSTEM_PROMPT;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function callEvent(callback: NativeAgentRequest["onEvent"], event: NativeAgentEvent): void {
  try {
    callback?.(event);
  } catch {
    // UI callbacks do not participate in protocol or process ownership.
  }
}

export function buildAcpAdapterEnvironment(
  provider: NativeAgentProvider,
  executable: ExecutablePin,
  disabledCodexMcpServers: readonly string[],
  serverName: string,
  input: AcpSessionInput,
  proxyEnvironment: Readonly<Record<string, string>> = {},
): Record<string, string> {
  if (provider === "claude") {
    return {
      ...proxyEnvironment,
      CLAUDE_CODE_EXECUTABLE: executable.path,
      NO_BROWSER: "1",
    };
  }
  const configuredServers: Record<string, unknown> = Object.fromEntries(
    disabledCodexMcpServers.map((name) => [name, { enabled: false }]),
  );
  if (input.mcp) {
    configuredServers[serverName] = {
      enabled: true,
      required: true,
      url: input.mcp.url,
      bearer_token_env_var: "ENJOY_MCP_TOKEN",
      enabled_tools: [...LEARNING_MCP_TOOL_NAMES],
      default_tools_approval_mode: "approve",
    };
  }
  return {
    ...proxyEnvironment,
    CODEX_PATH: executable.path,
    ...(input.mcp ? { ENJOY_MCP_TOKEN: input.mcp.token } : {}),
    CODEX_CONFIG: JSON.stringify({
      approval_policy: "on-request",
      allow_login_shell: false,
      developer_instructions: systemPromptFor(input),
      mcp_servers: configuredServers,
      web_search: "disabled",
      project_doc_max_bytes: 0,
      features: {
        plugins: false,
        hooks: false,
        apps: false,
        remote_plugin: false,
        shell_tool: false,
        search_tool: false,
        multi_agent: false,
        multi_agent_v2: false,
        js_repl: false,
        web_search_request: false,
        standalone_web_search: false,
        external_agent_memory_import: false,
        skip_host_skill_discovery: true,
      },
      skills: { include_instructions: false, bundled: { enabled: false } },
      memories: { use_memories: false, generate_memories: false },
    }),
    INITIAL_AGENT_MODE: "read-only",
    NO_BROWSER: "1",
  };
}

function nodeCandidates(): string[] {
  const candidates: string[] = [];
  const add = (candidate: string | undefined) => {
    if (!candidate || !isAbsolute(candidate) || candidate.includes("\0") || candidates.includes(candidate)) return;
    candidates.push(candidate);
  };
  add(process.env.ENJOY_ACP_NODE_PATH);
  if (/node(?:\.exe)?$/iu.test(process.execPath)) add(process.execPath);
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    if (isAbsolute(entry)) add(join(entry, process.platform === "win32" ? "node.exe" : "node"));
  }
  add("/opt/homebrew/opt/node@24/bin/node");
  add("/opt/homebrew/bin/node");
  add("/usr/local/bin/node");
  add("/usr/bin/node");
  return candidates;
}

export async function resolveAcpNode(jobRoot: string): Promise<ExecutablePin> {
  for (const candidate of nodeCandidates()) {
    try {
      return await pinExecutable(candidate, { jobRoot });
    } catch {
      // Continue through deterministic absolute candidates.
    }
  }
  throw new NativeAgentError("acp_node_unavailable");
}

function unpackedExternalPath(filePath: string): string {
  return filePath.replace(/\.asar(?=[\\/])/u, ".asar.unpacked");
}

async function pinAdapterFile(filePath: string): Promise<AdapterPin> {
  const path = await realpath(filePath);
  const details = await stat(path);
  if (!details.isFile()) throw new Error("adapter entry is not a file");
  const sha256 = createHash("sha256").update(await readFile(path)).digest("hex");
  return Object.freeze({ path, sha256, size: details.size, mtimeMs: details.mtimeMs });
}

async function verifyAdapterPin(pin: AdapterPin): Promise<void> {
  const path = await realpath(pin.path);
  const details = await stat(path);
  if (path !== pin.path || !details.isFile() || details.size !== pin.size || details.mtimeMs !== pin.mtimeMs) {
    throw new NativeAgentError("acp_adapter_changed");
  }
  const sha256 = createHash("sha256").update(await readFile(path)).digest("hex");
  if (sha256 !== pin.sha256) throw new NativeAgentError("acp_adapter_changed");
}

function isWithinPath(candidate: string, parent: string): boolean {
  const difference = relative(resolve(parent), resolve(candidate));
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference));
}

async function resolveAcpAdapter(provider: NativeAgentProvider): Promise<AdapterPin> {
  try {
    const override = process.env[provider === "codex" ? "ENJOY_CODEX_ACP_ENTRY" : "ENJOY_CLAUDE_ACP_ENTRY"];
    const descriptor = ACP_PACKAGES[provider];
    const moduleEntry = override && isAbsolute(override) && !override.includes("\0")
      ? override
      : require.resolve(descriptor.entry);
    const resolved = unpackedExternalPath(moduleEntry);
    if (!override) {
      const packageJson = unpackedExternalPath(require.resolve(`${descriptor.name}/package.json`));
      const metadata = JSON.parse(await readFile(packageJson, "utf8")) as { name?: unknown; version?: unknown };
      if (metadata.name !== descriptor.name || metadata.version !== descriptor.version) {
        throw new Error("adapter package version is not pinned");
      }
      if (!isWithinPath(resolved, dirname(packageJson))) throw new Error("adapter entry escaped its package");
    }
    return await pinAdapterFile(resolved);
  } catch {
    throw new NativeAgentError("acp_adapter_unavailable");
  }
}

export async function resolveAcpAdapterEntry(provider: NativeAgentProvider): Promise<string> {
  return (await resolveAcpAdapter(provider)).path;
}

function flattenModelOptions(options: SessionConfigOption[] | null | undefined): {
  models: AcpModelOption[];
  currentModel: string | null;
} {
  const model = options?.find((option) => option.id === "model" && option.type === "select");
  if (!model || model.type !== "select") return { models: [], currentModel: null };
  const values: AcpModelOption[] = [];
  for (const candidate of model.options) {
    if ("value" in candidate) {
      values.push({ id: candidate.value, name: candidate.name });
      continue;
    }
    for (const nested of candidate.options) values.push({ id: nested.value, name: nested.name });
  }
  return {
    models: [...new Map(values.map((value) => [value.id, value])).values()],
    currentModel: model.currentValue,
  };
}

function toolIdentity(
  provider: NativeAgentProvider,
  serverName: string,
  request: RequestPermissionRequest | SessionNotification["update"],
): ToolIdentity {
  const toolCall = "toolCall" in request ? request.toolCall : request;
  if (!("toolCallId" in toolCall)) return { server: null, tool: null, display: null };
  const rawInput = isRecord(toolCall.rawInput) ? toolCall.rawInput : undefined;
  if (provider === "codex") {
    return {
      server: typeof rawInput?.server === "string" ? rawInput.server : null,
      tool: typeof rawInput?.tool === "string" ? rawInput.tool : null,
      display: null,
    };
  }
  const metadata = isRecord(toolCall._meta) && isRecord(toolCall._meta.claudeCode)
    ? toolCall._meta.claudeCode
    : undefined;
  const nativeName = typeof metadata?.toolName === "string" ? metadata.toolName : null;
  const prefix = `mcp__${serverName}__`;
  const encodedTool = nativeName?.startsWith(prefix) ? nativeName.slice(prefix.length) : null;
  const tool = encodedTool ? encodedTool.replace(/^enjoy_/u, "enjoy.") : null;
  const display = typeof toolCall.name === "string"
    ? toolCall.name
    : typeof toolCall.title === "string"
      ? toolCall.title
      : null;
  return { server: encodedTool ? serverName : null, tool, display };
}

function isAllowedLearningTool(identity: ToolIdentity, serverName: string): boolean {
  return identity.server === serverName
    && Boolean(identity.tool)
    && LEARNING_TOOL_SET.has(identity.tool as string);
}

function permissionResponse(
  request: RequestPermissionRequest,
  provider: NativeAgentProvider,
  serverName: string,
  hasMcp: boolean,
  allowedToolCallIds: ReadonlySet<string>,
) {
  const allowed = hasMcp
    && allowedToolCallIds.has(request.toolCall.toolCallId)
    && isAllowedLearningTool(toolIdentity(provider, serverName, request), serverName);
  const option = allowed ? request.options.find((candidate) => candidate.kind === "allow_once") : undefined;
  return option
    ? { outcome: { outcome: "selected" as const, optionId: option.optionId } }
    : { outcome: { outcome: "cancelled" as const } };
}

function claudeSessionMeta(input: AcpSessionInput): NonNullable<NewSessionRequest["_meta"]> {
  return {
    disableBuiltInTools: true,
    systemPrompt: systemPromptFor(input),
    claudeCode: {
      options: {
        settingSources: [],
        tools: [],
        hooks: {},
        mcpServers: {},
      },
    },
  };
}

function mcpServers(input: AcpSessionInput, serverName: string): NewSessionRequest["mcpServers"] {
  if (!input.mcp || input.provider === "codex") return [];
  return [{
    name: serverName,
    type: "http",
    url: input.mcp.url,
    headers: [{ name: "Authorization", value: `Bearer ${input.mcp.token}` }],
  }];
}

async function requestOrProcess<T>(
  operation: Promise<T>,
  process: ManagedByteProcess,
  signal: AbortSignal,
): Promise<T> {
  return Promise.race([
    operation,
    process.result.then((result) => {
      if (signal.aborted || result.reason === "cancelled") throw new NativeAgentError("native_cancelled");
      if (result.reason === "timeout") throw new NativeAgentError("native_timeout");
      throw new NativeAgentError(result.reason === "output_limit" ? "native_output_limit" : "native_process_failed");
    }),
  ]);
}

async function verifyNodeVersion(
  manager: AgentProcessManager,
  node: ExecutablePin,
  workspace: string,
  signal: AbortSignal,
): Promise<void> {
  let major: number | undefined;
  const process = manager.spawn<{ major?: unknown }>({
    executable: node,
    args: ["-p", "JSON.stringify({major:Number(process.versions.node.split('.')[0])})"],
    cwd: workspace,
    timeoutMs: 5_000,
    signal,
    onMessage: (message) => {
      if (typeof message.major === "number") major = message.major;
    },
  });
  const result = await process.result;
  if (result.reason !== "completed" || major === undefined || major < 22) {
    throw new NativeAgentError("acp_node_unsupported");
  }
}

async function readCodexMcpServerNames(
  manager: AgentProcessManager,
  executable: ExecutablePin,
  workspace: string,
  signal: AbortSignal,
): Promise<string[]> {
  type Rpc = { id?: number; method?: string; result?: unknown; error?: unknown };
  let sequence = 0;
  const pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  let process: ManagedProcess | undefined;
  const failPending = () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new NativeAgentError("native_process_failed"));
    }
    pending.clear();
  };
  const request = (method: string, params: unknown): Promise<unknown> => new Promise((resolveRequest, rejectRequest) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectRequest(new NativeAgentError("native_protocol_timeout"));
    }, 5_000);
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
    void process?.write({ id, method, params }).catch(() => {
      clearTimeout(timer);
      pending.delete(id);
      rejectRequest(new NativeAgentError("native_process_failed"));
    });
  });
  try {
    process = manager.spawn<Rpc>({
      executable,
      args: [
        "app-server", "--stdio",
        "-c", "features.hooks=false",
        "-c", "features.plugins=false",
        "-c", "features.apps=false",
        "-c", "features.skip_host_skill_discovery=true",
        "-c", "skills.include_instructions=false",
        "-c", "project_doc_max_bytes=0",
      ],
      cwd: workspace,
      timeoutMs: 15_000,
      signal,
      onMessage: (message) => {
        if (typeof message.id !== "number" || message.method || !pending.has(message.id)) return;
        const waiting = pending.get(message.id) as NonNullable<ReturnType<typeof pending.get>>;
        pending.delete(message.id);
        clearTimeout(waiting.timer);
        if (message.error) waiting.reject(new NativeAgentError("native_protocol_error"));
        else waiting.resolve(message.result);
      },
    });
    void process.result.then(failPending);
    await request("initialize", { clientInfo: { name: "enjoy-acp-preflight", version: "1" }, capabilities: {} });
    await process.write({ method: "initialized" });
    const result = await request("config/read", { cwd: workspace, includeLayers: true });
    if (!isRecord(result) || !isRecord(result.config)) throw new NativeAgentError("native_policy_unverified");
    const servers = isRecord(result.config.mcp_servers) ? Object.keys(result.config.mcp_servers) : [];
    return servers;
  } finally {
    failPending();
    if (process) await process.cancel();
  }
}

async function closeSessionBounded(
  connection: ClientConnection,
  process: ManagedByteProcess,
  sessionId: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    connection.agent.request(methods.agent.session.close, { sessionId }).then((): void => undefined),
    process.result.then((): void => undefined),
    new Promise<void>((resolveTimeout) => {
      timer = setTimeout(resolveTimeout, CLOSE_TIMEOUT_MS);
    }),
  ]).catch((): undefined => undefined);
  if (timer) clearTimeout(timer);
}

/** Runs one isolated ACP session over the official SDK transport. */
export async function runAcpSession(input: AcpSessionInput): Promise<AcpSessionResult> {
  if (input.signal.aborted) throw new NativeAgentError("native_cancelled");
  const proxyEnvironment = configuredNativeProxyEnvironment();
  const workspace = await realpath(input.workspace);
  const [node, adapter] = await Promise.all([
    resolveAcpNode(workspace),
    resolveAcpAdapter(input.provider),
  ]);
  const manager = new AgentProcessManager({
    jobRoot: workspace,
    isolatedHome: input.privateHome,
    authMode: input.provider === "codex" ? "existing-codex" : "existing-claude",
    maxLineBytes: 32 * 1024 * 1024,
    maxOutputBytes: 64 * 1024 * 1024,
  });
  let disabledCodexMcpServers: string[];
  try {
    await verifyNodeVersion(manager, node, workspace, input.signal);
    disabledCodexMcpServers = input.provider === "codex" && !process.env.ENJOY_CODEX_ACP_ENTRY
      ? await readCodexMcpServerNames(manager, input.executable, workspace, input.signal)
      : [];
    await verifyAdapterPin(adapter);
    if (input.signal.aborted) throw new NativeAgentError("native_cancelled");
  } catch (error) {
    try {
      await manager.shutdown();
    } catch {
      throw new NativeAgentError("native_cleanup_failed", () => manager.shutdown());
    }
    if (input.signal.aborted) throw new NativeAgentError("native_cancelled");
    throw error instanceof NativeAgentError ? error : new NativeAgentError("native_process_failed");
  }
  const serverName = `enjoy_learning_${randomUUID().replaceAll("-", "")}`;
  const childProcess = manager.spawn({
    executable: node,
    args: [adapter.path],
    cwd: workspace,
    env: buildAcpAdapterEnvironment(input.provider, input.executable, disabledCodexMcpServers, serverName, input, proxyEnvironment),
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    protocol: "bytes",
  });
  let connection: ClientConnection | undefined;
  let sessionId: string | undefined;
  let cancelled = false;
  let cancelTimer: ReturnType<typeof setTimeout> | undefined;
  let violationTimer: ReturnType<typeof setTimeout> | undefined;
  let text = "";
  let textBytes = 0;
  let currentModel: string | null = null;
  let models: readonly AcpModelOption[] = [];
  let scopeViolation: NativeAgentError | undefined;
  const allowedToolCallIds = new Set<string>();
  const stopForViolation = (error: NativeAgentError) => {
    if (scopeViolation) return;
    scopeViolation = error;
    if (sessionId && connection) {
      void connection.agent.notify(methods.agent.session.cancel, { sessionId })
        .catch((): undefined => undefined);
    }
    violationTimer = setTimeout(() => void childProcess.cancel(), CANCEL_GRACE_MS);
  };
  const onAbort = () => {
    cancelled = true;
    if (sessionId && connection) {
      void connection.agent.notify(methods.agent.session.cancel, { sessionId }).catch((): undefined => undefined);
    }
    cancelTimer = setTimeout(() => void childProcess.cancel(), CANCEL_GRACE_MS);
  };
  input.signal.addEventListener("abort", onAbort, { once: true });

  const app = client({ name: "enjoy" })
    .onRequest(methods.client.session.requestPermission, (context) =>
      permissionResponse(context.params, input.provider, serverName, Boolean(input.mcp), allowedToolCallIds))
    .onNotification(methods.client.session.update, (context) => {
      if (!sessionId || context.params.sessionId !== sessionId || scopeViolation) return;
      const update = context.params.update;
      if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
        const nextBytes = Buffer.byteLength(update.content.text);
        if (textBytes + nextBytes > MAX_TEXT_BYTES) {
          stopForViolation(new NativeAgentError("native_output_limit"));
          return;
        }
        textBytes += nextBytes;
        text += update.content.text;
        callEvent(input.onEvent, { type: "text", text: update.content.text });
        return;
      }
      if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") return;
      const isInitialCall = update.sessionUpdate === "tool_call";
      const isAllowed = input.mcp && (
        isInitialCall
          ? isAllowedLearningTool(toolIdentity(input.provider, serverName, update), serverName)
          : allowedToolCallIds.has(update.toolCallId)
      );
      if (!isAllowed) {
        stopForViolation(new NativeAgentError("native_foreign_tools"));
        return;
      }
      if (isInitialCall) allowedToolCallIds.add(update.toolCallId);
      const identity = toolIdentity(input.provider, serverName, update);
      callEvent(input.onEvent, { type: "tool", toolName: identity.tool ?? identity.display ?? undefined });
    });

  try {
    if (input.signal.aborted) {
      onAbort();
      throw new NativeAgentError("native_cancelled");
    }
    connection = app.connect(ndJsonStream(childProcess.streams.writable, childProcess.streams.readable));
    const initialized = await requestOrProcess(connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        terminal: false,
        fs: { readTextFile: false, writeTextFile: false },
        session: { configOptions: {} },
      },
      clientInfo: { name: "enjoy", version: "1" },
    }), childProcess, input.signal);
    if (initialized.protocolVersion !== PROTOCOL_VERSION) throw new NativeAgentError("native_protocol_error");
    if (input.mcp && initialized.agentCapabilities?.mcpCapabilities?.http !== true) {
      throw new NativeAgentError("native_mcp_unavailable");
    }

    const sessionRequest: NewSessionRequest = {
      cwd: workspace,
      mcpServers: mcpServers(input, serverName),
      ...(input.provider === "claude" ? { _meta: claudeSessionMeta(input) } : {}),
    };
    let session = await requestOrProcess(
      connection.agent.request(methods.agent.session.new, sessionRequest),
      childProcess,
      input.signal,
    );
    sessionId = session.sessionId;
    ({ models, currentModel } = flattenModelOptions(session.configOptions));

    if (input.model) {
      if (!models.some((model) => model.id === input.model)) throw new NativeAgentError("native_model_unavailable");
      const changed = await requestOrProcess(connection.agent.request(methods.agent.session.setConfigOption, {
        sessionId,
        configId: "model",
        value: input.model,
      }), childProcess, input.signal);
      session = { ...session, configOptions: changed.configOptions } as NewSessionResponse;
      ({ models, currentModel } = flattenModelOptions(session.configOptions));
      if (currentModel !== input.model) throw new NativeAgentError("native_model_unavailable");
    }

    if (input.prompt === undefined) {
      return { text: "", model: currentModel, models, sessionId };
    }

    callEvent(input.onEvent, { type: "started" });
    const response = await requestOrProcess(connection.agent.request(methods.agent.session.prompt, {
      sessionId,
      prompt: [{ type: "text", text: input.prompt }],
    }), childProcess, input.signal);
    if (scopeViolation) throw scopeViolation;
    if (cancelled || response.stopReason === "cancelled") throw new NativeAgentError("native_cancelled");
    if (response.stopReason !== "end_turn") throw new NativeAgentError("native_turn_failed");
    callEvent(input.onEvent, { type: "completed" });
    return { text, model: currentModel, models, sessionId };
  } catch (error) {
    if (scopeViolation) throw scopeViolation;
    if (input.signal.aborted || cancelled) throw new NativeAgentError("native_cancelled");
    throw error instanceof NativeAgentError ? error : new NativeAgentError("native_process_failed");
  } finally {
    input.signal.removeEventListener("abort", onAbort);
    if (cancelTimer) clearTimeout(cancelTimer);
    if (violationTimer) clearTimeout(violationTimer);
    if (sessionId && connection && !connection.signal.aborted) {
      await closeSessionBounded(connection, childProcess, sessionId);
    }
    connection?.close();
    try {
      await manager.shutdown();
    } catch {
      const cleanup = () => manager.shutdown();
      // eslint-disable-next-line no-unsafe-finally -- Unverified child cleanup must override a successful response.
      throw new NativeAgentError("native_cleanup_failed", cleanup);
    }
  }
}
