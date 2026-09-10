#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ENJOY_ROOT = resolve(SCRIPT_DIR, '..');
const REPOSITORY_ROOT = resolve(ENJOY_ROOT, '..');
const FIXTURE_PATH = join(
  SCRIPT_DIR,
  'fixtures',
  'agent-spike',
  'codex',
  'mcp-submit-fixture.mjs',
);
const MODEL_CATALOG_FIXTURE_PATH = join(
  SCRIPT_DIR,
  'fixtures',
  'codex',
  'models-0.153.2-source.json',
);
const MODEL_CATALOG_SOURCE_SHA256 = 'f3ef6e12359b9de0946d6f80d43e24fef08c710668a70ac74254a2741ad0ec5f';
const MODEL_CATALOG_OVERRIDE_SHA256 = '1c732628fda69d2d36469bfea4cd206f8094e068eba5232729d82d09d87192df';
const MODEL_CATALOG_VERSION = '0.153.2';
const MODEL_CATALOG_MODEL_COUNT = 11;
const CONFIG_RECEIPT_FILENAME = '.enjoy-codex-config.receipt';
const CONFIG_RECEIPT_SCHEMA = 'enjoy.codex-config/1';
const CONFIG_RECEIPT_OWNER = 'enjoy/check-codex-native';
const MAX_IMAGE_RESULT_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_RESULT_CHARS = MAX_IMAGE_RESULT_BYTES * 2;
const MAX_JSONL_LINE_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE_ITEMS = 8;
const IMAGE_DECODE_TIMEOUT_MS = 15_000;
const FFMPEG_BIN = process.env.ENJOY_FFMPEG_BIN || '/opt/homebrew/bin/ffmpeg';
const NODE_BIN = process.env.ENJOY_NODE_BIN || '/opt/homebrew/opt/node@24/bin/node';
const CODEX_BIN = process.env.ENJOY_CODEX_BIN || '/opt/homebrew/bin/codex';
const EVIDENCE_PATH = '/tmp/enjoy-u1-codex.md';
const LOGIN_WAIT_MS = 300_000;
const PERMISSION_PROFILE_ID = 'enjoy-job';
const DEFAULT_AUTH_ROOT = join(ENJOY_ROOT, 'tmp', 'agent-spike-auth');
const DEFAULT_AUTH_HOME = join(DEFAULT_AUTH_ROOT, 'codex');
const DEFAULT_AUTH_WORKSPACE = join(DEFAULT_AUTH_ROOT, 'workspace');

const args = process.argv.slice(2);
const mode = args.includes('--login')
  ? 'login'
  : args.includes('--live-image')
    ? 'live-image'
    : args.includes('--live-cancel')
      ? 'live-cancel'
      : args.includes('--live-text') || args.includes('--live')
        ? 'live-text'
        : 'no-auth';
const authHomeArgument = valueAfter('--auth-home');
const authHome = authHomeArgument ? resolve(authHomeArgument) : DEFAULT_AUTH_HOME;
const authWorkspaceArgument = valueAfter('--auth-workspace');
const authWorkspace = authWorkspaceArgument
  ? resolve(authWorkspaceArgument)
  : DEFAULT_AUTH_WORKSPACE;

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] || null : null;
}

function now() {
  return new Date().toISOString();
}

function result(ok, value, reason = null) {
  return { ok, value, reason };
}

function line(value) {
  return String(value).replace(/[\r\n]+/g, ' ').trim();
}

function assertPathInside(child, parent) {
  const candidate = resolve(child);
  const base = resolve(parent);
  const rel = relative(base, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function pathsEquivalent(left, right) {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return resolve(left) === resolve(right) || resolve(left).replace(/^\/private\//, '/') === resolve(right).replace(/^\/private\//, '/');
  }
}

function canonicalExistingPath(value) {
  try {
    return realpathSync(value);
  } catch {
    return resolve(value);
  }
}

function redactForEvidence(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return line(value)
    .replace(/https?:\/\/[^\s]+/gi, '[omitted-url]')
    .replace(/(?:userCode|authCode|loginId|token|secret|apiKey|password)[^,;\s]*/gi, '[omitted-sensitive-field]')
    .replace(/auth\.json/gi, '[credential-file]');
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function minimalEnv(runtimeRoot, codexHome = null, hostHome = null) {
  const env = {};
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'TERM', 'TZ']) {
    if (typeof process.env[key] === 'string') env[key] = process.env[key];
  }
  env.PATH ||= '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  env.LANG ||= 'en_US.UTF-8';
  if (hostHome) env.HOME = hostHome;
  if (codexHome) env.CODEX_HOME = codexHome;
  env.XDG_CONFIG_HOME = join(runtimeRoot, 'xdg-config');
  env.XDG_DATA_HOME = join(runtimeRoot, 'xdg-data');
  env.XDG_CACHE_HOME = join(runtimeRoot, 'xdg-cache');
  env.TMPDIR = join(runtimeRoot, 'tmp');
  return env;
}

async function runProcess(command, commandArgs, options = {}) {
  const {
    cwd = REPOSITORY_ROOT,
    env = minimalEnv('/tmp/enjoy-u1-codex-process'),
    timeoutMs = 10_000,
    collectStdout = true,
  } = options;
  const child = spawn(command, commandArgs, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'ignore'],
    detached: true,
  });
  let stdout = '';
  if (collectStdout) {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (stdout.length < 10_000_000) stdout += chunk;
    });
  }
  const exit = new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    terminateProcess(child);
  }, timeoutMs);
  try {
    const status = await exit;
    return { ...status, stdout, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

function terminateProcess(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      return;
    }
  }
  setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // The process already exited.
    }
  }, 1000).unref();
}

class JsonlClient {
  constructor(command, commandArgs, options) {
    this.child = spawn(command, commandArgs, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'ignore'],
      detached: true,
    });
    this.nextRequestId = 1;
    this.buffer = '';
    this.pending = new Map();
    this.events = [];
    this.rawItems = [];
    this.serverRequests = [];
    this.serverResponses = [];
    this.malformedLines = 0;
    this.exit = new Promise((resolveExit) => {
      this.child.once('error', (error) => resolveExit({ error }));
      this.child.once('exit', (code, signal) => resolveExit({ code, signal }));
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.consume(chunk));
  }

  respond(requestId, resultValue = null, error = null) {
    const response = { jsonrpc: '2.0', id: requestId };
    if (error) response.error = error;
    else response.result = resultValue;
    this.child.stdin.write(`${JSON.stringify(response)}\n`);
    this.serverResponses.push({ requestIdPresent: requestId !== null && requestId !== undefined, ok: !error });
  }

  handleServerRequest(message) {
    const method = typeof message.method === 'string' ? message.method : 'unknown';
    const params = message.params && typeof message.params === 'object' ? message.params : null;
    this.serverRequests.push({
      method,
      requestIdPresent: message.id !== null && message.id !== undefined,
      itemType: typeof params?.itemType === 'string' ? params.itemType : null,
      tool: typeof params?.tool === 'string' ? params.tool : null,
    });
    if (method === 'item/commandExecution/requestApproval') {
      this.respond(message.id, { decision: 'decline' });
      return;
    }
    if (method === 'item/fileChange/requestApproval') {
      this.respond(message.id, { decision: 'decline' });
      return;
    }
    if (method === 'item/permissions/requestApproval') {
      this.respond(message.id, {
        permissions: { fileSystem: null, network: null },
        scope: 'turn',
        strictAutoReview: true,
      });
      return;
    }
    if (method === 'item/tool/call') {
      this.respond(message.id, {
        success: false,
        contentItems: [{ type: 'inputText', text: 'Tool calls are disabled by the Enjoy native probe policy.' }],
      });
      return;
    }
    if (method === 'mcpServer/elicitation/request') {
      this.respond(message.id, { action: 'decline' });
      return;
    }
    if (method === 'item/tool/requestUserInput') {
      this.respond(message.id, { answers: {} });
      return;
    }
    this.respond(message.id, null, { code: -32601, message: 'Unsupported server request in Enjoy native probe.' });
  }

  consume(chunk) {
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) {
        if (Buffer.byteLength(this.buffer, 'utf8') > MAX_JSONL_LINE_BYTES) {
          this.buffer = '';
          this.malformedLines += 1;
        }
        return;
      }
      const lineValue = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!lineValue.trim()) continue;
      if (Buffer.byteLength(lineValue, 'utf8') > MAX_JSONL_LINE_BYTES) {
        this.malformedLines += 1;
        continue;
      }
      let message;
      try {
        message = JSON.parse(lineValue);
      } catch {
        this.malformedLines += 1;
        continue;
      }
      if (message && Object.hasOwn(message, 'id') && typeof message.method === 'string') {
        this.handleServerRequest(message);
        continue;
      }
      if (message && Object.hasOwn(message, 'id')) {
        const pending = this.pending.get(String(message.id));
        if (!pending) continue;
        this.pending.delete(String(message.id));
        if (message.error) {
          pending.reject({
            code: typeof message.error.code === 'number' ? message.error.code : null,
            hasMessage: typeof message.error.message === 'string',
          });
        } else {
          pending.resolve(message.result ?? null);
        }
        continue;
      }
      if (typeof message?.method === 'string') {
        if (message.params?.item && typeof message.params.item === 'object') {
          if (this.rawItems.length < 2_048) {
            const item = { ...message.params.item };
            if (item.type === 'imageGeneration' && typeof item.result === 'string') {
              if (Buffer.byteLength(item.result, 'utf8') > MAX_IMAGE_RESULT_CHARS) {
                item.result = null;
                item.resultTooLarge = true;
              }
            }
            this.rawItems.push(item);
          }
        }
        const summary = summarizeEvent(message);
        if (summary) this.events.push(summary);
      }
    }
  }

  request(method, params) {
    const id = this.nextRequestId++;
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolveRequest, rejectRequest) => {
      this.pending.set(String(id), { resolve: resolveRequest, reject: rejectRequest });
      this.child.stdin.write(`${message}\n`);
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async waitFor(method, timeoutMs = 10_000) {
    const existing = this.events.find((event) => event.method === method);
    if (existing) return existing;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await delay(50);
      const event = this.events.find((item) => item.method === method);
      if (event) return event;
    }
    return null;
  }

  async stop() {
    for (const pending of this.pending.values()) {
      pending.reject(new Error('app-server process stopped'));
    }
    this.pending.clear();
    terminateProcess(this.child);
    await Promise.race([this.exit, delay(2_000)]);
  }
}

