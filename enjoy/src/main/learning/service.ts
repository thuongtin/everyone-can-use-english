import { randomUUID } from "node:crypto";
import { getCefrRubric } from "../../lib/cefr-rubrics";
import type { Transaction } from "sequelize";
import type { StageCandidateEnvelope, LessonBrief, LessonDraft, MapBrief, MindmapGraph } from "../../types/learning";
import { LessonBriefSchema, MapBriefSchema, StageCandidateEnvelopeSchema, validateGeneratedMindmapGraph } from "../../lib/learning-schemas";
import { evaluateLessonDraft } from "../../lib/learning-validator";
import { LearningCapabilityRegistry, type LearningCapabilityGrant, type LearningCapabilityIdentity } from "./capability-registry";
import { canonicalPayloadHash } from "./candidate";
import { LearningJobs, type LearningJobStorage } from "./job-runner";
import { createLearningMcpServer, type LearningMcpServer } from "./mcp-server";
import type { LearningMcpApplication } from "./tool-registry";
import { mapGroupAssetSource } from "./storage";

const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
type AttemptIdentity = Pick<LearningCapabilityIdentity, "jobId" | "stageId" | "attemptId" | "revisionId">;
export type TrustedLearningAttemptIdentity = AttemptIdentity;
const MAX_INVALID_SUBMISSIONS = 3;

/** The application boundary shared by trusted main-process commands and scoped MCP tools. */
export class LearningApplication implements LearningMcpApplication {
  readonly jobs: LearningJobs;
  private readonly capabilities = new LearningCapabilityRegistry();
  private readonly activeConnections = new Set<string>();
  private readonly claimedAttempts = new Set<string>();
  private readonly releasedAttempts = new Set<string>();
  private server: Promise<LearningMcpServer> | undefined;
  private readonly closingServers = new Set<Promise<void>>();
  private closePromise: Promise<void> | undefined;
  private closed = false;
  private readonly unregisterCancellation: () => void;

  constructor(readonly storage: LearningJobStorage) {
    this.jobs = new LearningJobs(storage);
    this.unregisterCancellation = storage.scope.registerCancellation(() => this.close());
  }

  private get models() { return this.storage.models; }
  private get profileId() { return this.storage.scope.context.profileId; }

  /** Returned values stay in Electron main and private native transport configuration. */
  async connectAttempt(identity: AttemptIdentity): Promise<{ url: string; token: string }> {
    this.storage.scope.assertOpen();
    if (this.closed) fail("learning_service_closed");
    if (this.releasedAttempts.has(identity.attemptId)) fail("learning_attempt_released");
    if (this.claimedAttempts.has(identity.attemptId)) fail("learning_attempt_connection_exists");
    this.claimedAttempts.add(identity.attemptId);
    const scopeIdentity = { ...identity, profileId: this.profileId, connectionId: this.storage.scope.context.connectionId };
    const state = await this.storage.scope.run(() => this.readActiveAttempt(scopeIdentity));
    if (this.releasedAttempts.has(identity.attemptId)) fail("learning_attempt_released");
    const tools = ["enjoy.get_job_context", "enjoy.get_job_status"];
    if (state.job.resourceType === "lesson") tools.push("enjoy.get_lesson_revision");
    if (state.stage.kind === "text") tools.push("enjoy.submit_lesson_draft");
    else if (state.stage.kind === "map") tools.push("enjoy.submit_mindmap");
    else if (state.stage.kind === "exercises") tools.push("enjoy.submit_exercises");
    this.capabilities.revoke({ attemptId: identity.attemptId });
    const token = this.capabilities.issue({ ...scopeIdentity, tools });
    this.activeConnections.add(identity.attemptId);
    try {
      if (!this.server) {
        this.server = createLearningMcpServer({ capabilities: this.capabilities, application: this });
      }
      const server = await this.server;
      this.storage.scope.assertOpen();
      if (this.closed) fail("learning_service_closed");
      if (this.releasedAttempts.has(identity.attemptId)) fail("learning_attempt_released");
      return { url: server.url, token };
    } catch (error) {
      this.capabilities.revoke({ attemptId: identity.attemptId });
      this.activeConnections.delete(identity.attemptId);
      throw error;
    }
  }

