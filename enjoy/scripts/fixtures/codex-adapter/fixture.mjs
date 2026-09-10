#!/usr/bin/env node

import { fork } from "node:child_process";
import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const args = process.argv.slice(2);
if (args[0] === "--fixture-descendant") {
  writeFileSync(args[1], String(process.pid), "utf8");
  setInterval(() => {}, 1_000);
  await new Promise(() => {});
}

const scenario = basename(process.cwd());
const summaryPath = join(process.cwd(), ".fixture-summary.json");
const methods = [];
const nativeToolNames = [
  "enjoy.get_job_context",
  "enjoy.get_lesson_revision",
  "enjoy.get_job_status",
  "enjoy.submit_lesson_draft",
  "enjoy.submit_mindmap",
  "enjoy.submit_exercises",
];
const credentialEnvNames = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CODEX_API_KEY",
  "CLAUDE_API_KEY",
  "OPENAI_OAUTH_TOKEN",
  "ANTHROPIC_AUTH_TOKEN",
];
const configValues = {};
for (let index = 0; index < args.length - 1; index += 1) {
  if (args[index] !== "-c") continue;
  const assignment = args[index + 1];
  const separator = assignment.indexOf("=");
  if (separator > 0) configValues[assignment.slice(0, separator)] = assignment.slice(separator + 1);
}

const state = {
  scenario,
  methods,
  tokenPresent: typeof process.env.ENJOY_MCP_TOKEN === "string",
  credentialEnvPresent: credentialEnvNames.some((name) => typeof process.env[name] === "string"),
  config: {
    imageGeneration: configValues["features.image_generation"] === "true",
    webSearchDisabled: configValues.web_search === JSON.stringify("disabled"),
    defaultPermissions: configValues.default_permissions === JSON.stringify("enjoy-job"),
    modelCatalogPresent: typeof configValues.model_catalog_json === "string",
  },
  thread: {
    serverNames: [],
    nativeServersDisabled: false,
    enjoyToolsCount: 0,
    workspaceScoped: false,
    permissionProfile: null,
    hasOutputSchema: false,
  },
  status: {
    scopedTools: [],
    foreignTools: [],
  },
  turnStarted: false,
  descendantPid: null,
  turnId: null,
  enjoyServerName: null,
};

