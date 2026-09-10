import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const artifactDir = path.join(root, "tmp/player-first-open-2026-09-09");
const artifactName = process.env.LAYOUT_ARTIFACT_NAME || "layout-check";
const stageSource = await readFile(
  path.join(
    root,
    "src/renderer/components/medias/media-left-panel/media-video-stage.tsx"
  ),
  "utf8"
);
const providerSource = await readFile(
  path.join(
    root,
    "src/renderer/components/medias/media-left-panel/media-provider.tsx"
  ),
  "utf8"
);
const vidstackBaseCss = await readFile(
  path.join(root, "node_modules/@vidstack/react/player/styles/base.css"),
  "utf8"
);

const hasBoundedFrame = stageSource.includes(
  "max-w-[min(760px,calc(38vh*16/9))]"
);
const hasAspectFrame = stageSource.includes("aspect-video");
const hasSizedProvider = /MediaProvider className="[^"]*size-full/.test(
  stageSource
);
const hasImmediateVideoType =
  /viewType=\{media\.mediaType\s*===\s*"Video"\s*\?\s*"video"\s*:\s*"audio"\}/.test(
    providerSource
  );

const frameCss = hasBoundedFrame
  ? "width:100%;max-width:min(760px,calc(38vh * 16 / 9));aspect-ratio:16/9"
  : "width:100%;max-width:760px;max-height:38vh";
const providerShellCss = hasSizedProvider ? "width:100%;height:100%" : "";
const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  chromium.executablePath(),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].find((candidate) => candidate && existsSync(candidate));

await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1200, height: 720 } });

try {
  await page.setContent(`<!doctype html>
    <style>
      ${vidstackBaseCss}
      html, body { margin: 0; height: 100%; }
      .panel { height: 100vh; min-height: 0; display: flex; flex-direction: column; }
      .stage { flex: none; background: #0f1114; }
      .centering { display: flex; align-items: center; justify-content: center; }
      .frame { ${frameCss}; }
      .provider-shell { ${providerShellCss}; }
      .tabs { flex: none; height: 46px; background: white; }
      .transcript { flex: 1 1 0%; min-height: 0; background: #fff2b5; }
    </style>
    <div class="panel">
      <section class="stage">
        <div class="centering">
          <div class="frame">
            <div class="provider-shell">
              <div data-media-player data-view-type="${
                hasImmediateVideoType ? "video" : "unknown"
              }">
                <div data-media-provider><video></video></div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <nav class="tabs"></nav>
      <main class="transcript"></main>
    </div>
  `);

  const scenarios = [
    { name: "short-wide-first-open", width: 1200, height: 520 },
    { name: "short-narrow-first-open", width: 560, height: 520 },
    { name: "landscape-after-transcription", width: 1000, height: 640 },
    { name: "portrait-after-resize", width: 520, height: 900 },
  ];
  const measurements = [];

  for (const scenario of scenarios) {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.evaluate((immediate) => {
      const player = document.querySelector("[data-media-player]");
      player.dataset.viewType = immediate ? "video" : "unknown";
    }, hasImmediateVideoType);

    const initial = await page.locator("[data-media-player]").boundingBox();

    await page.evaluate(() => {
      document.querySelector("[data-media-player]").dataset.viewType = "video";
      document.querySelector(".panel").dataset.transcription = "ready";
    });
    await page.evaluate(() => new Promise(requestAnimationFrame));

    const boxes = await page.evaluate(() => {
      const box = (selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return {
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        };
      };
      return {
        frame: box(".frame"),
        player: box("[data-media-player]"),
        tabs: box(".tabs"),
        transcript: box(".transcript"),
      };
    });

    measurements.push({ ...scenario, initial, afterMetadata: boxes });
  }

  await page.screenshot({
    path: path.join(artifactDir, `${artifactName}.png`),
    fullPage: true,
  });
  await writeFile(
    path.join(artifactDir, `${artifactName}.json`),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sourceContract: {
          hasBoundedFrame,
          hasAspectFrame,
          hasSizedProvider,
          hasImmediateVideoType,
        },
        measurements,
      },
      null,
      2
    )}\n`
  );

  for (const measurement of measurements) {
    const { player, tabs, transcript } = measurement.afterMetadata;
    assert.ok(
      player.height <= measurement.height * 0.38 + 1,
      `${measurement.name}: player height ${player.height}px exceeds 38vh`
    );
    assert.ok(
      player.bottom <= tabs.top + 1,
      `${measurement.name}: player bottom ${player.bottom}px overlaps tabs at ${tabs.top}px`
    );
    assert.ok(
      transcript.height >= 96,
      `${measurement.name}: transcript keeps only ${transcript.height}px`
    );
  }

  assert.equal(hasBoundedFrame, true, "video frame must derive width from 38vh");
  assert.equal(hasAspectFrame, true, "video frame must have a stable 16:9 ratio");
  assert.equal(hasSizedProvider, true, "MediaProvider must fill the bounded frame");
  assert.equal(
    hasImmediateVideoType,
    true,
    "Vidstack viewType must be stable before source metadata is inferred"
  );
  assert.match(stageSource, /data-testid="media-video-stage"/);
  assert.match(stageSource, /data-testid="media-video-frame"/);

  console.log(
    `PASS: ${measurements.length} media video layout scenarios keep the player inside its stage.`
  );
} finally {
  await browser.close();
}
