import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import type { LessonBundle } from "../../../main/learning/storage";
import type {
  LessonDraft,
  LessonGlossaryEntry,
  LessonScene,
  LessonSection,
  LearningTarget,
} from "../../../types/learning";
import { EjEmptyState, EjReader, EjReaderFontSize, Pill } from "@renderer/components/enjoy";

type BundleRevision = LessonBundle["revisions"][number];
type BundleSlot = LessonBundle["slots"][number];
type BundleAsset = LessonBundle["assets"][number];

export type LessonReaderTab = "story" | "glossary" | "assets";

export type LessonReaderProps = Readonly<{
  bundle: LessonBundle | null | undefined;
  revisionId?: string;
  onRevisionSelect: (revisionId: string) => void;
  onSaveRevision: (content: LessonDraft) => Promise<void>;
  assetUrl: (relativePath: string) => string;
  onSelectAsset: (slotId: string, assetId: string) => Promise<void>;
  onGenerateImage?: (slotId: string) => Promise<void>;
  onGenerateAudio?: (slotId: string) => Promise<void>;
  className?: string;
}>;

type EditableDraft = LessonDraft;

const TAB_ORDER: readonly LessonReaderTab[] = ["story", "glossary", "assets"];
const TAB_LABELS: Readonly<Record<LessonReaderTab, string>> = {
  story: "Câu chuyện",
  glossary: "Từ vựng",
  assets: "Ảnh & âm thanh",
};

const STATUS_LABELS: Readonly<Record<BundleRevision["status"], string>> = {
  ready: "Đã lưu",
  draft: "Bản nháp",
};

const EVIDENCE_LABELS: Readonly<Record<string, string>> = {
  dictionary: "Đã đối chiếu từ điển",
  user: "Từ người học cung cấp",
  unverified: "Chưa xác minh độc lập",
};

const EMPTY_TARGETS: readonly LearningTarget[] = [];
const EMPTY_GLOSSARY: readonly LessonGlossaryEntry[] = [];
const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5] as const;
type PlaybackRate = (typeof PLAYBACK_RATES)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cloneDraft(draft: LessonDraft): LessonDraft {
  if (typeof structuredClone === "function") return structuredClone(draft);
  return JSON.parse(JSON.stringify(draft)) as LessonDraft;
}

function asLessonDraft(value: unknown): LessonDraft | null {
  if (!isRecord(value)) return null;
  if (typeof value.title !== "string") return null;
  if (!Array.isArray(value.sections) || !Array.isArray(value.glossary)) return null;
  if (!Array.isArray(value.scenes) || !Array.isArray(value.exercises) || !Array.isArray(value.entityDescriptions)) {
    return null;
  }
  return value as unknown as LessonDraft;
}

function asTargets(value: unknown): readonly LearningTarget[] {
  if (!isRecord(value) || !Array.isArray(value.targets)) return EMPTY_TARGETS;
  return value.targets.filter((target): target is LearningTarget => {
    return isRecord(target)
      && typeof target.id === "string"
      && typeof target.term === "string"
      && typeof target.sense === "string"
      && typeof target.definition === "string"
      && typeof target.translationVi === "string"
      && typeof target.example === "string";
  });
}

function asGlossary(value: unknown): readonly LessonGlossaryEntry[] {
  if (!Array.isArray(value)) return EMPTY_GLOSSARY;
  return value.filter((entry): entry is LessonGlossaryEntry => {
    return isRecord(entry)
      && typeof entry.targetId === "string"
      && typeof entry.definition === "string"
      && typeof entry.translationVi === "string"
      && typeof entry.example === "string";
  });
}

function getRevision(
  bundle: LessonBundle | null | undefined,
  revisionId?: string,
): BundleRevision | null {
  if (!bundle || bundle.revisions.length === 0) return null;
  if (revisionId) {
    const selected = bundle.revisions.find((revision) => revision.id === revisionId);
    if (selected) return selected;
  }
  if (bundle.lesson.activeRevisionId) {
    const active = bundle.revisions.find((revision) => revision.id === bundle.lesson.activeRevisionId);
    if (active) return active;
  }
  return [...bundle.revisions].sort((left, right) => right.number - left.number)[0] ?? null;
}

function revisionStatusLabel(revision: BundleRevision): string {
  return STATUS_LABELS[revision.status] ?? revision.status;
}

function evidenceLabel(value: unknown): string {
  if (typeof value !== "string") return EVIDENCE_LABELS.unverified;
  return EVIDENCE_LABELS[value] ?? EVIDENCE_LABELS.unverified;
}

function targetEvidence(target: LearningTarget | undefined): string {
  return evidenceLabel(target?.evidence?.status);
}

function assetForSlot(slot: BundleSlot, assets: readonly BundleAsset[]): BundleAsset | null {
  if (!slot.selectedAssetId) return null;
  return assets.find((asset) => asset.id === slot.selectedAssetId) ?? null;
}

function assetsForSlot(slot: BundleSlot, assets: readonly BundleAsset[]): BundleAsset[] {
  return assets.filter((asset) => asset.slotId === slot.id);
}

function sourceSlots(
  slots: readonly BundleSlot[],
  revisionId: string,
  sourceType: BundleSlot["sourceType"],
  sourceId: string,
  kind: BundleSlot["kind"],
): BundleSlot[] {
  return slots.filter((slot) => (
    slot.lessonRevisionId === revisionId
    && slot.sourceType === sourceType
    && slot.sourceId === sourceId
    && slot.kind === kind
  ));
}

