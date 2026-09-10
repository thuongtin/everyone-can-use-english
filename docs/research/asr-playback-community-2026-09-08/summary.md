---
title: "Tóm tắt nghiên cứu ASR và playback Enjoy"
mode: deep
date: 2026-09-08
sources: 79
confidence: "high for source contracts; medium for applicability; runtime changes untested"
---

> Cập nhật sau nghiên cứu: đã có [nghiệm thu live ngày 2026-09-08](live-acceptance.md) cho OpenAI, Cloudflare, MAI 53:57 và runtime playback. Các mục “chưa thử” bên dưới phản ánh thời điểm nghiên cứu; xem báo cáo live để biết kết quả mới.

# Hướng chọn cho ASR dài và phát từng câu trong Enjoy

**OpenAI API và OpenRouter đều dùng được. Với Enjoy, giữ MAI-Transcribe 2 làm đường có integration đã kiểm; dùng OpenAI `whisper-1` để benchmark đối chứng khi cần word timestamp.** Chưa có bằng chứng rằng đổi provider sẽ xử lý đúng toàn bộ file 53:57 trong một request. Terra nghiên cứu ASR/provider, Luna nghiên cứu WaveSurfer; agent chính đã đối chiếu code và kiểm lại nguồn quyết định.

| Lựa chọn | Lợi ích | Điểm cần kiểm |
| --- | --- | --- |
| OpenRouter MAI 2 | Segment, word timing, diarization; Enjoy đã chạy hết video 5:23 với sáu chunk. | 53:57 chưa nghiệm thu. Request WAV 280 giây từng bị từ chối; không suy cap chung từ phép thử đó. [Receipt](../enjoy-api-replacement/2026-09-08-mai-transcribe-integration.md). |
| OpenAI `whisper-1` | Word/segment timestamps và prompt. | Upload 25 MB, không file streaming; phải benchmark chất lượng. [API](https://developers.openai.com/api/reference/python/resources/audio/subresources/transcriptions/methods/create). |
| OpenAI `gpt-transcribe` | Model guide hiện khuyên dùng cho text, có context hints và streaming. | Chưa có word timestamps được công bố, nên cần alignment riêng. [Guide](https://developers.openai.com/api/docs/guides/speech-to-text). |
| Cloudflare turbo | Schema có context và word timing optional. | Chưa thử nguyên file 53:57 đúng model; thất bại của tiny/whisper không chứng minh turbo thất bại. [Schema](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/schema-input.json). |

OpenRouter có endpoint STT riêng. Base64 JSON có đường cho file lớn hơn multipart nhưng vẫn chịu timeout upstream; generic multipart prompt bị bỏ qua. Không coi route chat audio là hợp đồng transcript/timestamp tương đương. [STT](https://openrouter.ai/docs/guides/overview/multimodal/stt).

File 53:57 có 25.903.156 byte. Docs OpenAI ghi 25 MB mà không định nghĩa đơn vị; cần nén xuống dưới 25.000.000 byte hoặc chia trước thử để tránh mơ hồ về kích thước. Upload vừa cap không đồng nghĩa nhận dạng đủ lời.

**Giải pháp cộng đồng nên học:** dùng VAD/khoảng lặng để chọn điểm cắt nhưng giữ coverage audio nguồn; lưu offset theo sample; ghép overlap bằng đối sánh từ/thời gian; retry chỗ nối không chắc. WhisperX, faster-whisper và Hugging Face có các thành phần tham khảo, chưa có thư viện nào gắn nguyên vào contract Enjoy hiện tại. Aligner chỉ định vị text đã có, không phục hồi chữ ASR bỏ. [WhisperX](https://arxiv.org/html/2303.00747v2), [Whisper merge](https://github.com/huggingface/transformers/blob/0514b65827ea0eade3d0260a81afcef763a3b94d/src/transformers/models/whisper/tokenization_whisper.py).

**Lỗi câu vừa bấm đã dừng có bằng chứng upstream sát:** WaveSurfer PR #4359 sửa `region-out` sớm do sai số seek. Enjoy 7.9.1 có handler pause ngay ở event đó. Cần trace case lỗi trước khi chọn patch/nâng version; đổi provider không sửa được handler player. [PR](https://github.com/katspaugh/wavesurfer.js/pull/4359).

Thứ tự đề xuất: trace và sửa playback; bảo toàn words/metadata trong contract Cloudflare; thử đúng turbo nguyên file; benchmark MAI 2 và OpenAI trên cùng audio/reference; chỉ chốt cấu hình chunk sau khi đo mất/lặp từ ở seam, timing và retry/cancel/resume. Chưa có reference đầy đủ cho 53:57 nên chưa báo WER hoặc provider thắng.

Lượt này hoàn tất nghiên cứu, chưa sửa ứng dụng hay chạy inference mới. Xem [báo cáo đầy đủ](full-report.md), [so sánh provider](provider-comparison-terra.md) và [nguồn kiểm chứng](sources.json).
