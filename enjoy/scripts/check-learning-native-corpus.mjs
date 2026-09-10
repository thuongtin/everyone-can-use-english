import { build } from "esbuild";
import { Sequelize } from "sequelize";
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const evidenceRoot = path.join(root, "tmp", "learning-acceptance", "2026-09-07", "corpus");
const casesRoot = path.join(evidenceRoot, "cases");
const historyRoot = path.join(evidenceRoot, "history");
const runtimeRoot = path.join(evidenceRoot, "runtime");
const assetRoot = path.join(runtimeRoot, "assets");
const databasePath = path.join(evidenceRoot, "learning-corpus.sqlite");
const summaryJsonPath = path.join(evidenceRoot, "summary.json");
const summaryMarkdownPath = path.join(evidenceRoot, "summary.md");
const profileId = "native-learning-corpus-2026-09-07";
const caseTimeoutMs = 700_000;
const maxConcurrency = 2;
const pollIntervalMs = 1_000;
const progressIntervalMs = 60_000;
const levels = ["A1", "A2", "B1", "B2", "C1", "C2"];
const requiredTables = [
  "learning_lessons",
  "lesson_revisions",
  "generation_jobs",
  "generation_stages",
  "stage_attempts",
];

const topicMappings = [
  {
    topic: "Ordering a drink at a coffee shop",
    term: "coffee",
    sense: "A hot drink made from roasted coffee beans.",
    definition: "A hot drink made from roasted coffee beans.",
    translationVi: "cà phê",
    example: "I would like a cup of coffee.",
  },
  {
    topic: "Buying a train ticket for a trip",
    term: "ticket",
    sense: "A pass that lets a person travel or enter a place.",
    definition: "A pass that lets a person travel or enter a place.",
    translationVi: "vé",
    example: "I have a train ticket.",
  },
  {
    topic: "Planning work with a colleague",
    term: "colleague",
    sense: "A person who works with you.",
    definition: "A person who works with you.",
    translationVi: "đồng nghiệp",
    example: "My colleague helps me at work.",
  },
  {
    topic: "Buying fruit at a weekend market",
    term: "market",
    sense: "A place where people buy and sell things.",
    definition: "A place where people buy and sell things.",
    translationVi: "chợ",
    example: "I buy fruit at the market.",
  },
  {
    topic: "Getting enough sleep after a busy day",
    term: "sleep",
    sense: "To rest with your eyes closed while your body recovers.",
    definition: "To rest with your eyes closed while your body recovers.",
    translationVi: "ngủ",
    example: "I sleep for eight hours at night.",
  },
];

function parseRepairCaseIndices(argumentsList) {
  if (argumentsList.length === 0) return new Set();
  let raw;
  if (argumentsList.length === 1 && argumentsList[0].startsWith("--repair-cases=")) {
    raw = argumentsList[0].slice("--repair-cases=".length);
  } else if (argumentsList.length === 2 && argumentsList[0] === "--repair-cases") {
    raw = argumentsList[1];
  } else {
    throw Object.assign(new Error("corpus_invalid_repair_selection"), { code: "corpus_invalid_repair_selection" });
  }
  const values = raw.split(",").map((value) => Number(value.trim()));
  const maxIndex = levels.length * topicMappings.length;
  if (!raw.trim() || values.some((value) => !Number.isInteger(value) || value < 1 || value > maxIndex)) {
    throw Object.assign(new Error("corpus_invalid_repair_selection"), { code: "corpus_invalid_repair_selection" });
  }
  const indices = new Set(values);
  if (indices.size !== values.length) {
    throw Object.assign(new Error("corpus_invalid_repair_selection"), { code: "corpus_invalid_repair_selection" });
  }
  return indices;
}

const repairCaseIndices = parseRepairCaseIndices(process.argv.slice(2));
const repairRunId = repairCaseIndices.size > 0
  ? `r${Date.now().toString(36)}-${process.pid}-${randomUUID().slice(0, 8)}`
  : null;
const repairHistoryRoot = repairRunId ? path.join(historyRoot, repairRunId) : null;

const safeErrorCodes = new Set([
  "app_interrupted",
  "corpus_case_timeout",
  "corpus_database_incomplete",
  "corpus_invalid_repair_selection",
  "learning_attempt_released",
  "learning_attempt_stale",
  "learning_candidate_scope_mismatch",
  "learning_cleanup_failed",
  "learning_job_cancelled",
  "learning_lease_expired",
  "learning_native_asset_required",
  "learning_not_found",
  "learning_request_conflict",
  "learning_resource_busy",
  "learning_revision_conflict",
  "learning_service_closed",
  "learning_stage_busy",
  "learning_validation_exhausted",
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
]);

const stopSchedulingCodes = new Set([
  "native_auth",
  "native_auth_required",
  "native_auth_unconfirmed",
  "native_quota",
]);

const terminalJobStates = new Set(["completed", "failed", "cancelled", "interrupted"]);

function simpleSlug(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function makeCases() {
  return levels.flatMap((level) => topicMappings.map((mapping, topicIndex) => {
    const globalIndex = levels.indexOf(level) * topicMappings.length + topicIndex;
    const targetId = simpleSlug(mapping.topic);
    const target = {
      id: targetId,
      term: mapping.term,
      sense: mapping.sense,
      definition: mapping.definition,
      translationVi: mapping.translationVi,
      example: mapping.example,
    };
    return {
      index: globalIndex + 1,
      globalIndex,
      level,
      provider: globalIndex % 2 === 0 ? "codex" : "claude",
      topic: mapping.topic,
      term: mapping.term,
      targetId,
      requestKey: `learning-corpus-2026-09-07-${String(globalIndex + 1).padStart(2, "0")}`,
      brief: {
        topic: mapping.topic,
        keywords: [mapping.term],
        level,
        length: "short",
        imageCount: 0,
        audio: false,
        targets: [target],
      },
    };
  }));
}

function safeErrorCode(error, fallback = "native_error") {
  const code = error && typeof error === "object" && typeof error.code === "string"
    ? error.code
    : undefined;
  return code && safeErrorCodes.has(code) ? code : fallback;
}

function safeIssueList(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const code = typeof candidate.code === "string" && /^[a-z][a-z0-9_]{0,79}$/u.test(candidate.code)
      ? candidate.code
      : "validation_issue";
    const issue = {
      code,
      path: Array.isArray(candidate.path) ? candidate.path.filter((part) => typeof part === "string" || typeof part === "number") : [],
    };
    if (typeof candidate.message === "string") issue.message = candidate.message;
    return [issue];
  });
}

