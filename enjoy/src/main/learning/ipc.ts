import { ipcMain, type BrowserWindow } from "electron";
import { createLearningIpcGuard } from "./ipc-guard";
import type { LearningRuntime } from "./runtime";
import { LearningController } from "./controller";
import type { LearningSession, LearningContext, LearningOperationMap } from "../../types/learning-api";

const SAFE_ERRORS = new Set([
  "learning_ipc_sender_denied", "learning_context_denied", "learning_not_ready", "learning_request_invalid",
  "learning_not_found", "learning_revision_conflict", "learning_asset_cleanup_failed", "learning_request_failed",
  "learning_cleanup_failed", "learning_service_closed", "profile_changed", "profile_closed", "profile_quiesce_failed",
  "resource_busy", "invalid_id", "invalid_content", "invalid_reference", "invalid_layout", "invalid_answer", "invalid_exercise",
  "invalid_audio", "asset_too_large", "asset_conflict", "learning_revision_busy", "learning_job_not_retryable",
  "native_auth_required", "native_unsupported_version", "native_missing", "native_probe_failed", "native_text_unavailable",
  "native_capability_unavailable", "native_generation_failed", "native_provider_unavailable",
  "native_auth_unconfirmed", "native_version_unsupported", "native_binary_missing", "native_unavailable",
  "native_workspace_failed", "native_cleanup_failed", "speech_not_configured", "learning_stage_busy",
  "learning_resource_busy", "learning_request_conflict", "learning_job_invalid", "learning_attempt_stale",
  "acp_node_unavailable", "acp_node_unsupported", "acp_adapter_unavailable", "acp_adapter_changed", "native_model_unavailable",
  "azure_text_not_configured", "azure_text_auth", "azure_text_quota", "azure_text_timeout", "azure_text_cancelled",
  "azure_text_failed", "azure_text_invalid", "learning_validation_exhausted",
]);

function safeError(error: unknown): Error {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return new Error(typeof code === "string" && SAFE_ERRORS.has(code) ? code : "learning_request_failed");
}

/** Only the pinned app main frame can use this bridge. Profile identity is checked again by the controller. */
export function registerLearningIpc(window: BrowserWindow, expectedUrl: string, getRuntime: () => LearningRuntime | null): void {
  const guard = createLearningIpcGuard({ webContentsId: window.webContents.id, expectedUrl });
  const capabilityCache = new WeakMap<LearningRuntime, LearningSession["capabilities"]>();
  const capabilityRefreshVersion = new WeakMap<LearningRuntime, number>();
  const current = () => {
    const runtime = getRuntime();
    if (!runtime) throw Object.assign(new Error("learning_not_ready"), { code: "learning_not_ready" });
    runtime.scope.assertOpen();
    return runtime;
  };
  ipcMain.removeHandler("learning-context");
  ipcMain.removeHandler("learning-request");
  ipcMain.handle("learning-context", async (event, options?: { refreshCapabilities?: boolean }): Promise<LearningSession> => {
    try {
      guard.assertSender(event);
      const runtime = current();
      if (options !== undefined && (
        !options || typeof options !== "object" || Array.isArray(options)
        || Object.keys(options).some(key => key !== "refreshCapabilities")
        || (options.refreshCapabilities !== undefined && typeof options.refreshCapabilities !== "boolean")
      )) throw Object.assign(new Error("learning_request_invalid"), { code: "learning_request_invalid" });
      const refreshVersion = options?.refreshCapabilities
        ? (capabilityRefreshVersion.get(runtime) ?? 0) + 1
        : 0;
      if (options?.refreshCapabilities) capabilityRefreshVersion.set(runtime, refreshVersion);
      const capabilities = options?.refreshCapabilities
        ? await runtime.generation.capabilities({ fresh: true })
        : capabilityCache.get(runtime) ?? (["codex", "claude", "azure-openai"] as const).map(provider => ({
          provider, text: false, image: false, reason: "native_not_checked",
        }));
      runtime.scope.assertOpen();
      if (current() !== runtime) throw Object.assign(new Error("profile_changed"), { code: "profile_changed" });
      if (options?.refreshCapabilities && capabilityRefreshVersion.get(runtime) === refreshVersion) {
        capabilityCache.set(runtime, capabilities);
      }
      return {
        profileId: runtime.scope.context.profileId,
        connectionId: runtime.scope.context.connectionId,
        capabilities,
        healthError: runtime.healthError ?? null,
      };
    } catch (error) { throw safeError(error); }
  });
  ipcMain.handle("learning-request", async (event, context: LearningContext, action: keyof LearningOperationMap, input: unknown) => {
    try {
      guard.assertSender(event);
      return await new LearningController(current()).request(context, action, input as never);
    } catch (error) { throw safeError(error); }
  });
}
