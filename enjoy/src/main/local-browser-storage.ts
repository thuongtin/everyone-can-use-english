import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Keep the previous encrypted browser store intact when disabling cookie encryption. */
export function prepareLocalBrowserStorage(userDataPath: string): string {
  const sessionPath = join(userDataPath, "local-browser-v1");
  mkdirSync(sessionPath, { recursive: true, mode: 0o700 });
  const metadata = lstatSync(sessionPath);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Invalid local browser storage directory");
  }
  chmodSync(sessionPath, 0o700);
  return sessionPath;
}
