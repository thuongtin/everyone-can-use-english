import { useEffect, useRef, useState, type FormEvent } from "react";
import type { LearningBridge, LearningOperationMap, LearningSession } from "../../../types/learning-api";
import { CEFR_LEVELS, LessonBriefSchema, LessonDraftSchema, MindmapGraphSchema } from "../../../lib/learning-schemas";
import type { LessonBundle, MapBundle } from "../../../main/learning/storage";
import type { CefrLevel } from "../../../types/learning";
import { BriefForm } from "./brief-form";
import { LessonReader } from "./lesson-reader";
import { MindmapView } from "./mindmap-view";
import { PracticePanel } from "./practice-panel";
import { suggestLessonBrief } from "../../../lib/learning-brief-suggestion";
import { suggestLessonBriefWithAzure } from "../../../lib/learning-brief-suggestion-azure";
import { normalizeProviderConfig } from "../../../lib/ai-providers";
import { resolveAzureLearningModel } from "../../../lib/learning-azure-config";
import { UserSettingKeyEnum } from "../../../types/enums";
import { NetworkIcon, PlugZapIcon, PlusIcon, RefreshCwIcon, SparklesIcon, SquareIcon, Trash2Icon } from "lucide-react";
import { EjEmptyState, Pill } from "@renderer/components/enjoy";

type Library = LearningOperationMap["list"]["output"];
type Selection = { kind: "lesson" | "map"; id: string };
type Provider = LearningSession["capabilities"][number]["provider"];
type GenerationSnapshot = LearningOperationMap["job"]["output"];
type MapNarration = { nodeId: string; nodeTerm: string; revisionId: string; intent: number };
type GenerationRun = { jobId: string; target: Selection; epoch: number; completedStageIds: Set<string>; narration?: MapNarration };
const LEARNING_PROVIDERS = ["codex", "claude", "azure-openai"] as const satisfies readonly Provider[];
const controlStyle = "inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-[10px] text-xs font-semibold whitespace-nowrap transition-colors duration-ej disabled:opacity-40 disabled:cursor-not-allowed";
const buttonStyle = `${controlStyle} border border-ej-line bg-ej-surface text-ej-ink hover:bg-ej-surface2`;
const primaryButtonStyle = `${controlStyle} bg-ej-ink text-ej-bg hover:opacity-90`;
const dangerButtonStyle = `${controlStyle} border border-ej-line bg-ej-bad-soft text-ej-bad hover:bg-ej-bad hover:text-white`;
const segmentStyle = `${controlStyle} px-4 text-ej-ink2 hover:bg-ej-surface2`;
const segmentActiveStyle = `${controlStyle} px-4 bg-ej-accent-soft text-ej-accent-ink`;
const fieldStyle = "block h-9 w-full rounded-[10px] border border-ej-line bg-ej-surface px-3 text-xs text-ej-ink outline-none transition-colors duration-ej focus:border-ej-accent disabled:opacity-40";
const activeStageStates = new Set<GenerationSnapshot["stages"][number]["state"]>(["queued", "running", "cancelling", "reconciling"]);
const retryableStageStates = new Set<GenerationSnapshot["stages"][number]["state"]>(["failed", "interrupted", "awaiting_retry", "cancelled"]);
const hasActiveStages = (snapshot: GenerationSnapshot) => snapshot.stages.some(stage => activeStageStates.has(stage.state));
const providerName = (provider: Provider) => provider === "codex"
  ? "Codex"
  : provider === "claude" ? "Claude Code" : "Azure OpenAI";
