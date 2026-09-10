import { randomUUID } from "node:crypto";
import { Op, type Transaction } from "sequelize";
import type { LearningModels, GenerationJobAttributes, GenerationStageAttributes } from "../db/learning-models";
import type { GenerationKind, StageCandidateEnvelope } from "../../types/learning";
import { ServiceResourceIdSchema, StageCandidateEnvelopeSchema } from "../../lib/learning-schemas";
import { canonicalPayloadHash } from "./candidate";
import type { LearningProfileScope } from "./profile-scope";

export interface LearningJobStorage {
  readonly models: LearningModels;
  readonly scope: LearningProfileScope;
  write<T>(action: (transaction: Transaction) => Promise<T>): Promise<T>;
}

const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
const activeJobStates = ["queued", "running", "partial", "interrupted"];
const retryableStates = ["queued", "failed", "interrupted", "awaiting_retry"];
const id = (value: string) => ServiceResourceIdSchema.parse(value);

/** Persists leases and terminal states; provider calls live outside database transactions. */
export class LearningJobs {
  constructor(private readonly storage: LearningJobStorage, private readonly now: () => number = Date.now) {}
  private get models() { return this.storage.models; }
  private get profileId() { return this.storage.scope.context.profileId; }

  async create(input: {
    resourceType: "lesson" | "map";
    resourceId: string;
    revisionId: string;
    requestKey: string;
    stages: { key: string; kind: GenerationKind; slotId?: string }[];
  }) {
    id(input.resourceId); id(input.revisionId);
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(input.requestKey) || input.stages.length < 1 || input.stages.length > 64 ||
      new Set(input.stages.map((stage) => stage.key)).size !== input.stages.length ||
      input.stages.some((stage) => !/^[A-Za-z0-9._-]{1,128}$/.test(stage.key))) fail("learning_job_invalid");
    return this.storage.write(async (transaction) => {
      const where = { profileId: this.profileId, resourceType: input.resourceType, resourceId: input.resourceId };
      const existing = await this.models.GenerationJob.findOne({ where: { ...where, requestKey: input.requestKey }, transaction });
      if (existing) {
        if (existing.revisionId !== input.revisionId) fail("learning_request_conflict");
        const stages = (await this.models.GenerationStage.findAll({ where: { profileId: this.profileId, jobId: existing.id }, transaction })).map((stage) => stage.get({ plain: true }));
        const metadata = existing.metadata as { requestedStages?: { key: string; kind: GenerationKind; slotId: string | null }[] };
        const requestedStages = metadata.requestedStages ?? stages;
        if (requestedStages.length !== input.stages.length || input.stages.some((requested) => !requestedStages.some((stage) => stage.key === requested.key && stage.kind === requested.kind && stage.slotId === (requested.slotId ?? null)))) fail("learning_request_conflict");
        return { job: existing.get({ plain: true }), stages };
      }
      await this.assertRevision(input, transaction);
      if (await this.models.GenerationJob.findOne({ where: { ...where, state: { [Op.in]: activeJobStates } }, transaction })) fail("learning_resource_busy");
      const job = await this.models.GenerationJob.create({ id: randomUUID(), profileId: this.profileId, resourceType: input.resourceType, resourceId: input.resourceId, revisionId: input.revisionId, requestKey: input.requestKey, state: "queued", metadata: { requestedStages: input.stages.map((stage) => ({ key: stage.key, kind: stage.kind, slotId: stage.slotId ?? null })) } }, { transaction });
      const stages: GenerationStageAttributes[] = [];
      for (const stage of input.stages) {
        if ((stage.kind === "image" || stage.kind === "audio") !== Boolean(stage.slotId)) fail("learning_slot_required");
        if (stage.slotId) {
          const slot = await this.models.AssetSlot.findOne({ where: { id: id(stage.slotId), profileId: this.profileId }, transaction });
          if (!slot || slot.kind !== stage.kind || (slot.lessonRevisionId ?? slot.mapRevisionId) !== input.revisionId) fail("learning_slot_mismatch");
        }
        const row = await this.models.GenerationStage.create({ profileId: this.profileId, jobId: job.id, key: stage.key, kind: stage.kind, slotId: stage.slotId ?? null, state: "queued", expectedRevisionId: input.revisionId }, { transaction });
        stages.push(row.get({ plain: true }));
      }
      return { job: job.get({ plain: true }), stages };
    });
  }

  async get(jobId: string) {
    return this.storage.write(async (transaction) => {
      const job = await this.models.GenerationJob.findOne({ where: { id: id(jobId), profileId: this.profileId }, transaction });
      if (!job) return fail("learning_not_found");
      const stages = await this.models.GenerationStage.findAll({ where: { jobId, profileId: this.profileId }, order: [["createdAt", "ASC"], ["key", "ASC"]], transaction });
      const attempts = await this.models.StageAttempt.findAll({ where: { profileId: this.profileId, stageId: { [Op.in]: stages.map((stage) => stage.id) } }, order: [["ordinal", "ASC"]], transaction });
      return { job: job.get({ plain: true }), stages: stages.map((stage) => stage.get({ plain: true })), attempts: attempts.map((attempt) => attempt.get({ plain: true })) };
    });
  }

  async startAttempt(stageId: string, provider: string, leaseMs = 120_000) {
    return this.beginAttempt(stageId, provider, false, leaseMs);
  }

  /** Fails a stage only when provider execution was never claimed by any attempt. */
  async failUnstartedStage(stageId: string): Promise<boolean> {
    return this.storage.write(async (transaction) => {
      const { stage, job } = await this.lookupStage(stageId, transaction);
      if (stage.state !== "queued" || stage.activeAttemptId !== null) return false;
      const attempts = await this.models.StageAttempt.count({
        where: { profileId: this.profileId, stageId: stage.id },
        transaction,
      });
      if (attempts !== 0) return false;
      await stage.update({ state: "failed" }, { transaction });
      const completed = await this.models.GenerationStage.count({
        where: { profileId: this.profileId, jobId: job.id, state: "completed" },
        transaction,
      });
      await job.update({ state: completed ? "partial" : "failed" }, { transaction });
      return true;
    });
  }

  /** Called only for an explicit retry action; cancellation never triggers it automatically. */
  async retryAttempt(stageId: string, provider: string, leaseMs = 120_000) {
    return this.beginAttempt(stageId, provider, true, leaseMs);
  }

  private async beginAttempt(stageId: string, provider: string, explicitRetry: boolean, leaseMs: number) {
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(provider)) fail("learning_provider_invalid");
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 900_000) fail("learning_lease_invalid");
    return this.storage.write(async (transaction) => {
      const { stage, job } = await this.lookupStage(stageId, transaction);
      if (job.state === "cancelled" && !explicitRetry) fail("learning_job_cancelled");
      if (!retryableStates.includes(stage.state) && !(explicitRetry && stage.state === "cancelled")) fail("learning_stage_busy");
      await this.assertRevision(job, transaction);
      if (await this.models.GenerationJob.findOne({ where: { profileId: this.profileId, resourceType: job.resourceType, resourceId: job.resourceId, id: { [Op.ne]: job.id }, state: { [Op.in]: activeJobStates } }, transaction })) fail("learning_resource_busy");
      if (await this.models.GenerationStage.findOne({ where: { profileId: this.profileId, jobId: job.id, state: { [Op.in]: ["running", "cancelling", "reconciling"] } }, transaction })) fail("learning_stage_busy");
      const maximum = await this.models.StageAttempt.max("ordinal", { where: { profileId: this.profileId, stageId }, transaction });
      const attempt = await this.models.StageAttempt.create({ profileId: this.profileId, stageId, ordinal: Number(maximum || 0) + 1, state: "running", provider, startedAt: new Date(this.now()), metadata: { leaseExpiresAt: this.now() + leaseMs, ownerConnectionId: this.storage.scope.context.connectionId } }, { transaction });
      await stage.update({ state: "running", activeAttemptId: attempt.id }, { transaction });
      await job.update({ state: "running" }, { transaction });
      return attempt.get({ plain: true });
    });
  }

  async commit(input: unknown, publish: (candidate: StageCandidateEnvelope, transaction: Transaction) => Promise<void>) {
    const candidate = StageCandidateEnvelopeSchema.parse(input);
    if (canonicalPayloadHash(candidate.payload) !== candidate.payloadHash) fail("learning_payload_hash_mismatch");
    return this.storage.write(async (transaction) => {
      const { stage, job } = await this.lookupStage(candidate.stageId, transaction);
      if (stage.jobId !== candidate.jobId || stage.kind !== candidate.kind || stage.expectedRevisionId !== candidate.expectedRevisionId) fail("learning_candidate_scope_mismatch");
      if (stage.activeAttemptId !== candidate.attemptId) fail("learning_attempt_stale");
      if (job.state === "cancelled") fail("learning_job_cancelled");
      if (stage.state === "completed") {
        if (stage.committedHash !== candidate.payloadHash) fail("learning_candidate_conflict");
        return { duplicate: true };
      }
      if (stage.state !== "running") fail("learning_attempt_stale");
      const attempt = await this.models.StageAttempt.findOne({ where: { id: candidate.attemptId, stageId: stage.id, profileId: this.profileId }, transaction });
      if (!attempt || attempt.state !== "running") return fail("learning_attempt_stale");
      const lease = attempt.metadata as { leaseExpiresAt?: number; ownerConnectionId?: string };
      if (lease.ownerConnectionId !== this.storage.scope.context.connectionId || !Number.isFinite(lease.leaseExpiresAt) || lease.leaseExpiresAt <= this.now()) fail("learning_lease_expired");
      await this.assertRevision(job, transaction);
      await publish(candidate, transaction);
      await stage.update({ state: "completed", committedHash: candidate.payloadHash }, { transaction });
      await attempt.update({ state: "completed", finishedAt: new Date() }, { transaction });
      const pending = await this.models.GenerationStage.count({ where: { profileId: this.profileId, jobId: job.id, state: { [Op.ne]: "completed" } }, transaction });
      await job.update({ state: pending ? "partial" : "completed" }, { transaction });
      return { duplicate: false };
    });
  }

  async failAttempt(attemptId: string, errorCode: string, outcomeUnknown = false) {
    if (!/^[a-z0-9_]{1,80}$/.test(errorCode)) fail("learning_error_code_invalid");
    return this.storage.write(async (transaction) => {
      const attempt = await this.models.StageAttempt.findOne({ where: { id: id(attemptId), profileId: this.profileId }, transaction });
      if (!attempt) return fail("learning_not_found");
      const { stage, job } = await this.lookupStage(attempt.stageId, transaction);
      if (stage.activeAttemptId !== attemptId || stage.state !== "running" || attempt.state !== "running") return { ignored: true };
      await attempt.update({ state: outcomeUnknown ? "interrupted" : "failed", errorCode, finishedAt: new Date() }, { transaction });
      await stage.update({ state: outcomeUnknown ? "awaiting_retry" : "failed" }, { transaction });
      const completed = await this.models.GenerationStage.count({ where: { profileId: this.profileId, jobId: job.id, state: "completed" }, transaction });
      await job.update({ state: outcomeUnknown ? "interrupted" : completed ? "partial" : "failed" }, { transaction });
      return { ignored: false };
    });
  }

  async cancel(jobId: string) {
    return this.storage.write(async (transaction) => {
      const job = await this.models.GenerationJob.findOne({ where: { id: id(jobId), profileId: this.profileId }, transaction });
      if (!job) return fail("learning_not_found");
      if (job.state === "completed") return [];
      const stages = await this.models.GenerationStage.findAll({ where: { profileId: this.profileId, jobId, state: { [Op.ne]: "completed" } }, transaction });
      const activeIds = stages.map((stage) => stage.activeAttemptId).filter((value): value is string => Boolean(value));
      const attempts = await this.models.StageAttempt.findAll({ where: { profileId: this.profileId, id: { [Op.in]: activeIds } }, transaction });
      await this.models.StageAttempt.update({ state: "cancelled", finishedAt: new Date() }, { where: { profileId: this.profileId, stageId: { [Op.in]: stages.map((stage) => stage.id) }, state: "running" }, transaction });
      for (const stage of stages) await stage.update({ state: "cancelled" }, { transaction });
      await job.update({ state: "cancelled" }, { transaction });
      return attempts.map((attempt) => attempt.toJSON());
    });
  }

  async recoverInterrupted(): Promise<number> {
    return this.storage.write(async (transaction) => {
      const jobs = await this.models.GenerationJob.findAll({ where: { profileId: this.profileId, state: { [Op.in]: ["running", "queued", "partial"] } }, transaction });
      let count = 0;
      for (const job of jobs) {
        const stages = await this.models.GenerationStage.findAll({ where: { profileId: this.profileId, jobId: job.id, state: { [Op.in]: ["running", "queued", "cancelling", "reconciling"] } }, transaction });
        if (!stages.length) continue;
        await this.models.StageAttempt.update({ state: "interrupted", errorCode: "app_interrupted", finishedAt: new Date() }, { where: { profileId: this.profileId, stageId: { [Op.in]: stages.map((stage) => stage.id) }, state: "running" }, transaction });
        for (const stage of stages) await stage.update({ state: "interrupted" }, { transaction });
        await job.update({ state: "interrupted" }, { transaction });
        count++;
      }
      return count;
    });
  }

  /** A host watchdog calls this periodically; expiry never replays a provider request. */
  async expireLeases(): Promise<string[]> {
    return this.storage.write(async (transaction) => {
      const attempts = await this.models.StageAttempt.findAll({ where: { profileId: this.profileId, state: "running" }, transaction });
      const expired: string[] = [];
      for (const attempt of attempts) {
        const lease = attempt.metadata as { leaseExpiresAt?: number; ownerConnectionId?: string };
        if (lease.ownerConnectionId === this.storage.scope.context.connectionId && Number.isFinite(lease.leaseExpiresAt) && lease.leaseExpiresAt > this.now()) continue;
        const { stage, job } = await this.lookupStage(attempt.stageId, transaction);
        if (stage.activeAttemptId !== attempt.id || stage.state !== "running") continue;
        await attempt.update({ state: "interrupted", errorCode: "lease_expired", finishedAt: new Date(this.now()) }, { transaction });
        await stage.update({ state: "awaiting_retry" }, { transaction });
        await job.update({ state: "interrupted" }, { transaction });
        expired.push(attempt.id);
      }
      return expired;
    });
  }

  private async lookupStage(stageId: string, transaction: Transaction) {
    const stage = await this.models.GenerationStage.findOne({ where: { id: id(stageId), profileId: this.profileId }, transaction });
    if (!stage) return fail("learning_not_found");
    const job = await this.models.GenerationJob.findOne({ where: { id: stage.jobId, profileId: this.profileId }, transaction });
    if (!job) return fail("learning_not_found");
    return { stage, job };
  }

  private async assertRevision(input: Pick<GenerationJobAttributes, "resourceType" | "resourceId" | "revisionId">, transaction: Transaction) {
    const where = { id: input.resourceId, profileId: this.profileId };
    const resource = input.resourceType === "lesson"
      ? await this.models.LearningLesson.findOne({ where, transaction })
      : await this.models.LearningMap.findOne({ where, transaction });
    if (!resource) return fail("learning_not_found");
    if (resource.activeRevisionId !== input.revisionId) fail("learning_revision_conflict");
    const revision = input.resourceType === "lesson"
      ? await this.models.LessonRevision.findOne({ where: { id: input.revisionId, profileId: this.profileId, lessonId: input.resourceId }, transaction })
      : await this.models.LearningMapRevision.findOne({ where: { id: input.revisionId, profileId: this.profileId, mapId: input.resourceId }, transaction });
    if (!revision) fail("learning_not_found");
  }
}
