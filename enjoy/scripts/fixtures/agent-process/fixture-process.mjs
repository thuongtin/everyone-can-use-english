#!/usr/bin/env node

import { fork } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const mode = process.argv[2] || "success";
const value = process.argv[3] || "fixture-value";

const writeLine = (payload) => {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
};

if (mode === "success") {
  process.stdout.write('{"type":"partial",');
  setTimeout(() => {
    process.stdout.write('"value":"split"}\n');
    writeLine({ type: "done", value });
  }, 10);
} else if (mode === "many-lines") {
  process.stdout.write([
    JSON.stringify({ type: "line", index: 1 }),
    JSON.stringify({ type: "line", index: 2 }),
    JSON.stringify({ type: "line", index: 3 }),
  ].join("\n") + "\n");
} else if (mode === "echo") {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("data", () => {
    for (const line of input.split("\n").filter(Boolean)) writeLine({ echo: JSON.parse(line) });
    input = "";
  });
  setInterval(() => {}, 1000);
} else if (mode === "malformed") {
  process.stdout.write("not-json\n");
  setTimeout(() => process.exit(0), 10);
} else if (mode === "invalid-utf8") {
  process.stdout.write(Buffer.from([0xff, 0xfe, 0x0a]));
} else if (mode === "huge-line") {
  process.stdout.write(`${JSON.stringify({ value: "x".repeat(512) })}\n`);
} else if (mode === "huge-total") {
  for (let index = 0; index < 10; index += 1) writeLine({ index, value: "x".repeat(128) });
} else if (mode === "stderr-secret") {
  process.stderr.write("Authorization: Bearer secret-should-never-be-retained\n");
  writeLine({ type: "done" });
} else if (mode === "argv-env") {
  writeLine({ argv: process.argv.slice(2), env: {
    HOME: process.env.HOME || null,
    USER: process.env.USER || null,
    LOGNAME: process.env.LOGNAME || null,
    ENJOY_MCP_TOKEN: process.env.ENJOY_MCP_TOKEN || null,
    CODEX_HOME: process.env.CODEX_HOME || null,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR || null,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || null,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || null,
    SECRET_SHOULD_NOT_PASS: process.env.SECRET_SHOULD_NOT_PASS || null,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || null,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || null,
    CODEX_API_KEY: process.env.CODEX_API_KEY || null,
    CLAUDE_API_KEY: process.env.CLAUDE_API_KEY || null,
  } });
} else if (mode === "sleep") {
  writeLine({ type: "started" });
  setInterval(() => {}, 1000);
} else if (mode === "descendant") {
  const marker = value;
  mkdirSync(dirname(marker), { recursive: true });
  const child = fork(new URL("./fixture-descendant.mjs", import.meta.url), [marker], {
    detached: false,
    stdio: "ignore",
  });
  writeFileSync(marker, String(child.pid));
  writeLine({ type: "child", pid: child.pid });
  setInterval(() => {}, 1000);
} else if (mode === "orphan-exit") {
  const marker = value;
  mkdirSync(dirname(marker), { recursive: true });
  const child = fork(new URL("./fixture-descendant.mjs", import.meta.url), [marker], {
    detached: false,
    stdio: "ignore",
  });
  writeFileSync(marker, String(child.pid));
  writeLine({ type: "child", pid: child.pid });
  process.exit(0);
} else if (mode === "version") {
  if (process.argv[3] === "--version") {
    writeLine({ type: "version", value: "fixture-agent 1.0.0" });
  } else {
    process.stdout.write("unexpected-version-argument\n");
    process.exitCode = 2;
  }
} else if (mode === "record") {
  appendFileSync(value, `${JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() })}\n`);
  writeLine({ type: "recorded" });
} else {
  writeLine({ type: "unknown-mode", mode });
  process.exitCode = 2;
}