function summarizeEvent(message) {
  const method = message.method;
  const params = message.params;
  if (!params || typeof params !== 'object') return { method, hasParams: false };
  const summary = { method, hasParams: true };
  if (method === 'configWarning') {
    summary.message = typeof params.message === 'string' ? redactForEvidence(params.message) : null;
    summary.path = typeof params.path === 'string' ? redactForEvidence(params.path) : null;
    summary.summary = typeof params.summary === 'string' ? redactForEvidence(params.summary) : null;
    summary.details = typeof params.details === 'string' ? redactForEvidence(params.details) : null;
    summary.paramKeys = Object.keys(params).slice(0, 16);
  }
  if (method === 'account/login/completed') {
    summary.success = params.success === true;
    summary.hasError = typeof params.error === 'string' && params.error.length > 0;
  }
  if (method === 'account/updated') {
    summary.authMode = typeof params.authMode === 'string' ? params.authMode : null;
    summary.planType = typeof params.planType === 'string' ? params.planType : null;
  }
  if (method === 'turn/started' || method === 'turn/completed') {
    summary.threadIdPresent = typeof params.threadId === 'string';
    summary.turnIdPresent = typeof params.turn?.id === 'string';
    summary.turnStatus = typeof params.turn?.status === 'string' ? params.turn.status : null;
  }
  if (method === 'item/started' || method === 'item/completed') {
    summary.itemType = typeof params.item?.type === 'string' ? params.item.type : null;
    summary.itemId = typeof params.item?.id === 'string' ? params.item.id : null;
    summary.itemStatus = typeof params.item?.status === 'string' ? params.item.status : null;
    summary.server = typeof params.item?.server === 'string' ? params.item.server : null;
    summary.tool = typeof params.item?.tool === 'string' ? params.item.tool : null;
    summary.savedPathPresent = typeof params.item?.savedPath === 'string';
    summary.resultPresent = typeof params.item?.result === 'string';
    summary.textPresent = typeof params.item?.text === 'string';
    if (summary.itemType === 'imageGeneration') {
      summary.resultBytes = typeof params.item?.result === 'string'
        ? Buffer.byteLength(params.item.result, 'utf8')
        : null;
      summary.resultBounded = summary.resultBytes === null || summary.resultBytes <= MAX_IMAGE_RESULT_CHARS;
    }
  }
  if (method === 'mcpServer/startupStatus/updated') {
    summary.server = typeof params.name === 'string' ? params.name : null;
    summary.status = typeof params.status === 'string' ? params.status : null;
  }
  if (method === 'error') summary.errorCodePresent = Boolean(params.error?.codexErrorInfo);
  return summary;
}

function buildPatchDisabledModelCatalog(codexHome) {
  if (!existsSync(MODEL_CATALOG_FIXTURE_PATH)) {
    return { ok: false, reason: 'pinned model catalog fixture is missing' };
  }
  const sourceText = readFileSync(MODEL_CATALOG_FIXTURE_PATH, 'utf8');
  const sourceSha256 = createHash('sha256').update(sourceText).digest('hex');
  if (sourceSha256 !== MODEL_CATALOG_SOURCE_SHA256) {
    return { ok: false, reason: 'pinned model catalog fixture hash mismatch' };
  }
  let source;
  try {
    source = JSON.parse(sourceText);
  } catch {
    return { ok: false, reason: 'pinned model catalog fixture is not valid JSON' };
  }
  const models = Array.isArray(source?.models) ? source.models : [];
  const slugs = models.map((model) => model?.slug).filter((slug) => typeof slug === 'string');
  const uniqueSlugs = new Set(slugs);
  if (models.length !== MODEL_CATALOG_MODEL_COUNT || slugs.length !== models.length || uniqueSlugs.size !== models.length) {
    return { ok: false, reason: 'pinned model catalog fixture has invalid model slugs' };
  }
  if (models.some((model) => model.apply_patch_tool_type !== 'freeform')) {
    return { ok: false, reason: 'pinned model catalog fixture does not contain the expected patch capability metadata' };
  }
  if (models.some((model) => !Array.isArray(model.input_modalities) || !model.input_modalities.includes('image'))) {
    return { ok: false, reason: 'pinned model catalog fixture lost native image modality metadata' };
  }
  const override = {
    models: models.map((model) => ({ ...model, apply_patch_tool_type: null })),
  };
  if (override.models.some((model) => model.apply_patch_tool_type !== null)) {
    return { ok: false, reason: 'model catalog patch capability mutation was incomplete' };
  }
  const sourceWithoutPatch = models.map(({ apply_patch_tool_type: _patch, ...model }) => model);
  const overrideWithoutPatch = override.models.map(({ apply_patch_tool_type: _patch, ...model }) => model);
  if (JSON.stringify(sourceWithoutPatch) !== JSON.stringify(overrideWithoutPatch)) {
    return { ok: false, reason: 'model catalog mutation changed metadata beyond apply patch capability' };
  }
  const overrideText = `${JSON.stringify(override, null, 2)}\n`;
  const overrideSha256 = createHash('sha256').update(overrideText).digest('hex');
  if (overrideSha256 !== MODEL_CATALOG_OVERRIDE_SHA256) {
    return { ok: false, reason: 'model catalog override hash mismatch' };
  }
  const modelCatalogPath = join(codexHome, `model-catalog-${MODEL_CATALOG_VERSION}.json`);
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(modelCatalogPath, overrideText, { mode: 0o600 });
  chmodSync(modelCatalogPath, 0o600);
  return {
    ok: true,
    path: modelCatalogPath,
    sourceSha256,
    overrideSha256,
    modelCount: models.length,
    patchCapabilitiesDisabled: true,
    inputImageModalitiesPreserved: true,
  };
}

function atomicWriteText(filePath, text, mode = 0o600) {
  const temporaryPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporaryPath, text, { mode });
    chmodSync(temporaryPath, mode);
    renameSync(temporaryPath, filePath);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function readManagedConfigReceipt(receiptPath) {
  if (!existsSync(receiptPath)) return { ok: false, reason: 'managed config receipt is missing' };
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  } catch {
    return { ok: false, reason: 'managed config receipt is invalid JSON' };
  }
  const hash = typeof receipt?.configSha256 === 'string' ? receipt.configSha256 : '';
  if (
    receipt?.schemaVersion !== CONFIG_RECEIPT_SCHEMA
    || receipt?.owner !== CONFIG_RECEIPT_OWNER
    || receipt?.managed !== true
    || !/^[a-f0-9]{64}$/.test(hash)
    || typeof receipt?.includeFixture !== 'boolean'
  ) {
    return { ok: false, reason: 'managed config receipt ownership or schema is invalid' };
  }
  return { ok: true, receipt };
}

