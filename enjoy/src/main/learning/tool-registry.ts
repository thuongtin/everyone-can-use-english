import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LearningCapabilityGrant } from "./capability-registry";
import { canonicalPayloadHash } from "./candidate";
import {
  ExerciseSchema,
  LessonDraftSchema,
  MindmapGraphSchema,
  ServiceResourceIdSchema,
  StageCandidateEnvelopeSchema,
} from "../../lib/learning-schemas";
import type { StageCandidateEnvelope } from "../../types/learning";

export const LEARNING_MCP_TOOL_NAMES = [
  "enjoy.get_job_context",
  "enjoy.get_lesson_revision",
  "enjoy.get_job_status",
  "enjoy.submit_lesson_draft",
  "enjoy.submit_mindmap",
  "enjoy.submit_exercises",
] as const;

export type LearningMcpToolName = (typeof LEARNING_MCP_TOOL_NAMES)[number];

export interface LearningMcpApplication {
  getJobContext(grant: LearningCapabilityGrant): Promise<unknown>;
  getLessonRevision(grant: LearningCapabilityGrant): Promise<unknown>;
  getJobStatus(grant: LearningCapabilityGrant): Promise<unknown>;
  submitCandidate(
    grant: LearningCapabilityGrant,
    envelope: StageCandidateEnvelope,
  ): Promise<unknown>;
}

export type LearningMcpAuthorizationRequest = Readonly<{
  tool: string;
  jobId?: string;
  stageId?: string;
  attemptId?: string;
  revisionId?: string;
}>;

export type LearningMcpAuthorizer = (
  request: LearningMcpAuthorizationRequest,
) => LearningCapabilityGrant;

export type LearningMcpToolContext = Readonly<{
  grant: LearningCapabilityGrant;
  authorize: LearningMcpAuthorizer;
  application: LearningMcpApplication;
}>;

const submitIdentityShape = {
  schemaVersion: z.literal(1),
  jobId: ServiceResourceIdSchema,
  stageId: ServiceResourceIdSchema,
  attemptId: ServiceResourceIdSchema,
  expectedRevisionId: ServiceResourceIdSchema,
  // Accepted for compatibility, but never trusted. The boundary recomputes it.
  payloadHash: z.string().max(128).optional(),
};

const submitLessonDraftSchema = z.object({
  ...submitIdentityShape,
  payload: LessonDraftSchema,
}).strict();

const submitMindmapSchema = z.object({
  ...submitIdentityShape,
  payload: MindmapGraphSchema,
}).strict();

const submitExercisesSchema = z.object({
  ...submitIdentityShape,
  payload: z.object({ exercises: z.array(ExerciseSchema).max(48) }).strict(),
}).strict();

const readInputSchema = z.object({}).strict();

type ToolResult = {
  content: [{ type: "text"; text: string }];
  isError?: boolean;
};

type RegisterTool = (
  name: string,
  config: { description: string; inputSchema: z.ZodTypeAny },
  callback: (input: unknown) => Promise<ToolResult>,
) => unknown;

const stableErrorCode = (error: unknown, fallback = "application_failed"): string => {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(error.code)) {
    return error.code;
  }
  return fallback;
};

const errorResult = (code: string): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify({ error: { code } }) }],
  isError: true,
});

const valueResult = (value: unknown): ToolResult => {
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return errorResult("application_result_invalid");
    return { content: [{ type: "text", text }] };
  } catch {
    return errorResult("application_result_invalid");
  }
};

const asToolName = (value: string): LearningMcpToolName | undefined => (
  (LEARNING_MCP_TOOL_NAMES as readonly string[]).includes(value)
    ? value as LearningMcpToolName
    : undefined
);

const authorizeRead = async (
  context: LearningMcpToolContext,
  tool: LearningMcpToolName,
  operation: (grant: LearningCapabilityGrant) => Promise<unknown>,
): Promise<ToolResult> => {
  try {
    return valueResult(await operation(context.authorize({ tool })));
  } catch (error) {
    return errorResult(stableErrorCode(error, "capability_denied"));
  }
};

type SubmitInput = {
  schemaVersion: 1;
  jobId: string;
  stageId: string;
  attemptId: string;
  expectedRevisionId: string;
  payloadHash?: string;
  payload: unknown;
};

const submit = async <T extends "text" | "map" | "exercises">(
  context: LearningMcpToolContext,
  tool: LearningMcpToolName,
  input: SubmitInput,
  kind: T,
): Promise<ToolResult> => {
  try {
    const grant = context.authorize({
      tool,
      jobId: input.jobId,
      stageId: input.stageId,
      attemptId: input.attemptId,
      revisionId: input.expectedRevisionId,
    });
    const envelope = {
      kind,
      schemaVersion: 1 as const,
      jobId: input.jobId,
      stageId: input.stageId,
      attemptId: input.attemptId,
      expectedRevisionId: input.expectedRevisionId,
      payloadHash: canonicalPayloadHash(input.payload),
      payload: input.payload,
    };
    const parsed = StageCandidateEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) return errorResult("schema_invalid");
    return valueResult(await context.application.submitCandidate(grant, parsed.data));
  } catch (error) {
    return errorResult(stableErrorCode(error, "application_failed"));
  }
};

const registerReadTool = (
  server: McpServer,
  context: LearningMcpToolContext,
  name: LearningMcpToolName,
  description: string,
  operation: (grant: LearningCapabilityGrant) => Promise<unknown>,
) => {
  const registerTool = server.registerTool.bind(server) as unknown as RegisterTool;
  registerTool(name, { description, inputSchema: readInputSchema }, () => authorizeRead(context, name, operation));
};

const registerSubmitTool = (
  server: McpServer,
  context: LearningMcpToolContext,
  name: LearningMcpToolName,
  description: string,
  schema: z.ZodTypeAny,
  kind: "text" | "map" | "exercises",
): void => {
  const registerTool = server.registerTool.bind(server) as unknown as RegisterTool;
  registerTool(name, { description, inputSchema: schema }, (input: unknown) => submit(context, name, input as SubmitInput, kind));
};

/** Registers exactly the tools present in this request's immutable capability grant. */
export function registerLearningTools(server: McpServer, context: LearningMcpToolContext): void {
  for (const rawName of context.grant.tools) {
    const name = asToolName(rawName);
    if (!name) continue;
    if (name === "enjoy.get_job_context") {
      registerReadTool(server, context, name, "Read the current job context.", (grant) => context.application.getJobContext(grant));
    } else if (name === "enjoy.get_lesson_revision") {
      registerReadTool(server, context, name, "Read the current lesson revision.", (grant) => context.application.getLessonRevision(grant));
    } else if (name === "enjoy.get_job_status") {
      registerReadTool(server, context, name, "Read the current job status.", (grant) => context.application.getJobStatus(grant));
    } else if (name === "enjoy.submit_lesson_draft") {
      registerSubmitTool(server, context, name, "Submit one lesson draft candidate.", submitLessonDraftSchema, "text");
    } else if (name === "enjoy.submit_mindmap") {
      registerSubmitTool(server, context, name, "Submit one mindmap candidate.", submitMindmapSchema, "map");
    } else if (name === "enjoy.submit_exercises") {
      registerSubmitTool(server, context, name, "Submit exercise candidates.", submitExercisesSchema, "exercises");
    }
  }
}
