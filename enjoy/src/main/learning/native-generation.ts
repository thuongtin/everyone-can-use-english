import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { CodexNativeAgent } from "../agents/codex-native";
import { AcpNativeAgent } from "../agents/acp-native";
import { probeAcpAgent } from "../agents/acp-discovery";
import { probeNativeAgent } from "../agents/native-discovery";
import type {
  NativeAgentAdapter,
  NativeAgentProbe,
  NativeAgentProvider,
} from "../agents/native-types";
import type { ExecutablePin } from "../agents/process-manager";
import type {
  GenerationJobAttributes,
  GenerationStageAttributes,
  StageAttemptAttributes,
} from "../db/learning-models";
import type { SpeechProvider } from "../speech/provider";
import { UserSetting } from "../db/models/user-setting";
import { UserSettingKeyEnum } from "../../types/enums";
import { getChatModelRequestPolicy } from "../../lib/chat-model";
import { normalizeProviderConfig } from "../../lib/ai-providers";
import { resolveAzureLearningModel } from "../../lib/learning-azure-config";
import type {
  LearningGenerationProvider,
  LearningNativeCapability,
} from "../../types/learning-api";
import { LessonDraftSchema, MindmapGraphSchema, ServiceResourceIdSchema } from "../../lib/learning-schemas";
import { canonicalPayloadHash } from "./candidate";
import { runNativeAssetStage } from "./native-assets";
import type { LearningRuntime } from "./runtime";
import { mapGroupAssetSource } from "./storage";
import {
  runAzureLearningTextGeneration,
  type AzureLearningTextConfig,
  type AzureLearningTextRequest,
} from "./azure-text-generation";

const NATIVE_LEASE_MS = 900_000;
const NATIVE_TIMEOUT_MS = 600_000;
const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,128}$/u;
const PUBLIC_ERROR_CODES = new Set([
  "acp_adapter_unavailable",
  "acp_adapter_changed",
  "acp_node_unavailable",
  "acp_node_unsupported",
  "acp_probe_failed",
  "invalid_audio",
  "learning_attempt_stale",
  "learning_candidate_scope_mismatch",
  "learning_cleanup_failed",
  "learning_job_cancelled",
  "learning_lease_expired",
  "learning_native_asset_required",
  "learning_not_found",
  "learning_revision_conflict",
  "learning_slot_mismatch",
  "learning_stage_busy",
  "native_auth",
  "native_auth_required",
  "native_auth_unconfirmed",
  "native_binary_missing",
  "native_cancelled",
  "native_catalog",
  "native_cleanup_failed",
  "native_error",
  "native_foreign_tools",
  "native_image_invalid",
  "native_image_missing",
  "native_image_unavailable",
  "native_invalid_request",
  "native_launch",
  "native_mcp",
  "native_mcp_unavailable",
  "native_model_unavailable",
  "native_output_limit",
  "native_policy_unverified",
  "native_probe_failed",
  "native_process_failed",
  "native_protocol",
  "native_protocol_error",
  "native_protocol_timeout",
  "native_quota",
  "native_submission_missing",
  "native_timeout",
  "native_turn_failed",
  "native_unavailable",
  "native_version_unsupported",
  "native_workspace_failed",
  "profile_changed",
  "profile_closed",
  "speech_cancelled",
  "speech_auth",
  "speech_network",
  "speech_failed",
  "speech_not_configured",
  "speech_quota",
  "speech_timeout",
  "azure_text_not_configured",
  "azure_text_auth",
  "azure_text_quota",
  "azure_text_timeout",
  "azure_text_cancelled",
  "azure_text_failed",
  "azure_text_invalid",
  "learning_validation_exhausted",
]);

type GenerateInput = Readonly<{
  provider: LearningGenerationProvider;
  model?: string;
  resourceType: "lesson" | "map";
  resourceId: string;
  revisionId: string;
  requestKey: string;
}>;

type NativeGenerationDependencies = Readonly<{
  probe?: typeof probeAcpAgent;
  adapters?: Partial<Record<NativeAgentProvider, NativeAgentAdapter>>;
  assetRunner?: typeof runNativeAssetStage;
  imageAdapter?: NativeAgentAdapter;
  imageProbe?: typeof probeNativeAgent;
  speechProviderFactory?: () => Promise<SpeechProvider | null>;
  azureTextConfigFactory?: () => Promise<AzureLearningTextConfig | null>;
  azureTextRunner?: (request: AzureLearningTextRequest) => Promise<void>;
}>;

type AttemptDirectories = Readonly<{
  root: string;
  workspace: string;
  privateHome: string;
}>;

type Deferred = Readonly<{
  promise: Promise<void>;
  resolve: () => void;
}>;

type RetryableCleanup = {
  run?: () => Promise<void>;
};

type AttemptOutcome = "accepted" | "failed" | "cancelled" | "cleanup_pending";

type AttemptActionContext = Readonly<{
  directories: AttemptDirectories;
  signal: AbortSignal;
}>;

