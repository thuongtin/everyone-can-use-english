# Audit kiến trúc AI của Enjoy

> Đây là baseline trước source factory change, được chụp ngày 2026-09-06. Các claim về callsite, streaming, tools và IPC chỉ áp dụng cho snapshot trước thay đổi, không mô tả candidate hiện tại.

## Phạm vi và cách đọc

- Repository được khảo sát: `/Users/ethan/VibeCoding/everyone-can-use-english`, phần desktop app ở `enjoy/`.
- Ngày đọc source và dependency live: 2026-09-06.
- Đây là audit chỉ đọc. Không có source, migration, package manifest hay file dirty nào bị chỉnh sửa. Không đọc giá trị thật của API key, access token, file settings hoặc database.
- Quy tắc áp dụng được đọc từ `/Users/ethan/AGENTS.md`. Không tìm thấy `AGENTS.md` lồng bên dưới repository này.
- Kết luận về model mới chỉ dựa trên code hiện có. Source hiện tại không chứa `Luna`, `Astra`, `Terra` hoặc `Responses API`.

## Kết luận chính

Enjoy hiện có hai mặt phẳng chat độc lập:

1. Local Conversation và Chat Session chạy trong renderer bằng LangChain. `ChatOpenAI` được dùng cho EnjoyAI và OpenAI, `ChatOllama` chỉ được dùng cho Conversation cũ. Các call đều là invoke một lần, không có đường stream.
2. Màn hình LLM Chat cũ gọi REST API của server qua `webApi.createLlmMessage`, không đi qua provider local và không đi qua LangChain.

Các command text và JSON cũng tạo `ChatOpenAI` riêng, nên provider selection không tập trung. Structured output hiện chỉ là OpenAI Chat Completions JSON mode qua `withStructuredOutput`; không có tool call, tool executor, `bindTools`, `AgentExecutor`, `createToolCallingAgent` hoặc `.stream` trong `enjoy/src`.

Vì vậy, phạm vi phù hợp để thêm provider/model hiện đại là một bounded provider factory/adapter dùng lại contract hiện tại của commands và chat. Factory nên giữ `ChatOpenAI` cho provider OpenAI-compatible, giữ `ChatOllama` cho Ollama, đồng thời có một adapter Responses riêng khi endpoint/model yêu cầu Responses. Không cần xây tool executor trong đợt này vì source chưa có tool nào để thực thi.

Nếu model cần thêm chỉ là một model name trên endpoint EnjoyAI hoặc endpoint OpenAI-compatible đang dùng Chat Completions, đường nhỏ nhất là cập nhật remote provider metadata và lựa chọn model. Nếu provider là một `engine` mới hoặc model chỉ hỗ trợ Responses, phải mở rộng types/settings và thêm adapter. Không nên buộc STT, TTS và pronunciation vào provider chat trong cùng đợt.

## Provider và model hiện tại

### Registry và settings UI

Registry GPT mặc định ở `enjoy/src/renderer/components/conversations/gpt-providers.tsx:3-76`:

- `enjoyai`: các model `gpt-4o-mini`, `gpt-4o`, `chatgpt-4o-latest`, `gpt-4-turbo`, `gpt-4`, cùng các model OpenRouter-style như Claude, Llama, Gemma, Gemini, Perplexity và DeepSeek ở `:4-23`. Provider này cho phép `model`, role definition, temperature, number of choices, max tokens, penalties, history buffer và TTS ở `:24-34`.
- `openai`: các model `gpt-4o-mini`, `gpt-4o`, `chatgpt-4o-latest`, `gpt-4-turbo`, `gpt-4` ở `:36-45`. Provider cho phép thêm `baseUrl` ở `:46-57`.
- `ollama`: base URL mặc định `http://localhost:11434`, model list khởi đầu rỗng, các option gồm model, base URL, role definition, temperature, max tokens, history và penalties ở `:59-74`.

Registry TTS ở `enjoy/src/renderer/components/conversations/tts-providers.tsx:3-743`:

- EnjoyAI có `openai/tts-1`, `openai/tts-1-hd`, `azure/speech` ở `:3-7`, OpenAI có `tts-1`, `tts-1-hd` ở `:736-742`.
- Voice OpenAI là sáu voice chuẩn ở `:7-9` và Azure có voice theo language, trong đó có voice tiếng Việt ở `:703-731`.

Provider metadata remote được merge vào object singleton bằng `webApi.config("gpt_providers")` và `webApi.config("tts_providers_v2")` ở `enjoy/src/renderer/context/ai-settings-provider.tsx:58-95`. Ollama model list được lấy từ `<baseUrl>/api/tags` ở `:68-75`. OpenAI custom model list được lấy từ chuỗi phân tách bằng dấu phẩy trong setting ở `:77-81`. Conversation form lặp lại logic này ở `enjoy/src/renderer/components/conversations/conversation-form/index.tsx:84-108` và `:118-129`.

`Object.assign(providers, config)` đang mutate `GPT_PROVIDERS` và `TTS_PROVIDERS` singleton ở `ai-settings-provider.tsx:58-64` và `:84-94`. Provider registry mới nên trả object mới hoặc immutable snapshot để tránh test và màn hình khác bị ảnh hưởng theo thứ tự render.

Default engine settings còn khóa cứng provider ở nhiều điểm:

