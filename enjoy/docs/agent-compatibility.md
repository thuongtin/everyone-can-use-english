# Khả năng native agent của Xưởng bài học

Ngày cập nhật: 2026-09-07. Bảng này ghi nhận runtime native đã kiểm bằng phiên đăng nhập CLI hiện có và lần nghiệm thu app đóng gói. Đây là bằng chứng theo capability, chưa phải tuyên bố hoàn tất core của Xưởng bài học.

## Trạng thái hiện tại

| Capability | Codex 0.153.2 và 0.153.4 | Claude Code 2.1.263 | Bằng chứng và giới hạn |
|---|---|---|---|
| Binary, protocol và schema native | Đạt | Đạt | Adapter native đã chạy bằng binary exact version. |
| Auth CLI hiện có | Đạt | Đạt | `../scripts/check-native-existing-auth.mjs`: cả hai status authenticated; Claude báo `claude.ai`. Enjoy giữ `HOME` và `USER`, không đọc, copy hoặc log credential. |
| Text lesson qua MCP thật và SQLite thật | Đạt | Đạt | `../tmp/learning-acceptance/2026-09-07/codex-native-lesson.json` và `claude-native-lesson.json`, job `completed`, payload được commit vào SQLite. |
| Mindmap qua MCP thật | Đạt, 12 nodes và 11 edges | Đạt, 18 nodes và 21 edges | `codex-native-map.json` và `claude-native-map.json`, mỗi job `completed`. |
| Ảnh native | Đạt | Không áp dụng | Codex image item có PNG hợp lệ trong `codex-native-image.json`; stage ảnh là asset stage tuần tự của lesson. Claude không phải image provider của bản này. |
| UI tạo, retry, cancel và poll | Đã nối | Đã nối | Luồng UI gọi job/stage native và cập nhật trạng thái theo checkpoint. Event allowlist, failed-start recovery và tạo riêng asset variant đã có regression PASS. |
| Cancel inference native | Đạt | Đạt | `codex-native-cancel.json` và `claude-native-cancel.json`: native đã bắt đầu, abort sau 1.2 giây, trả `native_cancelled` và cleanup adapter hoàn tất. |
| Tạo lesson trong app đóng gói | Đạt | Đạt | `/tmp/enjoy-native-packaged-qa.log` có 2 test pass; final guard hiện tại 2.7 phút và `../tmp/learning-acceptance/2026-09-07/packaged-native-verified/.last-run.json` là `passed`. |
| Ảnh trong app đóng gói | Đạt cho Codex | Không áp dụng | Evidence verified có `packaged: true`, lesson ready, 1 scene, 1 slot và 1 PNG asset native; `codex-native-image.png` và `codex-native-image-preview.png` hiển thị đúng cảnh hai người với hai cốc. |
| SpeechProvider đã cấu hình | Đã nối | Đã nối | Factory/provider dispatch đã wiring; node speak generation có cache. TTS thật vẫn chưa đạt, xem phần dưới. |
| TTS thật | Chưa đạt | Chưa đạt | Lần chạy đầu trả `speech_failed` chưa rõ nguyên nhân; lần chạy thật thứ hai phân loại được `speech_auth` với HTTP 401/403. Endpoint khớp configured speech builder hiện có; owned-map receipt đã cleanup. Đã yêu cầu đăng nhập lại Enjoy AI, nhưng chưa có audio runtime pass. |
| Corpus 30 native | 15/15 completed | 15/15 completed | 30/30 ready, target/story/practice và 226 references hợp lệ. Đã đọc thủ công 30 bài; xem `corpus/summary.md` và `corpus/manual-review.md`. Không phải chứng nhận CEFR. |
| Micro vật lý qua packaged UI | Đạt | Đạt | `physical-microphone.json`: capture 3 giây, `actualMicrophone: true`, lưu WebM 54,534 bytes, restart và playback tiến thời gian; log `/tmp/enjoy-physical-microphone.log` pass. Audio capture chỉ là artifact tạm trong isolated app và đã cleanup. |
| OmniVoice local | Chưa bật, đang gated | Chưa bật, đang gated | Chưa tải/chạy weights; còn gate exact model/runtime, chất lượng và license. |

## Bằng chứng native có thể chạy lại

- Auth status-only: `node ../scripts/check-native-existing-auth.mjs` khi chạy từ `enjoy/docs` hoặc `node scripts/check-native-existing-auth.mjs` khi chạy từ `enjoy`. Lệnh chỉ trả trạng thái allowlist, không inference và không in secret.
- Native lesson/map/image/cancel: các artifact trong `../tmp/learning-acceptance/2026-09-07/`. Lesson Codex có 3 section và 1 scene; lesson Claude có 2 section. Image artifact của Codex là PNG 950,505 bytes theo metadata. Cancel có kết quả `native_cancelled` và cleanup đầy đủ cho cả hai provider.
- Native cancel có thể chạy lại bằng `../scripts/check-native-cancellation-live.mjs`; log JSONL tại `/tmp/enjoy-native-cancel-live.log`.
- Ảnh adapter native thực: [`../tmp/learning-acceptance/2026-09-07/native-apple.png`](../tmp/learning-acceptance/2026-09-07/native-apple.png), PNG 1254 x 1254.
- Packaged UI, MCP và SQLite: `/tmp/enjoy-native-packaged-qa.log` cùng evidence verified và screenshot trong `../tmp/learning-acceptance/2026-09-07/packaged-native-verified/`.
- Physical microphone: `../tmp/learning-acceptance/2026-09-07/physical-microphone/` và `/tmp/enjoy-physical-microphone.log`. Audio capture chỉ là artifact tạm trong isolated app; không có audio file được giữ sau cleanup.