const fail = (code: string): never => {
  throw Object.assign(new Error(code), { code });
};

function deferred(): Deferred {
  let settle!: () => void;
  const promise = new Promise<void>((resolvePromise) => { settle = resolvePromise; });
  let settled = false;
  return {
    promise,
    resolve: () => {
      if (settled) return;
      settled = true;
      settle();
    },
  };
}

function isInside(candidate: string, parent: string): boolean {
  const child = resolve(candidate);
  const base = resolve(parent);
  const difference = relative(base, child);
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference));
}

async function secureDirectory(path: string, recursive: boolean): Promise<string> {
  await mkdir(path, { recursive, mode: 0o700 });
  const stats = await lstat(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) fail("native_workspace_failed");
  await chmod(path, 0o700);
  return realpath(path);
}

async function createAttemptDirectories(runtime: LearningRuntime, attemptId: string): Promise<AttemptDirectories> {
  const { assetRoot, connectionId } = runtime.scope.context;
  if (!SAFE_SEGMENT.test(connectionId) || !SAFE_SEGMENT.test(attemptId)) fail("native_workspace_failed");

  const applicationRoot = await realpath(dirname(assetRoot));
  const nativeRoot = await secureDirectory(join(applicationRoot, "native-jobs"), true);
  if (!isInside(nativeRoot, applicationRoot)) fail("native_workspace_failed");

  const connectionRoot = await secureDirectory(join(nativeRoot, connectionId), true);
  if (!isInside(connectionRoot, nativeRoot)) fail("native_workspace_failed");

  const attemptRoot = await secureDirectory(join(connectionRoot, attemptId), false);
  if (!isInside(attemptRoot, connectionRoot)) fail("native_workspace_failed");

  try {
    const workspace = await secureDirectory(join(attemptRoot, "workspace"), false);
    const privateHome = await secureDirectory(join(attemptRoot, "private-home"), false);
    if (!isInside(workspace, attemptRoot) || !isInside(privateHome, attemptRoot)) {
      fail("native_workspace_failed");
    }
    return { root: attemptRoot, workspace, privateHome };
  } catch (error) {
    await rm(attemptRoot, { recursive: true, force: true }).catch((): undefined => undefined);
    throw error;
  }
}

function stableErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && PUBLIC_ERROR_CODES.has(code)) return code;
  }
  return "native_error";
}

function outcomeMayBeUnknown(code: string): boolean {
  return code === "native_timeout"
    || code === "native_cleanup"
    || code === "native_cleanup_failed"
    || code === "native_mcp"
    || code === "native_protocol"
    || code === "native_protocol_timeout"
    || code === "native_process_failed";
}

function retryableCleanup(error: unknown): (() => Promise<void>) | undefined {
  if (!error || typeof error !== "object" || !("cleanup" in error)) return undefined;
  const cleanup = (error as { cleanup?: unknown }).cleanup;
  return typeof cleanup === "function"
    ? () => Promise.resolve(cleanup.call(error))
    : undefined;
}

function capabilityFromProbe(
  provider: NativeAgentProvider,
  probe: NativeAgentProbe,
): LearningNativeCapability {
  if (probe.provider !== provider) {
    return { provider, text: false, image: false, reason: "native_probe_failed" };
  }
  return {
    provider,
    text: probe.text,
    image: probe.image,
    reason: probe.reason && PUBLIC_ERROR_CODES.has(probe.reason)
      ? probe.reason
      : probe.reason ? "native_probe_failed" : null,
  };
}

async function configuredAzureLearningText(): Promise<AzureLearningTextConfig | null> {
  const [rawConfig, engine] = await Promise.all([
    UserSetting.get(UserSettingKeyEnum.AZURE_OPENAI),
    UserSetting.get(UserSettingKeyEnum.GPT_ENGINE),
  ]);
  const saved = normalizeProviderConfig(
    "azure-openai",
    rawConfig,
  );
  const modelName = resolveAzureLearningModel(saved, engine);
  if (!saved.key?.trim() || !saved.baseUrl?.trim() || !modelName) return null;
  try {
    getChatModelRequestPolicy({
      provider: "azure-openai",
      key: saved.key,
      baseUrl: saved.baseUrl,
      modelName,
    });
  } catch {
    return null;
  }
  return {
    key: saved.key,
    baseUrl: saved.baseUrl,
    modelName,
    maxTokens: 12_000,
  };
}

