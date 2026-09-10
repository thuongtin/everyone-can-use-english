import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, session } from "electron";
import type { GapMusicClassification, GapMusicClassifier } from "./instrumental-coverage";
import { parsePcmWav, type ParsedPcmWav } from "./audio-windows";
import { installChromiumSessionNetworkPolicy } from "@main/network-policy";

const CLASSIFIER_NAME = "asr_classifier";
const YAMNET_MODEL_SHA256 = "10c95ea3eb9a7bb4cb8bddf6feb023250381008177ac162ce169694d05c317de";
const MAX_GAPS = 12;
const MAX_GAP_SECONDS = 15;
const SAMPLE_RATE = 16_000;
const TIMEOUT_MS = 60_000;

type RendererClassification = Pick<GapMusicClassification,
  "musicMean" | "vocalMax" | "analyzedWindows" | "completeFrameCoverage">;

type ClassifierPage = {
  url: string;
  origin: string;
  server?: Server;
  modelBytes: Uint8Array;
};

function abortError(): Error {
  return new DOMException("The audio classification was cancelled.", "AbortError");
}

function contentType(file: string): string {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".wasm")) return "application/wasm";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".md") || file.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

async function listFiles(root: string, relative = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const child = path.posix.join(relative, entry.name);
    return entry.isDirectory() ? listFiles(root, child) : [child];
  }));
  return nested.flat();
}

async function createClassifierPage(): Promise<ClassifierPage> {
  const devUrl = typeof ASR_CLASSIFIER_VITE_DEV_SERVER_URL === "string"
    ? ASR_CLASSIFIER_VITE_DEV_SERVER_URL.trim() : "";
  if (devUrl) {
    const origin = new URL(devUrl).origin;
    if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
      throw new Error("The audio classifier development server must use loopback HTTP.");
    }
    const modelResponse = await fetch(new URL("./model/yamnet.tflite", devUrl), { redirect: "error" });
    if (!modelResponse.ok) throw new Error("The audio classifier development model is unavailable.");
    return {
      url: devUrl,
      origin,
      modelBytes: new Uint8Array(await modelResponse.arrayBuffer()),
    };
  }

  const root = path.join(import.meta.dirname, `../renderer/${ASR_CLASSIFIER_VITE_NAME || CLASSIFIER_NAME}`);
  const files = await listFiles(root);
  if (!files.includes("index.html") || !files.includes("model/yamnet.tflite")) {
    throw new Error("The bundled audio classifier assets are incomplete.");
  }
  const namespace = randomBytes(18).toString("hex");
  const assets = new Map<string, { bytes: Buffer; type: string }>(await Promise.all(files.map(async relative => [
    `/${namespace}/${relative}`,
    { bytes: await readFile(path.join(root, relative)), type: contentType(relative) },
  ] as const)));
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; style-src 'none'; img-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    let requestUrl: URL;
    try {
      requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    } catch {
      response.writeHead(400).end("Invalid request");
      return;
    }
    const asset = request.method === "GET" ? assets.get(requestUrl.pathname) : undefined;
    if (!asset) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": asset.type, "Content-Length": asset.bytes.length }).end(asset.bytes);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The audio classifier asset server did not bind.");
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    url: `${origin}/${namespace}/index.html`,
    origin,
    server,
    modelBytes: assets.get(`/${namespace}/model/yamnet.tflite`)!.bytes,
  };
}

