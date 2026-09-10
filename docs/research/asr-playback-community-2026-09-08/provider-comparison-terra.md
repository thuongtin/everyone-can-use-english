> Cập nhật sau nghiên cứu: đã có [nghiệm thu live ngày 2026-09-08](live-acceptance.md) cho OpenAI, Cloudflare, MAI 53:57 và runtime playback. Các mục “chưa thử” bên dưới phản ánh thời điểm nghiên cứu; xem báo cáo live để biết kết quả mới.

# OpenAI API và OpenRouter cho ASR audio dài

Kiểm tra ngày 2026-09-08, chỉ đọc. Câu trả lời ngắn: **cả OpenAI API lẫn OpenRouter đều là lựa chọn ASR thực tế, nhưng chưa có nguồn nào bảo đảm một request nguyên file MP3 53:57 của Enjoy sẽ hoàn tất đúng và đủ từ.** Đường nên giữ cho Enjoy lúc này là `microsoft/mai-transcribe-2` qua OpenRouter với hàng đợi chunk, offset timestamp và DTW đang có. OpenAI direct là ứng viên cần benchmark riêng, không phải cách né chunking đã được chứng minh.

File đang xét có đúng **25.903.156 byte**, MP3 mono 16 kHz/64 kbps, dài 3.237,744063 giây. OpenAI công bố giới hạn file transcription là `25 MB`, nhưng trang không định nghĩa MB là 10^6 hay 2^20 byte. Vì vậy file này vượt 25.000.000 byte nhưng nhỏ hơn 25 MiB (26.214.400 byte); không được khẳng định nó lọt giới hạn chỉ từ nhãn “25,9 MB”. Down-encode để raw byte thấp hơn 25.000.000, hoặc chia đoạn, bảo đảm nằm dưới cap kích thước theo cả hai cách hiểu; không bảo đảm inference thành công. Bằng chứng Cloudflare hiện có chỉ là `whisper` và `whisper-tiny-en` lỗi nguyên file 53:57, không phải test turbo hay hai provider này.

## OpenAI API chính thức

