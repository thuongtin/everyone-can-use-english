import { writeFile } from "node:fs/promises";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import { validateSubmitCandidate } from "../../../check-claude-native.mjs";

const receiptPath = process.env.ENJOY_SPIKE_RECEIPT_PATH;

const server = new McpServer({
  name: "enjoy-claude-spike",
  version: "0.1.0",
});

server.registerTool("submit_lesson_draft", {
  description: "Submit one bounded lesson candidate to the Enjoy job.",
  inputSchema: {
    schemaVersion: z.literal("stage-candidate/v1"),
    jobId: z.string().min(1),
    stageId: z.string().min(1),
    attemptId: z.string().min(1),
    expectedRevision: z.number().int().min(1),
    payload: z.record(z.string(), z.unknown()),
  },
}, async (candidate) => {
  const validation = validateSubmitCandidate(candidate);
  if (!validation.ok) {
    return {
      isError: true,
      content: [{ type: "text", text: validation.code }],
      structuredContent: validation,
    };
  }
  if (!receiptPath) {
    return {
      isError: true,
      content: [{ type: "text", text: "missing-receipt-path" }],
    };
  }

  const receipt = {
    accepted: true,
    payloadHash: validation.payloadHash,
    schemaVersion: validation.schemaVersion,
    jobId: validation.jobId,
    stageId: validation.stageId,
    attemptId: validation.attemptId,
    expectedRevision: validation.expectedRevision,
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`, "utf8");
  return {
    content: [{ type: "text", text: "accepted" }],
    structuredContent: {
      accepted: true,
      payloadHash: validation.payloadHash,
    },
  };
});

try {
  await server.connect(new StdioServerTransport());
} catch {
  process.exitCode = 1;
}
