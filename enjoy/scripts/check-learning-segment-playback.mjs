import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const artifactDir = path.join(root, "tmp/asr-learning-quality-2026-09-09");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-segment-playback-"));
const completed = [];

class FakePlayer {
  currentTime = 0;
  playing = false;
  playbackRate = 1;
  calls = [];

  getCurrentTime() {
    return this.currentTime;
  }

  isPlaying() {
    return this.playing;
  }

  pause() {
    this.playing = false;
    this.calls.push(["pause"]);
  }

  play(start, end) {
    if (start !== undefined) this.currentTime = start;
    this.playing = true;
    this.calls.push(["play", start, end, this.playbackRate]);
    return Promise.resolve();
  }

  setTime(time) {
    this.currentTime = time;
    this.calls.push(["setTime", time]);
  }

  setScrollTime(time) {
    this.calls.push(["setScrollTime", time]);
  }

  setPlaybackRate(rate) {
    this.playbackRate = rate;
    this.calls.push(["setPlaybackRate", rate]);
  }
}

const sentence2 = {
  id: "segment-region-1",
  start: 8.28,
  end: 9.880625,
};

const sentence3 = {
  id: "segment-region-2",
  start: 10.12,
  end: 11.74,
};

const recordingVoice = {
  id: "recording-voice-region-fixture",
  start: 0.163456789,
  end: 1.734567891,
};

const test = async (name, callback) => {
  await callback();
  completed.push(name);
};

