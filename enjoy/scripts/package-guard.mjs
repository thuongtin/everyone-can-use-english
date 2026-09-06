import { lstat, realpath, unlink } from "node:fs/promises";
import path from "node:path";

const isMissingPathError = (error) => error?.code === "ENOENT";

/**
 * Remove only the Yarn self-link that points node_modules/node_modules back to
 * the project's own node_modules directory.
 *
 * A real directory, a dangling link, and a link to any other directory are
 * intentionally left untouched.
 */
export async function removeRecursiveNodeModulesLink(projectRoot) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError("projectRoot must be a non-empty string");
  }

  const rootNodeModules = path.resolve(projectRoot, "node_modules");
  const recursiveLink = path.join(rootNodeModules, "node_modules");

  let entryStat;
  try {
    entryStat = await lstat(recursiveLink);
  } catch (error) {
    if (isMissingPathError(error)) {
      return { removed: false, reason: "missing", path: recursiveLink };
    }
    throw error;
  }

  if (!entryStat.isSymbolicLink()) {
    return { removed: false, reason: "not-a-symlink", path: recursiveLink };
  }

  let entryPath;
  let rootPath;
  try {
    [entryPath, rootPath] = await Promise.all([
      realpath(recursiveLink),
      realpath(rootNodeModules),
    ]);
  } catch (error) {
    if (isMissingPathError(error)) {
      return { removed: false, reason: "missing-target", path: recursiveLink };
    }
    throw error;
  }

  if (entryPath !== rootPath) {
    return { removed: false, reason: "different-target", path: recursiveLink };
  }

  await unlink(recursiveLink);
  return { removed: true, reason: "root-node-modules-link", path: recursiveLink };
}