- Type `SupportedLlmProviderType` và `LlmProviderType.name` chỉ có `enjoyai | openai` ở `enjoy/src/types/index.d.ts:22-30`.
- Zod schema của default engine chỉ nhận `enjoyai | openai` ở `enjoy/src/renderer/components/preferences/default-engine-settings.tsx:34-52`.
- Model options chỉ chọn custom OpenAI hoặc `providers.enjoyai.models` ở `:55-63`; selector UI chỉ có EnjoyAI và OpenAI ở `:117-143`.
- Conversation form lại nhận `enjoyai | openai | ollama` ở `enjoy/src/renderer/components/conversations/conversation-form/index.tsx:60-82`, và GPT form render động theo keys của registry ở `enjoy/src/renderer/components/conversations/conversation-form/conversation-form-gpt.tsx:28-79`.

Điều này cho phép thêm model vào registry dễ hơn thêm một provider ID mới. Preset page còn ép engine/model/TTS theo `currentGptEngine` ở `enjoy/src/renderer/pages/conversations.tsx:133-209`, trong đó TTS model bị chọn bằng điều kiện `currentGptEngine.name === "enjoyai"` ở `:143-158` và `:188-200`.

### Settings runtime

`AISettingsProvider` là điểm gom state nhưng chưa phải provider factory. State và default nằm ở `enjoy/src/renderer/context/ai-settings-provider.tsx:13-56`:

- STT mặc định là Enjoy Azure ở `:44-46`.
- GPT mặc định là `{ name: "enjoyai", models: { default: "gpt-4o" } }` ở `:50-55`.
- OpenAI config ban đầu là null ở `:56`.
- TTS mặc định được lưu dưới `UserSettingKeyEnum.TTS_CONFIG` với engine `enjoyai`, model `openai/tts-1`, voice `alloy` ở `:97-109`.
- Echogarden/Whisper legacy được map sang config mới ở `:119-162`.
- Settings được đọc từ `STT_ENGINE`, `OPENAI`, `GPT_ENGINE` ở `:195-241`, rồi được lưu lại qua `:243-246` và `:251-279`.

`currentGptEngine` được mutate để gắn `key` và `baseUrl` ở `ai-settings-provider.tsx:257-267`. Khi tên là `openai`, code đọc trực tiếp `openai.key` và `openai.baseUrl` ở `:259-263`, nên provider mới không thể chỉ thêm registry mà phải thay logic này.

### Đường đi text và structured output

Command path hiện tại:

1. `enjoy/src/renderer/hooks/use-ai-command.tsx:18-245` lấy model theo từng task từ `currentGptEngine.models`, truyền `key`, `modelName`, `baseUrl` vào các command lookup, extract story, translate, analyze, punctuate, summarize, refine và chat suggestion.
2. Text path tạo `ChatOpenAI` ở `enjoy/src/commands/text.command.ts:1-30`, dùng `openAIApiKey`, `modelName`, temperature, `configuration.baseURL`, `maxRetries: 1`, rồi `await chatModel.invoke(prompt)` ở `:16-30`.
3. JSON path tạo `ChatOpenAI` ở `enjoy/src/commands/json.command.ts:1-46`, đổi một số model sang `gpt-4o` bằng `NOT_SUPPORT_JSON_FORMAT_MODELS` ở `:18-20`, truyền `modelKwargs.response_format.type = "json_object"` ở `:22-36`, rồi gọi `withStructuredOutput(..., { method: "jsonMode" })` ở `:38-45`.
4. Các command schema cụ thể gọi JSON path gồm lookup, chat suggestion và extract story; text path được dùng bởi analyze, translate, punctuate, refine và summarize topic. Public command functions hiện nhận option dạng key/model/baseUrl nên đây là seam tốt để giữ compatibility khi thêm factory.

`json.command.ts` không có `tools`, `tool_choice`, `function_call` hay output parser cho Responses. JSON output còn phụ thuộc vào model fallback hard-coded. Nếu model hiện đại không nhận sampling parameter hoặc không hỗ trợ Chat JSON mode, adapter phải lọc capability và chọn transport trước khi tạo request.

### Đường đi Conversation và Chat Session

Conversation cũ ở `enjoy/src/renderer/hooks/use-conversation.tsx:18-74` có `pickLlm`:

- EnjoyAI tạo `ChatOpenAI` với user access token và `${apiUrl}/api/ai` ở `:34-47`.
- OpenAI tạo `ChatOpenAI` với OpenAI key và `baseUrl` ở `:48-63`.
- Ollama tạo `ChatOllama` với base URL, model và penalties ở `:64-72`.

Prompt, memory và persistence nằm ở `:76-176`. GPT conversation tạo `ConversationChain` ở `:146-152`, gọi `chain.call` ở `:154-160`, rồi lưu user/reply ở `:162-176`. Đây là request hoàn tất một lần, không phải stream.

Chat Session cho agent ở `enjoy/src/renderer/hooks/use-chat-session.tsx:165-308`:

- Conversation agent dựng `ConversationChain` và gọi `chain.call` ở `:197-210`, lưu reply ở `:211-222`.
- Group agent dùng prompt pipe và `chain.invoke` ở `:254-266`, sau đó lưu reply ở `:274-286`.
- TTS agent không gọi LLM, chỉ copy pending message sang message hoàn tất ở `:289-308`.

`buildLlm` được copy riêng ở `use-chat-session.tsx:310-360`: chỉ hỗ trợ EnjoyAI và OpenAI ở `:321-356`, provider khác rơi vào lỗi ở `:357-359`. Ollama có trong Conversation form nhưng không chạy qua agent runtime. Agent config được tạo từ current engine/model/TTS ở `:375-416`.