function safeAttemptMetadata(value) {
  if (!value || typeof value !== "object") return {};
  const metadata = {};
  for (const key of ["invalidSubmissions", "leaseExpiresAt", "ownerConnectionId"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const item = value[key];
      if (typeof item === "string" || (typeof item === "number" && Number.isFinite(item))) metadata[key] = item;
    }
  }
  return metadata;
}

function safeJobState(state) {
  return {
    job: {
      id: state.job.id,
      profileId: state.job.profileId,
      createdAt: state.job.createdAt,
      updatedAt: state.job.updatedAt,
      resourceType: state.job.resourceType,
      resourceId: state.job.resourceId,
      revisionId: state.job.revisionId,
      requestKey: state.job.requestKey,
      state: state.job.state,
      metadata: state.job.metadata && typeof state.job.metadata === "object" ? state.job.metadata : {},
    },
    stages: state.stages.map((stage) => ({
      id: stage.id,
      profileId: stage.profileId,
      createdAt: stage.createdAt,
      updatedAt: stage.updatedAt,
      jobId: stage.jobId,
      key: stage.key,
      kind: stage.kind,
      slotId: stage.slotId,
      state: stage.state,
      activeAttemptId: stage.activeAttemptId,
      expectedRevisionId: stage.expectedRevisionId,
      committedHash: stage.committedHash,
    })),
    attempts: state.attempts.map((attempt) => ({
      id: attempt.id,
      profileId: attempt.profileId,
      createdAt: attempt.createdAt,
      updatedAt: attempt.updatedAt,
      stageId: attempt.stageId,
      ordinal: attempt.ordinal,
      state: attempt.state,
      provider: attempt.provider,
      providerSessionId: attempt.providerSessionId,
      providerItemIds: Array.isArray(attempt.providerItemIds) ? attempt.providerItemIds : [],
      errorCode: attempt.errorCode ? safeErrorCode({ code: attempt.errorCode }) : null,
      startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt,
      metadata: safeAttemptMetadata(attempt.metadata),
    })),
  };
}

