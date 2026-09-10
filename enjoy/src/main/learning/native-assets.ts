import { randomUUID } from "node:crypto";
import type { Transaction } from "sequelize";

import {
  AudioAssetPayloadSchema,
  ImageAssetPayloadSchema,
  LessonDraftSchema,
  MindmapGraphSchema,
} from "../../lib/learning-schemas";
import type { AudioAssetPayload, ImageAssetPayload, LessonDraft, MindmapGraph, MindmapStudyGroup } from "../../types/learning";
import { CodexNativeAgent } from "../agents/codex-native";
import { probeNativeAgent } from "../agents/native-discovery";
import type { NativeAgentAdapter } from "../agents/native-types";
import type {
  GenerationJobAttributes,
  GenerationStageAttributes,
  StageAttemptAttributes,
} from "../db/learning-models";
import type { SpeechProvider } from "../speech/provider";
import type { LearningAssetMetadata } from "./asset-store";
import { canonicalPayloadHash } from "./candidate";
import type { LearningRuntime } from "./runtime";
import { synthesizeNarration } from "./narration-synthesis";
import { mapGroupAssetSource } from "./storage";

const IMAGE_TIMEOUT_MS = 600_000;

type NativeAssetStageInput = Readonly<{
  runtime: LearningRuntime;
  job: GenerationJobAttributes;
  stage: GenerationStageAttributes;
  attempt: StageAttemptAttributes;
  workspace: string;
  privateHome: string;
  signal: AbortSignal;
  adapter?: NativeAgentAdapter;
  probe?: typeof probeNativeAgent;
  speechProvider?: SpeechProvider;
}>;

type AssetSource = Readonly<{
  slotId: string;
  sourceId: string;
  sourceHash: string;
  sourceType: "scene" | "section" | "node" | "group";
  content?: LessonDraft;
  graph?: MindmapGraph;
  group?: MindmapStudyGroup;
  narrationText?: string;
}>;

const fail = (code: string): never => {
  throw Object.assign(new Error(code), { code });
};

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) fail("native_cancelled");
}

async function removeRejectedImport(runtime: LearningRuntime, imported: LearningAssetMetadata): Promise<void> {
  try {
    await runtime.assets.remove(imported.relativePath);
  } catch (cause) {
    throw Object.assign(new Error("learning_asset_cleanup_failed", { cause }), { code: "learning_asset_cleanup_failed" });
  }
}

