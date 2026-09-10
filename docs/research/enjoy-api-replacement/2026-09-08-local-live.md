# Local Echogarden live acceptance

Chạy lúc 2026-09-08 13:52 +0700 bằng Node 24.18.1 arm64 trên năm tác vụ local. Toàn bộ tiến trình chạy dưới `/usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)'`, chỉ đọc các fixture public/synthetic `jfk.wav`, `dialogue.wav` và reference đi kèm. Không tải model, không khởi động Enjoy và không đọc private audio.

## Kết quả

| Tác vụ | Kết quả | Elapsed | WER đơn giản | Timeline |
| --- | --- | ---: | ---: | --- |
| Integrated Whisper `tiny.en` recognize JFK | Pass | 985 ms | 0/22, 0% | 1 segment, 1 sentence, 22 words, 22 nested tokens; 0 invalid time |
| Integrated Whisper `tiny.en` align JFK | Pass | 610 ms | 0/22, 0% | 1 segment, 1 sentence, 22 words, 22 nested tokens; 0 phone, 0 subphone; 0 invalid time |
| DTW `high` + local eSpeak align JFK | Pass | 250 ms | 0/22, 0% | 1 segment, 1 sentence, 22 words, 22 tokens, 69 phones; 0 subphone; 0 invalid time |
| whisper.cpp `tiny.en` recognize JFK | Pass | 299 ms | 0/22, 0% | 1 segment, 1 sentence, 22 words, 22 tokens; 0 invalid time |
| whisper.cpp `tiny.en` recognize synthetic dialogue | Pass | 395 ms | 9/54, 16.67% | 1 segment, 4 sentences, 50 normalized words, 52 tokens; 0 invalid time |

Tổng wall time của runner là 2,7 giây. Không có missing-model error hoặc network error. Integrated ONNX Whisper và custom whisper.cpp binary đều dùng đúng cache `tiny.en` đã kiểm kê.

## Kết luận cấu trúc alignment

Whisper alignment tạo hierarchy:

```text
segment > sentence > word > token
```

Nó không tạo phone hoặc subphone.

DTW alignment với eSpeak local tạo hierarchy:

```text
segment > sentence > word > token > phone
```

Ví dụ đầu tiên là word `And`, token IPA `ænd`, rồi ba phone `æ`, `n`, `d`, với timestamp hợp lệ. Kết quả không có entry `subphone`. Đối chiếu `media-caption.tsx:45-51`, consumer đọc `word.timeline` là token rồi `token.timeline` là phone. DTW đáp ứng hình dạng IPA lồng nhau đã kiểm; consumer này không yêu cầu node `subphone` riêng và có fallback `token.text` nếu thiếu phone children. Không nên diễn giải phone timestamps thành subphone evidence.

## Accuracy note

JFK đạt exact transcript với cả integrated Whisper và whisper.cpp. Dialogue có WER đơn giản 16,67% vì model gộp các số đọc thành digit strings (`seven four two` thành `742`, `ten fifteen` thành `1015`, `fifteen` thành `15`, `nine` thành `9`) và đổi `All right` thành `Alright`. Metric dùng lowercase và bỏ punctuation, chưa chuẩn hóa spoken numbers, nên phạt cả các biến thể number formatting có cùng nghĩa.

## Raw artifacts

- `local-integrated-jfk-recognize.json`, SHA-256 `458b0f075324c73bfeb734c36e8de2658cb10f7959883cca55b3b660075a16a6`
- `local-integrated-jfk-align-whisper.json`, SHA-256 `c42134bc64b21ffb1fc973e30a0eec0b2995ed34404e19896cdeb0ececf2bc0c`
- `local-integrated-jfk-align-dtw.json`, SHA-256 `e1756f1d8c560be3d2e6b1dcac53cada2562625b635daae02c13fecaef3a3b15`
- `local-whispercpp-jfk.json`, SHA-256 `b7fe14d043ac87af1f7e3d06e7e44d263b4f07c7b5bbecc9af394629b530eef8`
- `local-whispercpp-dialogue.json`, SHA-256 `78ed80530a1cab58a6a986957b480e124f960068511e1d2e17be4f5e380f9905`
- `local-live-summary.json`, SHA-256 `016e76d250d6d6b8a5cb599dc02de99fe2d83b86caa7df90273cadb471477ae3`

`local-live-runner.mjs` là runner tái lập. Nó ghi transcript và timeline đầy đủ nhưng loại `inputRawAudio` khỏi JSON để artifact gọn và không nhân bản audio fixture.

Lưu ý compatibility: fallback `token.text` ở caption không áp dụng cho mọi thao tác. Copy IPA tại `media-caption-actions.tsx:219-223` gọi `token.timeline.map` không guard, trong khi raw Whisper token không có `timeline`. Giữ DTW hoặc normalize/guard consumer trước khi thay alignment engine; chưa nghiệm thu toàn UI từ kết quả CLI này.

## Xác minh bổ sung sau review độc lập

Lần chạy 2 lúc 14:08 +0700 giữ nguyên artifacts lần 1 và chạy lại 5 tác vụ dưới sandbox wrapper. **47 điều kiện kiểm động pass**, cùng 2 ghi chú mô tả được runner đánh dấu true: transcript không rỗng, JFK WER 0, dialogue giữ các nội dung/số đã chốt, hierarchy word/token/phone phù hợp, timestamps hữu hạn và hợp lệ, sibling có thứ tự, child nằm trong parent.

Control probe kết nối `127.0.0.1:9` trong cùng sandbox policy bị chặn bằng `EPERM` (errno 1), không phải chỉ lỗi connection refused. Command receipt giữ exact argv, policy SHA-256, start/end, exit code và hash của stdout/stderr. Runner inference exit 0. Như vậy kết luận offline không chỉ dựa vào chuỗi `networkPolicy` do runner tự ghi.

- [Verification predicates](evidence/local-verification.json).
- [Command receipt](evidence/local-verification-command-receipt.json).
- [Wrapper tái lập](evidence/local-verification-wrapper.py).
- [Raw summary lần 2](evidence/local-verified/local-live-summary.json).

Các số latency trong bảng đầu là lần 1. Lần 2 dùng để xác minh acceptance và provenance, không thay số đo cũ hoặc tạo bảng xếp hạng tốc độ.
