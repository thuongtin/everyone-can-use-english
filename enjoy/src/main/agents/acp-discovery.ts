import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAcpSession, type AcpModelOption } from "./acp-client";
import { probeNativeAgent } from "./native-discovery";
import { NativeAgentError, type NativeAgentProbe, type NativeAgentProvider } from "./native-types";

export type AcpAgentInspection = Readonly<{
  probe: NativeAgentProbe;
  models: readonly AcpModelOption[];
  currentModel: string | null;
}>;

function unavailable(probe: NativeAgentProbe, reason: string): AcpAgentInspection {
  return {
    probe: Object.freeze({ ...probe, text: false, reason }),
    models: [],
    currentModel: null,
  };
}

/** Probe native auth, then perform an ACP handshake and prompt-free session discovery. */
export async function inspectAcpAgent(provider: NativeAgentProvider, options: { signal?: AbortSignal } = {}): Promise<AcpAgentInspection> {
  if (options.signal?.aborted) throw new NativeAgentError("native_cancelled");
  const probe = await probeNativeAgent(provider);
  if (options.signal?.aborted) throw new NativeAgentError("native_cancelled");
  if (!probe.text || !probe.executable) return { probe, models: [], currentModel: null };

  const workspace = await mkdtemp(join(tmpdir(), "enjoy-acp-inspect-workspace-"));
  const privateHome = await mkdtemp(join(tmpdir(), "enjoy-acp-inspect-profile-"));
  const controller = new AbortController();
  let cleanupVerified = true;
  try {
    const result = await runAcpSession({
      provider,
      executable: probe.executable,
      workspace,
      privateHome,
      signal: options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal,
      timeoutMs: 30_000,
    });
    return {
      probe,
      models: result.models,
      currentModel: result.model,
    };
  } catch (error) {
    if (error instanceof NativeAgentError && error.cleanup) {
      try {
        await error.cleanup();
      } catch {
        cleanupVerified = false;
        const retryCleanup = error.cleanup;
        throw new NativeAgentError("native_cleanup_failed", async () => {
          await retryCleanup();
          await Promise.all([
            rm(workspace, { recursive: true, force: true }),
            rm(privateHome, { recursive: true, force: true }),
          ]);
        });
      }
    }
    const reason = error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : "acp_probe_failed";
    return unavailable(probe, cleanupVerified ? reason : "native_cleanup_failed");
  } finally {
    controller.abort();
    if (cleanupVerified) {
      await Promise.all([
        rm(workspace, { recursive: true, force: true }),
        rm(privateHome, { recursive: true, force: true }),
      ]);
    }
  }
}

export async function probeAcpAgent(provider: NativeAgentProvider, options: { signal?: AbortSignal } = {}): Promise<NativeAgentProbe> {
  return (await inspectAcpAgent(provider, options)).probe;
}
