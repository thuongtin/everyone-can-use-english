# Tích hợp Cloudflare Workers AI vào Enjoy

Ngày kiểm tra: 08/09/2026.

## Kết quả đã xác minh

Worker `enjoy-workers-ai` đã được triển khai vào tài khoản cá nhân được xác minh bằng phiên Chrome của user và Wrangler OAuth. Không đổi gói dịch vụ. Endpoint: [Worker health](https://enjoy-workers-ai.ho-31c.workers.dev/health).

Theo yêu cầu thử không chia nhỏ, đã gửi toàn bộ audio của video [Who Controls Your City’s Money? | Trinity Tran | TED](https://www.youtube.com/watch?v=nptUQtYVl1M) trong **một request**. Audio WAV PCM16 16 kHz stereo dài **323,63975 giây**, nặng **20.712.988 byte**; JSON chứa base64 nặng **27.617.348 byte**. Model `@cf/openai/whisper-large-v3-turbo` trả HTTP 200 sau **14.679 ms**, 4.557 ký tự và 49 segments. Câu đầu và câu cuối đều có trong kết quả; đoạn cuối kết thúc tại 317,22 giây, khớp phần nói cuối trước khi video hết.

Đây là bằng chứng video 5 phút 23 giây này không cần chia đoạn để gọi Workers AI. Chưa đo giới hạn tối đa của model hoặc bảo đảm mọi file dài hơn đều chạy được. Mức 40 MB JSON, 600,01 giây WAV và deadline 180 giây trong Worker là giới hạn do ứng dụng đặt, chưa được chứng minh là hard cap của Cloudflare.

Một phép thử trước dùng Python `urllib` nhận Cloudflare error 1010 ngay cả ở `/health`, nên không đi đến inference và không được dùng để kết luận giới hạn audio. Phép thử hợp lệ dùng Node `fetch`, cùng cơ chế transport dự kiến của Electron main.

## Bảo vệ endpoint

- Native AI binding, model được cố định trong Worker. App không giữ Cloudflare API token.
- Token riêng `ENJOY_CLIENT_TOKEN`, tối thiểu 32 ký tự; giá trị thật không nằm trong source hoặc báo cáo.
- `/health` không gọi AI. Request không có token trả 401; audio không hợp lệ trả 400 trước inference.
- Giới hạn body được kiểm khi đọc stream; chỉ nhận WAV PCM16 16 kHz mono/stereo.
- Lỗi upstream chỉ ghi metadata đã lọc, không ghi audio, transcript, credential hoặc message gốc.
- Timestamp vượt duration tối đa 20 ms do làm tròn được clamp. Sai lệch lớn hơn bị từ chối.

## Bằng chứng

- [Account verification](../../../enjoy/tmp/cloudflare-workers-ai-implementation/account-verification.json)
- [Deployment receipt](../../../enjoy/tmp/cloudflare-workers-ai-implementation/deployment.json)
- [Full audio API receipt](../../../enjoy/tmp/cloudflare-workers-ai-implementation/full-audio-probe-node.json)
- [Sanitized Worker runtime events](../../../enjoy/tmp/cloudflare-workers-ai-implementation/worker-tail-sanitized.jsonl)
- [Worker source](../../../services/enjoy-workers-ai/src/index.js)

## Nghiệm thu bản Enjoy đóng gói

Bản cuối có SHA-256 `b67c3a4f6c4c59b213d20dfc2d563d1f97ad522924cc5582bb91cda8a2770644`. Đã chạy bằng thư viện/profile disposable với bản sao đúng video TED, không ghi đè transcript trong thư viện thật.

- End-to-end: 1/1 pass trong 51,7 giây. Riêng từ lúc bắt đầu chép lời đến khi hoàn tất ASR + DTW là 26,026 giây.
- Một request cho toàn audio: progress `0/1` đến `1/1`, không chia chunk.
- SQLite lưu `engine=cloudflare-workers-ai`, `model=@cf/openai/whisper-large-v3-turbo`.
- Kết quả căn local: 51 câu, 785 word, 801 token, 3.098 phone. Hình video có kích thước dương, `readyState >= 3`; chọn câu, seek, playback tiến và bật/tắt IPA đều pass.
- Bounds toàn media, thứ tự cùng cấp và containment ở cấp sentence/word/token pass. Còn 9 phone có duration bằng 0 nằm ngoài parent token, lệch lớn nhất khoảng 194,6 ms. Đây là giới hạn căn phone của luồng Echogarden hiện tại; không coi toàn bộ phone timing là hoàn hảo.
- Không có unexpected runtime error trong app. Các lỗi trang web khám phá bên ngoài và probe dịch vụ local được phân loại riêng. Profile/settings/library disposable đã được dọn xong.
- Client contract tests, hồi quy MAI và TypeScript 5.8.2 được pin trong project pass. Review độc lập backend và client không còn P1/P2 mở.

[Packaged E2E receipt](../../../enjoy/tmp/cloudflare-workers-ai-implementation/qa-results-final/qa-cloudflare-youtube-live-0186a-re-Workers-AI-and-local-DTW/qa-cloudflare-core-live.json), [client review](../../../enjoy/tmp/cloudflare-workers-ai-implementation/client-review.json), [backend review](../../../enjoy/tmp/cloudflare-workers-ai-implementation/worker-review.json).

Bản đã nghiệm thu được chuyển vào đúng đường dẫn Enjoy user đang dùng; bản MAI trước đó được giữ ở `candidate-before-cloudflare`. Chỉ thêm cấu hình Cloudflare được mã hóa, sau đó chọn provider Cloudflare bằng UI. Ba transcript hiện có được giữ nguyên. Ciphertext đã cài được kiểm tra giải mã thành công bằng đúng binary trong một profile disposable khác, không gọi inference. File token tạm và bản xuất cấu hình mã hóa tạm đã được xóa; chỉ còn secret trong Cloudflare và cấu hình mã hóa của app. [App replacement receipt](../../../enjoy/tmp/cloudflare-workers-ai-implementation/app-replacement.json).

## So với code gốc gửi lên Enjoy

Đối chiếu Git HEAD/main/origin/main tại commit `f21f4304ae45cf0f43acde3473f4ca824db9ed11`:

1. App decode media bằng Echogarden thành WAV PCM16, 16 kHz; giữ số kênh do decoder trả về.
2. Nhánh Cloudflare gốc gửi nguyên WAV Blob bằng `axios.postForm` tới `https://ai-worker.enjoy.bot/audio/transcriptions`, dùng bearer `user.accessToken`. Code không tạo FormData field, không gửi URL video và không base64/JSON hóa WAV.
3. Sau khi xong, `/api/transcriptions` nhận JSON transcript/timeline để đồng bộ. Upload multipart field `file` lên `storage.enjoy.bot` là luồng media riêng.

Provider mới giữ audio đã decode giống luồng gốc, nhưng Electron main mã hóa WAV thành base64 JSON cho Worker; Worker gọi native Workers AI binding. Cả hai luồng ASR đều xử lý audio, không truyền phần hình video.

[Original transcribe source](../../../enjoy/tmp/cloudflare-workers-ai-implementation/original-head/src/renderer/hooks/use-transcribe.tsx:352), [original audio transcode](../../../enjoy/tmp/cloudflare-workers-ai-implementation/original-head/src/main/echogarden.ts:204).

Backend unit tests: 13/13 pass. Wrangler dry-run pass. Chưa commit hoặc push.