function caseFilePath(caseSpec) {
  return path.join(
    casesRoot,
    `${String(caseSpec.index).padStart(2, "0")}-${caseSpec.provider}-${caseSpec.targetId}.json`,
  );
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function writeJsonAtomic(target, value) {
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function evidenceRelative(target) {
  return path.relative(evidenceRoot, target);
}

async function archiveOriginalCase(caseSpec, runtime) {
  if (!repairHistoryRoot) return null;
  const sourcePath = caseFilePath(caseSpec);
  const archivePath = path.join(repairHistoryRoot, path.basename(sourcePath));
  const archive = {
    caseIndex: caseSpec.index,
    source: evidenceRelative(sourcePath),
    path: evidenceRelative(archivePath),
    exists: false,
    byteLength: null,
    sha256: null,
    status: null,
    jobId: null,
    requestKey: null,
    resourceId: null,
    revisionId: null,
    sqliteJob: null,
  };
  if (!(await pathExists(sourcePath))) return archive;

  const sourceText = await readFile(sourcePath, "utf8");
  let sourceRecord;
  try {
    sourceRecord = JSON.parse(sourceText);
  } catch {
    throw Object.assign(new Error("corpus_invalid_repair_selection"), { code: "corpus_invalid_repair_selection" });
  }
  await mkdir(repairHistoryRoot, { recursive: true, mode: 0o700 });
  await writeFile(archivePath, sourceText, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(archivePath, 0o600);
  const archivedText = await readFile(archivePath, "utf8");
  archive.exists = true;
  archive.byteLength = Buffer.byteLength(sourceText, "utf8");
  archive.sha256 = sha256(sourceText);
  if (archivedText !== sourceText || sha256(archivedText) !== archive.sha256) {
    throw Object.assign(new Error("corpus_invalid_repair_selection"), { code: "corpus_invalid_repair_selection" });
  }
  archive.status = typeof sourceRecord.status === "string" ? sourceRecord.status : null;
  archive.jobId = typeof sourceRecord.job?.job?.id === "string" ? sourceRecord.job.job.id : null;
  archive.requestKey = typeof sourceRecord.job?.job?.requestKey === "string" ? sourceRecord.job.job.requestKey : null;
  archive.resourceId = typeof sourceRecord.job?.job?.resourceId === "string" ? sourceRecord.job.job.resourceId : null;
  archive.revisionId = typeof sourceRecord.job?.job?.revisionId === "string" ? sourceRecord.job.job.revisionId : null;
  if (archive.jobId && runtime) {
    const row = await runtime.storage.models.GenerationJob.findOne({
      where: { profileId, id: archive.jobId },
    });
    if (row) {
      const value = typeof row.toJSON === "function" ? row.toJSON() : row;
      archive.sqliteJob = {
        id: value.id,
        profileId: value.profileId,
        resourceType: value.resourceType,
        resourceId: value.resourceId,
        revisionId: value.revisionId,
        requestKey: value.requestKey,
        state: value.state,
      };
    }
  }
  return archive;
}

function makeRepairPlan(caseSpec, archive) {
  if (!repairRunId || !archive) return null;
  const requestKey = `${caseSpec.requestKey}.repair-${repairRunId}-${caseSpec.index}`;
  return {
    runId: repairRunId,
    archive,
    originalRequestKey: caseSpec.requestKey,
    requestKey,
    title: `${caseSpec.level}: ${caseSpec.topic} [repair ${repairRunId}]`,
  };
}

async function verifyOriginalRepairJobs(runtime, repairPlans) {
  const expected = [...repairPlans.values()]
    .map((plan) => plan.archive.sqliteJob)
    .filter((job) => job && typeof job.id === "string");
  if (expected.length === 0) {
    return {
      expected: 0,
      preserved: 0,
      allPreserved: true,
      jobs: [],
    };
  }
  const rows = await runtime.storage.models.GenerationJob.findAll({ where: { profileId } });
  const byId = new Map(rows.map((row) => {
    const value = typeof row.toJSON === "function" ? row.toJSON() : row;
    return [value.id, value];
  }));
  const jobs = expected.map((original) => {
    const current = byId.get(original.id);
    const preserved = Boolean(current)
      && current.profileId === original.profileId
      && current.resourceType === original.resourceType
      && current.resourceId === original.resourceId
      && current.revisionId === original.revisionId
      && current.requestKey === original.requestKey
      && current.state === original.state;
    return {
      id: original.id,
      requestKey: original.requestKey,
      present: Boolean(current),
      unchanged: preserved,
    };
  });
  return {
    expected: jobs.length,
    preserved: jobs.filter((job) => job.unchanged).length,
    allPreserved: jobs.every((job) => job.unchanged),
    jobs,
  };
}

async function delay(milliseconds) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function buildBundles(buildRoot) {
  const runtimeOutput = path.join(buildRoot, "runtime.mjs");
  const contractsOutput = path.join(buildRoot, "contracts.mjs");
  await Promise.all([
    build({
      entryPoints: [path.join(root, "src/main/learning/runtime.ts")],
      outfile: runtimeOutput,
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      logLevel: "silent",
    }),
    build({
      stdin: {
        contents: `export { evaluateLessonDraft } from "./src/lib/learning-validator.ts";`,
        resolveDir: root,
        loader: "ts",
      },
      outfile: contractsOutput,
      bundle: true,
      platform: "node",
      format: "esm",
      logLevel: "silent",
    }),
  ]);
  const [{ LearningRuntime }, contracts, migration, mapBriefMigration] = await Promise.all([
    import(pathToFileURL(runtimeOutput).href),
    import(pathToFileURL(contractsOutput).href),
    import(pathToFileURL(path.join(root, "src/main/db/migrations/1788701024340-create-learning-studio.js")).href),
    import(pathToFileURL(path.join(root, "src/main/db/migrations/1788789600000-add-learning-map-brief.js")).href),
  ]);
  return { LearningRuntime, evaluateLessonDraft: contracts.evaluateLessonDraft, migration, mapBriefMigration };
}

async function ensureDatabaseSchema(db, migration, mapBriefMigration, existingDatabase) {
  if (!existingDatabase) {
    await migration.up({ context: db.getQueryInterface() });
    await mapBriefMigration.up({ context: db.getQueryInterface() });
    return;
  }
  const [rows] = await db.query("SELECT name FROM sqlite_master WHERE type = 'table'");
  const tables = new Set(rows.map((row) => row.name));
  if (!requiredTables.every((table) => tables.has(table))) {
    throw Object.assign(new Error("corpus_database_incomplete"), { code: "corpus_database_incomplete" });
  }
  const mapRevisionColumns = await db.getQueryInterface().describeTable("learning_map_revisions");
  if (!mapRevisionColumns.brief) {
    await mapBriefMigration.up({ context: db.getQueryInterface() });
  }
}

function referenceCoverage(content, brief) {
  const targetIds = new Set(brief.targets.map((target) => target.id));
  const references = [];
  for (const section of content.sections ?? []) {
    for (const targetId of section.targetIds ?? []) references.push({ kind: "section", targetId });
  }
  for (const glossary of content.glossary ?? []) references.push({ kind: "glossary", targetId: glossary.targetId });
  for (const scene of content.scenes ?? []) {
    for (const targetId of scene.targetIds ?? []) references.push({ kind: "scene", targetId });
  }
  for (const exercise of content.exercises ?? []) {
    for (const targetId of exercise.targetIds ?? []) references.push({ kind: "exercise", targetId });
  }
  const validReferences = references.filter((reference) => targetIds.has(reference.targetId));
  const referencesByKind = Object.fromEntries(["section", "glossary", "scene", "exercise"].map((kind) => {
    const values = references.filter((reference) => reference.kind === kind);
    return [kind, { total: values.length, valid: values.filter((reference) => targetIds.has(reference.targetId)).length }];
  }));
  return {
    expectedTargetIds: [...targetIds],
    targetIdsReferenced: [...new Set(validReferences.map((reference) => reference.targetId))],
    totalTargetReferences: references.length,
    validTargetReferences: validReferences.length,
    danglingTargetReferences: references.length - validReferences.length,
    glossaryEntriesForExpectedTargets: brief.targets.map((target) => ({
      targetId: target.id,
      count: (content.glossary ?? []).filter((entry) => entry.targetId === target.id).length,
    })),
    referencesByKind,
  };
}

async function waitForAttemptCleanup(attemptId, connectionId, timeoutMs = 30_000) {
  const attemptRoot = path.join(runtimeRoot, "native-jobs", connectionId, attemptId);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await pathExists(attemptRoot))) return true;
    await delay(100);
  }
  return !(await pathExists(attemptRoot));
}

