# Thẩm định trước đề xuất cho Enjoy

Ngày 2026-09-08. Đây là nghiên cứu và đối chiếu source, chưa phải bản cải tiến hoặc nghiệm thu runtime mới.

## Các câu hỏi phải trả lời

1. Gửi nguyên file và chia đoạn có những bằng chứng thuận/nghịch nào trên đúng model?
2. Có thể giữ âm thanh, chữ, ngữ cảnh và thời gian gốc bằng những cơ chế open source nào? Các cơ chế đó thất bại ở đâu?
3. Enjoy hiện giữ đủ dữ liệu để ghép theo word timestamp và đánh giá chất lượng chưa?
4. Lỗi phát câu có tương đồng đã được ghi nhận trong đúng phiên bản WaveSurfer không?
5. Đề xuất nào có thể thử trước với ít thay đổi nhất và chứng cứ nào mới đủ chấp nhận?

## Kết quả đọc source Cloudflare và Enjoy

- Schema turbo hiện có các tùy chọn context và chống hallucination. Schema của whisper/tiny-en không công bố cùng bộ tùy chọn. Tham số tên giống nhau không cho phép coi các model là một backend tương đương. Xem P02, P04, P05 trong `parent-sources.json`.
- Tutorial Cloudflare slice theo byte rồi nối text, không xử lý word/timing. Đây là ví dụ giới thiệu, không phải thuật toán ghép lời có thể đưa nguyên vào sản phẩm học phát âm. Nguồn P01 và tài liệu `atrim` P16.
- Worker Enjoy `normalizeResponse()` chỉ giữ `text/start/end` của segment. `segments.words`, các chỉ số tin cậy và `transcription_info` trong schema provider không đi qua hợp đồng hiện tại. Ghép overlap dựa trên word timestamp cần chuẩn bị hợp đồng dữ liệu trước. Đọc `services/enjoy-workers-ai/src/index.js:248` và `enjoy/src/main/cloudflare-transcribe/service.ts:73`.
- Worker hiện bật `vad_filter: true` và không truyền glossary/previous context; giới hạn 600.01 giây và ~30 MB WAV là guard ứng dụng. Nguồn local `services/enjoy-workers-ai/src/index.js:350`, `enjoy/src/main/cloudflare-transcribe/service.ts:11`.
- `workers-ai-provider` ở commit 917c0243, package version 4.0.0, có adapter ASR hữu ích làm mẫu giao thức. Nó gọi một request và không cung cấp coordinator chia/ghép dài. Dependency AI SDK 7 cũng không phải lý do để nâng stack trong nhiệm vụ này. Nguồn P11, P12.

## Phản ví dụ cần giữ trong kết luận

### Không đánh đồng failure giữa các model

Phép thử 53:57 đã thất bại với tiny-en và whisper. Không có phép thử tương đương nguyên 53:57 trên turbo trong bằng chứng đang có. Repo cộng đồng `thun888/whisper_cloudflare` báo xử lý 41:39; source pinned của họ dùng một lần AI.run turbo. Đây là báo cáo tự công bố, chưa xác minh chất lượng, nhưng phản bác việc lấy failure model khác làm bằng chứng turbo bắt buộc chia đoạn. Nguồn P09/P10.

### VAD nên hỗ trợ chọn điểm cắt trước khi dùng để loại bỏ audio

faster-whisper issue #944 báo VAD làm mất lyric ở một file. Điều này không chứng minh VAD luôn sai, nhưng đủ yêu cầu kiểm tra các khoảng bị bỏ. Đề xuất cho giai đoạn đầu: dùng VAD để chọn ranh giới, giữ coverage liên tục của sample nguồn; chỉ loại bỏ vùng không lời sau khi có bằng chứng riêng. Đây là suy luận thiết kế dựa trên rủi ro đã có báo cáo, không phải thuật toán đã nghiệm thu.

### Midpoint ownership chưa bảo đảm không mất hoặc trùng chữ

Phản ví dụ toán học, không phải log của Enjoy: seam ở 20.00 giây, core trái kết thúc trước 20.00 và core phải bắt đầu tại 20.00. Cùng một từ trong overlap được model gán midpoint 19.90 ở request trái và 20.10 ở request phải, cả hai bản được giữ. Nếu hai timestamp đảo lại, cả hai bị bỏ. Vì vậy midpoint chỉ là bước chọn ứng viên, phải có đối sánh chuỗi từ trong overlap, kiểm khoảng thời gian, giữ lặp thật và đánh dấu seam chưa giải được. Không dùng LLM viết lại transcript để che seam.

### Giữ context cũng có mặt trái

Whisper source nêu trade-off giữa nhất quán và failure loops. Preprint 2608.31170v1 mới bổ sung context vào các stream VAD, nhưng thử nghiệm dùng large-v2 trên T4, không phải Cloudflare turbo. Không chuyển số liệu của bài thành dự báo chất lượng/tốc độ cho Enjoy. Nguồn P13 và báo cáo Terra.

## Tiêu chí đánh giá đề xuất

- Tách ASR thiếu chữ, timestamp sai và player không phát thành ba phép đo khác nhau.
- Có bản chuẩn nghe kiểm cho cả vùng nối và các vùng xa điểm nối; nguồn tự sinh hoặc phụ đề chưa kiểm không được coi là ground truth.
- WER cần báo thêm deletion/insertion/substitution và lỗi tên riêng, không chỉ tổng số từ.
- Giữ audio source coordinates bằng sample/frame index. Sau VAD hoặc trim, map phải đưa về cùng trục thời gian của video đang phát.
- Không lấy HTTP 200, timestamp cuối gần duration, hoặc transcript trông hợp lý làm bằng chứng đủ lời.
- Với retry/cancel/resume, không công bố job hoàn tất nếu còn chunk thiếu hoặc seam chưa giải được.

## Quét phạm vi

Đã xét decode/container, VAD, ASR/context, ghép và offset, alignment, lưu kết quả, phát câu, và cách nghiệm thu. Phạm vi là Enjoy Electron trên macOS, audio học tiếng Anh và provider Cloudflare hiện tại. Đây không phải đánh giá pháp lý/giá dịch vụ theo quốc gia. Giấy phép mã chỉ dùng để phân loại khả năng tái sử dụng; chưa xác minh mọi trọng số model. Nguồn mới năm 2026 được phân biệt với issue lịch sử và source có pinned commit. Không thay đổi dữ liệu người dùng, source ứng dụng hoặc deployment.
