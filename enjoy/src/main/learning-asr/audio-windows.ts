export interface ParsedPcmWav {
  sampleRate: number;
  channels: number;
  frameCount: number;
  pcm: Buffer;
  blockAlign: number;
}

export interface AudioWindow {
  index: number;
  startSample: number;
  endSample: number;
  coreStartSample: number;
  coreEndSample: number;
  sampleRate: number;
  cutKind: "silence" | "bounded" | "end";
}

export interface AudioWindowOptions {
  targetSeconds?: number;
  maxSeconds?: number;
  overlapSeconds?: number;
  searchSeconds?: number;
  minSeconds?: number;
}

const DEFAULT_OPTIONS = {
  targetSeconds: 45,
  maxSeconds: 60,
  overlapSeconds: 2,
  searchSeconds: 6,
  minSeconds: 15,
} as const;

const QUIET_ANALYSIS_SECONDS = 0.01;
const MIN_QUIET_SECONDS = 0.15;
const ABSOLUTE_QUIET_RMS = 0.02;
const MIN_QUIET_RMS = 0.003;

function malformedWav(message: string): Error {
  return new Error(`Malformed PCM WAV: ${message}`);
}

export function parsePcmWav(bytes: Buffer): ParsedPcmWav {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 12 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw malformedWav("expected a RIFF/WAVE file");
  }

  const riffEnd = bytes.readUInt32LE(4) + 8;
  if (riffEnd < 12 || riffEnd > bytes.length) {
    throw malformedWav("RIFF size exceeds the available bytes");
  }

  let formatOffset: number | undefined;
  let formatSize = 0;
  let dataOffset: number | undefined;
  let dataSize = 0;
  let cursor = 12;
  while (cursor < riffEnd) {
    if (cursor + 8 > riffEnd) {
      throw malformedWav("truncated chunk header");
    }
    const name = bytes.toString("ascii", cursor, cursor + 4);
    const size = bytes.readUInt32LE(cursor + 4);
    const bodyOffset = cursor + 8;
    const bodyEnd = bodyOffset + size;
    const paddedEnd = bodyEnd + (size % 2);
    if (bodyEnd < bodyOffset || paddedEnd > riffEnd) {
      throw malformedWav(`truncated ${name} chunk`);
    }
    if (name === "fmt ") {
      if (formatOffset !== undefined) throw malformedWav("duplicate fmt chunk");
      formatOffset = bodyOffset;
      formatSize = size;
    } else if (name === "data") {
      if (dataOffset !== undefined) throw malformedWav("duplicate data chunk");
      dataOffset = bodyOffset;
      dataSize = size;
    }
    cursor = paddedEnd;
  }

  if (formatOffset === undefined || formatSize < 16 || dataOffset === undefined) {
    throw malformedWav("missing fmt or data chunk");
  }

  const audioFormat = bytes.readUInt16LE(formatOffset);
  const channels = bytes.readUInt16LE(formatOffset + 2);
  const sampleRate = bytes.readUInt32LE(formatOffset + 4);
  const byteRate = bytes.readUInt32LE(formatOffset + 8);
  const blockAlign = bytes.readUInt16LE(formatOffset + 12);
  const bitsPerSample = bytes.readUInt16LE(formatOffset + 14);
  if (
    audioFormat !== 1 ||
    channels < 1 ||
    sampleRate < 1 ||
    bitsPerSample !== 16 ||
    blockAlign !== channels * 2 ||
    byteRate !== sampleRate * blockAlign
  ) {
    throw malformedWav("expected interleaved 16-bit PCM audio");
  }
  if (dataSize === 0 || dataSize % blockAlign !== 0) {
    throw malformedWav("PCM data is empty or not frame-aligned");
  }

  return {
    sampleRate,
    channels,
    frameCount: dataSize / blockAlign,
    pcm: bytes.subarray(dataOffset, dataOffset + dataSize),
    blockAlign,
  };
}

