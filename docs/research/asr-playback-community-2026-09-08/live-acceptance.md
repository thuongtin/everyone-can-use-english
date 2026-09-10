# Nghiệm thu ASR và playback Enjoy ngày 2026-09-08

**OpenAI Transcriptions API đã trả HTTP 200 kèm transcript cho một request chứa nguyên file 53:57 bằng cả `gpt-transcribe` và `whisper-1`. Cloudflare Turbo cũng trả thành công cho request nguyên file. Enjoy hiện tại vẫn chưa đạt nghiệm thu audio dài và phát từng câu.** Các kết quả live dưới đây cập nhật những điểm còn chưa thử trong báo cáo nghiên cứu trước đó.

## Kết quả provider

| Đường chạy | Kết quả live | Thời gian request | Giới hạn kết luận |
| --- | --- | --- | --- |
| OpenAI `gpt-transcribe`, nguyên 53:57 | HTTP 200; 45.032 ký tự | 89,507 giây | Không có word/segment timing; chưa kiểm WER hoặc Enjoy integration |
| OpenAI `whisper-1`, nguyên 53:57 | HTTP 200; 907 segment, 8772 structured word | 161,139 giây | 26 segment và 523 word có thời lượng 0 |
| Cloudflare `whisper-large-v3-turbo`, nguyên 53:57, lượt đầu | HTTP 200; 921 segment, 9099 nested word | 279,369 giây | 84 word có thời lượng 0; chưa kiểm chất lượng nhận dạng |
| Cloudflare Turbo, 53:57, sau thông báo nâng gói | HTTP 200; 919 segment, 9099 nested word | 211,614 giây | Vẫn có 84 word thời lượng 0; vẫn lâu hơn deadline Worker 180 giây |
| Cloudflare Turbo, nguyên 12:02 | HTTP 200; 157 segment, 1742 nested word | 77,898 giây | Chỉ PASS request trực tiếp; app vẫn chặn audio này |
| OpenRouter MAI2, service nguyên bản trên 53:57 | FAIL: 10 chunk thành công, chunk 11 HTTP 429 | 48,885 giây đến lỗi | Service dừng, không tự retry/resume |
| MAI2, harness tiếp tục có giãn nhịp | 54/54 input chunk đã xử lý, 658 segment, 9606 word | 306,960 giây cho 44 chunk tiếp tục | Pacing/resume chỉ có trong harness thử nghiệm |

