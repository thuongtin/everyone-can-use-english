import { app, BrowserWindow, protocol, dialog, session } from "electron";
import db from "@main/db";
import { isLearningAssetReference } from "@main/learning/active-runtime";
import path from "path";
import { serveLibraryFile } from "@main/library-file-response";
import fs from "fs-extra";
import settings from "@main/settings";
import mainWindow from "@main/window";
import ElectronSquirrelStartup from "electron-squirrel-startup";
import contextMenu from "electron-context-menu";
import { t } from "i18next";
import { installChromiumNetworkPolicy } from "@main/network-policy";
import { i18n } from "@main/i18n";
import { prepareLocalBrowserStorage } from "@main/local-browser-storage";
import { installNodeNetworkObserver } from "@main/node-network-observer";

installNodeNetworkObserver();

// Use a fresh Chromium store; the old encrypted cookies and app data stay intact.
app.setPath("sessionData", prepareLocalBrowserStorage(app.getPath("userData")));

i18n();

app.commandLine.appendSwitch("enable-features", "SharedArrayBuffer");

if (!app.isPackaged) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-software-rasterizer");
}

// Add context menu
contextMenu({
  showSearchWithGoogle: false,
  showInspectElement: false,
  showLookUpSelection: false,
  showLearnSpelling: false,
  showSelectAll: false,
  labels: {
    get copy() { return t("copy"); },
    get cut() { return t("cut"); },
    get paste() { return t("paste"); },
    get selectAll() { return t("selectAll"); },
  },
  shouldShowMenu: (_event, params) => {
    return params.isEditable || !!params.selectionText;
  },
  prepend: (
    _defaultActions,
    parameters,
    browserWindow: BrowserWindow
  ) => [
    {
      label: t("lookup"),
      visible:
        parameters.selectionText.trim().length > 0 &&
        !parameters.selectionText.trim().includes(" "),
      click: () => {
        const { x, y, selectionText } = parameters;
        browserWindow.webContents.send("on-lookup", selectionText, "", {
          x,
          y,
        });
      },
    },
    {
      label: t("aiTranslate"),
      visible: parameters.selectionText.trim().length > 0,
      click: () => {
        const { x, y, selectionText } = parameters;
        browserWindow.webContents.send("on-translate", selectionText, { x, y });
      },
    },
  ],
});

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (ElectronSquirrelStartup) {
  app.quit();
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "enjoy",
    privileges: {
      standard: true,
      secure: true,
      bypassCSP: true,
      allowServiceWorkers: true,
      supportFetchAPI: true,
      stream: true,
      codeCache: true,
      corsEnabled: true,
    },
  },
]);

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", async () => {
  installChromiumNetworkPolicy(app, session.defaultSession);
  if (!app.isPackaged) {
    import("electron-devtools-installer")
      .then((mymodule: any) => {
        const installExtension = mymodule.default.default; // Default export
        installExtension(mymodule.default.REACT_DEVELOPER_TOOLS, {
          loadExtensionOptions: {
            allowFileAccess: true,
          },
        }); // replace param with the ext ID of your choice
      })
      .catch((err) => console.log("An error occurred: ", err));
  }

  protocol.handle("enjoy", (request) => {
    if (isLearningAssetReference(request.url)) {
      return db.learning?.protocol.handle(request) ?? new Response("Learning asset unavailable", { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    let url = request.url.replace("enjoy://", "");
    if (
      url.match(
        /library\/(audios|videos|recordings|speeches|segments|documents)/g
      )
    ) {
      url = url.replace("library/", "");
      url = path.join(settings.userDataPath(), url);
    } else if (url.startsWith("library")) {
      url = url.replace("library/", "");
      url = path.join(settings.libraryPath(), url);
    }

    return serveLibraryFile(request, url);
  });

  mainWindow.init();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow.init();
  }
});

// Clean up cache folder before quit
let quitReady = false;
let quitPending = false;
app.on("before-quit", (event) => {
  if (quitReady) return;
  event.preventDefault();
  if (quitPending) return;
  quitPending = true;
  void db.shutdown().then(() => {
    try { fs.emptyDirSync(settings.cachePath()); } catch { /* Cache cleanup does not own running work. */ }
    quitReady = true;
    app.quit();
  }).catch(() => {
    quitPending = false;
    dialog.showErrorBox("Chưa thể đóng Enjoy", "Xưởng bài học chưa dừng xong tác vụ đang chạy. Hãy thử đóng ứng dụng lại sau ít giây.");
  });
});