async function cancelTimedOutJob(runtime, jobId) {
  let cancelledAttempts = [];
  try {
    cancelledAttempts = await runtime.application.jobs.cancel(jobId);
  } catch {
    return false;
  }
  let cleanupVerified = true;
  for (const attempt of cancelledAttempts) {
    try {
      await runtime.cancelAttempt(attempt.id);
      cleanupVerified = (await waitForAttemptCleanup(attempt.id, runtime.scope.context.connectionId)) && cleanupVerified;
    } catch {
      cleanupVerified = false;
    }
  }
  return cleanupVerified;
}

async function waitForJob(runtime, jobId, startedAt) {
  let state;
  while (true) {
    state = await runtime.application.jobs.get(jobId);
    if (terminalJobStates.has(state.job.state)) return { state, timedOut: false, cleanupVerified: true };
    if (Date.now() - startedAt >= caseTimeoutMs) {
      const cleanupVerified = await cancelTimedOutJob(runtime, jobId);
      state = await runtime.application.jobs.get(jobId).catch(() => state);
      return { state, timedOut: true, cleanupVerified };
    }
    await delay(pollIntervalMs);
  }
}

function lastAttemptError(state) {
  const attempts = [...state.attempts].reverse();
  const attempt = attempts.find((candidate) => candidate.errorCode);
  return attempt?.errorCode ? safeErrorCode({ code: attempt.errorCode }) : null;
}

function acceptedRecord(caseSpec, state, revision, evaluation, cleanupVerified, elapsedMs, resumed, repair = null) {
  const brief = revision.brief;
  const content = revision.content;
  return {
    schemaVersion: 1,
    status: "completed",
    resumed,
    ...(repair ? { repair } : {}),
    case: {
      index: caseSpec.index,
      level: caseSpec.level,
      provider: caseSpec.provider,
      topic: caseSpec.topic,
      term: caseSpec.term,
      targetId: caseSpec.targetId,
    },
    request: {
      length: "short",
      imageCount: 0,
      audio: false,
      nativeAssetsRequested: false,
    },
    elapsedMs,
    brief,
    content,
    job: safeJobState(state),
    revision: {
      id: revision.id,
      number: revision.number,
      status: revision.status,
      sourceHash: revision.sourceHash,
      provenance: revision.provenance,
    },
    validationWarnings: safeIssueList(revision.validation),
    evaluation: {
      ok: evaluation.ok,
      issues: safeIssueList(evaluation.issues),
      warnings: safeIssueList(evaluation.warnings),
      metrics: evaluation.metrics,
    },
    referenceCoverage: referenceCoverage(content, brief),
    cleanup: {
      attemptWorkspaceRemoved: cleanupVerified,
    },
  };
}

function failedRecord(caseSpec, status, state, errorCode, cleanupVerified, resumed = false, repair = null) {
  return {
    schemaVersion: 1,
    status,
    resumed,
    ...(repair ? { repair } : {}),
    case: {
      index: caseSpec.index,
      level: caseSpec.level,
      provider: caseSpec.provider,
      topic: caseSpec.topic,
      term: caseSpec.term,
      targetId: caseSpec.targetId,
    },
    request: {
      length: "short",
      imageCount: 0,
      audio: false,
      nativeAssetsRequested: false,
    },
    brief: caseSpec.brief,
    ...(state ? { job: safeJobState(state) } : {}),
    ...(errorCode ? { errorCode: safeErrorCode({ code: errorCode }) } : {}),
    cleanup: {
      attemptWorkspaceRemoved: cleanupVerified,
    },
  };
}

async function materializeExistingCompleted(runtime, evaluateLessonDraft, caseSpec, state, resumed) {
  const bundle = await runtime.storage.getLesson(state.job.resourceId);
  const revision = bundle.revisions.find((candidate) => candidate.id === state.job.revisionId);
  if (!revision || revision.status !== "ready" || !revision.content) return null;
  const evaluation = evaluateLessonDraft(revision.content, revision.brief);
  const cleanupVerified = await waitForAttemptCleanup(
    state.attempts.at(-1)?.id ?? "missing-attempt",
    runtime.scope.context.connectionId,
  );
  const record = acceptedRecord(caseSpec, state, revision, evaluation, cleanupVerified, null, resumed);
  await writeJsonAtomic(caseFilePath(caseSpec), record);
  return { status: evaluation.ok ? "completed" : "rejected", record, stopScheduling: false };
}

async function findExistingCase(runtime, evaluateLessonDraft, caseSpec) {
  const artifactPath = caseFilePath(caseSpec);
  if (await pathExists(artifactPath)) {
    try {
      const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
      if (artifact?.status === "completed" && artifact?.job?.job?.id) {
        const state = await runtime.application.jobs.get(artifact.job.job.id);
        if (state.job.state === "completed") {
          const materialized = await materializeExistingCompleted(runtime, evaluateLessonDraft, caseSpec, state, true);
          if (materialized) return materialized;
        }
      }
    } catch {
      // A partial artifact is ignored and the database remains authoritative.
    }
  }

  const row = await runtime.storage.models.GenerationJob.findOne({
    where: { profileId, requestKey: caseSpec.requestKey },
  });
  if (!row) return null;
  const state = await runtime.application.jobs.get(row.id);
  if (state.job.state === "completed") {
    return materializeExistingCompleted(runtime, evaluateLessonDraft, caseSpec, state, true);
  }
  const errorCode = lastAttemptError(state) ?? (state.job.state === "interrupted" ? "app_interrupted" : null);
  const status = state.job.state === "failed" || state.job.state === "cancelled" ? "rejected" : "error";
  const record = failedRecord(caseSpec, status, state, errorCode, true, true);
  await writeJsonAtomic(artifactPath, record);
  return { status, record, stopScheduling: Boolean(errorCode && stopSchedulingCodes.has(errorCode)) };
}