Các fixture home riêng, synthetic tone và nội dung thủ công trong artifact cũ chỉ chứng minh contract hoặc lifecycle tương ứng. Synthetic tone không thay thế bằng chứng microphone vật lý. Các bằng chứng native và physical microphone mới được ghi riêng ở trên; chúng vẫn không chứng minh TTS thật.

## Chính sách mở capability

Capability chỉ mở khi có bằng chứng native tương ứng trong đúng profile và đúng binary đã kiểm. Kết quả tự nhận thành công, schema/model catalog hoặc fixture home riêng không đủ để mở generation. App không được đọc credential, database hoặc MCP cá nhân ngoài scope bài học; không tự đổi sang provider trả phí khi provider hiện tại lỗi.

Tình trạng hiện tại: native text, mindmap, Codex image, cancel, packaged lesson và physical microphone flow đã có bằng chứng; TTS thật và OmniVoice còn mở. Corpus 30 có kết quả cuối và review giới hạn. Vì vậy chưa gọi bản đầu hoặc core DoD là hoàn tất chỉ từ bảng này.

## Bổ sung nghiệm thu 0.153.4

Codex CLI tự cập nhật từ 0.153.2 lên 0.153.4 trong lúc chạy corpus; gate exact version chặn đúng tám case trước khi chạy native. Root đã kiểm schema, cleanup/cancel, ảnh native và lesson qua MCP thật trước khi thêm 0.153.4 vào allowlist. Evidence: `../tmp/learning-acceptance/2026-09-07/compatibility-0.153.4/compatibility.json`. Catalog model do app quản lý vẫn ghi source 0.153.2; không suy diễn version delta từ schema baseline không chắc provenance.

AE1 A2 sáu từ `order`, `menu`, `coffee`, `colleague`, `prefer`, `bill` cũng đạt native Codex 0.153.4: đủ target trong story/glossary/practice, 136 từ, validator không còn issue/warning, một submission bị từ chối trước normal repair. Artifact: `../tmp/learning-acceptance/2026-09-07/ae1-six-targets/`.

Audio playlist packaged đã đạt với synthetic MP3 qua loopback SpeechProvider: tạo hai section audio đúng revision text, tự chuyển đoạn, tốc độ 1.5, regenerate giữ variant cũ, restart và phát offline. Artifact `../tmp/learning-acceptance/2026-09-07/audio-playlist/` ghi rõ `actualSpeechInference: false`. Đây là bằng chứng pipeline và playback, chưa phải TTS thật.

## Kết quả package cuối

Codex PASS toàn flow tại `packaged-final-verified/.../codex-native-evidence.json`: text+image, tạo thêm image variant, chọn lại bản cũ, full restart, mở offline, fixed exercise sai rồi đúng. Claude PASS tại `packaged-final-claude/.../claude-native-evidence.json`: text, full restart, mở offline và fixed exercise. Lượt hai-provider trước đó giữ failed vì test selector trùng title ở Claude; đã sửa selector và chỉ rerun Claude. Đây là kết quả tổng hợp theo từng provider, không gọi lượt hai-provider đó là toàn bộ passed.

`check-packaged-app.mjs`, `codesign --verify --deep --strict`, TypeScript và lint phần task PASS (lint còn một warning có sẵn). Chi tiết và log ở `final-verification.json` cùng thư mục acceptance.

## Sửa discovery khi mở app trực tiếp trên macOS

Người dùng phát hiện cả hai CLI báo thiếu dù đã cài. Root kiểm app thật có `cwd=/`: discovery lấy cwd làm pin jobRoot nên mọi absolute executable bị chặn bởi điều kiện nằm trong jobRoot. PATH fallback đã có, không phải thiếu cài đặt hoặc chưa login. Các lượt QA trước chạy từ project cwd nên chưa bao phủ LaunchServices.

Default discovery/status probe nay dùng thư mục tạm riêng, không dùng cwd của launcher làm job boundary; explicit cwd guard, absolute path validation, native auth environment và cleanup checks vẫn được giữ. Regression RED trước sửa, GREEN 16 cases sau sửa; TypeScript/lint/package/codesign PASS. Mở lại đúng package bằng macOS, xác minh process vẫn `cwd=/`, UI hiển thị Codex có thể tạo chữ/hình và Claude có thể tạo nội dung chữ. Evidence `../tmp/learning-acceptance/2026-09-07/gui-cli-discovery/{status-only,gui-verification}.json`. Lượt sửa này chỉ kiểm status/UI, không chạy thêm inference trả phí.
