import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type LearningCapabilityIdentity = Readonly<{
  profileId: string;
  connectionId: string;
  jobId: string;
  stageId: string;
  attemptId: string;
  revisionId: string;
}>;

export type LearningCapabilityGrant = LearningCapabilityIdentity & Readonly<{
  tools: readonly string[];
  expiresAt: number;
}>;

type GrantRecord = { digest: Buffer; grant: LearningCapabilityGrant };
const identityKeys = ["profileId", "connectionId", "jobId", "stageId", "attemptId", "revisionId"] as const;
const denied = () => Object.assign(new Error("capability_denied"), { code: "capability_denied" });
const MAX_TTL_MS = 15 * 60 * 1000;

/** Ephemeral main-process grants. Plain bearer values are never retained here. */
export class LearningCapabilityRegistry {
  private readonly records = new Set<GrantRecord>();
  private readonly now: () => number;
  private readonly maxGrants: number;

  constructor(options: { now?: () => number; maxGrants?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.maxGrants = options.maxGrants ?? 64;
    if (!Number.isInteger(this.maxGrants) || this.maxGrants < 1 || this.maxGrants > 1024) {
      throw new TypeError("Invalid capability capacity");
    }
  }

  issue(input: LearningCapabilityIdentity & { tools: readonly string[] }, ttlMs = MAX_TTL_MS): string {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS ||
      identityKeys.some((key) => typeof input[key] !== "string" || !input[key] || input[key].length > 200) ||
      !Array.isArray(input.tools) || input.tools.length === 0 || input.tools.length > 16 ||
      input.tools.some((tool) => typeof tool !== "string" || !/^enjoy\.[a-z_]+$/.test(tool))) {
      throw new TypeError("Invalid capability grant");
    }
    this.prune();
    if (this.records.size >= this.maxGrants) {
      throw Object.assign(new Error("capability_limit"), { code: "capability_limit" });
    }
    const token = randomBytes(32).toString("base64url");
    const grant: LearningCapabilityGrant = Object.freeze({
      profileId: input.profileId,
      connectionId: input.connectionId,
      jobId: input.jobId,
      stageId: input.stageId,
      attemptId: input.attemptId,
      revisionId: input.revisionId,
      tools: Object.freeze([...new Set(input.tools)]),
      expiresAt: this.now() + ttlMs,
    });
    this.records.add({ digest: this.digest(token), grant });
    return token;
  }

  resolve(token: unknown): LearningCapabilityGrant {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw denied();
    this.prune();
    const digest = this.digest(token);
    let match: LearningCapabilityGrant | undefined;
    // Compare fixed-size digests; scope checks never reveal bearer values.
    for (const record of this.records) {
      if (timingSafeEqual(record.digest, digest)) match = record.grant;
    }
    if (!match) throw denied();
    return match;
  }

  authorize(token: unknown, request: LearningCapabilityIdentity & { tool: string }): LearningCapabilityGrant {
    const grant = this.resolve(token);
    if (identityKeys.some((key) => grant[key] !== request[key]) || !grant.tools.includes(request.tool)) {
      throw denied();
    }
    return grant;
  }

  revoke(scope: Partial<LearningCapabilityIdentity>): void {
    const keys = identityKeys.filter((key) => scope[key] !== undefined);
    if (keys.length === 0) throw new TypeError("A revocation scope is required");
    for (const record of this.records) {
      if (keys.every((key) => record.grant[key] === scope[key])) this.records.delete(record);
    }
  }

  revokeAll(): void { this.records.clear(); }

  private prune(): void {
    const now = this.now();
    for (const record of this.records) {
      if (record.grant.expiresAt <= now) this.records.delete(record);
    }
  }

  private digest(token: string): Buffer {
    return createHash("sha256").update(token).digest();
  }
}
