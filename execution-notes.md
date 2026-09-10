# Enjoy: trạng thái thực thi

## Trạng thái bàn giao mới nhất, 2026-09-10

Bản `local-signed-build12` đã hoàn tất nghiệm thu trong phạm vi local được giao. Xem [nghiệm thu provider độc lập](enjoy/docs/provider-independence-acceptance.md) để biết kết quả từng provider, phiên bản build và giới hạn bằng chứng. Các phần bên dưới là nhật ký lịch sử; trạng thái chờ TTS, Gemini, provider local hoặc micro ở những lượt trước không phải trạng thái cuối.

Theo yêu cầu cài đặt tiếp theo, app đã được chép vào `/Applications/Enjoy.app`, cấu hình các key còn thiếu và kiểm tra persistence sau full restart. Thư viện và các giá trị cấu hình cũ được giữ nguyên, có backup riêng ngoài repo. Credential và dữ liệu profile không thuộc mã nguồn bàn giao.

## Nghiệm thu tiếp trên bản ký local, 2026-09-10

Build 9 ở `enjoy/out/local-signed-build9/Enjoy-darwin-arm64/Enjoy.app`, ASAR `953d22ad80334ecb38052e636a8e5048a7e211346c2efb21583d1892f0b0462a`. Khớp614 files, strict signature/stable DR/package guard và scan 16077 runtime files PASS. So build 8 chỉ đổi fallback-prefix seam planning trong `service.ts`; source review độc lập PASS.

| Phần việc | Evidence hiện tại và việc còn mở |
|---|---|
| Signing/G1 | Stable DR, safeStorage cross-build decrypt đã PASS build 5; không thay Keychain/app cài đặt |
| U1-U3/G2 | Migration/idempotency, rollback exact SHA/schema/95 rows, fresh/multi-profile PASS build 5 |
| U4-U5/U9 | Stories/Vocabulary, legacy assets PASS; AE2 rebind và Chromium/SDK controls 2/2 PASS |
| G4 | Build 5 network 2/2 PASS, idle 600000 ms, online/offline/reconnect/full restart, all normal Enjoy counters 0 |
| U6/G5 ASR | Build 9 Azure MAI 103.966s/WER 1.4908%, Fast 45.788s/WER 1.3188%, Cloudflare 79.527s/WER 1.3761% trên audio 722.512s. Cả ba full timeline UI/offline hash/coverage/timestamps/zero Enjoy PASS. Cloudflare9 đi whole-path, không tự chứng minh nhánh fallback mới |
| U7-U8/G5 Learning | Lesson+narration thật build 6 PASS, 2 WAV decode offline. Cafe map build 7 run2 PASS 45.8s, root đúng, 11 words/phrases, 12 nodes giữ hash offline; nghĩa/examples đã được đọc |
| G6 | Fresh Nuxt/Chrome 48 responses200, SSR/hydration/assets/zero Enjoy PASS. Dictionary resource hook cold PASS. Public GitHub docs vẫn bản cũ vì chưa push/deploy |
| G7 | Review cuối đã chốt; P1 về tích hợp đầy đủ nhánh fallback đã khép bằng clean packaged fixture và evidence live/historical có provenance riêng. Gemini/Ollama/LM Studio, human listening và microphone vật lý chưa kiểm |
| R9 | Hai existing Azure keys và một Cloudflare tunnel token xuất hiện trong tool output; user đã được báo, UI che lại và process/env inspection dừng. Chưa rotate/revoke; không nhận secret-handling toàn bộ PASS |

Historical replay đã chứng minh fallback merge và word validation trên dữ liệu CF8 cũ. Full replay vẫn FAIL tại uncached coverage repair, với giới hạn thiếu music-aware Electron wrapper; không gọi đây là packaged fallback PASS. Chi tiết trong `replay-build8-checkpoints-on-build9.md`.

Hai ca supplemental trên đúng build 9 đã PASS: whole 6.6s và fallback 19.8s, 44 từ/2 câu, actual alignment/seam/YAMNet, toàn bộ quality gates và cleanup sạch. Boundary dùng provider fixture, không gọi live provider. Natural fallback chưa quan sát; không tự thêm yêu cầu mọi recovery branch phải xuất hiện tự nhiên. Fallback run1 có native fatal sau phép đo VAD phụ nên giữ là runtime-health failure, không sửa receipt cũ. Xem `packaged-fallback-final-summary.json` và review độc lập tương ứng.

Private fixture cleanup đã hoàn tất; 1517 files được quét với một known Azure key, zero match. Key thứ hai/tunnel token/tool-output history không nằm trong byte scan; R9 vẫn mở. `final-private-fixture-cleanup.json` ghi phạm vi và hash.

Evidence mới: `.superpowers/sdd/2026-09-10-azure-models/`. Failed history giữ nguyên, gồm CF7 gap selection, CF8 alignment/fallback, Azure harness OOM/selector/virtualized UI và map 6 sai topic. Tests trả phí cuối chạy nối tiếp. Không commit/push/deploy, thay installed app hoặc dữ liệu thật. Goal chưa complete.

## Goal loại bỏ backend Enjoy, cập nhật 2026-09-10

Package 12 đã kiểm Azure TTS và đánh giá phát âm thật, gồm WebSocket, WAV playback và offline restart persistence. Cloudflare ASR đã PASS trên package 10 bằng cấu hình trong snapshot. Goal còn mở ở Gemini credential và hai local services Ollama/LM Studio. Không commit/push/deploy, không thay app đang dùng, thư viện thật hoặc bảo mật; runtime/migration dùng disposable profiles hoặc snapshot copy.