function generationPrompt(resourceType: GenerateInput["resourceType"]): string {
  const submitTool = resourceType === "lesson"
    ? "enjoy.submit_lesson_draft"
    : "enjoy.submit_mindmap";
  const payloadName = resourceType === "lesson" ? "lesson draft" : "mindmap graph";
  const validatorRules = resourceType === "lesson"
    ? [
      "Use every finalized brief target in at least one section and exactly one glossary entry.",
      "Keep all IDs unique and all section, scene, entity, exercise, and target references valid.",
      "Respect the brief level, length, imageCount, and the exact schema exposed by the submit tool.",
      "Make the story English, use each target naturally, and include valid practice exposure for every target.",
      "Each fill acceptedAnswer must fit the blank verbatim as a grammatical sentence. Keep articles already written before the blank out of acceptedAnswers, and use exactly one word when the prompt asks for one word.",
      "For each fill exercise, use the relevant finalized target term as its single accepted answer, and phrase the sentence so that this exact term fits grammatically.",
      "Write natural vocabulary practice at the requested level, with scrambled order tokens and clear, unambiguous correct answers.",
      "Build each order exercise from a complete grammatical sentence or complete quoted utterance already present in the story. Keep its subject, finite verb, articles, and other required words when making the scrambled tokens.",
      "Keep exercises about named characters or events consistent with the story, including the exact item, quantity, action, and destination. Reconstruct each accepted order before submission and compare it with its source sentence.",
      "Check each story sentence against context.rubric.maxSentenceWords before submission, and split sentences that exceed the requested level guidance into shorter complete sentences.",
    ]
    : [
      "Use unique node and edge IDs, one existing rootNodeId, and only valid edge endpoints.",
      "Keep the graph connected, avoid self edges and duplicate semantic edges, and use only allowed edge kinds.",
      "Create about three studyGroups with three to four ordered nonroot words per group when the topic supports that size. Never put more than six words in one group or more than eight groups in the graph.",
      "Make studyGroups an exact partition of all nonroot nodes: every nonroot node appears once, with no root, duplicate, or missing node.",
      "Give every nonroot node an IPA value. Use the exact study group fields id, title, translationVi, nodeIds, example, and exampleTranslationVi.",
      "When context.brief.illustrations is true, give every study group an illustration object with exactly prompt and alt. Keep all learning text out of the image prompt.",
      "Match vocabulary and examples to context.brief.level, and use context.rubric.maxSentenceWords as the sentence-length guide.",
      "Set model-supplied evidence to status unverified and follow the exact schema exposed by the submit tool.",
    ];

  return [
    "You are generating one bounded learning artifact for Enjoy.",
    "First call enjoy.get_job_context and treat its identity and content as authoritative.",
    "Use context.rubric explicitly for the required word range and maximum sentence length.",
    `Create one ${payloadName} that satisfies the MCP tool schema and all application validators.`,
    ...validatorRules,
    `Call ${submitTool} with schemaVersion 1, the exact jobId, stageId, and attemptId from context, and set expectedRevisionId to context.revisionId.`,
    "If the tool returns accepted false, correct the reported validation issues and resubmit within the allowed limit.",
    "The task is complete only when the submit tool returns accepted true.",
    "Do not claim completion in prose, write files, invoke shell commands, or use tools outside the Enjoy MCP server.",
    "After accepted true, return only a short confirmation. Prose and local files never commit the artifact.",
  ].join("\n");
}

/** Dispatches accepted learning candidates through one scoped native CLI attempt. */
export class NativeLearningGeneration {
  private readonly probe: typeof probeAcpAgent;
  private readonly adapters: Record<NativeAgentProvider, NativeAgentAdapter>;
  private readonly assetRunner: typeof runNativeAssetStage;
  private readonly imageAdapter: NativeAgentAdapter;
  private readonly imageProbe: typeof probeNativeAgent;
  private readonly speechProviderFactory: () => Promise<SpeechProvider | null>;
  private readonly azureTextConfigFactory: () => Promise<AzureLearningTextConfig | null>;
  private readonly azureTextRunner: (request: AzureLearningTextRequest) => Promise<void>;
  private readonly assetDrains = new Map<string, Promise<void>>();
  private capabilityProbe?: Promise<LearningNativeCapability[]>;

