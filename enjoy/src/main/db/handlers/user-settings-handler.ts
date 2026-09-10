import { ipcMain, IpcMainEvent } from "electron";
import { UserSetting } from "@main/db/models";
import db from "@main/db";
import { UserSettingKeyEnum } from "@/types/enums";
import { getCloudflareTranscribeConfig } from "@main/cloudflare-transcribe/config";

const isProtectedSetting = (key: UserSettingKeyEnum): boolean =>
  key === UserSettingKeyEnum.CLOUDFLARE_TRANSCRIBE;

class UserSettingsHandler {
  private async get(_event: IpcMainEvent, key: UserSettingKeyEnum) {
    if (isProtectedSetting(key)) {
      return getCloudflareTranscribeConfig();
    }
    return await UserSetting.get(key);
  }

  private async set(
    _event: IpcMainEvent,
    key: UserSettingKeyEnum,
    value: string | object
  ) {
    if (isProtectedSetting(key)) {
      throw new Error("protected_user_setting");
    }
    await UserSetting.set(key, value);
  }

  private async delete(_event: IpcMainEvent, key: UserSettingKeyEnum) {
    await UserSetting.destroy({ where: { key } });
  }

  private async clear(_event: IpcMainEvent) {
    await UserSetting.destroy({ where: {} });
    db.connection.query("VACUUM");
  }

  register() {
    ipcMain.handle("user-settings-get", this.get);
    ipcMain.handle("user-settings-set", this.set);
    ipcMain.handle("user-settings-delete", this.delete);
    ipcMain.handle("user-settings-clear", this.clear);
  }

  unregister() {
    ipcMain.removeHandler("user-settings-get");
    ipcMain.removeHandler("user-settings-set");
    ipcMain.removeHandler("user-settings-delete");
    ipcMain.removeHandler("user-settings-clear");
  }
}

export const userSettingsHandler = new UserSettingsHandler();
