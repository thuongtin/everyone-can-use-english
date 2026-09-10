# MAI Transcribe 2 trong Enjoy

Đã tích hợp `microsoft/mai-transcribe-2` qua OpenRouter cho luồng chép lời audio/video, bao gồm video tải từ YouTube. Sol thực hiện implementation và harness; Astra review độc lập, đóng 4/4 findings cùng các sửa đổi runtime cuối. Bản macOS Apple Silicon đã được nghiệm thu trên app đóng gói thật.

## Dùng thử

1. Thoát bản Enjoy đang mở, rồi mở [Enjoy.app mới](../../../enjoy/tmp/mai-transcribe-implementation/candidate-out/Enjoy-darwin-arm64/Enjoy.app).
2. Trong Cài đặt, chọn dịch vụ chép lời **MAI Transcribe 2 (OpenRouter)** và lưu OpenRouter API key.
3. Vào **Video → Thêm học liệu → URL**, nhập link YouTube và xác nhận.
4. Ở hộp chép lời, chọn **MAI Transcribe 2 (OpenRouter)**, ngôn ngữ phù hợp rồi bấm **Tiếp tục**.

Model được cố định để tránh chọn nhầm LLM. Audio được chia thành các đoạn tối đa 60 giây, gửi từ main process rồi căn thời gian bằng DTW local trước khi lưu phụ đề và IPA. JSON request có safety cap 8.000.000 byte của app. Đã xử lý tiến độ, hủy, đoạn im lặng, timestamp ngoài biên và lỗi xác thực/quota/timeout.

## Sửa lỗi trên ứng dụng đang dùng

Sau nghiệm thu ban đầu bằng video 19 giây, user báo lỗi khi chép lời video “Who Controls Your City’s Money? | Trinity Tran | TED” dài 323,64 giây. Đã tái hiện trên đúng app và hồ sơ đang dùng, xác định lại process để tránh chọn nhầm bản Enjoy khác.

WAV stereo 16 kHz chia đoạn 300 giây tạo JSON 25.600.299 byte và nhận HTTP 502. Giảm còn 280 giây, JSON 23.893.631 byte vẫn nhận HTTP 400 với lỗi `The selected model does not support large audio inputs`. Cùng audio và key, đoạn 60 giây nhận HTTP 200. Vì vậy sửa mặc định từ 300 xuống 60 giây, kèm regression stereo chia đủ sáu đoạn và giữ nguyên toàn bộ PCM. Đây là policy của app, không phải khẳng định provider có hard limit 60 giây hoặc 8 MB.

Bản đã sửa được đóng gói và mở lại trên chính thư viện của user. Chép lời toàn bộ video đã **PASS**: cùng record chuyển từ `pending` sang `finished`, engine `openrouter`, model `microsoft/mai-transcribe-2`; có 47 câu, 801 word, 811 token và 3.125 phone. Native UI hiển thị phụ đề và IPA; chọn câu 2 seek tới 00:13 và phát tăng tới 00:14; chọn câu cuối seek tới 05:11 và hiện nội dung cuối video. App được để mở, ở trạng thái tạm dừng.

Test service, sáu cancellation/local-mode scenario, TypeScript và review Astra bản sửa đều PASS. Tất cả timestamp hữu hạn, theo thứ tự và trong thời lượng media. Audit sâu phát hiện sáu phone có duration bằng 0 nằm trước start của token cha, tối đa 112,313 ms, được giữ minh bạch trong receipt; không coi toàn bộ kiểm tra parent containment là PASS. Đối chiếu source xác định phone do Echogarden DTW local tạo, không phải normalization MAI. Hạn chế này ảnh hưởng độ chính xác highlight cấp phone, không chặn phụ đề, seek, playback hoặc IPA text.

- [Nghiệm thu active app](../../../enjoy/tmp/mai-active-debug/active-app-acceptance.json)
- [Dữ liệu sau chép lời và audit timeline](../../../enjoy/tmp/mai-active-debug/parent-live-after.json)
- [Nguyên nhân và đối chứng API](../../../enjoy/tmp/mai-active-debug/root-cause.md)
- [Review Astra bản sửa](../../../enjoy/tmp/mai-active-debug/astra-review.json)
- [Receipt thay app và vị trí bản sao cũ](../../../enjoy/tmp/mai-active-debug/app-replacement.json)

