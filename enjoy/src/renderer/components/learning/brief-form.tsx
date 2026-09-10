import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CEFR_LEVELS,
  LessonBriefSchema,
  MAX_LESSON_TARGETS,
  RawBriefInputSchema,
} from "../../../lib/learning-schemas";
import type { LessonBrief, LearningTarget, RawBriefInput } from "../../../types/learning";
import type { LearningNativeCapability } from "../../../types/learning-api";
import { CheckIcon, PlusIcon, SparklesIcon, SquareIcon, Trash2Icon } from "lucide-react";
import { Pill } from "@renderer/components/enjoy";

type Provider = LearningNativeCapability["provider"];
type TargetField = "term" | "sense" | "definition" | "translationVi" | "example";
type TargetEntry = Pick<LearningTarget, "id" | TargetField | "evidence"> & { origin: "ai" | "manual" };

type BriefFormProps = {
  onSave: (brief: LessonBrief) => Promise<void>;
  onCancel: () => void;
  onSuggest?: (input: RawBriefInput, provider: Provider, signal: AbortSignal) => Promise<LessonBrief>;
  capabilities?: LearningNativeCapability[];
  preferredProvider?: Provider;
};

const controlStyle = "inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-[10px] text-xs font-semibold whitespace-nowrap transition-colors duration-ej disabled:opacity-40 disabled:cursor-not-allowed";
const inputStyle = "mt-1.5 block w-full rounded-[10px] border border-ej-line bg-ej-surface px-3 py-2 text-xs text-ej-ink outline-none transition-colors duration-ej placeholder:text-ej-muted focus:border-ej-accent disabled:opacity-40";
const secondaryButtonStyle = `${controlStyle} border border-ej-line bg-ej-surface text-ej-ink hover:bg-ej-surface2`;
const primaryButtonStyle = `${controlStyle} bg-ej-ink text-ej-bg hover:opacity-90`;
const removeButtonStyle = `${controlStyle} text-ej-muted hover:bg-ej-bad-soft hover:text-ej-bad`;
const LEARNING_PROVIDERS = ["codex", "claude", "azure-openai"] as const satisfies readonly Provider[];
const providerName = (provider: Provider) => provider === "codex"
  ? "Codex"
  : provider === "claude" ? "Claude ACP" : "Azure OpenAI";
const parseKeywords = (value: string) => value.split(/[\n,]+/u).map(keyword => keyword.trim()).filter(Boolean);

const targetFields = [
  ["term", "Từ hoặc cụm từ", 80, ""],
  ["sense", "Nghĩa muốn học", 500, "Phân biệt nếu từ có nhiều nghĩa"],
  ["definition", "Giải thích bằng tiếng Anh", 600, ""],
  ["translationVi", "Nghĩa tiếng Việt", 600, ""],
  ["example", "Câu ví dụ tiếng Anh", 600, ""],
] as const satisfies ReadonlyArray<readonly [TargetField, string, number, string]>;

