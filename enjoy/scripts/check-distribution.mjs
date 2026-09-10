import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-distribution-"));

try {
  const output = path.join(temp, "distribution.mjs");
  await build({
    stdin: {
      contents: `export { DEFAULT_REPOSITORY_URL, resolveDistributionConfig } from "./src/constants/distribution.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });

  const { DEFAULT_REPOSITORY_URL, resolveDistributionConfig } = await import(
    pathToFileURL(output).href
  );
  const defaults = resolveDistributionConfig({});
  assert.equal(defaults.updateFeedUrl, undefined);
  assert.equal(defaults.repositoryUrl, DEFAULT_REPOSITORY_URL);
  assert.equal(
    defaults.docsUrl,
    `${DEFAULT_REPOSITORY_URL}/blob/main/README.md`
  );
  assert.equal(defaults.downloadUrl, `${DEFAULT_REPOSITORY_URL}/releases`);

  const configured = resolveDistributionConfig({
    ENJOY_UPDATE_FEED_URL: "https://updates.example.test/releases.json",
    ENJOY_REPO_URL: "https://source.example.test/enjoy",
    ENJOY_DOCS_URL: "http://docs.example.test/enjoy",
    ENJOY_DOWNLOAD_URL: "https://downloads.example.test/enjoy",
  });
  assert.equal(configured.updateFeedUrl, "https://updates.example.test/releases.json");
  assert.equal(configured.repositoryUrl, "https://source.example.test/enjoy");
  assert.equal(configured.docsUrl, "http://docs.example.test/enjoy");
  assert.equal(configured.downloadUrl, "https://downloads.example.test/enjoy");

  for (const updateFeedUrl of [
    "",
    "http://updates.example.test/feed",
    "javascript:alert(1)",
    "file:///tmp/feed",
    "https://user:secret@updates.example.test/feed",
    "https://ENJOY.BOT./feed",
    "https://dl.enjoy.bot/feed",
    "https://api.getenjoyapp.com/feed",
  ]) {
    assert.equal(
      resolveDistributionConfig({ ENJOY_UPDATE_FEED_URL: updateFeedUrl })
        .updateFeedUrl,
      undefined,
      updateFeedUrl
    );
  }

  for (const retiredUrl of ["https://enjoy.bot", "https://api.enjoy.bot./api", "https://api.getenjoyapp.com"]) {
    const result = resolveDistributionConfig({ ENJOY_REPO_URL: retiredUrl, ENJOY_DOCS_URL: retiredUrl, ENJOY_DOWNLOAD_URL: retiredUrl });
    assert.deepEqual(result, defaults);
  }

  const invalidOverrides = resolveDistributionConfig({
    ENJOY_REPO_URL: "javascript:alert(1)",
    ENJOY_DOCS_URL: "file:///tmp/docs",
    ENJOY_DOWNLOAD_URL: "https://user:secret@downloads.example.test/app",
  });
  assert.equal(invalidOverrides.repositoryUrl, DEFAULT_REPOSITORY_URL);
  assert.equal(
    invalidOverrides.docsUrl,
    `${DEFAULT_REPOSITORY_URL}/blob/main/README.md`
  );
  assert.equal(
    invalidOverrides.downloadUrl,
    `${DEFAULT_REPOSITORY_URL}/releases`
  );

  console.log("PASS: distribution defaults, HTTPS feed, custom URLs, and invalid URL rejection.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
