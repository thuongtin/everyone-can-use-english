import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-mai-cancellation-"));
let scenario;
let stateIndex = 0;

globalThis.__maiReview = {
  useState(initial) {
    const slot = stateIndex++;
    const value = Object.hasOwn(scenario.states, slot)
      ? scenario.states[slot]
      : initial;
    return [
      value,
      (next) => scenario.events.push({ type: "state", slot, value: next }),
    ];
  },
  useRef(initial) {
    return { current: initial };
  },
  useContext(key) {
    if (key === "ai") return { sttEngine: "mai_transcribe" };
    if (key === "db") return { addDblistener() {}, removeDbListener() {} };
    return {
      EnjoyApp: {
        videos: { update: (...args) => scenario.mediaUpdate(...args) },
        audios: { update: (...args) => scenario.mediaUpdate(...args) },
        transcriptions: {
          findOrCreate: (...args) => scenario.findOrCreate(...args),
          update: (...args) => scenario.persist(...args),
        },
        app: { onCmdOutput() {}, removeCmdOutputListeners() {} },
      },
      learningLanguage: "en-US",
      localMode: scenario.localMode,
      webApi: {
        transcriptions: (...args) => scenario.cloudTranscriptions(...args),
      },
    };
  },
  useTranscribe() {
    return {
      transcribe: (...args) => scenario.transcribe(...args),
      cancel: (...args) => scenario.cancel(...args),
      ensureActive: (...args) => scenario.ensureActive(...args),
      output: "",
      progress: 0,
    };
  },
  toast: {
    error: (message) => scenario.events.push({ type: "toast", message }),
    warning() {},
    success() {},
  },
};

const stubs = {
  react: `
    export const useState = globalThis.__maiReview.useState;
    export const useRef = globalThis.__maiReview.useRef;
    export const useContext = globalThis.__maiReview.useContext;
    export const useEffect = () => {};
  `,
  "@renderer/hooks":
    "export const useTranscribe = globalThis.__maiReview.useTranscribe;",
  "@renderer/context": `
    export const AISettingsProviderContext = "ai";
    export const AppSettingsProviderContext = "app";
    export const DbProviderContext = "db";
  `,
  "@renderer/components/ui":
    "export const toast = globalThis.__maiReview.toast;",
  "@/constants":
    "export const MAGIC_TOKEN_REGEX = /^$/g; export const END_OF_SENTENCE_REGEX = /[.!?]$/;",
  "@/types/enums":
    "export const SttEngineOptionEnum = { MAI_TRANSCRIBE: 'mai_transcribe' };",
  "@/lib/learning-asr-models":
    "export const isLearningAsrEngine = value => ['cloudflare_workers_ai', 'mai_transcribe', 'openai'].includes(value);",
  i18next: "export const t = value => value;",
};

