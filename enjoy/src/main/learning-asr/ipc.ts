import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import settings from "@main/settings";
import { UserSetting } from "@main/db/models";
import { enjoyUrlToPath } from "@main/utils";
import { createLearningIpcGuard } from "@main/learning/ipc-guard";
import { getCloudflareTranscribeSecretConfig } from "@main/cloudflare-transcribe/config";
import { getAzureTranscriptionCredentials } from "@main/speech/azure-config";
import { prepareCloudflareAudio } from "@main/cloudflare-transcribe/preparation";
import { UserSettingKeyEnum } from "../../types/enums";
import type { LearningAsrRequest, LearningAsrResponse } from "../../types/learning-asr";
import { isLearningAsrEngine } from "../../lib/learning-asr-models";
import { normalizeOpenAiTranscriptionModel } from "../../lib/speech-models";
import { createLearningAsrService } from "./service";
import { createLearningAsrProvider } from "./providers";
import { alignStudyWindow, buildStudyTimeline, validateStudyWords, convertProviderWords } from "./alignment";
import { hasDetectedSpeech } from "./speech-coverage";
import { createMusicAwareSpeechCoverage } from "./instrumental-coverage";
import { classifyInstrumentalGaps } from "./music-classifier";
import type { LearningRuntime } from "@main/learning/runtime";
import { LearningAsrError, assertActive } from "./errors";

const START = "learning-asr-start";
const CANCEL = "learning-asr-cancel";
const PROGRESS = "learning-asr-progress";
const jobs = new Map<string, { ownerId: number; controller: AbortController }>();
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const validContextId = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 200;

async function trustedAudio(audioUrl: string): Promise<Buffer> {
  if (!audioUrl.startsWith("enjoy://library/cache/")) throw new LearningAsrError("asr_invalid_audio", "Only transcoded cache audio is accepted.");
  const [root, file] = await Promise.all([fs.realpath(settings.cachePath()), fs.realpath(enjoyUrlToPath(audioUrl))]);
  const relative = path.relative(root, file);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || path.extname(file).toLowerCase() !== ".wav") {
    throw new LearningAsrError("asr_invalid_audio", "Audio must remain in the trusted cache.");
  }
  const info = await fs.stat(file);
  if (!info.isFile() || info.size <= 44 || info.size > 480_000_000) throw new LearningAsrError("asr_invalid_audio", "Audio size is unsupported.");
  return fs.readFile(file);
}

function validateRequest(raw: unknown): LearningAsrRequest {
  const request = raw as Partial<LearningAsrRequest>;
  if (!request || !/^[a-zA-Z0-9_-]{8,128}$/u.test(clean(request.jobId)) || !clean(request.audioUrl)
    || !validContextId(request.profileId) || !validContextId(request.connectionId)
    || !isLearningAsrEngine(request.service) || !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/u.test(clean(request.language))) {
    throw new LearningAsrError("asr_model_unsupported", "Invalid learning transcription request.");
  }
  return {
    jobId: clean(request.jobId),
    profileId: request.profileId as string,
    connectionId: request.connectionId as string,
    audioUrl: clean(request.audioUrl),
    service: request.service,
    language: clean(request.language),
  };
}