OpenAI sử dụng đúng [API trong link người dùng gửi](https://developers.openai.com/api/docs/guides/speech-to-text), endpoint `POST /v1/audio/transcriptions`. Audio được encode toàn bộ về MP3 48 kbps, 19.427.404 byte để nằm dưới 25 MB; thời lượng giữ 3237,744063 giây. Cloudflare dùng bản MP3 64 kbps gốc, MAI dùng WAV PCM16 mono 16 kHz từ cùng nguồn. Các lượt gọi khác định dạng và thời điểm, nên bảng này không chứng minh tốc độ hoặc chất lượng tương đối ổn định giữa provider.

OpenAI control 20 giây cũng HTTP 200 với cả hai model. API key vừa cung cấp chỉ dùng trong memory cho test trực tiếp, chưa lưu vào Enjoy.

## Cloudflare sau khi người dùng nâng Workers Paid

- Turbo nhận lại đúng file, hash và options của lượt đầu, HTTP 200 sau 211,614 giây. Mốc cuối là 3221,87 giây. Nhanh hơn lượt đầu 67,755 giây, nhưng một cặp request không đủ để quy thay đổi tốc độ cho Paid. Cả hai lượt vẫn dài hơn deadline Worker hiện tại 180 giây.
- Model cũ `@cf/openai/whisper` được thử lại đúng MP3 và protocol của case từng lỗi: vẫn HTTP 500, error `6001`, sau 21,814 giây. Không suy từ failure này rằng Turbo không hỗ trợ file dài.
- Worker đã deploy trả health HTTP 200 và báo model Turbo. Request có xác thực, WAV PCM16 mono 16 kHz dài 600,020 giây, 19.200.718 byte, body JSON 25.600.988 byte trả HTTP 400 `cf_invalid_audio` sau 3,451 giây. File dưới cap kích thước nhưng trên cap duration của source. Kiểm tra local bằng chính parser: source hiện tại từ chối; chỉ nâng cap trong memory từ 600,01 lên 600,03 thì cùng bytes được nhận với duration 600,02. Điều này loại lỗi cấu trúc WAV trong parser đã kiểm và củng cố nguyên nhân guard duration. Không sửa source hoặc deploy; không có server trace trong lượt này.
- Billing API trả 403 với OAuth hiện tại, thiếu quyền Billing Read; ảnh người dùng gửi cho thấy purchase complete. Các phép thử được thực hiện sau thông báo nâng gói, không phải phép đo cô lập tác động của plan.

## Enjoy hiện tại chưa đạt

**Cloudflare 12 phút: FAIL trong UI.** Trên đúng packaged Enjoy đang mở, nhấn Tiếp tục dẫn tới chuẩn bị/transcode rồi trở lại form; database vẫn `pending`, chưa có transcript. Cache WAV mới có 46.240.820 byte, 722,512125 giây, stereo 16 kHz. Nó vượt guard desktop 29.999.000 byte; service và Worker còn chặn duration trên 600,01 giây. Đây là giới hạn integration do app đặt, không phải kết luận provider không hỗ trợ 12 phút. Toast không được capture ở lượt UI này; kết luận nguyên nhân dựa thêm vào cache, database chỉ đọc và vị trí guard trong source. Không có network trace của lần bấm UI.

**MAI 53:57: FAIL với service nguyên bản.** HTTP 429 được app ánh xạ thành `mai_quota`; raw response chỉ ghi `Provider returned 429`, không đủ để gọi là hết tiền. Lượt chẩn đoán tiếp tục đúng chunk 11 đến 54, giữ nhịp khoảng 7 giây giữa start request, không gửi lại 10 chunk thành công. 44 request tiếp tục đều HTTP 200 lần đầu. Usage 54 chunk là 3238 giây, cost provider ghi nhận khoảng $0,08994. Chưa có pacing/resume này trong source app; chưa chạy UI và DTW toàn video 53:57.

**Playback câu #2: FAIL, đã có nguyên nhân runtime.** Bounds câu là `8.28..9.880625`, nhưng frame `timeupdate` của RegionsPlugin nhận `8.279999`. Thời gian thấp hơn start 1 micro giây khiến plugin loại region hiện tại, phát `region-out`, rồi Enjoy gọi `wavesurfer.pause()` tại `media-player-controls.tsx:308`. Region ID vẫn là `segment-region-1`; không cần giả thuyết region cũ để giải thích click này. Sau gỡ breakpoint, câu #3 phát và thời gian tiến từ 00:10 đến 00:11, còn câu #2 vẫn dừng tại 00:08.

Packaged app đã kiểm có app.asar SHA-256 `b67c3a4f6c4c59b213d20dfc2d563d1f97ad522924cc5582bb91cda8a2770644`. Breakpoint đã xóa, debugger resume, DevTools đóng; app ở trạng thái paused tại câu #2. Lần dừng debugger không được dùng để suy latency hoặc âm thanh nghe được.

## Chất lượng còn phải kiểm

- Không có human reference transcript cho 53:57, nên WER, đủ lời nói, mất/lặp từ toàn file đều **chưa kiểm**. HTTP 200, xử lý đủ input chunk hoặc timestamp extent gần cuối file không thay thế các tiêu chí này.
- MAI chunk 25 có word start lùi 3,920 giây và nằm trước segment chứa nó. Service hiện tại chưa chặn lỗi thứ tự này.
- Tại biên 540 giây, MAI hard cut trả một từ `on` trước `Honestly`; request đối chứng dùng audio liên tục 532..548 giây trả `honestly` mà không có `on`. Đây là khác biệt do ngữ cảnh cắt cần xử lý, chưa phải ground truth chứng minh phiên bản nào đúng toàn bộ lời.
- Whisper trực tiếp và Cloudflare Turbo có word zero-duration chứa nội dung. Riêng 26 segment zero-duration của Whisper có text rỗng. Không nên dùng nguyên raw word timing làm tiêu chí hoàn tất luyện phát từng từ.
- `gpt-transcribe` chưa cung cấp structured timing trong response đã nhận. Hướng dùng text rồi alignment là khả thi về kiến trúc, chưa được nghiệm thu trong app ở lượt này.

## Evidence và phạm vi

- [OpenAI: report, receipts, response và transcript](../../../enjoy/tmp/asr-provider-acceptance-2026-09-08/openai/report.md).
- [Cloudflare Turbo: report và ba case live](../../../enjoy/tmp/asr-provider-acceptance-2026-09-08/cloudflare/report.md).
- [Cloudflare: phép thử sau thông báo nâng gói](../../../enjoy/tmp/asr-provider-acceptance-2026-09-08/cloudflare/paid-retest/report.md).
- [MAI: baseline fail, resume và seam A/B](../../../enjoy/tmp/asr-provider-acceptance-2026-09-08/mai/acceptance-report.md).
- [Playback: runtime trace và retest](../../../enjoy/tmp/asr-provider-acceptance-2026-09-08/playback/report.md).
- [Cloudflare trong app: UI/cache/database receipt](../../../enjoy/tmp/asr-provider-acceptance-2026-09-08/app-cloudflare/receipt.json).
- [Review độc lập về mức kết luận và evidence](../../../enjoy/tmp/asr-provider-acceptance-2026-09-08/independent-review.md).

Lượt nghiệm thu này tạo harness, audio thử và báo cáo. Không sửa source ứng dụng, không deploy, commit hoặc thay transcript live. Cần sửa playback theo nguyên nhân đã bắt được, bổ sung đường xử lý file dài và nghiệm thu alignment/quality trước khi coi Enjoy đã hoàn tất.
