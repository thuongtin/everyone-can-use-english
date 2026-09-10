#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-acp-chat-model-"));
const output = path.join(temp, "acp-chat-model.cjs");

try {
  const aiSettingsSource = await readFile(
    path.join(root, "src/renderer/context/ai-settings-provider.tsx"),
    "utf8"
  );
  const refreshStart = aiSettingsSource.indexOf(
    "const refreshAcpStatus = useCallback(async () => {"
  );
  const bridgeCall = aiSettingsSource.indexOf("await bridge.status()", refreshStart);
  const refreshGuard = aiSettingsSource.indexOf(
    'if (db.state !== "connected")',
    refreshStart
  );
  assert.ok(refreshStart >= 0 && refreshGuard > refreshStart);
  assert.ok(
    refreshGuard < bridgeCall,
    "ACP status callback must guard database readiness before IPC"
  );
  assert.match(
    aiSettingsSource,
    /useEffect\(\(\) => \{\s+if \(db\.state !== "connected"\)[\s\S]*?void refreshAcpStatus\(\);\s+\}, \[db\.state, refreshAcpStatus\]\);/u,
    "ACP status effect must schedule IPC only after the database connects"
  );

  await build({
    stdin: {
      contents: `
        export { createChatModel, getChatModelRequestPolicy } from "./src/lib/chat-model.ts";
        export { createGptProviders } from "./src/lib/ai-providers.ts";
        export { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
      `,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: output,
    logLevel: "silent",
  });

  const {
    createChatModel,
    createGptProviders,
    getChatModelRequestPolicy,
    HumanMessage,
    SystemMessage,
    ToolMessage,
  } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

  const requests = [];
  const listeners = new Set();
  const cancelled = [];
  const pendingRejects = new Map();
  let usePendingRequest = false;
  let completedText = "Xin chào";
  const bridge = {
    status: async () => [],
    onUpdate: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    cancel: async (requestId) => {
      cancelled.push(requestId);
      pendingRejects.get(requestId)?.(new Error("cancelled"));
    },
    invoke: async (request) => {
      requests.push(request);
      if (usePendingRequest) {
        return new Promise((_resolve, reject) => {
          pendingRejects.set(request.requestId, reject);
        });
      }
      if (request.messages.some((message) => message.content.includes("JSON"))) {
        return { text: '{"answer":"ok"}', model: request.model || null };
      }
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener({ requestId: "stale-request", type: "text", text: "wrong" });
          listener({ requestId: request.requestId, type: "text", text: "Xin" });
          listener({ requestId: request.requestId, type: "text", text: " chào" });
        }
      });
      return { text: completedText, model: request.model || null };
    },
  };

  assert.equal(
    getChatModelRequestPolicy({ provider: "codex-acp", modelName: "gpt-test" })
      .protocol,
    "acp"
  );
  assert.equal(
    getChatModelRequestPolicy({ provider: "claude-acp" }).modelName,
    ""
  );
  assert.throws(
    () => createChatModel({ provider: "codex-acp" }),
    /ACP runtime is unavailable/
  );

  const providers = createGptProviders(
    { "codex-acp": { name: "codex-acp", models: "stale-model" } },
    undefined,
    { "codex-acp": ["discovered-model"] }
  );
  assert.deepEqual(providers["codex-acp"].models, ["discovered-model"]);

  const model = createChatModel({
    provider: "codex-acp",
    modelName: "gpt-test",
    acpBridge: bridge,
  });
  const response = await model.invoke([
    new SystemMessage("Be concise"),
    new HumanMessage("Hello"),
  ]);
  assert.equal(response.content, "Xin chào");
  assert.deepEqual(
    requests[0].messages.map(({ role, content }) => ({ role, content })),
    [
      { role: "system", content: "Be concise" },
      { role: "user", content: "Hello" },
    ]
  );
  assert.equal(requests[0].provider, "codex");
  assert.equal(requests[0].model, "gpt-test");
  assert.match(requests[0].requestId, /^[0-9a-f-]{36}$/i);

  const requestCountBeforeUnsupportedInput = requests.length;
  await assert.rejects(
    model.invoke([
      new HumanMessage({
        content: [{ type: "image_url", image_url: "https://example.invalid/image.png" }],
      }),
    ]),
    (error) => error?.code === "acp_unsupported_content"
  );
  await assert.rejects(
    model.invoke([
      new ToolMessage({ content: "tool output", tool_call_id: "tool-call" }),
    ]),
    (error) => error?.code === "acp_unsupported_message_role"
  );
  assert.equal(requests.length, requestCountBeforeUnsupportedInput);

  const jsonModel = model.bind({
    response_format: {
      type: "json_schema",
      json_schema: { type: "object", required: ["answer"] },
    },
  });
  const jsonResponse = await jsonModel.invoke("Return an answer");
  assert.equal(jsonResponse.content, '{"answer":"ok"}');
  assert.match(requests[1].messages[0].content, /JSON Schema/);
  assert.match(requests[1].messages[0].content, /required/);

  const chunks = [];
  const callbackTokens = [];
  for await (const chunk of await model.stream("Say hello", {
    callbacks: [
      {
        handleLLMNewToken: (token) => callbackTokens.push(token),
      },
    ],
  })) {
    chunks.push(chunk.content);
  }
  assert.equal(chunks.join(""), "Xin chào");
  assert.equal(callbackTokens.join(""), "Xin chào");
  assert.equal(listeners.size, 0);

  completedText = "Kết quả khác";
  const mismatchChunks = [];
  await assert.rejects(
    async () => {
      for await (const chunk of await model.stream("Mismatch")) {
        mismatchChunks.push(chunk.content);
      }
    },
    (error) => error?.code === "acp_stream_result_mismatch"
  );
  assert.equal(mismatchChunks.join(""), "Xin chào");
  assert.equal(listeners.size, 0);
  completedText = "Xin chào";

  usePendingRequest = true;
  const controller = new AbortController();
  const aborted = model.invoke("Wait", { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(aborted, (error) => error?.name === "AbortError");
  assert.equal(cancelled.at(-1), requests.at(-1).requestId);

  console.log("ACP chat model check passed: invoke, JSON prompt, text-only guards, stream consistency, stale update guard, cleanup, abort cancellation");
} finally {
  await rm(temp, { recursive: true, force: true });
}
