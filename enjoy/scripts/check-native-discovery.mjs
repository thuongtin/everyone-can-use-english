#!/usr/bin/env node

import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const enjoyRoot = path.resolve(scriptDirectory, "..");
const nodeRuntime = process.execPath;
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "enjoy-native-discovery-"));
const jobRoot = path.join(tempRoot, "job");
const bundlePath = path.join(tempRoot, "native-discovery.mjs");
await mkdir(jobRoot, { recursive: true });

const previousEnvironment = Object.fromEntries([
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "PATH",
  "LANG",
  "LC_ALL",
  "TERM",
  "TZ",
  "TMPDIR",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CODEX_API_KEY",
  "CLAUDE_API_KEY",
  "NATIVE_DISCOVERY_SECRET",
].map((key) => [key, process.env[key]]));

await build({
  entryPoints: [path.join(enjoyRoot, "src", "main", "agents", "native-discovery.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: bundlePath,
  logLevel: "silent",
});

const {
  discoverNativeExecutable,
  nativeAuthEnvironment,
  parseNativeVersion,
  probeNativeAgent,
} = await import(pathToFileURL(bundlePath).href);

const makeFixture = async (name, configuration) => {
  const executable = path.join(tempRoot, name);
  const transcript = path.join(tempRoot, `${name}.jsonl`);
  const descendantPid = path.join(tempRoot, `${name}.pid`);
  const descendantMarker = path.join(tempRoot, `${name}.survived`);
  const source = `#!${nodeRuntime}
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const envNames = [
  "HOME", "USER", "LOGNAME", "SHELL", "PATH", "LANG", "LC_ALL", "TERM", "TZ", "TMPDIR",
  "CODEX_HOME", "CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME",
  "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CODEX_API_KEY", "CLAUDE_API_KEY", "NATIVE_DISCOVERY_SECRET",
];
appendFileSync(${JSON.stringify(transcript)}, JSON.stringify({
  argv: args,
  env: Object.fromEntries(envNames.map((name) => [name, process.env[name] ?? null])),
}) + "\\n");

if (${JSON.stringify(configuration.timeout)} && args[0] === "--version") {
  setInterval(() => {}, 1_000);
} else if (${configuration.spawnDescendant === true} && args[0] === "--version") {
  const descendant = spawn(${JSON.stringify(nodeRuntime)}, ["-e", ${JSON.stringify(`setTimeout(() => { require("node:fs").appendFileSync(${JSON.stringify(descendantMarker)}, "survived"); }, 1_500);`)}], { stdio: "ignore" });
  appendFileSync(${JSON.stringify(descendantPid)}, String(descendant.pid));
  process.stdout.write(${JSON.stringify(configuration.versionOutput)});
  process.exit(${configuration.versionExit});
} else if (args[0] === "--version") {
  process.stdout.write(${JSON.stringify(configuration.versionOutput)});
  process.exitCode = ${configuration.versionExit};
} else {
  process.stdout.write(${JSON.stringify(configuration.authOutput)});
  process.exitCode = ${configuration.authExit};
}
`;
  await writeFile(executable, source, { mode: 0o755 });
  await chmod(executable, 0o755);
  return { executable, transcript, descendantPid, descendantMarker };
};

const readTranscript = async (transcript) => {
  const value = await readFile(transcript, "utf8");
  return value.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
};

const assertNoSecret = (value, secret) => {
  assert.equal(JSON.stringify(value).includes(secret), false, `secret leaked: ${secret}`);
};

const cases = [];
const test = async (name, action) => {
  await action();
  cases.push(name);
};

try {
  const testHome = path.join(tempRoot, "native-home");
  const testCodexHome = path.join(tempRoot, "codex-home");
  const testClaudeConfig = path.join(tempRoot, "claude-config");
  const testXdgConfig = path.join(tempRoot, "xdg-config");
  const testXdgCache = path.join(tempRoot, "xdg-cache");
  const testTmp = path.join(tempRoot, "tmp");
  await Promise.all([
    mkdir(testHome, { recursive: true }),
    mkdir(testCodexHome, { recursive: true }),
    mkdir(testClaudeConfig, { recursive: true }),
    mkdir(testXdgConfig, { recursive: true }),
    mkdir(testXdgCache, { recursive: true }),
    mkdir(testTmp, { recursive: true }),
  ]);

  Object.assign(process.env, {
    HOME: testHome,
    USER: "native-user",
    LOGNAME: "native-logname",
    SHELL: "/bin/zsh",
    PATH: "/usr/bin",
    LANG: "en_US.UTF-8",
    LC_ALL: "C.UTF-8",
    TERM: "xterm-256color",
    TZ: "Asia/Ho_Chi_Minh",
    TMPDIR: testTmp,
    CODEX_HOME: testCodexHome,
    CLAUDE_CONFIG_DIR: testClaudeConfig,
    XDG_CONFIG_HOME: testXdgConfig,
    XDG_CACHE_HOME: testXdgCache,
    OPENAI_API_KEY: "openai-secret",
    ANTHROPIC_API_KEY: "anthropic-secret",
    CODEX_API_KEY: "codex-secret",
    CLAUDE_API_KEY: "claude-secret",
    NATIVE_DISCOVERY_SECRET: "fixture-secret",
  });

  await test("exports a provider-specific environment allowlist", async () => {
    const codexEnvironment = nativeAuthEnvironment("codex", process.env);
    assert.deepEqual(codexEnvironment, {
      HOME: testHome,
      USER: "native-user",
      LOGNAME: "native-logname",
      SHELL: "/bin/zsh",
      PATH: "/usr/bin",
      LANG: "en_US.UTF-8",
      LC_ALL: "C.UTF-8",
      TERM: "xterm-256color",
      TZ: "Asia/Ho_Chi_Minh",
      TMPDIR: testTmp,
      CODEX_HOME: testCodexHome,
    });
    assertNoSecret(codexEnvironment, "openai-secret");
    assertNoSecret(codexEnvironment, "fixture-secret");

    const claudeEnvironment = nativeAuthEnvironment("claude", process.env);
    assert.equal(claudeEnvironment.CODEX_HOME, undefined);
    assert.equal(claudeEnvironment.CLAUDE_CONFIG_DIR, testClaudeConfig);
    assert.equal(claudeEnvironment.XDG_CONFIG_HOME, testXdgConfig);
    assert.equal(claudeEnvironment.XDG_CACHE_HOME, testXdgCache);
    assertNoSecret(claudeEnvironment, "anthropic-secret");
  });

  const codexFixture = await makeFixture("codex-supported", {
    versionOutput: "codex-cli 0.153.2\n",
    versionExit: 0,
    authOutput: "authenticated but intentionally discarded\\n",
    authExit: 0,
  });
  const codexProbe = await probeNativeAgent("codex", { binaryPath: codexFixture.executable, cwd: jobRoot });
  await test("probes Codex with exact argv, auth identity and capability flags", async () => {
    assert.equal(codexProbe.version, "0.153.2");
    assert.equal(codexProbe.authenticated, true);
    assert.equal(codexProbe.text, true);
    assert.equal(codexProbe.image, true);
    assert.equal(codexProbe.reason, null);
    assert.deepEqual((await readTranscript(codexFixture.transcript)).map((entry) => entry.argv), [
      ["--version"],
      ["login", "status"],
    ]);
    const authEntry = (await readTranscript(codexFixture.transcript))[1];
    assert.equal(authEntry.env.HOME, testHome);
    assert.equal(authEntry.env.USER, "native-user");
    assert.equal(authEntry.env.CODEX_HOME, testCodexHome);
    assert.equal(authEntry.env.OPENAI_API_KEY, null);
    assert.equal(authEntry.env.ANTHROPIC_API_KEY, null);
    assert.equal(authEntry.env.NATIVE_DISCOVERY_SECRET, null);
    assertNoSecret(codexProbe, "openai-secret");
  });

  await test("accepts the separately verified Codex patch version", async () => {
    const fixture = await makeFixture("codex-supported-patch", { versionOutput: "codex-cli 0.153.4\n", versionExit: 0, authOutput: "authenticated", authExit: 0 });
    const probe = await probeNativeAgent("codex", { binaryPath: fixture.executable, cwd: jobRoot });
    assert.equal(probe.version, "0.153.4");
    assert.equal(probe.text, true);
    assert.equal(probe.image, true);
  });

  const claudeFixture = await makeFixture("claude-supported", {
    versionOutput: "2.1.263 (Claude Code)\n",
    versionExit: 0,
    authOutput: JSON.stringify({ loggedIn: true, authMethod: "claude.ai", token: "fixture-secret" }),
    authExit: 0,
  });
  const claudeProbe = await probeNativeAgent("claude", { binaryPath: claudeFixture.executable, cwd: jobRoot });
  await test("probes Claude with bounded JSON status and no authMethod field", async () => {
    assert.equal(claudeProbe.version, "2.1.263");
    assert.equal(claudeProbe.authenticated, true);
    assert.equal(claudeProbe.text, true);
    assert.equal(claudeProbe.image, false);
    assert.equal(claudeProbe.reason, null);
    assert.equal(Object.prototype.hasOwnProperty.call(claudeProbe, "authMethod"), false);
    assert.deepEqual((await readTranscript(claudeFixture.transcript)).map((entry) => entry.argv), [
      ["--version"],
      ["auth", "status", "--json"],
    ]);
    assert.equal((await readTranscript(claudeFixture.transcript))[1].env.CODEX_HOME, null);
    assert.equal((await readTranscript(claudeFixture.transcript))[1].env.CLAUDE_CONFIG_DIR, testClaudeConfig);
    assert.equal((await readTranscript(claudeFixture.transcript))[1].env.ANTHROPIC_API_KEY, null);
    assertNoSecret(claudeProbe, "fixture-secret");
  });

  await test("accepts the separately verified installed Claude patch version", async () => {
    const fixture = await makeFixture("claude-supported-patch", {
      versionOutput: "2.1.266 (Claude Code)\n",
      versionExit: 0,
      authOutput: JSON.stringify({ loggedIn: true, authMethod: "claude.ai", token: "fixture-secret" }),
      authExit: 0,
    });
    const probe = await probeNativeAgent("claude", { binaryPath: fixture.executable, cwd: jobRoot });
    assert.equal(probe.version, "2.1.266");
    assert.equal(probe.text, true);
    assert.equal(probe.image, false);
    assert.equal(probe.reason, null);
    assertNoSecret(probe, "fixture-secret");
  });

  await test("discovers from absolute PATH entries and the usual HOME local bin", async () => {
    const pathDirectory = path.join(tempRoot, "path-bin");
    await mkdir(pathDirectory, { recursive: true });
    const pathFixture = await makeFixture("path-bin/codex", {
      versionOutput: "codex-cli 0.153.2\n",
      versionExit: 0,
      authOutput: "",
      authExit: 1,
    });
    const pathBefore = process.env.PATH;
    const homeBefore = process.env.HOME;
    try {
      process.env.PATH = pathDirectory;
      const fromPath = await discoverNativeExecutable("codex");
      assert.equal(fromPath?.path, realpathSync(pathFixture.executable));
      process.env.PATH = "/usr/bin";
      const localBin = path.join(testHome, ".local", "bin");
      await mkdir(localBin, { recursive: true });
      const localFixture = await makeFixture("home-local-claude", {
        versionOutput: "2.1.263 (Claude Code)\n",
        versionExit: 0,
        authOutput: "{}",
        authExit: 1,
      });
      await writeFile(path.join(localBin, "claude"), await readFile(localFixture.executable), { mode: 0o755 });
      await chmod(path.join(localBin, "claude"), 0o755);
      const fromHome = await discoverNativeExecutable("claude");
      assert.equal(fromHome?.path, realpathSync(path.join(localBin, "claude")));
    } finally {
      process.env.PATH = pathBefore;
      process.env.HOME = homeBefore;
    }
  });

  await test("keeps default discovery and probing independent of a Finder root cwd", async () => {
    const localBin = path.join(testHome, ".local", "bin");
    await mkdir(localBin, { recursive: true });
    const claudeFixture = await makeFixture("finder-home-claude", {
      versionOutput: "2.1.263 (Claude Code)\n",
      versionExit: 0,
      authOutput: JSON.stringify({ loggedIn: true, authMethod: "claude.ai", token: "fixture-secret" }),
      authExit: 0,
    });
    await writeFile(path.join(localBin, "claude"), await readFile(claudeFixture.executable), { mode: 0o755 });
    await chmod(path.join(localBin, "claude"), 0o755);
    const codexFixture = await makeFixture("finder-explicit-codex", {
      versionOutput: "codex-cli 0.153.4\n",
      versionExit: 0,
      authOutput: "authenticated but intentionally discarded\n",
      authExit: 0,
    });
    const cwdBefore = process.cwd();
    const pathBefore = process.env.PATH;
    try {
      process.chdir("/");
      process.env.PATH = "/usr/bin:/bin";

      const discoveredClaude = await discoverNativeExecutable("claude");
      assert.equal(discoveredClaude?.path, realpathSync(path.join(localBin, "claude")));

      const claudeProbe = await probeNativeAgent("claude");
      assert.equal(claudeProbe.executable?.path, realpathSync(path.join(localBin, "claude")));
      assert.equal(claudeProbe.version, "2.1.263");
      assert.equal(claudeProbe.authenticated, true);
      assert.equal(claudeProbe.reason, null);
      assert.deepEqual((await readTranscript(claudeFixture.transcript)).map((entry) => entry.argv), [
        ["--version"],
        ["auth", "status", "--json"],
      ]);

      const codexProbe = await probeNativeAgent("codex", { binaryPath: codexFixture.executable });
      assert.equal(codexProbe.executable?.path, realpathSync(codexFixture.executable));
      assert.equal(codexProbe.version, "0.153.4");
      assert.equal(codexProbe.authenticated, true);
      assert.equal(codexProbe.reason, null);
      assert.deepEqual((await readTranscript(codexFixture.transcript)).map((entry) => entry.argv), [
        ["--version"],
        ["login", "status"],
      ]);

      for (const entry of [
        ...(await readTranscript(claudeFixture.transcript)),
        ...(await readTranscript(codexFixture.transcript)),
      ]) {
        assert.equal(entry.env.HOME, testHome);
        assert.equal(entry.env.PATH, "/usr/bin:/bin");
        assert.equal(entry.env.OPENAI_API_KEY, null);
        assert.equal(entry.env.ANTHROPIC_API_KEY, null);
        assert.equal(entry.env.NATIVE_DISCOVERY_SECRET, null);
      }
      assertNoSecret(claudeProbe, "fixture-secret");
      assertNoSecret(codexProbe, "codex-secret");
    } finally {
      process.chdir(cwdBefore);
      process.env.PATH = pathBefore;
    }
  });

  await test("retains explicit cwd rejection for a job-local executable", async () => {
    const fixture = await makeFixture("job/codex", {
      versionOutput: "codex-cli 0.153.4\n",
      versionExit: 0,
      authOutput: "authenticated but intentionally discarded\n",
      authExit: 0,
    });
    const result = await probeNativeAgent("codex", { binaryPath: fixture.executable, cwd: jobRoot });
    assert.equal(result.executable, null);
    assert.equal(result.reason, "native_binary_missing");
    assert.equal(existsSync(fixture.transcript), false);
  });

  await test("ignores empty and relative PATH entries near the parent cwd", async () => {
    const parentCwd = path.join(tempRoot, "parent-cwd");
    const relativeBin = path.join(parentCwd, "relative-bin");
    const emptyHome = path.join(tempRoot, "empty-home");
    await Promise.all([
      mkdir(relativeBin, { recursive: true }),
      mkdir(emptyHome, { recursive: true }),
    ]);
    const cwdFixture = await makeFixture("parent-cwd/codex", {
      versionOutput: "codex-cli 0.153.4\n",
      versionExit: 0,
      authOutput: "",
      authExit: 1,
    });
    const relativeFixture = await makeFixture("parent-cwd/relative-bin/codex", {
      versionOutput: "codex-cli 0.153.4\n",
      versionExit: 0,
      authOutput: "",
      authExit: 1,
    });
    const cwdBefore = process.cwd();
    const pathBefore = process.env.PATH;
    const homeBefore = process.env.HOME;
    try {
      process.chdir(parentCwd);
      process.env.HOME = emptyHome;
      for (const pathValue of ["", ".", "relative-bin"]) {
        process.env.PATH = pathValue;
        const result = await discoverNativeExecutable("codex");
        assert.notEqual(result?.path, realpathSync(cwdFixture.executable));
        assert.notEqual(result?.path, realpathSync(relativeFixture.executable));
      }
    } finally {
      process.chdir(cwdBefore);
      process.env.PATH = pathBefore;
      process.env.HOME = homeBefore;
    }
  });

  await test("rejects unsupported or malformed version output without raw logs", async () => {
    const fixture = await makeFixture("codex-unsupported", {
      versionOutput: "codex-cli 0.153.3\nOPENAI_API_KEY=openai-secret\n",
      versionExit: 0,
      authOutput: "",
      authExit: 1,
    });
    const result = await probeNativeAgent("codex", { binaryPath: fixture.executable, cwd: jobRoot });
    assert.equal(result.version, null);
    assert.equal(result.reason, "native_version_unsupported");
    assertNoSecret(result, "openai-secret");
  });

  await test("reports missing binaries with a stable reason", async () => {
    const result = await probeNativeAgent("codex", { binaryPath: path.join(tempRoot, "missing-codex"), cwd: jobRoot });
    assert.equal(result.executable, null);
    assert.equal(result.reason, "native_binary_missing");
  });

  await test("reports version command failures as probe failures", async () => {
    const fixture = await makeFixture("codex-version-fails", {
      versionOutput: "codex-cli 0.153.2\n",
      versionExit: 7,
      authOutput: "",
      authExit: 1,
    });
    const result = await probeNativeAgent("codex", { binaryPath: fixture.executable, cwd: jobRoot });
    assert.equal(result.reason, "native_probe_failed");
    assertNoSecret(result, "codex-secret");
  });

  await test("reports nonzero auth status as unconfirmed", async () => {
    const fixture = await makeFixture("claude-auth-fails", {
      versionOutput: "2.1.263 (Claude Code)\n",
      versionExit: 0,
      authOutput: JSON.stringify({ loggedIn: false, authMethod: "none", token: "fixture-secret" }),
      authExit: 1,
    });
    const result = await probeNativeAgent("claude", { binaryPath: fixture.executable, cwd: jobRoot });
    assert.equal(result.version, "2.1.263");
    assert.equal(result.authenticated, false);
    assert.equal(result.reason, "native_auth_unconfirmed");
    assertNoSecret(result, "fixture-secret");
  });

  await test("bounds version output", async () => {
    const fixture = await makeFixture("codex-output-limit", {
      versionOutput: `${"x".repeat(4 * 1024 + 1)}`,
      versionExit: 0,
      authOutput: "",
      authExit: 1,
    });
    const result = await probeNativeAgent("codex", { binaryPath: fixture.executable, cwd: jobRoot });
    assert.equal(result.reason, "native_probe_failed");
  });

  await test("cleans descendants after a normal command exit", async () => {
    const fixture = await makeFixture("codex-normal-descendant", {
      spawnDescendant: true,
      versionOutput: "codex-cli 0.153.2\n",
      versionExit: 0,
      authOutput: "",
      authExit: 0,
    });
    const result = await probeNativeAgent("codex", { binaryPath: fixture.executable, cwd: jobRoot });
    assert.equal(result.reason, null);
    assert.equal(existsSync(fixture.descendantPid), true);
    await new Promise((resolve) => setTimeout(resolve, 1_750));
    assert.equal(existsSync(fixture.descendantMarker), false);
  });

  await test("fails closed when owned process-group cleanup is unverified", async () => {
    const fixture = await makeFixture("codex-cleanup-fails", {
      versionOutput: "codex-cli 0.153.2\n",
      versionExit: 0,
      authOutput: "",
      authExit: 1,
    });
    const originalKill = process.kill;
    try {
      process.kill = () => {
        const error = new Error("cleanup blocked");
        error.code = "EPERM";
        throw error;
      };
      const result = await probeNativeAgent("codex", { binaryPath: fixture.executable, cwd: jobRoot });
      assert.equal(result.reason, "native_probe_failed");
      assert.equal(result.authenticated, false);
      assert.equal(result.text, false);
      assert.equal(result.image, false);
    } finally {
      process.kill = originalKill;
    }
  });

  await test("kills a timed out owned process group", async () => {
    const fixture = await makeFixture("codex-timeout", {
      timeout: true,
      versionOutput: "",
      versionExit: 0,
      authOutput: "",
      authExit: 1,
    });
    const startedAt = Date.now();
    const result = await probeNativeAgent("codex", { binaryPath: fixture.executable, cwd: jobRoot });
    assert.equal(result.reason, "native_probe_failed");
    assert.equal(Date.now() - startedAt >= 9_000, true);
    assert.equal(Date.now() - startedAt < 15_000, true);
  });

  assert.equal(parseNativeVersion("codex", "build log codex-cli 0.153.2"), null);
  assert.equal(parseNativeVersion("claude", "2.1.263 (Claude Code)\\nextra"), null);
  assert.equal(existsSync(bundlePath), true);
  console.log(`PASS: native discovery/preflight, strict versions, allowlisted auth environment, bounded output and process cleanup (${cases.length} cases)`);
} finally {
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(tempRoot, { recursive: true, force: true });
}