function buildScopedConfig(codexHome, workspace, includeFixture, modelCatalogPath) {
  const receiptPath = join(dirname(codexHome), 'mcp-receipt.json');
  const canonicalWorkspace = canonicalExistingPath(workspace);
  const config = [
    `model_catalog_json = ${JSON.stringify(modelCatalogPath)}`,
    `default_permissions = ${JSON.stringify(PERMISSION_PROFILE_ID)}`,
    'approval_policy = "on-request"',
    'approvals_reviewer = "user"',
    'web_search = "disabled"',
    'allow_login_shell = false',
    '',
    `[projects.${JSON.stringify(canonicalWorkspace)}]`,
    'trust_level = "untrusted"',
    '',
    '[features]',
    'shell_tool = false',
    'search_tool = false',
    'standalone_web_search = false',
    '',
    '[permissions.enjoy-job.workspace_roots]',
    `${JSON.stringify(canonicalWorkspace)} = true`,
    '',
    '[permissions.enjoy-job.filesystem]',
    '":minimal" = "read"',
    '"/opt/homebrew" = "read"',
    '',
    '[permissions.enjoy-job.filesystem.":workspace_roots"]',
    '"." = "write"',
    '',
    '[permissions.enjoy-job.network]',
    'enabled = false',
    ...(includeFixture
      ? [
          '',
          '[mcp_servers.enjoy_fixture]',
          `command = ${JSON.stringify(NODE_BIN)}`,
          `args = [${JSON.stringify(FIXTURE_PATH)}]`,
          `cwd = ${JSON.stringify(workspace)}`,
          'startup_timeout_sec = 15',
          '',
          '[mcp_servers.enjoy_fixture.env]',
          `ENJOY_U1_MCP_RECEIPT = ${JSON.stringify(receiptPath)}`,
        ]
      : []),
    '',
  ].join('\n');
  return { config, receiptPath };
}

function writeScopedConfig(codexHome, workspace, includeFixture, modelCatalogPath, modelCatalogSha256) {
  const configPath = join(codexHome, 'config.toml');
  const configReceiptPath = join(dirname(codexHome), CONFIG_RECEIPT_FILENAME);
  mkdirSync(codexHome, { recursive: true });
  const generated = buildScopedConfig(codexHome, workspace, includeFixture, modelCatalogPath);
  const configSha256 = createHash('sha256').update(generated.config).digest('hex');
  const existingConfig = existsSync(configPath);
  const existingReceipt = existsSync(configReceiptPath);
  if (existingConfig || existingReceipt) {
    if (!existingConfig || !existingReceipt) {
      return { ok: false, reason: 'config ownership state is incomplete; refusing unknown settings' };
    }
    const managed = readManagedConfigReceipt(configReceiptPath);
    if (!managed.ok) return managed;
    const existingSha256 = createHash('sha256').update(readFileSync(configPath, 'utf8')).digest('hex');
    if (existingSha256 !== managed.receipt.configSha256) {
      return { ok: false, reason: 'managed config hash mismatch; refusing tampered settings' };
    }
  }
  const receipt = {
    schemaVersion: CONFIG_RECEIPT_SCHEMA,
    owner: CONFIG_RECEIPT_OWNER,
    managed: true,
    configSha256,
    includeFixture,
    modelCatalogSha256: typeof modelCatalogSha256 === 'string' ? modelCatalogSha256 : null,
  };
  atomicWriteText(configPath, generated.config, 0o600);
  atomicWriteText(configReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 0o600);
  return { ok: true, configPath, configReceiptPath, receiptPath: generated.receiptPath, configSha256 };
}

function setupIsolation(runtimeRoot, workspace, codexHome, includeFixture) {
  const hostHome = join(runtimeRoot, 'host-home');
  const hostConfigDir = join(hostHome, '.codex');
  const projectConfigDir = join(workspace, '.codex');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(hostConfigDir, { recursive: true });
  mkdirSync(projectConfigDir, { recursive: true });
  writeFileSync(
    join(hostConfigDir, 'config.toml'),
    '[mcp_servers.foreign_user]\ncommand = "/usr/bin/false"\n',
    { mode: 0o600 },
  );
  writeFileSync(
    join(projectConfigDir, 'config.toml'),
    '[mcp_servers.foreign_project]\ncommand = "/usr/bin/false"\n',
    { mode: 0o600 },
  );
  mkdirSync(codexHome, { recursive: true });
  const modelCatalog = buildPatchDisabledModelCatalog(codexHome);
  if (!modelCatalog.ok) return { hostHome, config: modelCatalog, modelCatalog };
  const config = writeScopedConfig(codexHome, workspace, includeFixture, modelCatalog.path, modelCatalog.overrideSha256);
  return { hostHome, config, modelCatalog };
}