function validationMessages(value: unknown): string[] {
  const messages: string[] = [];
  const visit = (candidate: unknown, depth: number): void => {
    if (messages.length >= 4 || depth > 3) return;
    if (typeof candidate === "string") {
      const text = candidate.trim();
      if (text && !messages.includes(text)) messages.push(text);
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (!isRecord(candidate)) return;
    const labels: Record<string, string> = {
      story_language_uncertain: "Chưa xác định chắc ngôn ngữ của bài. Bạn nên đọc lại nội dung.",
      cefr_length_outside_rubric: "Độ dài bài nằm ngoài khoảng gợi ý cho trình độ đã chọn.",
      cefr_sentence_length_above_rubric: "Bài có câu dài hơn mức gợi ý cho trình độ đã chọn.",
      target_above_requested_level: "Một số từ bạn chọn thuộc trình độ cao hơn mức của bài.",
    };
    const label = typeof candidate.code === "string" ? labels[candidate.code] : undefined;
    if (label) visit(label, depth + 1);
    else if (typeof candidate.message === "string") visit(candidate.message, depth + 1);
    for (const key of ["issues", "warnings", "error", "errors"]) {
      if (key in candidate) visit(candidate[key], depth + 1);
    }
  };
  visit(value, 0);
  return messages;
}

function dateLabel(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(date);
}

function tabPanelId(tab: LessonReaderTab): string {
  return `lesson-reader-panel-${tab}`;
}

function tabButtonId(tab: LessonReaderTab): string {
  return `lesson-reader-tab-${tab}`;
}

function sectionLabel(_section: LessonSection, index: number): string {
  return `Đoạn ${index + 1}`;
}

function safeAssetUrl(assetUrl: (relativePath: string) => string, asset: BundleAsset): string | null {
  try {
    const url = assetUrl(asset.relativePath);
    if (typeof url !== "string" || url.length === 0) return null;
    if (/^(?:data|javascript|vbscript):/iu.test(url.trim())) return null;
    return url;
  } catch {
    return null;
  }
}

type LessonAudioTrack = Readonly<{
  sectionId: string;
  sectionNumber: number;
  assetId: string;
  url: string;
}>;

function selectedAudioTracks(
  sections: readonly LessonSection[],
  revisionId: string,
  slots: readonly BundleSlot[],
  assets: readonly BundleAsset[],
  assetUrl: (relativePath: string) => string,
): LessonAudioTrack[] {
  return sections.flatMap((section, index) => {
    const slot = slots.find((candidate) => (
      candidate.lessonRevisionId === revisionId
      && candidate.sourceType === "section"
      && candidate.sourceId === section.id
      && candidate.kind === "audio"
    ));
    const asset = slot ? assetForSlot(slot, assets) : null;
    if (!asset || asset.kind !== "audio") return [];
    const url = safeAssetUrl(assetUrl, asset);
    if (!url) return [];
    return [{ sectionId: section.id, sectionNumber: index + 1, assetId: asset.id, url }];
  });
}

function resetAudioElement(audio: HTMLAudioElement | null): void {
  if (!audio) return;
  audio.pause();
  try {
    audio.currentTime = 0;
  } catch {
    // A media element can reject currentTime before its source is ready.
  }
}

function LessonAudioPlayer({
  sections,
  revisionId,
  slots,
  assets,
  assetUrl,
  scopeKey,
  resetToken,
}: {
  sections: readonly LessonSection[];
  revisionId: string;
  slots: readonly BundleSlot[];
  assets: readonly BundleAsset[];
  assetUrl: (relativePath: string) => string;
  scopeKey: string;
  resetToken: number;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [trackIndex, setTrackIndex] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [intentKey, setIntentKey] = useState<string | null>(null);
  const [startRequest, setStartRequest] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<PlaybackRate>(1);
  const tracks = useMemo(
    () => selectedAudioTracks(sections, revisionId, slots, assets, assetUrl),
    [assetUrl, assets, revisionId, sections, slots],
  );
  const trackKey = tracks.map((track) => `${track.sectionId}:${track.assetId}:${track.url}`).join("|");
  const playlistKey = `${scopeKey}/${resetToken}/${trackKey}`;
  const canPlay = hasStarted && intentKey === playlistKey;
  const currentTrack = tracks[canPlay ? trackIndex : 0] ?? null;
  const currentTrackKey = currentTrack ? `${currentTrack.sectionId}:${currentTrack.assetId}:${currentTrack.url}` : "";
  const currentTrackUrl = currentTrack?.url ?? "";
  const coverageLabel = tracks.length === sections.length && sections.length > 0
    ? "Nghe toàn bài"
    : `Nghe các đoạn đã có giọng đọc (${tracks.length}/${sections.length})`;

  useEffect(() => {
    const audio = audioRef.current;
    resetAudioElement(audio);
    setTrackIndex(0);
    setHasStarted(false);
    setIntentKey(null);
    return () => {
      resetAudioElement(audio);
    };
  }, [resetToken, scopeKey, trackKey]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [currentTrackKey, playbackRate]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !canPlay || !currentTrackUrl) return;
    const result = audio.play();
    if (result && typeof result.catch === "function") void result.catch((): void => undefined);
  }, [canPlay, currentTrackKey, currentTrackUrl, startRequest]);

  const startFromBeginning = () => {
    if (tracks.length === 0) return;
    resetAudioElement(audioRef.current);
    setTrackIndex(0);
    setHasStarted(true);
    setIntentKey(playlistKey);
    setStartRequest((value) => value + 1);
  };

  const handleEnded = () => {
    if (!canPlay) return;
    setTrackIndex((index) => {
      if (index >= tracks.length - 1) return index;
      return index + 1;
    });
  };

  return (
    <section className="rounded-ej-lg border border-ej-line bg-ej-surface2 p-4" data-testid="lesson-full-audio-player">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="ej-label">Nghe bài học</p>
          <p className="mt-1 text-xs font-semibold text-ej-ink" data-testid="lesson-audio-coverage">{coverageLabel}</p>
          {currentTrack && <p className="mt-1 text-xs text-ej-muted">Đoạn {currentTrack.sectionNumber} / {sections.length}</p>}
        </div>
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] bg-ej-ink px-3.5 text-xs font-semibold text-ej-bg transition-opacity duration-ej hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={tracks.length === 0}
          onClick={startFromBeginning}
          data-testid="lesson-audio-start"
        >
          Bắt đầu từ đầu
        </button>
      </div>
      {currentTrack ? (
        <audio
          ref={audioRef}
          className="mt-3 w-full"
          controls
          preload="metadata"
          autoPlay={canPlay}
          src={currentTrack.url}
          onEnded={handleEnded}
          data-testid="lesson-full-audio"
        >
          Trình duyệt không hỗ trợ phát audio.
        </audio>
      ) : (
        <p className="mt-3 text-xs leading-5 text-ej-muted">Chưa có đoạn audio nào được chọn cho phiên bản này.</p>
      )}
      <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-ej-muted" htmlFor="lesson-audio-playback-rate">
        Tốc độ phát
        <select
          id="lesson-audio-playback-rate"
          value={playbackRate}
          onChange={(event) => {
            const nextRate = Number(event.currentTarget.value);
            if (!PLAYBACK_RATES.some((rate) => rate === nextRate)) return;
            setPlaybackRate(nextRate as PlaybackRate);
          }}
          className="rounded-[10px] border border-ej-line bg-ej-surface px-2 py-1 text-xs font-medium text-ej-ink outline-none focus:border-ej-accent focus:ring-1 focus:ring-ej-accent"
          data-testid="lesson-audio-playback-rate"
        >
          {PLAYBACK_RATES.map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
        </select>
      </label>
    </section>
  );
}