| Phần việc | Kết quả hiện tại |
|---|---|
| U1-U3 Policy, migration, bootstrap | Package 10 migration, rollback, fresh/two-profile isolation PASS; package 9 core 8/8 gồm idle 10 phút |
| U4-U5 Text, Stories/Vocabulary | Ba text adapters PASS package 9; legacy conversation rebind PASS package 10; Codex/Claude native PASS package 8; local Stories/Vocabulary regression PASS package 12 |
| U6 ASR | OpenAI whisper-1/MAI short-long PASS package 8; Cloudflare JFK 11 giây, 22/22 từ, WER 0 và persistence PASS package 10 |
| U7-U8 Speech/phát âm | Azure package 12 WAV 3.35 giây, 7 từ/15 phonemes, hai WebSocket 101, hash/UI giữ qua offline restart. OpenAI TTS package 8 PASS |
| U9 Legacy assets | Local media/missing states/provenance/timestamps và offline restart PASS package 10 |
| U10 Portal | Build/browser local PASS, chưa deploy |
| U11 Nghiệm thu | Package 12 source585 khớp build, 68 compiled files chỉ còn retired-host denylist. Azure live 1 PASS và regression 2 PASS; 18 narration contract cases PASS, independent review không có finding |

[Báo cáo nghiệm thu](enjoy/docs/provider-independence-acceptance.md) giữ trạng thái, evidence, failed history và giới hạn. Evidence tại `.superpowers/sdd/2026-09-09-remove-enjoy-backend/`; baseline và task delta giữ dirty work.

ASAR package 12 SHA-256: `f5be14bb4a162af7f7c084c292bb04f5eef019ea73174bf3e3a27c8fd11ad77a`. Chỉ SDK runtime dependency và Azure cleanup thay so package 10. SDK inline bị timeout trước request; SDK nguyên bản chạy khoảng 2 giây. Cleanup thực đo 543 ms nên Azure dùng bound 5 giây, HTTP vẫn 250 ms; không bỏ qua cleanup failure hoặc cancellation.

Azure nhận đủ 7 từ nhưng đánh dấu `cup` đầu là Mispronunciation; điểm 76.4 giữ nguyên. Đây là mẫu TTS kiểm tích hợp, chưa hiệu chuẩn chấm giọng người thật hoặc thử loa vật lý. Cloudflare lượt mới chỉ dùng mẫu ngắn. Các bằng chứng text/native/long ASR trước giữ đúng provenance, không tuyên bố chạy lại toàn bộ trên package 12.

## Kết quả goal local và ACP ngày 2026-09-07

Ứng dụng cá nhân không buộc login Enjoy hoặc hỏi Keychain của Enjoy; giữ API, thêm ACP thật Codex/Claude, bỏ Cộng đồng, đầu vào Xưởng bài học tối giản và gợi ý AI. Mindmap chỉ nghiên cứu và đề xuất nguồn mở. Goal mới không lấy evidence native cũ làm bằng chứng ACP.

Snapshot trước sửa: `enjoy/tmp/local-acp-acceptance/2026-09-07/source-baseline.tar.gz`, manifest SHA-256 gồm 126 file. Branch hiện tại `codex/learning-studio`; không commit, push hoặc deploy. SQLite và settings gốc đã được backup trước khi kiểm tra chuyển thư viện.

| Yêu cầu | Trạng thái hiện tại | Bằng chứng và giới hạn |
|---|---|---|
| Local profile, bỏ gate login/Keychain | Auto profile, chooser, backup, atomic settings, rename/recovery và cloud boundary đã triển khai | Package 6 mở từ Finder với hồ sơ mới/cũ PASS; đối chiếu SQLite cũ giữ dữ liệu; cold offline bootstrap PASS |
| ACP Codex và Claude | SDK 1.4.0, Codex adapter 1.10.0, Claude adapter 0.75.1; auth/model/text/stream/cancel và MCP scoped thật đã có proof | Package 6: cả hai full lesson flow, streaming, model selection, offline/practice, hủy và lỗi model PASS |
| Giữ API | Giữ EnjoyAI, OpenAI, Gemini, DeepSeek, OpenRouter, Ollama, LM Studio; credential EnjoyAI tách khỏi profile login; lookup/translation dùng cache local | DeepSeek inference thật PASS; provider/runtime fixtures PASS; API chưa cấu hình không được tính inference pass, EnjoyAI speech còn lỗi auth |
| Xưởng tối giản | Chủ đề hoặc từ khóa, A2 mặc định; gợi ý sửa được; hình/audio tự chọn; parser và DOM fixtures PASS | Topic-only Codex và keywords-only Claude đã tạo SQLite, restart offline, làm bài; UI lỗi model thật giữ input cho cả hai |
| Bỏ Cộng đồng | Bỏ route, sidebar, IPC, toàn bộ CTA chia sẻ và API createPost; source scan không còn caller | Đã quan sát điều hướng packaged từ Finder, không có Cộng đồng |
| Nghiên cứu mindmap | Hoàn tất [so sánh](docs/research/2026-09-07-enjoy-mindmap-renderers.md); giữ xyflow có điều kiện, Mind Elixir cho authoring cây, Markmap cho Markdown | Không thay renderer; không nhận upstream claim là runtime proof |
| Nghiệm thu | Package 6 build/sign, TypeScript, packaged DB/dictionary và native generation checks PASS | Bộ 5 ca packaged PASS trong 5.6 phút; giới hạn credential và nội dung được ghi rõ dưới đây |

Nguyên nhân Keychain: Electron fuse `EnableCookieEncryption` của Enjoy đang bật. Đã tắt fuse và chuyển riêng Chromium `sessionData` sang thư mục `local-browser-v1` để không đọc hoặc làm hỏng cookie store đã mã hóa cũ. Không dùng `--use-mock-keychain` làm bằng chứng nghiệm thu mới; không sửa credential hoặc Keychain của Codex/Claude.