try {
  const output = path.join(temp, "learning-segment-playback.mjs");
  await build({
    stdin: {
      contents:
        'export { createLearningSegmentPlaybackController, shouldPreserveLearningSubregion } from "./src/renderer/lib/learning-segment-playback.ts";',
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });

  const {
    createLearningSegmentPlaybackController,
    shouldPreserveLearningSubregion,
  } = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);

  const setup = ({ mode = "single" } = {}) => {
    const player = new FakePlayer();
    const scheduled = [];
    const controller = createLearningSegmentPlaybackController({
      player,
      schedule: (callback) => scheduled.push(callback),
    });
    controller.setMode(mode);
    controller.setActiveRegion(sentence2);
    return {
      controller,
      player,
      flush: () => {
        while (scheduled.length) scheduled.shift()();
      },
    };
  };

  await test("ignores the captured one-microsecond early region-out", () => {
    const { controller, player, flush } = setup();
    player.currentTime = 8.279999;

    assert.equal(controller.handleRegionOut(sentence2), "start-rounding");
    flush();
    assert.deepEqual(player.calls, []);
  });

  await test("single mode handles the exact end without widening it", () => {
    const { controller, player, flush } = setup();
    player.currentTime = sentence2.end;
    player.playing = true;

    assert.equal(controller.handleRegionOut(sentence2), "ended");
    assert.deepEqual(player.calls, [["pause"]]);
    flush();
    assert.deepEqual(player.calls, [
      ["pause"],
      ["setTime", 8.28],
      ["setScrollTime", 8.28],
    ]);
  });

  await test("handles a real out before start beyond the rounding tolerance", () => {
    const { controller, player, flush } = setup();
    player.currentTime = 8.2;
    player.playing = true;

    assert.equal(controller.handleRegionOut(sentence2), "outside-region");
    flush();
    assert.deepEqual(player.calls, [
      ["pause"],
      ["setTime", 8.28],
      ["setScrollTime", 8.28],
    ]);
  });

  await test("ignores stale region-out after a rapid segment switch", () => {
    const { controller, player, flush } = setup();
    controller.setActiveRegion(sentence3);
    player.currentTime = sentence2.end;

    assert.equal(controller.handleRegionOut(sentence2), "inactive-region");
    flush();
    assert.deepEqual(player.calls, []);
  });

  await test("rapid navigation clears the old bound and continues in the new segment", () => {
    const { controller, player, flush } = setup();
    player.currentTime = 9.7;
    player.playing = true;

    controller.navigateToRegion(sentence3);
    assert.deepEqual(player.calls, [
      ["pause"],
      ["setTime", sentence3.start],
      ["setScrollTime", sentence3.start],
      ["play", sentence3.start, sentence3.end, 1],
    ]);
    assert.equal(controller.handleRegionOut(sentence2), "inactive-region");
    flush();
    assert.equal(player.playing, true);
    assert.equal(player.currentTime, sentence3.start);
  });

  await test("paused navigation seeks to the new segment and remains paused", () => {
    const { controller, player, flush } = setup();
    player.currentTime = 9.7;

    controller.navigateToRegion(sentence3);
    flush();
    assert.deepEqual(player.calls, [
      ["setTime", sentence3.start],
      ["setScrollTime", sentence3.start],
    ]);
    assert.equal(player.playing, false);
  });

  await test("a delayed segment refresh preserves a newly selected word", () => {
    const selectedWord = {
      id: "word-region-1-1",
      start: 8.58,
      end: 8.98,
    };
    assert.equal(
      shouldPreserveLearningSubregion(selectedWord, sentence2),
      true
    );
    assert.equal(
      shouldPreserveLearningSubregion(selectedWord, sentence3),
      false
    );
    assert.equal(
      shouldPreserveLearningSubregion(sentence2, sentence2),
      false
    );
    const selectedMeaningGroup = {
      id: "meaning-group-region-fixture",
      start: 8.28,
      end: 8.98,
    };
    assert.equal(
      shouldPreserveLearningSubregion(selectedMeaningGroup, sentence2),
      true
    );
    assert.equal(
      shouldPreserveLearningSubregion(selectedMeaningGroup, sentence3),
      false
    );
  });

  await test("all-mode navigation continues without a new end bound", () => {
    const { controller, player, flush } = setup({ mode: "all" });
    player.currentTime = 9.7;
    player.playing = true;

    controller.navigateToRegion(sentence3);
    flush();
    assert.deepEqual(player.calls, [
      ["pause"],
      ["setTime", sentence3.start],
      ["setScrollTime", sentence3.start],
      ["play", sentence3.start, undefined, 1],
    ]);
  });

  await test("cancels a queued loop restart when the segment changes", () => {
    const { controller, player, flush } = setup({ mode: "loop" });
    player.currentTime = sentence2.end;
    player.playing = true;

    assert.equal(controller.handleRegionOut(sentence2), "ended");
    assert.deepEqual(player.calls, [["pause"]]);
    controller.navigateToRegion(sentence3);
    flush();
    assert.deepEqual(player.calls, [
      ["pause"],
      ["setTime", sentence3.start],
      ["setScrollTime", sentence3.start],
    ]);
  });

  await test("loop mode restarts with the same exact bounds", () => {
    const { controller, player, flush } = setup({ mode: "loop" });
    player.currentTime = sentence2.end;
    player.playing = true;

    controller.handleRegionOut(sentence2);
    flush();
    assert.deepEqual(player.calls, [
      ["pause"],
      ["play", 8.28, 9.880625, 1],
    ]);
  });

  await test("all mode remains unbounded and ignores region-out", () => {
    const { controller, player, flush } = setup({ mode: "all" });

    controller.toggle();
    player.currentTime = sentence2.end;
    assert.equal(controller.handleRegionOut(sentence2), "unbounded-mode");
    flush();
    assert.deepEqual(player.calls, [["play", undefined, undefined, 1]]);
  });

  await test("play and repeat preserve bounds at learner playback rates", () => {
    for (const rate of [0.5, 1, 1.5]) {
      const { controller, player, flush } = setup();
      player.setPlaybackRate(rate);
      player.currentTime = 8.279999;
      controller.toggle();
      assert.deepEqual(player.calls.at(-1), ["play", 8.28, 9.880625, rate]);

      player.currentTime = sentence2.end;
      controller.handleRegionOut(sentence2);
      flush();
      controller.toggle();
      assert.deepEqual(player.calls.at(-1), ["play", 8.28, 9.880625, rate]);
    }
  });

  await test("resumes inside a segment while retaining its end bound", () => {
    const { controller, player } = setup();
    player.currentTime = 9.1;

    controller.toggle();
    assert.deepEqual(player.calls, [["play", undefined, 9.880625, 1]]);
  });

  await test("recording region click uses bounded playback and the same start guard", () => {
    const { controller, player, flush } = setup();
    controller.playRegion(recordingVoice);
    assert.deepEqual(player.calls, [
      ["play", recordingVoice.start, recordingVoice.end, 1],
    ]);

    player.currentTime = recordingVoice.start - 0.000001;
    assert.equal(
      controller.handleRegionOut(recordingVoice),
      "start-rounding"
    );
    assert.equal(player.calls.length, 1);

    player.currentTime = recordingVoice.end;
    controller.handleRegionOut(recordingVoice);
    flush();
    assert.deepEqual(player.calls.slice(1), [
      ["pause"],
      ["setTime", recordingVoice.start],
      ["setScrollTime", recordingVoice.start],
    ]);
  });

  await test("destroyed controllers ignore late events", () => {
    const { controller, player, flush } = setup({ mode: "loop" });
    controller.destroy();
    player.currentTime = sentence2.end;

    assert.equal(controller.handleRegionOut(sentence2), "inactive-instance");
    controller.toggle();
    flush();
    assert.deepEqual(player.calls, []);
  });

  await test("remounts the native provider when media identity changes", async () => {
    const mediaProviderSource = await readFile(
      path.join(
        root,
        "src/renderer/components/medias/media-left-panel/media-provider.tsx"
      ),
      "utf8"
    );

    assert.match(
      mediaProviderSource,
      /key=\{`\$\{media\.mediaType\}:\$\{media\.id\}:\$\{media\.src\}`\}/
    );
  });

  await test("guards zoom synchronization while the waveform is replaced", async () => {
    const controlsSource = await readFile(
      path.join(
        root,
        "src/renderer/components/medias/media-bottom-panel/media-player-controls.tsx"
      ),
      "utf8"
    );

    assert.match(
      controlsSource,
      /if \(!activeRegion\) return;\s+if \(!wavesurfer\) return;[\s\S]*?if \(!wavesurfer\.isPlaying\(\)\)/
    );
  });

  await mkdir(artifactDir, { recursive: true });
  const receipt = {
    checkedAt: new Date().toISOString(),
    status: "PASS",
    cases: completed,
    capturedBoundary: {
      regionId: sentence2.id,
      start: sentence2.start,
      observedTime: 8.279999,
      differenceSeconds: sentence2.start - 8.279999,
    },
    rates: [0.5, 1, 1.5],
  };
  await writeFile(
    path.join(artifactDir, "playback-controller-receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`
  );
  await writeFile(
    path.join(artifactDir, "playback-controller-report.md"),
    `# Learning segment playback regression\n\nPASS: ${completed.length} event-sequence cases.\n\n${completed
      .map((name) => `- ${name}`)
      .join("\n")}\n`
  );
  console.log(
    `PASS: ${completed.length} learning segment playback event-sequence cases.`
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
