# Nghiệm thu Xưởng bài học AI

> Báo cáo lịch sử ngày 07/09/2026. Trạng thái nghiệm thu mới nhất nằm trong [nghiệm thu provider độc lập](./provider-independence-acceptance.md). Luồng TTS và đánh giá phát âm qua Azure đã có bằng chứng thật ở các build sau; các blocker Enjoy AI ghi bên dưới được giữ làm lịch sử.

Ngày: 2026-09-07. Đối chiếu [plan](../../docs/plans/2026-09-06-001-feat-ai-learning-studio-plan.md). Native text, mindmap, ảnh Codex, cancel, bài tập, micro vật lý và pipeline audio đã có bằng chứng runtime. TTS thật vẫn bị chặn bởi authentication; OmniVoice chưa bật. Core DoD chưa hoàn tất.

## Native và chất lượng nội dung

| Hạng mục | Kết quả | Evidence dưới `../tmp/learning-acceptance/2026-09-07/` |
|---|---|---|
| Codex lesson/map | PASS qua MCP và SQLite thật; map 12 nodes/11 edges | `codex-native-lesson.json`, `codex-native-map.json` |
| Claude lesson/map | PASS qua MCP và SQLite thật; map 18 nodes/21 edges | `claude-native-lesson.json`, `claude-native-map.json` |
| Codex image | PASS bytes/decode và preview scene trong packaged app | `codex-native-image.json`, `packaged-native-verified/` |
| Native cancel | PASS cả hai provider, đã bắt đầu inference rồi abort, cleanup được xác minh | `codex-native-cancel.json`, `claude-native-cancel.json` |
| Corpus A1-C2 | 30/30 completed, 0 rejected/errors/remaining; 226/226 references hợp lệ | [summary](../tmp/learning-acceptance/2026-09-07/corpus/summary.md), [manual review](../tmp/learning-acceptance/2026-09-07/corpus/manual-review.md) |
| AE1 A2 sáu target | PASS `order`, `menu`, `coffee`, `colleague`, `prefer`, `bill`; story 136 từ, glossary một mục/target, practice 3-4 exposure/target | [AE1 review](../tmp/learning-acceptance/2026-09-07/ae1-six-targets/manual-review.md) |

Corpus dùng 15 Codex và 15 Claude cases, 5 topic ở mỗi level, một target/brief. Lượt đầu có tám Codex preflight errors do binary tự cập nhật và 12 Claude cases có đáp án điền từ không khớp ngữ pháp. Prompt và guard hẹp đã sửa, sau đó chạy lại đúng 20 ca, giữ original JSON/SQLite history tại `corpus/history/rmtqj4ula-41271-9c3b7d3b/`. Tổng kết 30/30 là kết quả cuối sau sửa, không phải tỷ lệ thành công ngay lần đầu.

Đã đọc thủ công cả 30 story và exercise. Không phát hiện thêm lỗi ngữ pháp rõ ràng trong đáp án cuối; case 22 còn điểm mơ hồ giữa câu ví dụ độc lập và nhân vật story. Story tăng độ phức tạp theo level nhưng bài tập với target phổ thông có thể dễ hơn level chọn. Review này không chứng nhận CEFR hoặc độ chính xác kiến thức ngoài ngôn ngữ.

Codex được kiểm với 0.153.2 và 0.153.4; Claude Code 2.1.263. Trước khi mở 0.153.4, đã kiểm schema, ảnh native, MCP lesson và cancel thực. Xem `compatibility-0.153.4/compatibility.json`. Auth dùng identity CLI hiện có; không đọc/copy/log credential.

## App đóng gói, offline và audio

Các test packaged native dùng account/library Enjoy tạm và mock API nền của app để tránh sửa dữ liệu cá nhân. Riêng native CLI subscription, inference, MCP và SQLite đều chạy thật; không dùng fixture để tạo nội dung bài hoặc ảnh.

Các lượt native trước đã PASS tạo lesson từ UI cho cả hai provider tại `packaged-native/` và `packaged-native-verified/`. Lượt nâng cao `packaged-final/` đã tạo lại ảnh, chọn lại variant cũ và mở bài/luyện tập offline, nhưng runtime guard FAILED vì bootstrap request mạng bị reject khi chuyển offline. Artifact đã ghi `pass: false` và phân biệt các assertion đã qua.

Đã sửa unhandled rejection của IPA config và YouTube suggested-channel config để giữ giá trị có sẵn; giữ nguyên các sửa đổi YouTube trước task. Test offline hiện chuyển vào Studio và chờ bootstrap ổn định trước khi cắt mạng, rồi mở lại lesson đã lưu. Điều này kiểm cached learning content offline, không tuyên bố toàn bộ app hoặc native cloud generation chạy offline.

Audio playlist packaged PASS: actual dispatcher, SpeechProvider, decode, SQLite và player; loopback trả synthetic MP3. Test tạo hai section audio đúng revision text, tự chuyển đoạn, tốc độ 1.5, regenerate giữ bản cũ, full restart và phát offline. Evidence: [audio playlist](../tmp/learning-acceptance/2026-09-07/audio-playlist/learning-audio-playlist-pa-7ad8f-plays-ordered-section-audio/audio-playlist.json), screenshot cùng thư mục. `actualSpeechInference: false`, không dùng tone để thay nghiệm thu TTS thật.

