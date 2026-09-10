import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "../..");
const publicDir = path.resolve(
  process.env.PORTAL_PUBLIC_DIR ?? path.join(root, "1000h-portal/.output/public"),
);
const evidenceDir = path.resolve(
  process.env.PORTAL_EVIDENCE_DIR ??
    path.join(root, ".superpowers/sdd/2026-09-09-remove-enjoy-backend"),
);
const evidencePrefix = process.env.PORTAL_EVIDENCE_PREFIX ?? "portal";
const headless = process.env.PORTAL_HEADLESS !== "false";
const screenshotPath = path.join(evidenceDir, `${evidencePrefix}-local.png`);
const networkPath = path.join(evidenceDir, `${evidencePrefix}-network.json`);
await mkdir(evidenceDir, { recursive: true });

const bundled = await build({
  stdin: {
    contents:
      'export { isRetiredEnjoyHostname } from "./enjoy/src/lib/network-policy.ts"; export { resolveDistributionLinks } from "./1000h-portal/utils/distribution-links.ts";',
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { isRetiredEnjoyHostname, resolveDistributionLinks } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const defaults = resolveDistributionLinks();
for (const url of [
  "https://ENJOY.BOT./docs",
  "https://dl.enjoy.bot/app",
  "https://api.getenjoyapp.com",
]) {
  assert.deepEqual(
    resolveDistributionLinks({
      docsUrl: url,
      downloadUrl: url,
      repositoryUrl: url,
    }),
    defaults,
  );
}

const indexHtml = await readFile(path.join(publicDir, "index.html"), "utf8");
const ssrText = indexHtml
  .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();
const ssr = {
  htmlBytes: Buffer.byteLength(indexHtml),
  textLength: ssrText.length,
  hasNuxtRoot: indexHtml.includes('id="__nuxt"'),
  hasNuxtPayload: indexHtml.includes("__NUXT__"),
};

const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
};
const server = http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(
    new URL(request.url, "http://localhost").pathname,
  );
  const filename = path.resolve(
    publicDir,
    `.${pathname === "/" ? "/index.html" : pathname}`,
  );
  if (!filename.startsWith(`${publicDir}${path.sep}`)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const bytes = await readFile(filename);
    response
      .writeHead(200, {
        "Content-Type": mime[path.extname(filename)] || "application/octet-stream",
      })
      .end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

let browser;
const requests = [];
const responses = [];
const requestFailures = [];
const pageErrors = [];
const consoleErrors = [];
let browserState = null;
let anchors = [];
let issues = [];
try {
  browser = await chromium.launch({ headless, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    requestFailures.push({
      url: request.url(),
      hostname: url.hostname,
      local: url.hostname === "127.0.0.1",
      resourceType: request.resourceType(),
      errorText: request.failure()?.errorText ?? "unknown",
    });
  });
  page.on("response", (response) => {
    const request = response.request();
    const url = new URL(response.url());
    responses.push({
      url: response.url(),
      hostname: url.hostname,
      local: url.hostname === "127.0.0.1",
      status: response.status(),
      ok: response.ok(),
      resourceType: request.resourceType(),
      contentType: response.headers()["content-type"] ?? "",
    });
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({
      url: request.url(),
      hostname: url.hostname,
      local: url.hostname === "127.0.0.1",
      retired: isRetiredEnjoyHostname(url.hostname),
      resourceType: request.resourceType(),
    });
    if (url.hostname === "127.0.0.1") await route.continue();
    else await route.abort("blockedbyclient");
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {
    waitUntil: "networkidle",
  });
  await page.evaluate(async () => {
    for (let top = 0; top < document.body.scrollHeight; top += 600) {
      window.scrollTo(0, top);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1500);

  const text = await page.locator("body").innerText();
  anchors = await page
    .locator("a[href]")
    .evaluateAll((elements) => elements.map((element) => element.href));
  browserState = await page.evaluate(() => ({
    title: document.title,
    textLength: document.body.innerText.length,
    nuxtRootChildCount: document.querySelector("#__nuxt")?.childElementCount ?? 0,
    headingCount: document.querySelectorAll("h1, h2, h3").length,
    sectionCount: document.querySelectorAll("section").length,
    iframeCount: document.querySelectorAll("iframe").length,
    stylesheetCount: document.styleSheets.length,
    images: [...document.images].map((image) => ({
      src: image.currentSrc || image.src,
      alt: image.alt,
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    })),
  }));

  const requiredResourceTypes = new Set([
    "document",
    "stylesheet",
    "script",
    "image",
    "font",
  ]);
  const failedLocalResponses = responses.filter(
    (response) =>
      response.local &&
      requiredResourceTypes.has(response.resourceType) &&
      !response.ok,
  );
  const failedLocalRequests = requestFailures.filter(
    (request) =>
      request.local && requiredResourceTypes.has(request.resourceType),
  );
  const failedCssResponses = responses.filter(
    (response) =>
      response.local &&
      (response.resourceType === "stylesheet" ||
        new URL(response.url).pathname.endsWith(".css")) &&
      !response.ok,
  );
  const brokenImages = browserState.images.filter(
    (image) => !image.complete || image.naturalWidth === 0,
  );
  const retiredAnchors = anchors.filter((value) =>
    isRetiredEnjoyHostname(new URL(value).hostname),
  );
  const retiredRequests = requests.filter((request) => request.retired);
  const missingDistributionLinks = Object.values(defaults).filter(
    (url) => !anchors.includes(url),
  );

  if (ssr.textLength <= 500) issues.push("SSR HTML is not substantive");
  if (!ssr.hasNuxtRoot) issues.push("SSR HTML is missing the Nuxt root");
  if (text.length <= 500) issues.push("hydrated portal is not substantive");
  if (browserState.nuxtRootChildCount === 0)
    issues.push("Nuxt root has no hydrated children");
  if (retiredAnchors.length > 0)
    issues.push(`found ${retiredAnchors.length} retired portal links`);
  if (retiredRequests.length > 0)
    issues.push(`attempted ${retiredRequests.length} retired requests`);
  if (missingDistributionLinks.length > 0)
    issues.push(`missing ${missingDistributionLinks.length} distribution links`);
  if (failedLocalResponses.length > 0)
    issues.push(`received ${failedLocalResponses.length} required local non-2xx responses`);
  if (failedLocalRequests.length > 0)
    issues.push(`failed ${failedLocalRequests.length} required local requests`);
  if (brokenImages.length > 0)
    issues.push(`rendered ${brokenImages.length} broken images`);
  if (pageErrors.length > 0) issues.push(`raised ${pageErrors.length} page errors`);
  if (consoleErrors.length > 0)
    issues.push(`logged ${consoleErrors.length} browser console errors`);

  await page.screenshot({ path: screenshotPath, fullPage: true });
  await writeFile(
    networkPath,
    JSON.stringify(
      {
        result: issues.length === 0 ? "PASS" : "FAIL",
        issues,
        scope:
          "fresh built portal served locally in Chrome; external subresources blocked",
        run: {
          publicDir,
          browser: "Google Chrome via Playwright",
          headless,
          viewport: { width: 1366, height: 900 },
        },
        ssr,
        browserState,
        pageErrors,
        consoleErrors,
        requests,
        responses,
        requestFailures,
        failures: {
          failedLocalResponses,
          failedLocalRequests,
          failedCssResponses,
          brokenImages,
        },
        distribution: {
          expected: defaults,
          anchorCount: anchors.length,
          retiredAnchors,
          missingDistributionLinks,
        },
        retiredAttemptCount: retiredRequests.length,
      },
      null,
      2,
    ),
  );

  assert.deepEqual(issues, [], issues.join("; "));
  console.log(
    "PASS: fresh built portal has substantive SSR and hydration, required local resources returned 2xx, distribution links are present, and normal browsing made zero Enjoy requests.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