async function findExistingDraft(runtime, caseSpec) {
  const lessonRow = await runtime.storage.models.LearningLesson.findOne({
    where: { profileId, title: `${caseSpec.level}: ${caseSpec.topic}` },
  });
  if (!lessonRow) return null;
  const lesson = typeof lessonRow.toJSON === "function" ? lessonRow.toJSON() : lessonRow;
  if (!lesson.activeRevisionId) return null;
  const revisionRow = await runtime.storage.models.LessonRevision.findOne({
    where: {
      profileId,
      lessonId: lesson.id,
      id: lesson.activeRevisionId,
    },
  });
  if (!revisionRow) return null;
  const revision = typeof revisionRow.toJSON === "function" ? revisionRow.toJSON() : revisionRow;
  return revision.status === "draft" ? { lesson, revision } : null;
}

async function executeCase(runtime, evaluateLessonDraft, caseSpec, repair = null) {
  if (!repair) {
    const existing = await findExistingCase(runtime, evaluateLessonDraft, caseSpec);
    if (existing) return existing;
  }

  const startedAt = Date.now();
  let state;
  let jobId;
  try {
    const created = repair
      ? await runtime.storage.createLesson({
          brief: caseSpec.brief,
          title: repair.title,
        })
      : await findExistingDraft(runtime, caseSpec) ?? await runtime.storage.createLesson({
          brief: caseSpec.brief,
          title: `${caseSpec.level}: ${caseSpec.topic}`,
        });
    if (repair) {
      repair.newLessonId = created.lesson.id;
      repair.newRevisionId = created.revision.id;
    }
    ({ jobId } = await runtime.generation.generate({
      provider: caseSpec.provider,
      resourceType: "lesson",
      resourceId: created.lesson.id,
      revisionId: created.revision.id,
      requestKey: repair?.requestKey ?? caseSpec.requestKey,
    }));
    const waited = await waitForJob(runtime, jobId, startedAt);
    state = waited.state;
    const errorCode = waited.timedOut
      ? (lastAttemptError(state) ?? "corpus_case_timeout")
      : lastAttemptError(state);
    const cleanupVerified = waited.cleanupVerified && await waitForAttemptCleanup(
      state.attempts.at(-1)?.id ?? "missing-attempt",
      runtime.scope.context.connectionId,
    );
    if (state.job.state === "completed") {
      const bundle = await runtime.storage.getLesson(created.lesson.id);
      const revision = bundle.revisions.find((candidate) => candidate.id === created.revision.id);
      if (!revision || revision.status !== "ready" || !revision.content) {
        const record = failedRecord(caseSpec, "rejected", state, "native_submission_missing", cleanupVerified, false, repair);
        await writeJsonAtomic(caseFilePath(caseSpec), record);
        return { status: "rejected", record, stopScheduling: false };
      }
      const evaluation = evaluateLessonDraft(revision.content, revision.brief);
      const status = evaluation.ok ? "completed" : "rejected";
      const record = acceptedRecord(
        caseSpec,
        state,
        revision,
        evaluation,
        cleanupVerified,
        Date.now() - startedAt,
        false,
        repair,
      );
      await writeJsonAtomic(caseFilePath(caseSpec), { ...record, status });
      return {
        status,
        record: { ...record, status },
        stopScheduling: false,
      };
    }
    const status = state.job.state === "failed" || state.job.state === "cancelled" ? "rejected" : "error";
    const record = failedRecord(caseSpec, status, state, errorCode, cleanupVerified, false, repair);
    await writeJsonAtomic(caseFilePath(caseSpec), record);
    return {
      status,
      record,
      stopScheduling: Boolean(errorCode && stopSchedulingCodes.has(errorCode)),
    };
  } catch (error) {
    const code = safeErrorCode(error);
    if (jobId && !state) {
      state = await runtime.application.jobs.get(jobId).catch(() => undefined);
    }
    const cleanupVerified = state?.attempts?.at(-1)?.id
      ? await waitForAttemptCleanup(state.attempts.at(-1).id, runtime.scope.context.connectionId)
      : true;
    const record = failedRecord(caseSpec, "error", state, code, cleanupVerified, false, repair);
    await writeJsonAtomic(caseFilePath(caseSpec), record);
    return {
      status: "error",
      record,
      stopScheduling: stopSchedulingCodes.has(code),
    };
  }
}

function compactOutcome(caseSpec, outcome) {
  const record = outcome.record;
  return {
    index: caseSpec.index,
    level: caseSpec.level,
    provider: caseSpec.provider,
    topic: caseSpec.topic,
    term: caseSpec.term,
    targetId: caseSpec.targetId,
    status: outcome.status,
    errorCode: record?.errorCode ?? null,
    elapsedMs: record?.elapsedMs ?? null,
    artifact: path.relative(evidenceRoot, caseFilePath(caseSpec)),
  };
}

