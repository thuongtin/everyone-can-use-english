import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const receiptPath = process.env.ENJOY_U1_MCP_RECEIPT;

if (!receiptPath) {
  throw new Error('ENJOY_U1_MCP_RECEIPT is required');
}

const inputShape = {
  schemaVersion: z.literal('enjoy.learning/1'),
  jobId: z.string().min(1).max(128),
  stageId: z.string().min(1).max(128),
  attemptId: z.string().min(1).max(128),
  expectedRevision: z.string().min(1).max(128),
  idempotencyKey: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
  text: z.string().min(1).max(1200),
};

const outputShape = {
  accepted: z.boolean(),
  stageId: z.string(),
  payloadHash: z.string(),
};

function writeReceipt(receipt) {
  mkdirSync(dirname(receiptPath), { recursive: true });
  const temporaryPath = `${receiptPath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, JSON.stringify(receipt), { mode: 0o600 });
  renameSync(temporaryPath, receiptPath);
}

function nextCount() {
  try {
    const previous = JSON.parse(readFileSync(receiptPath, 'utf8'));
    return Number.isInteger(previous.callCount) ? previous.callCount + 1 : 1;
  } catch {
    return 1;
  }
}

const server = new McpServer(
  {
    name: 'enjoy-u1-fixture',
    version: '1.0.0',
  },
  {
    capabilities: {},
  },
);

server.registerTool(
  'enjoy.submit_lesson_draft',
  {
    title: 'Submit Enjoy lesson draft',
    description:
      'Submit one candidate lesson draft for the current Enjoy job stage.',
    inputSchema: inputShape,
    outputSchema: outputShape,
  },
  async (input) => {
    const payloadHash = createHash('sha256')
      .update(
        JSON.stringify({
          schemaVersion: input.schemaVersion,
          jobId: input.jobId,
          stageId: input.stageId,
          attemptId: input.attemptId,
          expectedRevision: input.expectedRevision,
          idempotencyKey: input.idempotencyKey,
          title: input.title,
          text: input.text,
        }),
      )
      .digest('hex');

    writeReceipt({
      accepted: true,
      callCount: nextCount(),
      schemaVersion: input.schemaVersion,
      jobId: input.jobId,
      stageId: input.stageId,
      attemptId: input.attemptId,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
      titleLength: input.title.length,
      textLength: input.text.length,
      payloadHash,
    });

    return {
      content: [{ type: 'text', text: 'Enjoy lesson draft accepted.' }],
      structuredContent: {
        accepted: true,
        stageId: input.stageId,
        payloadHash,
      },
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