function runConfigLifecycleRegression() {
  const runtimeRoot = mkdtempSync(join('/tmp', 'enjoy-u1-codex-config-'));
  const workspace = join(runtimeRoot, 'workspace');
  const codexHome = join(runtimeRoot, 'codex-home');
  try {
    const loginMode = setupIsolation(runtimeRoot, workspace, codexHome, false);
    const liveMode = setupIsolation(runtimeRoot, workspace, codexHome, true);
    const configPath = join(codexHome, 'config.toml');
    writeFileSync(configPath, `${readFileSync(configPath, 'utf8')}# tampered\n`);
    const tampered = setupIsolation(runtimeRoot, workspace, codexHome, true);
    return {
      loginModeConfigPass: loginMode.config.ok === true,
      liveModeConfigPass: liveMode.config.ok === true,
      tamperRefused: tampered.config.ok === false && tampered.config.reason.includes('hash mismatch'),
      pass: loginMode.config.ok === true && liveMode.config.ok === true
        && tampered.config.ok === false
        && tampered.config.reason.includes('hash mismatch'),
    };
  } catch {
    return {
      loginModeConfigPass: false,
      liveModeConfigPass: false,
      tamperRefused: false,
      pass: false,
    };
  } finally {
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
}

function isolatedEnv(runtimeRoot, codexHome, hostHome) {
  return minimalEnv(runtimeRoot, codexHome, hostHome);
}

async function initialize(client) {
  const response = await client.request('initialize', {
    clientInfo: { name: 'enjoy-u1-codex-probe', version: '0.1.0' },
    capabilities: { experimentalApi: true },
  });
  client.notify('initialized');
  return response;
}

function checkInitialize(response, expectedHome) {
  const checks = {
    hasCodexHome: typeof response?.codexHome === 'string',
    codexHomeScoped: typeof response?.codexHome === 'string' && pathsEquivalent(response.codexHome, expectedHome),
    platformFields: typeof response?.platformFamily === 'string' && typeof response?.platformOs === 'string',
    userAgentPresent: typeof response?.userAgent === 'string',
  };
  return { checks, pass: Object.values(checks).every(Boolean) };
}

function extractModelCatalog(response) {
  const data = Array.isArray(response?.data) ? response.data : [];
  const models = data
    .slice(0, 16)
    .map((model) => ({
      id: typeof model?.id === 'string' ? model.id : null,
      inputModalities: Array.isArray(model?.inputModalities)
        ? model.inputModalities.filter((item) => typeof item === 'string').slice(0, 8)
        : [],
    }))
    .filter((model) => model.id);
  return { count: data.length, models, hasNextCursor: Boolean(response?.nextCursor) };
}

function extractMcpCatalog(response) {
  const data = Array.isArray(response?.data) ? response.data : [];
  return {
    count: data.length,
    servers: data.slice(0, 16).map((server) => ({
      name: typeof server?.name === 'string' ? server.name : null,
      runtimeStatus: typeof server?.runtimeStatus === 'string' ? server.runtimeStatus : null,
      authStatus: typeof server?.authStatus === 'string' ? server.authStatus : null,
      tools: server?.tools && typeof server.tools === 'object' ? Object.keys(server.tools).slice(0, 32) : [],
    })),
  };
}

function extractPermissionProfileCatalog(response) {
  const data = Array.isArray(response?.data) ? response.data : [];
  return {
    count: data.length,
    profiles: data.slice(0, 16).map((profile) => ({
      id: typeof profile?.id === 'string' ? profile.id : null,
      allowed: profile?.allowed === true,
      descriptionPresent: typeof profile?.description === 'string',
    })),
    selectedPresent: data.some((profile) => profile?.id === PERMISSION_PROFILE_ID),
    selectedAllowed: data.some((profile) => profile?.id === PERMISSION_PROFILE_ID && profile?.allowed === true),
  };
}

function extractEffectiveConfig(response) {
  const config = response?.config && typeof response.config === 'object' ? response.config : {};
  const features = config.features && typeof config.features === 'object' ? config.features : {};
  return {
    defaultPermissions: typeof config.default_permissions === 'string' ? config.default_permissions : null,
    approvalPolicy: typeof config.approval_policy === 'string' ? config.approval_policy : null,
    approvalsReviewer: typeof config.approvals_reviewer === 'string' ? config.approvals_reviewer : null,
    webSearch: typeof config.web_search === 'string' ? config.web_search : null,
    allowLoginShell: config.allow_login_shell === false ? false : config.allow_login_shell === true ? true : null,
    shellTool: features.shell_tool === false ? false : features.shell_tool === true ? true : null,
    searchTool: features.search_tool === false ? false : features.search_tool === true ? true : null,
    standaloneWebSearch: features.standalone_web_search === false
      ? false
      : features.standalone_web_search === true
        ? true
        : null,
    permissionKeys: config.permissions && typeof config.permissions === 'object'
      ? Object.keys(config.permissions).slice(0, 16)
      : [],
    configKeys: Object.keys(config).slice(0, 64),
    originKeys: response?.origins && typeof response.origins === 'object' ? Object.keys(response.origins).slice(0, 16) : [],
  };
}

function extractThreadPolicy(response, expectedWorkspace) {
  const sandbox = response?.sandbox && typeof response.sandbox === 'object' ? response.sandbox : {};
  const activeProfile = response?.activePermissionProfile && typeof response.activePermissionProfile === 'object'
    ? response.activePermissionProfile
    : null;
  const roots = Array.isArray(response?.runtimeWorkspaceRoots) ? response.runtimeWorkspaceRoots : [];
  const writableRoots = Array.isArray(sandbox.writableRoots) ? sandbox.writableRoots : [];
  const runtimeWorkspaceRootMatchesWorkspace = roots.some((root) => pathsEquivalent(root, expectedWorkspace));
  const sandboxWorkspaceWrite = sandbox.type === 'workspaceWrite';
  return {
    threadIdPresent: typeof response?.thread?.id === 'string',
    cwd: typeof response?.thread?.cwd === 'string' ? response.thread.cwd : null,
    activePermissionProfile: typeof activeProfile?.id === 'string' ? activeProfile.id : null,
    approvalPolicy: typeof response?.approvalPolicy === 'string' ? response.approvalPolicy : null,
    approvalsReviewer: typeof response?.approvalsReviewer === 'string' ? response.approvalsReviewer : null,
    sandboxType: typeof sandbox.type === 'string' ? sandbox.type : null,
    networkAccess: sandbox.networkAccess === true ? true : sandbox.networkAccess === false ? false : null,
    excludeTmpdirEnvVar: sandbox.excludeTmpdirEnvVar === true ? true : sandbox.excludeTmpdirEnvVar === false ? false : null,
    excludeSlashTmp: sandbox.excludeSlashTmp === true ? true : sandbox.excludeSlashTmp === false ? false : null,
    writableRoots: writableRoots.slice(0, 16),
    sandboxKeys: Object.keys(sandbox).slice(0, 32),
    writableRootMatchesWorkspace: writableRoots.some((root) => pathsEquivalent(root, expectedWorkspace)),
    runtimeWorkspaceRoots: roots.slice(0, 16),
    runtimeWorkspaceRootMatchesWorkspace,
    workspaceWriteImpliesCwdWritable: sandboxWorkspaceWrite,
    pass: typeof activeProfile?.id === 'string'
      && activeProfile.id === PERMISSION_PROFILE_ID
      && sandboxWorkspaceWrite
      && sandbox.networkAccess === false
      && runtimeWorkspaceRootMatchesWorkspace,
  };
}

async function readNativePolicy(client, workspace) {
  const configResponse = await withTimeout(
    client.request('config/read', { cwd: workspace, includeLayers: true }),
    8_000,
    'config/read',
  );
  const permissionProfiles = await withTimeout(
    client.request('permissionProfile/list', { cursor: null, cwd: workspace, limit: 32 }),
    8_000,
    'permissionProfile/list',
  );
  return {
    config: extractEffectiveConfig(configResponse),
    permissionProfiles: extractPermissionProfileCatalog(permissionProfiles),
  };
}

function nativePolicyConfigPass(policy) {
  return policy?.config?.defaultPermissions === PERMISSION_PROFILE_ID
    && policy?.permissionProfiles?.selectedAllowed === true
    && policy?.config?.shellTool === false
    && policy?.config?.searchTool === false
    && policy?.config?.standaloneWebSearch === false
    && policy?.config?.webSearch === 'disabled'
    && policy?.config?.allowLoginShell === false;
}

function parseGeneratedSchema(stdout) {
  try {
    const schema = JSON.parse(stdout);
    const serialized = JSON.stringify(schema);
    const requiredTokens = [
      'initialize',
      'account/read',
      'account/login/start',
      'model/list',
      'thread/start',
      'turn/start',
      'turn/interrupt',
      'item/completed',
      'turn/completed',
      'imageGeneration',
    ];
    const tokenChecks = Object.fromEntries(requiredTokens.map((token) => [token, serialized.includes(token)]));
    return {
      pass: Object.values(tokenChecks).every(Boolean),
      tokenChecks,
      bytes: Buffer.byteLength(stdout),
      sha256Prefix: createHash('sha256').update(stdout).digest('hex').slice(0, 16),
    };
  } catch {
    return { pass: false, parseError: true };
  }
}

async function probeSchemaAndVersion(evidence) {
  const runtimeRoot = mkdtempSync(join('/tmp', 'enjoy-u1-codex-bin-'));
  const isolatedHome = join(runtimeRoot, 'home');
  const isolatedCodexHome = join(runtimeRoot, 'codex-home');
  mkdirSync(isolatedHome, { recursive: true });
  mkdirSync(isolatedCodexHome, { recursive: true });
  const env = minimalEnv(runtimeRoot, isolatedCodexHome, isolatedHome);
  const version = await runProcess(CODEX_BIN, ['--version'], { timeoutMs: 8_000, env });
  const versionMatch = version.stdout.match(/\bcodex-cli\s+(\S+)/);
  evidence.binary = {
    path: CODEX_BIN,
    version: versionMatch?.[1] || null,
    exitCode: version.code,
    pass: version.code === 0 && Boolean(versionMatch),
  };
  const schemaOutDir = mkdtempSync(join('/tmp', 'enjoy-u1-codex-schema-'));
  const schema = await runProcess(CODEX_BIN, ['app-server', 'generate-json-schema', '--out', schemaOutDir, '--experimental'], { timeoutMs: 12_000, env });
  const schemaFile = join(schemaOutDir, 'codex_app_server_protocol.v2.schemas.json');
  const schemaText = existsSync(schemaFile)
    ? readFileSync(schemaFile, 'utf8')
    : existsSync(join(schemaOutDir, 'codex_app_server_protocol.schemas.json'))
      ? readFileSync(join(schemaOutDir, 'codex_app_server_protocol.schemas.json'), 'utf8')
      : '';
  evidence.schema = {
    exitCode: schema.code,
    pass: schema.code === 0 && schemaText.length > 0,
    ...(schema.code === 0 && schemaText.length > 0 ? parseGeneratedSchema(schemaText) : { parseError: true }),
  };
  rmSync(schemaOutDir, { recursive: true, force: true });
  rmSync(runtimeRoot, { recursive: true, force: true });
}

async function probeAppServer({ runtimeRoot, workspace, codexHome, includeFixture, modeName, keepRuntime }) {
  mkdirSync(runtimeRoot, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  mkdirSync(join(runtimeRoot, 'tmp'), { recursive: true });
  const isolation = setupIsolation(runtimeRoot, workspace, codexHome, includeFixture);
  if (!isolation.config.ok) {
    return {
      mode: modeName,
      pass: false,
      blocker: isolation.config.reason,
      runtimeRoot,
      codexHome,
      workspace,
    };
  }
  const env = isolatedEnv(runtimeRoot, codexHome, isolation.hostHome);
  const client = new JsonlClient(CODEX_BIN, ['app-server', '--stdio'], { cwd: workspace, env });
  const output = {
    mode: modeName,
    runtimeRoot,
    codexHome,
    workspace,
    keepRuntime,
    modelCatalog: isolation.modelCatalog,
    events: client.events,
  };
  let stage = 'initialize';
  try {
    const initializeResponse = await withTimeout(initialize(client), 10_000, 'initialize');
    output.initialize = checkInitialize(initializeResponse, codexHome);
    stage = 'account/read';
    const account = await withTimeout(client.request('account/read', { refreshToken: false }), 8_000, 'account/read');
    output.account = {
      requiresOpenaiAuth: account?.requiresOpenaiAuth === true,
      accountState: account?.account === null ? 'none' : account?.account ? 'present' : 'unknown',
      pass: typeof account?.requiresOpenaiAuth === 'boolean',
    };
    stage = 'model/list';
    const models = await withTimeout(
      client.request('model/list', { cursor: null, includeHidden: false, limit: 16 }),
      8_000,
      'model/list',
    );
    output.models = extractModelCatalog(models);
    try {
      stage = 'model/providerCapabilities/read';
      const capabilities = await withTimeout(
        client.request('model/providerCapabilities/read', {}),
        8_000,
        'model/providerCapabilities/read',
      );
      output.providerCapabilities = {
        imageGeneration: capabilities?.imageGeneration === true,
        namespaceTools: capabilities?.namespaceTools === true,
        webSearch: capabilities?.webSearch === true,
      };
    } catch {
      output.providerCapabilities = { unavailable: true };
    }
    stage = 'mcpServerStatus/list';
    const mcp = await withTimeout(
      client.request('mcpServerStatus/list', {
        cursor: null,
        detail: 'full',
        limit: 32,
        threadId: null,
      }),
      10_000,
      'mcpServerStatus/list',
    );
    output.mcpCatalog = extractMcpCatalog(mcp);
    const foreignCatalogNames = output.mcpCatalog.servers
      .map((server) => server.name)
      .filter((name) => name && name.startsWith('foreign_'));
    const foreignEventNames = client.events
      .filter((event) => event.method === 'mcpServer/startupStatus/updated')
      .map((event) => event.server)
      .filter((name) => name && name.startsWith('foreign_'));
    const foreignNames = [...new Set([...foreignCatalogNames, ...foreignEventNames])];
    stage = 'config/read + permissionProfile/list';
    output.policy = await readNativePolicy(client, workspace);
    stage = 'thread/start policy probe';
    const policyThread = await withTimeout(
      client.request('thread/start', {
        cwd: canonicalExistingPath(workspace),
        model: null,
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        ephemeral: true,
        permissions: PERMISSION_PROFILE_ID,
        runtimeWorkspaceRoots: [canonicalExistingPath(workspace)],
      }),
      10_000,
      'thread/start policy probe',
    );
    output.policy.thread = extractThreadPolicy(policyThread, workspace);
    const configMode0600 = (statSync(join(codexHome, 'config.toml')).mode & 0o777) === 0o600;
    const configReceiptMode0600 = (statSync(join(dirname(codexHome), CONFIG_RECEIPT_FILENAME)).mode & 0o777) === 0o600;
    output.isolation = {
      codexHomeScoped: output.initialize.pass,
      foreignServersAbsent: foreignNames.length === 0,
      foreignServers: foreignNames,
      foreignCatalogServers: foreignCatalogNames,
      foreignStartupEvents: foreignEventNames,
      configMode0600,
      configReceiptMode0600,
      modelCatalogOverridePass: output.modelCatalog?.patchCapabilitiesDisabled === true
        && output.modelCatalog?.inputImageModalitiesPreserved === true,
      policyProfileSelected: output.policy?.config?.defaultPermissions === PERMISSION_PROFILE_ID,
      policyProfileAllowed: output.policy?.permissionProfiles?.selectedAllowed === true,
      effectivePolicyPass: output.policy?.thread?.pass === true,
      forbiddenFeaturesDisabled: nativePolicyConfigPass(output.policy),
      pass: output.initialize.pass
        && foreignNames.length === 0
        && output.modelCatalog?.ok === true
        && configMode0600
        && configReceiptMode0600
        && output.policy?.config?.defaultPermissions === PERMISSION_PROFILE_ID
        && output.policy?.permissionProfiles?.selectedAllowed === true
        && output.policy?.thread?.pass === true
        && nativePolicyConfigPass(output.policy),
    };
    if (includeFixture) {
      output.fixture = {
        serverPresent: output.mcpCatalog.servers.some((server) => server.name === 'enjoy_fixture'),
        toolPresent: output.mcpCatalog.servers.some(
          (server) => server.name === 'enjoy_fixture' && server.tools.includes('enjoy.submit_lesson_draft'),
        ),
      };
    }
    output.events = client.events;
    output.malformedJsonl = client.malformedLines;
    output.serverRequests = client.serverRequests;
    output.serverResponses = client.serverResponses;
    output.pass = output.initialize.pass && output.account.pass && output.isolation.pass;
  } catch (error) {
    output.pass = false;
    output.blocker = error?.message === 'app-server process stopped' ? 'process-stopped' : `protocol-request-failed:${stage}`;
    if (error && typeof error === 'object') {
      output.protocolError = {
        code: typeof error.code === 'number' ? error.code : null,
        hasMessage: error.hasMessage === true,
        errorType: typeof error,
        message: typeof error.message === 'string' ? redactForEvidence(error.message) : null,
      };
    }
  } finally {
    await client.stop();
    output.events = client.events;
    output.processExit = await Promise.race([client.exit, delay(100)]);
    output.malformedJsonl = client.malformedLines;
    output.serverRequests = client.serverRequests;
    output.serverResponses = client.serverResponses;
    if (!keepRuntime) rmSync(runtimeRoot, { recursive: true, force: true });
  }
  return output;
}

async function runLogin(evidence) {
  const runtimeRoot = dirname(authHome);
  mkdirSync(authWorkspace, { recursive: true });
  const isolation = setupIsolation(runtimeRoot, authWorkspace, authHome, false);
  if (!isolation.config.ok) {
    evidence.login = { pass: false, status: 'config-conflict', blocker: isolation.config.reason };
    return false;
  }
  const env = isolatedEnv(runtimeRoot, authHome, isolation.hostHome);
  const client = new JsonlClient(CODEX_BIN, ['app-server', '--stdio'], { cwd: authWorkspace, env });
  try {
    await withTimeout(initialize(client), 10_000, 'initialize');
    const account = await withTimeout(client.request('account/read', { refreshToken: false }), 8_000, 'account/read');
    if (account?.account) {
      evidence.login = {
        pass: true,
        status: 'already-authenticated',
        accountType: typeof account.account.type === 'string' ? account.account.type : 'unknown',
      };
      return true;
    }
    const loginResponse = await withTimeout(
      client.request('account/login/start', {
        type: 'chatgpt',
        useHostedLoginSuccessPage: false,
        codexStreamlinedLogin: false,
        appBrand: null,
      }),
      12_000,
      'account/login/start',
    );
    let browserOpened = false;
    let authUrlOfficial = false;
    if (loginResponse?.type === 'chatgpt' && typeof loginResponse.authUrl === 'string') {
      try {
        const authUrl = new URL(loginResponse.authUrl);
        authUrlOfficial = authUrl.protocol === 'https:' && authUrl.hostname === 'auth.openai.com';
        if (authUrlOfficial) {
          const browser = spawn('/usr/bin/open', [loginResponse.authUrl], {
            stdio: 'ignore',
            detached: true,
          });
          browser.unref();
          browserOpened = true;
        }
      } catch {
        authUrlOfficial = false;
      }
    }
    const completed = await client.waitFor('account/login/completed', LOGIN_WAIT_MS - 1_000);
    const success = completed?.success === true;
    const accountAfter = success
      ? await withTimeout(client.request('account/read', { refreshToken: false }), 8_000, 'account/read after login')
      : null;
    evidence.login = {
      pass: success && Boolean(accountAfter?.account),
      status: success ? 'completed' : 'pending-or-failed',
      browserOpened,
      authUrlOfficial,
      accountState: accountAfter?.account ? 'present' : 'unknown',
      sensitiveAuthFields: 'omitted',
      events: client.events,
    };
    return evidence.login.pass;
  } catch {
    evidence.login = {
      pass: false,
      status: 'probe-error',
      browserOpened: false,
      sensitiveAuthFields: 'omitted',
      events: client.events,
    };
    return false;
  } finally {
    await client.stop();
  }
}

async function waitForMcpReady(client, expectedName) {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    const response = await client.request('mcpServerStatus/list', {
      cursor: null,
      detail: 'full',
      limit: 32,
      threadId: null,
    });
    const catalog = extractMcpCatalog(response);
    const server = catalog.servers.find((item) => item.name === expectedName);
    if (server?.tools.includes('enjoy.submit_lesson_draft')) return catalog;
    await delay(250);
  }
  return null;
}

function makeOutputSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean' },
      kind: { type: 'string' },
      toolCalled: { type: 'boolean' },
    },
    required: ['ok', 'kind', 'toolCalled'],
  };
}