ACP chạy bằng Node.js 22 trở lên trên máy, với đường dẫn executable được pin và adapter đã bundle/unpack. Máy hiện tại có Node 24.18.1. Khi thiếu Node hoặc adapter, UI báo capability không sẵn sàng; ứng dụng local vẫn mở. Đây là prerequisite của ACP, không phải của thư viện SQLite.

Evidence text ACP thật: `enjoy/tmp/local-acp-acceptance/2026-09-07/acp-live-proof.json`, hai provider trả `ACP_OK`, có streaming và hủy giữa stream. Proof này chưa kiểm MCP tạo bài; không dùng để thay packaged acceptance. Root đã đọc artifact và script tạo proof. Các probe discovery được tách khỏi getContext local, có ownership theo profile và hủy khi đóng cửa sổ hoặc đổi hồ sơ.

Review phản biện đã tìm và sửa lỗi đổi library không await, stale profile ID, partial settings write, backup mode rộng, rename/recovery mất tên, chooser gọi DB IPC sau khi handler đã unregister, EnjoyAI legacy key dùng không nhất quán, lookup bị chặn bởi Enjoy cloud, remote translation write không bắt lỗi, pronunciation xóa recording khi auth fail, và CTA Community còn sót. Courses/enrollment cloud-only được bỏ khỏi điều hướng/route của bản local. Pronunciation/TTS giữ explicit EnjoyAI credential và thông báo cần cấu hình, giữ recording khi provider fail.

### Kiểm tra Finder và dữ liệu ngày 2026-09-07

Package 3 đã được mở bằng Finder với hồ sơ Ethan, sau đó dùng UI đổi sang thư viện trống `finder-fresh/EnjoyLibrary`, thoát và mở lại bằng Finder. Cả hai mở trực tiếp vào local home, không hiện login Enjoy hoặc Keychain prompt. Mindmap `coffee` và video cũ mở được. Trên hồ sơ mới, UI đã discovery Codex/Claude, chọn và lưu `gpt-5.6-sol` rồi `sonnet`. Screenshot: `finder-existing-home.png`, `finder-existing-map.png`, `finder-fresh-home.png`, `finder-codex-acp-connected.png`, `finder-codex-model-saved.png`, `finder-claude-model-saved.png` trong thư mục evidence local ACP.

Đã khôi phục `/Users/ethan/Documents/EnjoyLibrary` bằng UI. `live-data-after-finder.json` đối chiếu từng row với SQLite backup: 27 bảng exact, 18 cache rows giữ số lượng với 4 entry refresh; 7 user settings giữ số lượng, chỉ PROFILE thêm `nameSource`. Legacy token, DeepSeek config, GPT engine, TTS/recorder và toàn bộ nội dung học/chat/recording giữ nguyên. Finder checks này dùng mạng bình thường; offline cold restart được kiểm riêng trong Playwright, không tuyên bố hệ thống đã tắt mạng.

Package 2 ACP Codex đã gợi ý, sửa, tạo bài và ghi SQLite, nhưng suite failed ở bootstrap runtime guard trước restart. Diagnostics package 3 xác định lỗi renderer Bugsnag và ACP-before-DB đã được sửa; lỗi còn lại thuộc external Audible/YouTube WebContents và hai model discovery probes localhost chưa chạy. Harness phân loại provenance riêng, vẫn fail mọi lỗi main process và lỗi Enjoy renderer chưa biết; external network không được nhận là pass. Package 4 thất bại `ENOTEMPTY` khi Finder giữ thư mục output, đã rời thư mục và chạy lại package 5. Không đổi artifact failed thành passed.

DeepSeek API inference thật trả `API_OK`, dùng model cấu hình cũ `deepseek-v4-flash`; receipt `retained-api-live.json`. Các provider không có credential hoặc local server chỉ có contract/fixture evidence, không được ghi là inference pass. EnjoyAI speech còn lỗi auth theo evidence trước đó. Review UX cuối đã sửa lỗi Chat/Conversation thiếu key để hướng dẫn Cài đặt và chọn API/ACP thay vì yêu cầu login Enjoy.

Package 5 có receipts nghiệp vụ hoàn tất cho cả Codex và Claude, nhưng runtime guard vẫn failed vì thumbnail online lúc offline và Chromium WidgetHost của nguồn ngoài. Bản local hiện chỉ mount đề xuất YouTube/Audible khi người dùng bấm nút, giữ nguyên local media và quản lý custom channels. `bootstrap-local-home/` của package 6 PASS 24.7 giây, xác minh không tự tạo HTTP(S) WebContents và mở lại được offline. Không dùng việc miễn lỗi nguồn ngoài làm bằng chứng cho sửa Home này.

Review nội dung Codex phát hiện order-2 dùng tea khi nhân vật gọi iced coffee, và order-3 tạo một fragment. Đã giữ nguyên receipt cũ, thêm chỉ dẫn order exercise lấy câu hoàn chỉnh từ story và đối chiếu chi tiết trước submit; validator hiện có vẫn giữ nguyên. Đây là cải thiện prompt, không tuyên bố có semantic validator hoàn hảo. Root đã đọc toàn bộ hai bài package 6, đối chiếu story, glossary và đáp án. Codex mới không còn lỗi chi tiết hoặc order đã phát hiện; Claude có 3 target và 10 bài tập nhất quán. Codex vẫn có cảnh báo heuristic độ dài câu (25 so với hướng dẫn 18 từ); bộ tách câu có thể gộp câu có dấu ngoặc kép. Giữ nguyên cảnh báo, không xem đây là chứng nhận CEFR hoặc đảm bảo ngữ nghĩa tuyệt đối.

Helper backup cũ chỉ khởi tạo SQLite Backup nên artifact failed đầu tiên 0 byte. Đã sửa `init -> step(-1) -> finish -> close`; `wal-backup-proof.json` có 3 rows và integrity OK với writer WAL còn mở. SQLite backup thật từ lượt Claude `packaged-acp-remaining/` có 331,776 bytes, integrity OK và 2 practice attempts. Các artifact failed giữ nguyên lịch sử.