  /** Called by the host after the provider turn has exited, outside its MCP request. */
  async releaseAttempt(attemptId: string): Promise<void> {
    this.releasedAttempts.add(attemptId);
    this.capabilities.revoke({ attemptId });
    this.activeConnections.delete(attemptId);
    if (this.activeConnections.size === 0 && this.server) {
      const server = this.server;
      this.server = undefined;
      await this.closeServer(server);
    }
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.capabilities.revokeAll();
    this.activeConnections.clear();
    const server = this.server;
    this.server = undefined;
    this.closePromise = (async () => {
      if (server) await this.closeServer(server);
      await Promise.all([...this.closingServers]);
      this.unregisterCancellation();
    })();
    return this.closePromise;
  }

  private async closeServer(server: Promise<LearningMcpServer>): Promise<void> {
    const operation = server.then((running) => running.close());
    this.closingServers.add(operation);
    try { await operation; } finally { this.closingServers.delete(operation); }
  }

  async getJobContext(grant: LearningCapabilityGrant): Promise<unknown> {
    this.assertGrant(grant);
    return this.storage.scope.run(async () => {
      const { job, stage } = await this.readActiveAttempt(grant);
      const base = { jobId: job.id, stageId: stage.id, attemptId: grant.attemptId, revisionId: job.revisionId, kind: stage.kind };
      if (job.resourceType === "lesson") {
        const revision = await this.models.LessonRevision.findOne({ where: { id: job.revisionId, lessonId: job.resourceId, profileId: this.profileId } });
        if (!revision) return fail("learning_not_found");
        const brief = LessonBriefSchema.parse(revision.brief);
        let source: unknown = null;
        if (stage.slotId) {
          const slot = await this.models.AssetSlot.findOne({ where: { id: stage.slotId, profileId: this.profileId, lessonRevisionId: job.revisionId } });
          if (!slot) return fail("learning_slot_mismatch");
          const content = revision.content as LessonDraft | null;
          source = slot.sourceType === "scene" ? content?.scenes.find((scene) => scene.id === slot.sourceId) : content?.sections.find((section) => section.id === slot.sourceId);
        }
        return { ...base, brief, source, rubric: getCefrRubric(brief.level, brief.length) };
      }
      const map = await this.models.LearningMap.findOne({ where: { id: job.resourceId, profileId: this.profileId } });
      if (!map) return fail("learning_not_found");
      const revision = await this.models.LearningMapRevision.findOne({ where: { id: job.revisionId, mapId: map.id, profileId: this.profileId } });
      if (!revision) return fail("learning_not_found");
      const brief = MapBriefSchema.parse(revision.brief);
      const linkedRevision = map.lessonRevisionId
        ? await this.models.LessonRevision.findOne({ where: { id: map.lessonRevisionId, profileId: this.profileId } })
        : null;
      return {
        ...base,
        title: map.title,
        brief,
        graph: revision.content,
        rubric: getCefrRubric(brief.level, "short"),
        lesson: linkedRevision ? { revisionId: linkedRevision.id, brief: linkedRevision.brief, content: linkedRevision.content } : null,
      };
    });
  }

  /** Main-process providers use the same scoped read boundary without an MCP bearer. */
  async getTrustedJobContext(identity: TrustedLearningAttemptIdentity): Promise<unknown> {
    return this.getJobContext(this.trustedGrant(identity));
  }