function readReceipt(receiptPath) {
  if (!existsSync(receiptPath)) return null;
  try {
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    return {
      accepted: receipt.accepted === true,
      callCount: Number.isInteger(receipt.callCount) ? receipt.callCount : null,
      schemaVersion: receipt.schemaVersion || null,
      jobIdPresent: typeof receipt.jobId === 'string',
      stageIdPresent: typeof receipt.stageId === 'string',
      attemptIdPresent: typeof receipt.attemptId === 'string',
      expectedRevisionPresent: typeof receipt.expectedRevision === 'string',
      idempotencyKeyPresent: typeof receipt.idempotencyKey === 'string',
      payloadHash: typeof receipt.payloadHash === 'string' ? receipt.payloadHash : null,
    };
  } catch {
    return null;
  }
}

async function runLiveTurn(kind, evidence) {
  const runtimeRoot = dirname(authHome);
  mkdirSync(authWorkspace, { recursive: true });
  const isolation = setupIsolation(runtimeRoot, authWorkspace, authHome, true);
  if (!isolation.config.ok) {
    evidence[kind] = { pass: false, blocker: isolation.config.reason };
    return false;
  }
  const env = isolatedEnv(runtimeRoot, authHome, isolation.hostHome);
  const client = new JsonlClient(CODEX_BIN, ['app-server', '--stdio'], { cwd: authWorkspace, env });
  const receiptPath = join(runtimeRoot, 'mcp-receipt.json');
  try {
    await withTimeout(initialize(client), 10_000, 'initialize');
    const account = await withTimeout(client.request('account/read', { refreshToken: false }), 8_000, 'account/read');
    if (!account?.account) {
      evidence[kind] = { pass: false, blocker: 'auth-required', sensitiveAuthFields: 'omitted' };
      return false;
    }
    if (
      isolation.modelCatalog?.ok !== true
      || isolation.modelCatalog?.patchCapabilitiesDisabled !== true
      || isolation.modelCatalog?.inputImageModalitiesPreserved !== true
    ) {
      evidence[kind] = {
        pass: false,
        blocker: 'model-catalog-override-not-proven',
        modelCatalog: isolation.modelCatalog,
        sensitiveAuthFields: 'omitted',
      };
      return false;
    }
    const policy = await readNativePolicy(client, authWorkspace);
    if (!nativePolicyConfigPass(policy)) {
      evidence[kind] = {
        pass: false,
        blocker: 'native-policy-config-not-proven',
        policy,
        serverRequests: client.serverRequests,
        sensitiveAuthFields: 'omitted',
      };
      return false;
    }
    const mcpCatalog = await waitForMcpReady(client, 'enjoy_fixture');
    if (!mcpCatalog) {
      evidence[kind] = { pass: false, blocker: 'Enjoy MCP fixture not ready', sensitiveAuthFields: 'omitted' };
      return false;
    }
    const thread = await withTimeout(
      client.request('thread/start', {
        cwd: canonicalExistingPath(authWorkspace),
        model: null,
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        ephemeral: true,
        permissions: PERMISSION_PROFILE_ID,
        runtimeWorkspaceRoots: [canonicalExistingPath(authWorkspace)],
      }),
      10_000,
      'thread/start',
    );
    const threadId = thread?.thread?.id;
    if (typeof threadId !== 'string') {
      evidence[kind] = { pass: false, blocker: 'thread-id-missing' };
      return false;
    }
    const effectivePolicy = extractThreadPolicy(thread, authWorkspace);
    if (!effectivePolicy.pass) {
      evidence[kind] = {
        pass: false,
        blocker: 'native-policy-effective-state-not-proven',
        policy,
        effectivePolicy,
        serverRequests: client.serverRequests,
        sensitiveAuthFields: 'omitted',
      };
      return false;
    }
    const jobIds = {
      schemaVersion: 'enjoy.learning/1',
      jobId: `u1-${kind}`,
      stageId: 'text',
      attemptId: randomUUID(),
      expectedRevision: 'revision-1',
      idempotencyKey: randomUUID(),
    };
    const prompt =
      kind === 'text'
        ? `You are a native integration probe. Use only the MCP server tool enjoy.submit_lesson_draft. Call it exactly once with schemaVersion ${jobIds.schemaVersion}, jobId ${jobIds.jobId}, stageId ${jobIds.stageId}, attemptId ${jobIds.attemptId}, expectedRevision ${jobIds.expectedRevision}, idempotencyKey ${jobIds.idempotencyKey}, title "A coffee break", and a short English text containing "coffee". Do not use shell, files, web, or any other tool. After the tool succeeds, return only JSON with ok=true, kind="text", toolCalled=true.`
        : 'Use the native image generation capability to create one small simple illustration of a red apple on a plain light background. Do not use shell, files, web, or MCP. Return one short confirmation after the image item completes.';
    const turnResponse = await withTimeout(
      client.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: prompt }],
        outputSchema: kind === 'text' ? makeOutputSchema() : null,
      }),
      12_000,
      'turn/start',
    );
    const turnId = turnResponse?.turn?.id;
    const completionTimeoutMs = kind === 'image' ? 180_000 : 60_000;
    const completion = await client.waitFor('turn/completed', completionTimeoutMs);
    if (!completion) {
      evidence[kind] = {
        pass: false,
        blocker: 'turn-completion-timeout',
        outcome: 'unknown',
        turnIdPresent: typeof turnId === 'string',
        completionTimeoutMs,
        modelCatalog: isolation.modelCatalog,
        policy,
        effectivePolicy,
        serverRequests: client.serverRequests,
        events: client.events,
        sensitiveAuthFields: 'omitted',
      };
      return false;
    }
    const itemEvents = client.events.filter((event) => event.method === 'item/completed');
    const toolEvent = itemEvents.find(
      (event) => event.itemType === 'mcpToolCall' && event.server === 'enjoy_fixture' && event.tool === 'enjoy.submit_lesson_draft',
    );
    const receipt = kind === 'text' ? readReceipt(receiptPath) : null;
    const imageItems = kind === 'image'
      ? itemEvents
        .filter((event) => event.itemType === 'imageGeneration' && event.itemStatus === 'completed')
        .map((event) => ({
          event,
          item: client.rawItems?.find((item) => item.id === event.itemId),
        }))
        .filter(({ item }) => item?.type === 'imageGeneration')
        .slice(0, MAX_IMAGE_ITEMS)
      : [];
    const output = {
      turnIdPresent: typeof turnId === 'string',
      completed: Boolean(completion),
      completionStatus: completion?.turnStatus || null,
      completionTimeoutMs,
      modelCatalog: isolation.modelCatalog,
      policy,
      effectivePolicy,
      serverRequests: client.serverRequests,
      events: client.events,
    };
    if (kind === 'text') {
      output.fixture = {
        catalog: mcpCatalog,
        toolEventPresent: Boolean(toolEvent),
        receipt,
      };
      output.pass = Boolean(
        completion &&
          toolEvent &&
          receipt?.accepted &&
          receipt.callCount === 1 &&
          receipt.schemaVersion === 'enjoy.learning/1' &&
          receipt.jobIdPresent &&
          receipt.stageIdPresent &&
          receipt.attemptIdPresent &&
          receipt.expectedRevisionPresent &&
          receipt.idempotencyKeyPresent,
      );
    } else {
      const savedPathProof = await Promise.all(
        imageItems.map(({ item }) => inspectImageArtifact(item.savedPath, authWorkspace)),
      );
      const resultProof = await Promise.all(
        imageItems.map(({ item }) => inspectImageResult(item.result, item.resultTooLarge === true)),
      );
      output.image = {
        imageEventPresent: imageItems.length > 0,
        trustedItems: imageItems.length,
        savedPathProof,
        resultProof,
        nativeBytesValid: [...savedPathProof, ...resultProof].some((proof) => proof.valid),
        provenance: imageItems.length > 0 ? 'trusted native item imageGeneration' : null,
      };
      output.pass = Boolean(imageItems.length > 0 && output.image.nativeBytesValid);
    }
    evidence[kind] = output;
    return output.pass;
  } catch (error) {
    const timedOut = typeof error?.message === 'string' && error.message.includes('timed out');
    evidence[kind] = {
      pass: false,
      blocker: timedOut ? 'live-turn-timeout' : 'live-turn-protocol-failed',
      ...(timedOut ? { outcome: 'unknown' } : {}),
      sensitiveAuthFields: 'omitted',
    };
    return false;
  } finally {
    await client.stop();
  }
}

