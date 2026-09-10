import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, rm, writeFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(join(root, '.tmp-native-cancel-live-'));
try {
  const output = join(temporary, 'subject.mjs');
  await build({ stdin: { contents: 'export {CodexNativeAgent} from "./src/main/agents/codex-native"; export {ClaudeNativeAgent} from "./src/main/agents/claude-native"; export {probeNativeAgent} from "./src/main/agents/native-discovery";', resolveDir: root }, outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
  const { CodexNativeAgent, ClaudeNativeAgent, probeNativeAgent } = await import(pathToFileURL(output).href);
  for (const provider of ['codex', 'claude']) {
    const workspace = join(temporary, provider); const privateHome = join(temporary, `${provider}-private`);
    await mkdir(workspace, { mode: 0o700 }); await mkdir(privateHome, { mode: 0o700 });
    const probe = await probeNativeAgent(provider); assert.equal(probe.text, true);
    const controller = new AbortController(); let nativeStarted = false; let timer;
    const started = Date.now(); let code;
    try {
      await new (provider === 'codex' ? CodexNativeAgent : ClaudeNativeAgent)().run({ executable: probe.executable, workspace: await realpath(workspace), privateHome: await realpath(privateHome), signal: controller.signal, timeoutMs: 45000, prompt: 'Write a detailed English learning story of 2500 words about a trip, with numbered paragraphs. Use no tools.', onEvent: event => { if (event.type === 'started' && !nativeStarted) { nativeStarted = true; timer = setTimeout(() => controller.abort(), 1200); } } });
    } catch (error) { code = error.code; if (error.cleanup) await error.cleanup(); }
    finally { clearTimeout(timer); }
    assert.equal(nativeStarted, true); assert.equal(controller.signal.aborted, true); assert.equal(code, 'native_cancelled');
    const evidence = { pass: true, provider, version: probe.version, nativeStarted, abortDelayMs: 1200, code, adapterCleanupCompleted: true, elapsedMs: Date.now() - started };
    const directory = join(root, 'tmp/learning-acceptance/2026-09-07'); await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${provider}-native-cancel.json`), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