`use-conversation.tsx` và `use-chat-session.tsx` đều truyền sampling options như temperature, max tokens, penalties và `n`. Với model/provider hiện đại, factory phải có capability flags cho sampling và number of choices để không gửi option bị endpoint từ chối.

### Legacy server LLM Chat

Mặt phẳng LLM Chat riêng gọi server REST:

- Client tạo chat ở `enjoy/src/api/client.ts:578-587` qua `POST /api/chats` và đọc chat qua `GET /api/chats/:id`.
- Client tạo message ở `:589-601` qua `POST /api/chats/:chatId/messages` và đọc danh sách ở `:603-617`.
- UI gọi `webApi.createLlmMessage` ở `enjoy/src/renderer/components/llm-chats/llm-chat.tsx:29-46`, nạp chat/messages ở `:72-118` và hiển thị ở `:144-174`.

Đường này không nhận `engine`, model, base URL hay provider config trong renderer. Nếu mục tiêu là local model/provider thì không nên gộp nó vào factory đợt đầu. Nếu mục tiêu là thay server LLM Chat thì cần audit API/backend riêng.
## Stream, tool và structured output

Kết quả search source:

- `new ChatOpenAI` có sáu expression trong bốn file: `text.command.ts:16`, `json.command.ts:22`, `use-conversation.tsx:35,51`, `use-chat-session.tsx:326,344`.
- `.stream(` không có trong `enjoy/src`.
- `bindTools`, `AgentExecutor`, `createToolCallingAgent`, `tool_choice` và tool declarations không có trong `enjoy/src`.
- `withStructuredOutput` chỉ xuất hiện ở `json.command.ts:38-45`.

Dependency hiện cài đặt đã có type cho `tools`, `tool_choice`, `response_format` ở `enjoy/node_modules/@langchain/openai/dist/chat_models.d.ts:42-55` và `withStructuredOutput` ở `:750-758`, nhưng app không gọi các capability tool đó. Đây là capability của dependency, không phải capability đã tích hợp.

LangChain hiện tại vẫn có thể làm lớp tương thích cho Chat Completions. Để dùng model yêu cầu Responses, nên tạo một adapter transport hẹp, ví dụ có các method `invokeText`, `invokeStructured` và tùy chọn `stream`, rồi để factory chọn Chat hoặc Responses theo capability của provider/model. Adapter có thể dùng OpenAI SDK trực tiếp ở boundary thích hợp. Không cần biến toàn bộ code thành LangChain agent và không cần thêm executor khi chưa có tool.

## STT, TTS và pronunciation

### STT

STT service enum ở `enjoy/src/types/enums.ts:18-23` chỉ có:

- `local`
- `enjoy_azure`
- `enjoy_cloudflare`
- `openai`

UI chọn các service này ở `enjoy/src/renderer/components/preferences/stt-settings.tsx:56-117`, và chat/transcription form cũng có các nhánh OpenAI tương tự. Luồng chính ở `enjoy/src/renderer/hooks/use-transcribe.tsx:30-170` transcode audio qua `EnjoyApp.echogarden.transcode`, sau đó dispatch theo enum ở `:82-104`.

- Local Whisper/whisper.cpp lấy model từ `echogardenSttConfig` và gọi IPC `EnjoyApp.echogarden.recognize` ở `use-transcribe.tsx:238-276`. Main implementation nằm ở `enjoy/src/main/echogarden.ts:1-329`, preload expose recognize/align/transcode ở `enjoy/src/preload.ts:551-590`.
- OpenAI dùng renderer OpenAI SDK ở `use-transcribe.tsx:279-332`, hard-code model `whisper-1`, `verbose_json`, word/segment timestamps ở `:291-310`, rồi chuẩn hóa segment timeline ở `:313-328`.
- Cloudflare dùng `POST ${AI_WORKER_ENDPOINT}/audio/transcriptions` với bearer user token ở `use-transcribe.tsx:334-382`, đọc VTT và trả model `@cf/openai/whisper` ở `:345-378`.
- Azure lấy token từ `webApi.generateSpeechToken` và dùng browser Speech SDK ở `use-transcribe.tsx:384-496`.

Kết quả STT được chuẩn hóa thành engine, model, transcript, timeline, originalText, tokenId và url ở `enjoy/src/types/index.d.ts:253-274`. Thêm một STT provider mới phải chạm enum, settings UI, transcribe dispatch, model/timeline normalization và token flow. Đây không phải một tác động phụ của provider chat.

### TTS

TTS dispatch renderer ở `enjoy/src/renderer/hooks/use-speech.tsx:10-45` phụ thuộc model prefix:

- model bắt đầu bằng `openai` hoặc `tts-` thì đi vào OpenAI TTS ở `:20-23`.
- model bắt đầu bằng `azure` thì đi vào Azure TTS ở `:23-25`.

OpenAI TTS dùng SDK trong renderer, lấy user access token hoặc OpenAI key, bật `dangerouslyAllowBrowser: true`, rồi gọi `audio.speech.create` ở `use-speech.tsx:47-83`. Azure TTS lấy token purpose `tts`, synthesize một lần, rồi consume hoặc revoke token ở `:85-126`.

Main Speech path ở `enjoy/src/main/db/models/speech.ts:177-249` cũng gọi OpenAI SDK một lần ở `:214-228`. EnjoyAI dùng `UserSetting.accessToken` và `${settings.apiUrl()}/api/ai` ở `:197-202`; OpenAI lại đọc legacy `settings.getSync("openai")` ở `:203-211`. Đây là split credential thật cần xử lý nếu chuyển provider hoặc đưa request về main process.

