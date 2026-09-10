/* global globalThis */
import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { lstat, readFile, mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIVE_OPT_IN = "ENJOY_RUN_PROVIDER_TEXT_LIVE";
const SNAPSHOT_ENV = "ENJOY_PROVIDER_SNAPSHOT";
const AZURE_PRIVATE_CONFIG_ENV = "ENJOY_AZURE_OPENAI_PRIVATE_CONFIG";
const TIMEOUT_MS = 60_000;
const MAX_FETCHES_PER_PROVIDER = 3;
const TEST_TEXT = "Today is a wonderful day to learn English.";
const nativeFetch = globalThis.fetch.bind(globalThis);
const runStorage = new AsyncLocalStorage();

const MODEL_ENVS = Object.freeze({
  openai: "ENJOY_OPENAI_TEXT_MODEL",
  "azure-openai": "ENJOY_AZURE_OPENAI_TEXT_DEPLOYMENT",
  openrouter: "ENJOY_OPENROUTER_TEXT_MODEL",
  ollama: "ENJOY_OLLAMA_TEXT_MODEL",
  lmstudio: "ENJOY_LMSTUDIO_TEXT_MODEL",
});

const jsonLine = (value) => console.log(JSON.stringify(value));
const cleanString = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

if (process.env[LIVE_OPT_IN] !== "1") {
  jsonLine({
    check: "provider-text-live",
    status: "skipped",
    reason: "live-opt-in-required",
    requiredEnv: [LIVE_OPT_IN],
    configAlternatives: [SNAPSHOT_ENV, AZURE_PRIVATE_CONFIG_ENV],
  });
  process.exit(0);
}

const snapshotInput = cleanString(process.env[SNAPSHOT_ENV]);
const azurePrivateConfigInput = cleanString(
  process.env[AZURE_PRIVATE_CONFIG_ENV]
);
if (
  (!snapshotInput && !azurePrivateConfigInput) ||
  (snapshotInput && !path.isAbsolute(snapshotInput)) ||
  (azurePrivateConfigInput && !path.isAbsolute(azurePrivateConfigInput))
) {
  jsonLine({
    check: "provider-text-live",
    status: "not-tested",
    reason: "absolute-config-path-required",
    configAlternatives: [SNAPSHOT_ENV, AZURE_PRIVATE_CONFIG_ENV],
  });
  process.exit(2);
}

const snapshotPath = snapshotInput ? path.resolve(snapshotInput) : undefined;
const azurePrivateConfigPath = azurePrivateConfigInput
  ? path.resolve(azurePrivateConfigInput)
  : undefined;

const fileHash = async (filePath) =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

const readAzurePrivateConfig = async (filePath) => {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw Object.assign(new Error("azure-private-config-not-file"), {
      code: "azure-private-config-not-file",
    });
  }
  if ((metadata.mode & 0o777) !== 0o600) {
    throw Object.assign(new Error("azure-private-config-mode"), {
      code: "azure-private-config-mode",
    });
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw Object.assign(new Error("azure-private-config-owner"), {
      code: "azure-private-config-owner",
    });
  }
  let value;
  try {
    value = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw Object.assign(new Error("azure-private-config-invalid"), {
      code: "azure-private-config-invalid",
    });
  }
  if (!isRecord(value)) {
    throw Object.assign(new Error("azure-private-config-invalid"), {
      code: "azure-private-config-invalid",
    });
  }
  const key = cleanString(value.key);
  const baseUrl = cleanString(value.textEndpoint) || cleanString(value.endpoint);
  const deployment = cleanString(value.deployment);
  if (!key || !baseUrl || !deployment) {
    throw Object.assign(new Error("azure-private-config-incomplete"), {
      code: "azure-private-config-incomplete",
    });
  }
  return { key, baseUrl, deployment };
};