### Nghiệm thu package 6 cuối cùng

Bản app: `enjoy/out/Enjoy-darwin-arm64/Enjoy.app`. `app.asar` SHA-256: `5bed5c377d5f7464a4dcc070f93682e95596ad4689ed6c3e2c1fb8b6692fd33b`. Đối chiếu 544 source files sau toàn bộ test và lượt Finder cuối: không file nào đổi từ lúc build. Build, `codesign --verify --deep --strict`, full TypeScript và packaged DB/dictionary checks PASS. Lint phần source thay đổi PASS; không đổi validator để làm test đạt.

`e2e/local-acp.spec.ts` và `e2e/local-acp-errors.spec.ts`: **5/5 PASS, 5.6 phút, retries=0, workers=1**, dùng binary đóng gói và hai adapter thật. Log giữ tại `enjoy/tmp/local-acp-acceptance/2026-09-07/packaged-acp-verified.log`; receipts, screenshots, runtime diagnostics và SQLite backup nằm trong `packaged-acp-verified/` cạnh log.

| Ca kiểm tra thực tế | Kết quả |
|---|---|
| Codex topic-only, A2 mặc định, sửa nghĩa gợi ý, tạo bài | PASS, `gpt-5.6-sol`, bài `A Polite Coffee Order`, 6 target, job/stage/attempt completed |
| Claude keywords-only `ticket, platform, return`, sửa nghĩa gợi ý, tạo bài | PASS, `opus[1m]`, bài `A Return to Oxford`, 3 target, job/stage/attempt completed |
| SQLite, cold restart offline và làm sai rồi làm đúng | PASS cả hai; backup độc lập integrity OK, Codex 2 và Claude 4 practice attempts |
| Hủy gợi ý đang streaming của cả hai | PASS; đã nhận text thật trước hủy, giữ input, không thêm target đến muộn, hủy lần hai hoàn tất |
| Lỗi model không tồn tại qua UI và bridge của cả hai | PASS; catalog thật, error thật, thông báo tiếng Việt, input còn nguyên, nút thử lại dùng được |
| Runtime guard | PASS cả 5 ca, không có unexpected renderer/main errors; local-server discovery và lỗi chủ ý của ca negative được phân loại theo provenance |

Lượt này không bật hình/audio, đúng default của form tối giản. Hình native Codex và pipeline audio có evidence riêng ở goal trước; không nhận synthetic audio là TTS inference, không nhận text ACP là bằng chứng ACP sinh ảnh. API hồi quy: DeepSeek inference thật PASS; EnjoyAI, OpenAI, Gemini, OpenRouter và local servers chưa có inference thành công được xác minh trong goal này. Thiếu key/server không được ghi PASS. TTS EnjoyAI vẫn bị auth; muốn nghiệm thu giọng đọc thật cần cấu hình credential hợp lệ trong Dịch vụ AI rồi tạo và nghe một mẫu. Các khả năng phụ thuộc provider được giải thích trong UI và không chặn mở app local.

Package 6 đã mở từ Finder vào Ethan, chuyển bằng UI sang hồ sơ mới đã tạo ở lượt Finder trước, thoát hẳn và mở lại từ Finder vào Local. Không quan sát thấy login Enjoy hoặc hộp thoại Keychain của Enjoy. Model Claude `sonnet` ở hồ sơ mới vẫn được lưu qua restart. Sau đó đã khôi phục thư viện gốc bằng UI và để app mở tại hồ sơ Ethan. Bằng chứng mới: `finder-final-existing-home.png`, `finder-final-fresh-reopened-home.png`. Lượt Finder dùng kết nối hệ thống bình thường; offline được chứng minh riêng bằng cold restart của packaged E2E.

Đối chiếu cuối `live-data-final.json`: SQLite integrity OK; **27 bảng giữ nguyên từng row**. Hai bảng thay đổi có giải thích: `cache_objects` vẫn 18 rows với refresh cache, `user_settings` vẫn 7 rows và chỉ profile thêm `nameSource`. Mọi giá trị credential, DeepSeek config, GPT engine, TTS và recorder cũ giữ nguyên; thư viện chính đã trở về `/Users/ethan/Documents/EnjoyLibrary`.

Review phản biện auth/data, ACP và UX đã xử lý các finding ảnh hưởng acceptance. Root kiểm lại source và receipt cuối, đọc nội dung hai bài, kiểm SQLite backup thật và xem screenshots. Nghiên cứu mindmap đã hoàn tất, không thay renderer. Không commit, push hoặc deploy. Các lỗi lịch sử vẫn được lưu đúng trạng thái failed, không được dùng làm evidence PASS.

## Evidence trước goal mới

Cập nhật: 2026-09-07. [Báo cáo nghiệm thu](enjoy/docs/learning-studio-acceptance.md) là nguồn kết quả chi tiết. Native Codex/Claude text, mindmap, ảnh Codex, cancel, practice, micro vật lý và pipeline audio đã có runtime evidence. TTS thật chưa qua authentication, OmniVoice chưa bật; core DoD của goal native trước đó chưa hoàn tất vì TTS thật. Đây là trạng thái lịch sử, không thay thế ma trận local/ACP ở trên.

## Phạm vi

Branch `codex/learning-studio`, base `f21f4304ae45cf0f43acde3473f4ca824db9ed11`. Node 24.18.1, Yarn 4.6.0. Không commit, push, PR, merge hoặc phát hành.

Đối chiếu phạm vi ở thời điểm goal native trước: mười file có thay đổi YouTube trước task được kiểm theo snapshot `/tmp/enjoy-plan-original-files.json`: tám file byte-identical; `home.tsx` chỉ thêm catch cho remote suggested-channel config; `enjoy-app.d.ts` thêm learning bridge và DB lifecycle signatures. Sau khi loại riêng phần thêm của task, nội dung khớp snapshot. Evidence `enjoy/tmp/learning-acceptance/2026-09-07/original-scope-check.json`.

