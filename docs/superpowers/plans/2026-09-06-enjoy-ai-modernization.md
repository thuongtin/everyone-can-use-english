# Kế hoạch hiện đại hóa AI cho Enjoy

> Dành cho agent thực thi: dùng quy trình subagent-driven-development; Luna max thực thi, reviewer độc lập đối chiếu snapshot trước thay đổi.

**Mục tiêu:** Kết nối các provider/model hiện tại vào hội thoại và tác vụ học Anh-Việt, giữ cấu hình đã lưu và nghiệm thu ở bản đóng gói.

**Kiến trúc:** Giữ LangChain memory/chains. Tạo catalog provider thuần dữ liệu, resolver cấu hình theo provider và factory model dùng chung cho commands/hội thoại. OpenAI Responses chỉ dùng ở endpoint hỗ trợ; JSON được kiểm tra bằng schema ở ứng dụng.

**Công nghệ:** Electron 34, React 18, TypeScript 5.8, Zod 3, LangChain core 0.3.42, @langchain/openai 0.4.6, OpenAI SDK 4.87.3; adapter đã được đối chiếu peer dependencies. Không chuyển major toàn bộ framework.

**Thiết kế:** [.superpowers design](../../../.superpowers/sdd/2026-09-06-enjoy-ai-modernization/design.md).

## Ràng buộc chung

- Giữ thay đổi Việt hóa chưa commit và profile GitHub/thư viện hiện có. Không stage, commit, reset, clean hoặc publish.
- Dùng tiếng Việt có dấu trong UI/report. Tên code/file/log tiếng Anh. Không tạo ký tự U+2014.
- Snapshot trước thay đổi: `.superpowers/sdd/2026-09-06-enjoy-ai-modernization/baseline/`, 506 file đã kiểm tra hash.
- Node 24: `/opt/homebrew/opt/node@24/bin/node`; Yarn 4.6 qua `.yarn/releases/yarn-4.6.0.cjs`.
- Không API trả phí, key thật hoặc tải model nặng. Mock PASS không là provider live PASS.

## Task 1: Catalog, cấu hình riêng và giao diện chọn provider

**Ownership:** `enjoy/src/lib/ai-providers.ts` mới; `src/types/index.d.ts`, `src/types/enums.ts`; `renderer/context/ai-settings-provider.tsx`; `renderer/components/preferences/{openai-settings,default-engine-settings,preferences}.tsx`; `renderer/components/conversations/gpt-providers.tsx`, `renderer/components/conversations/conversation-form/{index,conversation-form-gpt}.tsx`, `renderer/components/misc/gpt-form.tsx`, `renderer/pages/conversations.tsx`; các key mới trong `i18n/{en,vi,es}.json`; `scripts/check-ai-providers.mjs`.

**Hợp đồng với Task 2:** context có `getProviderConfig(name: string): LlmProviderType`, trả bản sao gồm `{ name, key, baseUrl, models }`. `currentGptEngine` giữ dạng `{name,models:{default,lookup,translate,analyze,extractStory},key,baseUrl}`. Thêm `providerConfigs: Record<string,LlmProviderType>` và `setProviderConfig(name:string,config:LlmProviderType):Promise<void>`. `openai` và `setOpenai` vẫn hoạt động cho STT/TTS cũ. Provider IDs: `enjoyai`, `openai`, `gemini`, `deepseek`, `openrouter`, `ollama`, `lmstudio`.

- [x] Tạo registry và helper normalize danh sách model: trim, bỏ rỗng, dedup; giữ model đã lưu khi catalog đổi.
- [x] Cấu hình riêng từng provider, xử lý OpenAI cũ mà không sao key sang provider khác. Lưu phải await và giữ form khi lỗi. Metadata remote chỉ ảnh hưởng EnjoyAI; không Object.assign vào singleton hoặc ghi đè endpoint BYOK.
- [x] UI chọn provider, key, endpoint, models. Giữ cấu hình OpenAI cho speech. Thay provider trong form reset model theo provider mới, không tự chuyển người dùng khi tải settings.
- [x] Resolver cho Ollama/LM Studio cho phép không có key. Discovery có timeout và kiểm tra response shape; lỗi không làm mất catalog/custom models đã có.
- [x] Kiểm tra helper thực: model rỗng/trùng, key isolation, malformed remote, saved model preservation; kiểm tra form/default engine và các key ngôn ngữ.

## Task 2: Factory runtime, commands và hội thoại

**Ownership:** `enjoy/src/lib/chat-model.ts` và helper request policy mới nếu cần; `enjoy/src/commands/*.ts` trong phạm vi options/factory/schema; `renderer/hooks/{use-ai-command,use-conversation,use-chat-session}.tsx`; `scripts/check-ai-runtime.mjs`. Root giữ ownership package/lock để install tuần tự.

**Hợp đồng:**

```ts
type ChatModelOptions = {
  provider?: string;
  key?: string;
  baseUrl?: string;
  modelName?: string;
  temperature?: number;
  maxTokens?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  numberOfChoices?: number;
};
// Factory trả model tương thích LangChain hiện tại.
export function createChatModel(options: ChatModelOptions): ChatOpenAI | ChatOllama;
```