function useStableDraft(revision: BundleRevision | null): [EditableDraft | null, (draft: EditableDraft | null) => void] {
  const [draft, setDraft] = useState<EditableDraft | null>(() => asLessonDraft(revision?.content));
  const contentKey = revision?.content === null || revision?.content === undefined
    ? ""
    : JSON.stringify(revision.content);
  useEffect(() => {
    setDraft(asLessonDraft(revision?.content));
  }, [revision?.id, contentKey]);
  return [draft, setDraft];
}

function EvidenceBadge({ status }: { status: string }) {
  return (
    <span data-testid="lesson-evidence">
      <Pill tone="muted">{status}</Pill>
    </span>
  );
}

function EmptyState({ children }: { children: string }) {
  return (
    <div data-testid="lesson-reader-empty">
      <EjEmptyState kicker="Xưởng bài học" title="Chưa có nội dung" description={children} />
    </div>
  );
}

function AssetVariants({
  slot,
  assets,
  onSelectAsset,
  selectingAssetId,
  onError,
}: {
  slot: BundleSlot;
  assets: readonly BundleAsset[];
  onSelectAsset: (slotId: string, assetId: string) => Promise<void>;
  selectingAssetId: string | null;
  onError: (message: string) => void;
}) {
  const variants = assetsForSlot(slot, assets);
  if (variants.length === 0) {
    return <p className="text-xs leading-5 text-ej-muted">Chưa có biến thể được lưu cho phiên bản này.</p>;
  }
  return (
    <div className="mt-3" data-testid={`lesson-asset-variants-${slot.id}`}>
      <p className="ej-label">Biến thể đã lưu</p>
      <div className="flex flex-wrap gap-2" role="list" aria-label="Các biến thể đã lưu">
        {variants.map((asset, index) => {
          const selected = slot.selectedAssetId === asset.id;
          const busy = selectingAssetId === asset.id;
          return (
            <div key={asset.id} role="listitem">
              <button
                type="button"
                className={`rounded-[10px] border px-3 py-2 text-left text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ej-accent ${selected ? "border-ej-accent bg-ej-accent-soft text-ej-accent-ink" : "border-ej-line bg-ej-surface text-ej-ink2 hover:border-ej-accent"}`}
                aria-pressed={selected}
                disabled={busy}
                data-testid={`lesson-select-asset-${asset.id}`}
                onClick={() => {
                  if (busy) return;
                  void onSelectAsset(slot.id, asset.id).catch(() => {
                    onError("Không thể chọn biến thể này. Bạn có thể thử lại.");
                  });
                }}
              >
                <span className="block font-semibold">{selected ? "Đang chọn" : `Biến thể ${index + 1}`}</span>
                <span className="mt-0.5 block opacity-80">{busy ? "Đang lưu..." : `${Math.round(asset.sizeBytes / 1024)} KB`}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SceneAsset({
  scene,
  slot,
  assets,
  assetUrl,
  onSelectAsset,
  selectingAssetId,
  onError,
  onGenerateImage,
}: {
  scene: LessonScene;
  slot: BundleSlot | null;
  assets: readonly BundleAsset[];
  assetUrl: (relativePath: string) => string;
  onSelectAsset: (slotId: string, assetId: string) => Promise<void>;
  selectingAssetId: string | null;
  onError: (message: string) => void;
  onGenerateImage?: (slotId: string) => Promise<void>;
}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const selectedAsset = slot ? assetForSlot(slot, assets) : null;
  const selectedUrl = selectedAsset ? safeAssetUrl(assetUrl, selectedAsset) : null;
  useEffect(() => {
    setImageFailed(false);
  }, [selectedAsset?.id, selectedUrl]);
  if (!slot) return null;
  return (
    <figure className="mt-4 overflow-hidden rounded-ej-lg border border-ej-line bg-ej-surface" data-testid={`lesson-scene-${scene.id}`}>
      {selectedUrl && !imageFailed ? (
        <img
          src={selectedUrl}
          alt={scene.description}
          className="aspect-[16/9] w-full object-cover"
          data-testid={`lesson-scene-image-${scene.id}`}
          onError={() => {
            setImageFailed(true);
            onError("Không thể mở ảnh đã chọn cho cảnh này.");
          }}
        />
      ) : (
        <div className="flex aspect-[16/9] items-center justify-center bg-ej-surface2 px-5 text-center text-xs leading-5 text-ej-muted" data-testid={`lesson-scene-placeholder-${scene.id}`}>
          {selectedAsset ? "Ảnh đã chọn không thể mở trong phiên này." : "Chưa có ảnh được chọn cho cảnh này."}
        </div>
      )}
      <figcaption className="space-y-2 p-4">
        <p className="text-xs leading-5 text-ej-ink2">{scene.description}</p>
        {selectedAsset && <p className="text-xs text-ej-muted">Ảnh thuộc phiên bản hiện tại.</p>}
        <AssetVariants
          slot={slot}
          assets={assets}
          onSelectAsset={onSelectAsset}
          selectingAssetId={selectingAssetId}
          onError={onError}
        />
        {onGenerateImage && (
          <button
            type="button"
            className="mt-3 inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] border border-ej-line bg-ej-warn-soft px-3.5 text-xs font-semibold text-ej-warn transition-colors duration-ej hover:bg-ej-surface2 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={isGenerating}
            data-testid={`lesson-generate-image-${slot.id}`}
            onClick={() => {
              setIsGenerating(true);
              void onGenerateImage(slot.id)
                .catch(() => onError("Không thể tạo lại ảnh cho cảnh này."))
                .finally(() => setIsGenerating(false));
            }}
          >
            {isGenerating ? "Đang tạo ảnh..." : "Tạo lại ảnh cảnh"}
          </button>
        )}
        {!onGenerateImage && !selectedAsset && (
          <p className="mt-3 text-xs leading-5 text-ej-muted">Ảnh sẽ xuất hiện khi engine ảnh đã được kết nối.</p>
        )}
      </figcaption>
    </figure>
  );
}

function SectionAudio({
  section,
  slot,
  assets,
  assetUrl,
  onSelectAsset,
  selectingAssetId,
  onError,
  onGenerateAudio,
}: {
  section: LessonSection;
  slot: BundleSlot | null;
  assets: readonly BundleAsset[];
  assetUrl: (relativePath: string) => string;
  onSelectAsset: (slotId: string, assetId: string) => Promise<void>;
  selectingAssetId: string | null;
  onError: (message: string) => void;
  onGenerateAudio?: (slotId: string) => Promise<void>;
}) {
  const [isGenerating, setIsGenerating] = useState(false);
  if (!slot) return null;
  const selectedAsset = assetForSlot(slot, assets);
  const selectedUrl = selectedAsset ? safeAssetUrl(assetUrl, selectedAsset) : null;
  return (
    <div className="mt-4 rounded-ej border border-ej-line bg-ej-surface p-3" data-testid={`lesson-section-audio-${section.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="ej-label">Nghe đoạn này</p>
        {selectedAsset && <span className="text-[11px] text-ej-muted">Audio của phiên bản hiện tại</span>}
      </div>
      {selectedUrl ? (
        <audio className="mt-2 w-full" controls preload="metadata" src={selectedUrl} data-testid={`lesson-section-audio-player-${section.id}`}>
          Trình duyệt không hỗ trợ phát audio.
        </audio>
      ) : (
        <p className="mt-2 text-xs leading-5 text-ej-muted">Chưa có audio được chọn cho đoạn này.</p>
      )}
      <AssetVariants
        slot={slot}
        assets={assets}
        onSelectAsset={onSelectAsset}
        selectingAssetId={selectingAssetId}
        onError={onError}
      />
      {onGenerateAudio && (
        <button
          type="button"
          className="mt-3 inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] border border-ej-line bg-ej-surface px-3.5 text-xs font-semibold text-ej-ink transition-colors duration-ej hover:bg-ej-surface2 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={isGenerating}
          data-testid={`lesson-generate-audio-${slot.id}`}
          onClick={() => {
            setIsGenerating(true);
            void onGenerateAudio(slot.id)
              .catch(() => onError("Không thể tạo lại audio cho đoạn này."))
              .finally(() => setIsGenerating(false));
          }}
        >
          {isGenerating ? "Đang tạo audio..." : "Tạo lại audio đoạn"}
        </button>
      )}
      {!onGenerateAudio && !selectedAsset && (
        <p className="mt-3 text-xs leading-5 text-ej-muted">Audio là lựa chọn riêng và chưa được tạo cho phiên bản này.</p>
      )}
    </div>
  );
}

function RevisionSelector({
  revisions,
  selectedRevisionId,
  onSelect,
}: {
  revisions: readonly BundleRevision[];
  selectedRevisionId: string | undefined;
  onSelect: (revisionId: string) => void;
}) {
  if (revisions.length <= 1) return null;
  return (
    <label className="flex min-w-[13rem] flex-col gap-1 ej-label">
      Lịch sử phiên bản
      <select
        value={selectedRevisionId ?? ""}
        onChange={(event) => onSelect(event.currentTarget.value)}
        className="h-9 rounded-[10px] border border-ej-line bg-ej-surface px-3 text-xs font-medium normal-case tracking-normal text-ej-ink outline-none transition focus:border-ej-accent focus:ring-1 focus:ring-ej-accent"
        aria-label="Chọn phiên bản bài học"
        data-testid="lesson-revision-select"
      >
        {revisions.map((revision) => (
          <option key={revision.id} value={revision.id}>
            Bản {revision.number} · {revisionStatusLabel(revision)}
          </option>
        ))}
      </select>
    </label>
  );
}

function RevisionWarnings({ revision }: { revision: BundleRevision }) {
  const messages = validationMessages(revision.validation);
  if (messages.length === 0) return null;
  return (
    <aside className="rounded-ej border border-ej-line2 bg-ej-warn-soft px-4 py-3 text-xs text-ej-warn" role="status" data-testid="lesson-validation-warnings">
      <p className="font-semibold">Lưu ý kiểm tra nội dung</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs leading-5">
        {messages.map((message) => <li key={message}>{message}</li>)}
      </ul>
    </aside>
  );
}

function LessonEditor({
  draft,
  onChange,
  onCancel,
  onSave,
  isSaving,
  saveError,
  saveSuccess,
}: {
  draft: EditableDraft;
  onChange: (draft: EditableDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  isSaving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
}) {
  const changeTitle = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...draft, title: event.currentTarget.value });
  };
  const changeSection = (sectionId: string, event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange({
      ...draft,
      sections: draft.sections.map((section) => (
        section.id === sectionId ? { ...section, text: event.currentTarget.value } : section
      )),
    });
  };
  return (
    <form
      className="space-y-4 rounded-ej-lg border border-ej-line bg-ej-surface p-4 shadow-ej"
      data-testid="lesson-editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div>
        <label htmlFor="lesson-editor-title" className="mb-1 block ej-label">Tiêu đề</label>
        <input
          id="lesson-editor-title"
          value={draft.title}
          onChange={changeTitle}
          className="w-full rounded-[10px] border border-ej-line bg-ej-surface px-3 py-2.5 font-literata text-base font-bold text-ej-ink outline-none transition focus:border-ej-accent focus:ring-1 focus:ring-ej-accent"
          data-testid="lesson-editor-title"
        />
      </div>
      <div className="space-y-3">
        {draft.sections.map((section, index) => {
          const id = `lesson-editor-section-${section.id}`;
          return (
            <div key={section.id}>
              <label htmlFor={id} className="mb-1 block ej-label">{sectionLabel(section, index)}</label>
              <textarea
                id={id}
                value={section.text}
                onChange={(event) => changeSection(section.id, event)}
                rows={5}
                className="w-full resize-y rounded-[10px] border border-ej-line bg-ej-surface px-3 py-2 text-xs leading-5 text-ej-ink outline-none transition focus:border-ej-accent focus:ring-1 focus:ring-ej-accent"
                data-testid={`lesson-editor-section-${section.id}`}
              />
            </div>
          );
        })}
      </div>
      <div className="rounded-ej border border-ej-line2 bg-ej-warn-soft px-3 py-2 text-xs leading-5 text-ej-warn" data-testid="lesson-editor-asset-note">
        Lưu thành bản mới sẽ giữ lịch sử hiện tại. Ảnh và audio của bản mới cần được tạo lại nếu bạn sửa nội dung nguồn.
      </div>
      {saveError && <p className="text-xs font-medium text-ej-bad" role="alert" data-testid="lesson-save-error">{saveError}</p>}
      {saveSuccess && <p className="text-xs font-medium text-ej-accent-ink" role="status" data-testid="lesson-save-success">Đã lưu thành bản mới. Tài nguyên của bản mới vẫn cần được tạo riêng.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          className="inline-flex h-9 items-center justify-center rounded-[10px] bg-ej-ink px-3.5 text-xs font-semibold text-ej-bg transition-opacity duration-ej hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={isSaving}
          data-testid="lesson-save-revision"
        >
          {isSaving ? "Đang lưu..." : "Lưu thành bản mới"}
        </button>
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center rounded-[10px] border border-ej-line bg-ej-surface px-3.5 text-xs font-semibold text-ej-ink transition-colors duration-ej hover:bg-ej-surface2 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={isSaving}
          onClick={onCancel}
          data-testid="lesson-cancel-edit"
        >
          Hủy
        </button>
      </div>
    </form>
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Marks every target term inside a section so learners spot them while reading. */
function highlightTargets(text: string, terms: readonly string[]): ReactNode {
  const usable = [...new Set(terms.map((term) => term.trim()).filter((term) => term.length > 1))]
    .sort((left, right) => right.length - left.length);
  if (usable.length === 0) return text;
  const pattern = new RegExp(`(${usable.map(escapeRegExp).join("|")})`, "gi");
  return text.split(pattern).map((chunk, index) => (
    index % 2 === 1
      ? <mark key={index} className="rounded-[4px] bg-ej-hl px-0.5 text-ej-hl-ink">{chunk}</mark>
      : <span key={index}>{chunk}</span>
  ));
}

function StoryPanel({
  draft,
  targets,
  revisionId,
  slots,
  assets,
  assetUrl,
  onSelectAsset,
  selectingAssetId,
  onError,
  onGenerateImage,
  onGenerateAudio,
}: {
  draft: LessonDraft;
  targets: readonly LearningTarget[];
  revisionId: string;
  slots: readonly BundleSlot[];
  assets: readonly BundleAsset[];
  assetUrl: (relativePath: string) => string;
  onSelectAsset: (slotId: string, assetId: string) => Promise<void>;
  selectingAssetId: string | null;
  onError: (message: string) => void;
  onGenerateImage?: (slotId: string) => Promise<void>;
  onGenerateAudio?: (slotId: string) => Promise<void>;
}) {
  return (
    <EjReader className="space-y-4">
      <div className="flex items-center justify-end gap-1.5">
        <span className="ej-label mr-1">Cỡ chữ</span>
        <EjReaderFontSize />
      </div>
      <div className="space-y-4" data-testid="lesson-story-panel">
      {draft.sections.map((section, index) => {
        const scenes = draft.scenes.filter((scene) => scene.sectionIds.includes(section.id));
        const imageSlots = scenes.flatMap((scene) => sourceSlots(slots, revisionId, "scene", scene.id, "image"));
        const audioSlot = sourceSlots(slots, revisionId, "section", section.id, "audio")[0] ?? null;
        const sectionTerms = section.targetIds
          .map((targetId) => targets.find((target) => target.id === targetId)?.term)
          .filter((term): term is string => Boolean(term));
        return (
          <article key={section.id} className="rounded-ej-lg border border-ej-line bg-ej-surface p-5 shadow-ej" data-testid={`lesson-section-${section.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="ej-label">{sectionLabel(section, index)}</p>
              <div className="flex flex-wrap gap-1.5">
                {section.targetIds.map((targetId) => <Pill key={targetId} tone="accent">{targets.find(target => target.id === targetId)?.term ?? "Từ cần học"}</Pill>)}
              </div>
            </div>
            <p className="ej-prose mt-3.5 whitespace-pre-wrap">{highlightTargets(section.text, sectionTerms)}</p>
            {scenes.map((scene) => {
              const slot = imageSlots.find((candidate) => candidate.sourceId === scene.id) ?? null;
              return (
                <SceneAsset
                  key={scene.id}
                  scene={scene}
                  slot={slot}
                  assets={assets}
                  assetUrl={assetUrl}
                  onSelectAsset={onSelectAsset}
                  selectingAssetId={selectingAssetId}
                  onError={onError}
                  onGenerateImage={onGenerateImage}
                />
              );
            })}
            <SectionAudio
              section={section}
              slot={audioSlot}
              assets={assets}
              assetUrl={assetUrl}
              onSelectAsset={onSelectAsset}
              selectingAssetId={selectingAssetId}
              onError={onError}
              onGenerateAudio={onGenerateAudio}
            />
          </article>
        );
      })}
      </div>
    </EjReader>
  );
}

function GlossaryPanel({
  targets,
  glossary,
}: {
  targets: readonly LearningTarget[];
  glossary: readonly LessonGlossaryEntry[];
}) {
  const glossaryByTarget = new Map(glossary.map((entry) => [entry.targetId, entry]));
  const rows: Array<{ target: LearningTarget | undefined; entry: LessonGlossaryEntry | undefined }> = targets.length > 0
    ? targets.map((target) => ({ target, entry: glossaryByTarget.get(target.id) }))
    : glossary.map((entry): { target: LearningTarget | undefined; entry: LessonGlossaryEntry } => ({ target: undefined, entry }));
  if (rows.length === 0) return <EmptyState>Chưa có glossary cho phiên bản này.</EmptyState>;
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]" data-testid="lesson-glossary-panel">
      {rows.map(({ target, entry }, index) => {
        const term = target?.term ?? entry?.targetId ?? `Mục ${index + 1}`;
        const definition = entry?.definition ?? target?.definition ?? "Chưa có giải thích.";
        const translation = entry?.translationVi ?? target?.translationVi ?? "Chưa có bản dịch.";
        const example = entry?.example ?? target?.example ?? "";
        return (
          <article key={target?.id ?? entry?.targetId ?? index} className="rounded-ej-lg border border-ej-line bg-ej-surface p-4 shadow-ej" data-testid={`lesson-glossary-${target?.id ?? entry?.targetId ?? index}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-literata text-lg font-bold text-ej-ink">{term}</h3>
                {target?.sense && <p className="mt-1 ej-label text-ej-warn">{target.sense}</p>}
              </div>
              <EvidenceBadge status={targetEvidence(target)} />
            </div>
            <dl className="mt-3 space-y-3 text-xs leading-5 text-ej-ink2">
              <div><dt className="ej-label">English</dt><dd className="font-literata text-[15px] leading-6 text-ej-ink">{definition}</dd></div>
              <div><dt className="ej-label">Tiếng Việt</dt><dd className="text-ej-accent">{translation}</dd></div>
              {example && <div><dt className="ej-label">Ví dụ</dt><dd className="font-literata text-[15px] italic leading-6 text-ej-ink2">{example}</dd></div>}
            </dl>
          </article>
        );
      })}
    </div>
  );
}

function AssetsPanel({
  draft,
  slots,
  assets,
  assetUrl,
  onSelectAsset,
  selectingAssetId,
  onError,
  onGenerateImage,
  onGenerateAudio,
}: {
  draft: LessonDraft;
  slots: readonly BundleSlot[];
  assets: readonly BundleAsset[];
  assetUrl: (relativePath: string) => string;
  onSelectAsset: (slotId: string, assetId: string) => Promise<void>;
  selectingAssetId: string | null;
  onError: (message: string) => void;
  onGenerateImage?: (slotId: string) => Promise<void>;
  onGenerateAudio?: (slotId: string) => Promise<void>;
}) {
  const sceneById = new Map(draft.scenes.map((scene) => [scene.id, scene]));
  const sectionById = new Map(draft.sections.map((section) => [section.id, section]));
  const imageSlots = slots.filter((slot) => slot.kind === "image" && slot.sourceType === "scene");
  const audioSlots = slots.filter((slot) => slot.kind === "audio" && slot.sourceType === "section");
  if (imageSlots.length === 0 && audioSlots.length === 0) return <EmptyState>Phiên bản này chưa có slot ảnh hoặc audio.</EmptyState>;
  return (
    <div className="space-y-5" data-testid="lesson-assets-panel">
      {imageSlots.length > 0 && (
        <section>
          <h3 className="font-literata text-lg font-bold text-ej-ink">Ảnh minh họa</h3>
          <div className="mt-3 space-y-4">
            {imageSlots.map((slot) => {
              const scene = sceneById.get(slot.sourceId);
              if (!scene) return null;
              return (
                <SceneAsset
                  key={slot.id}
                  scene={scene}
                  slot={slot}
                  assets={assets}
                  assetUrl={assetUrl}
                  onSelectAsset={onSelectAsset}
                  selectingAssetId={selectingAssetId}
                  onError={onError}
                  onGenerateImage={onGenerateImage}
                />
              );
            })}
          </div>
        </section>
      )}
      {audioSlots.length > 0 && (
        <section>
          <h3 className="font-literata text-lg font-bold text-ej-ink">Audio từng đoạn</h3>
          <div className="mt-3 space-y-3">
            {audioSlots.map((slot) => {
              const section = sectionById.get(slot.sourceId);
              if (!section) return null;
              return (
                <SectionAudio
                  key={slot.id}
                  section={section}
                  slot={slot}
                  assets={assets}
                  assetUrl={assetUrl}
                  onSelectAsset={onSelectAsset}
                  selectingAssetId={selectingAssetId}
                  onError={onError}
                  onGenerateAudio={onGenerateAudio}
                />
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

export function LessonReader({
  bundle,
  revisionId,
  onRevisionSelect,
  onSaveRevision,
  assetUrl,
  onSelectAsset,
  onGenerateImage,
  onGenerateAudio,
  className,
}: LessonReaderProps) {
  const revision = getRevision(bundle, revisionId);
  const [selectedTab, setSelectedTab] = useState<LessonReaderTab>("story");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useStableDraft(revision);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [selectingAssetId, setSelectingAssetId] = useState<string | null>(null);
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [audioResetToken, setAudioResetToken] = useState(0);

  useEffect(() => {
    setEditing(false);
    setSaveError(null);
    setSaveSuccess(false);
    setInteractionError(null);
  }, [revision?.id]);

  const revisionSlots = useMemo(() => {
    if (!revision) return [];
    return (bundle?.slots ?? []).filter((slot) => slot.lessonRevisionId === revision.id);
  }, [bundle?.slots, revision]);

  const revisionAssets = useMemo(() => {
    const slotIds = new Set(revisionSlots.map((slot) => slot.id));
    return (bundle?.assets ?? []).filter((asset) => slotIds.has(asset.slotId));
  }, [bundle?.assets, revisionSlots]);

  const saveDraft = useCallback(() => {
    if (!draft || isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    void Promise.resolve()
      .then(() => onSaveRevision(cloneDraft(draft)))
      .then(() => {
        setSaveSuccess(true);
        setEditing(false);
      })
      .catch((error: unknown) => {
        setSaveError(error instanceof Error && error.message ? error.message : "Không thể lưu bản mới.");
      })
      .finally(() => setIsSaving(false));
  }, [draft, isSaving, onSaveRevision]);

  const selectAsset = useCallback(async (slotId: string, assetId: string) => {
    setSelectingAssetId(assetId);
    setInteractionError(null);
    setAudioResetToken((value) => value + 1);
    try {
      await onSelectAsset(slotId, assetId);
    } catch (error: unknown) {
      setInteractionError(error instanceof Error && error.message ? error.message : "Không thể chọn biến thể.");
      throw error;
    } finally {
      setSelectingAssetId(null);
    }
  }, [onSelectAsset]);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = TAB_ORDER.indexOf(selectedTab);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % TAB_ORDER.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = TAB_ORDER.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = TAB_ORDER[nextIndex];
    setSelectedTab(nextTab);
    document.getElementById(tabButtonId(nextTab))?.focus();
  };

  if (!bundle) {
    return <div className={className}><EmptyState>Chưa có dữ liệu bài học để mở. Hãy tạo hoặc chọn một bài học local.</EmptyState></div>;
  }
  if (!revision) {
    return (
      <div className={className} data-testid="lesson-reader">
        <EmptyState>Bài học này chưa có phiên bản. Nội dung sẽ xuất hiện sau khi quá trình tạo hoàn tất.</EmptyState>
      </div>
    );
  }

  const content = asLessonDraft(revision.content);
  const targets = asTargets(revision.brief);
  const glossary = asGlossary(content?.glossary);
  const title = content?.title ?? bundle.lesson.title ?? "Bài học chưa có tiêu đề";
  const isDraftWithoutContent = revision.status === "draft" && !content;
  const active = bundle.lesson.activeRevisionId === revision.id;

  return (
    <main className={`w-full space-y-4 ${className ?? ""}`} data-testid="lesson-reader">
      <header className="space-y-4 rounded-ej-lg border border-ej-line bg-ej-surface p-5 shadow-ej">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="ej-label text-ej-accent">Xưởng bài học · Bản {revision.number}</p>
            <h1 className="mt-1.5 break-words font-literata text-2xl font-bold tracking-[-0.02em] text-ej-ink" tabIndex={-1} data-testid="lesson-reader-heading">{title}</h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-ej-muted">
              <Pill tone={revision.status === "ready" ? "ok" : "muted"}>{revisionStatusLabel(revision)}</Pill>
              {active && <Pill tone="accent">Đang học</Pill>}
              {dateLabel(revision.createdAt) && <span className="ej-tabular">{dateLabel(revision.createdAt)}</span>}
            </div>
          </div>
          <RevisionSelector
            revisions={bundle.revisions}
            selectedRevisionId={revision.id}
            onSelect={onRevisionSelect}
          />
        </div>
        <RevisionWarnings revision={revision} />
        {interactionError && <p className="text-xs text-ej-bad" role="alert" data-testid="lesson-interaction-error">{interactionError}</p>}
        {saveSuccess && <p className="rounded-ej border border-ej-line2 bg-ej-warn-soft px-4 py-3 text-xs leading-5 text-ej-warn" role="status" data-testid="lesson-revision-asset-note">Đã lưu thành bản mới. Ảnh và audio của bản mới cần được tạo riêng.</p>}
        {isDraftWithoutContent ? (
          <div className="rounded-ej border border-dashed border-ej-line bg-ej-surface2 px-4 py-5 text-xs leading-5 text-ej-muted" data-testid="lesson-draft-status">
            <p className="font-semibold text-ej-ink2">Bản nháp đang chờ nội dung</p>
            <p className="mt-1">Nội dung có thể chưa được commit hoặc đang được tạo. Các bản đã lưu trước đó vẫn giữ nguyên.</p>
          </div>
        ) : content ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-xs leading-5 text-ej-muted">Đọc câu chuyện, khám phá từ vựng rồi thử kể lại bằng lời của bạn.</p>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-[10px] border border-ej-line bg-ej-surface px-3.5 text-xs font-semibold text-ej-ink transition-colors duration-ej hover:bg-ej-surface2"
              onClick={() => { setEditing((value) => !value); setSaveError(null); setSaveSuccess(false); }}
              aria-expanded={editing}
              data-testid="lesson-toggle-editor"
            >
              {editing ? "Đóng chỉnh sửa" : "Sửa bài"}
            </button>
          </div>
        ) : (
          <div className="rounded-ej border border-dashed border-ej-line bg-ej-surface2 px-4 py-5 text-xs leading-5 text-ej-muted" data-testid="lesson-content-unavailable">
            Nội dung của phiên bản này chưa có định dạng đọc được. Hãy chọn một phiên bản khác hoặc tạo lại phần nội dung.
          </div>
        )}
      </header>

      {editing && draft && (
        <LessonEditor
          draft={draft}
          onChange={(nextDraft) => { setDraft(nextDraft); setSaveSuccess(false); }}
          onCancel={() => {
            setDraft(content ? cloneDraft(content) : null);
            setEditing(false);
            setSaveError(null);
            setSaveSuccess(false);
          }}
          onSave={saveDraft}
          isSaving={isSaving}
          saveError={saveError}
          saveSuccess={saveSuccess}
        />
      )}

      {content && (
        <section className="space-y-4" aria-label="Nội dung bài học">
          <LessonAudioPlayer
            sections={content.sections}
            revisionId={revision.id}
            slots={revisionSlots}
            assets={revisionAssets}
            assetUrl={assetUrl}
            scopeKey={`${bundle.lesson.profileId}:${bundle.lesson.id}:${revision.id}`}
            resetToken={audioResetToken}
          />
          <div role="tablist" aria-label="Các phần của bài học" className="inline-flex gap-1 overflow-x-auto rounded-[10px] border border-ej-line bg-ej-surface2 p-1">
            {TAB_ORDER.map((tab) => (
              <button
                key={tab}
                id={tabButtonId(tab)}
                type="button"
                role="tab"
                aria-selected={selectedTab === tab}
                aria-controls={tabPanelId(tab)}
                tabIndex={selectedTab === tab ? 0 : -1}
                className={`h-8 shrink-0 rounded-[8px] px-3.5 text-xs font-semibold transition-colors duration-ej focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ej-accent ${selectedTab === tab ? "bg-ej-surface text-ej-ink shadow-ej" : "text-ej-muted hover:text-ej-ink"}`}
                onClick={() => setSelectedTab(tab)}
                onKeyDown={handleTabKeyDown}
                data-testid={`lesson-tab-${tab}`}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>
          <div
            id={tabPanelId(selectedTab)}
            role="tabpanel"
            aria-labelledby={tabButtonId(selectedTab)}
            tabIndex={0}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ej-accent"
            data-testid={`lesson-tabpanel-${selectedTab}`}
          >
            {selectedTab === "story" && (
              <StoryPanel
                draft={content}
                targets={targets}
                revisionId={revision.id}
                slots={revisionSlots}
                assets={revisionAssets}
                assetUrl={assetUrl}
                onSelectAsset={selectAsset}
                selectingAssetId={selectingAssetId}
                onError={setInteractionError}
                onGenerateImage={onGenerateImage}
                onGenerateAudio={onGenerateAudio}
              />
            )}
            {selectedTab === "glossary" && <GlossaryPanel targets={targets} glossary={glossary} />}
            {selectedTab === "assets" && (
              <AssetsPanel
                draft={content}
                slots={revisionSlots}
                assets={revisionAssets}
                assetUrl={assetUrl}
                onSelectAsset={selectAsset}
                selectingAssetId={selectingAssetId}
                onError={setInteractionError}
                onGenerateImage={onGenerateImage}
                onGenerateAudio={onGenerateAudio}
              />
            )}
          </div>
        </section>
      )}
    </main>
  );
}

export default LessonReader;