## Kết quả theo đơn vị

| Đơn vị | Trạng thái |
|---|---|
| U1/U4 Native connectors | Codex 0.153.2/0.153.4, Claude 2.1.263; existing CLI auth, MCP scoped, cancel/cleanup có bằng chứng thật |
| U2 Storage | SQLite/migration, immutable revisions, profile isolation; sửa lesson tạo image/audio slots mới nguyên tử, giữ lịch sử asset |
| U3 Jobs/MCP/IPC | Native generation, retry/cancel/poll, per-asset generation; failed `startAttempt` không để queued job chặn resource |
| U5 Story | Corpus 30/30 completed sau repair, 226 references hợp lệ, đã đọc thủ công; AE1 sáu target A2 riêng cũng PASS |
| U6 Studio/image | Native Codex image hiển thị trong packaged app; regenerate giữ hai variants và chọn lại bản cũ đã được kiểm |
| U7 Mindmap | Native Codex 12 nodes/11 edges, Claude 18 nodes/21 edges; graph layout và chọn target có kiểm tra riêng |
| U8 Audio | Factory/configured provider nối thật; synthetic MP3 pipeline/playlist/variants/restart/offline PASS; actual TTS bị `speech_auth` 401/403 |
| U9 Practice | Fixed grading, shuffled order, retell recording và physical microphone flow PASS; không chấm equality câu nói tự do |
| U10 OmniVoice | Chưa tải/chạy model, runtime/license/quality gated |
| U11 Package | Local signed package đã build; native và offline QA có artifact theo từng lượt trong báo cáo nghiệm thu |

## Cần giữ khi báo cáo

Corpus 30 là kết quả sau sửa, không phải first-pass success: lượt đầu tám preflight errors sau CLI tự update và 12 bài có fill answer lỗi. Original history giữ nguyên. Manual review không chứng nhận CEFR; bài tập từ phổ thông ở C2 có thể dễ hơn level.

Synthetic audio chứng minh provider dispatch, decode, storage và playback, không chứng minh speech inference. TTS thật cần đăng nhập lại Enjoy AI và nghe mẫu sau khi chạy thành công. Micro vật lý là evidence riêng, capture tạm đã cleanup.

Artifact thất bại được giữ đúng trạng thái. `packaged-final/` có generation/variant/offline assertions qua nhưng runtime guard failed vì bootstrap network rejection. Đã sửa catch và kiểm lại trên package mới; kết quả mới nằm riêng để không ghi đè lần thất bại.

[Capability matrix](enjoy/docs/agent-compatibility.md) và [acceptance report](enjoy/docs/learning-studio-acceptance.md) phân biệt runtime thật, fixture và gate còn mở.

## Kết quả native packaged cuối

Codex PASS 239,993 ms với image variants/reselect/restart/offline/fixed practice. Claude PASS ở lượt riêng 46.5 giây sau sửa test selector trùng title. Artifacts lần lượt `packaged-final-verified/` và `packaged-final-claude/`; giữ lịch sử lượt failed và generation receipts. Không dùng tình trạng một suite failed vì selector để phủ nhận generation đã hoàn tất, cũng không đổi suite đó thành passed.

Package signed verification, packaged DB/dictionary checks, TypeScript và lint phần task đều đạt. `final-verification.json` và `package-fingerprint.json` ghi evidence source/build.


## 2026-09-07: Trang sơ đồ học tự trình bày

Thay default renderer U7 từ canvas kéo thả sang trang sách HTML/SVG tự chia nhóm và phân trang. Form Mindmap mới nhận chủ đề và CEFR level, một submit tạo draft rồi gọi generation bằng revision ID trả về. MapBrief được lưu theo revision; metadata studyGroups và IPA bắt buộc với generation mới, vẫn đọc graph cũ. Ảnh nhóm dùng Codex native, composite source hash, slot/revision guards và asset pipeline hiện có.

Nghiệm thu: 4 packaged E2E PASS gồm Codex text + 3 native images, Claude text, cold restart offline và regression bài học/practice/audio. Sau khi sửa image crop, thu gọn cover và cải thiện bố cục, 3 E2E PASS trên final package với chính output AI đã lưu cùng sơ đồ cũ 40 node. TypeScript, scoped lint, backend SQLite checks và packaged native dependency verification đều PASS.

Dữ liệu thật đã được backup trước migration. So sánh sau migration: 27 bảng bằng nhau trên các cột cũ, thêm một migration và chỉ cập nhật timestamp một dòng cache; integrity_check ok. GUI cuối trên hồ sơ Ethan giữ một bài A Coffee Order và không có map thử nghiệm. Tất cả inference/fixture chạy trong profile riêng.

Báo cáo và giới hạn: [automatic-study-map-acceptance](docs/plans/2026-09-07-automatic-study-map-acceptance.md). Đây là phiên bản presenter hiện hành, thay phần mô tả graph kéo thả U7 phía trên. Không commit, push hoặc deploy trong task này.


## 2026-09-10: khép live gate Ollama/LM Studio và sửa JSON LM Studio

Build 10 sửa lỗi HTTP 400 của LM Studio: `jsonCommand` gửi `json_schema` theo đúng giao thức của provider này. Ollama vẫn dùng `format` native; các provider khác vẫn dùng `json_object`. Các field optional và kiểm tra Zod cuối luồng được giữ nguyên. Chỉ `enjoy/src/commands/json.command.ts` thay đổi trong 614 file đóng gói so với build 9; 613 file còn lại khớp hash.

