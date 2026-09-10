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
const inputUrl = args.at(-1);
if (args.at(-2) !== '--' || !inputUrl.startsWith('https://www.youtube.com/watch?v=YCldrsmxi_s')) process.exit(8);
if (process.env.ENJOY_SECRET_FIXTURE) process.exit(9);
const mode = new URL(inputUrl).searchParams.get('fixture');
if (mode === 'fail') { console.error('fixture failure'); process.exit(3); }
if (mode === 'wait') { setTimeout(() => {}, 30000); }
else {
  const output = args[args.indexOf('--output') + 1].replace('%(ext)s', 'mp4');
  if (mode !== 'missing') fs.writeFileSync(output, 'fixture video');
  process.stdout.write('ENJOY_PRO');
  setTimeout(() => { process.stdout.write('GRESS 25.5%|1 MiB/s\\n'); }, 10);
}
`, { mode: 0o755 });
  assert.equal(findYtDlp({ PATH: temp }), binary);
  assert.equal(findYtDlp({ PATH: path.join(temp, "missing") }), undefined);
  const safeEnv = downloaderEnv({
    PATH: temp,
    HTTPS_PROXY: "http://127.0.0.1:8080",
    SSL_CERT_FILE: "/fixture/cert.pem",
    LANG: "en_US.UTF-8",
    ENJOY_SECRET_FIXTURE: "must-not-reach-subprocess",
  });
  assert.ok(safeEnv.PATH.includes(temp));
  assert.equal(safeEnv.HTTPS_PROXY, "http://127.0.0.1:8080");
  assert.equal(safeEnv.SSL_CERT_FILE, "/fixture/cert.pem");
  assert.equal(safeEnv.LANG, "en_US.UTF-8");
  assert.equal(safeEnv.ENJOY_SECRET_FIXTURE, undefined);
  assert.throws(
    () => downloaderEnv({ PATH: temp, ALL_PROXY: "socks5://proxy.enjoy.bot:1080" }),
    error => error.code === "retired_enjoy_host",
  );
  const url = 'https://www.youtube.com/watch?v=YCldrsmxi_s&name=$(echo should-not-run)';
  const progress = [];
  const options = { binary, url, cachePath: temp, ffmpegPath: '/fixture/ffmpeg', env: { ...process.env, ENJOY_SECRET_FIXTURE: 'must-not-reach-subprocess' }, onProgress: (...args) => progress.push(args) };
  await assert.rejects(
    downloadWithYtDlp({ ...options, url: "https://cdn.enjoy.bot/private.mp4?token=do-not-log" }),
    error => error.code === "retired_enjoy_host" && !error.message.includes("do-not-log"),
  );
  assert.equal(fs.readdirSync(temp).filter(name => name.startsWith('youtube-')).length, 0);
  const output = await downloadWithYtDlp(options);
  assert.ok(fs.statSync(output).size);
  assert.deepEqual(progress, [[25.5, '1 MiB/s']]);
  fs.rmSync(path.dirname(output), { recursive: true });
  for (const [mode, pattern] of [['fail', /yt-dlp failed with code 3/], ['missing', /non-empty MP4/]]) {
    await assert.rejects(downloadWithYtDlp({ ...options, url: `${url}&fixture=${mode}` }), pattern);
    assert.equal(fs.readdirSync(temp).filter(name => name.startsWith('youtube-')).length, 0);
  }
  await assert.rejects(downloadWithYtDlp({ ...options, binary: path.join(temp, 'absent') }), /ENOENT/);
  const controller = new AbortController();
  const pending = downloadWithYtDlp({ ...options, url: `${url}&fixture=wait`, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /abort/i);
  assert.equal(fs.readdirSync(temp).filter(name => name.startsWith('youtube-')).length, 0);
  console.log('PASS: discovery, finite env, retired-host guard, shell-safe arguments, chunked progress, output validation, failure cleanup, missing executable and cancellation');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