async function start(
  event: IpcMainInvokeEvent,
  raw: unknown,
  getRuntime: () => LearningRuntime | null,
): Promise<LearningAsrResponse> {
  let request: LearningAsrRequest;
  let controller: AbortController;
  let unregisterScopeCancellation: (() => void) | undefined;
  const ownerId = event.sender.id;
  const abort = () => controller?.abort();
  try {
    request = validateRequest(raw);
    const runtime = getRuntime();
    if (!runtime) throw new LearningAsrError("asr_cancelled", "The learning profile is no longer active.");
    const expectedContext = runtime.scope.context;
    if (request.profileId !== expectedContext.profileId || request.connectionId !== expectedContext.connectionId) {
      throw new LearningAsrError("asr_cancelled", "The learning profile changed.");
    }
    runtime.scope.assertOpen(expectedContext);
    // A single owner cannot saturate providers or race checkpoints with duplicate work.
    if (jobs.has(request.jobId) || [...jobs.values()].some(job => job.ownerId === ownerId)) throw new LearningAsrError("asr_failed", "A transcription is already running.");
    controller = new AbortController();
    jobs.set(request.jobId, { ownerId, controller });
    unregisterScopeCancellation = runtime.scope.registerCancellation(async () => controller.abort());
    event.sender.once("destroyed", abort);
    return await runtime.scope.run(async () => {
      runtime.scope.assertOpen(expectedContext);
      if (getRuntime() !== runtime) throw new LearningAsrError("asr_cancelled", "The learning profile changed.");
      const config: Parameters<typeof createLearningAsrProvider>[1] = {};
      if (request.service === "azure_mai" || request.service === "azure_speech") {
        try {
          config.azure = await getAzureTranscriptionCredentials();
        } catch {
          throw new LearningAsrError("asr_auth", "Azure Speech credentials are required.");
        }
      }
      if (request.service === "cloudflare_workers_ai") config.cloudflare = await getCloudflareTranscribeSecretConfig();
      if (request.service === "mai_transcribe") {
        const saved = await UserSetting.get(UserSettingKeyEnum.OPENROUTER);
        config.mai = { key: clean(saved?.key) };
      }
      if (request.service === "openai") {
        const saved = await UserSetting.get(UserSettingKeyEnum.OPENAI);
        let model: string;
        try { model = normalizeOpenAiTranscriptionModel(saved?.transcriptionModel); }
        catch { throw new LearningAsrError("asr_model_unsupported", "The configured transcription model is unsupported."); }
        config.openai = { key: clean(saved?.key), baseUrl: clean(saved?.baseUrl) || undefined, model };
      }
      runtime.scope.assertOpen(expectedContext);
      if (getRuntime() !== runtime) throw new LearningAsrError("asr_cancelled", "The learning profile changed.");
      const provider = createLearningAsrProvider(request.service, config);
      assertActive(controller.signal);
      const wav = await trustedAudio(request.audioUrl);
      const userRoot = path.dirname(expectedContext.assetRoot);
      const coverage = createMusicAwareSpeechCoverage(classifyInstrumentalGaps);
      const service = createLearningAsrService({ checkpointRoot: path.join(userRoot, "learning-asr-work"), align: alignStudyWindow, convertProviderWords, buildTimeline: buildStudyTimeline, validateWords: validateStudyWords, findSpeechGaps: coverage.findSpeechGaps, hasSpeech: hasDetectedSpeech });
      const result = await service.transcribe({
        ...request, wav, provider, signal: controller.signal,
        prepareWhole: () => prepareCloudflareAudio(request.audioUrl, { cacheRoot: settings.cachePath(), resolveAudioUrl: enjoyUrlToPath, signal: controller.signal }),
        onProgress: progress => {
          if (runtime.scope.state === "open" && getRuntime() === runtime
            && jobs.get(request.jobId)?.controller === controller && !event.sender.isDestroyed()) {
            event.sender.send(PROGRESS, progress);
          }
        },
      });
      assertActive(controller.signal);
      runtime.scope.assertOpen(expectedContext);
      if (getRuntime() !== runtime) throw new LearningAsrError("asr_cancelled", "The learning profile changed.");
      const instrumentalMusic = coverage.evidence(wav);
      if (instrumentalMusic.length) result.validation.instrumentalMusic = instrumentalMusic;
      return { ok: true, result };
    });
  } catch (error) {
    const scopeCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
    const failure = error instanceof LearningAsrError
      ? error
      : scopeCode === "profile_changed" || scopeCode === "profile_closed"
        ? new LearningAsrError("asr_cancelled", "The learning profile changed.")
        : new LearningAsrError("asr_failed", "Learning transcription failed.");
    return { ok: false, error: { code: failure.code, ...failure.range } };
  } finally {
    unregisterScopeCancellation?.();
    event.sender.removeListener("destroyed", abort);
    if (request && jobs.get(request.jobId)?.controller === controller) jobs.delete(request.jobId);
  }
}

function abortOwner(ownerId: number) {
  for (const job of jobs.values()) if (job.ownerId === ownerId) job.controller.abort();
}

export function registerLearningAsrIpc(
  window: BrowserWindow,
  expectedUrl: string,
  getRuntime: () => LearningRuntime | null,
): void {
  const guard = createLearningIpcGuard({ webContentsId: window.webContents.id, expectedUrl });
  ipcMain.removeHandler(START);
  ipcMain.removeHandler(CANCEL);
  ipcMain.handle(START, (event, request) => { guard.assertSender(event); return start(event, request, getRuntime); });
  ipcMain.handle(CANCEL, (event, jobId) => {
    guard.assertSender(event);
    const job = jobs.get(clean(jobId));
    if (!job || job.ownerId !== event.sender.id) return false;
    job.controller.abort();
    return true;
  });
  window.webContents.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) abortOwner(window.webContents.id); });
  const ownerId = window.webContents.id;
  window.on("closed", () => abortOwner(ownerId));
}