Ollama `0.33.3` trên macOS và LM Studio `llmster 0.0.24+1` trong container Linux ARM64 đều PASS một tác vụ Story thật trên đúng build 10. Cả hai dùng Qwen2.5 1.5B từ cùng GGUF, trả đúng sáu từ `meticulous, botanist, catalogued, resilient, alpine, orchid` và `idioms: []`. UI hiển thị kết quả, SQLite giữ nguyên hash sau full restart offline, main/renderer có zero Enjoy attempt/operation. Đây là kiểm chứng một tác vụ đại diện, không phải đánh giá chất lượng tổng quát của model.

Playwright ghi nhận đúng endpoint, cổng, POST và HTTP 200; log server bổ sung request/response thật. Provenance dựa trên đối chiếu package, model đã chọn, inventory và log, không phải ràng buộc mật mã độc lập cho từng response. Listener offline được gắn sau khi helper restart hoàn tất; các request dò model GET do bước offline cố ý gây ra được giữ trong receipt. Không có lỗi unexpected theo classifier hiện có; expected local probes và lỗi HTTP 500/page error từ trang Audible bên ngoài vẫn được công bố.

Hai provider chạy bằng runtime/model miễn phí trong môi trường disposable. Server, container, image Ubuntu riêng, model tải thử, thư mục nhận diện Ollama vừa tạo và profile thử nghiệm đã được dọn. OrbStack đã trở lại `Stopped`; cấu hình LM Studio trên máy và hai image có sẵn được giữ nguyên. Bản Enjoy đang cài và thư viện thật không đổi.

Lượt LM Studio build 9 bị HTTP 400 vẫn giữ FAIL lịch sử. Hai lượt Ollama build 9 trước run3 bị lỗi instrumentation cũng không được nhận runtime PASS. Source contracts, TypeScript, lint và review độc lập đã kiểm bản sửa; cả hai provider được chạy lại trên build 10. Các kết quả ASR thật và fixture fallback vẫn mang provenance build 9; không tuyên bố đã gọi ASR mới trên build 10.

Bằng chứng: `local-providers-build10-summary.json`, `local-provider-live-independent-review.md`, `build10-production-delta.json`, `lmstudio-json-source-validation.json` và `local-provider-runtime-cleanup.json` trong thư mục evidence ngày 2026-09-10.

Còn mở: Gemini chưa có credential, human listening TTS, microphone vật lý và R9 (hai Azure keys cùng một Cloudflare tunnel token chưa rotate/revoke). Không commit/push/deploy, không thay app đang cài hoặc migrate thư viện thật. Quyền chuẩn bị local/disposable đã cho phép runtime/model miễn phí; nhận định cũ rằng thiếu quyền cài model là blocker tuyệt đối đã được sửa.


## 2026-09-10: kiểm lại cấu hình Gemini sau build 10

377 artifact trong evidence index vẫn khớp hash trước lượt này. Hai biến environment `GEMINI_API_KEY` và `GOOGLE_API_KEY` có giá trị khác nhau và đều đọc được metadata Gemini HTTP 200, có hai model quảng bá trong app. Chỉ gửi hai GET metadata, không inference, không ghi secret hay error body. Đây là bằng chứng mới sửa nhận định thiếu credential tuyệt đối; snapshot cũ vẫn thiếu credential như đã ghi.

Gemini chưa có live PASS: metadata không xác định billing tier, model hoặc nguồn key được user chọn. Cần lựa chọn đó trước generation vì goal cấm tự chọn provider trả phí. Human listening, microphone vật lý và R9 vẫn giữ nguyên. Bản build 10 và các kết quả provider đã có không bị thay đổi bởi lượt kiểm metadata.


Harness mới `enjoy/e2e/provider-gemini-text-live.spec.ts` đã có explicit opt-in/model/key-source, profile disposable, assertion output/UI/SQLite/offline/network và không tự retry. Trace/screenshot/video đều tắt, receipt success/failure che exact selected credential đệ quy. ESLint và skip-only Playwright đạt (1 SKIP, 0 executed). TypeScript E2E chưa có full PASS: config kiểm đúng global declarations cho test mới và baseline có cùng 13 lỗi shared helpers, không có diagnostic riêng trong test mới. Validation giữ command/cwd và comparison scope. Không production edit/rebuild: kiểm lại 614 source hashes và ASAR build 10 đều khớp. Không có Gemini inference trong lượt này.

Review độc lập của harness Gemini PASS cho trạng thái đã chuẩn bị, không có finding material; xem `gemini-harness-independent-review.md`. Parent đã đọc source, validation và review, giữ nguyên giới hạn chưa inference, type baseline-equivalent và offline observer.


## 2026-09-10: user chọn Vertex AI key

Credential mới được xử lý riêng theo xác nhận Vertex của user. GET publisher metadata trả 401 và được giữ như probe không thuộc Express supported methods. CountTokens trả 403 API_KEY_SERVICE_BLOCKED. Negative control generateContent bỏ contents bắt buộc cũng trả 403 cùng reason, xác nhận đúng service aiplatform.googleapis.com và PredictionService.GenerateContent. Không có input generation hợp lệ, không successful inference, không account/billing/key-restriction mutation.

Key vào file private 0600 ngoài repo qua stdin tắt echo, không có secret trong shell commands/output/evidence. Adapter hiện tại vẫn là Gemini Developer API. Worker read-only đã đề xuất provider vertex-express riêng để giữ binding/settings cũ, native JSON/cancel/stream và network guards; kế hoạch nằm ở vertex-adapter-integration-plan.md. Đây là chuẩn bị, chưa implementation hoặc live PASS. Exact external blocker và bước nhỏ nhất nằm ở vertex-key-status.md.

Cleanup Vertex đã xác minh: key file, receiver và thư mục private riêng đều được xóa; 8 artifact đã quét bằng exact key bytes có zero match. Không lưu key vào Enjoy hoặc Keychain.