async function decodeImageBytes(bytes) {
  if (!existsSync(FFMPEG_BIN)) return { ok: false, reason: 'decoder-unavailable' };
  return new Promise((resolveDecode) => {
    const child = spawn(FFMPEG_BIN, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-protocol_whitelist',
      'file,pipe',
      '-max_alloc',
      String(64 * 1024 * 1024),
      '-threads',
      '1',
      '-i',
      'pipe:0',
      '-map',
      '0:v:0',
      '-frames:v',
      '1',
      '-f',
      'null',
      '-',
    ], {
      stdio: ['pipe', 'ignore', 'pipe'],
      detached: true,
    });
    let settled = false;
    let stderrBytes = 0;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveDecode(value);
    };
    const timer = setTimeout(() => {
      terminateProcess(child);
      finish({ ok: false, reason: 'decoder-timeout' });
    }, IMAGE_DECODE_TIMEOUT_MS);
    child.once('error', () => finish({ ok: false, reason: 'decoder-error' }));
    child.once('exit', (code, signal) => finish({
      ok: code === 0,
      reason: code === 0 ? null : signal === 'SIGTERM' || signal === 'SIGKILL' ? 'decoder-timeout' : 'decoder-rejected',
    }));
    child.stderr.on('data', (chunk) => {
      stderrBytes += Buffer.byteLength(chunk);
      if (stderrBytes > 1024 * 1024) terminateProcess(child);
    });
    child.stdin.end(bytes);
  });
}

