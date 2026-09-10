import { ipcMain, IpcMainEvent } from "electron";
import { Speech } from "@main/db/models";
import fs from "fs-extra";
import path from "path";
import settings from "@main/settings";
import { hashFile } from "@main/utils";
import { Attributes, WhereOptions } from "sequelize";
import {
  getAzureSpeechConfig,
  setAzureSpeechConfig,
  type AzureSpeechConfigUpdate,
} from "@main/speech/azure-config";

const activeSpeechJobs = new Set<AbortController>();

class SpeechesHandler {
  private async findOne(
    _event: IpcMainEvent,
    where: WhereOptions<Attributes<Speech>>
  ) {
    const speech = await Speech.findOne({ where });
    if (!speech) {
      return null;
    }

    return speech.toJSON();
  }

  private async create(
    event: IpcMainEvent,
    params: {
      sourceId: string;
      sourceType: string;
      text: string;
      section?: number;
      segment?: number;
      configuration: {
        engine: string;
        model: string;
        voice: string;
      };
    },
    blob: {
      type: string;
      arrayBuffer: ArrayBuffer;
    }
  ) {
    const format = blob.type.split("/")[1];
    const filename = `${Date.now()}.${format}`;
    const file = path.join(settings.userDataPath(), "speeches", filename);
    await fs.outputFile(file, Buffer.from(blob.arrayBuffer));
    const md5 = await hashFile(file, { algo: "md5" });
    fs.renameSync(file, path.join(path.dirname(file), `${md5}.${format}`));

    return Speech.create({ ...params, extname: `.${format}`, md5 })
      .then((speech) => {
        return speech.toJSON();
      })
      .catch((err) => {
        event.sender.send("on-notification", {
          type: "error",
          message: err.message,
        });
      });
  }

  private async generate(
    event: IpcMainEvent,
    params: {
      sourceId: string;
      sourceType: string;
      text: string;
      section?: number;
      segment?: number;
      configuration?: {
        engine?: string;
        model?: string;
        voice?: string;
        baseUrl?: string;
      };
    }
  ) {
    const controller = new AbortController();
    const abortOnOwnerDestroyed = (): void => controller.abort();
    activeSpeechJobs.add(controller);
    event.sender.once("destroyed", abortOnOwnerDestroyed);
    try {
      return (await Speech.generate({ ...params, signal: controller.signal })).toJSON();
    } finally {
      event.sender.removeListener("destroyed", abortOnOwnerDestroyed);
      activeSpeechJobs.delete(controller);
    }
  }

  private async getAzureConfig() {
    return getAzureSpeechConfig();
  }

  private async setAzureConfig(
    _event: IpcMainEvent,
    update: AzureSpeechConfigUpdate
  ) {
    return setAzureSpeechConfig(update);
  }

  private async delete(event: IpcMainEvent, id: string) {
    await Speech.destroy({ where: { id } });
  }

  register() {
    ipcMain.handle("speeches-find-one", this.findOne);
    ipcMain.handle("speeches-create", this.create);
    ipcMain.handle("speeches-generate", this.generate);
    ipcMain.handle("speeches-delete", this.delete);
    ipcMain.handle("azure-speech-config-get", this.getAzureConfig);
    ipcMain.handle("azure-speech-config-set", this.setAzureConfig);
  }

  unregister() {
    for (const controller of activeSpeechJobs) controller.abort();
    activeSpeechJobs.clear();
    ipcMain.removeHandler("speeches-find-one");
    ipcMain.removeHandler("speeches-create");
    ipcMain.removeHandler("speeches-generate");
    ipcMain.removeHandler("speeches-delete");
    ipcMain.removeHandler("azure-speech-config-get");
    ipcMain.removeHandler("azure-speech-config-set");
  }
}

export const speechesHandler = new SpeechesHandler();
