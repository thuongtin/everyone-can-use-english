import { loadAndCompile, loadLiteRt, Tensor, type CompiledModel } from "@litertjs/core";

const SAMPLE_RATE = 16_000;
const WINDOW_SAMPLES = 15_600;
const HOP_SAMPLES = 7_680;
const MUSIC_INDEX = 132;
const VOCAL_START = 0;
const VOCAL_END = 34;
const MODEL_SHA256 = "10c95ea3eb9a7bb4cb8bddf6feb023250381008177ac162ce169694d05c317de";

type GapInput = { samples: number[] };
type GapOutput = {
  musicMean: number;
  vocalMax: number;
  analyzedWindows: number;
  completeFrameCoverage: boolean;
};

let modelPromise: Promise<CompiledModel> | undefined;

function loadModel(): Promise<CompiledModel> {
  modelPromise ??= (async () => {
    await loadLiteRt(new URL("./wasm/", location.href).href);
    const response = await fetch(new URL("./model/yamnet.tflite", location.href));
    if (!response.ok) throw new Error("The bundled audio classifier model is unavailable.");
    const modelBytes = new Uint8Array(await response.arrayBuffer());
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", modelBytes)), byte => byte.toString(16).padStart(2, "0")).join("");
    if (digest !== MODEL_SHA256) throw new Error("The bundled audio classifier model failed its integrity check.");
    const model = await loadAndCompile(modelBytes, {
      accelerator: "wasm",
      cpuOptions: { numThreads: 1 },
    });
    const input = model.getInputDetails();
    const output = model.getOutputDetails();
    if (input.length !== 1 || input[0].dtype !== "float32" || input[0].shape.length !== 1
      || input[0].shape[0] !== WINDOW_SAMPLES || output.length < 1
      || output[0].dtype !== "float32" || output[0].shape.at(-1) !== 521) {
      model.delete();
      throw new Error("The bundled audio classifier model has an unexpected tensor contract.");
    }
    return model;
  })();
  return modelPromise;
}

async function classifyGap(input: GapInput): Promise<GapOutput> {
  if (!input || !Array.isArray(input.samples) || input.samples.length === 0
    || input.samples.length > SAMPLE_RATE * 15
    || input.samples.some(sample => !Number.isSafeInteger(sample) || sample < -32_768 || sample > 32_767)) {
    throw new Error("Invalid classifier PCM input.");
  }
  const model = await loadModel();
  const samples = Float32Array.from(input.samples, sample => sample / 32_768);
  const starts: number[] = [];
  for (let start = 0; start + WINDOW_SAMPLES <= samples.length; start += HOP_SAMPLES) starts.push(start);
  if (starts.length === 0) starts.push(0);
  const finalStart = Math.max(0, samples.length - WINDOW_SAMPLES);
  if (starts.at(-1) !== finalStart) starts.push(finalStart);
  const completeFrameCoverage = starts[0] === 0
    && starts.every((start, index) => index === 0 || start <= starts[index - 1] + WINDOW_SAMPLES)
    && starts.at(-1)! + WINDOW_SAMPLES >= samples.length;

  let musicTotal = 0;
  let vocalMax = 0;
  for (const start of starts) {
    const modelInput = new Float32Array(WINDOW_SAMPLES);
    modelInput.set(samples.subarray(start, start + WINDOW_SAMPLES));
    const tensor = new Tensor(modelInput, [WINDOW_SAMPLES]);
    const outputs = await model.run(tensor);
    try {
      const scores = outputs[0]?.toTypedArray();
      if (!scores || scores.length !== 521) throw new Error("The audio classifier returned invalid scores.");
      musicTotal += scores[MUSIC_INDEX];
      for (let index = VOCAL_START; index <= VOCAL_END; index += 1) vocalMax = Math.max(vocalMax, scores[index]);
    } finally {
      tensor.delete();
      outputs.forEach(output => output.delete());
    }
  }
  return {
    musicMean: musicTotal / starts.length,
    vocalMax,
    analyzedWindows: starts.length,
    completeFrameCoverage,
  };
}

Object.defineProperty(window, "classifyYamnetGap", {
  value: classifyGap,
  configurable: false,
  enumerable: false,
  writable: false,
});

declare global {
  interface Window {
    classifyYamnetGap: typeof classifyGap;
  }
}
