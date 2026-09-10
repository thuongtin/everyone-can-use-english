# Cloudflare long audio, 2026-09-08

Hoàn tất ngày 2026-09-09: Worker đã deploy, bản Enjoy mới đã mở trên hồ sơ hiện có. Nghiệm thu xử lý audio dài PASS trên video 12:02 qua UI và audio 53:57 qua packaged IPC.

## Phạm vi

Nâng giới hạn đường Cloudflare Workers AI trong Enjoy để nhận toàn bộ audio tới 60 phút. Không thay model, chất lượng MAI, hoặc logic playback. Các thay đổi có sẵn trong working tree được giữ nguyên; không commit hoặc push.

## Giới hạn mới

| Thành phần | Giới hạn |
| --- | --- |
| WAV cache đầu vào desktop | PCM16, 16 kHz, mono/stereo, 240.000.000 byte |
| Thời lượng | 3.601 giây để nhận 60 phút cộng encoder padding |
| Chuẩn bị upload | Toàn bộ audio thành MP3 mono, 16 kHz, 64 kbps |
| Binary upload | `audio/mpeg`, 30.000.000 byte |
| Legacy upload | JSON base64 WAV, 40.000.000 byte |
| Deadline Worker | 900.000 ms |
| Timeout request desktop | 960.000 ms |
| Timeout ffmpeg preparation | 480.000 ms |

WAV gốc vẫn được giữ cho local DTW. Renderer chỉ đọc WAV khi cần alignment, tránh giữ thêm WAV trong lúc remote inference. Cancel truyền qua preparation và HTTP; thư mục MP3 tạm được dọn. Worker deadline không bảo đảm hủy được GPU inference phía nhà cung cấp.

## Deployment và package

- Worker: `https://enjoy-workers-ai.ho-31c.workers.dev`.
- Version trước: `37a4318d-58ce-44cf-811e-0710b7fef55b`.
- Version mới: `5a50fb82-624f-4ce5-bc6a-7824e3cf0cdc`.
- `/health` đã xác nhận `audio/mpeg`, 30 MB, 3.601 giây và deadline 900 giây.
- Candidate: `enjoy/tmp/cloudflare-long-audio-2026-09-08/candidate-out/Enjoy-darwin-arm64/Enjoy.app`.
- Package thành công bằng Node 20.20.2. Node 26.5.0 build xong Vite nhưng Forge thoát vì unsettled top-level await.
- SHA-256 `app.asar`: `c7d20eb7c34a65daef549be6ab481ab35d96a1de229c581c49333ff03e63eac3`.

## Kiểm tra local

- Backend: 18/18 test pass, type generation và Wrangler dry-run pass.
- Desktop service: binary bytes/header, timeout, cancellation, error preservation pass.
- Preparation dùng bundled ffmpeg/ffprobe thật: WAV 1 giây, 53:57, giới hạn source/duration, path traversal, symlink và cleanup pass.
- Cross-contract: MP3 do preparation tạo được parser Worker đọc thành 3.237,120 giây và 3.600,108 giây ở fixture biên 60 phút. Cả hai dưới 3.601 giây.
- Renderer: 8 scenario cancellation, stale run, persistence, local mode và lazy WAV pass. Harness cũ thiếu `useEffect` stub và giả định fetch WAV trước provider đã được cập nhật theo lifecycle hiện tại.
- Full TypeScript `tsc --noEmit` pass.
- Review độc lập implementation: pass, không có finding P1/P2 đã xác nhận.

## Live acceptance

Tiếp tục ngày 2026-09-09 sau khi macOS Keychain hoạt động trở lại. Hai request sau đã chạy qua đúng packaged app và Worker đã deploy, không mock inference:

| Case | Kết quả được xác nhận | Thời gian |
| --- | --- | --- |
| Video 12:02, run5 cuối | PASS toàn bộ UI: nhận dạng, SQLite, DTW, seek, playback, IPA hide/show và cleanup. 10.030 ký tự, 112 câu, 1.752 từ, timestamp cuối 722,4 giây. | 51,777 giây cho nhận dạng và DTW; cả test khoảng 1,1 phút |
| Video 12:02, run4 | PASS nhận dạng, lưu SQLite, local DTW, seek, playback tiến và IPA hiện. 9.931 ký tự, 112 câu, 1.734 từ, timestamp cuối 721,64 giây. | 40,328 giây từ nút tiếp tục tới transcript và DTW hoàn tất |
| Audio 53:57, run4 | PASS packaged IPC, WAV preparation, upload toàn audio đã nén và AI binding. 46.210 ký tự, 959 segment, timestamp cuối 3.221,88 giây. | 237,738 giây, gồm chuẩn bị MP3 và request; không gồm bước transcode nguồn sang WAV trước IPC |