## 2026-09-10: triển khai Vertex Express sau kiểm auth

Tiếp tục goal bằng phần không phụ thuộc credential: chọn provider ID vertex-express riêng, native REST qua existing network guard, settings/key riêng và model explicit. Worker transport sở hữu adapter/factory/json/contracts; worker settings sở hữu catalog/types/settings/i18n/provider-migration contracts; parent sở hữu E2E, package, tích hợp và review. Kế hoạch chi tiết: docs/plans/2026-09-10-vertex-express-implementation-plan.md. Trạng thái: implementation đang chạy, chưa pass source/package/live. Không retry key đang bị API_KEY_SERVICE_BLOCKED, không thay account/billing. Snapshot Build10 và 12 source files thuộc scope đã lưu trước khi worker sửa.


## 2026-09-10: hoàn tất Vertex Express và cấu hình Sellnity


Đã thêm provider `vertex-express` độc lập, setting `vertex_express`, endpoint cố định `https://aiplatform.googleapis.com/v1` và model phải chọn rõ ràng. Adapter dùng native REST cho text, history, JSON schema và SSE; từ chối input đa phương thức/tool chưa hỗ trợ. Finish reason chỉ `STOP` được coi là hoàn tất, MIME được giới hạn text/JSON và dừng iterator sẽ hủy reader/request. Contract 14 groups, AI runtime 23 cases, TypeScript và scoped lint PASS. Review độc lập đã kiểm ba bản sửa; contract không được tính là live inference.

Theo quyền user cấp, Google Cloud project `sellnity` đã có service account `enjoy-vertex-express@sellnity.iam.gserviceaccount.com` với duy nhất role `roles/aiplatform.expressUser`; key riêng `Enjoy Vertex Express` chỉ được gọi `aiplatform.googleapis.com`. IAM và API restrictions đã được đọc lại để xác minh persistence. Key `BiBung` giữ nguyên restriction Gemini API. Không thay billing hoặc role quản trị rộng.

`gemini-3.5-flash-lite` trả countTokens HTTP 200 và đã PASS một tác vụ Story thật trên bản ký `local-signed-build12`: native generateContent HTTP 200, đúng sáu từ `meticulous, botanist, catalogued, resilient, alpine, orchid`, `idioms: []`, UI hiển thị đủ và SQLite giữ nguyên hash sau full restart offline. Offline không có inference request; main/renderer có zero blocked operation và zero Enjoy operation. Không có runtime issue unexpected; bốn lỗi dò local model được phân loại expected vẫn giữ trong receipt. Đây là kiểm chứng một tác vụ đại diện, không phải benchmark chất lượng tổng quát hoặc live streaming acceptance.

Lượt run1 đã có HTTP 200 và output đúng nhưng dừng tại assertion sai về bộ đếm Node trước offline. Bộ đếm `observedRequests` chỉ do Node HTTP/Undici ghi, còn adapter dùng Chromium fetch. Harness đã sửa để dùng response Playwright với host/path/model/method/status và native JSON contract làm transport proof, đồng thời giữ các gate zero Enjoy/blocked của cả hai process. Run2 PASS 9.7 giây trên cùng ASAR. Không sửa production để vượt lỗi instrumentation, không sửa run1 thành PASS.

Cấu hình UI được kiểm riêng trên build 11 với credential fixture: Vertex lưu riêng, yêu cầu model explicit, Gemini settings/conversation/messages giữ nguyên digest qua full restart offline. Build 12 chỉ khác build 11 ở adapter; 614 file còn lại giữ nguyên. Bản build 12 khớp 615 source files, strict signature/stable designated requirement và package guard PASS; scan 16077 runtime files chỉ có sáu literal trong denylist. ASAR SHA-256 `1b5375ce71a3d802c3c6364d2b63d01588df05aa1efe04180f90d625d729846b`.

Spec bootstrap cũ vẫn FAIL lịch sử vì đòi nút opt-in, trong khi `home.tsx` đã có opt-out mặc định và được yêu cầu giữ nguyên. Hash file này giống nhau ở build 10/11/12. Settings test đã kiểm fresh offline home và restart riêng; không đổi thất bại của spec cũ thành PASS.

Key đầu tiên được tạo trong lượt cấu hình đã xuất hiện trong tool output do định dạng key mới không khớp bộ che tiền tố. Key đó đã bị xóa trước khi dùng và trạng thái xóa được xác minh. Key đang dùng là bản thay thế, không ghi giá trị vào tài liệu/log; đây là sự cố riêng đã thu hồi, không khép R9 Azure/Cloudflare còn mở. Profile thử đã được xóa. Phạm vi quét exact credential và cleanup file private được ghi riêng trong `vertex-authorized-private-cleanup.json`.

Bằng chứng: `vertex-cloud-change-status.json`, `vertex-live-build12-summary.json`, `vertex-settings-build11-summary.json`, `vertex-independent-review.md`, `vertex-transport-validation.json`, `vertex-settings-validation.json`, `vertex-live-harness-validation.json`, `build12-production-delta.json` và `vertex-bootstrap-baseline-mismatch.json`. Hướng dẫn người dùng: `docs/vertex-express-setup.vi.md`.

Gemini Developer API vẫn là adapter riêng, chưa có live inference được user chọn. Các kết quả provider cũ giữ nguyên build provenance. Không thay app đang cài, không migrate hồ sơ thật và không lưu key mới vào Enjoy thật hoặc Keychain.


