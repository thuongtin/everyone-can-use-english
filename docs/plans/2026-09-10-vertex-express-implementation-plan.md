# Triển khai Vertex Express trong Enjoy

**Mục tiêu:** Dùng Vertex Express như provider text/JSON riêng trong app local, giữ nguyên Gemini Developer API và dữ liệu/cấu hình hiện có.

**Kiến trúc:** `vertex-express` đi qua native REST và `createGuardedFetch`, không qua ChatOpenAI. Key nằm trong setting riêng `vertex_express`; endpoint cố định, model phải được chọn rõ. Giữ Zod validation, cancellation và failure semantics. Không suy provider từ prefix credential.

**Nền tảng:** TypeScript, LangChain BaseChatModel hiện có, Electron/React, native fetch/SSE; không thêm SDK khi REST nhỏ có thể giữ network guard.

**Nguồn yêu cầu:** `docs/plans/2026-09-09-001-refactor-remove-enjoy-backend-plan.md` (U2/U3/U4/U11, G1-G5/G7), xác nhận Vertex key của user và `.superpowers/sdd/2026-09-10-azure-models/vertex-adapter-integration-plan.md`.

## Ràng buộc chung

- Không commit/push/deploy, thay installed app, migrate thư viện thật, đổi Keychain hoặc account/billing/key restrictions.
- Giữ mọi dirty edit ngoài scope. Bản nền Build10 và evidence389 đã được lưu trước chỉnh sửa.
- Key Vertex hiện bị 403 API_KEY_SERVICE_BLOCKED. Không retry provider thật tới khi có thay đổi quyền. Contract/fixture/UI checks phải được phân lớp, không dùng làm live PASS.
- Không xóa hay chuyển Gemini key/model/base URL/binding. Vertex không có model hoặc provider mặc định tự chọn.
- Không key trong URL, command argv, source, error body hoặc evidence. Diagnostic chỉ giữ host/path/status/reason được chọn.
- Nội dung người dùng tiếng Việt có dấu; identifier/log/comment English. Không có ký tự U+2014.

## A. Native transport và contract (worker transport)

Files: tạo `enjoy/src/lib/vertex-express-chat-model.ts`, `enjoy/scripts/check-vertex-express-chat-model.mjs`; sửa `chat-model.ts`, `json.command.ts`, và runtime regression script khi cần.

Interface: `createChatModel({provider:'vertex-express', key, modelName})` trả BaseChatModel; policy protocol `vertex-express`. JSON bind native `responseMimeType: 'application/json'` và `responseJsonSchema`, rồi Zod parse như trước. Fixed URL `https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:generateContent`; stream dùng `streamGenerateContent?alt=sse`. Authentication header `x-goog-api-key`.

- [ ] Kiểm model/path injection, custom endpoint, thiếu key/model, pre-abort bị từ chối trước fetch.
- [ ] Ánh xạ human/AI/system history và text parts; không âm thầm bỏ tool/non-text input không hỗ trợ.
- [ ] Serialize JSON schema, temperature/token config; một response, không retry/fallback sang provider khác.
- [ ] Giữ text/usage/finish metadata; từ chối empty/refusal/MAX_TOKENS và error JSON chỉ có HTTP/status/reason an toàn.
- [ ] SSE thật qua guarded fetch, chunk split, completion và abort giữa stream; không nhận partial response thành success.
- [ ] Contract fixture và regression Gemini/OpenAI/Ollama; ghi rõ không live.

Ví dụ acceptance quan trọng trong harness:

```typescript
assert.equal(request.url.hostname, 'aiplatform.googleapis.com');
assert.equal(request.url.searchParams.has('key'), false);
assert.equal(request.body.generationConfig.responseMimeType, 'application/json');
await assert.rejects(callWithAbortedSignal, /abort/i);
```

## B. Catalog, settings và preservation (worker settings)

Files: `ai-providers.ts`, types/enums/types, ai-settings-provider, provider-settings, en/vi i18n, check-ai-providers và migration regression.

- [ ] Thêm ID `vertex-express`, key enum VERTEX_EXPRESS=`vertex_express`, label Vertex AI Express.
- [ ] Endpoint không editable; model phải nhập/chọn explicit, không quảng bá capability chưa hỗ trợ.
- [ ] Settings clone/normalize/model selection hiểu ID mới; Gemini custom configuration giữ nguyên.
- [ ] Provider và migration contracts; không tự chuyển entity legacy sang Vertex hoặc fallback provider trả phí.

## C. Tích hợp và packaged acceptance (parent)

Files: E2E Vertex mới, package script nếu cần đăng ký contract; execution-notes và acceptance/evidence thuộc task.

- [ ] App UI disposable: lưu Gemini custom config và Vertex độc lập, chọn model, reopen settings/full offline restart, so row hashes và binding; zero Enjoy counters.
- [ ] Gated Vertex live harness chuẩn bị đúng host/native shape, key source và model explicit. Không chạy live khi auth còn 403; không coi SKIP là PASS.
- [ ] Chạy contract scripts, source TypeScript/lint phạm vi đổi. Nếu E2E targeted types gặp shared baseline diagnostics, công bố đúng và không sửa test để che lỗi.
- [ ] Tạo package local mới, exact source manifest/ASAR/signature; không thay app đang dùng.
- [ ] Smoke packaged routes và settings preservation đủ bao phủ thay đổi. Giữ kết quả provider/ASR cũ dưới provenance package cũ, không tuyên bố inference mới.
- [ ] Review phản biện độc lập bản tích hợp; sửa finding liên quan rồi freeze/index artifacts.

Lệnh chạy với Node/Yarn của repo, cwd `enjoy`:

```sh
/opt/homebrew/opt/node@24/bin/node ../.yarn/releases/yarn-4.6.0.cjs tsc --noEmit
ESLINT_USE_FLAT_CONFIG=false /opt/homebrew/opt/node@24/bin/node ../.yarn/releases/yarn-4.6.0.cjs eslint src/lib/vertex-express-chat-model.ts src/lib/chat-model.ts src/commands/json.command.ts
/opt/homebrew/opt/node@24/bin/node scripts/check-vertex-express-chat-model.mjs
```

## Hoàn tất phạm vi local

Adapter và settings hoạt động theo contracts, preservation và UI đã được kiểm trên package mới; source/evidence review không có finding material. Vertex live vẫn chưa kiểm khi key bị 403. Human listening, microphone vật lý và R9 trong goal gốc vẫn là các gate riêng, không được hạ chuẩn hoặc bỏ qua.