Micro vật lý PASS qua packaged practice UI: permission granted, capture ba giây, lưu WebM 54,534 bytes, full restart và playback tiến thời gian. Evidence `physical-microphone/`, log `/tmp/enjoy-physical-microphone.log`. Audio capture chỉ tồn tại trong isolated profile tạm và đã cleanup.

## Các sửa chữa trong vòng nghiệm thu

- Tạo lại ảnh/audio riêng từ UI; commit variant mới đúng revision và giữ asset cũ.
- Sửa lesson thủ công tạo asset slots cho revision mới trong cùng SQLite transaction.
- Player toàn bài theo đúng thứ tự section, đổi tốc độ và chặn autoplay khi đổi revision/variant.
- Bài sắp từ không khởi tạo sẵn đúng đáp án. Fill prompt dùng đúng target term và validator bắt hẹp trường hợp lặp article/infinitive.
- Job không bị kẹt queued nếu `startAttempt` thất bại; concurrent attempt đã claim được giữ.
- Native Codex event phải đúng scoped MCP server/tool; cleanup failure tiếp tục chặn acceptance.

## Gate còn mở

TTS thật đã chạy với cấu hình Enjoy AI nhưng trả `speech_auth` HTTP 401/403; lần trước đó là `speech_failed`. Endpoint khớp configured speech builder. `configured-speech/.last-run.json` là failed; cần đăng nhập lại Enjoy AI rồi chạy lại và nghe mẫu. Không đổi sang provider trả phí khác.

OmniVoice chưa tải/chạy weights; exact runtime/model, license và chất lượng vẫn gated. Chưa gọi là đã tích hợp OmniVoice.

Không commit, push, PR, merge hoặc phát hành. Package local và các kết quả trên phục vụ kiểm tra trước khi chốt core.

## Đối chiếu package cuối

Package cuối build thành công, `codesign --verify --deep --strict` PASS, `check-packaged-app.mjs` PASS database/native dependencies/từ điển. TypeScript toàn Enjoy PASS; lint phần native/learning/UI đã sửa không còn error, còn warning `ahoy.configure` có sẵn. Các nhóm contract/storage/jobs/assets/reader/practice/controller liên quan đã qua. Evidence tổng: [final-verification.json](../tmp/learning-acceptance/2026-09-07/final-verification.json); fingerprint package/source: `package-fingerprint.json`.

Codex native trên package cuối PASS 239,993 ms, bao gồm hai ảnh cùng slot, chọn lại variant cũ, full restart, mở nội dung offline và trả lời sai rồi đúng một bài fill. Evidence: `packaged-final-verified/learning-native-codex-gene-8c390--packaged-UI-MCP-and-SQLite/codex-native-evidence.json`. Root đã xem ảnh: Mia và Ben bên cửa sổ café, hai đồ uống và hai bánh đúng scene.

Trong cùng lượt, Claude tạo nội dung PASS nhưng bước reopen test lỗi strict locator vì title trùng bài Codex. `.last-run.json` của lượt hai-provider vẫn failed và được giữ. Đã sửa test chọn đúng vị trí theo lesson ID trong danh sách đã đọc; chỉ chạy lại Claude để tránh inference Codex không cần thiết.

Lượt Claude chạy riêng sau sửa selector PASS: 46.5 giây toàn test, native/evidence elapsed 39,930 ms, full restart, mở lesson offline và fixed exercise sai rồi đúng. Evidence: `packaged-final-claude/learning-native-claude-gen-4ae9d--packaged-UI-MCP-and-SQLite/claude-native-evidence.json`; `.last-run.json` của lượt này là passed. Kết luận native packaged cuối được tổng hợp từ Codex PASS ở lượt hai-provider và Claude PASS ở lượt chạy riêng; không đổi trạng thái failed của lượt trước.

Hai test local cuối (`learning-studio.spec.ts` và `learning-audio-playlist.spec.ts`) PASS 26.4 giây trên cùng package. Bao phủ preload/SQLite, practice, graph, scoped audio/restart và playlist/variants/offline. Artifact `packaged-local-verified/`; audio vẫn là synthetic fixture. Source/package fingerprint vẫn khớp sau khi hoàn tất.

## Sửa discovery khi mở app trực tiếp trên macOS

Người dùng phát hiện cả hai CLI báo thiếu dù đã cài. Root kiểm app thật có `cwd=/`: discovery lấy cwd làm pin jobRoot nên mọi absolute executable bị chặn bởi điều kiện nằm trong jobRoot. PATH fallback đã có, không phải thiếu cài đặt hoặc chưa login. Các lượt QA trước chạy từ project cwd nên chưa bao phủ LaunchServices.

Default discovery/status probe nay dùng thư mục tạm riêng, không dùng cwd của launcher làm job boundary; explicit cwd guard, absolute path validation, native auth environment và cleanup checks vẫn được giữ. Regression RED trước sửa, GREEN 16 cases sau sửa; TypeScript/lint/package/codesign PASS. Mở lại đúng package bằng macOS, xác minh process vẫn `cwd=/`, UI hiển thị Codex có thể tạo chữ/hình và Claude có thể tạo nội dung chữ. Evidence `../tmp/learning-acceptance/2026-09-07/gui-cli-discovery/{status-only,gui-verification}.json`. Lượt sửa này chỉ kiểm status/UI, không chạy thêm inference trả phí.