function resolveOptions(options: AudioWindowOptions, sampleRate: number) {
  const values = { ...DEFAULT_OPTIONS, ...options };
  for (const key of Object.keys(values) as Array<keyof typeof values>) {
    const value = values[key];
    const canBeZero = key === "overlapSeconds" || key === "searchSeconds";
    if (!Number.isFinite(value) || (canBeZero ? value < 0 : value <= 0)) {
      throw new Error(`Invalid audio window option: ${key}`);
    }
  }
  if (values.targetSeconds <= values.overlapSeconds) {
    throw new Error("Invalid audio window options: targetSeconds must exceed overlapSeconds");
  }
  if (values.targetSeconds + values.overlapSeconds * 2 > values.maxSeconds) {
    throw new Error("Invalid audio window options: target plus overlap exceeds maxSeconds");
  }
  if (values.minSeconds + values.overlapSeconds * 2 > values.maxSeconds) {
    throw new Error("Invalid audio window options: min plus overlap exceeds maxSeconds");
  }

  const toSamples = (seconds: number) => Math.max(1, Math.round(seconds * sampleRate));
  return {
    targetSamples: toSamples(values.targetSeconds),
    maxSamples: toSamples(values.maxSeconds),
    overlapSamples: values.overlapSeconds === 0 ? 0 : toSamples(values.overlapSeconds),
    searchSamples: values.searchSeconds === 0 ? 0 : toSamples(values.searchSeconds),
    minSamples: toSamples(values.minSeconds),
  };
}

interface QuietRun {
  startSample: number;
  endSample: number;
  midpoint: number;
}

function analyzeQuietRuns(audio: ParsedPcmWav): QuietRun[] {
  const analysisFrames = Math.max(1, Math.round(audio.sampleRate * QUIET_ANALYSIS_SECONDS));
  const binCount = Math.ceil(audio.frameCount / analysisFrames);
  const rms = new Float64Array(binCount);
  for (let bin = 0; bin < binCount; bin += 1) {
    const startFrame = bin * analysisFrames;
    const endFrame = Math.min(audio.frameCount, startFrame + analysisFrames);
    let squareSum = 0;
    for (let frame = startFrame; frame < endFrame; frame += 1) {
      const frameOffset = frame * audio.blockAlign;
      for (let channel = 0; channel < audio.channels; channel += 1) {
        const sample = audio.pcm.readInt16LE(frameOffset + channel * 2) / 32_768;
        squareSum += sample * sample;
      }
    }
    rms[bin] = Math.sqrt(squareSum / ((endFrame - startFrame) * audio.channels));
  }

  const histogram = new Uint32Array(4_097);
  for (const value of rms) {
    histogram[Math.min(histogram.length - 1, Math.floor(value * (histogram.length - 1)))] += 1;
  }
  const percentileCount = Math.max(1, Math.ceil(binCount * 0.2));
  let cumulativeCount = 0;
  let noiseFloorBin = 0;
  for (; noiseFloorBin < histogram.length; noiseFloorBin += 1) {
    cumulativeCount += histogram[noiseFloorBin];
    if (cumulativeCount >= percentileCount) break;
  }
  const noiseFloor = noiseFloorBin / (histogram.length - 1);
  const quietThreshold = Math.min(
    ABSOLUTE_QUIET_RMS,
    Math.max(MIN_QUIET_RMS, noiseFloor * 1.8 + 0.0005)
  );
  const minimumQuietFrames = Math.max(1, Math.round(audio.sampleRate * MIN_QUIET_SECONDS));
  const runs: QuietRun[] = [];
  let runStartBin = -1;
  for (let bin = 0; bin <= binCount; bin += 1) {
    const quiet = bin < binCount && rms[bin] <= quietThreshold;
    if (quiet && runStartBin < 0) runStartBin = bin;
    if (!quiet && runStartBin >= 0) {
      const startSample = runStartBin * analysisFrames;
      const endSample = Math.min(audio.frameCount, bin * analysisFrames);
      if (endSample - startSample >= minimumQuietFrames) {
        runs.push({
          startSample,
          endSample,
          midpoint: Math.round((startSample + endSample) / 2),
        });
      }
      runStartBin = -1;
    }
  }
  return runs;
}

function findQuietCut(
  runs: QuietRun[],
  target: number,
  lower: number,
  upper: number
): number | undefined {
  let low = 0;
  let high = runs.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (runs[middle].endSample < lower) low = middle + 1;
    else high = middle;
  }

  let best: QuietRun | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = low; index < runs.length; index += 1) {
    const run = runs[index];
    if (run.startSample > upper) break;
    const candidate = Math.max(lower, Math.min(upper, run.midpoint));
    const distance = Math.abs(candidate - target);
    if (distance < bestDistance) {
      best = run;
      bestDistance = distance;
    }
  }
  if (!best) return undefined;
  return Math.max(lower, Math.min(upper, best.midpoint));
}