function makeCoverage(cases, outcomes, completedRecords) {
  const aggregateReference = {
    totalTargetReferences: 0,
    validTargetReferences: 0,
    danglingTargetReferences: 0,
    casesChecked: 0,
    casesWithoutDanglingTargetReferences: 0,
    expectedTargetIds: cases.map((caseSpec) => caseSpec.targetId),
    uniqueExpectedTargetIds: [...new Set(cases.map((caseSpec) => caseSpec.targetId))],
  };
  const aggregateTarget = {
    requestedCases: cases.length,
    completedCases: completedRecords.length,
    briefTargetCount: 0,
    uniqueBriefTargetIds: [],
    contentTargetIdsReferenced: 0,
    storyTargetOccurrencePositive: 0,
    practiceExposurePositive: 0,
  };
  const contentTargetIds = new Set();
  for (const record of completedRecords) {
    const briefTarget = record.brief?.targets?.[0];
    if (briefTarget) {
      aggregateTarget.briefTargetCount += 1;
      aggregateTarget.uniqueBriefTargetIds.push(briefTarget.id);
    }
    const reference = record.referenceCoverage;
    if (reference) {
      aggregateReference.casesChecked += 1;
      aggregateReference.totalTargetReferences += reference.totalTargetReferences;
      aggregateReference.validTargetReferences += reference.validTargetReferences;
      aggregateReference.danglingTargetReferences += reference.danglingTargetReferences;
      if (reference.danglingTargetReferences === 0) aggregateReference.casesWithoutDanglingTargetReferences += 1;
      for (const targetId of reference.targetIdsReferenced) contentTargetIds.add(targetId);
    }
    const targetId = briefTarget?.id;
    const metrics = record.evaluation?.metrics;
    if (targetId && Number(metrics?.targetOccurrences?.[targetId] ?? 0) > 0) aggregateTarget.storyTargetOccurrencePositive += 1;
    if (targetId && Number(metrics?.practiceExposure?.[targetId] ?? 0) > 0) aggregateTarget.practiceExposurePositive += 1;
  }
  aggregateTarget.uniqueBriefTargetIds = [...new Set(aggregateTarget.uniqueBriefTargetIds)];
  aggregateTarget.contentTargetIdsReferenced = contentTargetIds.size;

  const matrix = levels.map((level) => {
    const levelCases = cases.filter((caseSpec) => caseSpec.level === level);
    const levelOutcomes = levelCases.map((caseSpec) => outcomes.get(caseSpec.index)).filter(Boolean);
    return {
      level,
      requested: levelCases.length,
      completed: levelOutcomes.filter((outcome) => outcome.status === "completed").length,
      rejected: levelOutcomes.filter((outcome) => outcome.status === "rejected").length,
      errors: levelOutcomes.filter((outcome) => outcome.status === "error").length,
      providers: {
        codex: levelCases.filter((caseSpec) => caseSpec.provider === "codex").length,
        claude: levelCases.filter((caseSpec) => caseSpec.provider === "claude").length,
      },
    };
  });

  const requiredFields = ["title", "sections", "glossary", "scenes", "exercises", "entityDescriptions"];
  const schemaFields = Object.fromEntries(requiredFields.map((field) => [
    field,
    completedRecords.filter((record) => Object.prototype.hasOwnProperty.call(record.content ?? {}, field)).length,
  ]));
  return {
    target: aggregateTarget,
    reference: aggregateReference,
    schema: {
      schemaVersion: 1,
      acceptedDraftsEvaluated: completedRecords.length,
      validatorOk: completedRecords.filter((record) => record.evaluation?.ok === true).length,
      requiredLessonDraftFieldsPresent: schemaFields,
      matrix,
    },
  };
}

function makeRepairSummary() {
  if (!repairRunId) {
    return {
      enabled: false,
      runId: null,
      selectedIndices: [],
      historyDirectory: null,
      archives: [],
      originalJobs: {
        expected: 0,
        preserved: 0,
        allPreserved: true,
        jobs: [],
      },
    };
  }
  const archives = cases
    .filter((caseSpec) => repairCaseIndices.has(caseSpec.index))
    .map((caseSpec) => {
      const plan = repairPlans.get(caseSpec.index);
      return {
        index: caseSpec.index,
        provider: caseSpec.provider,
        original: plan?.archive ?? null,
        newRequestKey: plan?.requestKey ?? null,
        newLessonId: plan?.newLessonId ?? null,
        newRevisionId: plan?.newRevisionId ?? null,
      };
    });
  return {
    enabled: true,
    runId: repairRunId,
    selectedIndices: [...repairCaseIndices].sort((left, right) => left - right),
    historyDirectory: repairHistoryRoot ? evidenceRelative(repairHistoryRoot) : null,
    archives,
    originalJobs: repairVerification ?? {
      expected: 0,
      preserved: 0,
      allPreserved: false,
      jobs: [],
      errorCode: "corpus_repair_verification_pending",
    },
  };
}

function makeSummary(cases, outcomes, completedRecords, metadata) {
  const completed = cases.filter((caseSpec) => outcomes.get(caseSpec.index)?.status === "completed").map((caseSpec) => compactOutcome(caseSpec, outcomes.get(caseSpec.index)));
  const rejected = cases.filter((caseSpec) => outcomes.get(caseSpec.index)?.status === "rejected").map((caseSpec) => compactOutcome(caseSpec, outcomes.get(caseSpec.index)));
  const errors = cases.filter((caseSpec) => outcomes.get(caseSpec.index)?.status === "error").map((caseSpec) => compactOutcome(caseSpec, outcomes.get(caseSpec.index)));
  const remaining = cases.filter((caseSpec) => !outcomes.has(caseSpec.index)).map((caseSpec) => ({
    index: caseSpec.index,
    level: caseSpec.level,
    provider: caseSpec.provider,
    topic: caseSpec.topic,
    term: caseSpec.term,
    targetId: caseSpec.targetId,
  }));
  const completedProviders = Object.fromEntries(["codex", "claude"].map((provider) => [
    provider,
    completed.filter((item) => item.provider === provider).length,
  ]));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    script: "check-learning-native-corpus.mjs",
    provenance: {
      native: true,
      generator: "NativeLearningGeneration",
      providers: completedProviders,
      auth: "existing native CLI subscription identity",
    },
    request: {
      totalCases: cases.length,
      levels,
      casesPerLevel: topicMappings.length,
      length: "short",
      imageCount: 0,
      audio: false,
      targetCountPerBrief: 1,
      maxConcurrency,
      caseTimeoutMs,
      automaticRetries: 0,
      nativeValidatorRepair: "existing NativeLearningGeneration turn policy",
      repairCaseIndices: [...repairCaseIndices].sort((left, right) => left - right),
    },
    counts: {
      requested: cases.length,
      started: outcomes.size,
      completed: completed.length,
      rejected: rejected.length,
      errors: errors.length,
      remaining: remaining.length,
    },
    stop: {
      schedulingStopped: Boolean(metadata.stopReason),
      reason: metadata.stopReason,
      doneIndices: completed.map((item) => item.index),
      rejectedIndices: rejected.map((item) => item.index),
      errorIndices: errors.map((item) => item.index),
      remainingIndices: remaining.map((item) => item.index),
    },
    completed,
    rejected,
    errors,
    remaining,
    coverage: makeCoverage(cases, outcomes, completedRecords),
    repair: metadata.repair,
    reviewBoundary: {
      semanticQuality: "manual review required",
      cefrCertification: false,
      note: "Metrics and reference checks are mechanical acceptance evidence. They do not rate meaning quality or certify CEFR level.",
    },
    files: {
      database: path.relative(evidenceRoot, databasePath),
      cases: path.relative(evidenceRoot, casesRoot),
      markdown: path.relative(evidenceRoot, summaryMarkdownPath),
    },
    cleanup: metadata.cleanup,
    fatalErrorCode: metadata.fatalErrorCode,
  };
}

