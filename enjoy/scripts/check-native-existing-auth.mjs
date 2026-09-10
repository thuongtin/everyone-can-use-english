#!/usr/bin/env node

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

// Preserve the CLI's identity and credential-store location, never credential values.
export function nativeAuthEnvironment(provider, source = process.env) {
  const names = ["HOME", "USER", "LOGNAME", "SHELL", "PATH", "LANG", "LC_ALL", "TERM", "TZ", "TMPDIR"];
  names.push(...(provider === "codex"
    ? ["CODEX_HOME"]
    : ["CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"]));
  return Object.fromEntries(names.filter((name) => typeof source[name] === "string")
    .map((name) => [name, source[name]]));
}

export async function probeExistingAuth(provider, binary, { cwd, timeoutMs = 10_000 } = {}) {
  if (!["codex", "claude"].includes(provider)) throw new Error("unsupported_provider");
  const args = provider === "codex" ? ["login", "status"] : ["auth", "status", "--json"];
  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      cwd,
      env: nativeAuthEnvironment(provider),
      detached: process.platform !== "win32",
      stdio: ["ignore", provider === "claude" ? "pipe" : "ignore", "ignore"],
    });
    let output = "";
    let bytes = 0;
    let failed = false;
    const stop = () => {
      failed = true;
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch { /* The status process already exited. */ }
    };
    const timer = setTimeout(stop, timeoutMs);
    child.on("error", () => { failed = true; });
    child.stdout?.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 64 * 1024) { output = ""; stop(); return; }
      if (!failed) output += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let loggedIn = !failed && code === 0;
      let authMethod = "unknown";
      if (provider === "claude") {
        try {
          const data = JSON.parse(output);
          loggedIn = loggedIn && data.loggedIn === true;
          if (["claude.ai", "api_key", "none"].includes(data.authMethod)) authMethod = data.authMethod;
        } catch { loggedIn = false; }
      }
      output = "";
      resolve({ provider, status: loggedIn ? "authenticated" : "unconfirmed", loggedIn, authMethod });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await Promise.all([
    probeExistingAuth("codex", process.env.ENJOY_CODEX_BIN || "codex"),
    probeExistingAuth("claude", process.env.ENJOY_CLAUDE_BIN || "claude"),
  ]);
  console.log(JSON.stringify({ scope: "existing-cli-auth-status-only", results }, null, 2));
  if (results.some((result) => !result.loggedIn)) process.exitCode = 1;
}