Preload speech IPC chỉ truyền engine, model và voice ở `enjoy/src/preload.ts:514-536`, type tương ứng ở `enjoy/src/types/enjoy-app.d.ts:294-315`. TTS config renderer có language nhưng config IPC lưu engine/model/voice, nên language không nhất quán giữa các đường lưu.

Việc dispatch bằng prefix làm provider TTS mới không thể chỉ thêm một key vào registry. Cần chuyển sang dispatch theo `engine` hoặc capability, hoặc giữ một model naming contract tương thích.

### Pronunciation assessment

Active pronunciation hook ở `enjoy/src/renderer/hooks/use-pronunciation-assessments.tsx:12-87` luôn lấy speech token với purpose `pronunciation_assessment` ở `:30-40`, chọn one-shot hoặc continuous Azure theo mốc 30 giây ở `:44-62`, rồi lưu Azure result details ở `:64-87`.

Azure SDK và phoneme/IPA config nằm ở `:90-125` và continuous path `:158-358`. Type kết quả đã mang hình dạng Azure sâu, gồm `words`, `phonemes`, `syllables` và `PronunciationAssessment` ở `enjoy/src/types/pronunciation-assessment.d.ts:1-68`. Local DB cũng lưu các score Azure-specific và result JSON ở `enjoy/src/main/db/models/pronunciation-assessment.ts:36-112`, tự sync server ở `:102-111`.

Không có `engine` hoặc `provider` field trong pronunciation result/model. Main class `enjoy/src/main/azure-speech-sdk.ts:6-127` có wrapper pronunciation/transcribe, nhưng search source không thấy caller ngoài class; active path là renderer hook. Thêm pronunciation provider mới sẽ là một thiết kế normalization/schema/API riêng, nên loại khỏi phạm vi provider chat nhỏ.

## Types, persistence, IPC và credential flow

### Types và dữ liệu conversation/chat

Các type hiện tại phân mảnh:

- `LlmProviderType` chỉ có name `enjoyai | openai`, key, model, baseUrl và custom models ở `enjoy/src/types/index.d.ts:22-30`.
- `GptEngineSettingType` có name string, task model map, baseUrl và key ở `:197-208`; type này cho phép string rộng hơn schema/UI.
- `TtsEngineSettingType` có engine, model, voice, language, baseUrl và key ở `:210-217`.
- `ConversationType.engine` nhận `enjoyai | openai | ollama` ở `enjoy/src/types/conversation.d.ts:1-10`.
- `GptConfigType` và `TtsConfigType` đều có index signature `[key: string]: any` ở `enjoy/src/types/chat.d.ts:65-83`, nên dữ liệu DB không được kiểm soát bằng một provider contract thống nhất.

DB model `Conversation` khai báo engine enum `openai`, `ollama`, `google-generative-ai` ở `enjoy/src/main/db/models/conversation.ts:50-66`. `enjoyai` bị thiếu dù là default và runtime engine; `google-generative-ai` lại không có runtime branch. Migration gốc chỉ tạo engine dạng STRING ở `enjoy/src/main/db/migrations/1703902890550-create-conversation.js:4-31`, nên đây là mismatch ở application model/sync, không phải một enum migration hiện hữu đáng tin cậy.

Chat mới lưu `config` JSON ở `enjoy/src/main/db/models/chat.ts:56-64`; ChatMember lưu `config` JSON ở `enjoy/src/main/db/models/chat-member.ts:44-57`; ChatAgent cũng lưu config JSON. Vì vậy một provider ID mới không bắt buộc tạo cột DB mới, nhưng cần normalize dữ liệu JSON và sửa migration. Message không lưu provider/model metadata riêng, nên audit/debug từng reply hiện không biết request đi qua provider nào.

### Migrations và coupling dữ liệu

`Conversation.migrateToChat` copy engine/model/sampling vào GPT member ở `enjoy/src/main/db/models/conversation.ts:91-110`, nhưng chỉ giữ engine nếu là `openai` hoặc `enjoyai`; engine khác bị thay bằng default user engine/model ở `:112-118`. Thêm `ollama` hoặc provider mới mà không sửa điều kiện này sẽ silently đổi provider khi migrate.

Migration cũng tạo Chat config với key `stt` ở `conversation.ts:148-157`, trong khi Chat virtual getter đọc `config.sttEngine` ở `enjoy/src/main/db/models/chat.ts:83-91` và `ChatDtoType` cũng khai báo `sttEngine` ở `enjoy/src/types/chat.d.ts:85-94`. Đây là coupling/bug migration cần đưa vào test khi chạm config.

`Conversation.validateConfiguration` dùng engine cho hai nghĩa: GPT engine bình thường, nhưng với TTS thì gán `conversation.engine = conversation.configuration.tts.engine` và `configuration.model = tts.engine` ở `conversation.ts:237-256`. Provider factory không nên dùng trực tiếp field `Conversation.engine` mà nên nhận một runtime config đã normalize theo type `gpt` hoặc `tts`.

Chat agent config migration từ trước v0.6 copy engine/model/TTS vào member ở `enjoy/src/main/db/models/chat-agent.ts:110-177`. Nếu thêm provider, migration giữ nguyên string hiện có nhưng `buildLlm` hiện chỉ nhận EnjoyAI/OpenAI, nên provider cũ có thể tồn tại trong DB nhưng không chạy được.
### Lưu và chuyển credential

