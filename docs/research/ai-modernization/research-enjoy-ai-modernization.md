---
title: "Hiện đại hóa AI cho Enjoy: provider, model, chat, speech và local"
tags:
  - research
  - enjoy
  - ai
  - provider
  - model
  - electron
date: 2026-09-06
sources: 93
confidence: hỗn hợp
status: research_complete
method: AI-assisted research with multi-source verification
mode: deep
source_count_note: "93 URL canonical references có initial ledger access sau exact URL dedup và redirect normalization; repeated URL không tăng count. Đây là source-reference count, không phải claim rằng cả 93 URL đã có final content verification; random recheck ghi nhận 35/36 content-verified và 1 not-evaluable."
pending_inputs: "paid provider/account checks and EN-VI quality benchmark are optional operational follow-up"
---

# Nghiên cứu: hiện đại hóa AI cho Enjoy

Đây là bản thảo hợp nhất ở ngày 2026-09-06 cho Enjoy Electron, tập trung vào người Việt học tiếng Anh. Phạm vi hiện tại đã có tài liệu API/model của OpenAI, Anthropic, Google Gemini, OpenRouter, DeepSeek, Groq, Ollama, LM Studio, whisper.cpp, faster-whisper, Apple Speech, Vercel AI SDK, LangChain và speech provider. Local research và architecture audit đã được merge. Không có paid API call, không đọc credential thật và không sửa repository trong quá trình research.

## Metadata nghiên cứu

| Thuộc tính | Giá trị |
|---|---|
| Ngày nghiên cứu | 2026-09-06 |
| Mode | deep |
| Nguồn canonical có initial ledger record | 93 |
| Successful URL attempts exact | 94 |
| Phân bổ nguồn | Tier 1 official primary: 93 |
| Re-fetch đã merge | 56 unique URL groups, 59 per-ledger records, 55 canonical source URLs sau khi loại redirect alias |
| Failed URL records unique | 12 URL trong `failed-sources.json`; một URL có 2 lần thất bại, tổng cộng 13 failed fetch events |
| Câu hỏi nghiên cứu | Model/API nào cần thay; adapter nào giữ được code; chat, STT, TTS và pronunciation có contract nào; chi phí và vùng Việt Nam ra sao; phần nào chỉ mock được |
| User jurisdiction | Việt Nam |
| User role/use case | Người dùng Enjoy học tiếng Anh, cần giải thích Anh-Việt, hội thoại, audio và luyện phát âm |
| Academic API | Không áp dụng trong scope hiện tại vì không đưa claim clinical hoặc educational-effectiveness |
| Trạng thái | Research complete; review, TypeScript, package, verifier, 8 packaged E2E và native UI PASS; 3 native opt-in skipped; chưa gọi model trả phí |

## Tóm tắt điều hành

