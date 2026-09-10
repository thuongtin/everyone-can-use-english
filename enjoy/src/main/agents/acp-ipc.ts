import { ipcMain, type BrowserWindow } from "electron";
import type { LearningRuntime } from "../learning/runtime";
import { createLearningIpcGuard } from "../learning/ipc-guard";
import { AcpTextService } from "./acp-text-service";
import type { AcpTextRequest } from "../../types/acp-api";

const safeError = (error: unknown) => {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return new Error(typeof code === "string" && /^(?:acp|native|profile|learning)_[a-z_]{1,60}$/.test(code)
    ? code : "acp_request_failed");
};

export function registerAcpIpc(window: BrowserWindow, expectedUrl: string, getRuntime: () => LearningRuntime | null) {
  const guard = createLearningIpcGuard({ webContentsId: window.webContents.id, expectedUrl });
  const service = new AcpTextService();
  const current = () => {
    const runtime = getRuntime();
    if (!runtime) throw Object.assign(new Error("learning_not_ready"), { code: "learning_not_ready" });
    runtime.scope.assertOpen();
    return runtime;
  };
  for (const channel of ["acp-status", "acp-invoke", "acp-cancel"]) ipcMain.removeHandler(channel);
  ipcMain.handle("acp-status", async event => {
    try {
      guard.assertSender(event);
      const runtime = current();
      const status = await service.status(runtime);
      if (current() !== runtime) throw Object.assign(new Error("profile_changed"), { code: "profile_changed" });
      return status;
    } catch (error) { throw safeError(error); }
  });
  ipcMain.handle("acp-invoke", async (event, request: AcpTextRequest) => {
    try {
      guard.assertSender(event);
      const runtime = current();
      return await service.invoke(runtime, request, update => {
        guard.assertSender(event);
        if (current() === runtime) event.sender.send("acp-update", update);
      });
    } catch (error) { throw safeError(error); }
  });
  ipcMain.handle("acp-cancel", async (event, requestId: unknown) => {
    try {
      guard.assertSender(event);
      if (typeof requestId !== "string" || requestId.length > 100) throw new Error("Invalid request ID");
      await service.cancel(requestId);
    } catch (error) { throw safeError(error); }
  });
  window.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) void service.close().catch((): undefined => undefined);
  });
  window.on("closed", () => { void service.close().catch((): undefined => undefined); });
}