User setting model là một bảng key/value:

- `enjoy/src/main/db/models/user-setting.ts:18-46` khai báo `key` và `value` TEXT, đọc `JSON.parse` nếu có thể.
- `UserSetting.set` stringify object rồi ghi thẳng value ở `:48-59`.
- Migration từ `electron-settings` copy legacy GPT engine và OpenAI setting ở `:79-99`.
- Bảng SQLite gốc cũng khai báo `value` là TEXT, unique theo key, không có encryption column ở `enjoy/src/main/db/migrations/1725411577564-create-user-setting.js:3-38`.
- Generic IPC handler đọc/ghi các key này ở `enjoy/src/main/db/handlers/user-settings-handler.ts:6-33`; preload expose `get` và `set` ở `enjoy/src/preload.ts:295-302`, type expose ở `enjoy/src/types/enjoy-app.d.ts:169-172`.

OpenAI config được lưu dưới setting key `openai` cùng với GPT engine, STT, TTS và Echogarden keys trong `enjoy/src/types/enums.ts:1-16`. Form OpenAI có schema `key`, `baseUrl`, `models` ở `enjoy/src/renderer/components/preferences/openai-settings.tsx:19-43`; password input vẫn bind trực tiếp vào React field value ở `:53-66`.

Enjoy account access token nằm trong profile setting. `UserSetting.accessToken` đọc `profile.accessToken` ở `user-setting.ts:71-73`; authenticated profile được persist qua `EnjoyApp.userSettings.set(UserSettingKeyEnum.PROFILE, user)` ở `enjoy/src/renderer/context/app-settings-provider.tsx:345-367`.

Credential hiện được chuyển ra renderer và dùng trực tiếp:

- `AISettingsProvider` lấy OpenAI setting ở `ai-settings-provider.tsx:203-206`, rồi gắn key vào `currentGptEngine` ở `:257-267`.
- ChatOpenAI local nhận access token hoặc OpenAI key ở `use-conversation.tsx:34-63` và `use-chat-session.tsx:321-356`.
- OpenAI STT/TTS khởi tạo SDK trong renderer với key và `dangerouslyAllowBrowser: true` ở `use-transcribe.tsx:279-296` và `use-speech.tsx:47-71`.
- Main TTS lại đọc legacy electron-settings trực tiếp ở `speech.ts:203-211`.

Do source lưu JSON TEXT và không có credential broker riêng, report này chỉ mô tả tên field/key, không đọc hoặc xuất bất kỳ giá trị credential nào. Khi thêm provider, không đặt secret trong Conversation/Chat/ChatMember JSON. Phạm vi tối thiểu có thể dùng typed provider settings và migration, nhưng hướng an toàn hơn là main-process credential broker để renderer chỉ nhận kết quả hoặc stream event.

### IPC ownership

`enjoy/src/main/window.ts:133-170` đăng ký DB, settings, Echogarden và các handler khác, nhưng không có AI provider request/stream IPC. `preload.ts:263-302` chỉ có app settings và generic user settings; `preload.ts:460-590` có Conversation, Speech và Echogarden DB/IPC. Do đó:

- Nếu factory vẫn gọi HTTP từ renderer, cần sửa renderer types/settings nhưng không thêm IPC mới.
- Nếu muốn giữ key trong main process, cần thêm main AI handler, preload API và type declaration, đồng thời route text/JSON/chat qua IPC. Đây là scope lớn hơn nhưng giải quyết split credential và `dangerouslyAllowBrowser`.
- TTS main path đã có seam `Speech.generate` và message speech IPC ở `enjoy/src/main/db/models/speech.ts:177-249`, `enjoy/src/main/db/handlers/messages-handler.ts:146-179`, `preload.ts:510-536`. STT/pronunciation hiện vẫn renderer-centric.

## Coupling và deprecation thật trong source/dependency live

### Coupling cần sửa khi thêm provider

1. Provider IDs bị rải trong types, Zod enum, default settings, runtime branch và migration. Các file chính là `types/index.d.ts:22-30`, `types/conversation.d.ts:1-10`, `conversation-form/index.tsx:60-82`, `default-engine-settings.tsx:34-143`, `use-conversation.tsx:23-74`, `use-chat-session.tsx:310-360`.
2. Runtime constructor bị lặp ở bốn file và không có factory chung. Commands luôn là `ChatOpenAI`; Conversation có Ollama; agent không có Ollama.
3. Sampling options được truyền vô điều kiện từ UI đến constructors. Provider capability cần cho biết temperature, penalties, number of choices và max tokens có được phép hay không.
4. JSON command fallback model `gpt-4o` và JSON mode hard-code ở `json.command.ts:18-45`, nên model mới có thể bị thay thế hoặc bị endpoint từ chối.
5. TTS dùng model prefix ở `use-speech.tsx:20-25` và voice lookup bằng `split("/")[0]` ở `conversation-form/index.tsx:261-295`. Provider metadata mới không đủ nếu naming khác.
6. Remote metadata mutate singleton ở `ai-settings-provider.tsx:58-95`; form và settings có logic fetch trùng.
7. Conversation engine enum, migration fallback và TTS overload semantic không đồng nhất ở `conversation.ts:50-66`, `:112-118`, `:237-256`.
8. Preset page ép lại current engine/model/TTS ở `pages/conversations.tsx:133-209`, có thể ghi đè provider/model đã chọn.
9. `conversation-form/index.tsx:265-267` có dòng dùng phép so sánh `configuration.tts.language === learningLanguage` thay vì gán. Đây không phải blocker cho chat provider, nhưng sẽ làm TTS config mới thiếu language khi validation.
10. Message/ChatMessage không lưu provider/model, nên không có provenance cho từng response ở `types/chat.d.ts:1-63` và DB model tương ứng.