  constructor(
    private readonly runtime: LearningRuntime,
    dependencies: NativeGenerationDependencies = {},
  ) {
    const probe = dependencies.probe ?? probeAcpAgent;
    this.probe = async (provider, options = {}) => {
      runtime.scope.assertOpen();
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, runtime.scope.signal, ...(options.signal ? [options.signal] : [])]);
      let finish!: () => void;
      const done = new Promise<void>(resolve => { finish = resolve; });
      let cleanup: (() => Promise<void>) | undefined;
      const unregister = runtime.scope.registerCancellation(async () => {
        controller.abort();
        await done;
        await cleanup?.();
        unregister();
      });
      try {
        return await runtime.scope.run(() => probe(provider, { signal }));
      } catch (error) {
        cleanup = retryableCleanup(error);
        throw error;
      } finally {
        if (!cleanup) unregister();
        finish();
      }
    };
    this.adapters = {
      codex: dependencies.adapters?.codex ?? new AcpNativeAgent("codex"),
      claude: dependencies.adapters?.claude ?? new AcpNativeAgent("claude"),
    };
    this.imageAdapter = dependencies.imageAdapter ?? new CodexNativeAgent();
    this.imageProbe = dependencies.imageProbe ?? probeNativeAgent;
    this.assetRunner = dependencies.assetRunner ?? runNativeAssetStage;
    this.speechProviderFactory = dependencies.speechProviderFactory ?? (async () => null);
    this.azureTextConfigFactory = dependencies.azureTextConfigFactory ?? configuredAzureLearningText;
    this.azureTextRunner = dependencies.azureTextRunner ?? runAzureLearningTextGeneration;
  }

  async capabilities(options: { fresh?: boolean } = {}): Promise<LearningNativeCapability[]> {
    if (!options.fresh && this.capabilityProbe) return this.capabilityProbe;
    const native = (["codex", "claude"] as const).map(async (provider) => {
      try {
        const capability = capabilityFromProbe(provider, await this.probe(provider));
        return provider === "codex"
          ? { ...capability, image: await this.runtime.scope.run(() => this.imageProbe(provider)).then(probe => probe.image).catch(() => false) }
          : capability;
      } catch {
        return { provider, text: false, image: false, reason: "native_probe_failed" };
      }
    });
    const azure = this.azureTextConfigFactory().then(
      (config): LearningNativeCapability => ({
        provider: "azure-openai",
        text: Boolean(config),
        image: false,
        reason: config ? null : "azure_text_not_configured",
      }),
      (): LearningNativeCapability => ({
        provider: "azure-openai",
        text: false,
        image: false,
        reason: "azure_text_not_configured",
      }),
    );
    const operation = Promise.all([...native, azure]);
    this.capabilityProbe = operation;
    try { return await operation; }
    finally { if (this.capabilityProbe === operation) this.capabilityProbe = undefined; }
  }

  async generate(input: GenerateInput): Promise<{ jobId: string }> {
    this.runtime.scope.assertOpen();
    const azureConfig = input.provider === "azure-openai"
      ? await this.azureTextConfigFactory()
      : null;
    const nativeProvider = input.provider === "azure-openai" ? undefined : input.provider;
    const probe = nativeProvider
      ? await this.probe(nativeProvider).catch((): NativeAgentProbe => ({
          provider: nativeProvider,
          executable: null,
          version: null,
          authenticated: false,
          text: false,
          image: false,
          reason: "native_probe_failed",
        }))
      : undefined;
    if (input.provider === "azure-openai" && !azureConfig) fail("azure_text_not_configured");
    if (nativeProvider && probe?.provider !== nativeProvider) fail("native_probe_failed");
    if (nativeProvider && (!probe?.text || !probe.executable)) {
      fail(probe?.reason && PUBLIC_ERROR_CODES.has(probe.reason) ? probe.reason : "native_unavailable");
    }

    const kind = input.resourceType === "lesson" ? "text" as const : "map" as const;
    const created = await this.runtime.application.jobs.create({
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      revisionId: input.revisionId,
      requestKey: input.requestKey,
      stages: [{ key: kind, kind }],
    });
    const stage = created.stages.find((candidate) => candidate.kind === kind && candidate.key === kind);
    if (!stage) fail("learning_request_conflict");
    if (stage.state !== "queued") {
      if (stage.state === "completed") {
        this.scheduleAssetDrainAfterCleanup(created.job.id, stage.activeAttemptId);
      }
      return { jobId: created.job.id };
    }

    let attempt;
    try {
      attempt = await this.runtime.application.jobs.startAttempt(stage.id, input.provider, NATIVE_LEASE_MS);
    } catch (error) {
      if (await this.stageClaimedAfterStartFailure(created.job.id, stage.id)) return { jobId: created.job.id };
      throw error;
    }
    const launched = input.provider === "azure-openai"
      ? await this.launchAzureTextAttempt(
          created.job,
          stage,
          attempt,
          { ...(azureConfig as AzureLearningTextConfig), ...(input.model ? { modelName: input.model } : {}) },
        )
      : await this.launchTrackedAttempt(
          created.job.id,
          stage.id,
          attempt.id,
          async ({ directories, signal }) => {
            const mcp = await this.runtime.application.connectAttempt({
              jobId: created.job.id,
              stageId: stage.id,
              attemptId: attempt.id,
              revisionId: input.revisionId,
            });
            await this.adapters[nativeProvider as NativeAgentProvider].run({
              executable: (probe as NativeAgentProbe).executable as ExecutablePin,
              workspace: directories.workspace,
              privateHome: directories.privateHome,
              model: input.model,
              prompt: generationPrompt(input.resourceType),
              mcp,
              timeoutMs: NATIVE_TIMEOUT_MS,
              signal,
            });
          },
        );
    void launched.completion.then((outcome) => {
      if (outcome === "accepted") this.scheduleAssetDrain(created.job.id);
    }).catch((): undefined => undefined);
    return { jobId: created.job.id };
  }

  async generateAsset(input: {
    resourceType: "lesson" | "map";
    resourceId: string;
    revisionId: string;
    slotId: string;
    requestKey: string;
  }): Promise<{ jobId: string }> {
    this.runtime.scope.assertOpen();
    const resourceId = ServiceResourceIdSchema.parse(input.resourceId);
    const revisionId = ServiceResourceIdSchema.parse(input.revisionId);
    const slotId = ServiceResourceIdSchema.parse(input.slotId);
    const slot = await this.runtime.storage.write(async (transaction) => {
      const profileId = this.runtime.scope.context.profileId;
      const candidate = await this.runtime.storage.models.AssetSlot.findOne({
        where: { id: slotId, profileId },
        transaction,
      });
      if (!candidate) fail("learning_not_found");

      if (input.resourceType === "lesson") {
        const lesson = await this.runtime.storage.models.LearningLesson.findOne({
          where: { id: resourceId, profileId },
          transaction,
        });
        if (!lesson) fail("learning_not_found");
        if (lesson.activeRevisionId !== revisionId) fail("learning_revision_conflict");
        const revision = await this.runtime.storage.models.LessonRevision.findOne({
          where: { id: revisionId, lessonId: resourceId, profileId },
          transaction,
        });
        if (!revision) fail("learning_not_found");
        if (revision.status !== "ready") fail("learning_revision_conflict");
        if (candidate.lessonRevisionId !== revisionId || candidate.mapRevisionId !== null) fail("learning_slot_mismatch");
        const content = LessonDraftSchema.parse(revision.content);
        const source = candidate.kind === "image" && candidate.sourceType === "scene"
          ? content.scenes.find((item) => item.id === candidate.sourceId)
          : candidate.kind === "audio" && candidate.sourceType === "section"
            ? content.sections.find((item) => item.id === candidate.sourceId)
            : undefined;
        if (!source || canonicalPayloadHash(source) !== candidate.sourceHash) fail("learning_slot_mismatch");
      } else {
        const map = await this.runtime.storage.models.LearningMap.findOne({
          where: { id: resourceId, profileId },
          transaction,
        });
        if (!map) fail("learning_not_found");
        if (map.activeRevisionId !== revisionId) fail("learning_revision_conflict");
        const revision = await this.runtime.storage.models.LearningMapRevision.findOne({
          where: { id: revisionId, mapId: resourceId, profileId },
          transaction,
        });
        if (!revision) fail("learning_not_found");
        if (revision.status !== "ready") fail("learning_revision_conflict");
        if (
          candidate.lessonRevisionId !== null
          || candidate.mapRevisionId !== revisionId
        ) fail("learning_slot_mismatch");
        const graph = MindmapGraphSchema.parse(revision.content);
        if (candidate.kind === "audio" && candidate.sourceType === "node") {
          const source = graph.nodes.find((item) => item.id === candidate.sourceId);
          if (!source || canonicalPayloadHash(source) !== candidate.sourceHash) fail("learning_slot_mismatch");
        } else if (candidate.kind === "image" && candidate.sourceType === "group") {
          const group = graph.studyGroups?.find((item) => item.id === candidate.sourceId);
          if (!group?.illustration || canonicalPayloadHash(mapGroupAssetSource(graph, group)) !== candidate.sourceHash) {
            fail("learning_slot_mismatch");
          }
        } else {
          fail("learning_slot_mismatch");
        }
      }
      return candidate.get({ plain: true });
    });

    const created = await this.runtime.application.jobs.create({
      resourceType: input.resourceType,
      resourceId,
      revisionId,
      requestKey: input.requestKey,
      stages: [{ key: `${slot.kind}.${slot.sourceId}`, kind: slot.kind, slotId: slot.id }],
    });
    const stage = created.stages.find((candidate) => candidate.slotId === slot.id && candidate.kind === slot.kind);
    if (!stage) fail("learning_request_conflict");
    if (stage.state !== "queued") return { jobId: created.job.id };

    const provider = stage.kind === "image" ? "codex" : "speech";
    let attempt;
    try {
      attempt = await this.runtime.application.jobs.startAttempt(stage.id, provider, NATIVE_LEASE_MS);
    } catch (error) {
      if (await this.stageClaimedAfterStartFailure(created.job.id, stage.id)) return { jobId: created.job.id };
      throw error;
    }
    const launched = await this.launchAssetAttempt(created.job, stage, attempt);
    void launched.completion.catch((): undefined => undefined);
    return { jobId: created.job.id };
  }

  async narrateMapNode(input: {
    mapId: string;
    revisionId: string;
    nodeId: string;
    requestKey: string;
  }): Promise<{ jobId: string | null; assetId: string | null }> {
    this.runtime.scope.assertOpen();
    const mapId = ServiceResourceIdSchema.parse(input.mapId);
    const revisionId = ServiceResourceIdSchema.parse(input.revisionId);
    const prepared = await this.runtime.storage.write(async (transaction) => {
      const profileId = this.runtime.scope.context.profileId;
      const map = await this.runtime.storage.models.LearningMap.findOne({
        where: { id: mapId, profileId },
        transaction,
      });
      if (!map) fail("learning_not_found");
      if (map.activeRevisionId !== revisionId) fail("learning_revision_conflict");
      const revision = await this.runtime.storage.models.LearningMapRevision.findOne({
        where: { id: revisionId, mapId, profileId },
        transaction,
      });
      if (!revision) fail("learning_not_found");
      if (revision.status !== "ready") fail("learning_revision_conflict");
      const graph = MindmapGraphSchema.parse(revision.content);
      const node = graph.nodes.find((candidate) => candidate.id === input.nodeId);
      if (!node) fail("learning_not_found");

      const slotKey = `${revisionId}:audio:${node.id}`;
      const sourceHash = canonicalPayloadHash(node);
      let slot = await this.runtime.storage.models.AssetSlot.findOne({
        where: { profileId, slotKey },
        transaction,
      });
      let createdSlot = false;
      if (slot) {
        if (
          slot.lessonRevisionId !== null
          || slot.mapRevisionId !== revisionId
          || slot.sourceType !== "node"
          || slot.sourceId !== node.id
          || slot.kind !== "audio"
          || slot.sourceHash !== sourceHash
        ) fail("learning_slot_mismatch");
      } else {
        slot = await this.runtime.storage.models.AssetSlot.create({
          id: randomUUID(),
          profileId,
          lessonRevisionId: null,
          mapRevisionId: revisionId,
          sourceType: "node",
          sourceId: node.id,
          kind: "audio",
          sourceHash,
          slotKey,
        }, { transaction });
        createdSlot = true;
      }
      return { slotId: slot.id, selectedAssetId: slot.selectedAssetId, createdSlot };
    });
    if (prepared.selectedAssetId) {
      return { jobId: null, assetId: prepared.selectedAssetId };
    }

    let created;
    try {
      created = await this.runtime.application.jobs.create({
        resourceType: "map",
        resourceId: mapId,
        revisionId,
        requestKey: input.requestKey,
        stages: [{ key: "audio", kind: "audio", slotId: prepared.slotId }],
      });
    } catch (error) {
      if (prepared.createdSlot) await this.removeUnusedMapNarrationSlot(prepared.slotId);
      throw error;
    }
    const stage = created.stages.find((candidate) => candidate.kind === "audio" && candidate.key === "audio");
    if (!stage) fail("learning_request_conflict");
    if (stage.state !== "queued") return { jobId: created.job.id, assetId: null };

    let attempt;
    try {
      attempt = await this.runtime.application.jobs.startAttempt(stage.id, "speech", NATIVE_LEASE_MS);
    } catch (error) {
      if (await this.stageClaimedAfterStartFailure(created.job.id, stage.id)) {
        return { jobId: created.job.id, assetId: null };
      }
      throw error;
    }
    const launched = await this.launchAssetAttempt(created.job, stage, attempt);
    void launched.completion.catch((): undefined => undefined);
    return { jobId: created.job.id, assetId: null };
  }

  private async removeUnusedMapNarrationSlot(slotId: string): Promise<void> {
    await this.runtime.storage.write(async (transaction) => {
      const profileId = this.runtime.scope.context.profileId;
      const slot = await this.runtime.storage.models.AssetSlot.findOne({
        where: { id: slotId, profileId, selectedAssetId: null },
        transaction,
      });
      if (!slot || slot.lessonRevisionId !== null || slot.mapRevisionId === null || slot.sourceType !== "node" || slot.kind !== "audio") {
        return;
      }
      const stageReferences = await this.runtime.storage.models.GenerationStage.count({
        where: { profileId, slotId },
        transaction,
      });
      const assetReferences = await this.runtime.storage.models.GeneratedAsset.count({
        where: { profileId, slotId },
        transaction,
      });
      if (stageReferences === 0 && assetReferences === 0) await slot.destroy({ transaction });
    });
  }

  async retry(input: {
    jobId: string;
    stageId: string;
    provider: LearningGenerationProvider;
    model?: string;
  }): Promise<{ jobId: string }> {
    this.runtime.scope.assertOpen();
    const state = await this.runtime.application.jobs.get(input.jobId);
    const stage = state.stages.find((candidate) => candidate.id === input.stageId);
    if (!stage) fail("learning_not_found");
    if (!["failed", "interrupted", "awaiting_retry", "cancelled"].includes(stage.state)) {
      fail("learning_stage_busy");
    }
    if (stage.activeAttemptId) {
      const previous = state.attempts.find((candidate) => candidate.id === stage.activeAttemptId);
      if (previous?.state === "running") fail("learning_stage_busy");
      try {
        await this.runtime.cancelAttempt(stage.activeAttemptId);
      } catch {
        fail("learning_cleanup_failed");
      }
    }

    let probe: NativeAgentProbe | undefined;
    let azureConfig: AzureLearningTextConfig | null = null;
    if (stage.kind === "text" || stage.kind === "map") {
      if (input.provider === "azure-openai") {
        azureConfig = await this.azureTextConfigFactory();
        if (!azureConfig) fail("azure_text_not_configured");
      } else {
        probe = await this.probe(input.provider).catch((): NativeAgentProbe => ({
          provider: input.provider as NativeAgentProvider,
          executable: null,
          version: null,
          authenticated: false,
          text: false,
          image: false,
          reason: "native_probe_failed",
        }));
        if (probe.provider !== input.provider) fail("native_probe_failed");
        if (!probe.text || !probe.executable) {
          fail(probe.reason && PUBLIC_ERROR_CODES.has(probe.reason) ? probe.reason : "native_unavailable");
        }
      }
    }

    const provider = stage.kind === "image"
      ? "codex"
      : stage.kind === "audio" ? "speech" : input.provider;
    const attempt = await this.runtime.application.jobs.retryAttempt(stage.id, provider, NATIVE_LEASE_MS);
    const launched = stage.kind === "text" || stage.kind === "map"
      ? input.provider === "azure-openai"
        ? await this.launchAzureTextAttempt(
            state.job,
            stage,
            attempt,
            { ...(azureConfig as AzureLearningTextConfig), ...(input.model ? { modelName: input.model } : {}) },
          )
        : await this.launchTextAttempt(state.job, stage, attempt, input.provider, probe as NativeAgentProbe & { executable: ExecutablePin }, input.model)
      : await this.launchAssetAttempt(state.job, stage, attempt);
    void launched.completion.then((outcome) => {
      if ((stage.kind === "text" || stage.kind === "map") && outcome !== "accepted") return;
      if (outcome === "accepted" || outcome === "failed") this.scheduleAssetDrain(state.job.id);
    }).catch((): undefined => undefined);
    return { jobId: state.job.id };
  }

  private async stageClaimedAfterStartFailure(jobId: string, stageId: string): Promise<boolean> {
    if (await this.runtime.application.jobs.failUnstartedStage(stageId)) return false;
    const current = await this.runtime.application.jobs.get(jobId);
    const stage = current.stages.find((candidate) => candidate.id === stageId);
    return Boolean(stage && stage.state !== "queued");
  }

  private launchTextAttempt(
    job: GenerationJobAttributes,
    stage: GenerationStageAttributes,
    attempt: StageAttemptAttributes,
    provider: NativeAgentProvider,
    probe: NativeAgentProbe & { executable: ExecutablePin },
    model?: string,
  ): Promise<{ completion: Promise<AttemptOutcome> }> {
    return this.launchTrackedAttempt(job.id, stage.id, attempt.id, async ({ directories, signal }) => {
      const mcp = await this.runtime.application.connectAttempt({
        jobId: job.id,
        stageId: stage.id,
        attemptId: attempt.id,
        revisionId: job.revisionId,
      });
      await this.adapters[provider].run({
        executable: probe.executable,
        workspace: directories.workspace,
        privateHome: directories.privateHome,
        model,
        prompt: generationPrompt(job.resourceType),
        mcp,
        timeoutMs: NATIVE_TIMEOUT_MS,
        signal,
      });
    });
  }

  private launchAzureTextAttempt(
    job: GenerationJobAttributes,
    stage: GenerationStageAttributes,
    attempt: StageAttemptAttributes,
    config: AzureLearningTextConfig,
  ): Promise<{ completion: Promise<AttemptOutcome> }> {
    return this.launchTrackedAttempt(
      job.id,
      stage.id,
      attempt.id,
      async ({ signal }) => {
        await this.azureTextRunner({
          application: this.runtime.application,
          identity: {
            jobId: job.id,
            stageId: stage.id,
            attemptId: attempt.id,
            revisionId: job.revisionId,
          },
          resourceType: job.resourceType,
          config,
          signal,
        });
      },
    );
  }

  private launchAssetAttempt(
    job: GenerationJobAttributes,
    stage: GenerationStageAttributes,
    attempt: StageAttemptAttributes,
  ): Promise<{ completion: Promise<AttemptOutcome> }> {
    return this.launchTrackedAttempt(job.id, stage.id, attempt.id, async ({ directories, signal }) => {
      const speechProvider: SpeechProvider | undefined = stage.kind === "audio"
        ? (await this.speechProviderFactory()) ?? undefined
        : undefined;
      await this.assetRunner({
        runtime: this.runtime,
        job,
        stage,
        attempt,
        workspace: directories.workspace,
        privateHome: directories.privateHome,
        signal,
        adapter: stage.kind === "image" ? this.imageAdapter : undefined,
        probe: this.imageProbe,
        speechProvider,
      });
    });
  }

  private async launchTrackedAttempt(
    jobId: string,
    stageId: string,
    attemptId: string,
    action: (context: AttemptActionContext) => Promise<void>,
  ): Promise<{ completion: Promise<AttemptOutcome> }> {
    const abortController = new AbortController();
    const runFinished = deferred();
    const nativeCleanup: RetryableCleanup = {};
    let directories: AttemptDirectories | undefined;
    try {
      this.runtime.trackAttempt(attemptId, async () => {
        abortController.abort();
        await runFinished.promise;
        await nativeCleanup.run?.();
        if (directories) await rm(directories.root, { recursive: true, force: true });
      });
    } catch (error) {
      runFinished.resolve();
      await this.runtime.application.jobs.failAttempt(attemptId, stableErrorCode(error), true)
        .catch((): undefined => undefined);
      throw error;
    }
    try {
      directories = await createAttemptDirectories(this.runtime, attemptId);
    } catch {
      runFinished.resolve();
      await this.runtime.cancelAttempt(attemptId).catch((): undefined => undefined);
      await this.runtime.application.jobs.failAttempt(attemptId, "native_workspace_failed", false)
        .catch((): undefined => undefined);
      fail("native_workspace_failed");
    }
    return {
      completion: this.executeTrackedAttempt({
        jobId,
        stageId,
        attemptId,
        directories,
        abortController,
        runFinished,
        nativeCleanup,
        action,
      }),
    };
  }

  private async executeTrackedAttempt(context: {
    jobId: string;
    stageId: string;
    attemptId: string;
    directories: AttemptDirectories;
    abortController: AbortController;
    runFinished: Deferred;
    nativeCleanup: RetryableCleanup;
    action: (context: AttemptActionContext) => Promise<void>;
  }): Promise<AttemptOutcome> {
    let failureCode: string | undefined;
    let cleanupVerified = false;
    try {
      await context.action({ directories: context.directories, signal: context.abortController.signal });
    } catch (error) {
      failureCode = stableErrorCode(error);
      context.nativeCleanup.run = retryableCleanup(error);
    } finally {
      context.runFinished.resolve();
      try {
        await this.runtime.cancelAttempt(context.attemptId);
        cleanupVerified = true;
      } catch {
        failureCode = "native_cleanup_failed";
      }
    }

    try {
      const state = await this.runtime.application.jobs.get(context.jobId);
      const stage = state.stages.find((candidate) => candidate.id === context.stageId);
      const attempt = state.attempts.find((candidate) => candidate.id === context.attemptId);
      if (stage?.state === "completed" && attempt?.state === "completed") {
        return cleanupVerified ? "accepted" : "cleanup_pending";
      }
      if (state.job.state === "cancelled" || stage?.state === "cancelled" || attempt?.state === "cancelled") {
        return "cancelled";
      }
      await this.runtime.application.jobs.failAttempt(
        context.attemptId,
        failureCode ?? "native_submission_missing",
        failureCode ? outcomeMayBeUnknown(failureCode) : false,
      );
      return cleanupVerified ? "failed" : "cleanup_pending";
    } catch {
      // Cancellation, profile shutdown, or a committed late result owns the terminal state.
      return cleanupVerified ? "cancelled" : "cleanup_pending";
    }
  }

  private scheduleAssetDrain(jobId: string): void {
    if (this.assetDrains.has(jobId)) return;
    const drain = this.drainQueuedAssets(jobId).finally(() => {
      if (this.assetDrains.get(jobId) === drain) this.assetDrains.delete(jobId);
    });
    this.assetDrains.set(jobId, drain);
    void drain.catch((): undefined => undefined);
  }

  private scheduleAssetDrainAfterCleanup(jobId: string, attemptId: string | null): void {
    if (!attemptId) {
      this.scheduleAssetDrain(jobId);
      return;
    }
    void this.runtime.cancelAttempt(attemptId).then(
      () => this.scheduleAssetDrain(jobId),
      (): undefined => undefined,
    );
  }

  private async drainQueuedAssets(jobId: string): Promise<void> {
    while (this.runtime.scope.state === "open") {
      const state = await this.runtime.application.jobs.get(jobId);
      if (state.job.state === "cancelled") return;
      if (state.stages.some((stage) => stage.state === "running")) return;
      const stage = state.stages.find((candidate) =>
        (candidate.kind === "image" || candidate.kind === "audio") && candidate.state === "queued");
      if (!stage) return;
      const provider = stage.kind === "image" ? "codex" : "speech";
      let launched: { completion: Promise<AttemptOutcome> };
      try {
        const attempt = await this.runtime.application.jobs.startAttempt(stage.id, provider, NATIVE_LEASE_MS);
        launched = await this.launchAssetAttempt(state.job, stage, attempt);
      } catch {
        if (this.runtime.scope.state !== "open") return;
        await this.runtime.application.jobs.failUnstartedStage(stage.id);
        const refreshed = await this.runtime.application.jobs.get(jobId);
        const failedStage = refreshed.stages.find((candidate) => candidate.id === stage.id);
        if (failedStage?.state !== "failed" || refreshed.stages.some((candidate) => candidate.state === "running")) return;
        continue;
      }
      const outcome = await launched.completion;
      if (outcome !== "accepted" && outcome !== "failed") return;
    }
  }
}
