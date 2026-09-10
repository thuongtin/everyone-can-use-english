# Giải pháp open source cho ASR dài và phát từng câu trong Enjoy

Ngày kiểm chứng: 2026-09-08. Terra nghiên cứu ASR; Luna truy nguồn WaveSurfer; agent chính đối chiếu source Enjoy, kiểm tra nguồn quan trọng và phản biện đề xuất. Phạm vi là nghiên cứu trước cải tiến. Chưa chạy thuật toán chia mới, chưa sửa ứng dụng hoặc deploy trong lượt này.

## Kết luận để ra quyết định

1. **Chia audio có thể làm mất chữ/ngữ cảnh, nhưng gửi nguyên file cũng không bảo đảm chất lượng.** Cách đáng thử là chọn điểm cắt theo lời nói, giữ tọa độ audio gốc, ghép có đối sánh và kiểm lại chỗ nối. WhisperX có bằng chứng nghiên cứu cho VAD Cut & Merge, còn Whisper tham chiếu dùng seek/context và có cơ chế chống lặp. Đây là cơ sở chọn phương án thử, chưa là cam kết chất lượng cho Cloudflare. [WhisperX](https://arxiv.org/html/2303.00747v2), [Whisper source](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/whisper/transcribe.py).
2. **Chưa đủ bằng chứng loại phương án nguyên file trên turbo.** Failure 53:57 đã quan sát thuộc tiny-en và whisper. Một dự án cộng đồng tự báo turbo xử lý 41:39; code của họ dùng một request. Cần thử đúng turbo với audio hợp lệ trước khi biến chunking thành đường duy nhất. [README tự công bố](https://github.com/thun888/whisper_cloudflare/blob/ada8e08d576650f9433b569761e50f87abecbbbb/README.md), [Worker source](https://github.com/thun888/whisper_cloudflare/blob/ada8e08d576650f9433b569761e50f87abecbbbb/index.js).
3. **Có mã ghép overlap dành riêng cho Whisper để học theo.** Hugging Face đối chiếu chuỗi token và timestamp, thay vì chỉ bỏ vài giây ở biên. Nhưng Cloudflare không công bố token IDs và chỉ bắt buộc trường text, nên không thể gắn nguyên helper đó vào response hiện tại. [Whisper tokenizer merge](https://github.com/huggingface/transformers/blob/0514b65827ea0eade3d0260a81afcef763a3b94d/src/transformers/models/whisper/tokenization_whisper.py), [Cloudflare output schema](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/schema-output.json).
4. **Cần giữ word timestamp trước khi cải tiến ghép.** Worker Enjoy đang chuẩn hóa về text và thời gian cấp segment, bỏ nested words và các chỉ số chất lượng. Đây là thiếu hụt hợp đồng dữ liệu có thể xác minh ngay trong source, độc lập với lựa chọn thuật toán. [Worker Enjoy](../../../services/enjoy-workers-ai/src/index.js:248), [client normalizer](../../../enjoy/src/main/cloudflare-transcribe/service.ts:73).

Độ tin cậy: cao với cơ chế đã đọc trong source/schema; trung bình với khả năng áp dụng đề xuất vào Enjoy; chưa có kết quả nghiệm thu thuật toán mới. Các kết luận về playback được trình bày riêng phía dưới vì lỗi phát hiện tại không đi qua pipeline chia Cloudflare đang đề xuất.

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