### Deprecation xác nhận từ dependency đang cài

Các version live và declaration đang cài cho thấy:

- `@langchain/openai` đánh dấu `ChatOpenAI.modelName` deprecated, dùng `model` thay thế ở `enjoy/node_modules/@langchain/openai/dist/chat_models.d.ts:650-680`, đặc biệt `:665-667`. Source app vẫn dùng `modelName` ở `text.command.ts:14-18`, `json.command.ts:16-25`, `use-conversation.tsx:41,57` và `use-chat-session.tsx:332,350`.
- `ConversationChain.call` bị đánh dấu deprecated, dùng `.invoke()` ở `enjoy/node_modules/langchain/dist/chains/base.d.ts:51-72`. Source vẫn gọi `chain.call` ở `use-conversation.tsx:147-160` và `use-chat-session.tsx:197-210`.
- `StructuredTool.call` cũng deprecated ở `enjoy/node_modules/@langchain/core/dist/tools/index.d.ts:49-68` và `:114-133`, nhưng app hiện không có StructuredTool/tool executor callsite. Không nên coi đây là lý do để xây tool layer ngay.
- Type `ChatOpenAICallOptions` đã có `tools`, `tool_choice`, `response_format` ở `@langchain/openai/dist/chat_models.d.ts:42-55`, nhưng đây chỉ là dependency capability. Search source không có callsite.

Đây là deprecation của API sử dụng, không phải bằng chứng rằng cả package LangChain phải nâng ngay. Bounded factory có thể đổi constructor sang `model` và chuyển chain call sang invoke theo từng runtime path, nhưng không cần nâng toàn bộ LangChain trong cùng thay đổi.
## Ownership và choke points để chia việc

| Ownership | File chính | Trách nhiệm và rủi ro |
| --- | --- | --- |
| Provider registry/capability | `enjoy/src/renderer/components/conversations/gpt-providers.tsx:3-76`, `tts-providers.tsx:3-743` | Model list, base URL, configurable fields, voice/prefix contract. Nên tách metadata khỏi UI component. |
| Settings state/migration UI | `enjoy/src/renderer/context/ai-settings-provider.tsx:13-279`, `components/preferences/default-engine-settings.tsx:34-143`, `openai-settings.tsx:19-142`, `pages/conversations.tsx:133-209` | Provider IDs, current engine, custom models, defaults, presets. Đây là choke point cho provider mới. |
| Conversation form | `components/conversations/conversation-form/index.tsx:60-299`, `conversation-form-gpt.tsx:28-289`, `conversation-form-tts.tsx:18-197` | Zod enums, configurable filtering, base URL, TTS voice validation. |
| Shared runtime | New bounded factory seam; current implementations `commands/text.command.ts:1-30`, `commands/json.command.ts:1-46`, `hooks/use-conversation.tsx:23-74`, `hooks/use-chat-session.tsx:310-360` | Chọn Chat Completions/Responses/Ollama, lọc options, thống nhất lỗi. Có sáu constructor expressions trong bốn file. |
| Feature commands | `hooks/use-ai-command.tsx:18-245`, `commands/*.command.ts` | Giữ public command API, structured schemas và task model map. |
| Persistence/migration | `types/index.d.ts:22-30,197-217`, `types/enums.ts:1-23`, `main/db/models/conversation.ts:50-256`, `main/db/models/chat.ts:56-91`, `main/db/models/chat-agent.ts:110-177`, `main/db/models/user-setting.ts:18-99` | Typed provider setting, normalize engine IDs, không làm rơi provider ở migrateToChat, sửa `stt`/`sttEngine`. |
| IPC/credential boundary | `main/db/handlers/user-settings-handler.ts:6-33`, `main/window.ts:133-170`, `preload.ts:263-302,460-590`, `types/enjoy-app.d.ts:157-172,279-343` | Generic user settings hiện trả object trực tiếp cho renderer. Nếu broker main process thì đây là ownership. |
| Audio | `hooks/use-transcribe.tsx:30-496`, `hooks/use-speech.tsx:10-130`, `main/db/models/speech.ts:177-249`, `hooks/use-pronunciation-assessments.tsx:12-358` | Giữ độc lập khỏi chat provider; mỗi loại có token/output contract riêng. |
| Verification/package | `package.json:10-36,60-64,138,156-167,199-222`, `forge.config.js:72-116`, `e2e/main.spec.ts:1-93`, `e2e/renderer.spec.ts:1-55` | Build package, Vite main/preload/renderer, Playwright fixture hiện không test AI HTTP. |

## Đề xuất bounded adapter/factory và phạm vi nhỏ nhất

### Contract đề xuất

Tạo một module runtime riêng, tên file cụ thể có thể quyết định khi triển khai, ví dụ `enjoy/src/renderer/ai/provider-factory.ts`. Module này nên nhận một config đã normalize:

```ts
type AiRuntimeConfig = {
  providerId: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  capabilities: {
    transport: "chat" | "responses" | "ollama";
    structured: boolean;
    tools: boolean;
    stream: boolean;
    temperature: boolean;
    penalties: boolean;
    numberOfChoices: boolean;
  };
};
```