  /** Main-process providers still pass through the canonical candidate validator and commit path. */
  async submitTrustedCandidate(
    identity: TrustedLearningAttemptIdentity,
    kind: "text" | "map",
    payload: unknown,
  ): Promise<unknown> {
    const grant = this.trustedGrant(identity);
    return this.submitCandidate(grant, StageCandidateEnvelopeSchema.parse({
      kind,
      schemaVersion: 1,
      jobId: identity.jobId,
      stageId: identity.stageId,
      attemptId: identity.attemptId,
      expectedRevisionId: identity.revisionId,
      payloadHash: canonicalPayloadHash(payload),
      payload,
    }));
  }

  async getLessonRevision(grant: LearningCapabilityGrant): Promise<unknown> {
    this.assertGrant(grant);
    return this.storage.scope.run(async () => {
      const { job } = await this.readActiveAttempt(grant);
      if (job.resourceType !== "lesson") return fail("learning_not_found");
      const revision = await this.models.LessonRevision.findOne({ where: { id: job.revisionId, lessonId: job.resourceId, profileId: this.profileId } });
      if (!revision) return fail("learning_not_found");
      return { id: revision.id, number: revision.number, brief: revision.brief, content: revision.content, status: revision.status };
    });
  }

  async getJobStatus(grant: LearningCapabilityGrant): Promise<unknown> {
    this.assertGrant(grant);
    const { job, stages } = await this.jobs.get(grant.jobId);
    if (job.revisionId !== grant.revisionId || !stages.some((stage) => stage.id === grant.stageId && stage.activeAttemptId === grant.attemptId)) return fail("learning_attempt_stale");
    return { jobId: job.id, state: job.state, stages: stages.map((stage) => ({ id: stage.id, kind: stage.kind, state: stage.state })) };
  }