const readSettingsReadOnly = (filePath) =>
  new Promise((resolve, reject) => {
    const python = spawn("python3", ["-", filePath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.env.PATH || "/usr/bin:/bin" },
    });
    let stdout = "";
    let stderrBytes = 0;
    python.stdout.setEncoding("utf8");
    python.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 1_000_000) python.kill("SIGKILL");
    });
    python.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
    });
    python.on("error", reject);
    python.on("close", (code) => {
      if (code !== 0 || stderrBytes > 0) {
        reject(Object.assign(new Error("snapshot-read-failed"), { code: "snapshot-read-failed" }));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(Object.assign(new Error("snapshot-json-invalid"), { code: "snapshot-json-invalid" }));
      }
    });
    python.stdin.end(String.raw`
import json
import pathlib
import sqlite3
import sys

snapshot = sys.argv[1]
keys = ("gpt_engine", "deepseek", "openai", "azure_openai", "openrouter", "ollama", "lmstudio")
snapshot_uri = pathlib.Path(snapshot).as_uri() + "?mode=ro&immutable=1"
connection = sqlite3.connect(snapshot_uri, uri=True)
try:
    placeholders = ",".join("?" for _ in keys)
    rows = connection.execute(
        "SELECT key, value FROM user_settings WHERE key IN (" + placeholders + ")",
        keys,
    ).fetchall()
    values = {}
    for key, raw_value in rows:
        try:
            values[key] = json.loads(raw_value)
        except (TypeError, json.JSONDecodeError):
            values[key] = raw_value
    print(json.dumps(values, separators=(",", ":")))
finally:
    connection.close()
`);
  });

const requestUrl = (input) => {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  return new URL(input.url);
};