function markdownSummary(summary) {
  const rows = summary.coverage.schema.matrix.map((row) => `| ${row.level} | ${row.requested} | ${row.completed} | ${row.rejected} | ${row.errors} | ${row.providers.codex} codex, ${row.providers.claude} claude |`).join("\n");
  const remainingText = summary.remaining.length
    ? summary.remaining.map((item) => `${item.index} (${item.level}/${item.provider})`).join(", ")
    : "không có";
  const stopText = summary.stop.reason ? `Dừng lập lịch sau lỗi \`${summary.stop.reason}\`.` : "Không có lỗi auth hoặc quota làm dừng lập lịch.";
  const repairText = summary.repair?.enabled
    ? `Repair tường minh cho case ${summary.repair.selectedIndices.join(", ")}; archive tại \`${summary.repair.historyDirectory}/\`; ${summary.repair.originalJobs.preserved}/${summary.repair.originalJobs.expected} original SQLite job được giữ nguyên.`
    : "Không có repair case tường minh trong lần chạy này.";
  return `# Native learning corpus acceptance

Corpus này gồm ${summary.request.totalCases} lesson case với 6 level CEFR, 5 topic mỗi level. Mỗi brief dùng \`length=short\`, \`imageCount=0\`, \`audio=false\` và một target cố định theo topic.

- Provenance: native \`NativeLearningGeneration\` qua existing CLI subscription identity.
- Concurrency tối đa: ${summary.request.maxConcurrency}.
- Automatic retry: ${summary.request.automaticRetries}. Validator repair dùng policy hiện có của native turn.
- Kết quả: ${summary.counts.completed} completed, ${summary.counts.rejected} rejected, ${summary.counts.errors} errors, ${summary.counts.remaining} remaining.
- ${stopText}
- Remaining: ${remainingText}.
- ${repairText}

| Level | Requested | Completed | Rejected | Errors | Provider coverage |
| --- | ---: | ---: | ---: | ---: | --- |
${rows}

## Mechanical coverage

- Target: ${summary.coverage.target.briefTargetCount}/${summary.counts.completed} completed brief có target; ${summary.coverage.target.storyTargetOccurrencePositive} story có occurrence dương; ${summary.coverage.target.practiceExposurePositive} case có practice exposure dương.
- Reference: ${summary.coverage.reference.casesWithoutDanglingTargetReferences}/${summary.coverage.reference.casesChecked} case không có dangling target reference; ${summary.coverage.reference.validTargetReferences}/${summary.coverage.reference.totalTargetReferences} reference hợp lệ.
- Schema: ${summary.coverage.schema.validatorOk}/${summary.coverage.schema.acceptedDraftsEvaluated} accepted draft pass \`evaluateLessonDraft\`; các field lesson draft được đếm trong \`summary.json\`.

Các metric trên là bằng chứng acceptance cơ học. Chúng không chấm semantic quality và không phải chứng nhận CEFR; cần manual review nội dung mẫu.

Artifact chính:

- SQLite: \`${summary.files.database}\`
- Per-case evidence: \`${summary.files.cases}/\`
- JSON summary: \`summary.json\`
`;
}