Input 53 phút giữ nguyên SHA-256 `2ec08715c275e2e9a8226835a58c1ec1c3d129db5f53e3d0c30c0dc26a6ede09`. Input video 12 phút giữ nguyên SHA-256 `4e1d7154488286564079b71531da2019e25678fff8c66b495e5caef8d9ea7b96`. Các receipt xác nhận cùng SHA-256 candidate nêu trên. Cả hai profile disposable đã xóa settings, library và Chromium thành công.

Run4 toàn suite vẫn FAIL, dù hai phần core trên PASS: case 12 phút dừng tại selector nút plus cũ để mở IPA, sau các assertion seek/playback/IPA visible. Cả hai case còn bị runtime guard chặn bởi HTTP 403 từ `ipapi.co/json` trong bảng trạng thái mạng của trang Cài đặt. `fixture.close` kiểm lại lỗi runtime nên thông báo aggregate chứa chữ cleanup, nhưng receipt cleanup xác nhận mọi thư mục đã được dọn. Không relabel run4 thành suite PASS.

Harness đã chuyển sang nút IPA hiện trực tiếp trong toolbar, giữ đầy đủ kiểm tra tắt/bật IPA. Lỗi tra IP được phân loại theo đúng status và URL, vẫn lưu diagnostic và lý do trong receipt; source `NetworkState` chỉ dùng kết quả để hiển thị chip IP, không dùng trong ASR. Run5 chạy lại riêng 12 phút, đạt 1/1 PASS và 0 unexpected runtime issue. Không lặp request 53 phút đã hoàn tất.

Lượt đầu trước đó dừng vì selector trang Cài đặt cũ. Lượt thứ hai bị macOS Keychain chặn trước inference; user đã xử lý để tiếp tục. Không thay UI sản phẩm nhằm làm test pass.

## Giới hạn của nghiệm thu

- Request 53 phút thành công xác nhận đường upload/inference hoạt động dưới giới hạn runtime thực tế trong lượt này; không có phép đo peak memory cụ thể hoặc kiểm tra concurrency.
- Chưa có human ground truth để đo WER hoặc xác nhận speech coverage đầy đủ. Timestamp cuối của output 53 phút không đồng nghĩa đã nhận mọi lời nói tới hết file.
- Run5 DTW 12 phút có 130 node không phải phone dài 0 giây, 674 phone dài 0 giây và 119 phone nằm ngoài parent, lớn nhất 0,248125 giây. Bounds và thứ tự cấp câu/từ pass, nhưng chưa nghiệm thu độ chính xác timing ở cấp từ/phone.
- Case 53 phút không chạy full-file DTW hoặc playback. Lượt seek/playback của video 12 phút không chứng minh lỗi playback cũ ở clip 37 giây đã được sửa.

## Phiên Enjoy đang dùng

Đã đóng phiên cũ và mở candidate mới trên hồ sơ `26015977`, giữ nguyên 5 video và cấu hình Cloudflare. PID lúc nghiệm thu là `63277`, executable nằm trong candidate đã kiểm. Native UI xác nhận câu mô tả 60 phút, đúng URL Worker và nút xóa token đã lưu hiện diện, tức cấu hình được nhận. App được trả về màn hình chính sau kiểm tra. Không đổi token, chép đè transcript đang có hoặc xóa thư viện người dùng.

## Evidence

Thư mục `enjoy/tmp/cloudflare-long-audio-2026-09-08/` chứa baseline, plan, independent review, deploy log, health, package log và các receipt của từng lượt QA. Token được đọc từ secure storage vào bộ nhớ; không ghi vào file kiểm tra.

- [Review release độc lập](../../../enjoy/tmp/cloudflare-long-audio-2026-09-08/live-release-review.md).
- [Receipt UI 12 phút cuối](../../../enjoy/tmp/cloudflare-long-audio-2026-09-08/qa-results-run5/qa-cloudflare-youtube-live-9d7e4-re-Workers-AI-and-local-DTW/qa-cloudflare-youtube-live.json).
- [Receipt 53 phút](../../../enjoy/tmp/cloudflare-long-audio-2026-09-08/qa-results-run4/qa-cloudflare-youtube-live-6ac84-IPC-and-the-deployed-Worker/qa-cloudflare-53min-ipc.json).
- [Giới hạn được xác minh trong app đang mở](../../../enjoy/tmp/cloudflare-long-audio-2026-09-08/active-app-limits.ax.txt).