const requestMethod = (input, init) =>
  String(init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();

const safePath = (pathname, secrets) => {
  let value = pathname;
  for (const secret of secrets) {
    if (!secret) continue;
    value = value.split(secret).join("[redacted]");
    value = value.split(encodeURIComponent(secret)).join("[redacted]");
  }
  return value;
};

const observedFetch = async (input, init = {}) => {
  const context = runStorage.getStore();
  if (!context) throw Object.assign(new Error("unscoped-fetch"), { code: "unscoped-fetch" });
  const url = requestUrl(input);
  const observation = {
    host: url.host,
    path: safePath(url.pathname, context.secrets),
    method: requestMethod(input, init),
    status: null,
  };
  context.requests.push(observation);
  context.fetchCount += 1;
  if (context.fetchCount > MAX_FETCHES_PER_PROVIDER) {
    context.controller.abort();
    throw Object.assign(new Error("fetch-limit"), { code: "fetch-limit" });
  }

  const inputSignal = init.signal ||
    (typeof input === "object" && "signal" in input ? input.signal : undefined);
  const signal = inputSignal
    ? AbortSignal.any([inputSignal, context.controller.signal])
    : context.controller.signal;
  const response = await nativeFetch(input, { ...init, signal });
  observation.status = response.status;
  return response;
};

const counterDelta = (before, after) => ({
  blockedAttemptCount: after.blockedAttemptCount - before.blockedAttemptCount,
  legacyBackendOperationCount:
    after.legacyBackendOperationCount - before.legacyBackendOperationCount,
});

const safeOutput = (value) =>
  [...String(value)]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join("")
    .trim()
    .slice(0, 500);

const classifyError = (error, context) => {
  const status = [...context.requests].reverse().find((item) => item.status !== null)?.status ?? null;
  if (context.timedOut || error?.name === "AbortError") return { category: "timeout", status };
  if (error?.code === "fetch-limit") return { category: "fetch-limit", status };
  if (error?.name === "NetworkPolicyError") return { category: "network-policy", status };
  if (status !== null && status >= 400) return { category: "http-error", status };
  if (error?.code === "unscoped-fetch") return { category: "harness-policy", status };
  if (/API key|provider|model/u.test(String(error?.message || ""))) {
    return { category: "configuration", status };
  }
  return { category: "provider-error", status };
};

const notTested = (provider, model, reason) => ({
  provider,
  model: model || null,
  status: "not-tested",
  reason,
  endpoint: [],
  durationMs: 0,
  policyCounters: { blockedAttemptCount: 0, legacyBackendOperationCount: 0 },
});

let temporary;
let snapshotHashBefore;
let snapshotHashAfter;
let azurePrivateConfig;
const results = [];

try {
  let settings = {};
  if (snapshotPath) {
    const snapshotStat = await stat(snapshotPath);
    if (!snapshotStat.isFile()) throw Object.assign(new Error("snapshot-not-file"), { code: "snapshot-not-file" });
    snapshotHashBefore = await fileHash(snapshotPath);
    settings = await readSettingsReadOnly(snapshotPath);
  }
  if (!isRecord(settings)) throw Object.assign(new Error("snapshot-settings-invalid"), { code: "snapshot-settings-invalid" });
  if (azurePrivateConfigPath) {
    azurePrivateConfig = await readAzurePrivateConfig(azurePrivateConfigPath);
  }

  temporary = await mkdtemp(path.join(root, ".tmp-provider-text-live-"));
  const output = path.join(temporary, "provider-text-live.mjs");
  await build({
    stdin: {
      contents: `
export { translateCommand } from "./src/commands/translate.command.ts";
export { getChatModelRequestPolicy } from "./src/lib/chat-model.ts";
export { getNetworkPolicyDiagnostics } from "./src/lib/network-policy.ts";
export { normalizeProviderConfig, resolveGptEngineBootstrap } from "./src/lib/ai-providers.ts";
`,
      resolveDir: root,
      loader: "ts",
    },
    alias: { "@": path.join(root, "src") },
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });

  const production = await import(`${pathToFileURL(output).href}?live=${Date.now()}`);
  globalThis.fetch = observedFetch;

  const selected = production.resolveGptEngineBootstrap(settings.gpt_engine, settings.openai).engine;
  const selectedDeepSeekModel = selected.name === "deepseek"
    ? cleanString(selected.models?.translate) || cleanString(selected.models?.default)
    : undefined;

  const plans = [];
  if (selected.name !== "deepseek") {
    plans.push({ result: notTested("deepseek", null, "deepseek-not-selected") });
  } else if (!selectedDeepSeekModel) {
    plans.push({ result: notTested("deepseek", null, "selected-model-missing") });
  } else {
    plans.push({ candidate: { provider: "deepseek", model: selectedDeepSeekModel } });
  }

  for (const provider of ["openai", "azure-openai", "openrouter", "ollama", "lmstudio"]) {
    const model = provider === "azure-openai"
      ? cleanString(process.env[MODEL_ENVS[provider]]) || azurePrivateConfig?.deployment
      : cleanString(process.env[MODEL_ENVS[provider]]);
    if (!model) {
      plans.push({ result: notTested(provider, null, "explicit-model-env-missing") });
    } else {
      plans.push({ candidate: { provider, model } });
    }
  }

  for (const plan of plans) {
    if (plan.result) {
      results.push(plan.result);
      continue;
    }
    const candidate = plan.candidate;
    const filter = (process.env.ENJOY_TEXT_PROVIDER_FILTER || "").split(",").filter(Boolean);
    if (filter.length && !filter.includes(candidate.provider)) {
      results.push(notTested(candidate.provider, candidate.model, "excluded-by-test-selection"));
      continue;
    }
    let config = production.normalizeProviderConfig(
      candidate.provider,
      settings[candidate.provider === "azure-openai" ? "azure_openai" : candidate.provider],
    );
    if (candidate.provider === "azure-openai" && azurePrivateConfig) {
      config = production.normalizeProviderConfig("azure-openai", {
        ...config,
        key: azurePrivateConfig.key,
        baseUrl: azurePrivateConfig.baseUrl,
        models: azurePrivateConfig.deployment,
      });
    }
    const requiresKey = ["deepseek", "openai", "azure-openai", "openrouter"].includes(candidate.provider);
    if (requiresKey && !cleanString(config.key)) {
      results.push(notTested(candidate.provider, candidate.model, "snapshot-credential-missing"));
      continue;
    }

    const options = {
      provider: candidate.provider,
      modelName: candidate.model,
      key: cleanString(config.key),
      baseUrl: cleanString(config.baseUrl),
      maxTokens: 120,
    };
    const policy = production.getChatModelRequestPolicy(options);
    const before = production.getNetworkPolicyDiagnostics();
    const context = {
      controller: new AbortController(),
      fetchCount: 0,
      requests: [],
      secrets: [cleanString(config.key)].filter(Boolean),
      timedOut: false,
    };
    const started = Date.now();
    let timer;
    try {
      const invocation = runStorage.run(context, () =>
        production.translateCommand(TEST_TEXT, "vi-VN", options),
      );
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          context.timedOut = true;
          context.controller.abort();
          reject(Object.assign(new Error("provider-timeout"), { code: "provider-timeout" }));
        }, TIMEOUT_MS);
      });
      const outputText = await Promise.race([invocation, timeout]);
      const after = production.getNetworkPolicyDiagnostics();
      results.push({
        provider: policy.provider,
        model: policy.modelName,
        protocol: policy.protocol,
        status: "pass",
        endpoint: context.requests,
        durationMs: Date.now() - started,
        inputText: TEST_TEXT,
        outputText: safeOutput(outputText),
        policyCounters: counterDelta(before, after),
      });
    } catch (error) {
      const after = production.getNetworkPolicyDiagnostics();
      results.push({
        provider: policy.provider,
        model: policy.modelName,
        protocol: policy.protocol,
        status: "fail",
        endpoint: context.requests,
        durationMs: Date.now() - started,
        error: classifyError(error, context),
        policyCounters: counterDelta(before, after),
      });
    } finally {
      clearTimeout(timer);
      context.controller.abort();
    }
  }

  results.push(notTested("gemini", null, "snapshot-credential-missing"));
  results.push(notTested("codex-acp", null, "deferred-to-native-harness"));
  results.push(notTested("claude-acp", null, "deferred-to-native-harness"));
  if (snapshotPath) snapshotHashAfter = await fileHash(snapshotPath);
  const snapshotHashUnchanged = !snapshotPath || snapshotHashBefore === snapshotHashAfter;
  const attempted = results.filter((item) => item.status !== "not-tested");
  const failed = attempted.filter((item) => item.status === "fail");
  const status = !snapshotHashUnchanged
    ? "fail"
    : attempted.length === 0
      ? "not-tested"
      : failed.length > 0
        ? "partial"
        : "pass";
  jsonLine({
    check: "provider-text-live",
    status,
    snapshotMode: snapshotPath ? "read-only-immutable" : "not-used",
    snapshotHashUnchanged,
    azurePrivateConfigMode: azurePrivateConfigPath ? "read-only-0600" : "not-used",
    timeoutMs: TIMEOUT_MS,
    maxFetchesPerProvider: MAX_FETCHES_PER_PROVIDER,
    results,
  });
  process.exitCode = status === "pass" ? 0 : status === "not-tested" ? 2 : 1;
} catch (error) {
  if (snapshotHashBefore) {
    try {
      snapshotHashAfter = await fileHash(snapshotPath);
    } catch {
      snapshotHashAfter = undefined;
    }
  }
  jsonLine({
    check: "provider-text-live",
    status: "fail",
    error: {
      category: [
        "snapshot-read-failed",
        "snapshot-json-invalid",
        "snapshot-not-file",
        "snapshot-settings-invalid",
        "azure-private-config-not-file",
        "azure-private-config-mode",
        "azure-private-config-owner",
        "azure-private-config-invalid",
        "azure-private-config-incomplete",
      ]
        .includes(error?.code)
        ? "configuration-file"
        : "harness",
      status: null,
    },
    snapshotHashUnchanged:
      snapshotHashBefore && snapshotHashAfter
        ? snapshotHashBefore === snapshotHashAfter
        : null,
  });
  process.exitCode = 1;
} finally {
  globalThis.fetch = nativeFetch;
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