function reportProgress(cases, outcomes, activeCount, stopReason, force = false) {
  const now = Date.now();
  if (!force && now - reportProgress.lastReportAt < progressIntervalMs) return;
  reportProgress.lastReportAt = now;
  const counts = { completed: 0, rejected: 0, errors: 0 };
  for (const outcome of outcomes.values()) {
    const key = outcome.status === "error" ? "errors" : outcome.status;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  console.log(JSON.stringify({
    event: "progress",
    requested: cases.length,
    completed: counts.completed,
    rejected: counts.rejected,
    errors: counts.errors,
    active: activeCount,
    remaining: cases.length - outcomes.size,
    stopReason: stopReason ?? null,
  }));
}
reportProgress.lastReportAt = 0;

await mkdir(casesRoot, { recursive: true, mode: 0o700 });
let buildRoot;
let db;
let runtime;
let fatalErrorCode = null;
let stopReason = null;
let cleanupRuntimeVerified = false;
let repairVerification = null;
const cases = makeCases();
const outcomes = new Map();
const repairPlans = new Map();

try {
  buildRoot = await mkdtemp(path.join(root, ".tmp-native-learning-corpus-"));
  const { LearningRuntime, evaluateLessonDraft, migration, mapBriefMigration } = await buildBundles(buildRoot);
  const existingDatabase = await pathExists(databasePath);
  db = new Sequelize({ dialect: "sqlite", storage: databasePath, logging: false });
  await ensureDatabaseSchema(db, migration, mapBriefMigration, existingDatabase);
  runtime = await LearningRuntime.open({
    sequelize: db,
    profileId,
    assetRoot,
    watchdogMs: 1_000,
  });

  const pendingCases = [];
  for (const caseSpec of cases) {
    if (repairCaseIndices.has(caseSpec.index)) {
      const archive = await archiveOriginalCase(caseSpec, runtime);
      if (!archive?.exists) {
        throw Object.assign(new Error("corpus_invalid_repair_selection"), { code: "corpus_invalid_repair_selection" });
      }
      const repair = makeRepairPlan(caseSpec, archive);
      if (!repair) {
        throw Object.assign(new Error("corpus_invalid_repair_selection"), { code: "corpus_invalid_repair_selection" });
      }
      repairPlans.set(caseSpec.index, repair);
      pendingCases.push(caseSpec);
      continue;
    }
    const existing = await findExistingCase(runtime, evaluateLessonDraft, caseSpec);
    if (existing) {
      outcomes.set(caseSpec.index, existing);
      if (existing.stopScheduling && !stopReason) stopReason = existing.record?.errorCode ?? "native_error";
    } else {
      pendingCases.push(caseSpec);
    }
  }
  reportProgress(cases, outcomes, 0, stopReason, true);

  let nextPending = 0;
  const worker = async () => {
    while (!stopReason && nextPending < pendingCases.length) {
      const caseSpec = pendingCases[nextPending];
      nextPending += 1;
      const outcome = await executeCase(runtime, evaluateLessonDraft, caseSpec, repairPlans.get(caseSpec.index) ?? null);
      outcomes.set(caseSpec.index, outcome);
      if (outcome.stopScheduling && !stopReason) stopReason = outcome.record?.errorCode ?? "native_error";
      reportProgress(cases, outcomes, Math.min(maxConcurrency, pendingCases.length - nextPending), stopReason, true);
    }
  };
  await Promise.all(Array.from({ length: maxConcurrency }, () => worker()));
} catch (error) {
  fatalErrorCode = safeErrorCode(error);
  if (!stopReason && stopSchedulingCodes.has(fatalErrorCode)) stopReason = fatalErrorCode;
  console.error(JSON.stringify({ event: "fatal", code: fatalErrorCode }));
} finally {
  if (runtime && repairPlans.size > 0) {
    try {
      repairVerification = await verifyOriginalRepairJobs(runtime, repairPlans);
      if (!repairVerification.allPreserved) {
        fatalErrorCode ??= "corpus_invalid_repair_selection";
      }
    } catch (error) {
      const code = safeErrorCode(error, "corpus_invalid_repair_selection");
      fatalErrorCode ??= code;
      repairVerification = {
        expected: 0,
        preserved: 0,
        allPreserved: false,
        jobs: [],
        errorCode: code,
      };
    }
  }
  if (runtime) {
    try {
      await runtime.close();
      cleanupRuntimeVerified = true;
    } catch (error) {
      const code = safeErrorCode(error, "learning_cleanup_failed");
      fatalErrorCode ??= code;
      console.error(JSON.stringify({ event: "cleanup", code }));
    }
  }
  if (db) {
    await db.close().catch(() => undefined);
  }
  if (cleanupRuntimeVerified) {
    await rm(runtimeRoot, { recursive: true, force: true }).catch(() => undefined);
    cleanupRuntimeVerified = !(await pathExists(runtimeRoot));
  }
  if (buildRoot) await rm(buildRoot, { recursive: true, force: true }).catch(() => undefined);
  if (cleanupRuntimeVerified) {
    for (const [index, outcome] of outcomes.entries()) {
      if (outcome.record?.status !== "completed" || outcome.record.cleanup?.attemptWorkspaceRemoved === true) continue;
      const record = {
        ...outcome.record,
        cleanup: {
          ...outcome.record.cleanup,
          attemptWorkspaceRemoved: true,
          finalRuntimeCleanupVerified: true,
        },
      };
      const caseSpec = cases.find((candidate) => candidate.index === index);
      if (caseSpec) await writeJsonAtomic(caseFilePath(caseSpec), record);
      outcomes.set(index, { ...outcome, record });
    }
  }
  const completedRecords = cases
    .map((caseSpec) => outcomes.get(caseSpec.index)?.record)
    .filter((record) => record?.status === "completed");
  const summary = makeSummary(cases, outcomes, completedRecords, {
    stopReason,
    fatalErrorCode,
    repair: makeRepairSummary(),
    cleanup: {
      temporaryBuildDirectoryRemoved: buildRoot ? !(await pathExists(buildRoot)) : true,
      runtimeDirectoryRemoved: cleanupRuntimeVerified,
      finalSqlitePersisted: await pathExists(databasePath),
      evidenceDirectoryPersisted: await pathExists(evidenceRoot),
    },
  });
  await writeJsonAtomic(summaryJsonPath, summary).catch((error) => {
    const code = safeErrorCode(error, "native_error");
    console.error(JSON.stringify({ event: "summary", code }));
    fatalErrorCode ??= code;
  });
  await writeFile(summaryMarkdownPath, markdownSummary(summary), { encoding: "utf8", mode: 0o600 }).catch((error) => {
    const code = safeErrorCode(error, "native_error");
    console.error(JSON.stringify({ event: "summary", code }));
    fatalErrorCode ??= code;
  });
  reportProgress(cases, outcomes, 0, stopReason, true);
}

if (fatalErrorCode) process.exitCode = 1;
