import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readlink, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { removeRecursiveNodeModulesLink } from "./package-guard.mjs";

const makeProject = async (root, name) => {
  const projectRoot = path.join(root, name);
  await mkdir(path.join(projectRoot, "node_modules"), { recursive: true });
  return projectRoot;
};

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "enjoy-package-guard-"));

try {
  const missingProject = await makeProject(tempRoot, "missing");
  const missing = await removeRecursiveNodeModulesLink(missingProject);
  assert.equal(missing.removed, false);
  assert.equal(missing.reason, "missing");

  const directoryProject = await makeProject(tempRoot, "directory");
  const directoryPath = path.join(directoryProject, "node_modules", "node_modules");
  await mkdir(directoryPath);
  const directory = await removeRecursiveNodeModulesLink(directoryProject);
  assert.equal(directory.removed, false);
  assert.equal(directory.reason, "not-a-symlink");
  assert.equal((await lstat(directoryPath)).isDirectory(), true);

  const rootLinkProject = await makeProject(tempRoot, "root-link");
  const rootNodeModules = path.join(rootLinkProject, "node_modules");
  const rootLinkPath = path.join(rootNodeModules, "node_modules");
  await symlink(rootNodeModules, rootLinkPath, "dir");
  const rootLink = await removeRecursiveNodeModulesLink(rootLinkProject);
  assert.equal(rootLink.removed, true);
  await assert.rejects(() => lstat(rootLinkPath), { code: "ENOENT" });

  const foreignTargetProject = await makeProject(tempRoot, "foreign-target");
  const foreignTarget = path.join(tempRoot, "foreign-node-modules");
  await mkdir(foreignTarget);
  const foreignLinkPath = path.join(foreignTargetProject, "node_modules", "node_modules");
  await symlink(foreignTarget, foreignLinkPath, "dir");
  const foreignLink = await removeRecursiveNodeModulesLink(foreignTargetProject);
  assert.equal(foreignLink.removed, false);
  assert.equal(foreignLink.reason, "different-target");
  assert.equal(await readlink(foreignLinkPath), foreignTarget);

  const danglingProject = await makeProject(tempRoot, "dangling");
  const danglingLinkPath = path.join(danglingProject, "node_modules", "node_modules");
  const missingTarget = path.join(tempRoot, "missing-node-modules-target");
  await symlink(missingTarget, danglingLinkPath, "dir");
  const dangling = await removeRecursiveNodeModulesLink(danglingProject);
  assert.equal(dangling.removed, false);
  assert.equal(dangling.reason, "missing-target");
  assert.equal((await lstat(danglingLinkPath)).isSymbolicLink(), true);

  console.info("check-package-guard: PASS (missing, directory, root link, foreign link, dangling link)");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