async function closeServer(server?: Server): Promise<void> {
  if (!server) return;
  await new Promise<void>(resolve => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

function validateRendererResult(value: unknown): RendererClassification {
  const result = value as RendererClassification;
  if (!result || !Number.isFinite(result.musicMean) || result.musicMean < 0 || result.musicMean > 1
    || !Number.isFinite(result.vocalMax) || result.vocalMax < 0 || result.vocalMax > 1
    || !Number.isSafeInteger(result.analyzedWindows) || result.analyzedWindows < 1
    || typeof result.completeFrameCoverage !== "boolean") {
    throw new Error("The audio classifier returned an invalid result.");
  }
  return result;
}

function gapPcm16(audio: ParsedPcmWav, startTime: number, endTime: number): number[] {
  const outputLength = Math.max(1, Math.round((endTime - startTime) * SAMPLE_RATE));
  const samples = new Array<number>(outputLength);
  const monoAt = (frame: number) => {
    const boundedFrame = Math.max(0, Math.min(audio.frameCount - 1, frame));
    const offset = boundedFrame * audio.blockAlign;
    let total = 0;
    for (let channel = 0; channel < audio.channels; channel += 1) {
      total += audio.pcm.readInt16LE(offset + channel * 2);
    }
    return total / audio.channels;
  };
  const firstSourceFrame = Math.floor(startTime * SAMPLE_RATE);
  for (let index = 0; index < outputLength; index += 1) {
    const value = monoAt(firstSourceFrame + index);
    samples[index] = Math.max(-32_768, Math.min(32_767, Math.round(value)));
  }
  return samples;
}

export const classifyInstrumentalGaps: GapMusicClassifier = async (audio, gaps, signal) => {
  if (signal?.aborted) throw abortError();
  if (!app.isReady()) throw new Error("Electron is not ready for audio classification.");
  if (!(audio instanceof Uint8Array) || audio.byteLength === 0 || !Array.isArray(gaps)
    || gaps.length === 0 || gaps.length > MAX_GAPS) {
    throw new Error("Invalid bounded audio classification request.");
  }
  const parsed = parsePcmWav(Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength));
  if (parsed.sampleRate !== SAMPLE_RATE) throw new Error("The audio classifier requires 16 kHz PCM WAV input.");
  const duration = parsed.frameCount / parsed.sampleRate;
  for (const gap of gaps) {
    if (!gap || !Number.isFinite(gap.startTime) || !Number.isFinite(gap.endTime)
      || gap.startTime < 0 || gap.endTime <= gap.startTime || gap.endTime > duration + 1e-6
      || gap.endTime - gap.startTime > MAX_GAP_SECONDS + 1e-6) {
      throw new Error("Invalid bounded audio classification gap.");
    }
  }

  let page: ClassifierPage | undefined;
  let classifierWindow: BrowserWindow | undefined;
  let classifierSession: Electron.Session | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: ((reason: Error) => void) | undefined;
  let stopped = false;
  const onAbort = () => {
    stopped = true;
    if (classifierWindow && !classifierWindow.isDestroyed()) classifierWindow.destroy();
    rejectAbort?.(abortError());
  };

  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      stopped = true;
      if (classifierWindow && !classifierWindow.isDestroyed()) classifierWindow.destroy();
      reject(new Error("Audio classification exceeded 60 seconds."));
    }, TIMEOUT_MS);
  });
  const cancelled = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const operation = (async () => {
      const createdPage = await createClassifierPage();
      if (stopped) {
        await closeServer(createdPage.server);
        throw signal?.aborted ? abortError() : new Error("Audio classification exceeded 60 seconds.");
      }
      page = createdPage;
      if (stopped) throw signal?.aborted ? abortError() : new Error("Audio classification exceeded 60 seconds.");
      if (createHash("sha256").update(page.modelBytes).digest("hex") !== YAMNET_MODEL_SHA256) {
        throw new Error("The bundled audio classifier model failed its integrity check.");
      }

      const partition = `temp:asr-classifier-${randomBytes(18).toString("hex")}`;
      classifierSession = session.fromPartition(partition);
      classifierSession.setPermissionCheckHandler(() => false);
      classifierSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      installChromiumSessionNetworkPolicy(classifierSession, {
        transport: "chromium-classifier",
        operation: "classifier.asset",
        allowRequest: url => url.startsWith(`${page!.origin}/`),
      });
      classifierWindow = new BrowserWindow({
        show: false,
        webPreferences: {
          partition,
          sandbox: true,
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: true,
        },
      });
      classifierWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      classifierWindow.webContents.on("will-navigate", (event, url) => {
        if (!url.startsWith(`${page!.origin}/`)) event.preventDefault();
      });
      await classifierWindow!.loadURL(page!.url);
      const results: GapMusicClassification[] = [];
      for (const gap of gaps) {
        if (signal?.aborted) throw abortError();
        const samples = gapPcm16(parsed, gap.startTime, gap.endTime);
        const result = validateRendererResult(await classifierWindow!.webContents.executeJavaScript(
          `window.classifyYamnetGap(${JSON.stringify({ samples })})`,
          false,
        ));
        results.push({
          startTime: gap.startTime,
          endTime: gap.endTime,
          modelSha256: YAMNET_MODEL_SHA256,
          ...result,
        });
      }
      return results;
    })();
    if (signal?.aborted) onAbort();
    return await Promise.race([operation, deadline, cancelled]);
  } finally {
    stopped = true;
    if (timeout) clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
    if (classifierWindow && !classifierWindow.isDestroyed()) classifierWindow.destroy();
    await classifierSession?.clearStorageData().catch((): undefined => undefined);
    await classifierSession?.closeAllConnections();
    await closeServer(page?.server);
  }
};