function assertParsedAudio(audio: ParsedPcmWav): void {
  if (
    !audio ||
    !Buffer.isBuffer(audio.pcm) ||
    !Number.isInteger(audio.sampleRate) ||
    audio.sampleRate < 1 ||
    !Number.isInteger(audio.channels) ||
    audio.channels < 1 ||
    audio.blockAlign !== audio.channels * 2 ||
    !Number.isInteger(audio.frameCount) ||
    audio.frameCount < 1 ||
    audio.pcm.length !== audio.frameCount * audio.blockAlign
  ) {
    throw new Error("Invalid parsed PCM audio");
  }
}

export function planAudioWindows(
  pcm: ParsedPcmWav,
  options: AudioWindowOptions = {}
): AudioWindow[] {
  assertParsedAudio(pcm);
  const resolved = resolveOptions(options, pcm.sampleRate);
  const quietRuns = analyzeQuietRuns(pcm);
  const windows: AudioWindow[] = [];
  let coreStartSample = 0;

  while (coreStartSample < pcm.frameCount) {
    const leftOverlap = coreStartSample === 0 ? 0 : resolved.overlapSamples;
    const remaining = pcm.frameCount - coreStartSample;
    if (leftOverlap + remaining <= resolved.maxSamples) {
      windows.push({
        index: windows.length,
        startSample: Math.max(0, coreStartSample - resolved.overlapSamples),
        endSample: pcm.frameCount,
        coreStartSample,
        coreEndSample: pcm.frameCount,
        sampleRate: pcm.sampleRate,
        cutKind: "end",
      });
      break;
    }

    const minimumCut = coreStartSample + resolved.minSamples;
    const maximumCut = Math.min(
      pcm.frameCount - 1,
      coreStartSample + resolved.maxSamples - leftOverlap - resolved.overlapSamples
    );
    if (minimumCut > maximumCut) {
      throw new Error("Audio window options cannot satisfy maxSeconds and minSeconds");
    }

    let upperCut = maximumCut;
    const leaveMinimumTail = pcm.frameCount - resolved.minSamples;
    if (leaveMinimumTail >= minimumCut) upperCut = Math.min(upperCut, leaveMinimumTail);
    const desiredCut = Math.max(
      minimumCut,
      Math.min(upperCut, coreStartSample + resolved.targetSamples)
    );
    const searchLower = Math.max(minimumCut, desiredCut - resolved.searchSamples);
    const searchUpper = Math.min(upperCut, desiredCut + resolved.searchSamples);
    const quietCut = findQuietCut(quietRuns, desiredCut, searchLower, searchUpper);
    const coreEndSample = quietCut ?? desiredCut;
    const endSample = Math.min(pcm.frameCount, coreEndSample + resolved.overlapSamples);
    windows.push({
      index: windows.length,
      startSample: Math.max(0, coreStartSample - resolved.overlapSamples),
      endSample,
      coreStartSample,
      coreEndSample,
      sampleRate: pcm.sampleRate,
      cutKind: quietCut === undefined ? "bounded" : "silence",
    });
    coreStartSample = coreEndSample;
  }

  return windows;
}

type SampleRange = Pick<AudioWindow, "startSample" | "endSample">;

export function slicePcmWindow(pcm: ParsedPcmWav, range: SampleRange): Buffer {
  assertParsedAudio(pcm);
  if (
    !Number.isInteger(range.startSample) ||
    !Number.isInteger(range.endSample) ||
    range.startSample < 0 ||
    range.endSample <= range.startSample ||
    range.endSample > pcm.frameCount
  ) {
    throw new Error("Invalid PCM sample range");
  }
  return pcm.pcm.subarray(
    range.startSample * pcm.blockAlign,
    range.endSample * pcm.blockAlign
  );
}

export function encodePcmWindow(pcm: ParsedPcmWav, window: SampleRange): Buffer {
  const data = slicePcmWindow(pcm, window);
  if (data.length > 0xffff_ffff - 36) {
    throw new Error("PCM window is too large for a RIFF/WAVE file");
  }
  const output = Buffer.allocUnsafe(44 + data.length);
  output.write("RIFF", 0, 4, "ascii");
  output.writeUInt32LE(36 + data.length, 4);
  output.write("WAVEfmt ", 8, 8, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(pcm.channels, 22);
  output.writeUInt32LE(pcm.sampleRate, 24);
  output.writeUInt32LE(pcm.sampleRate * pcm.blockAlign, 28);
  output.writeUInt16LE(pcm.blockAlign, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36, 4, "ascii");
  output.writeUInt32LE(data.length, 40);
  data.copy(output, 44);
  return output;
}