async function inspectImageArtifact(savedPath, approvedRoot) {
  if (typeof savedPath !== 'string') return { valid: false, pathScope: 'absent' };
  const resolvedPath = resolve(savedPath);
  if (!existsSync(resolvedPath)) return { valid: false, pathScope: 'approved-missing' };
  let canonicalPath;
  try {
    canonicalPath = realpathSync(resolvedPath);
  } catch {
    return { valid: false, pathScope: 'approved-unresolvable' };
  }
  const scoped = assertPathInside(canonicalPath, canonicalExistingPath(approvedRoot));
  if (!scoped) return { valid: false, pathScope: 'outside-approved-root' };
  const stat = statSync(canonicalPath);
  if (!stat.isFile()) return { valid: false, pathScope: 'approved-not-file' };
  if (stat.size > MAX_IMAGE_RESULT_BYTES) {
    return { valid: false, pathScope: 'approved-too-large', bytes: stat.size };
  }
  const bytes = readFileSync(canonicalPath);
  const mime = detectImageMime(bytes);
  const decoded = mime ? await decodeImageBytes(bytes) : { ok: false, reason: 'unsupported-signature' };
  return {
    valid: Boolean(mime && bytes.length > 0 && decoded.ok),
    pathScope: 'approved',
    bytes: bytes.length,
    mime,
    decoded: decoded.ok,
    decodeReason: decoded.reason,
    sha256Prefix: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
  };
}

async function inspectImageResult(result, resultTooLarge = false) {
  if (resultTooLarge) return { valid: false, source: 'result', reason: 'result-too-large' };
  if (typeof result !== 'string') return { valid: false, source: 'result', reason: 'result-missing' };
  if (Buffer.byteLength(result, 'utf8') > MAX_IMAGE_RESULT_CHARS) {
    return { valid: false, source: 'result', reason: 'result-too-large' };
  }
  let encoded = result;
  let declaredMime = null;
  const dataUrlMatch = result.match(/^data:(image\/(?:png|jpeg|webp));base64,(.*)$/s);
  if (dataUrlMatch) {
    declaredMime = dataUrlMatch[1];
    encoded = dataUrlMatch[2];
  } else if (result.startsWith('data:')) {
    return { valid: false, source: 'result', reason: 'unsupported-data-url' };
  }
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    return { valid: false, source: 'result', reason: 'invalid-base64' };
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_RESULT_BYTES) {
    return { valid: false, source: 'result', reason: 'decoded-result-out-of-bounds', bytes: bytes.length };
  }
  const mime = detectImageMime(bytes);
  const decoded = mime ? await decodeImageBytes(bytes) : { ok: false, reason: 'unsupported-signature' };
  if (!mime || (declaredMime && declaredMime !== mime)) {
    return { valid: false, source: 'result', reason: 'image-signature-mismatch', mime: mime || null };
  }
  return {
    valid: decoded.ok,
    source: 'result',
    encoding: dataUrlMatch ? 'data-url-base64' : 'base64',
    bytes: bytes.length,
    mime,
    decoded: decoded.ok,
    decodeReason: decoded.reason,
    sha256Prefix: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
  };
}

function detectImageMime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

async function runCancelFixture(evidence) {
  const runtimeRoot = join('/tmp', `enjoy-u1-cancel-${process.pid}-${Date.now()}`);
  mkdirSync(join(runtimeRoot, 'tmp'), { recursive: true });
  const child = spawn(NODE_BIN, ['-e', 'setTimeout(() => {}, 30000)'], {
    cwd: REPOSITORY_ROOT,
    env: minimalEnv(runtimeRoot),
    stdio: 'ignore',
    detached: true,
  });
  await delay(150);
  terminateProcess(child);
  const exit = await Promise.race([new Promise((resolveExit) => child.once('exit', (code, signal) => resolveExit({ code, signal }))), delay(2_000)]);
  evidence.cancelFixture = {
    pass: Boolean(exit && (exit.signal === 'SIGTERM' || exit.signal === 'SIGKILL')),
    processExit: exit || 'timeout',
    processGroupOwned: true,
  };
  rmSync(runtimeRoot, { recursive: true, force: true });
  return evidence.cancelFixture.pass;
}

async function runLiveCancel(evidence) {
  const runtimeRoot = dirname(authHome);
  mkdirSync(authWorkspace, { recursive: true });
  const isolation = setupIsolation(runtimeRoot, authWorkspace, authHome, true);
  if (!isolation.config.ok) {
    evidence.liveCancel = { pass: false, blocker: isolation.config.reason };
    return false;
  }
  const env = isolatedEnv(runtimeRoot, authHome, isolation.hostHome);
  const client = new JsonlClient(CODEX_BIN, ['app-server', '--stdio'], { cwd: authWorkspace, env });
  try {
    await withTimeout(initialize(client), 10_000, 'initialize');
    const account = await withTimeout(client.request('account/read', { refreshToken: false }), 8_000, 'account/read');
    if (!account?.account) {
      evidence.liveCancel = { pass: false, blocker: 'auth-required' };
      return false;
    }
    if (
      isolation.modelCatalog?.ok !== true
      || isolation.modelCatalog?.patchCapabilitiesDisabled !== true
      || isolation.modelCatalog?.inputImageModalitiesPreserved !== true
    ) {
      evidence.liveCancel = {
        pass: false,
        blocker: 'model-catalog-override-not-proven',
        modelCatalog: isolation.modelCatalog,
      };
      return false;
    }
    const policy = await readNativePolicy(client, authWorkspace);
    if (!nativePolicyConfigPass(policy)) {
      evidence.liveCancel = { pass: false, blocker: 'native-policy-config-not-proven', policy };
      return false;
    }
    const thread = await withTimeout(
      client.request('thread/start', {
        cwd: canonicalExistingPath(authWorkspace),
        model: null,
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        ephemeral: true,
        permissions: PERMISSION_PROFILE_ID,
        runtimeWorkspaceRoots: [canonicalExistingPath(authWorkspace)],
      }),
      10_000,
      'thread/start',
    );
    const threadId = thread?.thread?.id;
    if (!threadId) {
      evidence.liveCancel = { pass: false, blocker: 'thread-id-missing' };
      return false;
    }
    const effectivePolicy = extractThreadPolicy(thread, authWorkspace);
    if (!effectivePolicy.pass) {
      evidence.liveCancel = {
        pass: false,
        blocker: 'native-policy-effective-state-not-proven',
        policy,
        effectivePolicy,
      };
      return false;
    }
    const turn = await withTimeout(
      client.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: 'Wait silently for a long time before answering. Do not call tools.' }],
      }),
      12_000,
      'turn/start',
    );
    const turnId = turn?.turn?.id;
    const interrupt = await withTimeout(
      client.request('turn/interrupt', { threadId, turnId }),
      8_000,
      'turn/interrupt',
    );
    const completion = await client.waitFor('turn/completed', 20_000);
    evidence.liveCancel = {
      pass: Boolean(turnId && interrupt && completion),
      turnIdPresent: Boolean(turnId),
      interruptResponse: interrupt !== null,
      completionStatus: completion?.turnStatus || null,
      modelCatalog: isolation.modelCatalog,
      policy,
      effectivePolicy,
      serverRequests: client.serverRequests,
      events: client.events,
    };
    return evidence.liveCancel.pass;
  } catch {
    evidence.liveCancel = { pass: false, blocker: 'cancel-protocol-failed' };
    return false;
  } finally {
    await client.stop();
  }
}