SHA-256 của `app.asar` đang mở, PID 47710 tại thời điểm nghiệm thu: `44e4ecdcf3f27d273805620134b9c893b58e7b9ec4006ba1e534558cdc3d1484`.

## Nghiệm thu ban đầu, trước bản sửa video dài

| Kiểm tra | Kết quả |
| --- | --- |
| Package macOS arm64 | PASS |
| YouTube thật: `jNQXAC9IVRw`, “Me at the zoo” | PASS, tải MP4 744.412 byte, 19,063583 giây |
| MAI và SQLite | PASS, engine `openrouter`, model `microsoft/mai-transcribe-2` |
| Transcript và timeline DTW | PASS, 2 câu, 39 word, 39 token, 120 phone |
| Chọn câu, seek, phát video, bật/tắt IPA | PASS |
| Native video | `readyState=4`, 320 × 240, thời gian phát tăng |
| Test service/IPC và hủy/local mode | PASS, bao gồm 6 scenario chạy source thật với boundary stubs |
| TypeScript và 11 speech contract cases | PASS |
| Review Astra | 0 finding còn mở |
| Xóa hồ sơ test và key tạm | PASS |

Full E2E cuối chạy trong 18,6 giây trên hồ sơ disposable. Hai lỗi có sẵn lộ ra trong luồng này cũng đã được sửa hẹp: local profile không còn truy vấn transcript cloud gây 401; tra bản ghi âm tùy chọn không còn ném lỗi khi chưa có bản ghi.

Không còn runtime error bất ngờ của app trong run cuối. Ba dòng native `Unsupported pixel format: -1` được giữ trong evidence và chỉ phân loại là cảnh báo không chặn luồng sau khi đã xác nhận video decode, kích thước, playback và screenshot. Lỗi trang khám phá bên ngoài được ghi riêng theo WebContents.

Key usage tăng từ `0.083797509` lên `0.085464174` USD trong đợt tích hợp, chênh **0,001666665 USD**, gồm ba lần gọi MAI cho video thử. Key tạm đã xóa; key không nằm trong package, source hoặc artifact kiểm thử đã quét.

## Bằng chứng

- [Receipt E2E cuối](../../../enjoy/tmp/mai-transcribe-implementation/qa-results-final/qa-mai-youtube-live-import-9e27e-MAI-plus-local-DTW-captions/qa-mai-youtube-live.json)
- [Ảnh lựa chọn MAI](../../../enjoy/tmp/mai-transcribe-implementation/qa-results-final/qa-mai-youtube-live-import-9e27e-MAI-plus-local-DTW-captions/qa-mai-selected-before-start.png)
- [Ảnh video, phụ đề và IPA](../../../enjoy/tmp/mai-transcribe-implementation/qa-results-final/qa-mai-youtube-live-import-9e27e-MAI-plus-local-DTW-captions/qa-mai-youtube-caption.png)
- [Review Astra cuối](../../../enjoy/tmp/mai-transcribe-implementation/astra-rereview.json)
- [Audit package và source hashes](../../../enjoy/tmp/mai-transcribe-implementation/final-artifact-audit.json)
- [Cleanup hồ sơ test](../../../enjoy/tmp/mai-transcribe-implementation/qa-results-final/qa-mai-youtube-live-import-9e27e-MAI-plus-local-DTW-captions/qa-cleanup.json)

SHA-256 của `app.asar` cũ đã chạy E2E 19 giây: `9b0ce7d67942310af2c27f7522c745c4710482185d0f6c583be3d7bbb8982fa1`. Các receipt ở mục này thuộc bản cũ, nay được giữ tại `candidate-before-large-audio-fix`.

## Giới hạn

Live acceptance hiện bao gồm video 19 giây của bản ban đầu và video 5 phút 23 giây, sáu chunk trên bản sửa đang dùng. Im lặng và các thời điểm hủy được kiểm bằng test có kiểm soát; chưa chạy video YouTube nhiều giờ. Hủy trong DTW ngăn lưu kết quả muộn nhưng chưa dừng được phần native computation đang chạy. Usage chưa được lưu vào từng bản ghi transcription.

Không commit, push hay deploy. Package candidate đã được thay bằng bản sửa và giữ bản cũ để hoàn tác. Thư viện người dùng được giữ, chỉ bản chép lời video đang kiểm tra được tạo qua luồng bình thường của ứng dụng.