export function BriefForm({ onSave, onCancel, onSuggest, capabilities, preferredProvider }: BriefFormProps) {
  const [topic, setTopic] = useState("");
  const [keywordText, setKeywordText] = useState("");
  const [level, setLevel] = useState<LessonBrief["level"]>("A2");
  const [length, setLength] = useState<LessonBrief["length"]>("medium");
  const [imageCount, setImageCount] = useState(0);
  const [audio, setAudio] = useState(false);
  const [provider, setProvider] = useState<Provider>(() => (
    capabilities?.find(capability => capability.provider === preferredProvider && capability.text)?.provider
    ?? capabilities?.find(capability => capability.text)?.provider
    ?? "codex"
  ));
  const [targets, setTargets] = useState<TargetEntry[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const suggestionController = useRef<AbortController | null>(null);
  const suggestionSequence = useRef(0);
  const manualTargetSequence = useRef(0);
  const providerTouched = useRef(false);

  const providerCapability = capabilities?.find(capability => capability.provider === provider);
  const availableProvider = capabilities?.find(capability => capability.text);
  const canSuggest = Boolean(onSuggest && providerCapability?.text);

  useEffect(() => {
    if (!providerTouched.current) {
      const preferred = capabilities?.find(capability => capability.provider === preferredProvider && capability.text);
      if (preferred) {
        setProvider(preferred.provider);
        return;
      }
    }
    if (!providerCapability?.text && availableProvider) setProvider(availableProvider.provider);
  }, [availableProvider, capabilities, preferredProvider, providerCapability?.text]);

  useEffect(() => () => {
    suggestionSequence.current += 1;
    suggestionController.current?.abort();
  }, []);

  const createRawInput = (deriveFromTargets = false): RawBriefInput | null => {
    const enteredKeywords = parseKeywords(keywordText);
    const keywords = deriveFromTargets && !topic.trim() && enteredKeywords.length === 0
      ? targets.map(target => target.term.trim()).filter(Boolean)
      : enteredKeywords;
    const parsed = RawBriefInputSchema.safeParse({ topic: topic.trim() || undefined, keywords, level, length, imageCount, audio });
    if (!parsed.success) {
      setError(keywords.length > MAX_LESSON_TARGETS
        ? `Chỉ dùng tối đa ${MAX_LESSON_TARGETS} từ hoặc cụm từ.`
        : "Hãy nhập một chủ đề hoặc ít nhất một từ hay cụm từ. Mỗi mục dài tối đa 80 ký tự.");
      return null;
    }
    return parsed.data;
  };

  const suggest = async () => {
    const input = createRawInput();
    if (!input || !onSuggest || !providerCapability?.text) return;
    suggestionController.current?.abort();
    const controller = new AbortController();
    suggestionController.current = controller;
    const sequence = suggestionSequence.current + 1;
    suggestionSequence.current = sequence;
    setSuggesting(true);
    setError("");
    try {
      const result = await onSuggest(input, provider, controller.signal);
      if (controller.signal.aborted || suggestionSequence.current !== sequence) return;
      const parsed = LessonBriefSchema.safeParse({
        ...result,
        targets: result.targets.map(target => ({ ...target, evidence: { status: "unverified" } })),
      });
      if (!parsed.success) {
        setError("AI đã trả về gợi ý chưa đúng định dạng. Hãy thử lại hoặc nhập mục học thủ công.");
        return;
      }
      setTargets(parsed.data.targets.map(target => ({ ...target, origin: "ai" })));
    } catch (cause) {
      if (controller.signal.aborted || suggestionSequence.current !== sequence) return;
      setError(cause instanceof Error && cause.message.trim()
        ? `Chưa tạo được gợi ý: ${cause.message}`
        : "Chưa tạo được gợi ý. Nội dung bạn đã nhập vẫn được giữ nguyên.");
    } finally {
      if (suggestionSequence.current === sequence) {
        setSuggesting(false);
        suggestionController.current = null;
      }
    }
  };

  const stopSuggestion = () => {
    suggestionSequence.current += 1;
    suggestionController.current?.abort();
    suggestionController.current = null;
    setSuggesting(false);
  };

  const changeTarget = (index: number, field: TargetField, value: string) => {
    setTargets(current => current.map((target, targetIndex) => targetIndex === index
      ? { ...target, [field]: value, evidence: { status: "user" } }
      : target));
  };

  const confirmTarget = (index: number) => {
    setTargets(current => current.map((target, targetIndex) => targetIndex === index
      ? { ...target, evidence: { status: "user" } }
      : target));
  };

  const addManualTarget = () => {
    if (targets.length >= MAX_LESSON_TARGETS) return;
    manualTargetSequence.current += 1;
    setTargets(current => [...current, {
      id: `manual-${manualTargetSequence.current}`,
      term: "",
      sense: "",
      definition: "",
      translationVi: "",
      example: "",
      evidence: { status: "user" },
      origin: "manual",
    }]);
    setError("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || suggesting) return;
    const input = createRawInput(true);
    if (!input) return;
    const brief = LessonBriefSchema.safeParse({
      ...input,
      targets: targets.map(target => ({
        id: target.id,
        term: target.term.trim(),
        sense: target.sense.trim(),
        definition: target.definition.trim(),
        translationVi: target.translationVi.trim(),
        example: target.example.trim(),
        evidence: target.evidence,
      })),
    });
    if (!brief.success) {
      setError("Hãy xem lại và điền đủ từ, nghĩa muốn học, giải thích cùng câu ví dụ cho từng mục.");
      return;
    }
    const uniqueMeanings = new Set(brief.data.targets.map(target => `${target.term.toLowerCase()}\0${target.sense.toLowerCase()}`));
    if (uniqueMeanings.size !== brief.data.targets.length) {
      setError("Một từ cùng nghĩa đang xuất hiện hai lần. Hãy bỏ mục bị trùng.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(brief.data);
    } catch {
      setError("Chưa lưu được bản nháp. Dữ liệu bạn nhập vẫn được giữ ở đây.");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    stopSuggestion();
    onCancel();
  };

  const unavailableMessage = !onSuggest
    ? "Ứng dụng chưa nối chức năng gợi ý AI cho màn hình này. Bạn vẫn có thể nhập mục học thủ công."
    : !capabilities?.length
      ? "Chưa có thông tin kết nối dịch vụ AI. Hãy kiểm tra kết nối rồi thử lại."
      : !availableProvider
        ? "Chưa có dịch vụ AI tạo nội dung sẵn sàng. Hãy kiểm tra kết nối rồi thử lại."
        : providerCapability && !providerCapability.text
          ? `${providerName(provider)} chưa sẵn sàng. Hãy kiểm tra kết nối rồi thử lại.`
          : "";

  return <form onSubmit={submit} className="space-y-6 rounded-ej border border-ej-line bg-ej-surface p-5 sm:p-6" aria-label="Tạo bản nháp bài học">
    <div>
      <h2 className="text-base font-bold text-ej-ink">Bạn muốn học gì?</h2>
      <p className="mt-1 text-xs leading-relaxed text-ej-muted">Chọn trình độ rồi nhập một chủ đề hoặc vài từ, cụm từ. AI sẽ gợi ý nghĩa, giải thích và câu ví dụ để bạn xem lại.</p>
    </div>

    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block"><span className="ej-label">Chủ đề <span className="normal-case tracking-normal">(tuỳ chọn)</span></span><input className={inputStyle} value={topic} onChange={event => setTopic(event.target.value)} disabled={suggesting || saving} maxLength={500} placeholder="Ví dụ: Gọi món ở quán cà phê" /></label>
      <label className="block"><span className="ej-label">Từ hoặc cụm từ <span className="normal-case tracking-normal">(tuỳ chọn)</span></span><textarea className={`${inputStyle} min-h-20 resize-y leading-6`} value={keywordText} onChange={event => setKeywordText(event.target.value)} disabled={suggesting || saving} maxLength={1100} placeholder={"Ví dụ: order coffee, takeaway\nreceipt"} aria-describedby="keyword-help" /><span id="keyword-help" className="mt-1.5 block text-xxs leading-relaxed text-ej-muted">Phân cách bằng dấu phẩy hoặc xuống dòng, tối đa {MAX_LESSON_TARGETS} mục. Cụm từ được giữ nguyên khoảng trắng bên trong.</span></label>
    </div>

    <label className="block max-w-xs"><span className="ej-label">Trình độ</span><select className={inputStyle} value={level} onChange={event => setLevel(event.target.value as LessonBrief["level"])} disabled={suggesting || saving}>{CEFR_LEVELS.map(value => <option key={value}>{value}</option>)}</select></label>

    <details className="rounded-ej border border-ej-line bg-ej-surface2 px-3.5 py-3">
      <summary className="cursor-pointer text-xs font-semibold text-ej-ink">Tuỳ chọn nâng cao</summary>
      <div className="mt-3.5 grid gap-4 sm:grid-cols-2">
        <label className="block"><span className="ej-label">Độ dài</span><select className={inputStyle} value={length} onChange={event => setLength(event.target.value as LessonBrief["length"])} disabled={suggesting || saving}><option value="short">Ngắn</option><option value="medium">Vừa</option><option value="long">Dài</option></select></label>
        <label className="block"><span className="ej-label">Số hình minh hoạ</span><select className={inputStyle} value={imageCount} onChange={event => setImageCount(Number(event.target.value))} disabled={suggesting || saving}>{[0, 1, 2, 3, 4].map(value => <option key={value} value={value}>{value === 0 ? "Không tạo ảnh" : `${value} hình`}</option>)}</select></label>
      </div>
      <label className="mt-3.5 flex items-center gap-2 text-xs text-ej-ink"><input type="checkbox" className="accent-ej-accent" checked={audio} onChange={event => setAudio(event.target.checked)} disabled={suggesting || saving} /> Tạo giọng đọc cho bài học</label>
    </details>

    <section className="space-y-3 rounded-ej border border-ej-line bg-ej-surface2 p-4" aria-labelledby="ai-suggestion-heading">
      <div>
        <h3 id="ai-suggestion-heading" className="text-[13px] font-semibold text-ej-ink">Gợi ý bằng AI</h3>
        <p className="mt-1 text-xs leading-relaxed text-ej-muted">Chọn dịch vụ AI đang có trên máy. Gợi ý được đánh dấu chưa xác minh cho đến khi bạn sửa hoặc xác nhận.</p>
      </div>

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Dịch vụ AI dùng để gợi ý">{LEARNING_PROVIDERS.map(value => {
        const capability = capabilities?.find(item => item.provider === value);
        return <label key={value} className={`flex h-9 items-center gap-2 rounded-[10px] border px-3 text-xs font-medium transition-colors duration-ej ${!capability?.text ? "cursor-not-allowed border-ej-line bg-ej-surface opacity-50" : provider === value ? "cursor-pointer border-ej-accent bg-ej-accent-soft text-ej-accent-ink" : "cursor-pointer border-ej-line bg-ej-surface text-ej-ink2 hover:bg-ej-surface"}`}><input type="radio" className="accent-ej-accent" name="brief-provider" value={value} checked={provider === value} disabled={!capability?.text || suggesting || saving} onChange={() => { providerTouched.current = true; setProvider(value); }} />{providerName(value)}</label>;
      })}</div>

      {suggesting
        ? <button type="button" className={secondaryButtonStyle} onClick={stopSuggestion}><SquareIcon className="size-3" /> Dừng gợi ý</button>
        : <button type="button" className={primaryButtonStyle} disabled={!canSuggest || saving} onClick={() => void suggest()}><SparklesIcon className="size-3.5" /> {targets.some(target => target.origin === "ai") ? "Gợi ý lại" : "Gợi ý mục học"}</button>}

      {unavailableMessage && <p className="text-xs leading-relaxed text-ej-muted">{unavailableMessage}</p>}
    </section>

    {targets.length > 0 && <section className="space-y-2.5" aria-labelledby="target-review-heading">
      <div>
        <h3 id="target-review-heading" className="text-[13px] font-semibold text-ej-ink">Xem lại mục học <span className="ej-tabular text-ej-muted">({targets.length}/{MAX_LESSON_TARGETS})</span></h3>
        <p className="mt-1 text-xs text-ej-muted">Mở từng mục để chỉnh chi tiết trước khi lưu.</p>
      </div>
      {targets.map((target, index) => {
        const verified = target.evidence?.status === "user";
        const fields = <div className="grid gap-3 sm:grid-cols-2">{targetFields.map(([field, label, maxLength, placeholder]) => <label key={field} className={`block ${field === "example" ? "sm:col-span-2" : ""}`}><span className="ej-label">{label}</span><input required maxLength={maxLength} className={inputStyle} value={target[field]} onChange={event => changeTarget(index, field, event.target.value)} placeholder={placeholder} disabled={suggesting || saving} /></label>)}</div>;
        return target.origin === "manual"
          ? <fieldset key={target.id} className="rounded-ej border border-ej-line bg-ej-surface p-4"><legend className="px-1.5 text-xs font-semibold text-ej-ink">Mục nhập tay {index + 1}</legend>{fields}<button type="button" className={`${removeButtonStyle} mt-3`} disabled={suggesting || saving} onClick={() => setTargets(current => current.filter((_, targetIndex) => targetIndex !== index))}><Trash2Icon className="size-3.5" /> Bỏ mục này</button></fieldset>
          : <details key={target.id} className="rounded-ej border border-ej-line bg-ej-surface p-4">
            <summary className="cursor-pointer list-none">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-literata text-sm font-semibold text-ej-ink">{target.term}</span>
                <Pill tone={verified ? "ok" : "warn"}>{verified ? "Bạn đã xác nhận" : "AI gợi ý, chưa xác minh"}</Pill>
              </span>
              <span className="mt-1 block text-xs text-ej-muted">{target.translationVi}</span>
            </summary>
            <div className="mt-3.5">
              {fields}
              <div className="mt-3 flex flex-wrap gap-2">
                {!verified && <button type="button" className={secondaryButtonStyle} disabled={suggesting || saving} onClick={() => confirmTarget(index)}><CheckIcon className="size-3.5" /> Xác nhận nội dung này</button>}
                <button type="button" className={removeButtonStyle} disabled={suggesting || saving} onClick={() => setTargets(current => current.filter((_, targetIndex) => targetIndex !== index))}><Trash2Icon className="size-3.5" /> Bỏ mục này</button>
              </div>
            </div>
          </details>;
      })}
    </section>}

    <button type="button" className={secondaryButtonStyle} disabled={targets.length >= MAX_LESSON_TARGETS || suggesting || saving} onClick={addManualTarget}><PlusIcon className="size-3.5" /> Thêm mục học thủ công <span className="ej-tabular">({targets.length}/{MAX_LESSON_TARGETS})</span></button>

    {error && <p role="alert" className="rounded-ej bg-ej-bad-soft px-3.5 py-2.5 text-xs text-ej-bad">{error}</p>}

    <div className="flex flex-wrap gap-2.5">
      <button type="submit" disabled={saving || suggesting} className={primaryButtonStyle}>{saving ? "Đang lưu…" : "Lưu bản nháp"}</button>
      <button type="button" disabled={saving} onClick={cancel} className={secondaryButtonStyle}>Quay lại</button>
    </div>
  </form>;
}