function renderEvidence(evidence) {
  const lines = [
    '# U1 Codex native probe evidence',
    '',
    `- Generated: ${evidence.generatedAt}`,
    `- Mode: ${evidence.mode}`,
    `- Binary: ${redactForEvidence(evidence.binary?.path)}`,
    `- Native streams: JSONL parsed into allowlisted summaries; raw stdout/stderr omitted.`,
    `- Sensitive authentication fields: omitted from output and evidence.`,
    '',
    '## Binary and schema',
    '',
    `- Binary pass: ${evidence.binary?.pass === true}; version: ${redactForEvidence(evidence.binary?.version || 'unknown')}.`,
    `- Schema pass: ${evidence.schema?.pass === true}; bytes: ${redactForEvidence(evidence.schema?.bytes || 'unknown')}; hash prefix: ${redactForEvidence(evidence.schema?.sha256Prefix || 'unknown')}.`,
    `- Required native contract tokens: ${evidence.schema?.tokenChecks ? Object.entries(evidence.schema.tokenChecks).filter(([, pass]) => pass).map(([token]) => token).join(', ') : 'unavailable'}.`,
    `- Managed config lifecycle: ${evidence.configLifecycle?.pass === true ? 'PASS' : 'FAIL'}; login setup: ${evidence.configLifecycle?.loginModeConfigPass === true}; live regeneration: ${evidence.configLifecycle?.liveModeConfigPass === true}; tamper refused: ${evidence.configLifecycle?.tamperRefused === true}.`,
    '',
    '## No-auth app-server',
    '',
    `- Probe pass: ${evidence.noAuth?.pass === true}.`,
    `- Initialize scoped home: ${evidence.noAuth?.initialize?.checks?.codexHomeScoped === true}; account requires auth: ${evidence.noAuth?.account?.requiresOpenaiAuth === true}; catalog count: ${redactForEvidence(evidence.noAuth?.models?.count ?? 'unknown')}.`,
    `- App-owned model catalog: ${evidence.noAuth?.modelCatalog?.ok === true && evidence.noAuth?.modelCatalog?.patchCapabilitiesDisabled === true ? 'PASS' : 'NOT PROVEN'}; Codex ${MODEL_CATALOG_VERSION}; models: ${redactForEvidence(evidence.noAuth?.modelCatalog?.modelCount ?? 'unknown')}; patch metadata disabled: ${evidence.noAuth?.modelCatalog?.patchCapabilitiesDisabled === true}; input image modalities preserved: ${evidence.noAuth?.modelCatalog?.inputImageModalitiesPreserved === true}; this does not prove the image_generation tool is enabled; override hash: ${redactForEvidence(evidence.noAuth?.modelCatalog?.overrideSha256 || 'unknown')}.`,
    `- MCP catalog count: ${redactForEvidence(evidence.noAuth?.mcpCatalog?.count ?? 'unknown')}; foreign user/project servers absent from catalog and startup events: ${evidence.noAuth?.isolation?.foreignServersAbsent === true}; names: ${redactForEvidence(evidence.noAuth?.isolation?.foreignServers?.join(',') || 'none')}.`,
    `- Effective native policy: profile ${redactForEvidence(evidence.noAuth?.policy?.config?.defaultPermissions || 'unknown')}; profile allowed: ${evidence.noAuth?.policy?.permissionProfiles?.selectedAllowed === true}; shell_tool: ${redactForEvidence(evidence.noAuth?.policy?.config?.shellTool ?? 'unknown')}; search_tool: ${redactForEvidence(evidence.noAuth?.policy?.config?.searchTool ?? 'unknown')}; standalone_web_search: ${redactForEvidence(evidence.noAuth?.policy?.config?.standaloneWebSearch ?? 'unknown')}; web_search: ${redactForEvidence(evidence.noAuth?.policy?.config?.webSearch || 'unknown')}; effective thread: ${evidence.noAuth?.policy?.thread?.pass === true} (active ${redactForEvidence(evidence.noAuth?.policy?.thread?.activePermissionProfile || 'unknown')}, sandbox ${redactForEvidence(evidence.noAuth?.policy?.thread?.sandboxType || 'unknown')}, network ${redactForEvidence(evidence.noAuth?.policy?.thread?.networkAccess ?? 'unknown')}, workspace write ${evidence.noAuth?.policy?.thread?.workspaceWriteImpliesCwdWritable === true && evidence.noAuth?.policy?.thread?.runtimeWorkspaceRootMatchesWorkspace === true}, explicit extra roots ${redactForEvidence(evidence.noAuth?.policy?.thread?.writableRoots?.join(',') || 'none')}, runtime roots ${redactForEvidence(evidence.noAuth?.policy?.thread?.runtimeWorkspaceRoots?.join(',') || 'none')}).`,
    `- Native server approval requests handled: ${redactForEvidence(evidence.noAuth?.serverRequests?.length ?? 'unknown')}; responses emitted: ${redactForEvidence(evidence.noAuth?.serverResponses?.length ?? 'unknown')}.`,
    `- Malformed JSONL lines observed: ${redactForEvidence(evidence.noAuth?.malformedJsonl ?? 'unknown')}.`,
    '',
    '## Authentication',
    '',
    `- Login status: ${redactForEvidence(evidence.login?.status || 'not-run')}; browser opened: ${evidence.login?.browserOpened === true}; auth fields: omitted.`,
    `- Persistent app-owned home: ${redactForEvidence(authHome)}.`,
    '',
    '## Live capabilities',
    '',
    `- Text + Enjoy submit tool: ${evidence.text?.pass === true ? 'PASS' : evidence.text ? 'FAIL' : 'NOT RUN'}.`,
    `- Native image item and bytes: ${evidence.image?.pass === true ? 'PASS' : evidence.image ? 'FAIL' : 'NOT RUN'}.`,
    `- App-server turn interrupt: ${evidence.liveCancel?.pass === true ? 'PASS' : evidence.liveCancel ? 'FAIL' : 'NOT RUN'}.`,
    `- Fixture process-group cancel: ${evidence.cancelFixture?.pass === true}.`,
    `- Live native policy gate: ${evidence.text?.effectivePolicy?.pass === true || evidence.image?.effectivePolicy?.pass === true || evidence.liveCancel?.effectivePolicy?.pass === true ? 'PASS' : 'NOT PROVEN'}; forbidden shell/file/network approval requests are declined if emitted.`,
    '',
    '## Blockers and boundaries',
    '',
    '- No-auth proves protocol, auth requirement, model catalog and isolated home behavior only.',
    '- The policy probe records effective config, profile catalog and thread sandbox. Shell and web feature gates are recorded. Apply Patch is disabled through the app-owned model catalog override, which is hash-checked before every app-server run. The no-auth protocol still does not expose the final model tool catalog, so runtime inference remains a separate boundary.',
    '- Live text/image/cancel require the user-owned Codex account to complete the official browser login in the persistent app-owned home.',
    '- This probe does not read or copy credentials, does not use API fallback, and does not claim image capability until native image item bytes pass.',
    '',
  ];
  return lines.join('\n');
}

async function main() {
  const evidence = { generatedAt: now(), mode, binary: null, schema: null };
  evidence.configLifecycle = runConfigLifecycleRegression();
  await probeSchemaAndVersion(evidence);
  const cancelFixturePass = await runCancelFixture(evidence);
  if (mode === 'no-auth') {
    const runtimeRoot = join('/tmp', `enjoy-u1-codex-${process.pid}-${Date.now()}`);
    const noAuth = await probeAppServer({
      runtimeRoot,
      workspace: join(runtimeRoot, 'workspace'),
      codexHome: join(runtimeRoot, 'codex-home'),
      includeFixture: false,
      modeName: 'no-auth',
      keepRuntime: process.env.ENJOY_KEEP_CODEX_RUNTIME === '1',
    });
    evidence.noAuth = noAuth;
    if (process.env.ENJOY_DEBUG_CODEX === '1') console.log(JSON.stringify(noAuth, null, 2));
  } else if (mode === 'login') {
    await runLogin(evidence);
  } else if (mode === 'live-image') {
    await runLiveTurn('image', evidence);
  } else if (mode === 'live-cancel') {
    await runLiveCancel(evidence);
  } else {
    await runLiveTurn('text', evidence);
  }
  writeFileSync(EVIDENCE_PATH, renderEvidence(evidence), { mode: 0o600 });
  const primaryPass = mode === 'no-auth' ? evidence.noAuth?.pass === true : evidence[mode === 'live-text' ? 'text' : mode === 'live-image' ? 'image' : mode === 'live-cancel' ? 'liveCancel' : 'login']?.pass === true;
  const pass = evidence.binary?.pass === true
    && evidence.schema?.pass === true
    && evidence.configLifecycle?.pass === true
    && primaryPass
    && cancelFixturePass;
  console.log(`codex-native mode=${mode} binary=${evidence.binary?.pass ? 'pass' : 'fail'} schema=${evidence.schema?.pass ? 'pass' : 'fail'} primary=${primaryPass ? 'pass' : 'fail'} fixtureCancel=${cancelFixturePass ? 'pass' : 'fail'}`);
  console.log(`evidence=${EVIDENCE_PATH}`);
  process.exitCode = pass ? 0 : 1;
}

main().catch((error) => {
  const evidence = {
    generatedAt: now(),
    mode,
    binary: { pass: false, reason: 'unhandled-error' },
    schema: { pass: false, reason: 'unhandled-error' },
    blocker: redactForEvidence(error?.message || 'unknown'),
  };
  writeFileSync(EVIDENCE_PATH, renderEvidence(evidence), { mode: 0o600 });
  console.log(`codex-native mode=${mode} binary=fail schema=fail primary=fail fixtureCancel=fail`);
  console.log(`evidence=${EVIDENCE_PATH}`);
  process.exitCode = 1;
});