  async submitCandidate(grant: LearningCapabilityGrant, input: StageCandidateEnvelope): Promise<unknown> {
    this.assertGrant(grant);
    const candidate = StageCandidateEnvelopeSchema.parse(input);
    if (candidate.jobId !== grant.jobId || candidate.stageId !== grant.stageId || candidate.attemptId !== grant.attemptId || candidate.expectedRevisionId !== grant.revisionId) fail("learning_candidate_scope_mismatch");
    if (candidate.kind === "image" || candidate.kind === "audio") fail("learning_native_asset_required");
    if (canonicalPayloadHash(candidate.payload) !== candidate.payloadHash) fail("learning_payload_hash_mismatch");

    // Validation may persist a rejected draft, but cannot advance a stage or publish assets.
    const validation = await this.storage.write(async (transaction) => {
      const { job, stage, attempt } = await this.readActiveAttempt(grant, transaction);
      if (stage.kind !== candidate.kind) return fail("learning_candidate_scope_mismatch");
      const metadata = attempt.metadata as { invalidSubmissions?: number };
      if (Number(metadata.invalidSubmissions ?? 0) >= MAX_INVALID_SUBMISSIONS) return fail("learning_validation_exhausted");
      if (candidate.kind === "map") {
        if (job.resourceType !== "map") return fail("learning_candidate_scope_mismatch");
        const revision = await this.models.LearningMapRevision.findOne({
          where: { id: job.revisionId, mapId: job.resourceId, profileId: this.profileId },
          transaction,
        });
        if (!revision) return fail("learning_not_found");
        if (revision.status === "ready") return fail("learning_revision_immutable");
        const checked = validateGeneratedMindmapGraph(candidate.payload, revision.brief);
        if (!checked.ok) {
          await attempt.update({ metadata: { ...metadata, invalidSubmissions: Number(metadata.invalidSubmissions ?? 0) + 1 } }, { transaction });
          await this.models.LearningMapRevision.update({ content: candidate.payload, provenance: { provider: attempt.provider, attemptId: attempt.id, outcome: "invalid", issues: checked.issues } }, { where: { id: job.revisionId, mapId: job.resourceId, profileId: this.profileId, status: "draft" }, transaction });
        }
        return { ok: checked.ok, issues: checked.issues, warnings: [] };
      }
      if (job.resourceType !== "lesson") return fail("learning_candidate_scope_mismatch");
      if (candidate.kind !== "text" && candidate.kind !== "exercises") return fail("learning_native_asset_required");
      const revision = await this.models.LessonRevision.findOne({ where: { id: job.revisionId, lessonId: job.resourceId, profileId: this.profileId }, transaction });
      if (!revision) return fail("learning_not_found");
      if (revision.status === "ready") return fail("learning_revision_immutable");
      const payload = candidate.kind === "text" ? candidate.payload : { ...(revision.content as LessonDraft), exercises: candidate.payload.exercises };
      const checked = evaluateLessonDraft(payload, revision.brief);
      if (!checked.ok) {
        const invalidSubmissions = Number(metadata.invalidSubmissions ?? 0) + 1;
        await attempt.update({ metadata: { ...metadata, invalidSubmissions } }, { transaction });
        await revision.update({ content: payload, validation: checked.issues, provenance: { provider: attempt.provider, attemptId: attempt.id, outcome: "invalid" } }, { transaction });
      }
      return { ok: checked.ok, issues: checked.issues, warnings: checked.warnings };
    });
    if (!validation.ok) return { accepted: false, issues: validation.issues };

    await this.jobs.commit(candidate, async (accepted, transaction) => {
      const { job, attempt } = await this.readActiveAttempt(grant, transaction);
      const provenance = { provider: attempt.provider, jobId: job.id, attemptId: attempt.id, payloadHash: accepted.payloadHash, createdAt: new Date().toISOString() };
      if (accepted.kind === "map") {
        const revision = await this.models.LearningMapRevision.findOne({ where: { id: job.revisionId, profileId: this.profileId, mapId: job.resourceId }, transaction });
        if (!revision || revision.status === "ready") return fail("learning_revision_immutable");
        // Model assertions do not become independent dictionary verification.
        const content = { ...accepted.payload, nodes: accepted.payload.nodes.map((node) => ({ ...node, evidence: { status: "unverified" as const } })), edges: accepted.payload.edges.map((edge) => ({ ...edge, evidence: { status: "unverified" as const } })) };
        await revision.update({ content, status: "ready", provenance }, { transaction });
        await this.createMapAssetStages(
          job.id,
          revision.id,
          MapBriefSchema.parse(revision.brief),
          content,
          transaction,
        );
      } else if (accepted.kind === "text" || accepted.kind === "exercises") {
        const revision = await this.models.LessonRevision.findOne({ where: { id: job.revisionId, lessonId: job.resourceId, profileId: this.profileId }, transaction });
        if (!revision || revision.status === "ready") return fail("learning_revision_immutable");
        const content = accepted.kind === "text" ? accepted.payload : { ...(revision.content as LessonDraft), exercises: accepted.payload.exercises };
        await revision.update({ content, status: "ready", validation: validation.warnings, provenance, sourceHash: canonicalPayloadHash(content) }, { transaction });
        await this.models.LearningLesson.update({ title: content.title }, { where: { id: job.resourceId, profileId: this.profileId }, transaction });
        await this.createLessonAssetStages(job.id, revision.id, LessonBriefSchema.parse(revision.brief), content, transaction);
      } else fail("learning_native_asset_required");
    });
    // The host releases the socket only after this tool response and the native turn finish.
    this.capabilities.revoke({ attemptId: grant.attemptId });
    return { accepted: true, revisionId: grant.revisionId, warnings: validation.warnings };
  }

  private assertGrant(grant: LearningCapabilityIdentity) {
    this.storage.scope.assertOpen();
    const { profileId, connectionId } = this.storage.scope.context;
    if (grant.profileId !== profileId || grant.connectionId !== connectionId) fail("capability_denied");
    if (this.closed) fail("learning_service_closed");
  }