`POST /v1/audio/transcriptions` nhận file multipart, công bố các format `flac`, `mp3`, `mp4`, `mpeg`, `mpga`, `m4a`, `ogg`, `wav`, `webm` và cap 25 MB. Hướng dẫn riêng cho file lớn khuyên dùng format nén hoặc chia file, tránh cắt giữa câu. [File transcription](https://developers.openai.com/api/docs/guides/speech-to-text) và [API reference](https://developers.openai.com/api/reference/python/resources/audio/subresources/transcriptions/methods/create).

| Model hiện hành | Text và timing trong cùng response | Context/chunk | Streaming file | Ý nghĩa cho Enjoy |
| --- | --- | --- | --- | --- |
| `whisper-1` | Có thể trả `verbose_json` gồm text, và yêu cầu đồng thời `word` + `segment` qua `timestamp_granularities`. Tài liệu nói tham số timestamps chỉ hỗ trợ model này. | Có `prompt`; hướng dẫn Whisper nêu giới hạn 224 token. `chunking_strategy` là contract chung, nhưng không có benchmark Enjoy. | Không hỗ trợ, cờ stream bị bỏ qua. | Lựa chọn direct OpenAI duy nhất có word timing công bố, phù hợp nếu cần merge theo word trước DTW. Vẫn vướng cap 25 MB. |
| `gpt-transcribe` | Có text. Tài liệu không công bố word/segment timestamps qua `timestamp_granularities`, vì phần đó chỉ dành cho `whisper-1`. | Có `prompt`, `keywords`, `languages` để thêm context. | Có SSE khi `stream=true`. | Guide hiện hành khuyên bắt đầu model này cho transcription phổ thông, nhưng không thay được timing word mà Enjoy cần cho merge. |
| `gpt-4o-transcribe` | Có text JSON; reference hiện hành ghi chỉ hỗ trợ `json`, nên không dựa vào `verbose_json`, word hay segment timestamps. | `prompt` được hỗ trợ. Không coi `chunking_strategy` là bằng chứng rằng nó xử lý nguyên file vượt cap. | Có file streaming. | Có thể benchmark chất lượng text, nhưng vẫn cần DTW từ transcript và policy chunk/retry riêng. |
| `gpt-4o-mini-transcribe` | Như `gpt-4o-transcribe`: JSON text, không có word/segment timestamps được công bố. | `prompt` được hỗ trợ. | Có file streaming. | Cùng giới hạn tích hợp như bản lớn; chỉ đánh giá sau trên corpus thật. |
| `gpt-4o-transcribe-diarize` | `diarized_json` trả combined text và segment có `speaker`, `start`, `end`; `timestamp_granularities` không có, nên không coi là word timing. | Không hỗ trợ prompt. Với audio dài hơn 30 giây phải đặt `chunking_strategy: "auto"` hoặc VAD config; `auto` chuẩn hóa loudness rồi chọn biên bằng VAD. | Có file streaming. | Chỉ chọn khi speaker label là yêu cầu. Server VAD không bỏ cap 25 MB hay thay nghiệm thu biên/từ của Enjoy. |

`stream=true` là stream event trong lúc **một file đã được gửi**, không phải quyền gửi stream audio vô hạn hay resume job. `chunking_strategy: "auto"` là server cut/VAD được công bố, nhưng chỉ diarize có yêu cầu model-specific rõ ràng trên audio >30 giây. Với transcript phục vụ caption/IPA, không thay quality gate, offset hay DTW bằng cách bật cờ đó.

## OpenRouter không chỉ là Chat Completions

OpenRouter có STT endpoint chuyên dụng `POST /api/v1/audio/transcriptions`, tách khỏi `input_audio` ở `/api/v1/chat/completions`. Endpoint STT nhận base64 JSON `input_audio` hoặc multipart theo kiểu OpenAI. Chat audio dùng để hỏi/nhận xét nội dung audio và trả chat completion, không phải contract subtitle/timestamp. [OpenRouter STT guide](https://openrouter.ai/docs/guides/overview/multimodal/stt) và [multimodal overview](https://openrouter.ai/docs/guides/overview/multimodal/overview).

| Hạng mục | Contract OpenRouter đã công bố | Hệ quả với file 53:57 |
| --- | --- | --- |
| Multipart | Có `file` + `model`; docs ghi cap 25 MB và hỗ trợ `language`, `temperature`, `response_format`, `timestamp_granularities`. `prompt` được nhận nhưng bị bỏ qua. | Không thể kết luận raw 25.903.156 byte pass do đơn vị MB chưa được định nghĩa trong docs. |
| Base64 JSON | Có `input_audio.data` raw base64 và `input_audio.format`; docs nói file lớn hơn multipart có thể dùng đường này với streaming offload, nhưng **không công bố trần byte cụ thể**. | Raw file thành 34.537.544 ký tự base64 trước JSON. Đây không chứng minh request bị từ chối, cũng không chứng minh sẽ qua. |
| Thời gian xử lý | Guide nói upstream provider timeout sau 60 giây mỗi request và khuyên tách recording mất hơn khoảng một phút xử lý. Đây là ràng buộc upstream được hướng dẫn, không phải hard cap duration chung cho mọi model/API. | Whole-file 53:57 có thể timeout; vẫn thiết kế chunk, retry và resume. |
| Timestamp/diarization | `verbose_json` yêu cầu segment; thêm `word` để yêu cầu words. Field thật phụ thuộc provider, model không có structured output có thể trả 400. Provider-specific options nằm dưới `provider.options`; routing controls của Chat không áp dụng endpoint này. | Không suy bất cứ STT model nào cũng trả words, diarization hay nhận option Azure. Kiểm model page hoặc live response trước khi đưa vào merge. |

`microsoft/mai-transcribe-2` là ngoại lệ đã có contract rõ: model page OpenRouter hướng dẫn `verbose_json` cho segment timestamp, `timestamp_granularities: ["word"]` cho word timestamp và `provider.options.azure.diarization.enabled` cho speaker. STT guide còn có ví dụ cùng response gồm `text`, `segments`, `words` và speaker cho model này. [MAI-Transcribe 2](https://openrouter.ai/microsoft/mai-transcribe-2).

## Đối chiếu code và bằng chứng Enjoy

Source đang chọn cố định MAI 2, gửi base64 JSON đến endpoint STT chuyên dụng, yêu cầu cả segment/word timestamps cùng diarization Azure. Nó chỉ nhận PCM WAV, giới hạn body JSON 8.000.000 byte, cắt tối đa 60 giây, cộng offset về audio gốc và tuần tự hóa chunk. Đây là policy app, không phải suy luận hard cap của OpenRouter. [Service](../../../enjoy/src/main/mai-transcribe/service.ts) và [types](../../../enjoy/src/types/mai-transcribe.ts).

Bằng chứng trái chiều cần giữ: WAV stereo đoạn 300 giây nhận 502; đoạn 280 giây nhận 400 `The selected model does not support large audio inputs`. Đây là đúng request/config đã thử, không chứng minh mọi format/model có hard cap đó. Sau khi giảm còn 60 giây, đã có acceptance trên video YouTube thật 5:23: sáu chunk 60 giây, 47 câu, 801 word, phụ đề/IPA, seek và các thao tác playback đã kiểm đều pass. Nó chứng minh đúng integration này vận hành ở 5:23, không chứng minh chất lượng hay completion 53:57. Receipt vẫn ghi sáu phone duration bằng 0 nằm trước start token cha; clip khác hiện có lỗi playback câu #2 nên không gọi mọi playback là pass. Sau ASR, renderer vẫn chạy Echogarden DTW để dựng hierarchy token/phone mà UI IPA dùng, nên raw word timestamp của provider không đủ để bỏ DTW. [Acceptance MAI](../enjoy-api-replacement/2026-09-08-mai-transcribe-integration.md) và [DTW call](../../../enjoy/src/renderer/hooks/use-transcribe.tsx).

## Quyết định cho case 53:57

1. **Không gửi nguyên MP3 sang OpenAI direct như một đường chắc chắn.** Lấy `stat` raw byte sau transcode. Chỉ thử one-shot nếu body đã được nén xuống dưới 25.000.000 byte, đồng thời coi đó là benchmark riêng, không thay acceptance chunked.
2. **Giữ OpenRouter MAI 2 làm đường khả dụng nhất hiện nay.** Nó đã vượt một video 5:23 với timestamp và DTW, nhưng 53:57 chưa được chạy. Dùng chunk có VAD/overlap, absolute offset, time-window sequence alignment, retry/resume và quality gate đã nêu trong `asr-terra.md`.
3. **Không dùng Chat Completions audio làm thay STT.** Nó không có contract transcript/timestamp tương đương; dùng endpoint transcription để giữ response có cấu trúc.
4. **Nếu benchmark direct OpenAI:** `whisper-1` là lựa chọn có cả text và word timestamp công bố. `gpt-transcribe` phù hợp để đối chứng text/context/streaming, còn gpt-4o variants không cung cấp word timing công bố. Đo WER, deletion ở biên, lặp, timing và resume trên đúng 53:57.

## Những điều chưa biết

- Chưa gọi OpenAI direct bằng credential của Enjoy, nên không có outcome, tốc độ, chi phí hay chất lượng thực cho file 53:57.
- OpenRouter không công bố cap byte của base64 JSON/streaming offload, và docs chỉ nêu timeout upstream. Không suy promise duration riêng cho MAI 2.
- Chưa benchmark whole-file 53:57 qua MAI 2. Bằng chứng 5:23 không thể ngoại suy duration, latency hay boundary quality.
- `chunking_strategy` của OpenAI diarize vẫn phải đo mất từ/lặp ở biên trước khi bật mặc định.

Nguồn và trạng thái truy cập nằm trong `provider-sources.json`.