try {
  const output = path.join(temp, "review-resolution-hook.mjs");
  await build({
    entryPoints: ["src/renderer/hooks/use-transcriptions.tsx"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent",
    plugins: [
      {
        name: "review-stubs",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) =>
            stubs[args.path]
              ? { path: args.path, namespace: "review-stub" }
              : undefined,
          );
          builder.onLoad(
            { filter: /.*/, namespace: "review-stub" },
            (args) => ({
              contents: stubs[args.path],
              loader: "js",
            }),
          );
        },
      },
    ],
  });

  const { useTranscriptions } = await import(
    `${pathToFileURL(output).href}?test=${Date.now()}`
  );
  const deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  const result = (text, runVersion) => ({
    engine: "openrouter",
    model: "microsoft/mai-transcribe-2",
    transcript: text,
    timeline: [
      { type: "sentence", text, startTime: 0, endTime: 1, timeline: [] },
    ],
    validation: { version: 1 },
    runVersion,
  });
  const existing = { id: "transcription-1", targetId: "video-1", result: {} };
  const defaults = () => ({
    states: {
      0: existing,
      1: 0,
      2: false,
      3: false,
      4: false,
      5: "",
      6: "mai_transcribe",
    },
    events: [],
    localMode: false,
    cloudTranscriptions: async () => ({ transcriptions: [] }),
    findOrCreate: async () => existing,
    mediaUpdate: async () => {},
    persist: async () => {},
    transcribe: async () => result("Hello.", 1),
    cancel: async () => {},
    ensureActive: () => {},
  });
  const render = (media) => {
    stateIndex = 0;
    return useTranscriptions(media);
  };

  scenario = defaults();
  const mediaGate = deferred();
  const mediaEntered = deferred();
  scenario.mediaUpdate = async () => {
    scenario.events.push({ type: "media-start" });
    mediaEntered.resolve();
    await mediaGate.promise;
  };
  scenario.persist = async () => scenario.events.push({ type: "persist" });
  scenario.cancel = async () => scenario.events.push({ type: "cancel" });
  let hook = render({
    id: "video-1",
    mediaType: "Video",
    language: "vi-VN",
    src: "x",
  });
  let running = hook.generateTranscription({
    language: "en-US",
    service: "mai_transcribe",
  });
  await mediaEntered.promise;
  hook.abortGenerateTranscription();
  mediaGate.resolve();
  await running;
  assert.equal(
    scenario.events.filter((event) => event.type === "persist").length,
    0,
  );
  assert.equal(
    scenario.events.filter((event) => event.type === "toast").length,
    0,
  );

  scenario = defaults();
  scenario.states[0] = null;
  const prepareGate = deferred();
  const prepareEntered = deferred();
  let transcribeCalls = 0;
  scenario.findOrCreate = async () => {
    prepareEntered.resolve();
    await prepareGate.promise;
    return existing;
  };
  scenario.transcribe = async () => {
    transcribeCalls += 1;
    return result("Unexpected.", 1);
  };
  hook = render({
    id: "video-1",
    mediaType: "Video",
    language: "en-US",
    src: "x",
  });
  running = hook.generateTranscription({ service: "mai_transcribe" });
  await prepareEntered.promise;
  hook.abortGenerateTranscription();
  prepareGate.resolve();
  await running;
  assert.equal(transcribeCalls, 0);

  scenario = defaults();
  scenario.states[0] = null;
  scenario.localMode = true;
  let cloudCalls = 0;
  scenario.cloudTranscriptions = async () => {
    cloudCalls += 1;
    return { transcriptions: [] };
  };
  hook = render({
    id: "video-1",
    mediaType: "Video",
    language: "en-US",
    src: "x",
  });
  await hook.generateTranscription({ service: "mai_transcribe" });
  assert.equal(cloudCalls, 0);

  scenario = defaults();
  const oldGate = deferred();
  const oldEntered = deferred();
  let run = 0;
  scenario.transcribe = async () => {
    run += 1;
    if (run === 1) {
      oldEntered.resolve();
      await oldGate.promise;
      return result("Old.", 1);
    }
    return result("New.", 2);
  };
  scenario.persist = async (_id, data) =>
    scenario.events.push({ type: "persist", text: data.result.transcript });
  hook = render({
    id: "video-1",
    mediaType: "Video",
    language: "en-US",
    src: "x",
  });
  const oldRun = hook.generateTranscription({ service: "mai_transcribe" });
  await oldEntered.promise;
  hook.abortGenerateTranscription();
  const newRun = hook.generateTranscription({ service: "mai_transcribe" });
  await newRun;
  oldGate.resolve();
  await oldRun;
  assert.deepEqual(
    scenario.events
      .filter((event) => event.type === "persist")
      .map((event) => event.text),
    ["New."],
  );

  scenario = defaults();
  const commitGate = deferred();
  const commitEntered = deferred();
  scenario.persist = async () => {
    scenario.events.push({ type: "persist-start" });
    commitEntered.resolve();
    await commitGate.promise;
    scenario.events.push({ type: "persist-end" });
  };
  scenario.cancel = async () => scenario.events.push({ type: "cancel" });
  hook = render({
    id: "video-1",
    mediaType: "Video",
    language: "en-US",
    src: "x",
  });
  running = hook.generateTranscription({ service: "mai_transcribe" });
  await commitEntered.promise;
  hook.abortGenerateTranscription();
  assert.equal(
    scenario.events.filter((event) => event.type === "cancel").length,
    0,
  );
  assert.ok(
    scenario.events.some(
      (event) =>
        event.type === "state" && event.slot === 3 && event.value === true,
    ),
  );
  assert.equal(
    scenario.events.some(
      (event) =>
        event.type === "state" && event.slot === 2 && event.value === false,
    ),
    false,
  );
  commitGate.resolve();
  await running;
  const persistEnd = scenario.events.findIndex(
    (event) => event.type === "persist-end",
  );
  const idle = scenario.events.findIndex(
    (event) =>
      event.type === "state" && event.slot === 2 && event.value === false,
  );
  assert.ok(idle > persistEnd);

  const providerOutput = path.join(temp, "review-resolution-provider.mjs");
  const providerStubs = {
    react: `
    export const useState = initial => [initial, () => {}];
    export const useRef = initial => ({ current: initial });
    export const useEffect = () => {};
    export const useContext = key => key === "app"
      ? globalThis.__maiProvider.app
      : { openai: null, echogardenSttConfig: { engine: "whisper", whisper: {}, whisperCpp: {} } };
  `,
    "@renderer/context": `
    export const AppSettingsProviderContext = "app";
    export const AISettingsProviderContext = "ai";
  `,
    openai: "export default class OpenAI {}",
    i18next: "export const t = value => value;",
    "@/constants": "export const AI_WORKER_ENDPOINT = '';",
    "microsoft-cognitiveservices-speech-sdk": "export const SpeechConfig = {};",
    axios: "export default { postForm() {} };",
    "./use-ai-command":
      "export const useAiCommand = () => ({ punctuateText: async value => value });",
    "@renderer/components/ui": "export const toast = { error() {} };",
    "media-captions": "export const parseText = async () => ({ cues: [] });",
    "@/types/enums": `export const SttEngineOptionEnum = {
    LOCAL: "local", ENJOY_CLOUDFLARE: "cloudflare", OPENAI: "openai", MAI_TRANSCRIBE: "mai_transcribe",
    CLOUDFLARE_WORKERS_AI: "cloudflare_workers_ai"
  };`,
    "lodash/take": "export default value => value;",
    "lodash/sortedUniqBy": "export default value => value;",
    "electron-log/renderer":
      "export default { scope: () => ({ info() {}, warn() {}, error() {} }) };",
    "@/lib/learning-asr-models":
      "export const isLearningAsrEngine = value => ['cloudflare_workers_ai', 'mai_transcribe', 'openai'].includes(value);",
    "@/lib/speech-models": `
    export const buildOpenAiTranscriptionRequest = value => value;
    export const normalizeOpenAiTranscriptionModel = value => value;
    export const normalizeOpenAiTranscriptionResponse = value => value;
    export const sanitizeSpeechError = value => String(value);
  `,
  };
  await build({
    entryPoints: ["src/renderer/hooks/use-transcribe.tsx"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: providerOutput,
    logLevel: "silent",
    plugins: [
      {
        name: "provider-review-stubs",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) =>
            providerStubs[args.path]
              ? { path: args.path, namespace: "provider-stub" }
              : undefined,
          );
          builder.onLoad(
            { filter: /.*/, namespace: "provider-stub" },
            (args) => ({
              contents: providerStubs[args.path],
              loader: "js",
            }),
          );
        },
      },
    ],
  });

  const transcodeGate = deferred();
  const transcodeEntered = deferred();
  let providerStarts = 0;
  globalThis.__maiProvider = {
    app: {
      EnjoyApp: {
        echogarden: {
          transcode: async () => {
            transcodeEntered.resolve();
            await transcodeGate.promise;
            return "enjoy://library/cache/audio.wav";
          },
        },
        maiTranscribe: {
          start: async () => {
            providerStarts += 1;
            return { ok: false, error: { code: "mai_failed" } };
          },
          cancel: async () => false,
          onProgress: () => () => {},
        },
        learningAsr: {
          start: async () => {
            providerStarts += 1;
            return { ok: false, error: { code: "asr_failed" } };
          },
          cancel: async () => false,
          onProgress: () => () => {},
        },
      },
      user: {},
      webApi: {},
    },
  };
  const originalFetch = globalThis.fetch;
  let audioFetches = 0;
  globalThis.fetch = async () => {
    audioFetches += 1;
    return { blob: async () => new Blob(["audio"]) };
  };
  try {
    const { useTranscribe } = await import(
      `${pathToFileURL(providerOutput).href}?test=${Date.now()}`
    );
    const providerHook = useTranscribe();
    const providerRun = providerHook.transcribe("source", {
      language: "en-US",
      service: "mai_transcribe",
    });
    await transcodeEntered.promise;
    await providerHook.cancel();
    transcodeGate.resolve();
    await assert.rejects(providerRun, /learningAsrCancelled/);
    assert.equal(providerStarts, 0);
    assert.equal(audioFetches, 0);

    const learningServices = [];
    globalThis.__maiProvider.app.EnjoyApp.learningAsr = {
      start: async (request) => {
        learningServices.push(request.service);
        return {
          ok: true,
          result: {
            engine: request.service,
            model: "validated-test-model",
            transcript: "Ready.",
            language: request.language,
            duration: 1,
            timeline: [
              {
                type: "sentence",
                text: "Ready.",
                startTime: 0,
                endTime: 1,
                timeline: [],
              },
            ],
            validation: { version: 1 },
          },
        };
      },
      cancel: async () => false,
      onProgress: () => () => {},
    };
    for (const service of [
      "mai_transcribe",
      "cloudflare_workers_ai",
      "openai",
    ]) {
      const learningHook = useTranscribe();
      const learningResult = await learningHook.transcribe("source", {
        language: "en-US",
        service,
      });
      assert.equal(learningResult.transcript, "Ready.");
      assert.equal(learningResult.validation.version, 1);
    }
    assert.deepEqual(learningServices, [
      "mai_transcribe",
      "cloudflare_workers_ai",
      "openai",
    ]);
    assert.equal(
      audioFetches,
      0,
      "Validated learning results must bypass renderer fetch and alignment",
    );

    const activeJobEntered = deferred();
    const activeJobResult = deferred();
    const cancelledLearningJobs = [];
    globalThis.__maiProvider.app.EnjoyApp.learningAsr = {
      start: async (request) => {
        activeJobEntered.resolve(request.jobId);
        return activeJobResult.promise;
      },
      cancel: async (jobId) => {
        cancelledLearningJobs.push(jobId);
        return true;
      },
      onProgress: () => () => {},
    };
    const activeLearningHook = useTranscribe();
    const activeLearningRun = activeLearningHook.transcribe("source", {
      language: "en-US",
      service: "mai_transcribe",
    });
    const activeJobId = await activeJobEntered.promise;
    await activeLearningHook.cancel();
    activeJobResult.resolve({ ok: false, error: { code: "asr_cancelled" } });
    await assert.rejects(activeLearningRun, /learningAsrCancelled/);
    assert.deepEqual(cancelledLearningJobs, [activeJobId]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log(
    "Renderer cancellation, commit, local provider and ASR routing checks passed (12 scenarios).",
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