  private trustedGrant(identity: TrustedLearningAttemptIdentity): LearningCapabilityGrant {
    return {
      ...identity,
      profileId: this.profileId,
      connectionId: this.storage.scope.context.connectionId,
      tools: [],
      expiresAt: Date.now(),
    };
  }

  private async readActiveAttempt(identity: LearningCapabilityIdentity, transaction?: Transaction) {
    this.assertGrant(identity);
    const job = await this.models.GenerationJob.findOne({ where: { id: identity.jobId, revisionId: identity.revisionId, profileId: this.profileId }, transaction });
    const stage = await this.models.GenerationStage.findOne({ where: { id: identity.stageId, jobId: identity.jobId, expectedRevisionId: identity.revisionId, activeAttemptId: identity.attemptId, profileId: this.profileId }, transaction });
    const attempt = await this.models.StageAttempt.findOne({ where: { id: identity.attemptId, stageId: identity.stageId, profileId: this.profileId }, transaction });
    if (!job || !stage || !attempt) return fail("learning_not_found");
    if (job.state === "cancelled") fail("learning_job_cancelled");
    if (stage.state !== "running" || attempt.state !== "running") fail("learning_attempt_stale");
    const lease = attempt.metadata as { leaseExpiresAt?: number; ownerConnectionId?: string };
    if (lease.ownerConnectionId !== this.storage.scope.context.connectionId || !Number.isFinite(lease.leaseExpiresAt) || lease.leaseExpiresAt <= Date.now()) fail("learning_lease_expired");
    const resource = job.resourceType === "lesson"
      ? await this.models.LearningLesson.findOne({ where: { id: job.resourceId, profileId: this.profileId }, transaction })
      : await this.models.LearningMap.findOne({ where: { id: job.resourceId, profileId: this.profileId }, transaction });
    if (!resource || resource.activeRevisionId !== identity.revisionId) fail("learning_revision_conflict");
    return { job, stage, attempt };
  }

  private async createLessonAssetStages(jobId: string, revisionId: string, brief: LessonBrief, content: LessonDraft, transaction: Transaction) {
    const sources = [
      ...content.scenes.map((scene) => ({ sourceType: "scene" as const, kind: "image" as const, source: scene })),
      ...(brief.audio ? content.sections.map((section) => ({ sourceType: "section" as const, kind: "audio" as const, source: section })) : []),
    ];
    for (const { sourceType, kind, source } of sources) {
      const slot = await this.models.AssetSlot.create({ id: randomUUID(), profileId: this.profileId, lessonRevisionId: revisionId, mapRevisionId: null, sourceType, sourceId: source.id, kind, sourceHash: canonicalPayloadHash(source), slotKey: `${revisionId}:${kind}:${source.id}` }, { transaction });
      await this.models.GenerationStage.create({ profileId: this.profileId, jobId, key: `${kind}.${source.id}`, kind, slotId: slot.id, state: "queued", expectedRevisionId: revisionId }, { transaction });
    }
  }

  private async createMapAssetStages(
    jobId: string,
    revisionId: string,
    brief: MapBrief,
    content: MindmapGraph,
    transaction: Transaction,
  ) {
    if (!brief.illustrations) return;
    for (const group of content.studyGroups ?? []) {
      if (!group.illustration) continue;
      const sourceHash = canonicalPayloadHash(mapGroupAssetSource(content, group));
      const slot = await this.models.AssetSlot.create({
        id: randomUUID(),
        profileId: this.profileId,
        lessonRevisionId: null,
        mapRevisionId: revisionId,
        sourceType: "group",
        sourceId: group.id,
        kind: "image",
        sourceHash,
        slotKey: `${revisionId}:image:${group.id}`,
      }, { transaction });
      await this.models.GenerationStage.create({
        profileId: this.profileId,
        jobId,
        key: `image.${group.id}`,
        kind: "image",
        slotId: slot.id,
        state: "queued",
        expectedRevisionId: revisionId,
      }, { transaction });
    }
  }
}