async function readSource(input: NativeAssetStageInput): Promise<AssetSource> {
  assertNotAborted(input.signal);
  const source = await input.runtime.storage.write(async (transaction) => {
    assertNotAborted(input.signal);
    const profileId = input.runtime.scope.context.profileId;
    const job = await input.runtime.storage.models.GenerationJob.findOne({
      where: { id: input.job.id, profileId },
      transaction,
    });
    assertNotAborted(input.signal);
    const stage = await input.runtime.storage.models.GenerationStage.findOne({
      where: { id: input.stage.id, jobId: input.job.id, profileId },
      transaction,
    });
    assertNotAborted(input.signal);
    const attempt = await input.runtime.storage.models.StageAttempt.findOne({
      where: { id: input.attempt.id, stageId: input.stage.id, profileId },
      transaction,
    });
    assertNotAborted(input.signal);
    if (!job || !stage || !attempt) fail("learning_not_found");
    if (job.revisionId !== input.job.revisionId) fail("learning_candidate_scope_mismatch");
    if (job.state === "cancelled") fail("learning_job_cancelled");
    if (stage.kind !== input.stage.kind || stage.expectedRevisionId !== job.revisionId || !stage.slotId) fail("learning_candidate_scope_mismatch");
    if (stage.activeAttemptId !== attempt.id || stage.state !== "running" || attempt.state !== "running") fail("learning_attempt_stale");
    const lease = attempt.metadata as { leaseExpiresAt?: unknown; ownerConnectionId?: unknown };
    if (
      lease.ownerConnectionId !== input.runtime.scope.context.connectionId
      || typeof lease.leaseExpiresAt !== "number"
      || !Number.isFinite(lease.leaseExpiresAt)
      || lease.leaseExpiresAt <= Date.now()
    ) fail("learning_lease_expired");
    if (stage.kind !== "image" && stage.kind !== "audio") fail("learning_native_asset_required");

    if (job.resourceType === "map") {
      const map = await input.runtime.storage.models.LearningMap.findOne({
        where: { id: job.resourceId, profileId },
        transaction,
      });
      assertNotAborted(input.signal);
      if (!map || map.activeRevisionId !== job.revisionId) fail("learning_revision_conflict");
      const revision = await input.runtime.storage.models.LearningMapRevision.findOne({
        where: { id: job.revisionId, mapId: job.resourceId, profileId },
        transaction,
      });
      assertNotAborted(input.signal);
      if (!revision || revision.status !== "ready") fail("learning_revision_conflict");
      const graph = MindmapGraphSchema.parse(revision.content);
      const slot = await input.runtime.storage.models.AssetSlot.findOne({
        where: { id: stage.slotId, mapRevisionId: job.revisionId, profileId },
        transaction,
      });
      assertNotAborted(input.signal);
      if (!slot || slot.kind !== stage.kind || slot.lessonRevisionId !== null) {
        fail("learning_slot_mismatch");
      }
      if (stage.kind === "audio" && slot.sourceType === "node") {
        const node = graph.nodes.find((candidate) => candidate.id === slot.sourceId);
        if (!node || canonicalPayloadHash(node) !== slot.sourceHash) fail("learning_slot_mismatch");
        return {
          slotId: slot.id,
          sourceId: slot.sourceId,
          sourceHash: slot.sourceHash,
          sourceType: "node" as const,
          narrationText: `${node.term}. ${node.example}`,
        };
      }
      if (stage.kind === "image" && slot.sourceType === "group") {
        const group = graph.studyGroups?.find((candidate) => candidate.id === slot.sourceId);
        if (!group?.illustration || canonicalPayloadHash(mapGroupAssetSource(graph, group)) !== slot.sourceHash) {
          fail("learning_slot_mismatch");
        }
        return {
          slotId: slot.id,
          sourceId: slot.sourceId,
          sourceHash: slot.sourceHash,
          sourceType: "group" as const,
          graph,
          group,
        };
      }
      fail("learning_slot_mismatch");
    }
    if (job.resourceType !== "lesson") fail("learning_candidate_scope_mismatch");

    const lesson = await input.runtime.storage.models.LearningLesson.findOne({
      where: { id: job.resourceId, profileId },
      transaction,
    });
    assertNotAborted(input.signal);
    if (!lesson || lesson.activeRevisionId !== job.revisionId) fail("learning_revision_conflict");
    const revision = await input.runtime.storage.models.LessonRevision.findOne({
      where: { id: job.revisionId, lessonId: job.resourceId, profileId },
      transaction,
    });
    assertNotAborted(input.signal);
    if (!revision || revision.status !== "ready") fail("learning_revision_conflict");
    const content = LessonDraftSchema.parse(revision.content);
    const slot = await input.runtime.storage.models.AssetSlot.findOne({
      where: { id: stage.slotId, lessonRevisionId: job.revisionId, profileId },
      transaction,
    });
    assertNotAborted(input.signal);
    if (!slot || slot.kind !== stage.kind || slot.mapRevisionId !== null) fail("learning_slot_mismatch");
    if (stage.kind === "image" && slot.sourceType !== "scene") fail("learning_slot_mismatch");
    if (stage.kind === "audio" && slot.sourceType !== "section") fail("learning_slot_mismatch");
    if (slot.sourceType === "scene") {
      const scene = content.scenes.find((candidate) => candidate.id === slot.sourceId);
      if (!scene || canonicalPayloadHash(scene) !== slot.sourceHash) fail("learning_slot_mismatch");
      return { slotId: slot.id, sourceId: slot.sourceId, sourceHash: slot.sourceHash, sourceType: "scene" as const, content };
    }
    const section = content.sections.find((candidate) => candidate.id === slot.sourceId);
    if (!section || canonicalPayloadHash(section) !== slot.sourceHash) fail("learning_slot_mismatch");
    return {
      slotId: slot.id,
      sourceId: slot.sourceId,
      sourceHash: slot.sourceHash,
      sourceType: "section" as const,
      content,
      narrationText: section.text,
    };
  });
  assertNotAborted(input.signal);
  return source;
}

function imagePrompt(source: AssetSource): string {
  if (source.sourceType === "group") {
    if (!source.graph || !source.group?.illustration) return fail("learning_slot_mismatch");
    const groupSource = mapGroupAssetSource(source.graph, source.group);
    return [
      "Create exactly one polished contextual illustration for an English vocabulary study group.",
      "Return the image through the native image generation result. Do not write files or use other tools.",
      "Follow the requested scene, but do not add captions, labels, letters, IPA, translations, or watermarks.",
      `Illustration prompt: ${source.group.illustration.prompt}`,
      `Study group context: ${JSON.stringify(groupSource)}`,
    ].join("\n");
  }
  const scene = source.content?.scenes.find((candidate) => candidate.id === source.sourceId);
  if (!scene) return fail("learning_slot_mismatch");
  const referencedIds = new Set(scene.entityDescriptionIds ?? []);
  const entityDescriptions = source.content!.entityDescriptions.filter((entity) => referencedIds.has(entity.id));
  return [
    "Create exactly one polished illustration for this English learning lesson scene.",
    "Return the image through the native image generation result. Do not write files or use other tools.",
    "Keep recurring entities consistent with the authoritative descriptions. Do not add captions, labels, letters, or watermarks.",
    `Scene: ${JSON.stringify(scene)}`,
    `Entity descriptions: ${JSON.stringify(entityDescriptions)}`,
  ].join("\n");
}