Gemini harness được sửa tiếp sau phát hiện từ Vertex: bỏ yêu cầu bộ đếm Node phải tăng khi request dùng Chromium fetch. `chat-model.ts` đã chọn `globalThis.fetch` cho ChatOpenAI; vì vậy Playwright response đúng host/path/model/POST/HTTP 200 vẫn là bằng chứng transport bắt buộc. Các gate zero blocked/legacy của main và renderer cùng kiểm tra offline POST được giữ nguyên. Scoped lint và skip-only PASS (1 skipped, 0 executed), không đọc credential hoặc gọi inference; source app/build 12 không đổi. Type comparison 13 lỗi shared helpers là kết quả lịch sử trước chỉnh sửa assertion này, không được trình bày như lượt typecheck mới. Xem `gemini-harness-validation.json` và `gemini-harness-observer-review.md`.


## 2026-09-10: một request Gemini được user cho phép


Sau khi user cấp quyền đúng một request text với `GEMINI_API_KEY` và `gemini-3.5-flash-lite`, adapter Gemini đã PASS tác vụ Story thật trên `local-signed-build12`. Playwright ghi nhận một POST HTTP 200 tại `generativelanguage.googleapis.com/v1beta/openai/chat/completions`, đúng model đã chọn và không có query chứa credential. Output đúng sáu từ `meticulous, botanist, catalogued, resilient, alpine, orchid` cùng `idioms: []`; UI hiển thị đủ, SQLite giữ nguyên hash `6cabbd96f9456689d847c34a667f6d6b94558bfca416994289ef66b640458601` qua full restart offline. Offline không có Gemini inference; main/renderer zero Enjoy/blocked operation và không có runtime issue unexpected. Bốn lỗi local-model discovery expected được giữ nguyên trong receipt. Toàn bộ test PASS 9.2 giây.

Harness giới hạn trước egress đúng một POST để SDK không thể tự retry vượt quyền: admitted 1, blocked extra 0. Strict Playwright response là bằng chứng request qua Chromium; bộ đếm Node HTTP/Undici chỉ được lưu theo đúng phạm vi. Các gate Enjoy, output, UI, SQLite và offline giữ nguyên. Lint và skip-only đã kiểm trước live; type comparison 13 diagnostic shared helpers là evidence lịch sử, không tuyên bố E2E typecheck sạch.

Key chỉ lấy từ nguồn environment đã được user chọn và truyền vào profile disposable. Trace, screenshots và video đều tắt. Ba thư mục settings/library/Chromium đã được xóa; phép quét exact credential trên 1119 file evidence/source không có match. Không đổi environment credential gốc, Keychain, profile thật, source production hoặc bản build. Quyền một request đã được sử dụng hết; không tự chạy thêm request Gemini.

Đây là live acceptance cho một tác vụ text đại diện, tách biệt với Vertex Express trên cùng model name. Kết quả không phải benchmark chất lượng tổng quát. Bằng chứng: `gemini-live-build12-summary.json`, `gemini-live-private-cleanup.json`, `gemini-harness-validation.json`, `gemini-harness-observer-review.md`. Những probe metadata và harness skip trước đó là lịch sử chuẩn bị, không thay thế lượt live này.


## Human listening TTS đã xác nhận

User đã nghe hai output thật OpenAI và Azure, xác nhận cả hai đọc đủ câu “Cup. I have a cup of tea.”, rõ và không rè hoặc ngắt mất lời. Hai file nghe khớp SHA-256 trong receipt live gốc; nguồn OpenAI là historical package 8, nguồn Azure là speech-final. Đây là human listening PASS cho hai mẫu đó, không phải lượt TTS mới trên build 12. Bằng chứng và lời xác nhận: `human-listening/manifest.json`. Còn mở: Azure assessment bằng microphone vật lý và R9 hai Azure keys/Cloudflare tunnel token chưa xoay.


## R9: user tự xử lý credential

User chỉ định: “Không cần xoay. Tôi tự xử lý”. Theo phạm vi mới, assistant dừng phần xoay credential; việc xử lý hai Azure keys và Cloudflare tunnel token thuộc user. Đây không phải xác minh key/token đã thu hồi và không xóa sự cố khỏi báo cáo. Không tiếp tục coi quyền xoay credential là việc đang chờ assistant thực hiện. Bằng chứng: `r9-user-owned-handoff.json`.


## 2026-09-10: Pixel speaker to XVF3800 physical acceptance

Theo yêu cầu user, dùng ADB phát đúng WAV Azure TTS đã khóa hash trên Pixel 10 Pro XL qua loa thật, thu bằng production RecorderButton trong Enjoy build 12 qua XVF3800. Lượt đầu PASS 30.1 giây, 7 từ/15 phoneme, điểm 74.8/84/71/77; MP3 11.664 giây và SQLite giữ hash qua full restart offline. Zero Enjoy/blocked operations; actual speaker port 3 và actual getUserMedia device label đã xác minh. Không phải giọng người học; giữ điểm chưa hoàn hảo và Mispronunciation thực tế.

E/physical-microphone-build12-summary.json, E/physical-microphone-private-cleanup.json và E/pixel-xvf-20260910T084946Z/ giữ receipt/MP3/screenshot. E là .superpowers/sdd/2026-09-10-azure-models. Key private, coordination và file thử Pixel đã xóa; exact Key1 scan 1106 files không match, không gọi đó là R9 revocation. User đã nhận tự xử lý credential, assistant không rotate. 615 source files và ASAR build12 giữ nguyên. Không commit/push/deploy/install app thật hoặc migrate profile thật.


Review cuối không còn finding actionable. Harness tái sử dụng đã được gia cố sau lượt live: chờ trạng thái recorder production, kiểm nội dung/thời gian ACK, khóa expected ASAR và buộc lỗi nếu thiếu bằng chứng thiết bị. Đây là validation source-only; archived spec `d2a522...` và wrapper `83c912...` vẫn là provenance của lượt live PASS. Source app không đổi và không phát sinh thêm inference. Audit toàn goal: `goal-final-build12-audit.md`; trạng thái kỹ thuật/chức năng và bàn giao local PASS, R9 giữ historical FAIL/user-owned/unverified.