- [x] Viết regression với mock fetch cho Chat Completions/Responses/Ollama, không network thật. Bắt body và Authorization chỉ bằng key giả.
- [x] OpenAI trực tiếp model GPT-5/GPT-6 dùng Responses khi adapter có hỗ trợ; giữ Chat Completions cho EnjoyAI và endpoint tương thích. Bỏ sampling params không hợp lệ, chọn reasoning theo hợp đồng model; giới hạn output token đúng field. Không suy model từ key.
- [x] Commands nhận optional `provider`; `useAiCommand` truyền tên provider hiện tại. Text command dùng systemPrompt khi có. JSON command giữ model được chọn, không silent fallback, yêu cầu JSON rồi `schema.parse` dữ liệu trước khi trả.
- [x] Hai luồng hội thoại gọi factory qua `getProviderConfig`; giữ lịch sử và usage; kiểm tra khả năng stream của adapter, không gọi UI hiện tại là streaming. Ollama dùng được trong group chat/default commands. Không tạo tool executor hoặc hosted tools mới vì source hiện tại không yêu cầu.
- [x] Test text, stream, invalid schema, incomplete/refusal/error và request params của OpenAI/Gemini/DeepSeek/OpenRouter/local. Không ghi raw prompt/key vào verbose logs. TypeScript và targeted lint.

## Task 3: Speech theo kết quả nghiên cứu

- [x] Chốt STT timestamp/TTS codec từ `/tmp/enjoy-ai-research-speech.json` trước khi sửa. Ghi quyết định vào design và task appendix với file ownership cụ thể.
- [x] TTS model mới chỉ dùng đúng speech endpoint, voice và input limit; giữ model đã lưu. STT hiện đại chỉ thêm khi chuyển được mốc từ thật sang transcript Enjoy.
- [x] Mock response normalization; không tự gọi mic/provider trả phí. Realtime session là phạm vi riêng trong roadmap khi có yêu cầu và tiêu chí latency/cost cụ thể.

## Task 4: Nghiên cứu, review và bản đóng gói

- [x] Gộp các ledger OpenAI/chat/speech/local, dedup URL, ghi failed attempts và phân biệt số tài liệu với số nguồn độc lập. Full report, summary và validator exit 0.
- [x] Review độc lập task diff so snapshot; sửa finding trước khi chạy lại kiểm tra bị ảnh hưởng.
- [x] Root chạy TypeScript, localization và regression AI, rồi build candidate ở thư mục tạm với anchored excludes. Không relink dependency trong lúc agent chạy tests.
- [x] Kiểm tra app.asar/native/SQLite bằng verifier hiện có. Chạy smoke E2E và mở UI trong QA profile, xác minh các provider/model hiện đúng và cấu hình giả lưu/đổi riêng biệt trong profile cô lập.
- [x] Chỉ thay artifact được giao sau khi candidate đạt kiểm tra. Giữ backup/profile; báo rõ những provider chưa gọi thật, không gọi kết quả nghiên cứu là chất lượng học đã được chứng minh.

## Task 2b: Giữ provider khi chuyển hội thoại cũ

**Ownership:** `enjoy/src/types/conversation.d.ts`, `main/db/models/conversation.ts`, `main/db/models/chat.ts`, helper `src/lib/conversation-migration.ts` và `scripts/check-ai-migration.mjs` nếu cần.

- [x] Cho phép đọc/lưu các provider mới và historical engine string phù hợp cột STRING đã có.
- [x] Khi migrateToChat, giữ engine/model nonempty, kể cả provider chưa hỗ trợ để runtime báo rõ. Không tự đổi sang provider có key khác.
- [x] Chỉ dùng default khi giá trị thật sự thiếu. Ghi `sttEngine` đúng key, hỗ trợ đọc key `stt` legacy nếu cần. Không cập nhật dữ liệu người dùng trong kiểm thử.
- [x] Kiểm tra fixture migration từng provider, unknown engine và empty default, không ghi key vào member config.

## Phụ lục Task 3 đã chốt: TTS

**Ownership:** `enjoy/src/renderer/hooks/{use-speech,use-transcribe}.tsx`, `main/db/models/speech.ts`, `renderer/components/conversations/tts-providers.tsx`, `renderer/components/preferences/stt-settings.tsx`, helper `src/lib/speech-models.ts`, `scripts/check-ai-speech.mjs`. Task 1 giữ types/i18n/context.

- [x] Thêm `gpt-4o-mini-tts` cho direct OpenAI. Giữ sáu voice chung hiện có để không đưa voice mới vào model tts-1 cũ.
- [x] Dispatch đúng model mới, normalize prefix và mp3 format, từ chối model/voice rỗng hoặc không hỗ trợ trước khi tạo file.
- [x] Main Speech.generate đọc canonical UserSetting OpenAI; legacy fallback chỉ khi setting chưa có, không khi người dùng đã xóa key.
- [x] STT setting dùng `openai.transcriptionModel?:string`, giữ whisper-1 khi config cũ không có field. Quyết định gpt-transcribe chỉ áp sau khi đọc đúng file API, không suy từ realtime.
- [x] Giữ bước DTW alignment thật đang có cho transcript không chứa segments; không giả mốc thời gian và không suy điểm phát âm từ transcript.