const capabilityReason = (provider: Provider, reason: string | null) => {
  if (provider === "azure-openai") {
    if (reason?.includes("key_unavailable")) return "Không thể đọc API key Azure OpenAI đã lưu. Hãy nhập lại key trong Dịch vụ AI.";
    if (reason?.includes("not_configured") || reason?.includes("missing")) return "Azure OpenAI chưa được cấu hình đủ endpoint, deployment và API key trong Dịch vụ AI.";
    return "Enjoy chưa hoàn tất kiểm tra cấu hình Azure OpenAI.";
  }
  if (reason?.includes("auth")) return `${providerName(provider)} CLI đã được tìm thấy nhưng chưa xác nhận đăng nhập.`;
  if (reason?.includes("node")) return "Kết nối ACP cần Node.js phiên bản được hỗ trợ trên máy. Hãy kiểm tra trong Dịch vụ AI.";
  if (reason?.includes("version")) return `Phiên bản kết nối ${providerName(provider)} hiện tại chưa được hỗ trợ. Hãy kiểm tra trong Dịch vụ AI.`;
  if (reason?.includes("adapter")) return `Chưa tìm thấy adapter ACP cho ${providerName(provider)}. Hãy kiểm tra bản cài đặt Enjoy.`;
  if (reason?.includes("executable") || reason?.includes("missing")) return `Chưa tìm thấy ${providerName(provider)} CLI trên máy.`;
  return `Enjoy chưa hoàn tất kiểm tra ${providerName(provider)} CLI.`;
};
const generationError = (failure: unknown, provider?: Provider) => {
  const message = failure instanceof Error ? failure.message : String(failure ?? "");
  const name = provider ? providerName(provider) : "AI";
  if (message.includes("model_unavailable")) return "Model đã chọn không còn khả dụng. Hãy chọn lại model trong Dịch vụ AI rồi thử lại.";
  if (message.includes("acp_node")) return "Kết nối ACP cần Node.js 22 trở lên. Hãy cài Node.js rồi kiểm tra lại kết nối.";
  if (message.includes("acp_adapter")) return "Adapter ACP chưa sẵn sàng. Hãy kiểm tra bản cài đặt Enjoy rồi thử lại.";
  if (message.includes("speech_auth")) return "Chưa xác thực được dịch vụ giọng đọc. Hãy kiểm tra credential TTS trong Cài đặt rồi thử lại.";
  if (message.includes("speech_network")) return "Không thể kết nối tới dịch vụ giọng đọc. Hãy kiểm tra kết nối tới dịch vụ TTS rồi thử lại.";
  if (message.includes("speech_quota")) return "Dịch vụ giọng đọc đã hết hạn mức sử dụng. Hãy kiểm tra hạn mức TTS rồi thử lại.";
  if (message.includes("azure_text_not_configured")) return "Azure OpenAI chưa được cấu hình đủ endpoint, deployment và API key trong Dịch vụ AI.";
  if (message.includes("azure_text_auth")) return "Azure OpenAI chưa xác thực được API key. Hãy kiểm tra cấu hình trong Dịch vụ AI.";
  if (message.includes("azure_text_quota")) return "Azure OpenAI đã hết hạn mức hoặc đang giới hạn yêu cầu. Hãy thử lại sau.";
  if (message.includes("azure_text_timeout")) return "Azure OpenAI phản hồi quá lâu. Hãy thử lại.";
  if (message.includes("azure_text_invalid") || message.includes("learning_validation_exhausted")) return "Azure OpenAI chưa tạo được nội dung hợp lệ. Hãy thử lại hoặc chọn model khác.";
  if (message.includes("auth")) return `${name} chưa xác nhận đăng nhập. Hãy đăng nhập trong CLI rồi kiểm tra lại kết nối.`;
  if (message.includes("version")) return `Phiên bản ${name} CLI hiện tại chưa được hỗ trợ. Hãy cập nhật Enjoy hoặc dùng phiên bản CLI được hỗ trợ.`;
  if (message.includes("resource_busy") || message.includes("stage_busy")) return "Nội dung này đang có một tác vụ tạo khác. Hãy chờ hoặc dừng tác vụ đó trước.";
  if (message.includes("revision_conflict")) return "Nội dung đã có phiên bản mới. Hãy mở lại rồi tạo từ phiên bản mới nhất.";
  if (message.includes("speech_not_configured")) return "Chưa cấu hình giọng đọc. Hãy chọn dịch vụ TTS trong Cài đặt rồi thử lại.";
  return `Không thể tạo nội dung bằng ${name}. Hãy kiểm tra kết nối rồi thử lại.`;
};
const jobStatusText = (snapshot: GenerationSnapshot) => {
  if (!hasActiveStages(snapshot)) {
    if (snapshot.job.state === "completed") return "Đã tạo xong nội dung";
    if (snapshot.job.state === "cancelled") return "Đã dừng tạo nội dung. Bạn có thể thử lại bước chưa hoàn tất.";
    if (snapshot.job.state === "interrupted") return "Tác vụ bị gián đoạn. Hãy thử lại bước chưa hoàn tất.";
    if (snapshot.job.state === "partial") return "Đã nhận một phần. Hãy thử lại bước chưa hoàn tất.";
    return "Tạo nội dung không thành công. Hãy thử lại bước chưa hoàn tất.";
  }
  if (snapshot.job.state === "queued") return "Đang xếp hàng";
  if (snapshot.job.state === "partial") return "Đã nhận một phần, đang tạo phần còn lại";
  return "Đang tạo nội dung";
};
const stageStatusText = (state: GenerationSnapshot["stages"][number]["state"]) => ({
  queued: "Đang chờ",
  running: "Đang tạo",
  completed: "Đã nhận",
  failed: "Không thành công",
  interrupted: "Bị gián đoạn",
  cancelling: "Đang dừng",
  cancelled: "Đã dừng",
  reconciling: "Đang kiểm tra kết quả",
  awaiting_retry: "Đang chờ thử lại",
}[state]);
const stageKindText = (kind: GenerationSnapshot["stages"][number]["kind"]) => ({ text: "Nội dung bài", map: "Mindmap", image: "Hình minh hoạ", audio: "Giọng đọc", exercises: "Bài luyện" }[kind]);
const stageToneOf = (state: GenerationSnapshot["stages"][number]["state"]): "ok" | "bad" | "accent" | "muted" => {
  if (state === "completed") return "ok";
  if (retryableStageStates.has(state)) return "bad";
  if (activeStageStates.has(state)) return "accent";
  return "muted";
};
const generationRequestKey = (provider: Provider) => `studio-${provider}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const assetRequestKey = (kind: "image" | "audio") => `studio-asset-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const narrationRequestKey = () => `studio-speech-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export type LayoutSaveQueueItem = Readonly<{
  key: string;
  run: () => Promise<void>;
  isCurrent: () => boolean;
  onSaved: () => void;
  onError: (failure: unknown) => void;
}>;

export type LayoutSaveQueue = Readonly<{
  enqueue: (item: LayoutSaveQueueItem) => void;
  clear: () => void;
  dispose: () => void;
}>;

/** Serialize layout writes while coalescing rapid changes to the latest positions. */
export function createLayoutSaveQueue(onBusy: (busy: boolean) => void): LayoutSaveQueue {
  const pending = new Map<string, LayoutSaveQueueItem>();
  const order: string[] = [];
  let running = false;
  let disposed = false;

  const flush = async (): Promise<void> => {
    if (running || disposed) return;
    running = true;
    onBusy(true);
    try {
      while (order.length > 0 && !disposed) {
        const key = order.shift();
        if (!key) continue;
        const item = pending.get(key);
        pending.delete(key);
        if (!item) continue;
        try {
          await item.run();
          if (!disposed && item.isCurrent()) item.onSaved();
        } catch (failure) {
          if (!disposed && item.isCurrent()) item.onError(failure);
        }
      }
    } finally {
      running = false;
      if (!disposed) onBusy(false);
    }
  };

  return {
    enqueue(item) {
      if (disposed) return;
      if (!pending.has(item.key)) order.push(item.key);
      pending.set(item.key, item);
      void flush();
    },
    clear() {
      pending.clear();
      order.length = 0;
    },
    dispose() {
      disposed = true;
      pending.clear();
      order.length = 0;
    },
  };
}

export function LearningStudio({ bridge }: { bridge: LearningBridge }) {
  const selectedModel = async (provider: Provider): Promise<string | undefined> => {
    const settings = window.__ENJOY_APP__?.userSettings;
    if (!settings) return undefined;
    if (provider === "azure-openai") {
      const [rawConfig, engine] = await Promise.all([
        settings.get(UserSettingKeyEnum.AZURE_OPENAI),
        settings.get(UserSettingKeyEnum.GPT_ENGINE),
      ]);
      const saved = normalizeProviderConfig("azure-openai", rawConfig);
      return resolveAzureLearningModel(saved, engine);
    }
    const [engine, config] = await Promise.all([
      settings.get(UserSettingKeyEnum.GPT_ENGINE),
      settings.get(provider === "codex" ? UserSettingKeyEnum.CODEX_ACP : UserSettingKeyEnum.CLAUDE_ACP),
    ]);
    const model = engine?.name === `${provider}-acp` ? engine.models?.default : config?.model;
    return typeof model === "string" && model.trim() ? model.trim() : undefined;
  };
  const azureBriefConfig = async () => {
    const settings = window.__ENJOY_APP__?.userSettings;
    if (!settings) throw new Error("Azure OpenAI chưa được cấu hình trong Dịch vụ AI.");
    const [rawConfig, engine] = await Promise.all([
      settings.get(UserSettingKeyEnum.AZURE_OPENAI),
      settings.get(UserSettingKeyEnum.GPT_ENGINE),
    ]);
    const saved = normalizeProviderConfig("azure-openai", rawConfig);
    const modelName = resolveAzureLearningModel(saved, engine);
    if (!saved.key?.trim() || !saved.baseUrl?.trim() || !modelName) {
      throw new Error("Azure OpenAI chưa được cấu hình đủ endpoint, deployment và API key trong Dịch vụ AI.");
    }
    return { key: saved.key, baseUrl: saved.baseUrl, modelName, maxTokens: 4_000 };
  };
  const [session, setSession] = useState<LearningSession>();
  const sessionRef = useRef<LearningSession>();
  const generation = useRef(0);
  const mountedRef = useRef(true);
  const busyToken = useRef(0);
  const libraryRequest = useRef(0);
  const selectionRef = useRef<Selection>();
  const mapRef = useRef<MapBundle>();
  const [library, setLibrary] = useState<Library>({ lessons: [], maps: [] });
  const [selection, setSelection] = useState<Selection>();
  const [lesson, setLesson] = useState<LessonBundle>();
  const [map, setMap] = useState<MapBundle>();
  const [revisionId, setRevisionId] = useState<string>();
  const [mode, setMode] = useState<"library" | "new-lesson" | "new-map" | "connections">("library");
  const [detailTab, setDetailTab] = useState<"read" | "practice">("read");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteRequested, setDeleteRequested] = useState(false);
  const [mapTitle, setMapTitle] = useState("");
  const [mapLevel, setMapLevel] = useState<CefrLevel>("A2");
  const [mapProvider, setMapProvider] = useState<Provider>("codex");
  const [mapIllustrations, setMapIllustrations] = useState(false);
  const [linkMap, setLinkMap] = useState(false);
  const [listeningAsset, setListeningAsset] = useState<string>();
  const [listeningMapNode, setListeningMapNode] = useState<{ assetId: string; nodeId: string; nodeTerm: string }>();
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [generationSnapshot, setGenerationSnapshot] = useState<GenerationSnapshot>();
  const [generationJobId, setGenerationJobId] = useState<string>();
  const [generationStarting, setGenerationStarting] = useState(false);
  const [generationCancelling, setGenerationCancelling] = useState(false);
  const [retryingStageId, setRetryingStageId] = useState<string>();
  const [retryProviders, setRetryProviders] = useState<Record<string, Provider>>({});
  const [preferredProvider, setPreferredProvider] = useState<Provider>();
  const [probing, setProbing] = useState(false);
  const generationRun = useRef<GenerationRun>();
  const generationTimer = useRef<ReturnType<typeof setTimeout>>();
  const generationAction = useRef(0);
  const narrationIntent = useRef(0);
  const mapSubmission = useRef(false);
  const mapFormOpen = useRef(false);
  const mapProviderTouched = useRef(false);
  const mapIllustrationsTouched = useRef(false);
  const layoutQueue = useRef<LayoutSaveQueue>();
  if (!layoutQueue.current) {
    layoutQueue.current = createLayoutSaveQueue((value) => {
      if (mountedRef.current) setLayoutBusy(value);
    });
  }

  const sameSelection = (left: Selection | undefined, right: Selection | undefined) => (
    left?.kind === right?.kind && left?.id === right?.id
  );
  const isCurrentView = (epoch: number, selected?: Selection) => (
    mountedRef.current
    && generation.current === epoch
    && (selected === undefined || sameSelection(selectionRef.current, selected))
  );

  const invalidateView = () => {
    generation.current += 1;
    busyToken.current += 1;
    generationAction.current += 1;
    narrationIntent.current += 1;
    if (generationTimer.current) clearTimeout(generationTimer.current);
    generationTimer.current = undefined;
    generationRun.current = undefined;
    setGenerationSnapshot(undefined);
    setGenerationJobId(undefined);
    setGenerationStarting(false);
    setGenerationCancelling(false);
    setRetryingStageId(undefined);
    setRetryProviders({});
    setListeningMapNode(undefined);
    setBusy(false);
  };

  async function request<K extends keyof LearningOperationMap>(action: K, input: LearningOperationMap[K]["input"]): Promise<LearningOperationMap[K]["output"]> {
    const bound = sessionRef.current;
    if (!bound) throw new Error("learning_not_ready");
    const result = await bridge.request(bound, action, input);
    if (sessionRef.current?.connectionId !== bound.connectionId || sessionRef.current?.profileId !== bound.profileId) throw new Error("profile_changed");
    return result;
  }
  async function restoreGeneration(target: Selection, selectedRevisionId: string, epoch: number): Promise<void> {
    const jobs = await request("listJobs", { resourceType: target.kind, resourceId: target.id });
    if (!isCurrentView(epoch, target) || jobs.length === 0) return;
    const latest = jobs[0];
    const run: GenerationRun = { jobId: latest.id, target, epoch, completedStageIds: new Set() };
    generationRun.current = run;
    setGenerationJobId(latest.id);
    setGenerationStarting(true);
    void pollGeneration(run);
    if (isCurrentView(epoch, target) && latest.revisionId !== selectedRevisionId) {
      setNotice("Đang hiển thị trạng thái tạo của một phiên bản khác.");
    }
  }
  const refreshLibrary = async (expectedEpoch?: number): Promise<boolean> => {
    const requestId = ++libraryRequest.current;
    const value = await request("list", {});
    if (requestId !== libraryRequest.current || (expectedEpoch !== undefined && !isCurrentView(expectedEpoch))) return false;
    setLibrary(value);
    return true;
  };
  const refreshSelection = async (
    selected = selectionRef.current,
    expectedEpoch = generation.current,
  ): Promise<string | false> => {
    if (!selected) return false;
    if (selected.kind === "lesson") {
      const value = await request("getLesson", { id: selected.id });
      if (!isCurrentView(expectedEpoch, selected)) return false;
      setLesson(value); setMap(undefined);
      mapRef.current = undefined;
      return value.lesson.activeRevisionId;
    } else {
      const value = await request("getMap", { id: selected.id });
      if (!isCurrentView(expectedEpoch, selected)) return false;
      setMap(value); setLesson(undefined);
      mapRef.current = value;
      return value.map.activeRevisionId;
    }
  };
  const open = async (selected: Selection): Promise<boolean> => {
    invalidateView();
    const epoch = generation.current;
    selectionRef.current = selected;
    setSelection(selected); setRevisionId(undefined); setDeleteRequested(false);
    setMode("library"); setDetailTab("read"); setError(""); setListeningAsset(undefined);
    setLesson(undefined); setMap(undefined); mapRef.current = undefined;
    try {
      const selectedRevisionId = await refreshSelection(selected, epoch);
      if (!selectedRevisionId) return false;
      try {
        await restoreGeneration(selected, selectedRevisionId, epoch);
      } catch {
        if (isCurrentView(epoch, selected)) setError("Đã mở nội dung nhưng chưa tải lại được trạng thái tạo.");
      }
      return true;
    }
    catch {
      if (isCurrentView(epoch, selected)) setError("Chưa mở được nội dung. Hãy thử chọn lại bài hoặc sơ đồ.");
      return false;
    }
  };
  const navigateMode = (next: "library" | "new-lesson" | "new-map" | "connections") => {
    invalidateView();
    setMode(next);
    setError("");
  };
  const selectRevision = (id: string) => {
    invalidateView();
    const epoch = generation.current;
    const target = selectionRef.current;
    setRevisionId(id);
    setListeningAsset(undefined);
    setListeningMapNode(undefined);
    if (target) void restoreGeneration(target, id, epoch).catch(() => {
      if (isCurrentView(epoch, target)) setError("Chưa tải lại được trạng thái tạo nội dung.");
    });
  };
  const action = async (operation: () => Promise<void>, success: string) => {
    if (busy) return;
    const epoch = generation.current;
    const token = ++busyToken.current;
    setBusy(true); setError(""); setNotice("");
    try {
      await operation();
      if (isCurrentView(epoch)) setNotice(success);
    }
    catch (failure) {
      const message = failure instanceof Error ? failure.message : "";
      if (isCurrentView(epoch)) setError(message.includes("asset_cleanup_failed") ? "Nội dung đã được xoá khỏi thư viện, nhưng một số file chưa dọn xong. Hãy kiểm tra quyền ghi của thư mục thư viện rồi mở lại app để thử dọn tiếp." : message.includes("revision_conflict") ? "Nội dung đã có phiên bản mới. Hãy mở lại trước khi lưu." : message.includes("resource_busy") ? "Bài này còn một tác vụ đang chạy. Hãy dừng tác vụ trước khi xoá." : "Thao tác chưa hoàn tất. Hãy mở lại nội dung để kiểm tra trạng thái đã lưu.");
    } finally {
      if (busyToken.current === token) setBusy(false);
    }
  };
  const isCurrentGeneration = (run: GenerationRun) => generationRun.current === run && isCurrentView(run.epoch, run.target);
  const selectedNodeAudio = (bundle: MapBundle | undefined, revisionId: string, nodeId: string) => {
    const slot = bundle?.slots.find(candidate => (
      candidate.mapRevisionId === revisionId
      && candidate.sourceType === "node"
      && candidate.sourceId === nodeId
      && candidate.kind === "audio"
      && Boolean(candidate.selectedAssetId)
    ));
    return bundle?.assets.find(asset => asset.id === slot?.selectedAssetId && asset.kind === "audio");
  };
  const playNarration = (narration: MapNarration): boolean => {
    if (
      narrationIntent.current !== narration.intent
      || selectionRef.current?.kind !== "map"
      || mapRef.current?.map.id !== selectionRef.current.id
      || (revisionId ?? mapRef.current.map.activeRevisionId) !== narration.revisionId
    ) return false;
    const asset = selectedNodeAudio(mapRef.current, narration.revisionId, narration.nodeId);
    if (!asset) return false;
    setListeningAsset(undefined);
    setListeningMapNode({ assetId: asset.id, nodeId: narration.nodeId, nodeTerm: narration.nodeTerm });
    return true;
  };
  const pollGeneration = async (run: GenerationRun): Promise<void> => {
    if (!isCurrentGeneration(run)) return;
    try {
      const snapshot = await request("job", { id: run.jobId });
      if (!isCurrentGeneration(run)) return;
      setGenerationSnapshot(snapshot);
      const completedStageIds = new Set(snapshot.stages.filter(stage => stage.state === "completed").map(stage => stage.id));
      const acceptedStage = [...completedStageIds].some(id => !run.completedStageIds.has(id));
      run.completedStageIds = completedStageIds;
      const terminal = !hasActiveStages(snapshot);
      if (acceptedStage || terminal) {
        await refreshSelection(run.target, run.epoch);
        if (!isCurrentGeneration(run)) return;
        await refreshLibrary(run.epoch);
        if (!isCurrentGeneration(run)) return;
        if (run.narration) playNarration(run.narration);
      }
      if (terminal) {
        generationRun.current = undefined;
        setGenerationJobId(undefined);
        setGenerationStarting(false);
        setGenerationCancelling(false);
        setRetryingStageId(undefined);
        if (snapshot.job.state === "completed") setNotice("Đã tạo xong nội dung.");
        else if (snapshot.job.state === "cancelled") setNotice("Đã dừng tạo nội dung.");
        else if (snapshot.job.state === "failed") {
          const failedAttempt = [...snapshot.attempts].reverse().find(attempt => attempt.state === "failed");
          setError(generationError(failedAttempt?.errorCode));
        }
        return;
      }
      generationTimer.current = setTimeout(() => void pollGeneration(run), 1_000);
    } catch (failure) {
      if (!isCurrentGeneration(run)) return;
      generationRun.current = undefined;
      setGenerationJobId(undefined);
      setGenerationStarting(false);
      setGenerationCancelling(false);
      setRetryingStageId(undefined);
      setError(generationError(failure));
    }
  };
  const startGenerationFor = async (
    provider: Provider,
    target: Selection,
    activeRevisionId: string,
    epoch: number,
  ): Promise<boolean> => {
    const capability = sessionRef.current?.capabilities.find(item => item.provider === provider);
    if (!capability?.text || generationStarting || generationRun.current) return false;
    const actionId = ++generationAction.current;
    setGenerationStarting(true); setGenerationCancelling(false); setGenerationSnapshot(undefined); setError(""); setNotice("");
    try {
      const result = await request("generate", {
        provider,
        model: await selectedModel(provider),
        resourceType: target.kind,
        resourceId: target.id,
        revisionId: activeRevisionId,
        requestKey: generationRequestKey(provider),
      });
      if (generationAction.current !== actionId || !isCurrentView(epoch, target)) return false;
      const run: GenerationRun = { jobId: result.jobId, target, epoch, completedStageIds: new Set() };
      generationRun.current = run;
      setGenerationJobId(result.jobId);
      await pollGeneration(run);
      return true;
    } catch (failure) {
      if (generationAction.current === actionId && isCurrentView(epoch, target)) setError(generationError(failure, provider));
      return false;
    } finally {
      if (generationAction.current === actionId && !generationRun.current) setGenerationStarting(false);
    }
  };
  const startGeneration = async (provider: Provider) => {
    const target = selectionRef.current;
    const activeRevision = target?.kind === "lesson" ? lessonRevision : mapRevision;
    if (!target || !activeRevision) return;
    const resourceRevisionId = target.kind === "lesson" ? lesson?.lesson.activeRevisionId : map?.map.activeRevisionId;
    if (activeRevision.id !== resourceRevisionId || activeRevision.status !== "draft") {
      setError("Chỉ bản nháp hiện hành mới có thể tạo nội dung. Hãy mở bản hiện hành hoặc tạo một bản nháp mới.");
      return;
    }
    const activeRevisionId = activeRevision.id;
    const epoch = generation.current;
    await startGenerationFor(provider, target, activeRevisionId, epoch);
  };
  const startAssetGeneration = async (kind: "image" | "audio", slotId: string): Promise<void> => {
    const target = selectionRef.current;
    const bundle = target?.kind === "lesson" ? lesson : target?.kind === "map" ? map : undefined;
    const selectedRevision = target?.kind === "lesson" ? lessonRevision : target?.kind === "map" ? mapRevision : undefined;
    const resourceRevisionId = target?.kind === "lesson" ? lesson?.lesson.activeRevisionId : target?.kind === "map" ? map?.map.activeRevisionId : undefined;
    const slot = bundle?.slots.find(candidate => candidate.id === slotId);
    const slotRevisionId = target?.kind === "lesson" ? slot?.lessonRevisionId : slot?.mapRevisionId;
    if (
      !target
      || !selectedRevision
      || selectedRevision.id !== resourceRevisionId
      || selectedRevision.status !== "ready"
      || slotRevisionId !== selectedRevision.id
      || slot?.kind !== kind
      || generationStarting
      || generationRun.current
    ) return;
    const codexCapability = sessionRef.current?.capabilities.find(item => item.provider === "codex");
    if (kind === "image" && !codexCapability?.image) {
      setError(capabilityReason("codex", codexCapability?.reason ?? null));
      return;
    }
    const epoch = generation.current;
    const actionId = ++generationAction.current;
    setGenerationStarting(true); setGenerationCancelling(false); setGenerationSnapshot(undefined); setError(""); setNotice("");
    try {
      const result = await request("generateAsset", {
        resourceType: target.kind,
        resourceId: target.id,
        revisionId: selectedRevision.id,
        slotId,
        requestKey: assetRequestKey(kind),
      });
      if (generationAction.current !== actionId || !isCurrentView(epoch, target)) return;
      const run: GenerationRun = { jobId: result.jobId, target, epoch, completedStageIds: new Set() };
      generationRun.current = run;
      setGenerationJobId(result.jobId);
      await pollGeneration(run);
    } catch (failure) {
      if (generationAction.current === actionId && isCurrentView(epoch, target)) setError(generationError(failure, kind === "image" ? "codex" : undefined));
    } finally {
      if (generationAction.current === actionId && !generationRun.current) setGenerationStarting(false);
    }
  };
  const cancelGeneration = async () => {
    const current = generationRun.current;
    if (!current || generationCancelling) return;
    if (generationTimer.current) clearTimeout(generationTimer.current);
    generationTimer.current = undefined;
    const run = { ...current, completedStageIds: new Set(current.completedStageIds) };
    generationRun.current = run;
    setGenerationCancelling(true); setError("");
    try {
      await request("cancelJob", { id: run.jobId });
      if (isCurrentGeneration(run)) await pollGeneration(run);
    } catch (failure) {
      if (isCurrentGeneration(run)) {
        setGenerationCancelling(false);
        setError(generationError(failure));
        generationTimer.current = setTimeout(() => void pollGeneration(run), 1_000);
      }
    }
  };
  const retryGeneration = async (stageId: string, requestedProvider: Provider) => {
    const snapshot = generationSnapshot;
    const stage = snapshot?.stages.find(candidate => candidate.id === stageId);
    const target = selectionRef.current;
    if (!snapshot || !stage || !target || retryingStageId || generationRun.current) return;
    if (snapshot.job.revisionId !== displayedRevisionId || !displayedIsActiveRevision || (displayedRevisionStatus !== "draft" && stage.kind !== "image" && stage.kind !== "audio")) {
      setError("Bước này không thuộc bản hiện hành có thể thử lại. Hãy mở bản hiện hành để tiếp tục.");
      return;
    }
    const provider = stage.kind === "image" || stage.kind === "audio" ? "codex" : requestedProvider;
    const capability = sessionRef.current?.capabilities.find(item => item.provider === provider);
    if ((stage.kind === "image" && !capability?.image) || (["text", "map", "exercises"].includes(stage.kind) && !capability?.text)) {
      setError(capabilityReason(provider, capability?.reason ?? null));
      return;
    }
    const epoch = generation.current;
    const actionId = ++generationAction.current;
    setRetryingStageId(stageId); setError(""); setNotice("");
    try {
      const result = await request("retryGeneration", { jobId: snapshot.job.id, stageId, provider, model: await selectedModel(provider) });
      if (generationAction.current !== actionId || !isCurrentView(epoch, target)) return;
      const run: GenerationRun = {
        jobId: result.jobId,
        target,
        epoch,
        completedStageIds: new Set(snapshot.stages.filter(candidate => candidate.state === "completed").map(candidate => candidate.id)),
      };
      generationRun.current = run;
      setGenerationJobId(result.jobId);
      setGenerationStarting(true);
      await pollGeneration(run);
    } catch (failure) {
      if (generationAction.current === actionId && isCurrentView(epoch, target)) setError(generationError(failure, provider));
    } finally {
      if (generationAction.current === actionId && !generationRun.current) {
        setGenerationStarting(false);
        setRetryingStageId(undefined);
      }
    }
  };
  const narrateMapNode = async (nodeId: string, nodeTerm: string) => {
    const target = selectionRef.current;
    const bundle = mapRef.current;
    const selectedRevision = bundle?.revisions.find(candidate => candidate.id === (revisionId ?? bundle.map.activeRevisionId));
    if (!target || target.kind !== "map" || !bundle || !selectedRevision || generationRun.current) return;
    const intent = ++narrationIntent.current;
    const narration: MapNarration = { nodeId, nodeTerm, revisionId: selectedRevision.id, intent };
    setError(""); setNotice(""); setListeningMapNode(undefined);
    if (playNarration(narration)) return;
    const epoch = generation.current;
    try {
      const result = await request("narrateMapNode", {
        mapId: target.id,
        revisionId: selectedRevision.id,
        nodeId,
        requestKey: narrationRequestKey(),
      });
      if (!isCurrentView(epoch, target) || narrationIntent.current !== intent) return;
      if (result.assetId) {
        await refreshSelection(target, epoch);
        if (isCurrentView(epoch, target) && narrationIntent.current === intent && !playNarration(narration)) {
          setError("Đã tạo giọng đọc nhưng chưa tải được file audio. Hãy thử lại.");
        }
        return;
      }
      if (!result.jobId) {
        setError("Chưa nhận được file giọng đọc. Hãy thử lại.");
        return;
      }
      const run: GenerationRun = { jobId: result.jobId, target, epoch, completedStageIds: new Set(), narration };
      generationRun.current = run;
      setGenerationJobId(result.jobId);
      setGenerationStarting(true);
      await pollGeneration(run);
    } catch (failure) {
      if (isCurrentView(epoch, target) && narrationIntent.current === intent) setError(generationError(failure));
    } finally {
      if (isCurrentView(epoch, target) && narrationIntent.current === intent && !generationRun.current) setGenerationStarting(false);
    }
  };
  const refreshCapabilities = async () => {
    if (probing) return;
    const epoch = generation.current;
    const connectionId = sessionRef.current?.connectionId;
    const profileId = sessionRef.current?.profileId;
    setProbing(true); setError("");
    try {
      const context = await bridge.getContext({ refreshCapabilities: true });
      if (!isCurrentView(epoch)) return;
      if ((connectionId && context.connectionId !== connectionId) || (profileId && context.profileId !== profileId)) {
        setError("Hồ sơ học tập đã thay đổi. Hãy mở lại Xưởng bài học để kiểm tra kết nối mới.");
        return;
      }
      sessionRef.current = context;
      setSession(context);
      setNotice("Đã kiểm tra lại Codex CLI và Claude Code CLI.");
    } catch {
      if (isCurrentView(epoch)) setError("Chưa kiểm tra lại được kết nối CLI. Hãy thử lại.");
    } finally {
      if (isCurrentView(epoch)) setProbing(false);
    }
  };
  const queueMapLayout = (mapId: string, mapRevisionId: string, positions: readonly { id: string; x: number; y: number }[]) => {
    const epoch = generation.current;
    layoutQueue.current?.enqueue({
      key: mapRevisionId,
      run: async () => {
        await request("saveMapLayout", { mapRevisionId, positions: positions.map(position => ({ ...position })) });
      },
      isCurrent: () => isCurrentView(epoch, { kind: "map", id: mapId }),
      onSaved: () => setNotice("Đã lưu bố cục."),
      onError: (failure) => {
        const message = failure instanceof Error ? failure.message : "";
        setError(message.includes("revision_conflict") ? "Bố cục đã có phiên bản mới. Hãy mở lại mindmap trước khi lưu." : "Không thể lưu bố cục mindmap. Hãy thử lại.");
      },
    });
  };
  useEffect(() => {
    let active = true;
    mountedRef.current = true;
    setLoading(true);
    void (async () => {
      const context = await bridge.getContext();
      const items = await bridge.request(context, "list", {});
      if (!active) return;
      sessionRef.current = context; setSession(context); setLibrary(items);
      // Opening saved content never waits for provider authentication or network.
      if (context.capabilities.some(capability => capability.reason === "native_not_checked")) {
        setProbing(true);
        void bridge.getContext({ refreshCapabilities: true }).then(refreshed => {
          if (!active || sessionRef.current?.connectionId !== refreshed.connectionId) return;
          sessionRef.current = refreshed;
          setSession(refreshed);
        }).catch(() => {
          // The local library remains usable when provider discovery is offline.
        }).finally(() => { if (active) setProbing(false); });
      }
    })().catch(() => { if (active) setError("Xưởng bài học chưa mở được thư viện local. Hãy thử mở lại trang."); })
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      mountedRef.current = false;
      generation.current++;
      busyToken.current++;
      generationAction.current++;
      narrationIntent.current++;
      if (generationTimer.current) clearTimeout(generationTimer.current);
      generationTimer.current = undefined;
      generationRun.current = undefined;
      mapRef.current = undefined;
      layoutQueue.current?.clear();
      sessionRef.current = undefined;
    };
  }, [bridge]);

  useEffect(() => {
    if (mode !== "new-map") {
      mapFormOpen.current = false;
      return;
    }
    if (!mapFormOpen.current) {
      mapFormOpen.current = true;
      mapProviderTouched.current = false;
      mapIllustrationsTouched.current = false;
      setMapLevel("A2");
    }
    const capabilities = sessionRef.current?.capabilities ?? [];
    const codexCapability = capabilities.find(item => item.provider === "codex");
    if (!mapIllustrationsTouched.current && codexCapability?.reason !== "native_not_checked") {
      setMapIllustrations(Boolean(codexCapability?.image));
    }
    let active = true;
    void (async () => {
      let configured: { name?: string } | undefined;
      try {
        configured = await window.__ENJOY_APP__?.userSettings?.get(UserSettingKeyEnum.GPT_ENGINE);
      } catch {
        configured = undefined;
      }
      if (!active || mode !== "new-map") return;
      const configuredProvider = configured?.name === "codex-acp"
        ? "codex"
        : configured?.name === "claude-acp"
          ? "claude"
          : configured?.name === "azure-openai" ? "azure-openai" : undefined;
      const preferred = configuredProvider && capabilities.some(item => item.provider === configuredProvider && item.text)
        ? configuredProvider
        : capabilities.find(item => item.text)?.provider;
      if (preferred && !mapProviderTouched.current) setMapProvider(preferred);
    })();
    return () => { active = false; };
  }, [mode, session]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const engine = await window.__ENJOY_APP__?.userSettings?.get(UserSettingKeyEnum.GPT_ENGINE);
        if (!active) return;
        const provider: Provider | undefined = engine?.name === "codex-acp"
          ? "codex"
          : engine?.name === "claude-acp"
            ? "claude"
            : engine?.name === "azure-openai" ? "azure-openai" : undefined;
        setPreferredProvider(provider && session?.capabilities.some(item => item.provider === provider && item.text)
          ? provider
          : session?.capabilities.find(item => item.text)?.provider);
      } catch {
        if (active) setPreferredProvider(session?.capabilities.find(item => item.text)?.provider);
      }
    })();
    return () => { active = false; };
  }, [session]);

  const lessonRevision = lesson?.revisions.find(revision => revision.id === (revisionId ?? lesson.lesson.activeRevisionId));
  const lessonContent = LessonDraftSchema.safeParse(lessonRevision?.content);
  const lessonBrief = LessonBriefSchema.safeParse(lessonRevision?.brief);
  const mapRevision = map?.revisions.find(revision => revision.id === (revisionId ?? map.map.activeRevisionId));
  const graph = MindmapGraphSchema.safeParse(mapRevision?.content);
  const mapLayout = map?.layouts.find(layout => layout.mapRevisionId === mapRevision?.id)?.positions;
  const assetUrl = (relativePath: string) => `enjoy://library/learning-assets/${session?.connectionId}/${relativePath}`;
  const selectedRecording = lesson?.assets.find(asset => asset.id === listeningAsset && asset.kind === "audio");
  const selectedMapRecording = map?.assets.find(asset => asset.id === listeningMapNode?.assetId && asset.kind === "audio");
  const displayedRevisionId = lessonRevision?.id ?? mapRevision?.id;
  const displayedRevisionStatus = lessonRevision?.status ?? mapRevision?.status;
  const activeResourceRevisionId = lesson?.lesson.activeRevisionId ?? map?.map.activeRevisionId;
  const displayedIsActiveRevision = Boolean(displayedRevisionId && displayedRevisionId === activeResourceRevisionId);
  const assetGenerationAvailable = displayedIsActiveRevision && displayedRevisionStatus === "ready" && !generationStarting && !generationRun.current;
  const codexImageAvailable = Boolean(session?.capabilities.find(item => item.provider === "codex")?.image);
  const textProviderReady = Boolean(session?.capabilities.some(item => item.text));
  const mapGroupImageGenerationAvailable = Boolean(
    assetGenerationAvailable
    && codexImageAvailable
    && mapRevision
    && map?.slots.some(slot => slot.mapRevisionId === mapRevision.id && slot.sourceType === "group" && slot.kind === "image"),
  );
  const mapIllustrationsRequested = Boolean(
    mapRevision
    && "brief" in mapRevision
    && mapRevision.brief
    && typeof mapRevision.brief === "object"
    && "illustrations" in mapRevision.brief
    && mapRevision.brief.illustrations,
  );
  const groupImages = map && mapRevision && graph.success
    ? Object.fromEntries(map.slots.flatMap(slot => {
      if (slot.mapRevisionId !== mapRevision.id || slot.sourceType !== "group" || slot.kind !== "image" || !slot.selectedAssetId) return [];
      const asset = map.assets.find(candidate => candidate.id === slot.selectedAssetId && candidate.kind === "image");
      if (!asset) return [];
      const group = graph.data.studyGroups?.find(candidate => candidate.id === slot.sourceId);
      return [[slot.sourceId, { src: assetUrl(asset.relativePath), alt: group?.illustration?.alt ?? `Hình minh họa cho ${group?.title ?? slot.sourceId}` }]];
    }))
    : {};
  const retryProviderFor = (stage: GenerationSnapshot["stages"][number]): Provider => {
    if (stage.kind === "image" || stage.kind === "audio") return "codex";
    if (retryProviders[stage.id]) return retryProviders[stage.id];
    const provider = [...(generationSnapshot?.attempts ?? [])].reverse().find(attempt => attempt.stageId === stage.id)?.provider;
    return provider === "claude" || provider === "azure-openai" ? provider : "codex";
  };
  const stageFailureText = (stage: GenerationSnapshot["stages"][number]) => {
    const code = [...(generationSnapshot?.attempts ?? [])].reverse().find(attempt => attempt.stageId === stage.id)?.errorCode ?? "";
    if (code.includes("speech_not_configured")) return "Chưa cấu hình giọng đọc. Hãy chọn dịch vụ TTS trong Cài đặt rồi thử lại.";
    if (code.includes("azure_text_not_configured")) return "Azure OpenAI chưa được cấu hình đủ endpoint, deployment và API key.";
    if (code.includes("azure_text_auth")) return "Azure OpenAI chưa xác thực được API key.";
    if (code.includes("azure_text_quota")) return "Azure OpenAI đã hết hạn mức hoặc đang giới hạn yêu cầu.";
    if (code.includes("azure_text_timeout")) return "Azure OpenAI phản hồi quá lâu.";
    if (code.includes("azure_text_invalid") || code.includes("learning_validation_exhausted")) return "Azure OpenAI chưa tạo được nội dung hợp lệ.";
    if (code.includes("auth")) return "Phiên đăng nhập CLI chưa được xác nhận. Hãy đăng nhập rồi thử lại.";
    if (code.includes("version")) return "Phiên bản CLI hiện tại chưa được hỗ trợ. Hãy cập nhật Enjoy hoặc dùng phiên bản CLI được hỗ trợ.";
    return retryableStageStates.has(stage.state) ? "Bước này cần bạn thử lại." : "";
  };

  const createMap = async (event: FormEvent) => {
    event.preventDefault();
    if (mapSubmission.current || busy || generationStarting || generationRun.current) return;
    const title = mapTitle.trim();
    const capability = sessionRef.current?.capabilities.find(item => item.provider === mapProvider);
    if (!capability?.text) {
      setError(`Chưa có dịch vụ AI tạo chữ sẵn sàng. ${capabilityReason(mapProvider, capability?.reason ?? null)} Nội dung bạn nhập vẫn được giữ nguyên.`);
      return;
    }
    const epoch = generation.current;
    const token = ++busyToken.current;
    mapSubmission.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const created = await request("createMap", {
        title,
        level: mapLevel,
        illustrations: mapIllustrations,
        ...(linkMap && lessonRevision?.status === "ready" ? { lessonRevisionId: lessonRevision.id } : {}),
      });
      if (!isCurrentView(epoch)) return;
      if (!await refreshLibrary(epoch) || !isCurrentView(epoch)) return;
      const target: Selection = { kind: "map", id: created.map.id };
      if (!await open(target) || !sameSelection(selectionRef.current, target)) return;
      const openEpoch = generation.current;
      const started = await startGenerationFor(mapProvider, target, created.revision.id, openEpoch);
      if (started && isCurrentView(openEpoch, target)) {
        setMapTitle("");
        setNotice("Đã tạo bản nháp và đang tạo trang học.");
      }
    } catch (failure) {
      if (isCurrentView(epoch)) setError(generationError(failure, mapProvider));
    } finally {
      mapSubmission.current = false;
      if (busyToken.current === token) setBusy(false);
    }
  };

  return <main className="h-full overflow-y-auto" data-testid="learning-studio">
    <div className="w-full mx-auto max-w-content px-7 pt-[22px] pb-11">
      <div className="flex items-start gap-4 mb-6">
        <div className="min-w-0 flex-1">
          <div className="ej-label text-ej-accent mb-1">Học bằng câu chuyện của bạn</div>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-ej-ink">Xưởng bài học</h1>
          <p className="mt-1 max-w-xl text-xs text-ej-muted">Một tập từ, nhiều cách nhớ: đọc truyện, khám phá liên hệ, nghe và tự kể lại.</p>
        </div>
        <button type="button" className={buttonStyle} onClick={() => navigateMode(mode === "connections" ? "library" : "connections")}><PlugZapIcon className="size-3.5" /> Kết nối AI</button>
      </div>

      <div className="sr-only" role="status" aria-live="polite">{notice}</div>
      {notice && <p className="mb-4 rounded-ej border border-ej-accent-soft2 bg-ej-accent-soft px-3.5 py-2.5 text-xs text-ej-accent-ink">{notice}</p>}
      {error && <p role="alert" className="mb-4 rounded-ej border border-ej-line2 bg-ej-bad-soft px-3.5 py-2.5 text-xs text-ej-bad">{error}</p>}

      {loading ? <p role="status" className="py-16 text-center text-xs text-ej-muted">Đang mở thư viện của bạn…</p> : <div className="grid items-start gap-5 lg:grid-cols-[236px_minmax(0,1fr)]">
        <aside className="space-y-4 rounded-ej border border-ej-line bg-ej-surface p-3.5" aria-label="Thư viện bài học">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            <button disabled={!session} className={primaryButtonStyle} onClick={() => navigateMode("new-lesson")}><PlusIcon className="size-3.5" /> Bài học mới</button>
            <button disabled={!session} className={buttonStyle} onClick={() => navigateMode("new-map")}><NetworkIcon className="size-3.5" /> Mindmap mới</button>
          </div>

          <div>
            <h2 className="ej-label mb-1.5 flex items-center justify-between gap-2"><span>Bài học</span><span className="ej-tabular">{library.lessons.length}</span></h2>
            <ul className="space-y-0.5">{library.lessons.map(item => <li key={item.id}><button aria-current={selection?.id === item.id ? "page" : undefined} className={`w-full break-words rounded-[10px] px-2.5 py-2 text-left text-xs transition-colors duration-ej ${selection?.id === item.id ? "bg-ej-accent-soft font-semibold text-ej-accent-ink" : "text-ej-ink2 hover:bg-ej-surface2"}`} onClick={() => void open({ kind: "lesson", id: item.id })}>{item.title}</button></li>)}</ul>
            {!library.lessons.length && <p className="px-2.5 py-1.5 text-xs text-ej-muted">Chưa có bài học.</p>}
          </div>

          <div>
            <h2 className="ej-label mb-1.5 flex items-center justify-between gap-2"><span>Mindmap</span><span className="ej-tabular">{library.maps.length}</span></h2>
            <ul className="space-y-0.5">{library.maps.map(item => <li key={item.id}><button aria-current={selection?.id === item.id ? "page" : undefined} className={`w-full break-words rounded-[10px] px-2.5 py-2 text-left text-xs transition-colors duration-ej ${selection?.id === item.id ? "bg-ej-accent-soft font-semibold text-ej-accent-ink" : "text-ej-ink2 hover:bg-ej-surface2"}`} onClick={() => void open({ kind: "map", id: item.id })}>{item.title}</button></li>)}</ul>
            {!library.maps.length && <p className="px-2.5 py-1.5 text-xs text-ej-muted">Chưa có sơ đồ.</p>}
          </div>

          <p className="border-t border-ej-line pt-3 text-xxs leading-relaxed text-ej-muted">Nội dung đã lưu có thể mở lại khi không có mạng.</p>
        </aside>

        <section className="min-w-0 space-y-5" aria-label="Nội dung học tập">
          {mode === "connections" && <div className="space-y-4 rounded-ej border border-ej-line bg-ej-surface p-5">
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-base font-bold text-ej-ink">Kết nối AI</h2>
                <Pill tone={textProviderReady ? "ok" : "muted"}>{textProviderReady ? "Sẵn sàng tạo nội dung" : "Chưa sẵn sàng tạo nội dung"}</Pill>
              </div>
              <p className="mt-1 text-xs text-ej-muted">Enjoy kết nối Codex và Claude Code qua ACP, dùng phiên đăng nhập riêng của từng dịch vụ trên máy.</p>
            </div>
            <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>{session?.capabilities.map(capability => <div key={capability.provider} className="rounded-ej border border-ej-line bg-ej-surface2 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-ej-ink">{providerName(capability.provider)}</h3>
                <Pill tone={capability.text ? "ok" : "muted"}>{capability.image ? "Chữ và hình" : capability.text ? "Chữ" : "Chưa sẵn sàng"}</Pill>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-ej-muted">{capability.text ? "Có thể tạo nội dung" : capabilityReason(capability.provider, capability.reason)}</p>
            </div>)}</div>
            {session?.healthError && <p role="alert" className="rounded-ej bg-ej-bad-soft px-3 py-2 text-xs text-ej-bad">Kiểm tra kết nối ACP chưa hoàn tất. Bạn có thể thử kiểm tra lại.</p>}
            <p className="text-xs leading-relaxed text-ej-muted">Nếu CLI yêu cầu đăng nhập hoặc cập nhật phiên bản, hãy hoàn tất trong Terminal rồi bấm kiểm tra lại. Nội dung đã lưu vẫn có thể đọc và luyện khi AI chưa sẵn sàng.</p>
            <div className="flex flex-wrap gap-2.5">
              <button disabled={probing} className={primaryButtonStyle} onClick={() => void refreshCapabilities()}><RefreshCwIcon className={`size-3.5 ${probing ? "animate-spin" : ""}`} /> {probing ? "Đang kiểm tra…" : "Kiểm tra lại kết nối"}</button>
              <button className={buttonStyle} onClick={() => navigateMode("library")}>Về thư viện</button>
            </div>
          </div>}

          {mode === "new-lesson" && <BriefForm capabilities={session?.capabilities} preferredProvider={preferredProvider} onSuggest={async (input, provider, signal) => provider === "azure-openai"
            ? suggestLessonBriefWithAzure(input, await azureBriefConfig(), signal)
            : suggestLessonBrief(window.__ENJOY_APP__.acp, input, provider, signal, await selectedModel(provider))} onCancel={() => navigateMode("library")} onSave={async brief => {
            const epoch = generation.current;
            const created = await request("createLesson", { brief });
            if (!isCurrentView(epoch) || !await refreshLibrary(epoch) || !isCurrentView(epoch)) return;
            const opened = await open({ kind: "lesson", id: created.lesson.id });
            if (opened && selectionRef.current?.kind === "lesson" && selectionRef.current.id === created.lesson.id) setNotice("Đã lưu bản nháp và tập từ bạn chọn.");
          }} />}

          {mode === "new-map" && <form aria-label="Tạo trang sơ đồ học" className="space-y-5 rounded-ej border border-ej-line bg-ej-surface p-5" onSubmit={createMap}>
            <div>
              <h2 className="text-base font-bold text-ej-ink">Trang sơ đồ minh họa</h2>
              <p className="mt-1 text-xs leading-relaxed text-ej-muted">Nhập điều bạn muốn học. Enjoy sẽ chọn từ, phân nhóm và dàn thành một trang dễ đọc.</p>
            </div>

            <label className="block"><span className="ej-label">Chủ đề hoặc từ khóa</span><input required maxLength={200} className={`${fieldStyle} mt-1.5`} value={mapTitle} onChange={event => setMapTitle(event.target.value)} placeholder="Ví dụ: coffee, travel, work" /></label>
            <label className="block"><span className="ej-label">Trình độ</span><select aria-label="Trình độ" className={`${fieldStyle} mt-1.5 sm:max-w-xs`} value={mapLevel} onChange={event => setMapLevel(event.target.value as CefrLevel)}>{CEFR_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}</select></label>

            <details className="rounded-ej border border-ej-line bg-ej-surface2 px-3.5 py-3">
              <summary className="cursor-pointer text-xs font-semibold text-ej-ink">Tuỳ chọn nâng cao</summary>
              <div className="mt-3.5 space-y-3.5">
                <label className="block"><span className="ej-label">Dịch vụ AI</span><select aria-label="Dịch vụ AI" className={`${fieldStyle} mt-1.5 sm:max-w-sm`} value={mapProvider} onChange={event => { mapProviderTouched.current = true; setMapProvider(event.target.value as Provider); }}>{LEARNING_PROVIDERS.map(provider => { const capability = session?.capabilities.find(item => item.provider === provider); return <option key={provider} value={provider} disabled={!capability?.text}>{providerName(provider)}{capability?.text ? "" : " - chưa sẵn sàng"}</option>; })}</select></label>
                <div>
                  <label className="flex items-center gap-2 text-xs text-ej-ink"><input type="checkbox" className="accent-ej-accent" checked={mapIllustrations} disabled={!codexImageAvailable} onChange={event => { mapIllustrationsTouched.current = true; setMapIllustrations(event.target.checked); }} /> Tạo hình minh họa</label>
                  <p className="mt-1 text-xxs leading-relaxed text-ej-muted">{codexImageAvailable ? "Hình được tạo bằng Codex, kể cả khi bạn chọn dịch vụ khác để viết nội dung." : "Codex chưa sẵn sàng tạo hình. Trang học vẫn có thể được tạo bằng chữ."}</p>
                </div>
                {lessonRevision?.status === "ready" && <label className="flex items-center gap-2 text-xs text-ej-ink"><input type="checkbox" className="accent-ej-accent" checked={linkMap} onChange={event => setLinkMap(event.target.checked)} /> Liên kết với phiên bản bài học đang xem</label>}
              </div>
            </details>

            <div className="flex flex-wrap gap-2.5">
              <button disabled={busy || generationStarting || !mapTitle.trim()} className={primaryButtonStyle}>{busy ? "Đang tạo bản nháp…" : "Tạo trang học"}</button>
              <button type="button" className={buttonStyle} onClick={() => navigateMode("library")}>Quay lại</button>
            </div>
          </form>}

          {mode === "library" && !selection && <EjEmptyState kicker="Bắt đầu từ điều bạn muốn nói" title="Biến những từ rời rạc thành một câu chuyện dễ nhớ." description="Tạo một bài học theo trình độ, hoặc mở mindmap để khám phá các từ liên quan. Bản nháp, các phiên bản và kết quả luyện tập được giữ trong thư viện của bạn." actions={<button className={primaryButtonStyle} onClick={() => navigateMode("new-lesson")}><PlusIcon className="size-3.5" /> Chọn tập từ đầu tiên</button>} />}

          {mode === "library" && selection && <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-1">{lesson && <>
                <button aria-pressed={detailTab === "read"} className={detailTab === "read" ? segmentActiveStyle : segmentStyle} onClick={() => setDetailTab("read")}>Đọc & nghe</button>
                <button aria-pressed={detailTab === "practice"} disabled={!lessonContent.success || lessonRevision?.status !== "ready"} className={detailTab === "practice" ? segmentActiveStyle : segmentStyle} onClick={() => setDetailTab("practice")}>Luyện tập</button>
              </>}</div>
              <button className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] text-xs font-medium text-ej-muted transition-colors duration-ej hover:bg-ej-bad-soft hover:text-ej-bad" onClick={() => setDeleteRequested(true)}><Trash2Icon className="size-3.5" /> Xoá {selection.kind === "lesson" ? "bài học" : "mindmap"}</button>
            </div>

            {(lessonRevision || mapRevision) && <div className="space-y-3.5 rounded-ej border border-ej-line bg-ej-surface p-4" aria-label="Tạo nội dung bằng AI">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[13px] font-semibold text-ej-ink">Tạo nội dung bằng AI</h3>
                  <p className="mt-1 text-xs text-ej-muted">Chọn dịch vụ AI để tạo nội dung. Model được lấy từ cấu hình trong Dịch vụ AI.</p>
                </div>
                <div className="flex flex-wrap gap-2">{LEARNING_PROVIDERS.map(provider => {
                  const capability = session?.capabilities.find(item => item.provider === provider);
                  return <button key={provider} type="button" className={buttonStyle} disabled={!displayedIsActiveRevision || displayedRevisionStatus !== "draft" || !capability?.text || generationStarting || Boolean(generationRun.current)} title={!displayedIsActiveRevision ? "Hãy mở bản hiện hành." : displayedRevisionStatus !== "draft" ? "Hãy tạo hoặc chỉnh sửa một bản nháp mới." : !capability?.text ? capabilityReason(provider, capability?.reason ?? null) : undefined} onClick={() => void startGeneration(provider)}><SparklesIcon className="size-3.5" /> Tạo bằng {providerName(provider)}</button>;
                })}{generationJobId && (!generationSnapshot || hasActiveStages(generationSnapshot)) && <button type="button" className={dangerButtonStyle} disabled={generationCancelling} onClick={() => void cancelGeneration()}><SquareIcon className="size-3" /> {generationCancelling ? "Đang dừng…" : "Dừng tạo"}</button>}</div>
              </div>

              {generationSnapshot && <details role="status" open={hasActiveStages(generationSnapshot) || generationSnapshot.job.state !== "completed"}>
                <summary className="cursor-pointer text-xs font-semibold text-ej-ink">{jobStatusText(generationSnapshot)}</summary>
                <div className="mt-3 space-y-2.5">
                  <p className="text-xs text-ej-muted ej-tabular">{generationSnapshot.stages.filter(stage => stage.state === "completed").length}/{generationSnapshot.stages.length} bước đã nhận</p>
                  {generationSnapshot.job.revisionId !== displayedRevisionId && <p className="rounded-ej bg-ej-warn-soft px-3 py-2 text-xs text-ej-warn">Tác vụ này thuộc một phiên bản khác. Mở đúng phiên bản để thử lại.</p>}
                  <ul className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>{generationSnapshot.stages.map(stage => {
                    const retryProvider = retryProviderFor(stage);
                    const capability = session?.capabilities.find(item => item.provider === retryProvider);
                    const providerReady = stage.kind === "image" ? Boolean(capability?.image) : stage.kind === "audio" || Boolean(capability?.text);
                    const canRetry = retryableStageStates.has(stage.state) && generationSnapshot.job.revisionId === displayedRevisionId && displayedIsActiveRevision && (displayedRevisionStatus === "draft" || stage.kind === "image" || stage.kind === "audio");
                    return <li key={stage.id} className="rounded-ej border border-ej-line bg-ej-surface2 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-ej-ink truncate">{stageKindText(stage.kind)}</span>
                        <Pill tone={stageToneOf(stage.state)}>{stageStatusText(stage.state)}</Pill>
                      </div>
                      {stageFailureText(stage) && <p className="mt-1.5 text-xxs leading-relaxed text-ej-muted">{stageFailureText(stage)}</p>}
                      {canRetry && <div className="mt-2.5 space-y-2">
                        {stage.kind === "image" ? <p className="text-xxs text-ej-muted">Tạo hình bằng Codex</p> : stage.kind === "audio" ? <p className="text-xxs text-ej-muted">Dùng dịch vụ TTS đã cấu hình</p> : <label className="block"><span className="ej-label">Dịch vụ AI</span><select className={`${fieldStyle} mt-1 h-8`} value={retryProvider} onChange={event => setRetryProviders(current => ({ ...current, [stage.id]: event.target.value as Provider }))}>{LEARNING_PROVIDERS.map(provider => <option key={provider} value={provider}>{providerName(provider)}</option>)}</select></label>}
                        <button type="button" className={`${buttonStyle} h-8 w-full`} disabled={!providerReady || Boolean(retryingStageId) || Boolean(generationRun.current)} onClick={() => void retryGeneration(stage.id, retryProvider)}><RefreshCwIcon className={`size-3.5 ${retryingStageId === stage.id ? "animate-spin" : ""}`} /> {retryingStageId === stage.id ? "Đang thử lại…" : "Thử lại"}</button>
                        {!providerReady && <p className="text-xxs leading-relaxed text-ej-muted">{capabilityReason(retryProvider, capability?.reason ?? null)}</p>}
                      </div>}
                    </li>;
                  })}</ul>
                </div>
              </details>}

              {!generationSnapshot && generationStarting && <p role="status" className="text-xs text-ej-muted">Đang bắt đầu tác vụ tạo nội dung…</p>}
              {!displayedIsActiveRevision && !generationSnapshot ? <p className="text-xxs text-ej-muted">Đây không phải bản hiện hành. Hãy mở bản hiện hành để tạo hoặc thử lại.</p> : displayedRevisionStatus !== "draft" && !generationSnapshot ? <p className="text-xxs text-ej-muted">Phiên bản này đã hoàn tất. Hãy tạo hoặc chỉnh sửa một bản nháp mới để tạo lại nội dung.</p> : null}
              {!generationStarting && !generationSnapshot && <div className="space-y-1 text-xxs leading-relaxed text-ej-muted">{LEARNING_PROVIDERS.map(provider => {
                const capability = session?.capabilities.find(item => item.provider === provider);
                return !capability?.text ? <p key={provider}>{capabilityReason(provider, capability?.reason ?? null)}</p> : null;
              })}</div>}
            </div>}

            {deleteRequested && <div role="alert" className="space-y-3 rounded-ej border border-ej-line2 bg-ej-bad-soft p-4">
              <p className="text-xs text-ej-ink">Xoá nội dung này cùng các phiên bản, ảnh, audio và kết quả luyện tập liên quan khỏi thư viện?</p>
              <div className="flex gap-2.5">
                <button disabled={busy} className={`${buttonStyle} border-ej-bad bg-ej-bad text-white hover:bg-ej-bad hover:opacity-90`} onClick={() => {
                  const target = selection;
                  void action(async () => {
                    let cleanupFailure: unknown;
                    try {
                      await request(target.kind === "lesson" ? "deleteLesson" : "deleteMap", { id: target.id });
                    } catch (failure) {
                      if (!(failure instanceof Error) || !failure.message.includes("asset_cleanup_failed")) throw failure;
                      cleanupFailure = failure;
                    }
                    if (mountedRef.current && sameSelection(selectionRef.current, target)) {
                      selectionRef.current = undefined;
                      setSelection(undefined);
                      setLesson(undefined);
                      setMap(undefined);
                      setDeleteRequested(false);
                    }
                    await refreshLibrary();
                    if (cleanupFailure) throw cleanupFailure;
                  }, "Đã xoá khỏi thư viện.");
                }}>Xoá khỏi thư viện</button>
                <button className={buttonStyle} onClick={() => setDeleteRequested(false)}>Giữ lại</button>
              </div>
            </div>}

            {lesson && detailTab === "read" && <LessonReader bundle={lesson} revisionId={revisionId} onRevisionSelect={selectRevision} assetUrl={assetUrl} onSaveRevision={async content => {
              if (!lessonBrief.success || !lessonRevision || !selection) throw new Error("invalid_content");
              const epoch = generation.current;
              const target = selection;
              const lessonId = lesson.lesson.id;
              const expectedRevisionId = lessonRevision.id;
              await request("reviseLesson", { lessonId, expectedRevisionId, brief: lessonBrief.data, content });
              if (!isCurrentView(epoch, target)) return;
              if (!await refreshSelection(target, epoch) || !isCurrentView(epoch, target)) return;
              if (!await refreshLibrary(epoch) || !isCurrentView(epoch, target)) return;
              setRevisionId(undefined);
            }} onSelectAsset={async (slotId, assetId) => {
              if (!selection) return;
              const epoch = generation.current;
              const target = selection;
              await request("selectAsset", { slotId, assetId });
              if (!isCurrentView(epoch, target)) return;
              await refreshSelection(target, epoch);
            }} onGenerateImage={assetGenerationAvailable && codexImageAvailable ? slotId => startAssetGeneration("image", slotId) : undefined} onGenerateAudio={assetGenerationAvailable ? slotId => startAssetGeneration("audio", slotId) : undefined} />}

            {lesson && detailTab === "practice" && lessonContent.success && lessonBrief.success && lessonRevision && <PracticePanel key={lessonRevision.id} exercises={lessonContent.data.exercises} targets={lessonBrief.data.targets} attempts={lesson.practiceAttempts.filter(attempt => attempt.lessonRevisionId === lessonRevision.id)} onSubmit={async (questionId, answer, recording) => { const result = await request("practice", { lessonRevisionId: lessonRevision.id, questionId, answer, ...(recording ? { recording } : {}) }); await refreshSelection(); return { ...result.grade, recordingAssetId: result.attempt.recordingAssetId }; }} onPlayRecording={setListeningAsset} />}

            {selectedRecording && <audio key={selectedRecording.id} aria-label="Nghe lại bản ghi âm của bạn" controls autoPlay src={assetUrl(selectedRecording.relativePath)} className="w-full" />}
            {selectedMapRecording && listeningMapNode && <audio key={selectedMapRecording.id} aria-label={`Nghe phát âm từ ${listeningMapNode.nodeTerm}`} controls autoPlay src={assetUrl(selectedMapRecording.relativePath)} className="w-full" />}

            {map && <div className="space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-xl font-bold tracking-[-0.02em] text-ej-ink truncate">{map.map.title}</h2>
                  {layoutBusy && <p className="mt-1 text-xxs text-ej-muted" role="status">Đang lưu bố cục mới nhất…</p>}
                </div>
                <label className="flex items-center gap-2 text-xs text-ej-muted">Phiên bản <select className={`${fieldStyle} h-8 w-auto`} value={mapRevision?.id ?? ""} onChange={event => selectRevision(event.target.value)}>{map.revisions.map(revision => <option key={revision.id} value={revision.id}>{revision.number}</option>)}</select></label>
              </div>
              {graph.success && mapRevision ? <MindmapView key={mapRevision.id} graph={graph.data} positions={Array.isArray(mapLayout) ? mapLayout as { id: string; x: number; y: number }[] : undefined} onPositionsChange={positions => queueMapLayout(map.map.id, mapRevision.id, positions)} onSpeakNode={node => void narrateMapNode(node.id, node.term)} groupImages={groupImages} illustrationsRequested={mapIllustrationsRequested} onGenerateGroupImage={mapGroupImageGenerationAvailable ? groupId => { const slot = map.slots.find(candidate => candidate.mapRevisionId === mapRevision.id && candidate.sourceType === "group" && candidate.sourceId === groupId && candidate.kind === "image"); if (slot) void startAssetGeneration("image", slot.id); } : undefined} /> : <div className="rounded-ej border border-ej-line bg-ej-surface2 p-5">
                <h3 className="text-[13px] font-semibold text-ej-ink">Đã lưu chủ đề cho mindmap</h3>
                <p className="mt-1.5 text-xs text-ej-muted">Enjoy đang chuẩn bị các từ và mối liên hệ cho trang học này.</p>
                {!session?.capabilities.some(capability => capability.text) && <button className={`${buttonStyle} mt-3.5`} onClick={() => navigateMode("connections")}><PlugZapIcon className="size-3.5" /> Kiểm tra kết nối AI</button>}
              </div>}
            </div>}

            {!lesson && !map && <p role="status" className="py-16 text-center text-xs text-ej-muted">Đang mở nội dung…</p>}
          </>}
        </section>
      </div>}
    </div>
  </main>;
}