- Gemini `gemini-3.8-flash` có contract được tài liệu xác nhận là Stable, hỗ trợ mức thinking low/medium/high và từ chối `minimal`; trang model riêng ghi text output, không có audio generation hoặc Live API. OpenAI-compatible docs của Gemini ghi streaming, function calling và structured output, còn danh sách vùng có Việt Nam. Đây là ứng viên integration đầu tiên theo contract, chưa phải bằng chứng chất lượng Anh-Việt hoặc account access ([Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai), [Gemini available regions](https://ai.google.dev/gemini-api/docs/available-regions)) - 🟡 contract cao, quality/account ⚪.
- OpenAI ghi GPT-6 Astra cần Responses cho tools, không hỗ trợ reasoning mức `none` hoặc `minimal`, dùng mức `low` trở lên theo guidance, và cần bỏ `temperature`, `top_p`, `top_logprobs`; Responses streaming dùng typed SSE events. GPT-5.6 Luna được ghi hỗ trợ text/image input, streaming, function calling và structured outputs với giá text 0.20 USD input và 1.20 USD output cho mỗi 1M token. Đây là cơ sở để tách adapter Responses khỏi đường Chat Completions cũ, chưa chứng minh model được cấp cho account Enjoy ([GPT-6 Astra guidance](https://developers.openai.com/api/docs/guides/latest-model), [Responses streaming](https://developers.openai.com/api/docs/guides/streaming-responses), [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)) - 🟡 contract cao, entitlement ⚪.
- Anthropic có native Messages API với SSE, tools và `output_config.format` kiểu `json_schema`; bảng lifecycle hiện đánh dấu Claude Sonnet 5 và Haiku 4.5 là Active. Tài liệu SDK yêu cầu Node.js 20 LTS hoặc mới hơn và tắt browser support mặc định, nên native adapter phù hợp Electron main process nếu dependency/runtime của Enjoy đáp ứng. Giá Sonnet 5 trong nguồn là 2 USD input và 10 USD output cho mỗi 1M token, nhưng đây là list price của vendor, không phải tổng cost thực tế ([Anthropic models overview](https://platform.claude.com/docs/en/models/overview), [Messages API](https://platform.claude.com/docs/en/api/messages/create), [Anthropic TypeScript SDK](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript)) - 🟡 contract cao, availability/quality ⚪.
- OpenRouter phù hợp làm transport fallback và catalog thử nghiệm. Docs cung cấp `canonical_slug`, pricing, `supported_parameters`, `per_request_limits` và `expiration_date`; live catalog đã liệt kê `anthropic/claude-sonnet-5` có `response_format` và `structured_outputs`, đồng thời entry đó không liệt kê `temperature`. Structured output vẫn phụ thuộc endpoint/provider, vì vậy route phải kiểm tra capability tại thời điểm dùng ([OpenRouter Models](https://openrouter.ai/docs/guides/overview/models), [OpenRouter public model catalog](https://openrouter.ai/api/v1/models), [OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)) - 🟡 catalog contract cao, route/account/quality ⚪.
- DeepSeek V4 Flash và Pro được tài liệu ghi có JSON Output, Tool Calls, Responses API và Anthropic API; Flash có concurrency 2500, Pro 500, với bảng giá peak/off-peak khác nhau. Tài liệu cũng xác nhận OpenAI-compatible endpoint và `stream=true`, nhưng JSON Output chưa đủ để kết luận strict JSON Schema. Đây là ứng viên cost role sau smoke test, không phải kết luận về năng lực dạy tiếng Anh ([DeepSeek API call](https://api-docs.deepseek.com/guides/function_calling), [DeepSeek Models and Pricing](https://api-docs.deepseek.com/quick_start/pricing/)) - 🟡 contract cao, account/quality ⚪.

Điều cần đọc cùng phần tóm tắt: phần lớn evidence là vendor documentation hoặc vendor API metadata; architecture audit là evidence đọc source local. Không có benchmark độc lập tiếng Việt và không có kết quả runtime với key thật. Random recheck đã xử lý 36/36 URL được chọn, trong đó 35/36 có content được kiểm chứng và Apple `supportsOnDeviceRecognition` chỉ có metadata, không đánh giá được nội dung. Speech contract đã được merge nhưng chưa có paid request hoặc model-specific payload test. Vì vậy các nhãn `recommended` trong báo cáo chỉ có nghĩa là phù hợp để thử theo contract, chi phí niêm yết và đường tích hợp hiện có, không có nghĩa là model tốt nhất cho người học.

## Phạm vi, giả thuyết và phương pháp

Phạm vi đã đọc gồm model lifecycle, endpoint, auth contract, streaming, tools, structured output, pricing, region, local runtime và source architecture evidence. Các claim chất lượng ngôn ngữ, hiệu quả học tập, độ chính xác đánh giá phát âm và latency thực tế bị loại khỏi kết luận vì chưa có nguồn phù hợp và chưa chạy benchmark.

Ba giả thuyết cạnh tranh:

1. Chỉ cập nhật danh sách model là đủ.
2. Giữ LangChain và thêm lớp chọn provider dùng chung là đủ cho đợt đầu.
3. Cần rewrite sang framework AI khác.

Kết quả sơ bộ nghiêng về giả thuyết 2. Các trang OpenAI, Gemini, OpenRouter, DeepSeek và Groq đều cho thấy OpenAI compatibility có phần giao nhau nhưng có field gap, lifecycle khác và structured output không đồng nhất. Anthropic có contract Messages riêng, nên một adapter nhỏ dùng chung transport và capability map giữ được phần code hiện tại nhưng không giả định parity giả tạo.

Deep mode yêu cầu 50-100+ nguồn. Bản này hiện có 93 canonical URL references trong initial ledger, vượt ngưỡng source count tối thiểu; đây không phải claim rằng cả 93 URL đều có final content verification. Random recheck đã xử lý 36/36 URL được chọn, 35/36 content-verified và 1 not-evaluable. Speech, local và architecture evidence đã được merge; source research đã complete. Implementation validation và provider runtime/account checks được giữ thành follow-up, không phải điều kiện để đóng research. Không dùng academic API vì scope được giới hạn ở vendor contract, local adapter và architecture decision, không nêu clinical hoặc educational-effectiveness claims.

## Quy trình tìm kiếm và ledger merge

| Bước | Số lượng | Chi tiết |
|---|---:|---|
| Ledger OpenAI | 14 URL thành công | Tài liệu model, Responses, deprecation, data, billing, region và LangChain |
| Ledger chat provider | 15 URL thành công | Anthropic, Gemini, OpenRouter, DeepSeek và Groq |
| Crosscheck | 2 URL thành công | Gemini 3.8 Flash card và OpenRouter public catalog |
| Ledger local/adapter | 43 URL thành công | Ollama, LM Studio, whisper.cpp, faster-whisper, Apple Speech, Vercel AI SDK, LangChain và Electron |
| Ledger speech | 23 successful URL records/fetch events, 3 failed URL records/fetch events | STT file/realtime, TTS, codec, timestamps, language, pricing và pronunciation assessment |
| Canonical source count | 93 | Exact URL dedup và redirect normalization; repeated URL không cộng; alias platform transcription được giữ ở attempted ledger |
| Successful URL records unique | 94 | 93 canonical source URL và 1 redirect alias đã fetch thành công; đây là URL records, không phải 94 independent sources |
| Failed URL records unique | 12 | Một URL có 2 lần thất bại, nên tổng failed fetch events là 13 |
| Attempted URL records unique | 106 | 94 successful URL records và 12 failed URL records sau exact URL dedup |
| Fetch events | 107 | 94 successful fetch events và 13 failed fetch events |
| Re-fetch targeted round | 27 unique URL groups, 30 per-ledger records | 26 canonical source URL sau khi loại redirect alias |
| Random recheck | 36 URL được chọn và đã xử lý | 14 executive + 22 seeded random; 7 prior records reused, 29 records mới, 28 content-verified và 1 not-evaluable |
| Re-fetch đã merge | 56 unique URL groups, 59 per-ledger records | 55 canonical source URL sau khi loại redirect alias; re-fetch không tăng source count |
| Paid call | 0 | Chỉ đọc docs/metadata |
| Credential thật | Không đọc | Không đưa key hoặc secret vào ledger |
| Academic discovery | Không áp dụng | Không có claim clinical/educational-effectiveness |

Các URL exploratory không có trong canonical ledger không được dùng để tăng count. `sources.json` giữ fact theo từng URL và failed attempts, còn `failed-sources.json` giữ failed attempts cùng fallback. Đây là cách phân biệt source count, URL records và fetch events. Speech ledger có 23 successful attempts, gồm 18 URL shortlist và 5 URL attempted-only. Một platform redirect alias được giữ để truy vết nhưng không tính là source canonical mới. Reverification targeted ban đầu ưu tiên implementation-critical claims và các điểm mâu thuẫn hoặc đã được reviewer nêu. Vòng random dùng seed `20260906`, chọn toàn bộ 14 URL trong executive summary và 22 URL từ population 79 còn lại; 7 URL đã reverify được reuse, 29 URL mới có record, 28 content-verified và 1 not-evaluable. Mỗi entry giữ URL, ngày xác minh với độ chính xác theo ngày, vị trí bằng chứng, kết quả quan sát và giới hạn. Các URL thuộc nhiều ledger vẫn là một unique URL group và một canonical source nếu cùng URL. Apple canonical có hai content attempts, và DocC JSON fallback có một failed event riêng; các event này không tăng source count.

## 1. Quyết định kiến trúc và các phương án

### Phương án A: chỉ sửa model catalog

Phương án này có ít thay đổi nhưng không xử lý Responses API, typed event, sampling parameter theo model, structured JSON, model lifecycle, key isolation hoặc provider-specific errors. Evidence của OpenAI cho thấy GPT-6 Astra cần Responses và loại một số sampling fields; evidence của OpenRouter, DeepSeek và Groq cho thấy compatibility có điều kiện ([GPT-6 Astra guidance](https://developers.openai.com/api/docs/guides/latest-model), [OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs), [DeepSeek API call](https://api-docs.deepseek.com/guides/function_calling), [Groq OpenAI Compatibility](https://console.groq.com/docs/openai)).

Kết luận: không đủ cho migration có kiểm chứng.

### Phương án B: shared factory và hybrid small adapters

Giữ transport `ChatOpenAI` cho provider có OpenAI-compatible endpoint, thêm capability map và field mapping. Gemini, DeepSeek, OpenRouter và Groq nằm trong nhóm có tài liệu compatibility, với mức bảo đảm khác nhau. Anthropic đi qua native Messages adapter khi cần tools, SSE hoặc `json_schema` theo contract gốc. Đây là phương án được chọn trong thiết kế hiện tại vì giữ lịch sử hội thoại và giảm thay đổi bề mặt.

Contract đề xuất:

```ts
type ProviderRequest = {
  provider: string;
  model: string;
  messages: Message[];
  temperature?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
  responseSchema?: JsonSchema;
};

type ProviderResponse = {
  text: string;
  usage?: Usage;
  toolCalls?: ToolCall[];
  parsed?: unknown;
  finishReason?: string;
};
```

Capability flags cần có: `streaming`, `tools`, `structured_json_schema`, `vision`, `native_reasoning` và `model_lifecycle`. Factory không tự thêm field vào request nếu capability map không cho phép.

### Phương án C: rewrite sang Vercel AI SDK hoặc app khác

Chưa có evidence cho thấy cần thay memory, chains, streaming và speech flow toàn bộ. Rewrite làm tăng bề mặt migration trước khi biết vấn đề thực tế nằm ở adapter nào. Phương án này chỉ nên mở lại sau khi phase 1 có failure không thể cô lập bằng factory hiện tại.

## 2. Ma trận provider/model cho Enjoy

 Các cột `STT`, `TTS` và `Pronunciation` phản ánh contract đã fetch hoặc code audit. `⚪` nghĩa là không có evidence cho capability đó trong source set hoặc capability không áp dụng. Timestamp là alignment transcript, còn pronunciation assessment là điểm đánh giá riêng.

| Provider/model | Chat | STT có timestamp | TTS | Pronunciation assessment | Contract hiện có | Ghi chú route |
|---|---|---|---|---|---|---|
| OpenAI GPT-5.6 Luna | Text/image input, text output, streaming, function calling và structured outputs được model page ghi nhận | ⚪ | ⚪ | ⚪ | Cao cho model page, account chưa test | Dùng Responses khi model/adapter yêu cầu; giữ Chat Completions cho route cũ |
| OpenAI GPT-6 Astra | Tools cần Responses; không hỗ trợ reasoning mức none/minimal, dùng low trở lên; bỏ `temperature`, `top_p`, `top_logprobs` | ⚪ Model card ghi không có audio input/output | ⚪ | ⚪ | Cao cho guidance, account chưa test | Optional high-cost route, không đặt làm default |
| OpenAI `gpt-transcribe` | Không áp dụng | File transcription, schema liệt kê `verbose_json` và `timestamp_granularities=[word, segment]`; fixture model-specific chưa test | ⚪ | Không có | Cao cho schema/model card, account chưa test | Giữ Echogarden DTW fallback khi thiếu annotation |
| OpenAI `gpt-live-transcribe` | Realtime transcription | Không có word-level timestamps, speaker labels hoặc transcription confidence theo guide | ⚪ | Không có | Cao cho guide/model card, vi-VN chưa xác nhận riêng | Dùng cho live ASR, không dùng làm alignment hoặc pronunciation grade |
| OpenAI `gpt-4o-mini-tts` | Không áp dụng | ⚪ | Text input/audio output, model card có giá token; guide có voice, format và streaming | Không có | Cao cho docs, voice/vi-VN per voice chưa test | Tách TTS route khỏi chat model |
| OpenAI `gpt-realtime-2.1` | Audio conversation qua Realtime API guide | Realtime session có transcript events nhưng không phải word alignment | Audio conversation | Không có | Cao cho Realtime guide, account chưa test | WebRTC client với ephemeral secret; WebSocket cho server media pipeline |
| Google Gemini `gemini-3.8-flash` | Stable; low/medium/high thinking, reject minimal; compatibility ghi stream, tools, parse/Zod | ⚪ Dedicated page ghi không có audio generation hoặc Live API | ⚪ | ⚪ | Cao cho docs, account/quota chưa test | Ứng viên integration đầu tiên qua OpenAI-compatible path |
| Google `gemini-3.5-transcribe` | Không áp dụng | Batch/file transcript, VERBATIM có thể yêu cầu word timestamps; vi-VN được liệt kê | ⚪ | Không có | Cao cho guide, account chưa test | Dùng VERBATIM cho transcript/alignment |
| Google `gemini-3.5-transcribe-live` | Realtime text transcription | Có interim/final và utterance-level timestamps, không word-level timestamps | ⚪ | Không có | Cao cho guide, Preview | Dùng cho live transcript, không dùng làm word alignment |
| Google `gemini-3.1-flash-tts-preview` | Không áp dụng | ⚪ | Text-only input/audio-only output, stream event và PCM WAV 24 kHz | Không có | Cao cho guide, Preview | Chia text ngắn và retry lỗi theo docs |
| Google `gemini-3.1-flash-live-preview` | Audio conversation qua Live API | Có output audio transcription nếu bật, không phải pronunciation assessment | Raw PCM audio conversation | Không có | Cao cho guide, Preview | Input PCM16 16 kHz, output 24 kHz; client phải parse mọi content part |
| Azure Speech Pronunciation Assessment | Không áp dụng | STT và assessment path riêng, có phoneme/word/syllable/full-text score | Azure Speech có path riêng trong audit | Có Accuracy, Fluency, Completeness, Prosody, PronScore và miscue theo ReferenceText | Cao cho assessment docs, region/tier/quality chưa test | MVP scoring cho clip ngắn; Prosody/IPA giới hạn en-US |
| ElevenLabs `scribe_v2_realtime` | Không áp dụng | Committed transcript có word/character timestamps khi bật `include_timestamps` | ⚪ | Không có | Cao cho realtime docs, vi-VN/account chưa test | Partial chỉ tạm thời; timestamp đến sau commit |
| Deepgram Nova-3 / Flux | Không áp dụng | Nova-3 có Vietnamese; Flux/Nova response có word start/end và word confidence | ⚪ | Không có | Cao cho docs/pricing, account chưa test | Nova-3 cho vi; Flux cho turn detection, không dùng confidence để chấm phát âm |
| Ollama | `ChatOllama` native và `GET /api/tags` discovery | ⚪ Không phải STT provider | ⚪ | ⚪ | Cao cho docs, server/model chưa runtime test | Giữ `ChatOllama`; không dùng generic Responses path cho local |
| LM Studio | `/v1/models`, `/v1/chat/completions` và `/v1/responses`; structured output phụ thuộc model | ⚪ Không phải STT provider | ⚪ | ⚪ | Cao cho docs, server/model chưa runtime test | Optional OpenAI-compatible provider; discovery path riêng |
| Local STT: Echogarden + whisper.cpp | Không áp dụng | Local native executable đã có Apple Silicon backend; Enjoy có transcript/timeline normalization | Không áp dụng | Không áp dụng | Cao cho source path, runtime chưa test | Giữ đường hiện tại; không thêm Python/JS WASM trong phase nhỏ |
### Capability và structured output

OpenAI phân biệt JSON mode với schema enforcement. JSON mode có thể trả JSON hợp lệ nhưng không ép schema; Responses dùng `text.format`, Chat Completions dùng `response_format`, và client phải validate cũng như xử lý incomplete output ([OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)).

Anthropic native map schema sang `output_config.format` với `type: "json_schema"`, tools dùng `input_schema` và event native khác OpenAI chunks ([Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create)). Gemini compatibility có ví dụ `parse` và `zodResponseFormat`, nhưng native Interactions API là contract riêng ([Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai), [Gemini Getting started](https://ai.google.dev/gemini-api/docs/get-started)). OpenRouter yêu cầu kiểm tra `supported_parameters` và có thể đặt `require_parameters=true`; strict enforcement không giống nhau ở mọi provider ([OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)). DeepSeek chỉ được bảng giá ghi là JSON Output, chưa đủ cho strict JSON Schema. Groq page hiện tại không cung cấp matrix structured output theo model.

Quyết định implementation đợt này dùng shared LangChain factory cho OpenAI, Gemini, DeepSeek, OpenRouter, Ollama và LM Studio cùng EnjoyAI. Claude đi qua OpenRouter trong đợt này. Anthropic native, Groq và realtime là roadmap. TTS và file STT đã có code/mock trong candidate; Azure Pronunciation Assessment là scoring path hiện có. Chỉ scorer/provider mới, native offline scoring và realtime audio vẫn cần fixture, E2E và account evidence riêng.

### Protocol mode và proxy guard

Factory phải nhận protocol mode tường minh theo route: `chat_completions`, `responses` hoặc adapter native. OpenAI-compatible provider và proxy chưa có Responses endpoint đã xác minh phải bị ép về Chat Completions. `useResponsesApi: false` chỉ là một option, không phải hard lock, vì LangChain có thể tự chuyển route khi request chứa built-in tools hoặc kwargs riêng của Responses. Route tương thích vì thế không được nhận hoặc phải loại `previous_response_id`, `text`, `truncation`, `include` và built-in tools; nếu proxy không hỗ trợ `stream_options` thì truyền `streamUsage: false`. Không tự đưa các field này vào compatible route.

Trong candidate hiện tại, factory chỉ nhận bounded options, không expose tools hoặc Responses-only kwargs; route proxy đặt `streamUsage: false`, và serialized-request test đã PASS. Test này chứng minh request không bị chuyển ngoài ý muốn sang `/responses`, nhưng không chứng minh provider thật hoặc account access. Nếu sau này mở tools hoặc raw Responses, phải thêm adapter contract và test riêng thay vì suy ra parity từ option hiện có.

Luồng chung nên buffer stream, normalize text/tool/completion/error events, rồi chạy Zod validation trước khi đưa dữ liệu vào lesson state. JSON parse thành công không đồng nghĩa object đúng schema.

### Streaming theo tài liệu và trạng thái app

OpenAI Responses streaming có các event typed như `response.output_text.delta`, `response.completed` và error. Anthropic Messages stream qua SSE và SDK có async iterable/helper. Gemini, OpenRouter và DeepSeek có tài liệu `stream` ở compatibility hoặc chat API. Groq page được chọn nói mostly compatible nhưng không đủ để kết luận stream chat cho mọi model. Vì vậy adapter phải coi streaming là capability per route, không phải thuộc tính mặc định của mọi OpenAI-compatible provider.

Architecture audit là baseline trước source factory change: snapshot đó chưa có `.stream(` trong `enjoy/src`, chưa có `bindTools`, `AgentExecutor`, `createToolCallingAgent`, `tool_choice` hoặc tool declarations. Các call chat trong snapshot là `invoke` hoặc `ConversationChain.call`, còn `withStructuredOutput` chỉ xuất hiện trong JSON command. Đây là bằng chứng trước thay đổi, không phải kết luận về code sau source factory. Type của dependency có `tools` và `response_format` cũng không tự chứng minh capability runtime.

## Audit code baseline trước thay đổi

Audit source ngày 2026-09-06 được lưu tại [`architecture-baseline.md`](/Users/ethan/VibeCoding/everyone-can-use-english/docs/research/ai-modernization/architecture-baseline.md). Đây là baseline workspace trước source factory change, không phải URL vendor và không chứa credential value.

### Các mặt phẳng chat

- Trong baseline, Local Conversation và Chat Session chạy trong renderer bằng LangChain. `ChatOpenAI` được dùng cho EnjoyAI và OpenAI; `ChatOllama` chỉ được dùng trong Conversation cũ. Các call hoàn tất một lần.
- Trong baseline, màn hình LLM Chat cũ gọi REST server qua `webApi.createLlmMessage`, tách khỏi provider local và LangChain. Không gộp đường server legacy vào factory phase đầu.
- Trong baseline, commands text và JSON tạo `ChatOpenAI` riêng ở nhiều callsite. JSON command dùng OpenAI Chat Completions JSON mode và có fallback model `gpt-4o`; chưa có Responses parser hoặc tool executor.
- Trong baseline, registry có `enjoyai`, `openai`, `ollama` ở Conversation, trong khi default engine settings còn khóa `enjoyai | openai`. Thêm provider ID mới vì thế chạm types, Zod schema, settings, migration và runtime branch.

### Speech và pronunciation đang tồn tại

| Luồng | Bằng chứng source audit | Hệ quả |
|---|---|---|
| Local STT | `use-transcribe.tsx` gọi `EnjoyApp.echogarden.recognize`; main dùng packaged whisper.cpp executable trên darwin | Giữ local STT hiện tại và kiểm tra runtime riêng |
| OpenAI STT | Renderer gọi `audio.transcriptions.create` với `whisper-1`, `verbose_json` và word/segment timestamps rồi normalize timeline | Đây là đường legacy có timestamp; deprecation/replacement cần theo dõi |
| Cloudflare/Azure STT | Có dispatch riêng theo enum, token flow và output normalization riêng | Không trộn vào chat provider factory |
| OpenAI/Azure TTS | Renderer dispatch theo model prefix; main `Speech.generate` lại có đường legacy riêng | Provider TTS mới phải route theo engine/capability, không chỉ thêm model prefix |
| Pronunciation | Active hook dùng Azure `pronunciation_assessment`, one-shot/continuous và lưu result schema Azure-specific | Không thêm pronunciation provider vào phase chat; cần normalization/schema riêng |

Audit ghi `STT`, `TTS` và pronunciation là các contract riêng. Ma trận provider phía trên chỉ điền capability speech khi ledger hoặc code evidence xác nhận, không suy ra speech từ chat model.

## Speech research đã hợp nhất

Speech được tách thành bốn contract: transcript, alignment, pronunciation scoring và speech generation. ASR confidence hoặc word confidence chỉ mô tả tín hiệu nhận dạng hoặc turn detection, không phải điểm phát âm. Trong source set hiện tại, Azure Pronunciation Assessment là đường có score trực tiếp; OpenAI, Gemini, ElevenLabs và Deepgram cung cấp ASR, timestamp, TTS hoặc realtime transport với giới hạn riêng ([Azure Pronunciation Assessment](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment), [Deepgram Nova-3 và Flux](https://developers.deepgram.com/docs/flux/nova-3-migration)).

### File transcript và word alignment

- Để thay `whisper-1` mà vẫn giữ word/segment timeline, OpenAI API reference hiện liệt kê `POST /audio/transcriptions` với model `gpt-transcribe`, `response_format=verbose_json` và `timestamp_granularities=[word, segment]`. Schema verbose có `words` với `start/end/word` và `segments` với `start/end/text`. Candidate đã có code/mock cho payload này; fixture model-specific và paid request chưa chạy, nên vẫn giữ Echogarden DTW fallback ([Create transcription](https://developers.openai.com/api/reference/python/resources/audio/subresources/transcriptions/methods/create), [GPT-Transcribe model](https://developers.openai.com/api/docs/models/gpt-transcribe)).
- Không dùng `include=["logprobs"]` làm confidence cho `gpt-transcribe`: reference hiện chỉ giới hạn logprobs cho family `gpt-4o-transcribe` cũ. Nếu provider bổ sung confidence về sau, lưu nó trong field riêng với pronunciation score ([Create transcription](https://developers.openai.com/api/reference/python/resources/audio/subresources/transcriptions/methods/create)).
- Gemini `gemini-3.5-transcribe` có hai chế độ: VERBATIM giữ filler, repetition và false start để đối chiếu lời nói; SMART làm sạch disfluency, spoken correction và grammar nhưng không tương thích timestamp hoặc diarization. Vì vậy dùng VERBATIM cho ground truth alignment và SMART chỉ cho transcript dễ đọc ([Gemini audio transcription](https://ai.google.dev/gemini-api/docs/transcribe)).
- Với realtime alignment, ElevenLabs `scribe_v2_realtime` trả committed transcript kèm word/character timestamps khi bật `include_timestamps`; Deepgram Nova-3 có Vietnamese và Flux/Nova response có word start/end cùng word confidence. Confidence này vẫn là ASR hoặc turn signal, không phải pronunciation quality ([ElevenLabs realtime STT](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime), [Deepgram models and languages](https://developers.deepgram.com/docs/models-languages-overview/), [Deepgram Nova-3 to Flux](https://developers.deepgram.com/docs/flux/nova-3-migration)).

### Realtime, codec và credential boundary

OpenAI `gpt-live-transcribe` dùng realtime transcription với transcript delta nhưng guide ghi không có word-level timestamps, speaker labels hoặc transcription confidence. OpenAI Realtime guide khuyến nghị WebRTC cho browser/mobile, WebSocket cho server media pipeline và ephemeral client secret cho client; standard key phải ở server ([GPT Live Transcribe](https://developers.openai.com/api/docs/models/gpt-live-transcribe), [Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription), [Realtime API](https://developers.openai.com/api/docs/guides/realtime)).

Gemini Live dùng raw little-endian PCM16, native input 16 kHz và output 24 kHz; audio-only session mặc định 15 phút. Live Transcribe dùng `gemini-3.5-transcribe-live`, có interim/final transcript, vi-VN và utterance-level timestamps nhưng không word-level timestamps. Đây là Preview surface, không phải SLA ([Gemini Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities), [Gemini Live Transcribe](https://ai.google.dev/gemini-api/docs/live-api/live-transcribe)).

### Pronunciation MVP

Azure Pronunciation Assessment nhận ReferenceText cho scripted reading và có Granularity Phoneme, Word hoặc FullText cùng Accuracy, Fluency, Completeness, PronScore, tùy chọn Prosody và EnableMiscue. Audio hơn 30 giây cần continuous mode, trong đó EnableMiscue có giới hạn; Prosody và tên phoneme hoặc IPA bị giới hạn ở en-US. Bảng locale có vi-VN, nhưng không được suy ra rằng vi-VN có cùng IPA hoặc prosody coverage như en-US ([Pronunciation Assessment](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment), [Speech language support](https://learn.microsoft.com/en-us/azure/ai-services/Speech-Service/language-support)).

Decision bounded: phase scoring dùng clip 10-30 giây, ReferenceText và locale en-US hoặc en-GB, Granularity Phoneme hoặc Word. Chỉ bật Prosody cho en-US. Lưu score Azure trong schema riêng và ghi rõ provider; không dùng ASR confidence hoặc TTS output để tạo PronScore.

### TTS, language và chi phí

OpenAI `gpt-4o-mini-tts` có text input hoặc audio output; TTS guide liệt kê voice, accent, emotion, speed control và audio formats, nói support chung bao gồm Vietnamese nhưng tối ưu voice cho English. Model card ghi 0.60 USD trên 1M text input tokens và 12 USD trên 1M audio output tokens. Gemini `gemini-3.1-flash-tts-preview` có English và Vietnamese, stream output PCM WAV 24 kHz, nhưng là Preview và text dài có thể drift nên chia nhỏ ([OpenAI TTS guide](https://developers.openai.com/api/docs/guides/text-to-speech), [OpenAI GPT-4o Mini TTS](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts), [Gemini TTS](https://ai.google.dev/gemini-api/docs/speech-generation?hl=en)).

Giá speech đã fetch là snapshot tham khảo: OpenAI `gpt-transcribe` 0.0045 USD/phút, `gpt-live-transcribe` 0.017 USD/phút; Gemini batch transcribe khoảng 0.005 USD/phút và live khoảng 0.009 USD/phút theo token estimate; ElevenLabs Scribe v2 Realtime khoảng 0.0065 USD/phút; Deepgram Nova-3 và Flux có promotional và regular rates thay đổi. Azure cần quote region hoặc tier. Không quy đổi TTS token price thành phút audio và không coi list price là Enjoy invoice ([GPT-Transcribe](https://developers.openai.com/api/docs/models/gpt-transcribe), [GPT Live Transcribe](https://developers.openai.com/api/docs/models/gpt-live-transcribe), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [ElevenLabs pricing](https://elevenlabs.io/pricing/api?price.section=speech_to_text), [Deepgram pricing](https://deepgram.com/pricing)).

### Speech route recommendation

1. Giữ Echogarden + whisper.cpp cho local STT và DTW fallback.
2. Giữ file transcript adapter theo schema OpenAI `gpt-transcribe` đã có code/mock. Chỉ báo native timestamps đã PASS sau fixture model-specific và paid request phù hợp; nếu fixture không khớp, giữ path cũ.
3. Dùng Azure Pronunciation Assessment làm scoring MVP có ReferenceText. Tách score schema khỏi transcript schema.
4. Dùng Gemini VERBATIM hoặc OpenAI file transcript cho batch review; dùng ElevenLabs hoặc Deepgram khi cần realtime word timing. Dùng SMART chỉ cho lớp hiển thị.
5. Để realtime conversation ở phase sau, qua audio gateway chuẩn hóa mono PCM16, sample rate, duration và timestamp origin. Browser chỉ nhận ephemeral token hoặc đi qua server proxy.

Các kết luận speech vẫn là vendor contract. Không có paid speech call, không có fixture model-specific cho `gpt-transcribe`, không có benchmark vi-VN hoặc pronunciation quality, và không có account hoặc quota evidence. Các kết luận gộp nhiều provider được ghi trong `sources.json` dưới `comparison.comparison_records` với `evidence_urls`; fact của từng URL chỉ giữ claim source-local.


### Settings, persistence và credential boundary

- `UserSetting` lưu key/value dạng SQLite `TEXT` và parse JSON. GPT, STT, TTS và profile dùng các setting key riêng; `Conversation`/`Chat`/`ChatMember` còn lưu config JSON với type chưa thống nhất.
- `Conversation.migrateToChat` chỉ giữ một số engine và có thể thay provider khác bằng default user engine; thêm `ollama` hoặc provider mới phải có migration regression.
- Message không lưu provider/model provenance riêng, nên audit reply hiện tại không biết response đi qua provider nào.
- Key hiện được gắn vào config renderer; OpenAI STT/TTS bật `dangerouslyAllowBrowser: true`. Chưa có AI request/stream IPC trong `main/window.ts` và preload. Main TTS lại đọc legacy settings riêng.

Phạm vi nhỏ có thể tiếp tục typed provider settings và giữ compatibility migration. Provider mới có credential riêng hoặc Responses path nên cân nhắc main-process broker theo từng adapter, nhưng không mở rộng thành rewrite toàn app.

### Dependency và package boundary

Audit snapshot đọc `@langchain/openai` `0.4.4` transitive, `@langchain/core` `0.3.42` và `openai` `4.87.3`. Sau snapshot, root đã pin `@langchain/openai` `0.4.6` trực tiếp, giữ core và OpenAI SDK hiện tại, install PASS khoảng 3 giây với peer warnings hiện hữu. TypeScript, provider helper và localization 991 key PASS; runtime 21 trường hợp, migration 12 trường hợp và speech 9 trường hợp PASS. Review độc lập Task1, Task2, Task2b và Task3 đều PASS. Build/package và packaged verifier PASS. Packaged smoke E2E đạt 6 PASS với 3 native opt-in bị skip; AI settings E2E đạt 2 PASS, gồm bootstrap cấu hình cũ, key isolation, GPT/TTS/STT và khởi động lại. Các kiểm thử dùng transport giả và profile cô lập, chưa xác nhận quyền tài khoản provider, phản hồi model trả phí hoặc chất lượng học Anh-Việt. Source 0.4.6 có `useResponsesApi`, `responseApiWithRetry` và `client.responses.create/parse`; source 0.6.0 lại yêu cầu core `>=0.3.58` và OpenAI SDK `^5.3.0`, nên không phù hợp narrow upgrade hiện tại.

Vercel AI SDK OpenAI-compatible có adapter riêng nhưng README hiện yêu cầu Node.js 22 trở lên, còn Electron 34 embedded Node là 20.x. Đây là lý do giữ LangChain seam cho phase 1 và defer AI SDK rewrite.

### Mode, key, billing và dữ liệu

| Mode | Ai sở hữu credential và trả phí | Dữ liệu đi đâu | Lưu trữ và boundary settings hiện tại | Provenance cần lưu |
|---|---|---|---|---|
| `byok_cloud` | Người dùng tự nhập provider key và trả invoice trực tiếp cho provider | Prompt, lesson context hoặc audio rời thiết bị tới provider đã chọn | Retention theo policy và contract của provider. Audit baseline cho thấy key còn đi qua settings renderer và chưa có broker chung | `provider`, model ID, protocol, thời điểm gọi và usage của response |
| `app_or_proxy_cloud` | Enjoy hoặc proxy vận hành sở hữu key và trả phí provider; người dùng không được suy ra API credit từ ChatGPT/Codex | Dữ liệu đi qua app/proxy rồi tới provider; retention theo contract của cả hai lớp | Legacy REST server và renderer config vẫn là hai boundary trong baseline. Client chỉ nên nhận ephemeral credential khi provider hỗ trợ; không ghi key vào log | `provider`, proxy route, model ID, request ID, usage và policy version |
| `local` | Người dùng sở hữu máy hoặc endpoint local, model và chi phí phần cứng/điện | Inference đi tới endpoint do người dùng cấu hình, có thể là localhost hoặc máy khác. Enjoy vẫn có thể dùng login và nội dung online | Model download, RAM, endpoint và license do người dùng chịu trách nhiệm; không suy ra toàn app offline hoặc mọi dữ liệu luôn ở máy | `local provider`, endpoint, model ID, quantization nếu có và thời điểm gọi |

`UserSetting` hiện được audit là SQLite `TEXT` được parse JSON, credential theo profile có thể nằm trong cấu hình renderer, chưa có keychain hoặc broker chung. Đây là trạng thái baseline cần được giữ rõ trong UX cho tới khi boundary khác được triển khai. Mode matrix này là contract để tách BYOK, app/proxy và local, không phải bằng chứng rằng các provider đã được gọi thật. Catalog, list price, supported territory và Codex quota không xác lập Enjoy entitlement hoặc invoice cost. OpenAI retention cũng cần đọc theo endpoint và account policy, không viết thành zero-retention guarantee.

## Local provider và adapter framework

### Ollama

Ollama `GET /api/tags` trả danh sách `models[]` với name, size, digest, family, parameter size và quantization. Đây là contract phù hợp với model picker hiện có. `GET /api/ps` có thể cho biết model đang chạy, nhưng chưa cần cho picker tối thiểu ([Ollama List models](https://docs.ollama.com/api/tags), [Ollama running models](https://docs.ollama.com/api/ps)).

Ollama hỗ trợ một phần OpenAI API qua `http://localhost:11434/v1/` với apiKey placeholder bị bỏ qua ở local. Responses API chỉ có non-stateful flavor, không có `previous_response_id` hoặc `conversation`; các capability chat, streaming, JSON mode, vision, tools và reasoning còn phụ thuộc model/runtime ([Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)). Enjoy đã có `ChatOllama`, base URL và `/api/tags` discovery theo audit, nên Ollama là local LLM có change cost thấp nhất. Không tự pull model, start service hoặc chọn model theo RAM.

Trên macOS, tài liệu Ollama yêu cầu Sonoma 14 trở lên và hỗ trợ CPU/GPU cho Apple M series; model có thể có kích thước từ hàng chục đến hàng trăm GB ([Ollama on macOS](https://github.com/ollama/ollama/blob/main/docs/macos.mdx)). Runtime Ollama công bố MIT, còn license model weights phải xem riêng ([Ollama license](https://github.com/ollama/ollama/blob/main/LICENSE)).

### LM Studio

LM Studio có native REST v1 với `/api/v1/chat`, `/api/v1/models`, load và unload, cùng OpenAI-compatible `/v1/models`, `/v1/chat/completions`, `/v1/responses` và `/v1/embeddings` ([LM Studio REST API](https://lmstudio.ai/docs/developer/rest), [LM Studio OpenAI compatibility](https://lmstudio.ai/docs/developer/openai-compat)). Native `/api/v1/models` có metadata giàu hơn như quantization, size, params, loaded instances, context length và capabilities; OpenAI `/v1/models` là catalog visible và có thể bị ảnh hưởng bởi JIT loading ([LM Studio model list](https://lmstudio.ai/docs/developer/rest/list), [LM Studio OpenAI model list](https://lmstudio.ai/docs/developer/openai-compat/models)).

Structured output của LM Studio nhận JSON schema ở `/v1/chat/completions`, nhưng tài liệu cảnh báo không phải model nào cũng hỗ trợ, nhất là model dưới 7B ([LM Studio Structured Output](https://lmstudio.ai/docs/developer/openai-compat/structured-output)). Local chat, chat với documents và local server có thể hoạt động offline sau khi model đã có; catalog, download, runtime và app update vẫn có điều kiện internet ([LM Studio offline](https://lmstudio.ai/docs/app/offline)). Tài liệu yêu cầu macOS 14 và hỗ trợ Apple Silicon M1-M4, khuyến nghị 16 GB RAM; máy 8 GB chỉ phù hợp model nhỏ/context vừa phải ([LM Studio system requirements](https://lmstudio.ai/docs/app/system-requirements)).

Kết luận: LM Studio là provider tùy chọn sau Ollama, bắt đầu bằng `/v1/models` và Chat Completions. Native stateful Responses chỉ mở khi UX cần `loaded_instances`, context guard hoặc server-side state.

### Local STT và các lựa chọn speech

whisper.cpp hỗ trợ Apple Silicon với ARM NEON, Accelerate, Metal và Core ML. README đưa bảng memory xấp xỉ theo model: tiny 273 MB, base 388 MB, small 852 MB, medium 2.1 GB và large 3.9 GB; đây là xấp xỉ model, không phải tổng footprint của Electron ([whisper.cpp README](https://github.com/ggml-org/whisper.cpp/blob/master/README.md?plain=1)). Code audit xác nhận Enjoy đã đóng gói native whisper.cpp qua Echogarden trên darwin và normalize transcript/timeline, nên giữ đường này cho local STT. Code repository và license whisper.cpp là MIT, còn weights cần kiểm tra riêng ([whisper.cpp license](https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE)).

Binding JavaScript của whisper.cpp được README gọi là rất sơ khai và yêu cầu Emscripten, nên thay native executable bằng JS/WASM trong phase nhỏ sẽ tăng packaging surface ([whisper.cpp JavaScript binding](https://github.com/ggml-org/whisper.cpp/blob/master/bindings/javascript/README.md)). faster-whisper yêu cầu Python >=3.9, CPU int8 có tài liệu, còn GPU path tập trung NVIDIA CUDA; package metadata ghi MIT và Development Status Beta ([faster-whisper README](https://github.com/SYSTRAN/faster-whisper/blob/master/README.md?plain=1), [faster-whisper package metadata](https://github.com/SYSTRAN/faster-whisper/blob/master/setup.py)). Không có Apple Metal path được README faster-whisper xác nhận, nên defer.

Apple `SFSpeechRecognizer` cho phép yêu cầu on-device khi thiết bị hỗ trợ, nhưng tài liệu cảnh báo on-device có thể kém chính xác hơn và nếu capability không có thì recognizer cần network ([SFSpeechRecognizer](https://developer.apple.com/documentation/speech/sfspeechrecognizer), [Require on-device recognition](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition), [On-device capability](https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition)). Đây là option native macOS ở phase riêng, chưa thay Echogarden.

### Adapter framework và version boundary

`@ai-sdk/openai-compatible` của Vercel cung cấp factory với `baseURL`, `name`, `apiKey` và `chatModel(modelId)`, nhưng không tự discovery model; license repository là Apache-2.0 ([Vercel OpenAI-compatible provider](https://github.com/vercel/ai/blob/main/packages/openai-compatible/README.md), [Vercel AI SDK license](https://github.com/vercel/ai/blob/main/LICENSE)). README AI SDK hiện yêu cầu Node.js 22, trong khi Electron 34 embedded Node là 20.x ([AI SDK runtime README](https://raw.githubusercontent.com/vercel/ai/main/packages/ai/README.md), [Electron 34 release](https://www.electronjs.org/blog/electron-34-0)). Vì vậy chưa thêm Vercel AI SDK trong phase 1.

LangChain JS có ChatOllama native và ChatOpenAI custom base URL, nhưng docs nói ChatOpenAI nhắm OpenAI API spec chính thức, còn field không chuẩn của provider thứ ba có thể không được giữ hoặc extract ([ChatOllama integration](https://docs.langchain.com/oss/javascript/integrations/chat/ollama), [ChatOpenAI integration](https://docs.langchain.com/oss/javascript/integrations/chat/openai)). Tagged `@langchain/openai` 0.4.6 có `useResponsesApi` và peer khớp core 0.3.42/OpenAI 4.87.3; source audit cho thấy root đã pin 0.4.6 trực tiếp. Tagged 0.6.0 yêu cầu core >=0.3.58 và OpenAI SDK >=5.3.0, nên chưa thuộc narrow upgrade hiện tại ([LangChain 0.4.6 package](https://raw.githubusercontent.com/langchain-ai/langchainjs/54f7314a56185bcf52d832148a9f08b961f574bf/libs/langchain-openai/package.json), [LangChain 0.4.6 ChatOpenAI source](https://raw.githubusercontent.com/langchain-ai/langchainjs/54f7314a56185bcf52d832148a9f08b961f574bf/libs/langchain-openai/src/chat_models.ts), [LangChain 0.6.0 package](https://raw.githubusercontent.com/langchain-ai/langchainjs/d196784931ee92f2a58e1af33f99fb5cb19bc68d/libs/langchain-openai/package.json)).

| Quyết định local/adapter | Lý do | Confidence |
|---|---|---|
| Giữ Ollama + ChatOllama | Đã có constructor, base URL và `/api/tags` discovery; change cost thấp | Cao cho source fit, runtime chưa test |
| Thêm LM Studio sau Ollama | Có `/v1/models` và Chat Completions; cần discovery path riêng | Trung bình, runtime chưa test |
| Giữ Echogarden + whisper.cpp | Native path đã đóng gói, Apple backend phù hợp | Cao cho source path, runtime chưa test |
| Defer faster-whisper | Python/sidecar và CUDA focus làm tăng packaging | Cao cho scope trade-off |
| Defer Apple Speech on-device | Native bridge, permission và accuracy caveat | Cao cho scope trade-off |
| Defer Vercel AI SDK | Runtime Node 22 requirement và thêm abstraction | Cao cho version boundary |

## 3. Endpoint, dữ liệu và credential isolation

Các contract auth đã đọc:

| Provider | Endpoint hoặc SDK evidence | Key/header evidence | Xử lý trong Enjoy |
|---|---|---|---|
| OpenAI | Responses và Chat Completions theo model/guidance | OpenAI docs được đọc; account access chưa test | Giữ key OpenAI hiện tại, thêm route Responses có capability guard |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/`; native REST có `/v1beta/interactions` | `x-goog-api-key`, `GEMINI_API_KEY` trong Getting started | Lưu riêng Gemini key, không mang key OpenAI sang endpoint Gemini |
| Anthropic | `POST https://api.anthropic.com/v1/messages`; `@anthropic-ai/sdk` | `X-Api-Key`, `anthropic-version` | Gọi từ Electron main process; không bật browser support |
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | Bearer `OPENROUTER_API_KEY` | Lưu riêng OpenRouter key và canonical slug |
| DeepSeek | `https://api.deepseek.com`; Anthropic base `/anthropic` | Bearer `DEEPSEEK_API_KEY` | Lưu riêng DeepSeek key; validate stream/error |
| Groq | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` | Optional, key riêng, map field gaps |
| Ollama/LM Studio | `http://localhost:11434` và `http://localhost:1234/v1` theo docs | Placeholder local hoặc token riêng nếu bật authentication | Giữ cấu hình local riêng; runtime/server/model chưa test |

OpenAI ghi API data không được dùng để train theo mặc định, standard abuse-monitoring retention có thể là 30 ngày, và `store:false` không phải zero-retention guarantee ([OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data), [Responses migration](https://developers.openai.com/api/docs/guides/migrate-to-responses)). Điều này chỉ hỗ trợ quyết định cấu hình dữ liệu, không phải lời hứa retention cụ thể cho mọi account.

Anthropic SDK tắt browser support mặc định để tránh lộ secret và chỉ mở bằng `dangerouslyAllowBrowser`; tài liệu ghi Node.js 20 LTS hoặc mới hơn cho runtime Node ([Anthropic TypeScript SDK](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript)). Trong app Electron, provider calls nên nằm ở main process hoặc IPC đã giới hạn. Key được lưu theo provider và không được thay đổi khi người dùng chuyển model.

## 4. Model lifecycle và version lock

| Provider | Tín hiệu lifecycle | Quy tắc catalog |
|---|---|---|
| OpenAI | Catalog riêng và deprecations; `chatgpt-4o-latest` đã retired ngày 2026-02-17; docs nêu whisper-1/4o transcription retirement ngày 2027-02-26 | Lưu model ID cụ thể và protocol; không suy ra API credit từ ChatGPT/Codex subscription |
| Gemini | Stable, Preview, Latest, Experimental; Previous models có ID deprecated hoặc shut down | Pin Stable ID như `gemini-3.8-flash`; không dùng Preview, Experimental hoặc Latest làm default |
| Anthropic | Active, Legacy, Deprecated, Retired; partner platform có lịch riêng | Đọc lifecycle trước release; không dùng retired ID; giữ model ID pinned |
| OpenRouter | Catalog động có `canonical_slug` và `expiration_date`; alias `~openai/gpt-latest` có thể đổi mà không redeploy | Pin canonical slug và query capability trước route |
| DeepSeek | V4 model slug gọi version nội bộ cập nhật, vision experimental | Không dùng `deepseek-v4-flash-vision-exp` làm chat default |
| Groq | Compatibility page không đủ model lifecycle | Chưa chốt model ID cho production |

Anthropic model ID có thể là fixed snapshot theo tài liệu, nhưng serving infrastructure quanh ID vẫn có thể thay đổi. OpenRouter alias latest có chủ ý hot-swap, phù hợp thử nghiệm catalog nhưng làm giảm khả năng tái lập fixture học tập. `model_lifecycle` cần nằm trong capability map để catalog refresh không tự thay model đang lưu của user.

## 5. Chi phí và vai trò sử dụng

Giá dưới đây là giá niêm yết đã đọc trong tài liệu tại ngày 2026-09-06. Chưa có token usage thực tế, cache pattern, batch, quota account hoặc currency conversion, nên không tính tổng chi phí Enjoy.

| Provider/model | Giá input | Giá output | Vai trò đề xuất theo contract | Mức chưa biết |
|---|---:|---:|---|---|
| OpenAI GPT-5.6 Luna | 0.20 USD / 1M token | 1.20 USD / 1M token | Routine chat candidate, theo thiết kế | Account access, quota, EN-VI quality |
| OpenAI GPT-5.6 Terra | 2 USD / 1M token | 12 USD / 1M token | Opt-in reasoning route | Account access, quality, latency |
| OpenAI GPT-6 Astra | 10 USD / 1M token | 50 USD / 1M token | Optional high-cost route | Account access, usage cost thực tế |
| Anthropic Fable 5.1 | 10 USD / 1M token | 50 USD / 1M token | Không cần đưa vào default khi chưa có use case | Availability, quality |
| Anthropic Opus 5 | 5 USD / 1M token | 25 USD / 1M token | Optional native high-cost route | Availability, quality |
| Anthropic Sonnet 5 | 2 USD / 1M token | 10 USD / 1M token | Native structured/tool route | Availability, quality |
| Anthropic Haiku 4.5 | 1 USD / 1M token | 5 USD / 1M token | Cost-sensitive native route | Availability, quality |
| Google Gemini `gemini-3.8-flash` | Chưa có trong ledger hiện tại | Chưa có trong ledger hiện tại | Integration-first candidate | Pricing/quota/account |
| OpenRouter | Theo model/top provider metadata | Theo model/top provider metadata | Fallback/catalog experiment | Route price, account, expiration |
| DeepSeek V4 Flash | Cache hit 0.007/0.014; miss 0.22/0.44 peak/off-peak | 0.66/1.32 peak/off-peak | Cost candidate sau smoke test | Giá có thể đổi, quality/region |
| DeepSeek V4 Pro | Cache hit 0.022/0.044; miss 0.66/1.32 peak/off-peak | 1.98/3.96 peak/off-peak | Higher-cost optional route | Giá có thể đổi, quality/region |
| Groq | Chưa có trong ledger hiện tại | Chưa có trong ledger hiện tại | Optional sau capability test | Model, price, quota, region |

Không dùng `max reasoning` mặc định chỉ vì orchestration đang chạy Luna max. Reasoning level là request parameter theo model và workload, không phải proxy cho chất lượng dạy Anh-Việt. Khi người dùng đã lưu model, factory giữ lựa chọn đó và chỉ báo lỗi capability rõ ràng nếu request không hợp lệ.

## 6. Bối cảnh Việt Nam và region evidence

| Provider | Evidence về Việt Nam | Điều có thể kết luận | Điều chưa thể kết luận |
|---|---|---|---|
| OpenAI | Vietnam có trong supported API territories | Khu vực có trong danh sách hỗ trợ | Không chứng minh mọi model, quota hoặc account entitlement |
| Google Gemini | Vietnam có trong Available regions | Có evidence khu vực cho AI Studio và Gemini API | Không chứng minh quota, billing, age verification hoặc mọi model/tính năng |
| Anthropic | Chưa có trong shortlist | ⚪ Chưa xác minh | Region/account availability |
| OpenRouter | Chưa có trong shortlist | ⚪ Chưa xác minh | Route, provider và account availability |
| DeepSeek | Chưa có trong shortlist | ⚪ Chưa xác minh | Region, billing và account availability |
| Groq | Chưa có trong shortlist | ⚪ Chưa xác minh | Region, model và account availability |
| Ollama/LM Studio | Chạy local, không phụ thuộc supported API territory | ⚪ Server, model loading và chất lượng chưa runtime test | Model download, RAM, local settings và chất lượng |

Với người dùng tại Việt Nam, Gemini hiện có evidence region rõ nhất trong shortlist. OpenAI có evidence supported territory. Cả hai vẫn cần account smoke test trước khi nói là dùng được trong Enjoy. Không generalize region của Gemini sang Anthropic, OpenRouter, DeepSeek hoặc Groq.

## 7. Alternatives và lý do không chọn

| Option | Vì sao có thể chọn | Vì sao chưa chọn hoặc chỉ giới hạn |
|---|---|---|
| Chỉ sửa model list | Ít code | Không xử lý Responses, sampling, schema và key isolation |
| Shared OpenAI-compatible factory | Giữ phần transport hiện có, hợp với Gemini/DeepSeek/OpenRouter và có thể thử Groq | Phải có capability map, field filtering và normalize event |
| Native SDK cho mọi provider | Giữ contract nguyên bản | Nhiều dependency, nhiều event/error shape, chưa cần cho mọi route |
| Anthropic qua OpenRouter | Thử Claude cùng transport | Không tương đương native Messages; structured output phụ thuộc endpoint/provider, catalog hiện không có `temperature` cho entry Claude đã đọc |
| Rewrite toàn bộ sang AI SDK khác | Có thể mở kiến trúc mới | Chưa có evidence cần thay memory/chains/streaming/speech; tăng migration risk |
| Dùng alias latest | Ít phải cập nhật catalog | Hot-swap làm giảm reproducibility của fixture và lesson |
| Đưa speech vào cùng chat adapter | Có thể kỳ vọng code dùng chung | Speech có codec, timestamp, voice và score schema riêng; Gemini 3.8 Flash card không có audio generation hoặc Live API |

## 8. Mâu thuẫn và cách diễn giải

| Chủ đề | Evidence A | Evidence B | Diễn giải thận trọng |
|---|---|---|---|
| OpenAI protocol | GPT-6 Astra guidance yêu cầu Responses và bỏ nhiều sampling fields | GPT-5.6 guidance khuyến nghị Responses cho reasoning/tools/multiturn, còn đường cũ có thể dùng Chat Completions | Không mâu thuẫn: protocol và field support phụ thuộc model. Factory phải route theo model capability |
| Gemini lifecycle | Models overview phân biệt Stable/Preview/Latest/Experimental | Dedicated `gemini-3.8-flash` card ghi Stable và reject `minimal` | Dedicated page được dùng cho contract model cụ thể; không lấy hành vi của một model để áp cho cả catalog |
| Gemini audio | Gemini 3.8 Flash card ghi text output, không audio generation hoặc Live API | Gemini có model speech riêng cho transcribe, TTS và Live | Không suy ra chat model có speech; route speech phải pin model speech riêng |
| OpenRouter schema | Docs nói structured outputs có thể dùng `json_schema` | Live catalog Claude entry liệt kê `response_format`, `structured_outputs` và không có temperature | Có thể route được theo metadata hiện tại, nhưng provider/endpoint support vẫn conditional và không có runtime proof |
| Anthropic lifecycle | Models overview liệt kê các model current | Deprecations page nói partner Bedrock/Google Cloud có schedule riêng | Chỉ áp lifecycle đã đọc cho Claude API và platform scope tương ứng |
| DeepSeek JSON | Pricing table ghi JSON Output và Tool Calls | Không có strict JSON Schema contract trong facts hiện tại | Chỉ gọi là JSON Output; vẫn validate client và không claim strict schema |
| Billing | OpenAI help tách ChatGPT subscription khỏi API usage | Codex quota reset là một hệ thống khác | Không suy ra Enjoy có API credit hoặc entitlement từ Codex session |

## 9. Negative evidence và claim chưa chứng minh

Các kết luận sau chưa được chứng minh trong ledger hiện tại:

- Không có independent benchmark về độ chính xác tiếng Việt, sửa lỗi Anh-Việt, tự nhiên của ví dụ hoặc hiệu quả học tập.
- Không có paid runtime call để chứng minh account access, quota, billing, latency, stream event thực tế hay error mapping. Đây là giới hạn bằng chứng runtime, không phải điều kiện đóng source research.
- Speech ledger đã được merge. Code audit baseline trước source factory change xác nhận local whisper.cpp và OpenAI STT timestamp path đang tồn tại, cùng Azure STT/TTS/pronunciation paths; provider contract mới vẫn chưa có paid runtime hoặc fixture model-specific.
- `gemini-3.8-flash` không có audio generation hoặc Live API theo dedicated page. Điều này chỉ là negative evidence cho model cụ thể, không áp cho toàn bộ Gemini.
- DeepSeek JSON Output và Groq Responses function calling chưa chứng minh strict JSON Schema cho route chat cụ thể.
- Groq chưa có model ID, price, quota hoặc region evidence trong nguồn đã chọn.
- Anthropic, OpenRouter và DeepSeek chưa có region evidence cho Việt Nam trong shortlist.
- Catalog docs không chứng minh account entitlement. Giá niêm yết không phải invoice hoặc cost estimate.
- Architecture audit đã được merge. Audit là source evidence baseline của workspace, chưa phải runtime validation; các claim về `.stream(`, tool executor hoặc AI request/stream IPC chỉ áp dụng cho snapshot trước source factory change.

## 10. Top 5 adversarial checks

| Claim cần kiểm tra | Counter-question | Kết quả hiện tại |
|---|---|---|
| Gemini 3.8 Flash là integration-first candidate | Có account/quota và quality benchmark không? | Contract, stream/tools/schema và Vietnam region có evidence. Account, quota và EN-VI quality vẫn ⚪ |
| Anthropic có thể đi qua OpenRouter như native | Có parity Messages event, tools và schema không? | Không đủ. OpenRouter docs conditional; native Anthropic adapter vẫn cần cho contract native |
| DeepSeek là lựa chọn tiết kiệm | Giá có ổn định và quality có tương đương không? | Bảng giá có peak/off-peak và cảnh báo giá có thể đổi. Không có quality comparison |
| Chuyển sang Responses là migration đơn giản | LangChain/package hiện tại có hỗ trợ đúng version không? | Audit snapshot là `0.4.4`; root đã pin `@langchain/openai` `0.4.6` với core `0.3.42` và OpenAI `4.87.3`. Install, candidate build/package và packaged verifier PASS; mock/runtime contract PASS, paid provider/account request chưa test |
| `store:false` giải quyết retention | Có phải zero retention guarantee không? | OpenAI docs nói không. Chỉ dùng như request setting, không ghi thành guarantee |

Adversarial source checks xác nhận contract trong tài liệu. Các fixture runtime và packaged E2E đã đạt theo bảng nghiệm thu; payload live model-specific và chất lượng thực tế vẫn chưa được kiểm tra.

## 11. Áp dụng cho Enjoy và roadmap phase 1 bounded

### Cổng trước khi sửa code

1. Giữ speech ledger và architecture audit trong evidence. Source count hiện đã đạt target deep theo unique canonical URL, không padding bằng nhiều trang cùng vendor hoặc repeated fetch.
2. Pin catalog candidates theo model ID cụ thể và ngày xác minh. Giữ model người dùng đã lưu; không tự fallback sang model khác khi schema hoặc reasoning capability không khớp.
3. Xác định package/runtime contract của `@langchain/openai` hiện tại trước khi dùng `useResponsesApi`. Nếu version không đủ, cập nhật có chủ đích hoặc gọi Responses bằng adapter riêng.

### Phase 1: shared factory và contract offline

Phạm vi bounded:

- Tách catalog provider/model, account config và request params.
- Dùng shared LangChain factory cho OpenAI, Gemini, DeepSeek, OpenRouter, Ollama và LM Studio cùng EnjoyAI; Claude đi qua OpenRouter trong đợt này.
- Giữ Ollama bằng adapter native và LM Studio sau discovery; Anthropic native, Groq và realtime là roadmap.
- Dùng shared OpenAI-compatible transport cho Gemini, DeepSeek và OpenRouter; Groq chỉ được xem xét sau capability smoke test.
- Thêm Responses path cho model OpenAI cần Responses; giữ Chat Completions path cho route cũ.
- Lọc `temperature`, `top_p`, `top_logprobs`, `n` và các field khác theo capability map. Không gửi `n > 1` vào route chỉ trả một đáp án.
- Normalize text stream, tool call, completion và error. Buffer structured output và validate Zod trước lesson state.
- Tách key từng provider, gọi cloud provider ở main process/IPC, không ghi prompt hoặc key vào debug log.
- Phase chat factory giữ boundary riêng cho speech. Candidate đã có code/mock cho TTS `gpt-4o-mini-tts` và file STT `gpt-transcribe`; Azure Pronunciation Assessment là scoring path hiện có. Chỉ scorer/provider mới, native offline scoring, realtime audio, fixture model-specific và E2E vẫn là follow-up riêng.

### Nghiệm thu offline

| Scenario | Pass condition | Ý nghĩa |
|---|---|---|
| Provider routing | Mock transport nhận đúng base URL, model và provider key | Chứng minh isolation, chưa chứng minh provider thật |
| Model params | Field không hỗ trợ bị loại; model lưu không bị đổi | Chứng minh capability filtering |
| Text/stream | Mock chunks/events normalize thành text và completion đúng | Chứng minh adapter contract |
| Structured output đúng schema | Zod parse thành công và lesson state được cập nhật | Chứng minh parser/validation |
| Structured output sai schema | State không cập nhật, lỗi hiển thị rõ | Chứng minh failure boundary |
| Request failure | Timeout/status/provider error map đúng | Chứng minh user-visible error |
| Config save | Chỉ báo thành công sau persist; provider switch không mang key cũ | Chứng minh settings flow |
| Ollama/LM Studio error | Connection/model errors không crash renderer | Chứng minh local guard |

Mock contract PASS không phải paid-provider PASS. Runtime smoke test chỉ được gọi PASS sau khi có key/quyền phù hợp và đọc lại response thực tế.

Nghiệm thu implementation cuối: TypeScript, provider helper và localization 991 key PASS; runtime 21 trường hợp, migration 12 trường hợp và speech 9 trường hợp PASS. Review độc lập Task1, Task2, Task2b và Task3 đều PASS. Build/package và packaged verifier PASS. Packaged smoke E2E đạt 6 PASS với 3 native opt-in bị skip; AI settings E2E đạt 2 PASS, gồm bootstrap cấu hình cũ, key isolation, GPT/TTS/STT và khởi động lại. Các kiểm thử dùng transport giả và profile cô lập, chưa xác nhận quyền tài khoản provider, phản hồi model trả phí hoặc chất lượng học Anh-Việt. Đã thay bundle Enjoy và mở lại profile QA hiện có, native UI hiển thị Ethan, đủ 7 provider và giữ cấu hình cũ. Bản trước được giữ làm backup. Xem [nghiệm thu cuối](/Users/ethan/VibeCoding/everyone-can-use-english/.superpowers/sdd/2026-09-06-enjoy-ai-modernization/final-verification.md).

### Phase 2 sau khi có account evidence

- Smoke test từng provider/model được người dùng chọn, đo request shape, stream, tools, schema, usage và error; không dùng install PASS thay cho runtime PASS.
- Xác minh billing/quota/region theo account, không dùng catalog để suy ra entitlement.
- Hoàn tất fixture và E2E cho file STT/TTS đã có code/mock; giữ Azure Pronunciation Assessment làm scoring path hiện có. Chỉ mở scorer/provider mới, native offline scoring hoặc realtime audio route với timestamp, codec, voice và acceptance criteria khi có account evidence.
- Chạy packaged UI/E2E trên app Electron, sau đó mới cân nhắc cập nhật default catalog.

## 12. Giới hạn

- Bản thảo có 93 canonical URL references trong initial source ledger, gồm provider chat, local adapter và speech. Có 94 successful URL records, trong đó một redirect alias không tính source mới; 12 failed URL records tương ứng 13 failed fetch events được tách riêng.
- 93 canonical source references trong initial ledger được phân loại Tier 1 official vendor, repository hoặc API metadata. Đây là phân loại nguồn và contract evidence, không phải claim rằng cả 93 reference có final content verification. Random recheck đã xử lý 36/36 URL được chọn, 35/36 content-verified và 1 not-evaluable; Apple `supportsOnDeviceRecognition` chỉ có metadata.
- Reverification đã merge gồm 56 unique URL groups, 59 per-ledger records và 55 canonical source URLs sau khi loại redirect alias. Vòng random gồm 14 executive URL và 22 URL seeded random từ population 79; 7 record cũ được reuse, 29 record mới có 28 content-verified và 1 not-evaluable. Apple canonical có hai content attempts; DocC JSON fallback có một failed event riêng và không được dùng làm evidence.
- Source dates phần lớn là retrieval date 2026-09-06; một số trang không hiển thị publication/update date. Catalog, giá, rate limit và lifecycle có thể thay đổi.
- Cross-ref giữa nhiều URL cùng vendor không được tính là independent studies. Không dùng số lượng trang để thổi phồng mức độc lập.
- Không có academic API, vì scope đã loại claim clinical và educational-effectiveness. Nếu scope đổi sang đánh giá hiệu quả học tập, phải mở research academic riêng.
- Speech provider ledger đã merge. Các ô vẫn `⚪` chỉ là capability không áp dụng hoặc chưa có evidence cụ thể; account, runtime và quality vẫn chưa xác minh.
- Không chạy retraction check vì ledger không chứa academic papers/DOI; academic API không áp dụng cho scope hiện tại.

## 13. Nhật ký xác minh nguồn

Confidence trong bảng này là mức cho claim contract sau content match của nguồn trực tiếp. 93 canonical source references trong initial ledger là Tier 1 official vendor, repository hoặc API metadata. `🟡` nghĩa là contract được đọc rõ nhưng chưa có independent quality cross-ref hoặc runtime test. Account access và EN-VI quality là `⚪` trừ khi có evidence riêng. Random recheck content verification chỉ đạt 35/36 URL được chọn; Apple capability URL là metadata-only/not-evaluable.

| # | URL | Truy cập | Tier | Nội dung khớp | Cross-ref | Bias flag | Confidence | Ghi chú |
|---:|---|---|---:|---|---|---|---|---|
| 1 | [GPT-5.6 Luna model](https://developers.openai.com/api/docs/models/gpt-5.6-luna) | ✅ | 1 | ✅ | openai | vendor-maintained API contract; quality claims excluded | 🟡 | Supports text/image input, text output, streaming, function calling and structured outputs. Listed text price USD0.20 input and1.20 output per1M tokens. API access and task quality not tested.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 2 | [GPT-5.6 Terra model](https://developers.openai.com/api/docs/models/gpt-5.6-terra) | ✅ | 1 | ✅ | openai | vendor-maintained API contract; quality claims excluded | 🟡 | Listed text price USD2 input and12 output per1M tokens. Reasoning supports none,low,medium,high,xhigh,max. For comparison only, not a latency or EN-VI quality measurement.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 3 | [OpenAI model catalog](https://developers.openai.com/api/docs/models/all) | ✅ | 1 | ✅ | openai, speech | vendor-maintained API contract; quality claims excluded | 🟡 | Catalog lists GPT6Astra, GPT5.6 family and modern audio models. Catalog alone does not establish account entitlement or protocol compatibility.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 4 | [GPT-6 Astra guidance](https://developers.openai.com/api/docs/guides/latest-model) | ✅ | 1 | ✅ | openai | vendor-maintained API contract; quality claims excluded | 🟡 | GPT6Astra tools require Responses; reasoning levels none and minimal unsupported; use low or higher. Remove temperature,top_p,top_logprobs. Use explicit low reasoning for latency-sensitive baseline, not max by; Contract evidence; account, runtime và EN-VI quality chưa test |
| 5 | [GPT-5.6 guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6) | ✅ | 1 | ✅ | openai | vendor-maintained API contract; quality claims excluded | 🟡 | Family alias gpt-5.6 points to Sol. Recommends Responses for reasoning/tools/multiturn. Supports max effort but recommends workload-specific measurement. Replaying stateless history requires outputs including e; Contract evidence; account, runtime và EN-VI quality chưa test |
| 6 | [Responses migration](https://developers.openai.com/api/docs/guides/migrate-to-responses) | ✅ | 1 | ✅ | openai | vendor-maintained API contract; quality claims excluded | 🟡 | Typed items replace choices. Responses store defaults true; use store:false for local-managed history but this is not a zero retention guarantee. Chat tools from GPT5.4 require reasoning none.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 7 | [Deprecations](https://developers.openai.com/api/docs/deprecations) | ✅ | 1 | ✅ | openai, speech | vendor-maintained API contract; quality claims excluded | 🟡 | chatgpt-4o-latest retired2026-02-17. 2026-08-26 announced whisper1/4o transcription retirement2027-02-26, replacement gpt-live-transcribe/gpt-transcribe. Deprecated differs from already removed.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 8 | [Responses streaming](https://developers.openai.com/api/docs/guides/streaming-responses) | ✅ | 1 | ✅ | openai | vendor-maintained API contract; quality claims excluded | 🟡 | SSE typed events include response.output_text.delta, response.completed and errors. Adapter must normalize text/tool events and completion failure.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 9 | [Supported API countries](https://help.openai.com/en/articles/5347006-openai-api-supported-countries-and-territories) | ✅ | 1 | ✅ | openai | vendor-maintained API contract; quality claims excluded | 🟡 | Vietnam appears in supported territories; does not prove access to every model or free API quota.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 10 | [ChatOpenAI integration](https://docs.langchain.com/oss/javascript/integrations/chat/openai) | ✅ | 1 | ✅ | openai, local | vendor-maintained API contract; quality claims excluded | 🟡 | Official integration docs support useResponsesApi since0.4.5-rc.0. Custom URLs and streamUsage:false supported. Installed Enjoy0.4.4 lacks Responses. Docs latest parameters must be verified against chosen insta; Source fit; local server/model/runtime chưa test |
| 11 | [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) | ✅ | 1 | ✅ | openai | vendor-maintained API contract; quality claims excluded | 🟡 | JSON mode returns valid JSON but does not enforce a schema; client validation is required. Responses uses text.format, ChatCompletions uses response_format. Explicit JSON instruction and incomplete-output handl; Contract evidence; account, runtime và EN-VI quality chưa test |
| 12 | [API data controls](https://developers.openai.com/api/docs/guides/your-data) | ✅ | 1 | ✅ | openai | vendor-maintained API contract; quality claims excluded | 🟡 | OpenAI says API data is not used for training by default. Standard abuse-monitoring retention may be30days; store:false is not a zero-retention guarantee.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 13 | [GPT-6 Astra model](https://developers.openai.com/api/docs/models/gpt-6-astra) | ✅ | 1 | ✅ | openai | vendor policy and price statement; quality claims excluded | 🟡 | Text price USD10 input,50 output per1M tokens at standard short-context rates. No audio input/output. High-cost optional model, not an automatic tutoring default.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 14 | [ChatGPT and API billing](https://help.openai.com/en/articles/9039756) | ✅ | 1 | ✅ | openai | vendor policy and price statement; quality claims excluded | 🟡 | Official help separates ChatGPT subscription billing and API usage. A Codex quota reset is not evidence of Enjoy API credit or entitlement.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 15 | [Models overview](https://platform.claude.com/docs/en/models/overview) | ✅ | 1 | ✅ | chat | Vendor documentation; no independent quality benchmark | 🟡 | Trang model hiện tại liệt kê Claude Fable 5.1 (claude-fable-5-1), Claude Opus 5 (claude-opus-5), Claude Sonnet 5 (claude-sonnet-5) và Claude Haiku 4.5 (claude-haiku-4-5-20251001). Trang này nói các model hiện t; Contract evidence; account, runtime và EN-VI quality chưa test |
| 16 | [Model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations) | ✅ | 1 | ✅ | chat | Vendor documentation; no independent quality benchmark | 🟡 | Anthropic phân loại model thành Active, Legacy, Deprecated và Retired. Active được hỗ trợ đầy đủ; Deprecated còn hoạt động nhưng không khuyến nghị; Retired không còn nhận request. Lịch retirement trong trang nà; Contract evidence; account, runtime và EN-VI quality chưa test |
| 17 | [Model IDs and versioning](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions) | ✅ | 1 | ✅ | chat | Vendor documentation; no independent quality benchmark | 🟡 | Anthropic nói mỗi model ID xác định một phiên bản được pin. Từ thế hệ Claude 4.6, ID dateless như claude-sonnet-4-6 là canonical fixed snapshot, không phải alias tự trỏ sang bản mới; các model trước đó có thể c; Contract evidence; account, runtime và EN-VI quality chưa test |
| 18 | [Create a Message](https://platform.claude.com/docs/en/api/messages/create) | ✅ | 1 | ✅ | chat | Vendor documentation; no independent quality benchmark | 🟡 | Messages API dùng POST /v1/messages tại URL với header anthropic-version và X-Api-Key. API nhận messages text hoặc image cho query đơn hoặc stateless multi-turn.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 19 | [TypeScript SDK](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript) | ✅ | 1 | ✅ | chat | Vendor documentation; no independent quality benchmark | 🟡 | SDK chính thức là @anthropic-ai/sdk. Tài liệu yêu cầu Node.js 20 LTS hoặc mới hơn cho runtime Node, hỗ trợ Electron main process theo mô hình Node; browser support bị tắt mặc định để tránh lộ secret và chỉ bật; Contract evidence; account, runtime và EN-VI quality chưa test |
| 20 | [Models | Gemini API](https://ai.google.dev/gemini-api/docs/models) | ✅ | 1 | ✅ | chat | Vendor documentation; no independent quality benchmark | 🟡 | Trang Gemini hiện liệt kê gemini-3.8-flash, gemini-3.7-flash, gemini-3.6-flash, gemini-3.5-flash, gemini-3.5-flash-lite và gemini-3.1-flash-lite là Stable. gemini-3.1-pro-preview và gemini-3-flash-preview là Pr; Contract evidence; account, runtime và EN-VI quality chưa test |
| 21 | [Getting started | Gemini API](https://ai.google.dev/gemini-api/docs/get-started) | ✅ | 1 | ✅ | chat | Vendor documentation; no independent quality benchmark | 🟡 | Getting started hiện dùng Interactions API qua REST và JavaScript/Python SDK; API key được đặt trong GEMINI_API_KEY. Ví dụ REST dùng endpoint generativelanguage.googleapis.com/v1beta/interactions và header x-go; Contract evidence; account, runtime và EN-VI quality chưa test |
| 22 | [OpenAI compatibility | Gemini API](https://ai.google.dev/gemini-api/docs/openai) | ✅ | 1 | ✅ | chat | Vendor documentation; no independent quality benchmark | 🟡 | Gemini có OpenAI-compatible endpoint tại URL Tài liệu JavaScript dùng OpenAI SDK với apiKey Gemini và baseURL này, hỗ trợ chat completions, stream true, function calling với tools và structured output qua parse; Contract evidence; account, runtime và EN-VI quality chưa test |
| 23 | [Available regions for Google AI Studio and Gemini API](https://ai.google.dev/gemini-api/docs/available-regions) | ✅ | 1 | ✅ | chat | Vendor documentation; no independent quality benchmark | 🟡 | Danh sách Available regions của Google AI Studio và Gemini API có Vietnam, vì vậy người dùng ở Việt Nam có bằng chứng tài liệu về availability khu vực cho dịch vụ này.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 24 | [OpenRouter Quickstart Guide](https://openrouter.ai/docs/quickstart) | ✅ | 1 | ✅ | chat | Vendor documentation; no independent quality benchmark | 🟡 | OpenRouter cung cấp một endpoint URL với Bearer OPENROUTER_API_KEY và có thể dùng OpenAI SDK bằng baseURL. Quickstart dùng alias ~openai/gpt-latest, alias này luôn resolve đến flagship mới nhất của OpenAI và có; Contract evidence; account, runtime và EN-VI quality chưa test |
| 25 | [OpenRouter Models](https://openrouter.ai/docs/guides/overview/models) | ✅ | 1 | ✅ | chat | Vendor documentation; no independent quality benchmark | 🟡 | Models API của OpenRouter cung cấp id, canonical_slug, pricing, top_provider, per_request_limits, supported_parameters và expiration_date. Docs nói có hàng trăm model và endpoint list để đọc slug programmatical; Contract evidence; account, runtime và EN-VI quality chưa test |
| 26 | [Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs) | ✅ | 1 | ✅ | chat | Vendor documentation; no independent quality benchmark | 🟡 | OpenRouter hỗ trợ structured outputs cho model tương thích bằng response_format type json_schema. Support được xác định theo endpoint/provider, có thể thay đổi; docs khuyến nghị kiểm tra supported parameters và; Contract evidence; account, runtime và EN-VI quality chưa test |
| 27 | [Your First API Call](https://api-docs.deepseek.com/guides/function_calling) | ✅ | 1 | ✅ | chat | Vendor documentation; no independent quality benchmark | 🟡 | DeepSeek xác nhận API format tương thích với OpenAI và Anthropic. Base URL OpenAI là URL Anthropic là URL model IDs hiện được nêu là deepseek-v4-flash, deepseek-v4-pro và deepseek-v4-flash-vision-exp. Hai model; Contract evidence; account, runtime và EN-VI quality chưa test |
| 28 | [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/) | ✅ | 1 | ✅ | chat | Vendor documentation; no independent quality benchmark | 🟡 | Bảng giá hiện tại nêu deepseek-v4-flash và deepseek-v4-pro có JSON Output, Tool Calls, Responses API và Anthropic API. Context length là 1M và max output là 384K. Giá per 1M token theo peak/off-peak: Flash cach; Giá động hoặc snapshot; chưa phải invoice |
| 29 | [OpenAI Compatibility](https://console.groq.com/docs/openai) | ✅ | 1 | ✅ | chat | Vendor documentation; no independent quality benchmark | 🟡 | Groq API được tài liệu mô tả là mostly compatible với OpenAI client libraries, dùng base_url URL và GROQ_API_KEY. Groq cũng có thư viện TypeScript/Python riêng.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 30 | [OpenRouter public model catalog](https://openrouter.ai/api/v1/models) | ✅ | 1 | ✅ | crosscheck | Vendor API metadata; no independent tutoring quality evaluation | 🟡 | Live public JSON lists anthropic/claude-sonnet-5 with response_format and structured_outputs in supported_parameters, and no temperature support in that entry. This is a provider listing, not account access or; Contract evidence; account, runtime và EN-VI quality chưa test |
| 31 | [Gemini 3.8 Flash model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) | ✅ | 1 | ✅ | crosscheck | Vendor API metadata; no independent tutoring quality evaluation | 🟡 | Stable model ID gemini-3.8-flash; supports low/medium/high thinking, rejects minimal. Text output, no audio generation or Live API. Model card page updated2026-09-02.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 32 | [List models](https://docs.ollama.com/api/tags) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | Ollama GET /api/tags trả models[] với name, model, modified_at, size, digest, format, family, parameter_size và quantization_level. Đây là endpoint phù hợp với cách Enjoy đang discovery model.; Source fit; local server/model/runtime chưa test |
| 33 | [OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | Ollama chỉ cam kết các phần của OpenAI API. Nó hỗ trợ OpenAI client qua baseURL URL và yêu cầu một apiKey placeholder bị bỏ qua ở local.; Source fit; local server/model/runtime chưa test |
| 34 | [Ollama on macOS](https://github.com/ollama/ollama/blob/main/docs/macos.mdx) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | Ollama trên macOS yêu cầu macOS Sonoma 14 trở lên; Apple M series được hỗ trợ CPU và GPU, còn x86 chỉ CPU. Tài liệu cảnh báo model có thể có kích thước từ hàng chục đến hàng trăm GB.; Source fit; local server/model/runtime chưa test |
| 35 | [Ollama license](https://github.com/ollama/ollama/blob/main/LICENSE) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | Repository runtime Ollama công bố MIT License.; Source fit; local server/model/runtime chưa test |
| 36 | [LM Studio REST API](https://lmstudio.ai/docs/developer/rest) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | LM Studio 0.4.0 giới thiệu native v1 REST API và tài liệu khuyến nghị /api/v1/chat, /api/v1/models, /api/v1/models/load, /api/v1/models/unload, /api/v1/models/download và download status.; Source fit; local server/model/runtime chưa test |
| 37 | [LM Studio OpenAI compatibility](https://lmstudio.ai/docs/developer/openai-compat) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | LM Studio cung cấp GET /v1/models và POST /v1/responses, /v1/chat/completions, /v1/embeddings, /v1/completions; OpenAI client có thể đổi baseURL sang URL; Source fit; local server/model/runtime chưa test |
| 38 | [List LM Studio models](https://lmstudio.ai/docs/developer/rest/list) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | List LM Studio models; Source fit; local server/model/runtime chưa test |
| 39 | [LM Studio system requirements](https://lmstudio.ai/docs/app/system-requirements) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | LM Studio hỗ trợ Apple Silicon M1 đến M4 trên macOS 14 trở lên và khuyến nghị 16 GB RAM; máy 8 GB chỉ phù hợp model nhỏ và context vừa phải. Intel Mac hiện không được hỗ trợ.; Source fit; local server/model/runtime chưa test |
| 40 | [whisper.cpp README](https://github.com/ggml-org/whisper.cpp/blob/master/README.md?plain=1) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | whisper.cpp là implementation C/C++ có hỗ trợ Apple Silicon qua ARM NEON, Accelerate, Metal và Core ML; README nêu Core ML có thể chạy encoder trên Apple Neural Engine và dự án đo được hơn 3 lần so với CPU-only; Source fit; local server/model/runtime chưa test |
| 41 | [whisper.cpp license](https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | whisper.cpp repository công bố MIT License.; Source fit; local server/model/runtime chưa test |
| 42 | [faster-whisper README](https://github.com/SYSTRAN/faster-whisper/blob/master/README.md?plain=1) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | faster-whisper yêu cầu Python >=3.9; CPU path có ví dụ device=cpu và compute_type=int8. GPU path trong README yêu cầu NVIDIA cuBLAS CUDA 12 và cuDNN 9.; Source fit; local server/model/runtime chưa test |
| 43 | [AI SDK OpenAI-compatible provider](https://github.com/vercel/ai/blob/main/packages/openai-compatible/README.md) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | @ai-sdk/openai-compatible cung cấp createOpenAICompatible({ baseURL, name, apiKey }) và chatModel(modelId) cho endpoint OpenAI-compatible; package được mô tả là core-only nhẹ hơn provider OpenAI đầy đủ feature.; Source fit; local server/model/runtime chưa test |
| 44 | [AI SDK license](https://github.com/vercel/ai/blob/main/LICENSE) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | Vercel AI SDK repository công bố Apache License 2.0.; Source fit; local server/model/runtime chưa test |
| 45 | [AI SDK runtime requirement](https://raw.githubusercontent.com/vercel/ai/main/packages/ai/README.md) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | AI SDK README yêu cầu Node.js 22 trở lên cho local development machine.; Source fit; local server/model/runtime chưa test |
| 46 | [ChatOllama JavaScript integration](https://docs.langchain.com/oss/javascript/integrations/chat/ollama) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | Tài liệu LangChain JS dùng package @langchain/ollama và ChatOllama; bảng capability liệt kê tool calling, structured output, image input, token streaming và token usage được hỗ trợ, còn audio/video và logprobs; Source fit; local server/model/runtime chưa test |
| 47 | [List running Ollama models](https://docs.ollama.com/api/ps) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | Ollama GET /api/ps liệt kê model đang chạy và có size, digest, parameter size và quantization, nên có thể dùng cho trạng thái loaded hoặc guard về tài nguyên ở giai đoạn sau.; Source fit; local server/model/runtime chưa test |
| 48 | [Ollama model catalog example](https://ollama.com/library/gemma3/tags) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | Model catalog chính thức cho ví dụ Gemma 3 có nhiều tag với kích thước từ khoảng 292 MB đến 17 GB cho các biến thể hiển thị, và model card có điều khoản Gemma riêng.; Source fit; local server/model/runtime chưa test |
| 49 | [LM Studio OpenAI model list](https://lmstudio.ai/docs/developer/openai-compat/models) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | LM Studio /v1/models trả model visible trên server; khi JIT loading bật, danh sách có thể gồm tất cả model đã download. Native /api/v1/models giàu hơn, gồm type, publisher, key, display_name, architecture, quan; Source fit; local server/model/runtime chưa test |
| 50 | [LM Studio structured output](https://lmstudio.ai/docs/developer/openai-compat/structured-output) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | LM Studio hỗ trợ response_format JSON schema trên /v1/chat/completions, nhưng tài liệu cảnh báo không phải model nào cũng làm được, đặc biệt model dưới 7B.; Source fit; local server/model/runtime chưa test |
| 51 | [LM Studio offline behavior](https://lmstudio.ai/docs/app/offline) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | LM Studio core chat, chat with documents và local server hoạt động offline sau khi model đã có trên máy; catalog search, download model, runtime và app update cần internet.; Source fit; local server/model/runtime chưa test |
| 52 | [whisper.cpp JavaScript binding](https://github.com/ggml-org/whisper.cpp/blob/master/bindings/javascript/README.md) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | whisper.cpp có binding JavaScript cho Node nhưng README gọi API hiện tại là rất sơ khai và build cần Emscripten.; Source fit; local server/model/runtime chưa test |
| 53 | [faster-whisper package metadata](https://github.com/SYSTRAN/faster-whisper/blob/master/setup.py) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | setup.py của faster-whisper khai báo MIT License, Python >=3.9 và Development Status Beta.; Source fit; local server/model/runtime chưa test |
| 54 | [SFSpeechRecognizer](https://developer.apple.com/documentation/speech/sfspeechrecognizer) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | SFSpeechRecognizer; Source fit; local server/model/runtime chưa test |
| 55 | [Require on-device speech recognition](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | SFSpeechRecognizer có supportsOnDeviceRecognition và request có thể yêu cầu requiresOnDeviceRecognition; Apple cảnh báo on-device request có thể kém chính xác hơn và nếu capability false thì recognizer cần netw; Source fit; local server/model/runtime chưa test |
| 56 | [LangChain.js repository](https://github.com/langchain-ai/langchainjs) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | Repository LangChain.js công bố MIT và tài liệu repository hỗ trợ Node.js 20.x, 22.x và 24.x; release page hiển thị các bản 1.x trong năm 2026.; Source fit; local server/model/runtime chưa test |
| 57 | [LangChain.js releases](https://github.com/langchain-ai/langchainjs/releases) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | LangChain.js releases; Source fit; local server/model/runtime chưa test |
| 58 | [Electron 34 release](https://www.electronjs.org/blog/electron-34-0) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | Electron 34 release notes cho biết embedded Node trong dòng Electron 34 là Node 20.x. Đây là ràng buộc runtime khác với engines của package chạy ở máy phát triển.; Source fit; local server/model/runtime chưa test |
| 59 | [@langchain/openai npm metadata](https://registry.npmjs.org/@langchain/openai) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | npm metadata read-only cho thấy 0.4.4, 0.4.5-rc.0, 0.4.6 và 0.5.2 đều peer trên core >=0.3.39 <0.4.0; 0.4.6 và 0.5.2 dùng openai ^4.87.3. Từ 0.5.7 peer đã lên >=0.3.48; 0.5.13 lên >=0.3.58; 0.6.0 dùng openai ^5; Source fit; local server/model/runtime chưa test |
| 60 | [@langchain/openai 0.4.5-rc.0 tagged package metadata](https://raw.githubusercontent.com/langchain-ai/langchainjs/8fc15659c071b818a4582ad0f5f4d043c35984af/libs/langchain-openai/package.json) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | Tagged 0.4.5-rc.0 có peer core >=0.3.39 <0.4.0, dependency openai ^4.87.3 và engines node >=18; đây là lý do docs có thể ghi ngưỡng >=0.4.5-rc.0. Bản ổn định 0.4.6 là điểm chọn an toàn hơn release candidate.; Source fit; local server/model/runtime chưa test |
| 61 | [@langchain/openai 0.4.6 tagged package metadata](https://raw.githubusercontent.com/langchain-ai/langchainjs/54f7314a56185bcf52d832148a9f08b961f574bf/libs/langchain-openai/package.json) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | Tagged package @langchain/openai 0.4.6 khai báo version 0.4.6, engines node >=18, dependency openai ^4.87.3 và peer @langchain/core >=0.3.39 <0.4.0. Điều này khớp core 0.3.42 và openai 4.87.3 đang có trong Enjo; Source fit; local server/model/runtime chưa test |
| 62 | [@langchain/openai 0.4.6 ChatOpenAI source](https://raw.githubusercontent.com/langchain-ai/langchainjs/54f7314a56185bcf52d832148a9f08b961f574bf/libs/langchain-openai/src/chat_models.ts) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | Tagged ChatOpenAI source 0.4.6 có field useResponsesApi, _useResponseApi, responseApiWithRetry và gọi client.responses.create hoặc client.responses.parse. Đây là API support cụ thể trong source, không chỉ là cl; Source fit; local server/model/runtime chưa test |
| 63 | [@langchain/openai 0.6.0 tagged package metadata](https://raw.githubusercontent.com/langchain-ai/langchainjs/d196784931ee92f2a58e1af33f99fb5cb19bc68d/libs/langchain-openai/package.json) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | Tagged package @langchain/openai 0.6.0 nâng peer @langchain/core lên >=0.3.58 <0.4.0 và dependency openai lên ^5.3.0. Nó không khớp trực tiếp core 0.3.42 và openai 4.87.3 hiện tại.; Source fit; local server/model/runtime chưa test |
| 64 | [Ollama releases](https://github.com/ollama/ollama/releases) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | Ollama, whisper.cpp và LangChain.js đều có release activity hoặc tài liệu cập nhật trong 2026; faster-whisper có hoạt động pull request trong 2026 nhưng package metadata vẫn ghi Beta; Vercel AI main đang mô tả; Source fit; local server/model/runtime chưa test |
| 65 | [On-device speech recognition capability](https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition) | ✅ | 1 | ⚠️ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | ⚪ | Canonical page chỉ trả title hoặc metadata ở lần fetch đầu và một lần retry; DocC JSON fallback safe-open error; không dùng capability claim |
| 66 | [LangChain providers and models](https://docs.langchain.com/oss/javascript/concepts/providers-and-models) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | LangChain providers and models; Source fit; local server/model/runtime chưa test |
| 67 | [faster-whisper pull requests](https://github.com/SYSTRAN/faster-whisper/pulls) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | faster-whisper pull requests; Source fit; local server/model/runtime chưa test |
| 68 | [whisper.cpp releases](https://github.com/ggml-org/whisper.cpp/releases) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | whisper.cpp releases; Source fit; local server/model/runtime chưa test |
| 69 | [Ollama GPU documentation](https://github.com/ollama/ollama/blob/main/docs/gpu.mdx) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | Ollama GPU documentation; Source fit; local server/model/runtime chưa test |
| 70 | [OpenAI Whisper README](https://github.com/openai/whisper/blob/main/README.md?plain=1) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | OpenAI Whisper README; Source fit; local server/model/runtime chưa test |
| 71 | [AI SDK pre-release cycle](https://github.com/vercel/ai/blob/main/contributing/pre-release-cycle.md) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | AI SDK pre-release cycle; Source fit; local server/model/runtime chưa test |
| 72 | [LM Studio server settings](https://lmstudio.ai/docs/developer/core/server/settings) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | LM Studio server settings; Source fit; local server/model/runtime chưa test |
| 73 | [LM Studio chat completions compatibility](https://lmstudio.ai/docs/developer/openai-compat/chat-completions) | ✅ | 1 | ✅ | local | Vendor or repository maintained source; no independent Vietnamese quality benchmark | 🟡 | LM Studio chat completions compatibility; Source fit; local server/model/runtime chưa test |
| 74 | [GPT Live Transcribe](https://developers.openai.com/api/docs/models/gpt-live-transcribe) | ✅ | 1 | ✅ | speech | vendor-maintained model card | 🟡 | gpt-live-transcribe là model speech-to-text streaming độ trễ thấp mặc định cho realtime transcription và trả transcript delta.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 75 | [Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription) | ✅ | 1 | ✅ | speech | vendor-maintained integration guide | 🟡 | Session type transcription dùng gpt-live-transcribe; browser có thể dùng WebRTC, server pipeline dùng WebSocket.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 76 | [Realtime API](https://developers.openai.com/api/docs/guides/realtime) | ✅ | 1 | ✅ | speech | vendor-maintained integration guide | 🟡 | OpenAI khuyến nghị WebRTC cho browser/mobile, WebSocket cho server media pipeline và SIP cho telephony.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 77 | [Text to speech](https://developers.openai.com/api/docs/guides/text-to-speech) | ✅ | 1 | ✅ | speech | vendor-maintained product guide | 🟡 | Guide dùng gpt-4o-mini-tts và cho phép prompt accent, emotion, intonation, speed, tone, whisper.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 78 | [Gemini API deprecations](https://ai.google.dev/gemini-api/docs/deprecations) | ✅ | 1 | ✅ | speech | vendor-maintained lifecycle page | 🟡 | gemini-3.5-transcribe-live phát hành 08/2026 và gemini-3.1-flash-live-preview phát hành 2026-03-11, hiện chưa có shutdown date.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 79 | [Gemini Live API capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities) | ✅ | 1 | ✅ | speech | vendor-maintained preview documentation | 🟡 | Ví dụ model Live hiện hành dùng gemini-3.1-flash-live-preview với response_modalities AUDIO.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 80 | [Live API transcription](https://ai.google.dev/gemini-api/docs/live-api/live-transcribe) | ✅ | 1 | ✅ | speech | vendor-maintained preview documentation | 🟡 | Model là gemini-3.5-transcribe-live, response modality TEXT; BCP-47 language_codes, [] để auto-detect.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 81 | [Gemini API audio transcription](https://ai.google.dev/gemini-api/docs/transcribe) | ✅ | 1 | ✅ | speech | vendor-maintained product documentation | 🟡 | Model nonstream là gemini-3.5-transcribe; hỗ trợ auto language, diarization, custom vocabulary và word-level timestamps.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 82 | [Gemini text-to-speech](https://ai.google.dev/gemini-api/docs/speech-generation?hl=en) | ✅ | 1 | ✅ | speech | vendor-maintained preview documentation | 🟡 | Model TTS là gemini-3.1-flash-tts-preview; text-only input và audio-only output.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 83 | [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) | ✅ | 1 | ✅ | speech | vendor-maintained pricing | 🟡 | gemini-3.5-transcribe-live: 3.50 USD/1M audio input tokens và 21 USD/1M text output tokens; bảng ước tính blended khoảng 0.009 USD/phút.; Giá động hoặc snapshot; chưa phải invoice |
| 84 | [Pronunciation assessment](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment) | ✅ | 1 | ✅ | speech | vendor-maintained assessment documentation | 🟡 | Pronunciation Assessment là chế độ đánh giá riêng, khác ASR transcript thông thường.; Assessment contract; locale, account và runtime chưa test |
| 85 | [Speech language and voice support](https://learn.microsoft.com/en-us/azure/ai-services/Speech-Service/language-support) | ✅ | 1 | ✅ | speech | vendor-maintained dynamic feature matrix | 🟡 | Pronunciation assessment table liệt kê 33 locale, gồm English locales và Vietnamese vi-VN.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 86 | [Speech to Text realtime WebSocket](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime) | ✅ | 1 | ✅ | speech | vendor-maintained API reference | 🟡 | WSS endpoint là wss://api.elevenlabs.io/v1/speech-to-text/realtime, model ID bắt buộc scribe_v2_realtime.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 87 | [Models and languages overview](https://developers.deepgram.com/docs/models-languages-overview/) | ✅ | 1 | ✅ | speech | vendor-maintained model inventory | 🟡 | Flux là streaming model với model-native turn detection; Nova-3 là ASR general-purpose cho batch/streaming; Nova-2 dùng khi language/chức năng chưa có ở Nova-3.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 88 | [Migrating from Nova-3 to Flux](https://developers.deepgram.com/docs/flux/nova-3-migration) | ✅ | 1 | ✅ | speech | vendor-maintained migration guide | 🟡 | Flux có model-native turn detection: StartOfTurn, EagerEndOfTurn, TurnResumed, EndOfTurn; EOT p50 mặc định khoảng 260 ms.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 89 | [Create transcription](https://developers.openai.com/api/reference/python/resources/audio/subresources/transcriptions/methods/create) | ✅ | 1 | ✅ | speech | vendor-maintained API reference | 🟡 | Endpoint hiện hành là POST /audio/transcriptions, dùng multipart file với file audio và model.; Schema/model evidence; fixture và runtime chưa test |
| 90 | [GPT-4o Mini TTS Model](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts) | ✅ | 1 | ✅ | speech | vendor-maintained model card | 🟡 | Model hiện hành là gpt-4o-mini-tts, text input và audio output; maximum input 2000 tokens.; Contract evidence; account, runtime và EN-VI quality chưa test |
| 91 | [Deepgram pricing](https://deepgram.com/pricing) | ✅ | 1 | ✅ | speech | vendor-maintained dynamic pricing | 🟡 | Bảng hiện hiển thị Flux English khoảng 0.0065 USD/phút promotional và 0.0077 regular; Flux Multilingual khoảng 0.0078.; Giá động hoặc snapshot; chưa phải invoice |
| 92 | [API pricing](https://elevenlabs.io/pricing/api?price.section=speech_to_text) | ✅ | 1 | ✅ | speech | vendor-maintained dynamic pricing | 🟡 | Scribe v2 batch: 0.22 USD mỗi giờ audio.; Giá động hoặc snapshot; chưa phải invoice |
| 93 | [GPT-Transcribe Model](https://developers.openai.com/api/docs/models/gpt-transcribe) | ✅ | 1 | ✅ | speech | vendor-maintained model card | 🟡 | gpt-transcribe là high-accuracy speech-to-text model cho completed audio files, streamed file transcripts và committed turns trong Realtime WebSocket.; Schema/model evidence; fixture và runtime chưa test |

### Successful attempts không tăng canonical source count

| URL attempt | Canonical mapping | Kết quả |
|---|---|---|
| [Create transcription redirect alias](https://platform.openai.com/docs/api-reference/audio/createTranscription) | [OpenAI transcription reference](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create) | Redirect thành công; giữ trong attempted ledger, không tính source mới |

### Failed attempts và fallback

Các URL này không được tính là successful source và không dùng nội dung chưa fetch. Nếu fallback cung cấp cùng fact ở canonical URL thành công, fact được trích từ canonical URL đó.

| URL attempt | Kết quả | Fallback | Sử dụng fact? |
|---|---|---|---|
| [https://developers.openai.com/api/docs/guides/migrate-to-responses.md](https://developers.openai.com/api/docs/guides/migrate-to-responses.md) | ❌ Internal fetch error; HTML fallback succeeded | [fallback](https://developers.openai.com/api/docs/guides/migrate-to-responses) | Không |
| [https://api-docs.deepseek.com/](https://api-docs.deepseek.com/) | ❌ Web fetch trả Internal Error/timeout tại landing page. | [fallback](https://api-docs.deepseek.com/guides/function_calling) | Không |
| [https://api-docs.deepseek.com/guides/thinking_mode](https://api-docs.deepseek.com/guides/thinking_mode) | ❌ Timeout through web tool; no thinking parameter claims extracted | Không có fallback | Không |
| [https://developers.openai.com/api/docs/guides/file-transcription](https://developers.openai.com/api/docs/guides/file-transcription) | ❌ Web tool internal error; no page content used | Không có fallback | Không |
| [https://docs.ollama.com/api/show](https://docs.ollama.com/api/show) | ❌ web__run trả Internal Error khi mở trang | Không có fallback | Không |
| [https://docs.ollama.com/api/version](https://docs.ollama.com/api/version) | ❌ web__run trả Internal Error khi mở trang | Không có fallback | Không |
| [https://ai-sdk.dev/docs/foundations/providers-and-models](https://ai-sdk.dev/docs/foundations/providers-and-models) | ❌ web__run không xử lý được content type text/markdown | [fallback](https://github.com/vercel/ai/blob/main/packages/openai-compatible/README.md) | Không |
| [https://registry.npmjs.org/@langchain/openai/0.4.6](https://registry.npmjs.org/@langchain/openai/0.4.6) | ❌ web__run từ chối URL đã encode scope package vì safe URL policy | [fallback](https://registry.npmjs.org/@langchain/openai) | Không |
| [https://raw.githubusercontent.com/langchain-ai/langchainjs/8fc15659c071b818a4582ad0f5f4d043c35984af/libs/providers/langchain-openai/src/chat_models.ts](https://raw.githubusercontent.com/langchain-ai/langchainjs/8fc15659c071b818a4582ad0f5f4d043c35984af/libs/providers/langchain-openai/src/chat_models.ts) | ❌ 404 do đường dẫn source không tồn tại ở commit đó | [fallback](https://raw.githubusercontent.com/langchain-ai/langchainjs/54f7314a56185bcf52d832148a9f08b961f574bf/libs/langchain-openai/src/chat_models.ts) | Không |
| [https://developers.openai.com/api/docs/guides/realtime-transcription.md](https://developers.openai.com/api/docs/guides/realtime-transcription.md) | ❌ Endpoint Markdown bị từ chối với lỗi 400 Unsupported content-type: text/markdown khi mở qua web tool. | Không có fallback | Không |
| [https://developers.openai.com/api/docs/models/gpt-realtime-2.1.md](https://developers.openai.com/api/docs/models/gpt-realtime-2.1.md) | ❌ Endpoint Markdown bị từ chối với lỗi 400 Unsupported content-type: text/markdown khi mở qua web tool. | Không có fallback | Không |
| [https://developers.openai.com/api/reference/javascript/resources/audio/subresources/transcriptions/methods/create](https://developers.openai.com/api/reference/javascript/resources/audio/subresources/transcriptions/methods/create) | ❌ Trang JavaScript API reference trả Internal Error khi mở; Python và CLI API reference canonical đã mở được. | Không có fallback | Không |
| [Apple DocC JSON fallback](https://developer.apple.com/tutorials/data/documentation/speech/sfspeechrecognizer/supportsondevicerecognition.json) | ❌ Web tool trả non-retryable safe-open error, không có document content. | Không có | Không |

Vòng random recheck có 36/36 URL được chọn đã xử lý: 14 URL executive và 22 URL seeded random từ population 79. Bảy URL đã có targeted recheck được reuse, 29 URL có record mới; 28 record content-verified và Apple `supportsOnDeviceRecognition` là 1 record not-evaluable sau hai content attempts. DocC JSON fallback ở trên là một failed event riêng, không tạo thêm canonical source và không được dùng để khẳng định capability Apple. Tổng 93 canonical URL references vẫn giữ nguyên.

## 14. Danh sách nguồn tham khảo

Danh sách dưới đây gồm toàn bộ 93 canonical URL thành công sau exact URL dedup. Các URL cùng vendor không được diễn giải là independent studies. Chi tiết fact, limitations, re-fetch và ledger group nằm trong [`sources.json`](./sources.json).

### OpenAI

1. [GPT-5.6 Luna model](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
2. [GPT-5.6 Terra model](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
3. [OpenAI model catalog](https://developers.openai.com/api/docs/models/all)
4. [GPT-6 Astra guidance](https://developers.openai.com/api/docs/guides/latest-model)
5. [GPT-5.6 guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6)
6. [Responses migration](https://developers.openai.com/api/docs/guides/migrate-to-responses)
7. [Deprecations](https://developers.openai.com/api/docs/deprecations)
8. [Responses streaming](https://developers.openai.com/api/docs/guides/streaming-responses)
9. [Supported API countries](https://help.openai.com/en/articles/5347006-openai-api-supported-countries-and-territories)
10. [ChatOpenAI integration](https://docs.langchain.com/oss/javascript/integrations/chat/openai)
11. [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
12. [API data controls](https://developers.openai.com/api/docs/guides/your-data)
13. [GPT-6 Astra model](https://developers.openai.com/api/docs/models/gpt-6-astra)
14. [ChatGPT and API billing](https://help.openai.com/en/articles/9039756)
15. [OpenAI Whisper README](https://github.com/openai/whisper/blob/main/README.md?plain=1)
16. [GPT Live Transcribe](https://developers.openai.com/api/docs/models/gpt-live-transcribe)
17. [Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)
18. [Realtime API](https://developers.openai.com/api/docs/guides/realtime)
19. [Text to speech](https://developers.openai.com/api/docs/guides/text-to-speech)
20. [Create transcription](https://developers.openai.com/api/reference/python/resources/audio/subresources/transcriptions/methods/create)
21. [GPT-4o Mini TTS Model](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts)
22. [GPT-Transcribe Model](https://developers.openai.com/api/docs/models/gpt-transcribe)

### Anthropic

23. [Models overview](https://platform.claude.com/docs/en/models/overview)
24. [Model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations)
25. [Model IDs and versioning](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions)
26. [Create a Message](https://platform.claude.com/docs/en/api/messages/create)
27. [TypeScript SDK](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript)

### Google

28. [Models | Gemini API](https://ai.google.dev/gemini-api/docs/models)
29. [Getting started | Gemini API](https://ai.google.dev/gemini-api/docs/get-started)
30. [OpenAI compatibility | Gemini API](https://ai.google.dev/gemini-api/docs/openai)
31. [Available regions for Google AI Studio and Gemini API](https://ai.google.dev/gemini-api/docs/available-regions)
32. [Gemini API deprecations](https://ai.google.dev/gemini-api/docs/deprecations)
33. [Gemini Live API capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities)
34. [Live API transcription](https://ai.google.dev/gemini-api/docs/live-api/live-transcribe)
35. [Gemini API audio transcription](https://ai.google.dev/gemini-api/docs/transcribe)
36. [Gemini text-to-speech](https://ai.google.dev/gemini-api/docs/speech-generation?hl=en)
37. [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)

### OpenRouter

38. [OpenRouter Quickstart Guide](https://openrouter.ai/docs/quickstart)
39. [OpenRouter Models](https://openrouter.ai/docs/guides/overview/models)
40. [Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)

### DeepSeek

41. [Your First API Call](https://api-docs.deepseek.com/guides/function_calling)
42. [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)

### Groq

43. [OpenAI Compatibility](https://console.groq.com/docs/openai)

### Mixed provider metadata

44. [OpenRouter public model catalog](https://openrouter.ai/api/v1/models)
45. [Gemini 3.8 Flash model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)

### Ollama

46. [List models](https://docs.ollama.com/api/tags)
47. [OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
48. [Ollama on macOS](https://github.com/ollama/ollama/blob/main/docs/macos.mdx)
49. [Ollama license](https://github.com/ollama/ollama/blob/main/LICENSE)
50. [List running Ollama models](https://docs.ollama.com/api/ps)
51. [Ollama model catalog example](https://ollama.com/library/gemma3/tags)
52. [Ollama releases](https://github.com/ollama/ollama/releases)
53. [Ollama GPU documentation](https://github.com/ollama/ollama/blob/main/docs/gpu.mdx)

### LM Studio

54. [LM Studio REST API](https://lmstudio.ai/docs/developer/rest)
55. [LM Studio OpenAI compatibility](https://lmstudio.ai/docs/developer/openai-compat)
56. [List LM Studio models](https://lmstudio.ai/docs/developer/rest/list)
57. [LM Studio system requirements](https://lmstudio.ai/docs/app/system-requirements)
58. [LM Studio OpenAI model list](https://lmstudio.ai/docs/developer/openai-compat/models)
59. [LM Studio structured output](https://lmstudio.ai/docs/developer/openai-compat/structured-output)
60. [LM Studio offline behavior](https://lmstudio.ai/docs/app/offline)
61. [LM Studio server settings](https://lmstudio.ai/docs/developer/core/server/settings)
62. [LM Studio chat completions compatibility](https://lmstudio.ai/docs/developer/openai-compat/chat-completions)

### ggml-org

63. [whisper.cpp README](https://github.com/ggml-org/whisper.cpp/blob/master/README.md?plain=1)
64. [whisper.cpp license](https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE)
65. [whisper.cpp JavaScript binding](https://github.com/ggml-org/whisper.cpp/blob/master/bindings/javascript/README.md)
66. [whisper.cpp releases](https://github.com/ggml-org/whisper.cpp/releases)

### SYSTRAN

67. [faster-whisper README](https://github.com/SYSTRAN/faster-whisper/blob/master/README.md?plain=1)
68. [faster-whisper package metadata](https://github.com/SYSTRAN/faster-whisper/blob/master/setup.py)
69. [faster-whisper pull requests](https://github.com/SYSTRAN/faster-whisper/pulls)

### Vercel

70. [AI SDK OpenAI-compatible provider](https://github.com/vercel/ai/blob/main/packages/openai-compatible/README.md)
71. [AI SDK license](https://github.com/vercel/ai/blob/main/LICENSE)
72. [AI SDK runtime requirement](https://raw.githubusercontent.com/vercel/ai/main/packages/ai/README.md)
73. [AI SDK pre-release cycle](https://github.com/vercel/ai/blob/main/contributing/pre-release-cycle.md)

### LangChain

74. [ChatOllama JavaScript integration](https://docs.langchain.com/oss/javascript/integrations/chat/ollama)
75. [LangChain.js repository](https://github.com/langchain-ai/langchainjs)
76. [LangChain.js releases](https://github.com/langchain-ai/langchainjs/releases)
77. [@langchain/openai 0.4.5-rc.0 tagged package metadata](https://raw.githubusercontent.com/langchain-ai/langchainjs/8fc15659c071b818a4582ad0f5f4d043c35984af/libs/langchain-openai/package.json)
78. [@langchain/openai 0.4.6 tagged package metadata](https://raw.githubusercontent.com/langchain-ai/langchainjs/54f7314a56185bcf52d832148a9f08b961f574bf/libs/langchain-openai/package.json)
79. [@langchain/openai 0.4.6 ChatOpenAI source](https://raw.githubusercontent.com/langchain-ai/langchainjs/54f7314a56185bcf52d832148a9f08b961f574bf/libs/langchain-openai/src/chat_models.ts)
80. [@langchain/openai 0.6.0 tagged package metadata](https://raw.githubusercontent.com/langchain-ai/langchainjs/d196784931ee92f2a58e1af33f99fb5cb19bc68d/libs/langchain-openai/package.json)
81. [LangChain providers and models](https://docs.langchain.com/oss/javascript/concepts/providers-and-models)

### Apple

82. [SFSpeechRecognizer](https://developer.apple.com/documentation/speech/sfspeechrecognizer)
83. [Require on-device speech recognition](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition)
84. [On-device speech recognition capability](https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition)

### Electron

85. [Electron 34 release](https://www.electronjs.org/blog/electron-34-0)

### npm and LangChain

86. [@langchain/openai npm metadata](https://registry.npmjs.org/@langchain/openai)

### Microsoft

87. [Pronunciation assessment](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment)
88. [Speech language and voice support](https://learn.microsoft.com/en-us/azure/ai-services/Speech-Service/language-support)

### ElevenLabs

89. [Speech to Text realtime WebSocket](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime)
90. [API pricing](https://elevenlabs.io/pricing/api?price.section=speech_to_text)

### Deepgram

91. [Models and languages overview](https://developers.deepgram.com/docs/models-languages-overview/)
92. [Migrating from Nova-3 to Flux](https://developers.deepgram.com/docs/flux/nova-3-migration)
93. [Deepgram pricing](https://deepgram.com/pricing)

### Successful redirect alias được giữ để truy vết

- [Create transcription redirect alias](https://platform.openai.com/docs/api-reference/audio/createTranscription) chuyển tới canonical transcription reference và không tăng source count.

## 15. Trạng thái và dữ liệu còn thiếu

Bản này đã merge đầy đủ source work trong các ledger OpenAI, chat provider, crosscheck, local/adapter và speech, cùng architecture baseline. Initial source count là 93 canonical URL references có initial ledger access, không phải 93 final content-verified references. Có 94 successful URL records và fetch events, 12 failed URL records tương ứng 13 failed fetch events. Reverification đã merge 56 unique URL groups và 59 per-ledger records; 55 canonical URLs sau khi loại redirect alias. Random round xử lý 36/36 URL, trong đó 35/36 content-verified và Apple canonical not-evaluable; fallback DocC JSON có một failed event. Research đã complete.

Nghiệm thu implementation cuối: TypeScript, provider helper và localization 991 key PASS; runtime 21 trường hợp, migration 12 trường hợp và speech 9 trường hợp PASS. Review độc lập Task1, Task2, Task2b và Task3 đều PASS. Build/package và packaged verifier PASS. Packaged smoke E2E đạt 6 PASS với 3 native opt-in bị skip; AI settings E2E đạt 2 PASS, gồm bootstrap cấu hình cũ, key isolation, GPT/TTS/STT và khởi động lại. Các kiểm thử dùng transport giả và profile cô lập, chưa xác nhận quyền tài khoản provider, phản hồi model trả phí hoặc chất lượng học Anh-Việt. Đã thay bundle Enjoy và mở lại profile QA hiện có, native UI hiển thị Ethan, đủ 7 provider và giữ cấu hình cũ. Bản trước được giữ làm backup. Xem [nghiệm thu cuối](/Users/ethan/VibeCoding/everyone-can-use-english/.superpowers/sdd/2026-09-06-enjoy-ai-modernization/final-verification.md).

Paid provider request, account/quota evidence, fixture model-specific cho `gpt-transcribe`, benchmark EN-VI và quality comparison là follow-up chưa có. Một giới hạn baseline còn lại là historical conversation TTS record malformed có thể thiếu `tts.model` và gây lỗi ở `conversation-form-tts`; đây là dữ liệu cũ cần xử lý riêng, không được ghi thành mọi historical data đã migrate.

Các bước vận hành còn cần tài khoản hoặc model thật:




- Nếu có key và quyền phù hợp, chạy runtime smoke test có kiểm soát cho model người dùng chọn; đọc lại request/response, stream, tools, schema, usage và error trước khi gọi là PASS.
- Với speech, chạy fixture `gpt-transcribe` để xác nhận payload `verbose_json` và word/segment timestamps; giữ DTW fallback nếu schema thực tế khác sample.
- Xác minh Azure locale/tier, speech cost, account/quota và region theo account. Không suy ra từ catalog hoặc Codex quota.
- Cập nhật model/lifecycle/pricing trước release vì các trang dynamic có thể thay đổi.

Không báo integration hoặc paid call PASS từ report này.