function writeSummary() {
  writeFileSync(summaryPath, JSON.stringify(state), "utf8");
}

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ id, result })}\n`);
}

function replyError(id, code) {
  process.stdout.write(`${JSON.stringify({ id, error: { code, message: "fixture error" } })}\n`);
}

function parseConfigValue(value) {
  try { return JSON.parse(value); } catch { return value; }
}

function launchDescendant() {
  const marker = join(process.cwd(), ".fixture-descendant-pid");
  const child = fork(new URL("./fixture.mjs", import.meta.url), ["--fixture-descendant", marker], {
    detached: false,
    stdio: "ignore",
  });
  state.descendantPid = child.pid ?? null;
  writeFileSync(marker, String(state.descendantPid), "utf8");
  writeSummary();
}

function sendTurnEvents() {
  if (state.enjoyServerName) {
    process.stdout.write(`${JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "fixture-thread",
        turnId: state.turnId,
        item: { id: "mcp-call-1", type: "mcpToolCall", status: "completed", server: scenario === "foreign-event-server" ? "foreign" : state.enjoyServerName, tool: scenario === "foreign-event-tool" ? "read_file" : "enjoy.submit_lesson_draft" },
      },
    })}\n`);
  }
  if (state.config.imageGeneration) {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    process.stdout.write(`${JSON.stringify({
      method: "item/completed",
      params: {
        threadId: "fixture-thread",
        turnId: state.turnId,
        item: { id: "image-1", type: "imageGeneration", status: "completed", result: `data:image/png;base64,${png}` },
      },
    })}\n`);
  }
  process.stdout.write(`${JSON.stringify({
    method: "item/completed",
    params: {
      threadId: "fixture-thread",
      turnId: state.turnId,
      item: { id: "message-1", type: "agentMessage", status: "completed", text: "fixture lesson text" },
    },
  })}\n`);
  process.stdout.write(`${JSON.stringify({
    method: "turn/completed",
    params: { threadId: "fixture-thread", turn: { id: state.turnId, status: "completed" } },
  })}\n`);
}

async function handle(message) {
  const method = message?.method;
  if (typeof method !== "string") return;
  methods.push(method);

  if (method === "initialized") {
    writeSummary();
    return;
  }
  if (method === "initialize") {
    reply(message.id, { serverInfo: { name: "codex-fixture", version: "0.153.2" } });
    writeSummary();
    return;
  }
  if (method === "account/read") {
    reply(message.id, { account: { type: scenario === "unauthenticated" ? "api" : "chatgpt" } });
    writeSummary();
    return;
  }
  if (method === "config/read") {
    reply(message.id, { config: { mcp_servers: { personal: {}, team: {} } } });
    writeSummary();
    return;
  }
  if (method === "thread/start") {
    const servers = message.params?.config?.mcp_servers ?? {};
    const entries = Object.entries(servers);
    state.enjoyServerName = entries.find(([, value]) => value?.enabled === true)?.[0] ?? null;
    state.thread.serverNames = Object.keys(servers);
    state.thread.nativeServersDisabled = entries
      .filter(([name]) => name !== state.enjoyServerName)
      .every(([, value]) => value?.enabled === false);
    state.thread.enjoyToolsCount = state.enjoyServerName && Array.isArray(servers[state.enjoyServerName]?.enabled_tools)
      ? servers[state.enjoyServerName].enabled_tools.length
      : 0;
    state.thread.workspaceScoped = Array.isArray(message.params?.runtimeWorkspaceRoots)
      && message.params.runtimeWorkspaceRoots.length === 1;
    state.thread.permissionProfile = scenario === "wrong-permission" ? "wrong-profile" : "enjoy-job";
    reply(message.id, {
      thread: { id: "fixture-thread" },
      activePermissionProfile: { id: state.thread.permissionProfile },
      sandbox: { type: "workspaceWrite", networkAccess: false },
      model: "fixture-model",
    });
    writeSummary();
    return;
  }
  if (method === "mcpServerStatus/list") {
    if (scenario === "malformed-status") {
      reply(message.id, { data: "malformed", nextCursor: null });
      writeSummary();
      return;
    }
    const scopedTools = scenario === "missing-scoped-tools"
      ? nativeToolNames.filter((name) => name !== "enjoy.get_job_context")
      : nativeToolNames;
    const data = state.enjoyServerName
      ? [{ name: state.enjoyServerName, runtimeStatus: "connected", tools: Object.fromEntries(scopedTools.map((name) => [name, {}])) }]
      : [];
    if (scenario === "foreign-mcp") data.push({ name: "foreign-host", tools: { read_file: {} } });
    state.status.scopedTools = scopedTools;
    state.status.foreignTools = scenario === "foreign-mcp" ? ["read_file"] : [];
    reply(message.id, { data, nextCursor: null });
    writeSummary();
    return;
  }
  if (method === "turn/start") {
    state.turnStarted = true;
    state.turnId = "fixture-turn";
    state.thread.hasOutputSchema = Boolean(message.params?.outputSchema);
    reply(message.id, { turn: { id: state.turnId } });
    writeSummary();
    if (scenario === "timeout" || scenario === "cancel") {
      launchDescendant();
      setInterval(() => {}, 1_000);
      return;
    }
    if (scenario === "malformed-result") {
      process.stdout.write(`${JSON.stringify({
        method: "turn/completed",
        params: { threadId: "fixture-thread", turn: { id: state.turnId, status: "failed" } },
      })}\n`);
      return;
    }
    setTimeout(sendTurnEvents, 5);
    return;
  }
  replyError(message.id, -32601);
}

let buffer = "";
let chain = Promise.resolve();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newlineIndex = buffer.indexOf("\n");
  while (newlineIndex >= 0) {
    const line = buffer.slice(0, newlineIndex);
    buffer = buffer.slice(newlineIndex + 1);
    newlineIndex = buffer.indexOf("\n");
    if (!line.trim()) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    chain = chain.then(() => handle(message));
  }
});
writeSummary();
