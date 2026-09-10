import type { Sequelize } from "sequelize";
import { createLearningModels } from "../db/learning-models";
import { LearningProfileScope } from "./profile-scope";
import { LearningStorage } from "./storage";
import { LearningAssetStore } from "./asset-store";
import { LearningAssetProtocol } from "./asset-protocol";
import { LearningApplication } from "./service";
import { NativeLearningGeneration } from "./native-generation";
import type { SpeechProvider } from "../speech/provider";

type RuntimeOptions = {
  sequelize: Sequelize;
  profileId: string;
  assetRoot: string;
  watchdogMs?: number;
  speechProviderFactory?: () => Promise<SpeechProvider | null>;
};

/** Owns one profile connection. Native capabilities are attached only after their acceptance gates. */
export class LearningRuntime {
  readonly scope: LearningProfileScope;
  readonly storage: LearningStorage;
  readonly assets: LearningAssetStore;
  readonly application: LearningApplication;
  readonly protocol: LearningAssetProtocol;
  readonly generation: NativeLearningGeneration;
  private readonly attempts = new Map<string, { stop: () => Promise<void>; unregister: () => void }>();
  private readonly pendingStops = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking: Promise<void> | undefined;
  private watchdogError: string | undefined;

  private constructor(options: RuntimeOptions) {
    this.scope = new LearningProfileScope(options.profileId, options.assetRoot);
    const models = createLearningModels(options.sequelize);
    this.storage = new LearningStorage({
      sequelize: options.sequelize, models, scope: this.scope,
      isAttemptTracked: (id) => this.attempts.has(id) || this.pendingStops.has(id),
    });
    this.assets = new LearningAssetStore(this.scope.context.assetRoot);
    this.application = new LearningApplication(this.storage);
    this.protocol = new LearningAssetProtocol({ scope: this.scope, models, assets: this.assets });
    this.generation = new NativeLearningGeneration(this, { speechProviderFactory: options.speechProviderFactory });
    this.scope.registerCancellation(async () => {
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
      await this.ticking?.catch((): undefined => undefined);
    });
  }

  static async open(options: RuntimeOptions): Promise<LearningRuntime> {
    const interval = options.watchdogMs ?? 1000;
    if (!Number.isSafeInteger(interval) || interval < 0 || (interval > 0 && interval < 100)) {
      throw new Error("learning_watchdog_interval_invalid");
    }
    const runtime = new LearningRuntime(options);
    try {
      await runtime.assets.initialize();
      await runtime.assets.cleanupStaging();
      await runtime.application.jobs.recoverInterrupted();
      const referencedAssets = await runtime.storage.models.GeneratedAsset.findAll({
        attributes: ["relativePath"],
        where: { profileId: runtime.scope.context.profileId },
      });
      await runtime.assets.cleanupUnreferenced(
        referencedAssets
          .map((asset) => asset.relativePath)
          .filter((relativePath): relativePath is string => typeof relativePath === "string"),
      );
      if (interval) {
        runtime.timer = setInterval(() => {
          void runtime.tick().catch(() => { runtime.watchdogError = "learning_watchdog_failed"; });
        }, interval);
        runtime.timer.unref();
      }
      return runtime;
    } catch (error) {
      await runtime.close();
      throw error;
    }
  }

  get healthError(): string | undefined { return this.watchdogError; }

  /** Register before launching provider work. Cleanup must verify that the owned process has exited. */
  trackAttempt(attemptId: string, cancel: () => Promise<void>): () => void {
    this.scope.assertOpen();
    if (this.attempts.has(attemptId)) throw new Error("learning_attempt_already_tracked");
    let stopping: Promise<void> | undefined;
    const stop = () => {
      if (!stopping) {
        stopping = Promise.resolve().then(cancel).then(() => this.application.releaseAttempt(attemptId));
        stopping.catch(() => { stopping = undefined; });
      }
      return stopping;
    };
    const unregister = this.scope.registerCancellation(stop);
    this.attempts.set(attemptId, { stop, unregister });
    return () => {
      unregister();
      this.attempts.delete(attemptId);
    };
  }

  tick(): Promise<void> {
    if (this.ticking) return this.ticking;
    if (this.scope.state !== "open") return Promise.resolve();
    this.ticking = (async () => {
      const expired = await this.application.jobs.expireLeases();
      for (const id of new Set([...expired, ...this.pendingStops])) await this.cancelAttempt(id);
      this.watchdogError = undefined;
    })().finally(() => { this.ticking = undefined; });
    return this.ticking;
  }

  async cancelAttempt(id: string): Promise<void> {
    const owned = this.attempts.get(id);
    try {
      if (owned) {
        await owned.stop();
        owned.unregister();
        this.attempts.delete(id);
      } else {
        await this.application.releaseAttempt(id);
      }
      this.pendingStops.delete(id);
    } catch (error) {
      this.pendingStops.add(id);
      this.watchdogError = "learning_cleanup_failed";
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.scope.quiesce();
    this.attempts.clear();
    this.pendingStops.clear();
  }
}