Factory trả một interface nhỏ, chẳng hạn `invokeText`, `invokeStructured`, và `stream` tùy capability. Chat Completions adapter dùng `ChatOpenAI` hiện tại với `model` thay cho deprecated `modelName`; Ollama adapter dùng `ChatOllama`. Responses adapter dùng transport phù hợp cho endpoint hiện đại và map kết quả về `string` hoặc schema hiện tại của commands.

Public functions của `textCommand`, `jsonCommand`, lookup và các command khác nên giữ tên/return type. Có thể giữ option cũ làm compatibility shim, sau đó normalize sang factory. `use-conversation` và `use-chat-session` gọi factory thay vì tự branch provider. Đây là thay đổi có thể review theo một seam, không cần nâng toàn bộ dependency graph.

### Phase nhỏ có thể triển khai

**Phase A: model mới dưới provider hiện có**

- Không thêm engine ID nếu endpoint hiện tại đã nhận model name mới.
- Đưa model vào remote `gpt_providers` hoặc custom model setting. Conversation provider registry đã đọc remote model list ở `ai-settings-provider.tsx:58-81` và form render model động ở `conversation-form-gpt.tsx:60-79`.
- Kiểm tra model không bị `NOT_SUPPORT_JSON_FORMAT_MODELS` fallback ở `json.command.ts:18-20`, không gửi sampling option ngoài capability, và endpoint thật trả được text/JSON.
- Đây là scope binary nhỏ nhất, nhưng chỉ đúng nếu model endpoint tương thích Chat Completions và JSON mode hiện tại. Source audit không đủ cơ sở để khẳng định model cụ thể có tương thích.

**Phase B: provider ID mới hoặc Responses transport**

- Thêm provider metadata typed, capability flags, model list và base URL vào registry.
- Mở rộng `SupportedLlmProviderType`, `LlmProviderType`, `GptEngineSettingType`, Conversation/Chat config normalization và Zod schema. Không lưu key trong conversation/chat JSON.
- Thêm typed setting map hoặc setting key cho provider credentials. Migration phải đọc setting OpenAI legacy nếu provider mới thay thế OpenAI, giữ `baseUrl/models` và không log value.
- Route `textCommand`, `jsonCommand`, `use-conversation` và `use-chat-session` qua factory. Giữ server LLM Chat tách riêng.
- Nếu Responses cần credential ở main process, thêm AI request/stream IPC và preload type. Nếu chưa làm broker, phải ghi rõ rằng key vẫn đi qua renderer theo hành vi hiện tại.
- Chỉ expose TTS/STT capability khi provider thực sự có endpoint và output normalize tương ứng. Chat-only provider không xuất hiện trong TTS/STT selector.

**Không đưa vào Phase B**

- Tool executor, agent loop, tool registry: source không có tool.
- Thay toàn bộ `ConversationChain` bằng agent framework.
- Thay Azure pronunciation schema hoặc thêm provider pronunciation.
- Đổi server REST LLM Chat legacy.
- Nâng toàn bộ LangChain/OpenAI package chỉ để bật provider. Chỉ xử lý deprecation trực tiếp ở constructor/callsite bị chạm nếu build yêu cầu.

### Credential boundary nên chọn

Có hai mức:

1. Scope nhỏ: tiếp tục dùng `UserSetting.OPENAI` và thêm provider map có `key/baseUrl/models`, nhưng giữ compatibility migration. Cách này ít file hơn, nhưng tiếp tục lưu plaintext JSON và expose key trong renderer.
2. Scope an toàn hơn: thêm main-process provider client/IPC. Renderer gửi provider ID, model, prompt và request options; main đọc credentials từ UserSetting rồi trả text/structured result hoặc stream event. Không gửi secret trong IPC payload và không để `Conversation.config` chứa key. Đây là thay đổi lớn hơn nhưng loại được split giữa `Speech.generate` legacy settings và renderer OpenAI SDK, đồng thời loại `dangerouslyAllowBrowser` khỏi đường chat/STT/TTS khi lần lượt chuyển các path.

Đối với mục tiêu triển khai model chat nhanh, chọn mức 1 cho Phase A và ghi issue riêng cho broker. Đối với provider mới có credential riêng hoặc Responses streaming, chọn mức 2 ngay ở adapter đó để không nhân rộng coupling hiện tại.
## Test, build và tiêu chí chấp nhận

Package script ở `enjoy/package.json:10-36` cho thấy:

- `yarn lint` chạy ESLint ở `:17`.
- `yarn package` chạy Vite/Electron Forge package ở `:14`.
- `yarn test` package rồi chạy Playwright ở `:18`; `test:main` và `test:renderer` ở `:19-20`.
- Các stabilization checks gồm localization, API error, package guard, packaged app, DB lifecycle và audio ở `:22-36`.

Test hiện có chưa kiểm provider chat:

- `enjoy/e2e/main.spec.ts:12-50` chỉ xác nhận packaged app, isolated settings/library và ffmpeg.
- Native Echogarden tests bị skip nếu không đặt `ENJOY_E2E_NATIVE=1` ở `main.spec.ts:52-93`.
- Renderer spec kiểm landing/key interaction, không có route interception cho AI provider.
- `playwright.config.ts:1-23` dùng một worker và testDir e2e.
- `tsconfig.json:2-26` bật `noImplicitAny`, `skipLibCheck`, include `src`, nhưng package không có script `typecheck` riêng.

Cho Phase A/B, test tối thiểu nên có:

1. Unit test registry/factory: dispatch EnjoyAI/OpenAI/Ollama, Responses capability, option filtering, structured schema, lỗi HTTP và provider không hỗ trợ. Mock transport, không dùng credential thật.
2. Settings round-trip: provider ID/model/base URL/custom model list được lưu và đọc; migration OpenAI legacy không làm mất field; secret chỉ được assert là đã truyền vào mock, không log giá trị.
3. Conversation và agent smoke test: một request text ở Conversation, một request agent, một JSON command. Intercept HTTP hoặc inject fake adapter để chứng minh route, không gọi endpoint thật.
4. Migration regression: engine `ollama` hoặc provider mới không bị `migrateToChat` đổi thành default; `sttEngine` giữ đúng key.
5. Build verification: `yarn lint`, `yarn package`, `yarn test:main`, `yarn test:renderer`, rồi các script `test:api-errors`, `test:package-guard`, `test:packaged-app`, `test:db-lifecycle`. Nếu chạm audio thì thêm `test:post-audio`, `test:wavesurfer`; nếu không chạm audio không cần mở rộng test audio.
6. Kiểm tra packaging khi thêm SDK runtime. Forge Vite build main/preload/renderer ở `forge.config.js:72-95`; plugin dependencies chỉ lấy `Object.keys(pkg.dependencies)` ở `:111-116`. Package mới phải được bundle đúng target hoặc khai báo đúng dependency, không chỉ cài trong devDependencies rồi giả định packaged app có thể require.

Không chạy test trong audit này để giữ nguyên worktree dirty và không tạo artifact build/download ngoài yêu cầu. Đây là audit source, chưa phải xác nhận runtime provider.

## Dependency live tại thời điểm audit

Declared ranges được đọc từ `enjoy/package.json`; installed versions được đọc trực tiếp từ `enjoy/node_modules/*/package.json`. Lockfile `yarn.lock` cũng có các bản chính tương ứng.

| Package | package.json | Installed live | Evidence |
| --- | --- | --- | --- |
| `@langchain/openai` | transitive, không khai báo trực tiếp | `0.4.4` | `enjoy/node_modules/@langchain/openai/package.json`; declaration `dist/chat_models.d.ts:650-680` |
| `@langchain/core` | `^0.3.42` | `0.3.42` | `enjoy/package.json:60-62`; `yarn.lock:4579-4581` |
| `@langchain/ollama` | `^0.2.0` | `0.2.0` | `enjoy/package.json:60-62`; `yarn.lock:4599-4604` |
| `@langchain/community` | `^0.3.35` | `0.3.35` | `enjoy/package.json:60-62`; `yarn.lock:4192-4196` |
| `langchain` | `^0.3.19` | `0.3.19` | `enjoy/package.json:156-156`; `yarn.lock:18699-18704` |
| `openai` | `^4.87.3` | `4.87.3` | `enjoy/package.json:167-167`; `yarn.lock:21661-21666` |
| `microsoft-cognitiveservices-speech-sdk` | `^1.42.0` | `1.42.0` | `enjoy/package.json:162-162`; `yarn.lock:20186-20190` |
| `echogarden` | `^2.3.5` | `2.3.5` | `enjoy/package.json:211-211`; `yarn.lock:14074-14079` |
| `sequelize` | `^6.37.6` | `6.37.6` | `enjoy/package.json:218-218`; `yarn.lock:24558-24562` |
| `sequelize-typescript` | `^2.1.6` | `2.1.6` | `enjoy/package.json:219-219` |
| `zod` | `^3.24.2` | `3.24.2` | `enjoy/package.json:203-204`; `yarn.lock:28359-28362` |
| `zod-to-json-schema` | `^3.24.3` | `3.24.3` | `enjoy/package.json:203-204`; `yarn.lock:28336-28340` |
| `electron` | `^34.3.3` | `34.3.3` | `enjoy/package.json:138-138`; `yarn.lock:14343-14346` |
| `@playwright/test` | `^1.51.0` | `1.51.0` | `enjoy/package.json:64-64`; `yarn.lock:5860-5864` |
| `vite` | `^6.2.2` | `6.2.2` | `enjoy/package.json:200-200`; `yarn.lock:27453-27457` |
| `typescript` | `^5.8.2` | `5.8.2` | `enjoy/package.json:199-199`; `yarn.lock:26251-26255` |

`@langchain/openai` không có direct declaration trong `package.json` nhưng code import trực tiếp ở command và hook. Nếu factory tiếp tục dùng package này, nên cân nhắc khai báo direct dependency với version đã lock trong một thay đổi dependency riêng, hoặc ghi rõ transitive ownership trước khi nâng.

## Khuyến nghị chốt

1. Chia worker theo ownership table ở trên, bắt đầu từ provider registry/settings và factory seam.
2. Giữ public `textCommand`/`jsonCommand` và model task map; thay implementation bên dưới bằng factory.
3. Ưu tiên model-only path nếu Luna được expose trên provider hiện có và endpoint Chat Completions-compatible. Source hiện đã nhận model string động ở Conversation form, nhưng default settings/provider ID vẫn hard-code.
4. Nếu cần Responses hoặc streaming, thêm adapter riêng sau factory, không dựng tool executor và không nâng toàn LangChain trong cùng PR.
5. Giữ STT, TTS và pronunciation tách capability. Chỉ mở rộng khi có contract endpoint và output normalization tương ứng.
6. Ghi rõ credential trade-off trong PR: hiện UserSetting là plaintext JSON TEXT và key đi qua renderer. Provider mới có secret riêng nên đi qua main-process broker nếu muốn tránh nhân rộng rủi ro.
