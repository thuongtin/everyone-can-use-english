import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "enjoy-downloader-test-"));
try {
  const bundle = path.join(temp, "adapter.mjs");
  await build({ entryPoints: [path.resolve(import.meta.dirname, "../src/main/yt-dlp.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm" });
  const { downloadWithYtDlp, downloaderEnv, findYtDlp } = await import(pathToFileURL(bundle));
  const binary = path.join(temp, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  fs.writeFileSync(binary, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.at(-2) !== '--' || args.at(-1) !== process.env.EXPECTED_URL) process.exit(8);
if (process.env.MODE === 'fail') { console.error('fixture failure'); process.exit(3); }
if (process.env.MODE === 'wait') { setTimeout(() => {}, 30000); }
else {
  const output = args[args.indexOf('--output') + 1].replace('%(ext)s', 'mp4');
  if (process.env.MODE !== 'missing') fs.writeFileSync(output, 'fixture video');
  process.stdout.write('ENJOY_PRO');
  setTimeout(() => { process.stdout.write('GRESS 25.5%|1 MiB/s\\n'); }, 10);
}
`, { mode: 0o755 });
  assert.equal(findYtDlp({ PATH: temp }), binary);
  assert.equal(findYtDlp({ PATH: path.join(temp, "missing") }), undefined);
  assert.ok(downloaderEnv({ PATH: temp }).PATH.includes(temp));
  const url = 'https://www.youtube.com/watch?v=YCldrsmxi_s&name=$(echo should-not-run)';
  const progress = [];
  const options = { binary, url, cachePath: temp, ffmpegPath: '/fixture/ffmpeg', env: { ...process.env, EXPECTED_URL: url }, onProgress: (...args) => progress.push(args) };
  const output = await downloadWithYtDlp(options);
  assert.ok(fs.statSync(output).size);
  assert.deepEqual(progress, [[25.5, '1 MiB/s']]);
  fs.rmSync(path.dirname(output), { recursive: true });
  for (const [mode, pattern] of [['fail', /fixture failure/], ['missing', /non-empty MP4/]]) {
    await assert.rejects(downloadWithYtDlp({ ...options, env: { ...options.env, MODE: mode } }), pattern);
    assert.equal(fs.readdirSync(temp).filter(name => name.startsWith('youtube-')).length, 0);
  }
  await assert.rejects(downloadWithYtDlp({ ...options, binary: path.join(temp, 'absent') }), /ENOENT/);
  const controller = new AbortController();
  const pending = downloadWithYtDlp({ ...options, env: { ...options.env, MODE: 'wait' }, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /abort/i);
  assert.equal(fs.readdirSync(temp).filter(name => name.startsWith('youtube-')).length, 0);
  console.log('PASS: discovery, shell-safe arguments, chunked progress, output validation, failure cleanup, missing executable and cancellation');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
