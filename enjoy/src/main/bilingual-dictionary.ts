import { ipcMain } from "electron";
import path from "node:path";
import { BilingualStore } from "./bilingual-store";

const directory = path.join(
  import.meta.dirname.replace("app.asar", "app.asar.unpacked"),
  "lib", "dictionaries"
);
const store = new BilingualStore(directory);

export default {
  registerIpcHandlers() {
    ipcMain.handle("bilingual-lookup", (_event, direction: BilingualDirection, word: string) =>
      store.lookup(direction, word)
    );
  },
};
