#!/usr/bin/env node

import {
  PROTOCOL_VERSION,
  agent,
  methods,
  ndJsonStream,
} from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const sessions = new Map();
let nextSession = 0;

const configuredCodexServer = () => {
  try {
    const config = JSON.parse(process.env.CODEX_CONFIG ?? "{}");
    return Object.entries(config.mcp_servers ?? {}).find(([, value]) => value?.enabled === true)?.[0];
  } catch {
    return undefined;
  }
};

const modelOptions = (currentValue = "fixture-small") => [{
  id: "model",
  name: "Model",
  type: "select",
  currentValue,
  options: [
    { value: "fixture-small", name: "Fixture Small" },
    { value: "fixture-large", name: "Fixture Large" },
  ],
}];

const app = agent({ name: "enjoy-acp-fixture" })
  .onConnect((connection) => {
    connection.signal.addEventListener("abort", () => sessions.clear(), { once: true });
  })
  .onRequest(methods.agent.initialize, ({ params }) => ({
    protocolVersion: params.protocolVersion === PROTOCOL_VERSION ? PROTOCOL_VERSION : PROTOCOL_VERSION,
    agentInfo: { name: "enjoy-acp-fixture", version: "1" },
    agentCapabilities: {
      loadSession: false,
      promptCapabilities: { image: false, audio: false, embeddedContext: false },
      mcpCapabilities: { http: true, sse: false },
      sessionCapabilities: { close: {} },
    },
  }))
  .onRequest(methods.agent.session.new, ({ params }) => {
    const sessionId = `fixture-${++nextSession}`;
    sessions.set(sessionId, { model: "fixture-small", mcpServers: params.mcpServers, creationMeta: params._meta, cancelled: false });
    return { sessionId, configOptions: modelOptions() };
  })
  .onRequest(methods.agent.session.setConfigOption, ({ params }) => {
    const session = sessions.get(params.sessionId);
    if (!session || params.configId !== "model" || typeof params.value !== "string") throw new Error("invalid model");
    session.model = params.value;
    return { configOptions: modelOptions(session.model) };
  })
  .onRequest(methods.agent.session.prompt, async ({ params, client, signal }) => {
    const session = sessions.get(params.sessionId);
    if (!session) throw new Error("missing session");
    const text = params.prompt.filter((block) => block.type === "text").map((block) => block.text).join("\n");
    if (text === "role-check") {
      const configured = process.env.CODEX_CONFIG
        ? JSON.parse(process.env.CODEX_CONFIG).developer_instructions
        : session.creationMeta?.systemPrompt;
      if (typeof configured !== "string" || !configured.includes("FIXTURE_SYSTEM_ROLE")) {
        throw new Error("system role was not configured");
      }
    }
    if (text === "proxy-env") {
      const expectedProxy = "http://127.0.0.1:8123/";
      const expectedBypass = "localhost,127.0.0.1,::1,[::1]";
      if (process.env.HTTP_PROXY !== expectedProxy || process.env.HTTPS_PROXY !== expectedProxy) {
        throw new Error("configured proxy environment was not passed to ACP");
      }
      if (process.env.NO_PROXY !== expectedBypass || process.env.no_proxy !== expectedBypass) {
        throw new Error("loopback proxy bypass was not passed to ACP");
      }
    }
    if (text === "abort-preflight") {
      await writeFile(join(process.cwd(), "abort-preflight.prompt-reached"), "reached");
    }
    if (text === "wait") {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 30_000);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
      return { stopReason: "cancelled" };
    }
    if (text === "hang-close") session.hangClose = true;
    if (text === "ignore-cancel-foreign") {
      await writeFile(join(process.cwd(), "ignore-cancel.pid"), String(process.pid));
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: "tool_call", toolCallId: "foreign-hung", title: "Bash", name: "Bash", kind: "execute", status: "pending" },
      });
      await new Promise(() => {});
    }
    if (text === "ignore-cancel-output") {
      await writeFile(join(process.cwd(), "ignore-output-cancel.pid"), String(process.pid));
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "x".repeat(8 * 1024 * 1024 + 1) } },
      });
      await new Promise(() => {});
    }
    if (text === "foreign-tool") {
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: "tool_call", toolCallId: "foreign", title: "Bash", name: "Bash", kind: "execute", status: "pending" },
      });
      return { stopReason: "cancelled" };
    }
    if (text === "spoofed-tool") {
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "spoofed",
          title: "mcp.enjoy.enjoy.get_job_context",
          name: "enjoy.get_job_context",
          kind: "execute",
          status: "pending",
          rawInput: { server: "foreign", tool: "enjoy.get_job_context" },
          _meta: { claudeCode: { toolName: "mcp__foreign__enjoy_get_job_context" } },
        },
      });
      return { stopReason: "cancelled" };
    }
    if (text === "unknown-tool-update") {
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: "tool_call_update", toolCallId: "unknown", status: "in_progress" },
      });
      return { stopReason: "cancelled" };
    }
    if (text === "allowed-tool") {
      const isCodex = typeof process.env.CODEX_CONFIG === "string";
      if ((isCodex && session.mcpServers.length !== 0) || (!isCodex && session.mcpServers.length !== 1)) {
        throw new Error("provider MCP transport mismatch");
      }
      const serverName = session.mcpServers[0]?.name ?? configuredCodexServer() ?? "missing";
      const toolCall = {
        toolCallId: "allowed",
        title: "mcp.enjoy.enjoy.get_job_context",
        kind: "execute",
        status: "pending",
        rawInput: { server: serverName, tool: "enjoy.get_job_context", arguments: {} },
        _meta: { claudeCode: { toolName: `mcp__${serverName}__enjoy_get_job_context` } },
      };
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: "tool_call", ...toolCall },
      });
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: "tool_call_update", toolCallId: toolCall.toolCallId, status: "in_progress" },
      });
      const permission = await client.request(methods.client.session.requestPermission, {
        sessionId: params.sessionId,
        toolCall,
        options: [
          { optionId: "cancel", name: "Cancel", kind: "reject_once" },
          { optionId: "once", name: "Allow", kind: "allow_once" },
        ],
      });
      if (permission.outcome.outcome !== "selected") return { stopReason: "cancelled" };
    }
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "fixture " } },
    });
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `${session.model}:${text}` } },
    });
    return { stopReason: session.cancelled ? "cancelled" : "end_turn" };
  })
  .onRequest(methods.agent.session.close, ({ params }) => {
    if (sessions.get(params.sessionId)?.hangClose) return new Promise(() => {});
    sessions.delete(params.sessionId);
    return {};
  })
  .onNotification(methods.agent.session.cancel, ({ params }) => {
    const session = sessions.get(params.sessionId);
    if (session) session.cancelled = true;
  });

app.connect(ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
));
