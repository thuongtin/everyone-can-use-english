import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { AcpConnectionStatus, AcpTextRequest, AcpTextUpdate } from "../../types/acp-api";
import type { LearningRuntime } from "../learning/runtime";
import { AcpNativeAgent } from "./acp-native";
import { inspectAcpAgent, probeAcpAgent } from "./acp-discovery";
import type { NativeAgentAdapter, NativeAgentProvider } from "./native-types";

const requestSchema = z.object({
  requestId: z.string().uuid(),
  provider: z.enum(["codex", "claude"]),
  model: z.string().trim().min(1).max(200).optional(),
  messages: z.array(z.object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string().min(1).max(120_000),
  }).strict()).min(1).max(100),
}).strict().refine(request => request.messages.reduce((size, message) => size + message.content.length, 0) <= 120_000);

type TextTask = {
  controller: AbortController;
  done: Promise<void>;
  cleanup?: () => Promise<void>;
};

type StatusTask = {
  runtime?: LearningRuntime;
  controller: AbortController;
  done: Promise<AcpConnectionStatus[]>;
  cleanups: Array<() => Promise<void>>;
  unregister: () => void;
};

type ServiceDependencies = {
  probe?: typeof probeAcpAgent;
  inspect?: typeof inspectAcpAgent;
  adapters?: Partial<Record<NativeAgentProvider, NativeAgentAdapter>>;
};

const failure = (code: string) => Object.assign(new Error(code), { code });

/** Owns bounded, profile-scoped text requests. The renderer cannot choose files or tools. */
export class AcpTextService {
  private readonly tasks = new Map<string, TextTask>();
  private readonly adapters: Record<NativeAgentProvider, NativeAgentAdapter>;
  private readonly probe: typeof probeAcpAgent;
  private readonly inspect: typeof inspectAcpAgent;
  private statusTask?: StatusTask;

  constructor(dependencies: ServiceDependencies = {}) {
    this.probe = dependencies.probe ?? probeAcpAgent;
    this.inspect = dependencies.inspect ?? inspectAcpAgent;
    this.adapters = {
      codex: dependencies.adapters?.codex ?? new AcpNativeAgent("codex"),
      claude: dependencies.adapters?.claude ?? new AcpNativeAgent("claude"),
    };
  }

  async status(runtime?: LearningRuntime): Promise<AcpConnectionStatus[]> {
    runtime?.scope.assertOpen();
    if (this.statusTask) {
      if (this.statusTask.runtime === runtime && this.statusTask.cleanups.length === 0) return this.statusTask.done;
      await this.closeStatus();
    }
    const task: StatusTask = {
      runtime, controller: new AbortController(), done: Promise.resolve([]),
      cleanups: [], unregister: () => undefined,
    };
    this.statusTask = task;
    task.unregister = runtime?.scope.registerCancellation(() => this.closeStatus()) ?? (() => undefined);
    const inspect = () => Promise.all((["codex", "claude"] as const).map(async provider => {
      try {
        const { probe, models, currentModel } = await this.inspect(provider, { signal: task.controller.signal });
        return { provider, available: probe.text, reason: probe.reason, models: [...models], currentModel };
      } catch (error) {
        const cleanupFailed = error && typeof error === "object" && "cleanup" in error && typeof error.cleanup === "function";
        if (cleanupFailed) {
          task.cleanups.push(error.cleanup.bind(error) as () => Promise<void>);
        }
        return { provider, available: false, reason: cleanupFailed ? "native_cleanup_failed" : "native_probe_failed", models: [], currentModel: null };
      }
    }));
    task.done = (runtime ? runtime.scope.run(inspect) : inspect()).finally(() => {
      if (task.cleanups.length === 0) {
        task.unregister();
        if (this.statusTask === task) this.statusTask = undefined;
      }
    });
    return task.done;
  }

  private async closeStatus(): Promise<void> {
    const task = this.statusTask;
    if (!task) return;
    task.controller.abort();
    await task.done.catch((): undefined => undefined);
    for (const cleanup of [...task.cleanups]) {
      await cleanup();
      task.cleanups.splice(task.cleanups.indexOf(cleanup), 1);
    }
    task.unregister();
    if (this.statusTask === task) this.statusTask = undefined;
  }