async function publishAsset(
  input: NativeAssetStageInput,
  source: AssetSource,
  imported: LearningAssetMetadata,
  payload: ImageAssetPayload | AudioAssetPayload,
  provenance: Record<string, unknown>,
): Promise<void> {
  assertNotAborted(input.signal);
  await input.runtime.application.jobs.commit({
    schemaVersion: 1,
    kind: input.stage.kind,
    jobId: input.job.id,
    stageId: input.stage.id,
    attemptId: input.attempt.id,
    expectedRevisionId: input.job.revisionId,
    payload,
    payloadHash: canonicalPayloadHash(payload),
  }, async (_candidate, transaction: Transaction) => {
    assertNotAborted(input.signal);
    const profileId = input.runtime.scope.context.profileId;
    const slot = await input.runtime.storage.models.AssetSlot.findOne({
      where: { id: source.slotId, profileId },
      transaction,
    });
    assertNotAborted(input.signal);
    if (!slot || slot.sourceId !== source.sourceId || slot.sourceHash !== source.sourceHash || slot.kind !== imported.kind) {
      fail("learning_slot_mismatch");
    }
    await input.runtime.storage.models.GeneratedAsset.create({
      id: imported.id,
      profileId,
      slotId: slot.id,
      relativePath: imported.relativePath,
      kind: imported.kind,
      mimeType: imported.mimeType,
      sha256: imported.sha256,
      sizeBytes: imported.sizeBytes,
      width: imported.width,
      height: imported.height,
      durationMs: imported.durationMs,
      provenance,
    }, { transaction });
    assertNotAborted(input.signal);
    await slot.update({ selectedAssetId: imported.id }, { transaction });
    assertNotAborted(input.signal);
  });
}

async function runImageStage(input: NativeAssetStageInput, source: AssetSource): Promise<void> {
  const probe = await (input.probe ?? probeNativeAgent)("codex", { cwd: input.workspace });
  assertNotAborted(input.signal);
  if (!probe.image || !probe.executable) fail(probe.reason ?? "native_image_unavailable");
  const result = await (input.adapter ?? new CodexNativeAgent()).run({
    executable: probe.executable,
    workspace: input.workspace,
    privateHome: input.privateHome,
    prompt: imagePrompt(source),
    image: true,
    timeoutMs: IMAGE_TIMEOUT_MS,
    signal: input.signal,
  });
  assertNotAborted(input.signal);
  if (result.provider !== "codex" || result.images.length !== 1) fail("native_image_invalid");
  const image = result.images[0];
  const imported = await input.runtime.assets.importBytes({ id: randomUUID(), kind: "image", bytes: image.bytes });
  try {
    assertNotAborted(input.signal);
    if (imported.mimeType !== image.mimeType || imported.width === null || imported.height === null) fail("native_image_invalid");
    const payload = ImageAssetPayloadSchema.parse({
      assetId: imported.id,
      slotId: source.slotId,
      sourceId: source.sourceId,
      sourceHash: source.sourceHash,
      relativePath: imported.relativePath,
      sha256: imported.sha256,
      sizeBytes: imported.sizeBytes,
      mimeType: imported.mimeType,
      width: imported.width,
      height: imported.height,
    });
    await publishAsset(input, source, imported, payload, {
      provider: "codex",
      channel: "native",
      providerItemId: image.providerItemId,
      model: result.model,
      jobId: input.job.id,
      stageId: input.stage.id,
      attemptId: input.attempt.id,
    });
  } catch (error) {
    await removeRejectedImport(input.runtime, imported);
    throw error;
  }
}

async function runAudioStage(input: NativeAssetStageInput, source: AssetSource): Promise<void> {
  if (!input.speechProvider) fail("speech_not_configured");
  if (!source.narrationText) fail("learning_slot_mismatch");
  assertNotAborted(input.signal);
  const result = await synthesizeNarration({ provider: input.speechProvider, text: source.narrationText, privateHome: input.privateHome, signal: input.signal });
  assertNotAborted(input.signal);
  const imported = await input.runtime.assets.importBytes({ id: randomUUID(), kind: "audio", bytes: result.bytes });
  try {
    assertNotAborted(input.signal);
    if (imported.mimeType !== result.mimeType || imported.durationMs === null) fail("invalid_audio");
    const payload = AudioAssetPayloadSchema.parse({
      assetId: imported.id,
      slotId: source.slotId,
      sourceId: source.sourceId,
      sourceHash: source.sourceHash,
      relativePath: imported.relativePath,
      sha256: imported.sha256,
      sizeBytes: imported.sizeBytes,
      mimeType: imported.mimeType,
      durationMs: imported.durationMs,
      sourceType: source.sourceType,
    });
    await publishAsset(input, source, imported, payload, {
      provider: input.speechProvider.id,
      channel: "speech",
      engine: result.engine,
      model: result.model,
      voice: result.voice,
      jobId: input.job.id,
      stageId: input.stage.id,
      attemptId: input.attempt.id,
    });
  } catch (error) {
    await removeRejectedImport(input.runtime, imported);
    throw error;
  }
}

/** Produces and atomically publishes one image or narration stage. */
export async function runNativeAssetStage(input: NativeAssetStageInput): Promise<void> {
  assertNotAborted(input.signal);
  input.runtime.scope.assertOpen();
  const source = await readSource(input);
  assertNotAborted(input.signal);
  if (input.stage.kind === "image") return runImageStage(input, source);
  if (input.stage.kind === "audio") return runAudioStage(input, source);
  fail("learning_native_asset_required");
}
