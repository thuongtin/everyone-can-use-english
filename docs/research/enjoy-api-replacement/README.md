# Thay Enjoy API: nghiên cứu và kiểm thử thật

> Kết quả nghiên cứu ngày 08/09/2026. Các lựa chọn và trạng thái bên dưới thuộc thời điểm nghiên cứu; xem [nghiệm thu provider độc lập](../../../enjoy/docs/provider-independence-acceptance.md) để biết luồng đã tích hợp và kết quả mới nhất.

**Hướng chọn sau kiểm thử: MAI Transcribe 2 qua OpenRouter cho ASR cloud, Echogarden DTW local để căn từ/phone, Grok TTS cho EN/VI.** Whisper local đã chạy offline. Pronunciation Assessment vẫn cần Azure resource riêng hoặc một provider đánh giá phát âm tương đương.

Đã kiểm cả **20 model ASR và 18 model TTS** trong catalog speech OpenRouter tại thời điểm chạy. Tất cả nhận được kết quả với mẫu English ngắn, nhưng đã phát hiện model sinh chữ trên silence, TTS đọc sai tiếng Việt và khác biệt về format/timestamp. Không coi HTTP 200 là đủ.

| Tài liệu | Nội dung |
|---|---|
| [Workers AI đã triển khai](2026-09-08-cloudflare-workers-ai-integration.md) | Worker + Enjoy: audio 5:23 trong một request, API 14,7 giây; packaged DTW/IPA/playback pass |
| [Workers AI trong Enjoy](2026-09-08-cloudflare-workers-ai.md) | Nghiên cứu ban đầu theo source, model, chi phí và giới hạn; xem kết quả triển khai ở hàng trên |
| [MAI đã tích hợp](2026-09-08-mai-transcribe-integration.md) | Nghiệm thu trên app đóng gói và sửa lỗi video 5:23 bằng chia audio 60 giây |
| [Kết quả live tổng hợp](2026-09-08-live-tests.md) | Lựa chọn, phạm vi đã test, failure và chi phí thực |
| [20 ASR](2026-09-08-asr-live.md) | JFK, EN hai giọng, VI, silence, timestamps và diarization |
| [18 TTS](2026-09-08-tts-live.md) | Audio decode, ASR roundtrip, voice và MP3/PCM |
| [LLM và ảnh](2026-09-08-llm-live.md) | Dịch, từ vựng, IPA, schema, streaming, tool và native bitmap |
| [Local offline](2026-09-08-local-live.md) | Whisper, whisper.cpp, DTW, hierarchy word/token/phone |
| [Nghiên cứu đầy đủ](2026-09-08-report.md) | Mapping Enjoy API, kiến trúc thay thế và migration |
| [70 method API](2026-09-08-endpoint-inventory.md) | 69 cặp HTTP method/route, consumer và dependency ngoài Client |
| [Speech contracts](2026-09-08-speech-contracts.md) | Luồng hiện tại, normalization, pronunciation và TTS |
| [Nguồn chính thức](2026-09-08-sources.md) | Nguồn của đợt source audit; nguồn endpoint mới nằm trong phụ lục live |

**MAI Transcribe 2 qua OpenRouter đã được tích hợp và nghiệm thu trên video 5:23 trong Enjoy đang dùng.** Những provider khác trong bảng live vẫn là kết quả nghiên cứu/kiểm thử API trừ khi tài liệu tích hợp ghi rõ. Workers AI đã được triển khai bằng Worker riêng và nhận dạng thành công toàn bộ video 5:23 trong một request; bản Enjoy đóng gói đã pass DTW, IPA và playback. Chưa commit/push. Không có key trong báo cáo/evidence.
