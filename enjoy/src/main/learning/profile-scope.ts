import { randomUUID } from "node:crypto";
import path from "node:path";

export type LearningProfileContext = Readonly<{
  profileId: string;
  assetRoot: string;
  connectionId: string;
}>;

type ScopeErrorCode = "profile_changed" | "profile_closed" | "profile_quiesce_failed";
const scopeError = (code: ScopeErrorCode) => Object.assign(new Error(code), { code });

/** Owns the lifetime of work attached to one immutable database/profile binding. */
export class LearningProfileScope {
  readonly context: LearningProfileContext;
  private readonly controller = new AbortController();
  private readonly operations = new Set<Promise<unknown>>();
  private readonly cancellations = new Set<() => Promise<void>>();
  private draining: Promise<void> | undefined;
  private currentState: "open" | "closing" | "closed" = "open";

  constructor(profileId: string, assetRoot: string) {
    if (!profileId.trim() || !path.isAbsolute(assetRoot)) {
      throw new TypeError("An explicit profile and absolute asset root are required");
    }
    this.context = Object.freeze({
      profileId,
      assetRoot: path.resolve(assetRoot),
      connectionId: randomUUID(),
    });
  }

  get state() { return this.currentState; }
  get signal() { return this.controller.signal; }

  assertOpen(expected?: LearningProfileContext): void {
    if (expected && (
      expected.connectionId !== this.context.connectionId ||
      expected.profileId !== this.context.profileId
    )) {
      throw scopeError("profile_changed");
    }
    if (this.currentState !== "open") throw scopeError("profile_closed");
  }

  async run<T>(action: (
    context: LearningProfileContext,
    signal: AbortSignal,
  ) => Promise<T>): Promise<T> {
    this.assertOpen();
    const operation = Promise.resolve().then(() => {
      this.assertOpen();
      return action(this.context, this.signal);
    });
    this.operations.add(operation);
    try {
      return await operation;
    } finally {
      this.operations.delete(operation);
    }
  }

  registerCancellation(cancel: () => Promise<void>): () => void {
    this.assertOpen();
    this.cancellations.add(cancel);
    return () => { this.cancellations.delete(cancel); };
  }

  quiesce(): Promise<void> {
    if (this.currentState === "closed") return Promise.resolve();
    if (this.draining) return this.draining;

    this.currentState = "closing";
    this.controller.abort();
    this.draining = this.drain().finally(() => { this.draining = undefined; });
    return this.draining;
  }

  private async drain(): Promise<void> {
    const outcomes = await Promise.allSettled(
      [...this.cancellations].map(async (cancel) => {
        await cancel();
        this.cancellations.delete(cancel);
      }),
    );
    // New writes cannot start after closing; existing transactions finish on the old DB.
    await Promise.allSettled([...this.operations]);
    if (outcomes.some((outcome) => outcome.status === "rejected")) {
      // Keep closing and retry only failed child cleanup before any DB disconnect.
      throw scopeError("profile_quiesce_failed");
    }
    this.currentState = "closed";
  }
}
