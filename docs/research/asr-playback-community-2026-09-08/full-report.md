---
title: "ASR dài và playback trong Enjoy: nguồn cộng đồng, OpenAI và OpenRouter"
mode: deep
date: 2026-09-08
sources: 79
confidence: "high for source contracts; medium for applicability; runtime changes untested"
---

> Cập nhật sau nghiên cứu: đã có [nghiệm thu live ngày 2026-09-08](live-acceptance.md) cho OpenAI, Cloudflare, MAI 53:57 và runtime playback. Các mục “chưa thử” bên dưới phản ánh thời điểm nghiên cứu; xem báo cáo live để biết kết quả mới.

# Giải pháp open source cho ASR dài và phát từng câu trong Enjoy

Ngày kiểm chứng: 2026-09-08. Terra nghiên cứu ASR; Luna truy nguồn WaveSurfer; agent chính đối chiếu source Enjoy, kiểm tra nguồn quan trọng và phản biện đề xuất. Phạm vi là nghiên cứu trước cải tiến. Chưa chạy thuật toán chia mới, chưa sửa ứng dụng hoặc deploy trong lượt này.

## Kết luận để ra quyết định

1. **Chia audio có thể làm mất chữ/ngữ cảnh, nhưng gửi nguyên file cũng không bảo đảm chất lượng.** Cách đáng thử là chọn điểm cắt theo lời nói, giữ tọa độ audio gốc, ghép có đối sánh và kiểm lại chỗ nối. WhisperX có bằng chứng nghiên cứu cho VAD Cut & Merge, còn Whisper tham chiếu dùng seek/context và có cơ chế chống lặp. Đây là cơ sở chọn phương án thử, chưa là cam kết chất lượng cho Cloudflare. [WhisperX](https://arxiv.org/html/2303.00747v2), [Whisper source](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/whisper/transcribe.py).
2. **Chưa đủ bằng chứng loại phương án nguyên file trên turbo.** Failure 53:57 đã quan sát thuộc tiny-en và whisper. Một dự án cộng đồng tự báo turbo xử lý 41:39; code của họ dùng một request. Cần thử đúng turbo với audio hợp lệ trước khi biến chunking thành đường duy nhất. [README tự công bố](https://github.com/thun888/whisper_cloudflare/blob/ada8e08d576650f9433b569761e50f87abecbbbb/README.md), [Worker source](https://github.com/thun888/whisper_cloudflare/blob/ada8e08d576650f9433b569761e50f87abecbbbb/index.js).
3. **Có mã ghép overlap dành riêng cho Whisper để học theo.** Hugging Face đối chiếu chuỗi token và timestamp, thay vì chỉ bỏ vài giây ở biên. Nhưng Cloudflare không công bố token IDs và chỉ bắt buộc trường text, nên không thể gắn nguyên helper đó vào response hiện tại. [Whisper tokenizer merge](https://github.com/huggingface/transformers/blob/0514b65827ea0eade3d0260a81afcef763a3b94d/src/transformers/models/whisper/tokenization_whisper.py), [Cloudflare output schema](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/schema-output.json).
4. **Cần giữ word timestamp trước khi cải tiến ghép.** Worker Enjoy đang chuẩn hóa về text và thời gian cấp segment, bỏ nested words và các chỉ số chất lượng. Đây là thiếu hụt hợp đồng dữ liệu có thể xác minh ngay trong source, độc lập với lựa chọn thuật toán. [Worker Enjoy](../../../services/enjoy-workers-ai/src/index.js:248), [client normalizer](../../../enjoy/src/main/cloudflare-transcribe/service.ts:73).

Độ tin cậy: cao với cơ chế đã đọc trong source/schema; trung bình với khả năng áp dụng đề xuất vào Enjoy; chưa có kết quả nghiệm thu thuật toán mới. Các kết luận về playback được trình bày riêng phía dưới vì lỗi phát hiện tại không đi qua pipeline chia Cloudflare đang đề xuất.

## OpenAI API và OpenRouter: lựa chọn cho Enjoy

**Cả hai đều khả thi. OpenRouter MAI 2 có integration đã chạy; OpenAI direct là đối chứng đáng thử.** Đây là lựa chọn thử nghiệm, chưa phải kết luận provider nào nhận dạng tốt nhất.

| Đường API/model | Điểm hữu ích cho Enjoy | Giới hạn có ảnh hưởng tới quyết định |
| --- | --- | --- |
| OpenAI `whisper-1` | Text và timestamp word/segment qua `verbose_json`; có prompt. | Cap upload 25 MB; không file streaming. [API reference](https://developers.openai.com/api/reference/python/resources/audio/subresources/transcriptions/methods/create). |
| OpenAI `gpt-transcribe` | Guide hiện khuyên dùng cho text; hỗ trợ prompt, keywords, languages, streaming. | Không có word timestamps được công bố như Whisper. [Guide](https://developers.openai.com/api/docs/guides/speech-to-text). |
| OpenAI `gpt-4o-transcribe` và mini | JSON text, prompt và streaming. | Không dùng `verbose_json`/word timing làm contract; cần alignment để phục vụ timeline. [API](https://developers.openai.com/api/reference/python/resources/audio/subresources/transcriptions/methods/create). |
| OpenAI diarize | Segment kèm speaker/start/end. | Audio >30 giây yêu cầu chunking strategy; không prompt/word timing. Cap upload vẫn áp dụng. [Model](https://developers.openai.com/api/docs/models/gpt-4o-transcribe-diarize). |
| OpenRouter `microsoft/mai-transcribe-2` | Endpoint STT riêng; segment/word timing và tùy chọn diarization Azure. | Không đồng nhất với chat audio hay áp tính năng này cho mọi model. [Model](https://openrouter.ai/microsoft/mai-transcribe-2). |

OpenRouter nhận multipart tối đa 25 MB; base64 JSON có streaming offload nhưng chưa thấy cap byte công bố. Guide cảnh báo upstream timeout 60 giây **xử lý**, không phải giới hạn audio 60 giây. `prompt` top-level ở multipart được nhận nhưng bỏ qua; context riêng phải kiểm capability provider/options. [STT guide](https://openrouter.ai/docs/guides/overview/multimodal/stt).

File MP3 53:57 có 25.903.156 byte, lớn hơn 25 MB thập phân nhưng dưới 25 MiB. Vì docs không định nghĩa đơn vị rõ, nên nén xuống dưới 25.000.000 byte trước thử OpenAI whole-file, hoặc chia đoạn. Việc nằm dưới cap chỉ giải quyết kích thước upload, không chứng minh đầy đủ/chất lượng. OpenAI hướng dẫn tránh cắt giữa câu. [Longer inputs](https://developers.openai.com/api/docs/guides/speech-to-text#longer-inputs).

Bằng chứng Enjoy có cả thuận và nghịch: MAI WAV stereo 300 giây trả 502, 280 giây trả 400 không hỗ trợ large audio; sau đổi chunk 60 giây, video 5:23 hoàn tất với 47 câu/801 word và các thao tác UI đã kiểm. Vẫn có sáu phone lệch containment do DTW và clip khác lỗi playback câu #2. Đây là acceptance tích hợp có phạm vi, chưa là benchmark chất lượng toàn file hoặc 53:57. [Receipt](../enjoy-api-replacement/2026-09-08-mai-transcribe-integration.md).

Đề xuất: tiếp tục MAI 2 với cơ chế chia/ghép kiểm được; benchmark `whisper-1` trực tiếp nếu cần một provider đối chứng có words. Có thể thử `gpt-transcribe` khi ưu tiên chất lượng text, kèm alignment riêng. Đồng thời giữ phép thử turbo nguyên file như nhánh kiểm chứng Cloudflare. Bảng chi tiết model, cap, context và nguồn ở [báo cáo provider](provider-comparison-terra.md).

## Bằng chứng hiện có của Enjoy

Các phép thử sau đã thực hiện trước lượt nghiên cứu này trong cùng task; lượt này đọc lại artifact và source. Không biến chúng thành benchmark của phương án mới.

| Tình huống | Điều đã xác nhận | Điều chưa chứng minh |
| --- | --- | --- |
| Video khoảng 12 phút, WAV 722.512 giây, 46,240,820 byte | Bị guard local ~30 MB chặn trước khi gửi lên Worker; còn guard 600.01 giây. | Không phải bằng chứng Cloudflare từ chối audio 12 phút. |
| MP3 53:57 tới tiny-en và whisper | Full request lỗi 500; control 20 giây nhận được transcript. | Không suy ngưỡng chính thức và không suy turbo cũng thất bại. |
| Control 60 giây ở whisper | HTTP 200 nhưng lặp một cụm 53 lần. | Không được tính pass chất lượng chỉ từ status hoặc timestamp cuối. |
| Câu #2 trong video MAI 37.87 giây | Bounds 8.28 tới 9.880625 hợp lệ; Play đứng tại 00:08, trong khi câu #3 phát được. | Chưa có event trace chứng minh chính xác handler nào gây dừng. |

Bằng chứng gốc: [12 phút](../../../enjoy/tmp/cloudflare-workers-ai-implementation/active-12min-diagnosis.json), [Whisper 53:57](../../../enjoy/tmp/whisper-tiny-53min/whisper-research.md), [playback](../../../enjoy/tmp/selected-sentence-playback-debug/diagnosis.md). Hash các file source đã đối chiếu được lưu trong [local-source-snapshot.json](local-source-snapshot.json).

## Các phương án ASR đáng học theo

| Dự án/cơ chế | Phần có thể học hoặc tái sử dụng | Áp dụng cho Enjoy | Giới hạn cần giữ |
| --- | --- | --- | --- |
| OpenAI Whisper, commit 86098128 | Seek theo cửa sổ, context trước, reset prompt khi cần, kiểm lặp và không lời. | Mẫu tham chiếu về giữ ngữ cảnh và nhận biết failure. | Điều khiển bên trong decoder, không tương đương các HTTP request độc lập. [Source](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/whisper/transcribe.py). |
| faster-whisper, commit ed9a06cd | VAD padding, giới hạn segment, ưu tiên khoảng lặng, mapping về timeline nguồn. | Mẫu tiền xử lý và metadata; ứng viên engine riêng nếu cần tự vận hành. | VAD vẫn có false negative, cần kiểm phần audio bị bỏ. [VAD](https://github.com/SYSTRAN/faster-whisper/blob/ed9a06cd89a93e47838f564998a6c09b655d7f43/faster_whisper/vad.py). |
| WhisperX, commit 2cfd7b7c | VAD Cut & Merge, ASR rồi forced alignment và tách câu. | Tham khảo cách chia/align để phục vụ học từng câu. | Aligner cần phù hợp ngôn ngữ; từ ngoài từ điển và speech chồng vẫn khó. [README](https://github.com/m-bain/whisperX/blob/2cfd7b7c5c7bba144954364db747319b50e8232b/README.md). |
| Hugging Face Whisper, commit 0514b658 | `_find_longest_common_sequence` tìm chỗ khớp giữa hai chuỗi, có xét thứ tự timestamp. | Mẫu cho phần ghép overlap có đối sánh. | CF không trả token IDs; cần thích nghi theo words/text và đo lại. [Source](https://github.com/huggingface/transformers/blob/0514b65827ea0eade3d0260a81afcef763a3b94d/src/transformers/models/whisper/tokenization_whisper.py). |
| vLLM `split_audio`, commit f6326f53 | Tìm điểm năng lượng thấp và cắt liên tiếp, giữ sample nguồn. | Mẫu đơn giản khi chưa cần model VAD riêng. | `overlap_duration_s` ở đây là vùng tìm điểm cắt, không phải audio chồng lấn được gửi hai lần. RMS thấp không bảo đảm là hết từ. [Source](https://github.com/vllm-project/vllm/blob/f6326f53bda46898a331c2d24500332c285d9a2b/vllm/multimodal/audio.py). |
| whisper.cpp, commit c44b60b8 | Native stream/VAD, phần audio giữ lại giữa cửa sổ, context option. | Ứng viên helper local nếu sau này cần engine native. | Packaging/model lifecycle riêng; có issue về overlap gây drift, chưa xác minh release sửa trong báo cáo này. [Stream](https://github.com/ggml-org/whisper.cpp/blob/c44b60b8053bbf2a5c1e014f11323fb3f2485177/examples/stream/stream.cpp), [issue 3683](https://github.com/ggml-org/whisper.cpp/issues/3683). |
| WhisperStreaming, commit 6da90b44 | LocalAgreement chỉ xác nhận prefix ổn định qua các lần decode. | Hữu ích nếu thêm chép lời realtime. | Decode lại làm tăng công việc; không phải lựa chọn ưu tiên cho upload video offline. [Source](https://github.com/ufal/whisper_streaming/blob/6da90b44b7e50d79695e68166d2a2c7609c75abb/whisper_online.py). |
| stable-ts, commit e312072c | Regroup theo gap/punctuation và điều chỉnh timestamp. | Tham khảo hậu xử lý. | Repo đã archive ngày 2026-05-30 và ngừng phát triển vô thời hạn, không chọn làm phụ thuộc mới lúc này. [Project](https://github.com/jianfch/stable-ts). |
| Cloudflare workers-ai-provider 4.0.0, commit 917c0243 | Mẫu giao thức và chuẩn hóa model khác nhau; truyền abort signal. | Đối chiếu adapter hiện tại. | Không có coordinator chia/ghép dài; nâng SDK không tự sửa ASR/player. [Source](https://raw.githubusercontent.com/cloudflare/ai/917c02430090e7d511abf138091a2c17135515b2/packages/workers-ai-provider/src/workersai-transcription-model.ts). |

Giấy phép mã đã đọc: Whisper, faster-whisper, whisper.cpp, WhisperStreaming và stable-ts dùng MIT; WhisperX dùng BSD-2-Clause. Bản kê và URL LICENSE nằm trong [báo cáo Terra](asr-terra.md). Đây không phải xác nhận giấy phép của mọi trọng số model hoặc dependency và không phải đề xuất cài tất cả các thư viện trên.

## Cloudflare: điều tài liệu xác nhận và điều không xác nhận

Schema turbo hiện công bố `initial_prompt`, `prefix`, `condition_on_previous_text`, `vad_filter` kiểu boolean và các threshold liên quan speech/lặp. Đây là cơ sở để làm A/B context có kiểm soát. Không đồng nhất `initial_prompt` của request mới với token state đang sống trong decoder. Schema whisper/tiny-en chỉ công bố binary hoặc array byte, nên không chuyển nguyên tùy chọn turbo sang hai model đó. [Turbo schema](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/schema-input.json), [Whisper schema](https://developers.cloudflare.com/workers-ai/models/whisper/schema-input.json), [tiny-en schema](https://developers.cloudflare.com/workers-ai/models/whisper-tiny-en/schema-input.json).

Tutorial chính thức chia ArrayBuffer thành các phần 1 MiB, gửi từng phần và nối text. Nó chưa giải quyết container, overlap, dedup hay timeline. FFmpeg có `atrim` theo sample và `asetpts` cho timestamp đầu output; khi dùng cần giữ offset nguồn riêng. Không dùng byte offset làm thời gian audio và không lấy kích thước ví dụ làm hạn mức API. [Tutorial](https://developers.cloudflare.com/workers-ai/guides/tutorials/build-a-workers-ai-whisper-with-chunking/), [FFmpeg atrim](https://ffmpeg.org/ffmpeg-filters.html#atrim).

Cloudflare Stream có triển khai chia batch 30 giây, xử lý song song, sắp response và điều chỉnh timestamp. Đây là bằng chứng hệ thống thực tế cho coordinator có thứ tự, không phải hard limit 30 giây. Trang limits hiện liệt kê rate limit ASR, còn bảng errors tách 413/request-too-large khỏi 408/timeout. Chưa tìm được một ngưỡng phút/MB chính thức đủ để giải thích response 6001 của các phép thử này. [Stream engineering](https://blog.cloudflare.com/stream-automatic-captions-with-ai/), [limits](https://developers.cloudflare.com/workers-ai/platform/limits/), [errors](https://developers.cloudflare.com/workers-ai/platform/errors/).

## Những điều dễ làm sai khi ghép audio

| Giả định | Bằng chứng phản biện | Điều nên làm trong thử nghiệm |
| --- | --- | --- |
| VAD bảo đảm không mất lời | faster-whisper issue 944 báo mất lyric trên một file khi đổi VAD. | Giai đoạn đầu dùng VAD chọn điểm cắt, giữ coverage sample liên tục; chưa tự bỏ vùng âm thanh chỉ vì VAD gọi là silence. [Issue](https://github.com/SYSTRAN/faster-whisper/issues/944). |
| Overlap rồi chọn word theo midpoint là đủ | Nếu timestamp của cùng từ nằm hai phía seam ở hai request, có thể giữ hai bản hoặc bỏ cả hai. Đây là phản ví dụ toán học, không phải tỷ lệ lỗi đo được. | Đối sánh chuỗi từ trong cửa sổ thời gian hẹp, giữ lặp thật, đánh dấu vùng không phân giải được. [Mẫu ghép Whisper](https://github.com/huggingface/transformers/blob/0514b65827ea0eade3d0260a81afcef763a3b94d/src/transformers/models/whisper/tokenization_whisper.py). |
| Truyền toàn bộ text trước luôn tốt hơn | Whisper source cảnh báo loop và timestamp lệch; report cộng đồng ghi nhận lời ảo khi không có tiếng nói. | So sánh không prompt, glossary đã xác nhận và đoạn context ngắn; chặn lan lỗi từ phần trước. [Whisper source](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/whisper/transcribe.py), [discussion 679](https://github.com/openai/whisper/discussions/679). |
| Forced alignment sửa được transcript mất chữ | Aligner định vị text được cung cấp; WhisperX nêu từ ngoài từ điển và speech chồng vẫn hạn chế. | Tách kiểm đúng chữ khỏi kiểm đúng thời gian, không dùng alignment như công cụ phục hồi chữ bị ASR bỏ. [WhisperX](https://github.com/m-bain/whisperX/blob/2cfd7b7c5c7bba144954364db747319b50e8232b/README.md). |
| HTTP 200 và timestamp cuối gần cuối video là đủ | Control 60 giây của chính task trả 200 nhưng lặp 53 lần. | Đối chiếu reference và vùng không lời, báo insertion/deletion. [Evidence Enjoy](../../../enjoy/tmp/whisper-tiny-53min/whisper-research.md), [JiWER](https://jitsi.github.io/jiwer/usage/). |

Preprint mới **Context-Aware Interleaved Batching for WhisperX** ngày 2026-08-31 đáng theo dõi: giữ FIFO context theo từng stream VAD và chạy lại batch đầu để bổ sung context. Tuy nhiên, bài thử trên large-v2/T4 và có thước đo dùng LLM; chưa thể áp số liệu cho Cloudflare turbo hoặc coi là patch ổn định sẵn dùng. [Bài đầy đủ](https://arxiv.org/html/2608.31170v1).

## Phương án đề xuất để kiểm chứng trước khi cải tiến

Đây là quyết định kỹ thuật được suy ra từ nguồn, chưa phải thay đổi đã triển khai.

**Bước ưu tiên 1: xác định baseline đúng model.** Thử nguyên file đã chuẩn hóa với turbo trên cùng audio 12 phút và 53:57, đồng thời đo đầy đủ/chất lượng. Chạy trong harness tách biệt, giữ transcript live. Kết quả tiny/whisper không thay thế phép thử này. Nếu nguyên file đạt chất lượng và độ bền mong muốn, có thể giữ làm đường chính; chunking là phương án cho lỗi kích thước/thời gian hoặc nhu cầu tiến độ/retry.

**Bước ưu tiên 2: nếu cần chunking, dùng thiết kế có dữ liệu kiểm được.** Chia trên PCM theo sample index, ưu tiên điểm ngắt ít lời, mỗi chunk là file audio hợp lệ. Lưu khoảng nguồn/core/context riêng. Giữ nguyên raw response cần thiết, word timing và các chỉ số chất lượng qua Worker/client. Chuyển thời gian về video gốc, đối sánh overlap rồi mới xuất transcript cuối. Khi thiếu words hoặc seam không rõ, retry vùng lớn hơn hoặc báo cần kiểm; không tự sửa câu bằng LLM.

**Bước ưu tiên 3: context và độ dài là ma trận thử, không phải hằng số đúng sẵn.** So sánh các request có tổng thời lượng 20, 30 và 60 giây, nêu rõ overlap nằm trong tổng đó. Thử không prompt, glossary và context ngắn; ghi lại VAD/options. Các mốc này chỉ là cấu hình thí nghiệm để đo trade-off. Không công bố ngưỡng provider từ một lần pass/fail.

**Bước ưu tiên 4: coordinator có trạng thái.** Manifest gắn hash audio, model, options, phiên bản chia, chunk index và offset. Response về lệch thứ tự phải được sắp lại; retry không append trùng; cancel vô hiệu hóa response cũ; resume không trộn cấu hình. Đây là phần thiết kế Enjoy cần tự tích hợp, không có thư viện nêu trên nào tự giải quyết đầy đủ hợp đồng hiện tại.

Không chọn lúc này: copy nguyên tutorial byte-slicing; hard cut rồi nối chuỗi; sao chép CTC stride sang Whisper; nâng WaveSurfer/AI SDK để thử may rủi; chuyển toàn bộ sang engine tự host khi chưa có benchmark nhu cầu. Các lựa chọn này hoặc bỏ qua failure đã thấy, hoặc thay quá nhiều phần mà chưa giải quyết được tiêu chí cần kiểm.

## Playback: cộng đồng đã có bản sửa sát hiện tượng

Enjoy cài WaveSurfer 7.9.1 và truyền native MediaElement. Source có `region.play()` và handler `region-out` gọi pause ngay. Ở phiên bản này, chỉ `region.play(true)` mới truyền điểm end cho bounded playback. Plugin phát event theo membership của `currentTime`, kể cả khi seek lúc paused. [Source 7.9.1](https://raw.githubusercontent.com/katspaugh/wavesurfer.js/7.9.1/src/plugins/regions.ts), [phân tích Luna](playback-luna.md).

Chuỗi issue [#3866](https://github.com/katspaugh/wavesurfer.js/issues/3866), [#3631](https://github.com/katspaugh/wavesurfer.js/issues/3631), [#3781](https://github.com/katspaugh/wavesurfer.js/issues/3781) báo Chrome phát `region-out` sớm với start dạng thập phân. PR [#4359](https://github.com/katspaugh/wavesurfer.js/pull/4359), merge 2026-09-03, sửa phép kiểm start bằng tolerance 50 ms. Agent chính đã đọc cả diff, xác nhận end không được nới. Cơ chế phù hợp với hiện tượng Enjoy, nhưng root cause tại runtime vẫn chưa được chứng minh.

Một bản sửa khác, [#4318](https://github.com/katspaugh/wavesurfer.js/pull/4318), có trong [7.12.8](https://github.com/katspaugh/wavesurfer.js/releases/tag/7.12.8), clamp thời gian về điểm stop sau khi timer đi quá end. Việc clamp vị trí hiển thị sau pause không chứng minh âm thanh chưa từng phát quá biên. Phải đo audio/time thực tế trong Chromium và các playback rate. Chưa xác nhận release ổn định chứa #4359; không đề xuất nâng lên một version đoán trước.

Hướng ưu tiên là trace đúng click câu #2: native time/paused/seeking/readyState; region ID và bounds; create/remove; `setTime`, `play`, `pause` kèm caller; `region-in/out` theo thứ tự. Đối chiếu race thay region sau debounce 100 ms với race rounding upstream. Sau đó mới chọn áp patch có phạm vi hẹp hoặc nâng dependency. Không sao chép toàn bộ PR đang gồm cả thay đổi Record/mobile khi chỉ cần sửa playback câu.

Tách bounded playback khỏi loop và kiểm active instance/region trước khi pause. Chạy câu #2, #3, start nhiều số lẻ, chuyển nhanh giữa câu, nhấn Play lặp, zoom, single/loop, 0.5x/1x/1.5x và recording player. Các case, trường trace và vị trí source đầy đủ có trong báo cáo Luna. Chưa sửa hoặc chạy playback mới trong lượt nghiên cứu này.

## Nghiệm thu đề xuất cho vòng triển khai tiếp theo

| Nhóm | Phép kiểm có thể phát hiện lỗi | Điều kiện đánh giá |
| --- | --- | --- |
| Đúng nội dung | Reference do người nghe xác nhận, đo substitution/deletion/insertion trên toàn file và từng vùng nối ±3 giây. | Không lấy timestamp cuối hoặc HTTP 200 làm pass; báo riêng từ mất, từ lặp, tên riêng. [JiWER](https://jitsi.github.io/jiwer/usage/). |
| Giữ audio | Manifest sample start/end, kiểm khoảng nguồn và sample coverage trước encode. | Không bỏ âm thanh vì VAD nếu chưa đo false negative; chunk là audio container hợp lệ. [FFmpeg](https://ffmpeg.org/ffmpeg-filters.html#atrim). |
| Ngữ cảnh | Cùng audio/model, A/B không prompt, glossary và context ngắn. | Ghi cả cải thiện và lỗi lặp lan từ chunk trước; không mặc định prompt luôn tốt. [Whisper](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/whisper/transcribe.py). |
| Timestamp | Kiểm bounds nguồn, offset, thứ tự, từ ở seam và nghe click từng câu. | Đo chữ đúng và thời gian đúng riêng; không dùng forced alignment để chứng minh ASR không mất chữ. [WhisperX](https://github.com/m-bain/whisperX/blob/2cfd7b7c5c7bba144954364db747319b50e8232b/README.md). |
| Điều phối | Response đảo thứ tự, retry, cancel rồi trả response trễ, resume khác options. | Manifest không trộn model/cấu hình; không append trùng; transcript live chỉ thay khi hoàn tất. Đây là tiêu chí thiết kế Enjoy, chưa chạy. |
| Playback | Native event trace và audio thật trong exact packaged build. | Click câu chạy xuyên vùng; không pause sớm; đúng single/loop, tốc độ và main/recording. [PR tham chiếu](https://github.com/katspaugh/wavesurfer.js/pull/4359). |

Audio 53:57 hiện chưa có reference toàn bộ đã được xác nhận, nên chưa thể báo WER cho file đó. Vòng benchmark cần reference trước khi kết luận provider nào chất lượng hơn. Trước mắt có thể dùng toàn bộ clip ngắn, các cửa sổ quanh seam, đầu/giữa/cuối của file dài để tìm failure; phải gọi rõ đó là đánh giá theo mẫu.

## Phương pháp, phản biện và giới hạn

Terra nhận ownership ASR và so sánh provider; Luna nhận WaveSurfer. Agent chính đọc artifact, đối chiếu source Enjoy và kiểm lại các nguồn quyết định: Cloudflare schema/tutorial/SDK, dự án turbo nguyên file, code ghép Whisper, vLLM, nghiên cứu WhisperX, API provider và diff WaveSurfer. Nghiên cứu ưu tiên primary source, source code pin commit, issue có reproduction và tài liệu API chính thức. Số URL không tương đương số bằng chứng độc lập; LICENSE được đếm riêng.

Các sửa sau phản biện đã được đưa vào kết luận: rút khẳng định chưa có chứng cứ về release whisper.cpp sửa issue 3683; không gọi 20 hoặc 30 giây là limit Cloudflare; không dùng midpoint đơn độc để dedup; không đồng nhất vùng tìm điểm cắt của vLLM với audio overlap; bổ sung phản chứng turbo nguyên file; tách lỗi player khỏi pipeline ASR mới. Report cộng đồng mất lyric là một reproduction, không phải tỷ lệ false negative của VAD nói chung.

Metadata ba bài nghiên cứu được đối chiếu arXiv; hai bài năm 2023 có publication khớp qua Crossref và publisher. Preprint tháng 8/2026 chưa có publication Crossref được xác nhận. Trường cập nhật trống không chứng minh đã kiểm toàn diện việc rút bài. Chi tiết nằm trong [academic-metadata-check.json](academic-metadata-check.json).

Độ tin cậy cao ở hợp đồng/source đã kiểm, trung bình ở mức phù hợp của giải pháp, chưa xác định ở chất lượng audio 53:57 và root cause runtime playback. Không có benchmark so sánh provider mới, chi phí đo thực tế hoặc chất lượng seam sau triển khai. Lượt này chỉ tạo tài liệu nghiên cứu.

## Nhật ký xác minh

Có 79 URL ngoài duy nhất, gồm 6 URL giấy phép; không coi chúng là 79 bằng chứng độc lập. Phạm vi claim, giới hạn, ngày truy cập và commit nằm trong [sources.json](sources.json).

| ID | Nguồn đã truy cập | Loại bằng chứng |
| --- | --- | --- |
| S01 | [Cloudflare turbo chunking tutorial](https://developers.cloudflare.com/workers-ai/guides/tutorials/build-a-workers-ai-whisper-with-chunking/) | official-doc |
| S02 | [Cloudflare turbo input schema](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/schema-input.json) | official-schema |
| S03 | [Cloudflare turbo output schema](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/schema-output.json) | official-schema |
| S04 | [Cloudflare whisper input schema](https://developers.cloudflare.com/workers-ai/models/whisper/schema-input.json) | official-schema |
| S05 | [Cloudflare tiny-en input schema](https://developers.cloudflare.com/workers-ai/models/whisper-tiny-en/schema-input.json) | official-schema |
| S06 | [Workers AI limits](https://developers.cloudflare.com/workers-ai/platform/limits/) | official-doc |
| S07 | [Workers AI errors](https://developers.cloudflare.com/workers-ai/platform/errors/) | official-doc |
| S08 | [Stream Generated Captions engineering](https://blog.cloudflare.com/stream-automatic-captions-with-ai/) | first-party-engineering |
| S09 | [whisper_cloudflare README](https://github.com/thun888/whisper_cloudflare/blob/ada8e08d576650f9433b569761e50f87abecbbbb/README.md) | community-repository |
| S10 | [whisper_cloudflare Worker](https://github.com/thun888/whisper_cloudflare/blob/ada8e08d576650f9433b569761e50f87abecbbbb/index.js) | source-code |
| S11 | [Cloudflare AI SDK transcription adapter](https://raw.githubusercontent.com/cloudflare/ai/917c02430090e7d511abf138091a2c17135515b2/packages/workers-ai-provider/src/workersai-transcription-model.ts) | source-code |
| S12 | [workers-ai-provider package metadata](https://raw.githubusercontent.com/cloudflare/ai/917c02430090e7d511abf138091a2c17135515b2/packages/workers-ai-provider/package.json) | package-metadata |
| S13 | [Context-Aware Interleaved Batching for WhisperX](https://arxiv.org/html/2608.31170v1) | preprint |
| S14 | [WhisperX: Time-Accurate Speech Transcription of Long-Form Audio](https://arxiv.org/html/2303.00747v2) | research-paper |
| S15 | [Turning Whisper into Real-Time Transcription System](https://arxiv.org/html/2307.14743v2) | research-paper |
| S16 | [FFmpeg atrim/asetpts](https://ffmpeg.org/ffmpeg-filters.html#atrim) | official-doc |
| S17 | [FFmpeg segment muxer](https://ffmpeg.org/ffmpeg-formats.html#segment) | official-doc |
| S18 | [JiWER usage and alignment errors](https://jitsi.github.io/jiwer/usage/) | official-doc |
| S19 | [JiWER empty reference semantics](https://jitsi.github.io/jiwer/) | official-doc |
| S20 | [vLLM split_audio and find_split_point](https://github.com/vllm-project/vllm/blob/f6326f53bda46898a331c2d24500332c285d9a2b/vllm/multimodal/audio.py) | source-code |
| S21 | [Hugging Face Whisper overlap merge](https://github.com/huggingface/transformers/blob/0514b65827ea0eade3d0260a81afcef763a3b94d/src/transformers/models/whisper/tokenization_whisper.py) | source-code |
| S22 | [openai/whisper transcribe.py](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/whisper/transcribe.py) | primary-source-code |
| S23 | [openai/whisper LICENSE](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/LICENSE) | primary-license |
| S24 | [A possible solution to Whisper hallucination](https://github.com/openai/whisper/discussions/679) | first-hand-community-discussion |
| S25 | [faster-whisper README](https://github.com/SYSTRAN/faster-whisper/blob/ed9a06cd89a93e47838f564998a6c09b655d7f43/README.md) | primary-project-docs |
| S26 | [faster-whisper vad.py](https://github.com/SYSTRAN/faster-whisper/blob/ed9a06cd89a93e47838f564998a6c09b655d7f43/faster_whisper/vad.py) | primary-source-code |
| S27 | [faster-whisper transcribe.py](https://github.com/SYSTRAN/faster-whisper/blob/ed9a06cd89a93e47838f564998a6c09b655d7f43/faster_whisper/transcribe.py) | primary-source-code |
| S28 | [faster-whisper LICENSE](https://github.com/SYSTRAN/faster-whisper/blob/ed9a06cd89a93e47838f564998a6c09b655d7f43/LICENSE) | primary-license |
| S29 | [Transcriptions with repeated sentences](https://github.com/SYSTRAN/faster-whisper/issues/465) | first-hand-github-issue |
| S30 | [After using VAD start and end times incorrect](https://github.com/SYSTRAN/faster-whisper/issues/1119) | first-hand-github-issue |
| S31 | [VAD v5 worse for some audio](https://github.com/SYSTRAN/faster-whisper/issues/944) | first-hand-github-issue |
| S32 | [WhisperX README](https://github.com/m-bain/whisperX/blob/2cfd7b7c5c7bba144954364db747319b50e8232b/README.md) | primary-project-docs |
| S33 | [WhisperX asr.py](https://github.com/m-bain/whisperX/blob/2cfd7b7c5c7bba144954364db747319b50e8232b/whisperx/asr.py) | primary-source-code |
| S34 | [WhisperX LICENSE](https://github.com/m-bain/whisperX/blob/2cfd7b7c5c7bba144954364db747319b50e8232b/LICENSE) | primary-license |
| S35 | [Question: How to use Alignment only?](https://github.com/m-bain/whisperX/issues/289) | first-hand-maintainer-issue |
| S36 | [Alignment off with background noise and music](https://github.com/m-bain/whisperX/issues/344) | first-hand-github-issue |
| S37 | [whisper.cpp stream README](https://github.com/ggml-org/whisper.cpp/blob/c44b60b8053bbf2a5c1e014f11323fb3f2485177/examples/stream/README.md) | primary-project-docs |
| S38 | [whisper.cpp stream.cpp](https://github.com/ggml-org/whisper.cpp/blob/c44b60b8053bbf2a5c1e014f11323fb3f2485177/examples/stream/stream.cpp) | primary-source-code |
| S39 | [whisper.cpp LICENSE](https://github.com/ggml-org/whisper.cpp/blob/c44b60b8053bbf2a5c1e014f11323fb3f2485177/LICENSE) | primary-license |
| S40 | [VAD overlap timestamp drift](https://github.com/ggml-org/whisper.cpp/issues/3683) | first-hand-github-issue |
| S41 | [stable-ts README](https://github.com/jianfch/stable-ts/blob/e312072cc024ae9fceb25b057d7d18524873a02b/README.md) | primary-project-docs |
| S42 | [stable-ts CHANGELOG](https://github.com/jianfch/stable-ts/blob/e312072cc024ae9fceb25b057d7d18524873a02b/CHANGELOG.md) | primary-project-changelog |
| S43 | [stable-ts LICENSE](https://github.com/jianfch/stable-ts/blob/e312072cc024ae9fceb25b057d7d18524873a02b/LICENSE) | primary-license |
| S44 | [Transformers ASR pipeline](https://github.com/huggingface/transformers/blob/0514b65827ea0eade3d0260a81afcef763a3b94d/src/transformers/pipelines/automatic_speech_recognition.py) | primary-source-code |
| S45 | [Incorrect right stride at penultimate chunk](https://github.com/huggingface/transformers/issues/21568) | first-hand-github-issue |
| S46 | [whisper_streaming README](https://github.com/ufal/whisper_streaming/blob/6da90b44b7e50d79695e68166d2a2c7609c75abb/README.md) | primary-project-docs |
| S47 | [whisper_streaming whisper_online.py](https://github.com/ufal/whisper_streaming/blob/6da90b44b7e50d79695e68166d2a2c7609c75abb/whisper_online.py) | primary-source-code |
| S48 | [whisper_streaming LICENSE](https://github.com/ufal/whisper_streaming/blob/6da90b44b7e50d79695e68166d2a2c7609c75abb/LICENSE) | primary-license |
| S49 | [WaveSurfer regions.ts at tag 7.9.1](https://raw.githubusercontent.com/katspaugh/wavesurfer.js/7.9.1/src/plugins/regions.ts) | primary-source-code |
| S50 | [WaveSurfer wavesurfer.ts at tag 7.9.1](https://raw.githubusercontent.com/katspaugh/wavesurfer.js/7.9.1/src/wavesurfer.ts) | primary-source-code |
| S51 | [WaveSurfer player.ts at tag 7.9.1](https://raw.githubusercontent.com/katspaugh/wavesurfer.js/7.9.1/src/player.ts) | primary-source-code |
| S52 | [Official regions example at tag 7.9.1](https://raw.githubusercontent.com/katspaugh/wavesurfer.js/7.9.1/examples/regions.js) | primary-example |
| S53 | [Regions no-audio Cypress test at tag 7.9.1](https://raw.githubusercontent.com/katspaugh/wavesurfer.js/7.9.1/cypress/e2e/regions-no-audio.cy.js) | primary-test |
| S54 | [Feat: play(start, stop)](https://github.com/katspaugh/wavesurfer.js/pull/4014) | merged-pull-request |
| S55 | [Chrome fires region-out immediately on region.play with MediaElement](https://github.com/katspaugh/wavesurfer.js/issues/3866) | first-hand-github-issue |
| S56 | [High-precision region boundaries cause region-out after click](https://github.com/katspaugh/wavesurfer.js/issues/3631) | first-hand-github-issue |
| S57 | [region-in and region-out almost simultaneous](https://github.com/katspaugh/wavesurfer.js/issues/3781) | first-hand-github-issue |
| S58 | [region.play on dragged region can fail](https://github.com/katspaugh/wavesurfer.js/issues/4058) | first-hand-github-issue |
| S59 | [Fix regions region event race](https://github.com/katspaugh/wavesurfer.js/pull/4359) | merged-pull-request |
| S60 | [Fix stop playback exactly at requested position](https://github.com/katspaugh/wavesurfer.js/pull/4318) | merged-pull-request |
| S61 | [WaveSurfer.js release 7.12.8](https://github.com/katspaugh/wavesurfer.js/releases/tag/7.12.8) | official-release |
| S62 | [Region playback boundary problem](https://github.com/katspaugh/wavesurfer.js/issues/4022) | first-hand-github-issue |
| S63 | [Fix region clicked and seek issues](https://github.com/katspaugh/wavesurfer.js/pull/3945) | merged-pull-request |
| S64 | [WaveSurfer.js release 7.8.10](https://github.com/katspaugh/wavesurfer.js/releases/tag/7.8.10) | official-release |
| S65 | [Fix lazy region setOptions visibility](https://github.com/katspaugh/wavesurfer.js/pull/4291) | merged-pull-request |
| S66 | [Fix timer and listener leaks](https://github.com/katspaugh/wavesurfer.js/pull/4209) | merged-pull-request |
| S67 | [Official wavesurfer-react lifecycle wrapper](https://raw.githubusercontent.com/katspaugh/wavesurfer-react/1.0.12/src/index.tsx) | primary-source-code |
| S68 | [WaveSurfer React event listener cleanup discussion](https://github.com/katspaugh/wavesurfer.js/discussions/3452) | maintainer-community-discussion |
| S69 | [OpenAI File transcription](https://developers.openai.com/api/docs/guides/speech-to-text) | official-openai-guide |
| S70 | [OpenAI Create transcription API reference](https://developers.openai.com/api/reference/python/resources/audio/subresources/transcriptions/methods/create) | official-openai-reference |
| S71 | [OpenAI model catalog](https://developers.openai.com/api/docs/models/all) | official-openai-catalog |
| S72 | [OpenAI Whisper model page](https://developers.openai.com/api/docs/models/whisper-1) | official-openai-model-page |
| S73 | [OpenAI GPT-4o Transcribe model page](https://developers.openai.com/api/docs/models/gpt-4o-transcribe) | official-openai-model-page |
| S74 | [OpenAI GPT-4o Mini Transcribe model page](https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe) | official-openai-model-page |
| S75 | [OpenAI GPT-4o Transcribe Diarize model page](https://developers.openai.com/api/docs/models/gpt-4o-transcribe-diarize) | official-openai-model-page |
| S76 | [OpenRouter Speech-to-Text guide](https://openrouter.ai/docs/guides/overview/multimodal/stt) | official-openrouter-guide |
| S77 | [OpenRouter multimodal overview](https://openrouter.ai/docs/guides/overview/multimodal/overview) | official-openrouter-guide |
| S78 | [OpenRouter MicrosoftAI MAI-Transcribe 2 model page](https://openrouter.ai/microsoft/mai-transcribe-2) | official-openrouter-model-page |
| S79 | [OpenRouter Transcription on OpenRouter](https://openrouter.ai/blog/tutorials/transcription-on-openrouter/) | official-openrouter-blog |

## Artifact của từng nhánh

- [ASR Terra](asr-terra.md), [Provider Terra](provider-comparison-terra.md), [Playback Luna](playback-luna.md).
- [Đối chiếu của agent chính](parent-review-notes.md), [metadata học thuật](academic-metadata-check.json), [source snapshot Enjoy](local-source-snapshot.json).