  async invoke(runtime: LearningRuntime, value: AcpTextRequest, onUpdate: (update: AcpTextUpdate) => void) {
    const parsed = requestSchema.safeParse(value);
    if (!parsed.success) throw failure("acp_request_invalid");
    const request = parsed.data;
    if (this.tasks.has(request.requestId)) throw failure("acp_request_busy");
    if (this.tasks.size >= 4) throw failure("acp_concurrency_limit");
    runtime.scope.assertOpen();

    let finish!: () => void;
    const task: TextTask = { controller: new AbortController(), done: new Promise(resolve => { finish = resolve; }) };
    this.tasks.set(request.requestId, task);
    const unregister = runtime.scope.registerCancellation(() => this.cancel(request.requestId));
    let directory: string | undefined;
    let safeToRemove = true;
    const publish = (update: Omit<AcpTextUpdate, "requestId">) => {
      if (task.controller.signal.aborted || runtime.scope.signal.aborted) return;
      try { onUpdate({ requestId: request.requestId, ...update }); } catch { /* A closed renderer cannot retain a request. */ }
    };

    try {
      return await runtime.scope.run(async (_context, profileSignal) => {
        const signal = AbortSignal.any([profileSignal, task.controller.signal]);
        const probe = await this.probe(request.provider, { signal });
        if (signal.aborted) throw failure("native_cancelled");
        if (!probe.text || !probe.executable) throw failure(probe.reason || "native_unavailable");
        directory = await mkdtemp(join(tmpdir(), "enjoy-acp-text-"));
        const workspace = join(directory, "workspace");
        const privateHome = join(directory, "private-home");
        await Promise.all([mkdir(workspace, { mode: 0o700 }), mkdir(privateHome, { mode: 0o700 })]);
        const result = await this.adapters[request.provider].run({
          executable: probe.executable, workspace, privateHome,
          model: request.model, signal, timeoutMs: 300_000,
          systemPrompt: request.messages.filter(message => message.role === "system").map(message => message.content).join("\n\n"),
          prompt: [
            "You are the text assistant inside Enjoy, a personal English learning app.",
            "Answer using the supplied conversation only. Do not use files, terminals, external tools, or MCP servers.",
            "The following JSON is the local user and assistant conversation in chronological order.",
            JSON.stringify(request.messages.filter(message => message.role !== "system")),
          ].join("\n"),
          onEvent: event => {
            if (event.type === "text") publish({ type: "text", text: event.text });
            else if (event.type === "started") publish({ type: "started" });
          },
        });
        if (signal.aborted) throw failure("native_cancelled");
        runtime.scope.assertOpen();
        if (!result.text.trim()) throw failure("acp_empty_response");
        publish({ type: "completed" });
        return { text: result.text, model: result.model };
      });
    } catch (error) {
      if (error && typeof error === "object" && "cleanup" in error && typeof error.cleanup === "function") {
        const cleanup = error.cleanup.bind(error) as () => Promise<void>;
        safeToRemove = false;
        task.cleanup = async () => {
          await cleanup();
          if (directory) await rm(directory, { recursive: true, force: true });
          this.tasks.delete(request.requestId);
          unregister();
        };
      }
      throw error;
    } finally {
      if (safeToRemove) {
        try {
          if (directory) await rm(directory, { recursive: true, force: true });
        } finally {
          this.tasks.delete(request.requestId);
          unregister();
          finish();
        }
      } else finish();
    }
  }

  async cancel(requestId: string): Promise<void> {
    const task = this.tasks.get(requestId);
    if (!task) return;
    task.controller.abort();
    await task.done;
    await task.cleanup?.();
  }

  async close(): Promise<void> {
    const outcomes = await Promise.allSettled([this.closeStatus(), ...[...this.tasks.keys()].map(id => this.cancel(id))]);
    if (outcomes.some(outcome => outcome.status === "rejected")) throw failure("native_cleanup_failed");
  }
}
