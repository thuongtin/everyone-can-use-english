import { ipcMain, type BrowserWindow } from "electron";
import { createLearningIpcGuard } from "@main/learning/ipc-guard";
import {
  getCloudflareTranscribeConfig,
  setCloudflareTranscribeConfig,
} from "./config";

const CONFIG_GET_CHANNEL = "cloudflare-transcribe-config-get";
const CONFIG_SET_CHANNEL = "cloudflare-transcribe-config-set";

export function registerCloudflareTranscribeIpc(
  window: BrowserWindow,
  expectedUrl: string,
): void {
  const guard = createLearningIpcGuard({
    webContentsId: window.webContents.id,
    expectedUrl,
  });
  for (const channel of [
    CONFIG_GET_CHANNEL,
    CONFIG_SET_CHANNEL,
  ]) {
    ipcMain.removeHandler(channel);
  }

  // Inference goes through learning-asr. This bridge only manages the selected
  // Cloudflare Worker configuration used by that validated pipeline.
  ipcMain.handle(CONFIG_GET_CHANNEL, (event) => {
    guard.assertSender(event);
    return getCloudflareTranscribeConfig();
  });
  ipcMain.handle(CONFIG_SET_CHANNEL, (event, update) => {
    guard.assertSender(event);
    return setCloudflareTranscribeConfig(update);
  });
}

export function unregisterCloudflareTranscribeIpc(): void {
  for (const channel of [
    CONFIG_GET_CHANNEL,
    CONFIG_SET_CHANNEL,
  ]) {
    ipcMain.removeHandler(channel);
  }
}
