import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

function parseToolResult(result) {
  assert.equal(result.isError, undefined);
  assert.equal(result.content?.[0]?.type, "text");
  return JSON.parse(result.content[0].text);
}

export function acceptingAdapter(provider, payload, observations) {
  return {
    async run(request) {
      observations.runs++;
      observations.requests.push(request);
      const transport = new StreamableHTTPClientTransport(new URL(request.mcp.url), {
        requestInit: { headers: { Authorization: `Bearer ${request.mcp.token}` } },
      });
      const client = new Client({ name: "native-generation-fixture", version: "1.0.0" });
      await client.connect(transport);
      try {
        const context = parseToolResult(await client.callTool({
          name: "enjoy.get_job_context",
          arguments: {},
        }));
        const tool = context.kind === "text"
          ? "enjoy.submit_lesson_draft"
          : "enjoy.submit_mindmap";
        const accepted = parseToolResult(await client.callTool({
          name: tool,
          arguments: {
            schemaVersion: 1,
            jobId: context.jobId,
            stageId: context.stageId,
            attemptId: context.attemptId,
            expectedRevisionId: context.revisionId,
            payload,
          },
        }));
        assert.equal(accepted.accepted, true);
      } finally {
        await client.close();
      }
      return { provider, text: "accepted", images: [], model: "fixture" };
    },
  };
}

export function proseOnlyAdapter(provider, observations) {
  return {
    async run(request) {
      observations.runs++;
      observations.requests.push(request);
      return { provider, text: "I completed the lesson.", images: [], model: "fixture" };
    },
  };
}

export function failingAdapter(code, observations) {
  return {
    async run(request) {
      observations.runs++;
      observations.requests.push(request);
      throw Object.assign(new Error("fixture details must not persist"), { code });
    },
  };
}

export function retryableCleanupAdapter(observations) {
  let shouldFail = true;
  return {
    adapter: {
      async run(request) {
        observations.runs++;
        observations.requests.push(request);
        const error = Object.assign(new Error("cleanup requires a retry"), {
          code: "native_cleanup_failed",
          cleanup: async () => {
            observations.cleanupCalls = (observations.cleanupCalls ?? 0) + 1;
            if (shouldFail) throw Object.assign(new Error("still owned"), { code: "native_cleanup_failed" });
          },
        });
        throw error;
      },
    },
    allowCleanup: () => { shouldFail = false; },
  };
}

export function blockingAdapter(provider, observations) {
  let releaseRun;
  const release = new Promise((resolve) => { releaseRun = resolve; });
  return {
    adapter: {
      async run(request) {
        observations.runs++;
        observations.requests.push(request);
        await new Promise((resolve) => {
          if (request.signal.aborted) return resolve();
          request.signal.addEventListener("abort", () => {
            observations.abortObserved = true;
            resolve();
          }, { once: true });
        });
        await release;
        throw Object.assign(new Error("cancelled"), { code: "native_cancelled" });
      },
    },
    release: () => releaseRun(),
  };
}
