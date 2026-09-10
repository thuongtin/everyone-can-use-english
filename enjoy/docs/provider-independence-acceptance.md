# Nghiệm thu loại bỏ backend Enjoy

Trạng thái cập nhật 2026-09-10: bản mới nhất là `local-signed-build12`, khớp 615/615 file nguồn, strict signature và package guard PASS. Ollama và LM Studio PASS tác vụ Story thật trên build 10. Cloudflare và hai Azure long ASR vẫn giữ bằng chứng PASS của build 9. Azure assessment qua Pixel/XVF3800 và offline persistence đã PASS build 12; human listening đã được user xác nhận, R9 được bàn giao cho user tự xử lý. Các yêu cầu kỹ thuật/chức năng và bàn giao local đã hoàn tất; R9 giữ sự cố lịch sử và follow-up do user sở hữu, không được tính là secret handling PASS. P1 về tích hợp nhánh fallback đã được khép bằng bằng chứng phân lớp. Kế hoạch: `docs/plans/2026-09-09-001-refactor-remove-enjoy-backend-plan.md`.

Bootstrap, Stories/Vocabulary, chat/text, ASR, TTS và đánh giá phát âm dùng local data hoặc provider trực tiếp. Client Enjoy, sync/upload, cloud-only surfaces và telemetry cũ đã gỡ. Lựa chọn legacy chuyển sang `needs-selection`; giữ custom config/prompt và historical provenance, không tự chọn provider trả phí. Mọi migration/runtime check dùng bản sao hoặc profile disposable; không thay thư viện thật, app đang dùng, commit, push hoặc deployment.

## Trạng thái hiện tại trên bản ký local

Evidence mới: `.superpowers/sdd/2026-09-10-azure-models/`. ASAR hiện tại `local-signed-build12`: `1b5375ce71a3d802c3c6364d2b63d01588df05aa1efe04180f90d625d729846b`. Historical build 10 của hai provider local giữ ASAR `e937f2c375410a7ea7a3e4c8dacae5195d6a798756eefb0b829b25ad8cddfdcc`. Build 5 đã chứng minh safeStorage giải mã ciphertext qua rebuild cùng designated requirement; Keychain cũ không còn là blocker hiện tại.

| Gate | Trạng thái hiện tại |
|---|---|
| G1 | Build 12 source match 615/615, strict signature, stable DR và package guard PASS; scan 16077 runtime files chỉ còn 6 literal denylist |
| G2 | Build 5 migration/idempotency, rollback exact SHA/schema/95 rows và fresh/multi-profile PASS |
| G3 | Contracts, TypeScript, lint phần đổi, validator/map/seam regressions và review độc lập PASS; giữ toàn bộ quality thresholds |
| G4 | Build 5 idle 600000 ms, online/offline/reconnect/full restart, positive/negative controls PASS; zero Enjoy attempt/operation. Các delta sau đó thuộc validator, Azure map prompt, ASR seam planning và định dạng JSON riêng cho LM Studio, không đổi network/storage |
| G5 | Azure lesson+narration build 6 và cafe map build 7 run2 có live/offline proof, output đã được đọc. Build 9 Azure MAI/Fast long và Cloudflare long PASS quality, full UI và offline hash. Ollama/LM Studio Story live, UI, SQLite và offline restart PASS build 10. Vertex Express Story live/UI/SQLite/offline PASS build 12. Gemini Story live/UI/SQLite/offline PASS build 12; human listening TTS đã được user xác nhận; loa Pixel/microphone XVF3800, Azure score/phoneme, UI/SQLite/offline PASS build 12 |
| G6 | Fresh Nuxt build từ cache/output trống PASS; Chrome headed: 48/48 HTTP 200, SSR/hydration/ảnh/CSS, zero Enjoy PASS. Desktop dictionary prepare hook từ cache trống PASS. Public GitHub docs vẫn phiên bản đã publish cũ; chưa push/deploy |
| G7 | PASS phạm vi bàn giao local: exact source/package, index và review độc lập; các provider/physical gates đã có evidence. Natural fallback vẫn là giới hạn đã công bố; R9 historical FAIL do user tự xử lý, chưa xác minh thu hồi |

## Provider local trên bản ký build 10

Build 10 sửa lỗi HTTP 400 của LM Studio: `jsonCommand` gửi `json_schema` theo đúng giao thức của provider này. Ollama vẫn dùng `format` native; các provider khác vẫn dùng `json_object`. Các field optional và kiểm tra Zod cuối luồng được giữ nguyên. Chỉ `enjoy/src/commands/json.command.ts` thay đổi trong 614 file đóng gói so với build 9; 613 file còn lại khớp hash.

Ollama `0.33.3` trên macOS và LM Studio `llmster 0.0.24+1` trong container Linux ARM64 đều PASS một tác vụ Story thật trên đúng build 10. Cả hai dùng Qwen2.5 1.5B từ cùng GGUF, trả đúng sáu từ `meticulous, botanist, catalogued, resilient, alpine, orchid` và `idioms: []`. UI hiển thị kết quả, SQLite giữ nguyên hash sau full restart offline, main/renderer có zero Enjoy attempt/operation. Đây là kiểm chứng một tác vụ đại diện, không phải đánh giá chất lượng tổng quát của model.

Playwright ghi nhận đúng endpoint, cổng, POST và HTTP 200; log server bổ sung request/response thật. Provenance dựa trên đối chiếu package, model đã chọn, inventory và log, không phải ràng buộc mật mã độc lập cho từng response. Listener offline được gắn sau khi helper restart hoàn tất; các request dò model GET do bước offline cố ý gây ra được giữ trong receipt. Không có lỗi unexpected theo classifier hiện có; expected local probes và lỗi HTTP 500/page error từ trang Audible bên ngoài vẫn được công bố.

Hai provider chạy bằng runtime/model miễn phí trong môi trường disposable. Server, container, image Ubuntu riêng, model tải thử, thư mục nhận diện Ollama vừa tạo và profile thử nghiệm đã được dọn. OrbStack đã trở lại `Stopped`; cấu hình LM Studio trên máy và hai image có sẵn được giữ nguyên. Bản Enjoy đang cài và thư viện thật không đổi.

Lượt LM Studio build 9 bị HTTP 400 vẫn giữ FAIL lịch sử. Hai lượt Ollama build 9 trước run3 bị lỗi instrumentation cũng không được nhận runtime PASS. Source contracts, TypeScript, lint và review độc lập đã kiểm bản sửa; cả hai provider được chạy lại trên build 10. Các kết quả ASR thật và fixture fallback vẫn mang provenance build 9; không tuyên bố đã gọi ASR mới trên build 10.

Bằng chứng: `local-providers-build10-summary.json`, `local-provider-live-independent-review.md`, `build10-production-delta.json`, `lmstudio-json-source-validation.json` và `local-provider-runtime-cleanup.json` trong thư mục evidence ngày 2026-09-10.

## ASR dài trên build 9

Cùng audio 722.512125 giây, source SHA `07fc9a801db549f5b95da1153115a97b7bbd9e48844c317462157a3ceaa08ec4`, reference TED 1744 normalized tokens. WER threshold <= 20% giữ nguyên.

| Provider | Pipeline | WER | Timeline | Request thật |
|---|---|---|---|---|
| Azure MAI | 103.966s | 26 edits, 1.4908% | 96 câu, 1739 từ | 25 |
| Azure Fast | 45.788s | 23 edits, 1.3188% | 104 câu, 1740 từ | 1 |
| Cloudflare Whisper | 79.527s | 24 edits, 1.3761% | 111 câu, 1733 từ | 1 |

Cả ba PASS source/text coverage, timestamp, speech-gap, UI duyệt toàn bộ câu/từ và full-result SHA sau offline restart. Main/renderer không có Enjoy attempt/operation hoặc retired observation. Source và profile snapshot của Cloudflare giữ nguyên hash. Đây là số liệu một mẫu, không phải benchmark hoặc chứng nhận chất lượng mọi audio/ngôn ngữ.

Cloudflare build 9 thành công ngay whole alignment, nên lượt live này không đi qua fallback prefix. Bản sửa build 9 có evidence source/regression riêng: chỉ first resumed window dùng corridor độ rộng chuẩn quanh midpoint của actual overlap; cùng effective boundary đi xuyên initial merge, bridge audio, repair split và failure range. Normal windows không đổi. Vùng dư ngoài corridor được giữ từ selected prefix/continuation, còn full-source coverage tiếp tục kiểm sau merge. Không được gọi live whole-path PASS là bằng chứng nhánh fallback đã chạy.

Lịch sử: Cloudflare build 7 run4 có lỗi local chọn gap 0.915s, đã sửa build 8. Build 8 vẫn FAIL 665.945-695.945s; checkpoint và real offline aligners xác nhận whole-tail alignment sụp, cùng seam recovery bị content/timestamp gate từ chối. Không nới gate và không sửa failed receipts. `build9-production-delta.json` ghi đúng chỉ `service.ts` đổi từ build 8.

Replay offline dùng đúng checkpoint Cloudflare build 8 đã đi qua frozen `service.ts` build 9: fallback merge tạo 1733 từ với hash khớp probe, production word validation PASS và real timeline builder tạo 110 entries. Replay tổng vẫn FAIL vì offline harness từ chối request cho một provider range chưa được lưu. Node harness dùng raw `findUncoveredSpeech`, thiếu lớp Electron `createMusicAwareSpeechCoverage(classifyInstrumentalGaps)` của app, nên intro music bị báo gap. Đây là giới hạn của phép replay, không phải full coverage hoặc packaged fallback PASS. MP3 gốc không còn nên whole envelope được gắn qua replay-fixture key; không chứng minh native cache-hit. Không thay provider text, không dùng reference trong runtime, không network/paid call. Xem `replay-build8-checkpoints-on-build9.md` và receipt tương ứng.

Dọn private fixtures đã hoàn tất: key file dùng cho test, reference TED đầy đủ, ba capture Cloudflare và private alignment logs đã xóa; scratch replay cũng đã được xác minh xóa. Phép quét trước cleanup kiểm 1517 file bằng bytes của một Azure key đã biết, không có plaintext match. Phạm vi và hash từng file nằm trong `final-private-fixture-cleanup.json`; không bao gồm key Azure thứ hai chưa giữ lại, tunnel token hoặc tool-output history. Đây không phải chứng nhận R9 đã khép. Raw checkpoints đã xóa nên replay lịch sử hiện chỉ còn script và metadata/hash chứng minh lượt đã chạy.

R9: hai existing Azure keys xuất hiện trong output công cụ do aria-label của Portal; một lệnh inventory process sau đó đưa Cloudflare tunnel token vào output. User đã được báo cả hai. UI Azure đã che lại, broad process/env inspection đã dừng; incident receipts không chứa raw values. User đã chỉ định tự xử lý việc xoay/revoke; assistant không tiếp tục thực hiện phần này. Xóa fixture local không khép exposure.

## Kiểm chứng nhánh fallback trên đúng build 9

Hai ca fixture cuối đều PASS trên cùng ASAR đã ký: whole control 6.6s và fallback 19.8s. Audio tổng hợp 97 giây dùng hai đoạn JFK đã khóa hash, đặt tại giây 45 và 85, cùng phần nhạc mở đầu. Whole control chỉ nhận một response fixture. Ca fallback nhận đúng whole rồi `window-1`, không gọi window 0, giữ prefix đã align thật và tạo đủ 2 câu/44 từ. Các kiểm tra source/text coverage, timestamp, speech-gap, actual YAMNet và cleanup đều PASS. Nhạc 0.12-3.6s được YAMNet thật phân loại qua 7 windows; log cuối không có native fatal.

Đây là kiểm thử provider boundary bằng dữ liệu tổng hợp: `actualProviderInference=false`. Alignment, seam merge, validation, timeline và music-aware coverage là code production của đúng build 9. Hai ca không kiểm UI/persistence riêng và không thay bằng chứng ba lượt ASR thật. Review độc lập chấp nhận khép P1 về tích hợp đầy đủ nhánh fallback khi đối chiếu thêm Cloudflare build 9 live whole và historical CF8 partial merge. Natural fallback từ response provider thật trên exact build 9 vẫn chưa được quan sát; tiêu chí gốc không yêu cầu mọi nhánh lỗi phải tái hiện tự nhiên.

Lịch sử fixture được giữ: run1 lỗi manifest phần lời cắt, run2 offline chặn classifier loopback, run3/4 gặp speech gap trong nguồn lặp nhiều đoạn. Fallback run1 tạo kết quả đúng nhưng có native fatal sau phép đo VAD phụ ngoài app, nên không nhận runtime-health PASS. Bỏ phép đo phụ trùng lặp, giữ toàn bộ kiểm tra production rồi chạy lại cùng hai ca cho kết quả sạch. Xem `packaged-fallback-final-summary.json` và `packaged-fallback-independent-review.md`; không sửa failed receipts thành PASS.

## Azure long ASR trên build 8

Affected regression build 8 PASS cả hai: MAI 99.373 giây, Fast 47.506 giây. WER vẫn là 1.5482% và 1.3188%; source/text/timestamps/speech-gap checks, toàn bộ UI timeline và offline result hash đều PASS. Có 25/1 request Azure thật và zero Enjoy operations. Reference và source hashes giống build 7. Xem `azure-long-build8-summary.json` và `azure-long-build8.log`; kết quả build 7 bên dưới giữ provenance riêng.

## Azure long ASR trên build 7

Hai ca run3 đều PASS trên cùng audio 722.512125 giây và reference TED độc lập gồm 1744 normalized tokens. MAI: 97.551 giây, 25 Azure requests, 96 câu/1739 từ, 27 edits, WER 1.5482%. Fast: 45.606 giây, 1 Azure request, 104 câu/1740 từ, 23 edits, WER 1.3188%. Đây là thời gian pipeline của một mẫu, không phải benchmark tổng quát.

Coverage đầy đủ, text/timestamps/speech-gap đều PASS. Sau full restart offline, SQLite giữ SHA-256 của toàn bộ result và UI duyệt đủ từng câu/từ bằng normal click. Main/renderer không có Enjoy attempt/operation; runtime guard PASS. Không dùng kiểm đếm DOM hiện tại để suy rằng toàn bộ timeline đã render. Các lượt failed trước do harness vẫn được giữ, gồm metadata OOM, selector timeout và giới hạn danh sách ảo.

## Trạng thái lịch sử trước bản ký local

| Gate | Trạng thái | Evidence và giới hạn |
|---|---|---|
| G1 Source/bundle | PASS package 12 | 585 source/config files khớp build; 68 compiled files chỉ còn 6 retired-domain literals trong denylist main/renderer. So package 10 chỉ đổi SDK runtime dependency và Azure cleanup |
| G2 Migration | PASS package 10 | Legacy migration, idempotent restart, storage rollback exact SHA/schema/95 rows; fresh profile và hai profile cùng library giữ row/file/settings riêng qua reconnect/switchback/restart |
| G3 Contracts | PASS phần thay đổi | Policy, selection/migration, AI cache, local study, profile lifecycle, ASR, speech, Azure optional-reference, native proxy và YouTube lifecycle. TypeScript PASS; lint lỗi phát sinh đã sửa, baseline errors giữ nguyên |
| G4 Packaged desktop | PASS theo phạm vi package 8/9/10/12 | Package 9 core 8/8, idle 600000 ms; package 10 affected checks PASS 7 + AE2 1 riêng. Package 12 Azure live/offline restart và hai regression checks PASS. Negative controls tách riêng; native/image 6/6 package 8 |
| G5 Provider live | Một phần PASS | Azure TTS/assessment PASS package 12; Cloudflare ASR PASS package 10. Text ba adapters PASS package 9. Native, image, OpenAI TTS, OpenAI/MAI ASR PASS package 8. Tại mốc lịch sử này chưa kiểm Gemini/Ollama/LM Studio; hai provider local đã được bổ sung ở build ký local 10 |
| G6 Portal | PASS local build/browser | Static build/browser không attempt Enjoy; external subresources bị chặn theo receipt; chưa deploy |
| G7 Bàn giao | PASS với giới hạn ghi rõ | Exact source/package manifest, evidence index và review độc lập; AE2 explicit rebind cùng conversation PASS package 10. Goal chưa complete vì G5 còn live blockers |

## Provider thật và chất lượng output

| Provider/capability | Kết quả | Evidence và giới hạn |
|---|---|---|
| DeepSeek text | PASS package 9 | `deepseek-v4-flash`, HTTP 200, Story extraction SQLite/UI ổn định qua restart |
| OpenAI text | PASS package 9 | `gpt-4o`, HTTP 200, extraction/persistence/restart. Lượt 8 failed Chromium cache được giữ nguyên |
| OpenRouter text | PASS package 9 | `openai/gpt-4o-mini`, HTTP 200, extraction/persistence/restart |
| Codex/Claude native | PASS package 8 | Full lesson/MCP, fixed practice sai rồi đúng, restart offline, cancellation và unavailable model qua UI/bridge thật |
| Codex native image | PASS package 8 | Text + image qua native, PNG 1370x1148, 2300256 bytes; metadata/hash và render giữ qua offline restart; parent đã xem ảnh |
| OpenAI TTS | PASS package 8 | `gpt-4o-mini-tts`/`alloy`; audio thật, HTML playback, hash/asset qua restart. MAI nhận lại đúng 7/7 từ, WER 0 |
| OpenAI ASR | PASS package 8 | `whisper-1`, short/long, mẫu 722.512 giây, 111 câu/1735 từ; timeline/restart/counters PASS. WER so transcript TED 1.1468% |
| MAI ASR | PASS package 8 | `microsoft/mai-transcribe-2` qua OpenRouter, mẫu dài 722.512 giây; 24 requests, 299026 ms; timeline/restart/counters PASS. WER so transcript TED 1.6055% |
| Gemini text | PASS local-signed-build12 | Một request được user cho phép, gemini-3.5-flash-lite, đúng sáu từ, UI/SQLite/offline, zero Enjoy và cleanup |
| Ollama, LM Studio | PASS local-signed-build10 | Qwen2.5 1.5B, Story extraction đúng sáu từ, UI/SQLite/offline restart và cleanup; LM Studio qua llmster container riêng |
| Azure TTS/assessment | PASS package 12 | Tài nguyên có sẵn `tinopenai`, `eastus`; JennyNeural tạo WAV 160844 bytes/3.35 giây. Nhận đủ 7 từ, 15 phonemes; scores/UI và WAV giữ nguyên hash qua restart offline; hai WebSocket HTTP 101 tới TTS/STT |
| Cloudflare ASR | PASS package 10 | Production giải mã cấu hình đã lưu trên profile copy; mẫu JFK 11 giây, 22/22 từ, WER 0, timeline/UI/restart PASS. Một request thật, không có request tới Enjoy retired |

Ba text cases dùng nút trích xuất Story, production command/factory và SQLite thật. Input kiểm tra chứa sáu từ `meticulous, botanist, catalogued, resilient, alpine, orchid`; các output đã đọc cho đúng sáu từ và `idioms: []`. Đây là mẫu nhỏ, không chứng minh mọi command/ngôn ngữ.

Parent đã đọc hai native lessons package 8, `Anna Orders a Coffee` và `A Return to London`: targets, nghĩa tiếng Việt và đáp án nhất quán. Heuristic sentence length còn cảnh báo 19/26 từ so hướng dẫn 18, được giữ nguyên; không chứng nhận CEFR. Ảnh `A Quiet Cup of Tea` có người cầm cốc xanh bằng hai tay, cửa sổ mưa và điện thoại trên bàn đúng scene. Underlying image model không được expose độc lập ngoài provenance native request.

Long WER dùng 1744 normalized tokens từ [transcript TED chính thức](https://www.ted.com/talks/robbie_schingler_how_satellites_and_ai_can_protect_the_planet), cùng audio SHA-256. Đây là transcript published có biên tập, không phải human annotation của từng âm thanh; khác biệt số chữ/số và tách từ vẫn tính vào WER. `long-asr-reference-audit.json` giữ source URL/hash, normalization, S/D/I và caveats, không lưu toàn bộ transcript. Runtime receipts gốc không bị sửa để nhận là đã tự đo accuracy. TTS cross-check chỉ chứng minh word content, chưa chứng minh naturalness hoặc loa vật lý.

Package 9 sửa hai Story UI files; package 10 sửa ba file form/handler conversation. Speech/native package 8 và text package 9 có provenance riêng. Không tuyên bố đã chạy lại inference hoặc idle 10 phút trên package 10; đối chiếu manifest xác nhận các module provider/network không đổi. Package 10 chạy lại migration, local Stories/Vocabulary, Story error/retry, transport controls, legacy assets và AE2.

## Kiểm thử Azure và Cloudflare ngày 2026-09-10

Đã lấy key của tài nguyên Azure có sẵn qua trình duyệt đăng nhập, không tạo resource hoặc xoay key. Cấu hình được lưu bằng production `safeStorage` trong profile disposable. Các receipt của lượt này không chứa khóa; sự cố output chẩn đoán phát sinh ở lượt tiếp theo được ghi rõ trong mục R9 phía trên. Dữ liệu profile thật không đổi.

Azure package 12 PASS 11.8 giây: audio WAV phát được trước/sau restart offline, SHA-256 `b21e451b471374b9678192d29b94cecbffecadec3f041ab78c011d502c0171f5`; assessment JSON giữ nguyên hash, UI card xuất hiện lại. Main quan sát hai request và hai WebSocket HTTP 101 đúng hostname Azure, main/renderer retired counters đều 0. Đây là mẫu giọng tổng hợp dùng kiểm tích hợp, không phải hiệu chuẩn điểm phát âm người thật. Điểm 76.4 được giữ nguyên; Azure đánh dấu từ `cup` đầu tiên là Mispronunciation với accuracy 16, dù lexical transcript đủ 7/7 từ. Không khẳng định naturalness hoặc loa vật lý đã kiểm.

Hai lỗi production được phát hiện bằng live test và sửa: Vite inline SDK khiến timeout trước request đầu tiên, nên chuyển SDK sang runtime dependency để giữ module Node nguyên bản; cleanup 250 ms ngắn hơn callback thực đo 543 ms, nên Azure dùng bound 5 giây và chỉ trả success sau cleanup. HTTP cleanup vẫn 250 ms. Hủy trong lúc cleanup vẫn trả cancellation sau khi đóng xong. 18 deterministic cases và review độc lập PASS.

Cloudflare package 10 PASS 10.6 giây: model `@cf/openai/whisper-large-v3-turbo`, request thật tới Worker đã cấu hình, không retry/resume. Transcript khớp 22 từ tham chiếu; một câu/22 từ render lại sau restart. Original snapshot/audio giữ nguyên hash. Evidence này là mẫu ngắn, không được gọi là lượt long-audio mới.

Package 12 chỉ đổi hai source/config files so package 10. Source/package match, SDK external import và hai regression checks cho local Stories/Vocabulary cùng transport controls PASS 7.6 giây. Không chạy lại paid text/native/OpenAI/MAI hoặc idle 10 phút; giữ provenance của các package trước.

## Lỗi runtime và review đã xử lý

- TTS chưa cấu hình từng trả `null` làm Chat/Copilot crash; thêm sentinel không thực thi.
- Async settings/ASR và cache có thể vượt profile/provider/model context; thêm generation/connection identity, cancellation và scoped cache keys.
- Azure SDK từ chối `referenceText=undefined`; chuẩn hóa optional reference thành chuỗi rỗng.
- HTML local có canonical Enjoy URL từng bị từ chối lưu; giữ provenance, loại URL tải và giữ dedup.
- YouTube scrape race giữa load events/Promise; sửa settlement/cleanup và offline guards.
- Needs-selection tạo Select.Item model rỗng làm crash Settings; lọc empty option.
- Card media local bị báo mất tệp khi chỉ cover retired; tách source/cover state, giữ timestamps.
- Prompt Story dùng `idiom` trong khi strict Zod bắt buộc `idioms`; sửa JSON prompt, không nới schema.
- Claude 2.1.266 chưa có trong exact allowlist; thêm đúng patch version, giữ pinning/security checks.
- Story chưa trích xuất hoặc request failed từng hiện spinner vô hạn; package 9 tách idle/busy/error/retry, thông báo lỗi generic không lộ provider response.
- AE2: mở provider selector cho conversation legacy, gửi/validate engine + model trước mutation, giữ custom config/provenance, await persistence. Package 10 cùng conversation chuyển từ EnjoyAI sang OpenAI/gpt-4o-mini bằng UI; toàn bộ messages giữ nguyên SHA-256. Invalid retired binding bị từ chối, row/history nguyên; update không truyền engine giữ provider hợp lệ. Test này offline và không inference.
- G2 bổ sung storage rollback và fresh/multi-profile runtime; reviewer rút nghi ngờ duplicate ID vì production dùng database riêng.

## Evidence index

Evidence lịch sử nằm tại `.superpowers/sdd/2026-09-09-remove-enjoy-backend/`; bộ mới từ build ký local và provider build 10 nằm tại `.superpowers/sdd/2026-09-10-azure-models/`. Hai tên `package-10` lịch sử và `local-signed-build10` là hai bản khác nhau, có manifest/ASAR riêng. Canonical index được đồng bộ giữa hai thư mục.

- `baseline-manifest.json`, `baseline-owned-source.tar.gz`, `task-change-manifest.json`: baseline dirty work và delta của riêng lượt này.
- `legacy-profile-copy-receipt.json`, `legacy-profile-original.sqlite`: snapshot nhất quán; source SHA giữ nguyên sau các test; permissions hạn chế.
- `package-8-source-manifest.json`, `package-8-bundle-scan.json`, `package-8.log`: provenance build 8.
- `package-9-source-manifest.json`, `package-9-source-match.json`, `package-9-bundle-scan.json`, `package-9.log`: package của full 10-minute core và ba text cases.
- `package-10-source-manifest.json`, `package-10-source-match.json`, `package-10-bundle-scan.json`, `package-10.log`: package migration/AE2 và Cloudflare, ASAR SHA-256 `52cbbfbd6af4c46895a2656e345a11036d52fa8936e97295510e34e1b955192c`.
- `e2e-package-9-core-2.log`: 8/8 PASS, 10.6 phút, normal Enjoy attempt/operation counters 0 và observed retired requests 0 trong cả bốn phase.
- `e2e-package-10-affected.log`: 7 PASS/1 FAIL vì negative-control log chưa được phân loại; `e2e-package-10-legacy-conversation-3.log`: AE2 PASS 5.3 giây sau sửa test-only. Không gọi riêng suite đầu 8/8 PASS.
- `e2e-package-8-core.log`: 7/7 PASS; `e2e-package-8-profiles-2.log`: fresh/two-profile 1/1 PASS. Rollback kiểm storage restore, không khẳng định boot binary cũ.
- `e2e-package-8-native.log`: 6/6 PASS gồm hai providers và một Codex image.
- `e2e-package-8-openai-long.log`, `e2e-package-8-mai_transcribe-long.log`, `e2e-package-8-openai-short-speech.log`, `e2e-package-8-mai-short-tts-content.log`: speech/ASR thật.
- `e2e-package-9-{deepseek,openai,openrouter}-text-2.log`: ba text adapters PASS; `e2e-package-9-story-state.log`: idle/error/retry PASS, lần retry thứ hai có failure event riêng.
- `output-quality-review.json`, `long-asr-reference-audit.json`: bounded output review và published-reference WER.
- `lint-task-delta-package7-comparison.json`, `lint-new-error-fixes-comparison.json`: 101 errors ban đầu gồm 74 baseline và 27 mới; đã sửa 27 mới. Không tuyên bố toàn repo lint sạch.
- `portal-build.log`, `portal-network.json`, `portal-local.png`: local portal evidence.
- `package-12-source-manifest.json`, `package-12-source-match.json`, `package-12-bundle-scan.json`, `package-12.log`, `package-12-check.log`: historical package, ASAR SHA-256 `f5be14bb4a162af7f7c084c292bb04f5eef019ea73174bf3e3a27c8fd11ad77a`.
- `e2e-package-12-azure-0910-2.log`, `azure-output-quality-review.json`: Azure TTS, assessment, WebSocket và offline persistence PASS.
- `e2e-package-10-cloudflare-0910.log`: Cloudflare short ASR, reference accuracy và persistence PASS.
- `e2e-package-12-regression.log`, `azure-narration-final.log`, `azure-cleanup-independent-review.md`: bounded regression và independent review.
- `azure-sdk-node20-bundled.json`, `azure-sdk-node20.json`, `azure-sdk-close-duration.json`: đối chứng bundle timeout và phép đo cleanup.
- `local-provider-readiness-2026-09-10.json`: local provider blockers đã kiểm lại.
- `package-final-evidence-index.json`: index trạng thái/provenance và giới hạn cuối.

Lượt package 9 đầu bị sai `ENJOY_E2E_APP_PATH` do trỏ vào executable thay vì app bundle; không launch/inference, logs giữ nguyên và chạy lại dưới hậu tố `-2`.

Package 10 AE2 có hai lượt failed harness: log của IPC rejection được cố ý tạo trong negative control, rồi selector trùng model. Lượt cuối chỉ consume đúng signature sau assertion rejected/unchanged và scope selector vào header, không sửa shared runtime guard hoặc source app.

Giữ nguyên failed logs các package cũ, gồm YouTube lifecycle, empty model option, fixture format và Chromium cache lỗi ở OpenAI text package 8. Package 7 core có 5 PASS/1 SKIP, legacy asset PASS ở lượt riêng. Không đổi các kết quả đó thành full-suite PASS.

## Phạm vi bàn giao còn lại

Các provider và phép thử vật lý đã có receipt PASS với giới hạn theo từng mẫu. Bản đang cài và website public chưa được thay vì ngoài phạm vi đã cấp quyền.
Credential Azure/Cloudflare: user đã chỉ định tự xử lý. Đây là follow-up do user sở hữu, không còn là bước assistant chờ quyền để thực thi; chưa xác minh thu hồi.

Nhánh fallback-prefix đã có complete packaged branch proof bằng fixture, actual local alignment và music-aware coverage. Natural fallback trong một fresh live-provider run vẫn chưa quan sát; giới hạn này không được đổi thành live PASS.

Các probe localhost từ chối kết nối lúc 05:42 UTC là bằng chứng lịch sử về thiếu runtime. Sau đó, runtime và model miễn phí được chuẩn bị trong môi trường disposable, và cả Ollama/LM Studio đã qua live acceptance build 10. Các endpoint thử nghiệm hiện đã đóng sau cleanup; điều này không làm mất kết quả đã kiểm và không có nghĩa cấu hình người dùng đã được cài sẵn. Phép thử vật lý hiện đã PASS; R9 được giữ là sự cố lịch sử và follow-up do user sở hữu.

## Giới hạn quan sát mạng

`blockedAttemptCount` và `legacyBackendOperationCount` là bộ đếm trước egress, độc lập với traffic observation. Main và renderer có provenance riêng. Node `diagnostics_channel` quan sát HTTP/HTTPS và Undici request construction theo hostname, không ghi credential và không được gọi là packet capture. Loopback positive controls phải chứng minh observer nhìn thấy request thật trước khi diễn giải số zero.

Probe `enjoy/tmp/network-transport-controls/2026-09-09/subprocess-proxy-receipt.json` đã dùng binary yt-dlp và youtubedr thật, proxy loopback nhận GET/CONNECT rồi trả 502 tại chỗ. URL/proxy Enjoy bị từ chối trước spawn. Đây là bằng chứng routing, không phải tải video/provider thành công. Actual native CLI receipt `enjoy/tmp/network-transport-controls/2026-09-09/native-agent-proxy-receipt.json` ghi Codex/Claude CONNECT tới proxy reject, 4 MCP requests trực tiếp có fixture authorization; không forward, không TLS interception, cleanup verified. Reviewer đã xác nhận 3 contract gaps được khép. Azure package 12 đã quan sát riêng HTTP upgrade 101 cho `eastus.tts.speech.microsoft.com` và `eastus.stt.speech.microsoft.com`; receipt ghi host/status, không ghi URL query hoặc credential. Không suy rằng Chromium hoặc Node fetch guard bao phủ toàn bộ binary. Không thay OS firewall, Keychain hoặc bảo mật máy để làm gate pass.

Lượt Azure đầu lỗi dynamic import của harness trước API; package 10 hai lượt timeout do SDK bundle; package 11 synthesis xong nhưng cleanup timeout. Lượt package 12 đầu đã qua TTS/assessment/UI, rồi harness gọi IPC quá sớm sau restart; lượt `-2` thêm chờ layout ready trước đọc persistence và PASS. Giữ toàn bộ failed logs, không đổi runtime guard hoặc coi các lượt đó là PASS.


## Vertex AI Express: cấu hình Sellnity và live build 12

Đã thêm provider `vertex-express` độc lập, setting `vertex_express`, endpoint cố định `https://aiplatform.googleapis.com/v1` và model phải chọn rõ ràng. Adapter dùng native REST cho text, history, JSON schema và SSE; từ chối input đa phương thức/tool chưa hỗ trợ. Finish reason chỉ `STOP` được coi là hoàn tất, MIME được giới hạn text/JSON và dừng iterator sẽ hủy reader/request. Contract 14 groups, AI runtime 23 cases, TypeScript và scoped lint PASS. Review độc lập đã kiểm ba bản sửa; contract không được tính là live inference.

Theo quyền user cấp, Google Cloud project `sellnity` đã có service account `enjoy-vertex-express@sellnity.iam.gserviceaccount.com` với duy nhất role `roles/aiplatform.expressUser`; key riêng `Enjoy Vertex Express` chỉ được gọi `aiplatform.googleapis.com`. IAM và API restrictions đã được đọc lại để xác minh persistence. Key `BiBung` giữ nguyên restriction Gemini API. Không thay billing hoặc role quản trị rộng.

`gemini-3.5-flash-lite` trả countTokens HTTP 200 và đã PASS một tác vụ Story thật trên bản ký `local-signed-build12`: native generateContent HTTP 200, đúng sáu từ `meticulous, botanist, catalogued, resilient, alpine, orchid`, `idioms: []`, UI hiển thị đủ và SQLite giữ nguyên hash sau full restart offline. Offline không có inference request; main/renderer có zero blocked operation và zero Enjoy operation. Không có runtime issue unexpected; bốn lỗi dò local model được phân loại expected vẫn giữ trong receipt. Đây là kiểm chứng một tác vụ đại diện, không phải benchmark chất lượng tổng quát hoặc live streaming acceptance.

Lượt run1 đã có HTTP 200 và output đúng nhưng dừng tại assertion sai về bộ đếm Node trước offline. Bộ đếm `observedRequests` chỉ do Node HTTP/Undici ghi, còn adapter dùng Chromium fetch. Harness đã sửa để dùng response Playwright với host/path/model/method/status và native JSON contract làm transport proof, đồng thời giữ các gate zero Enjoy/blocked của cả hai process. Run2 PASS 9.7 giây trên cùng ASAR. Không sửa production để vượt lỗi instrumentation, không sửa run1 thành PASS.

Cấu hình UI được kiểm riêng trên build 11 với credential fixture: Vertex lưu riêng, yêu cầu model explicit, Gemini settings/conversation/messages giữ nguyên digest qua full restart offline. Build 12 chỉ khác build 11 ở adapter; 614 file còn lại giữ nguyên. Bản build 12 khớp 615 source files, strict signature/stable designated requirement và package guard PASS; scan 16077 runtime files chỉ có sáu literal trong denylist. ASAR SHA-256 `1b5375ce71a3d802c3c6364d2b63d01588df05aa1efe04180f90d625d729846b`.

Spec bootstrap cũ vẫn FAIL lịch sử vì đòi nút opt-in, trong khi `home.tsx` đã có opt-out mặc định và được yêu cầu giữ nguyên. Hash file này giống nhau ở build 10/11/12. Settings test đã kiểm fresh offline home và restart riêng; không đổi thất bại của spec cũ thành PASS.

Key đầu tiên được tạo trong lượt cấu hình đã xuất hiện trong tool output do định dạng key mới không khớp bộ che tiền tố. Key đó đã bị xóa trước khi dùng và trạng thái xóa được xác minh. Key đang dùng là bản thay thế, không ghi giá trị vào tài liệu/log; đây là sự cố riêng đã thu hồi, không khép R9 Azure/Cloudflare còn mở. Profile thử đã được xóa. Phạm vi quét exact credential và cleanup file private được ghi riêng trong `vertex-authorized-private-cleanup.json`.

Bằng chứng: `vertex-cloud-change-status.json`, `vertex-live-build12-summary.json`, `vertex-settings-build11-summary.json`, `vertex-independent-review.md`, `vertex-transport-validation.json`, `vertex-settings-validation.json`, `vertex-live-harness-validation.json`, `build12-production-delta.json` và `vertex-bootstrap-baseline-mismatch.json`. Hướng dẫn người dùng: `docs/vertex-express-setup.vi.md`.

Gemini Developer API là adapter riêng và đã có live PASS build 12 theo quyền một request của user. Các kết quả provider cũ giữ nguyên build provenance. Không thay app đang cài, không migrate hồ sơ thật và không lưu key mới vào Enjoy thật hoặc Keychain.


Gemini harness được sửa tiếp sau phát hiện từ Vertex: bỏ yêu cầu bộ đếm Node phải tăng khi request dùng Chromium fetch. `chat-model.ts` đã chọn `globalThis.fetch` cho ChatOpenAI; vì vậy Playwright response đúng host/path/model/POST/HTTP 200 vẫn là bằng chứng transport bắt buộc. Các gate zero blocked/legacy của main và renderer cùng kiểm tra offline POST được giữ nguyên. Scoped lint và skip-only PASS (1 skipped, 0 executed), không đọc credential hoặc gọi inference; source app/build 12 không đổi. Type comparison 13 lỗi shared helpers là kết quả lịch sử trước chỉnh sửa assertion này, không được trình bày như lượt typecheck mới. Xem `gemini-harness-validation.json` và `gemini-harness-observer-review.md`.


## Gemini Developer API: live build 12 PASS

Sau khi user cấp quyền đúng một request text với `GEMINI_API_KEY` và `gemini-3.5-flash-lite`, adapter Gemini đã PASS tác vụ Story thật trên `local-signed-build12`. Playwright ghi nhận một POST HTTP 200 tại `generativelanguage.googleapis.com/v1beta/openai/chat/completions`, đúng model đã chọn và không có query chứa credential. Output đúng sáu từ `meticulous, botanist, catalogued, resilient, alpine, orchid` cùng `idioms: []`; UI hiển thị đủ, SQLite giữ nguyên hash `6cabbd96f9456689d847c34a667f6d6b94558bfca416994289ef66b640458601` qua full restart offline. Offline không có Gemini inference; main/renderer zero Enjoy/blocked operation và không có runtime issue unexpected. Bốn lỗi local-model discovery expected được giữ nguyên trong receipt. Toàn bộ test PASS 9.2 giây.

Harness giới hạn trước egress đúng một POST để SDK không thể tự retry vượt quyền: admitted 1, blocked extra 0. Strict Playwright response là bằng chứng request qua Chromium; bộ đếm Node HTTP/Undici chỉ được lưu theo đúng phạm vi. Các gate Enjoy, output, UI, SQLite và offline giữ nguyên. Lint và skip-only đã kiểm trước live; type comparison 13 diagnostic shared helpers là evidence lịch sử, không tuyên bố E2E typecheck sạch.

Key chỉ lấy từ nguồn environment đã được user chọn và truyền vào profile disposable. Trace, screenshots và video đều tắt. Ba thư mục settings/library/Chromium đã được xóa; phép quét exact credential trên 1119 file evidence/source không có match. Không đổi environment credential gốc, Keychain, profile thật, source production hoặc bản build. Quyền một request đã được sử dụng hết; không tự chạy thêm request Gemini.

Đây là live acceptance cho một tác vụ text đại diện, tách biệt với Vertex Express trên cùng model name. Kết quả không phải benchmark chất lượng tổng quát. Bằng chứng: `gemini-live-build12-summary.json`, `gemini-live-private-cleanup.json`, `gemini-harness-validation.json`, `gemini-harness-observer-review.md`. Những probe metadata và harness skip trước đó là lịch sử chuẩn bị, không thay thế lượt live này.


## Human listening TTS đã xác nhận

User đã nghe hai output thật OpenAI và Azure, xác nhận cả hai đọc đủ câu “Cup. I have a cup of tea.”, rõ và không rè hoặc ngắt mất lời. Hai file nghe khớp SHA-256 trong receipt live gốc; nguồn OpenAI là historical package 8, nguồn Azure là speech-final. Đây là human listening PASS cho hai mẫu đó, không phải lượt TTS mới trên build 12. Bằng chứng và lời xác nhận: `human-listening/manifest.json`. Microphone vật lý đã PASS trong mục dưới; R9 hai Azure keys/Cloudflare tunnel token do user tự xử lý, chưa xác minh thu hồi.


## R9: user tự xử lý credential

User chỉ định: “Không cần xoay. Tôi tự xử lý”. Theo phạm vi mới, assistant dừng phần xoay credential; việc xử lý hai Azure keys và Cloudflare tunnel token thuộc user. Đây không phải xác minh key/token đã thu hồi và không xóa sự cố khỏi báo cáo. Không tiếp tục coi quyền xoay credential là việc đang chờ assistant thực hiện. Bằng chứng: `r9-user-owned-handoff.json`.


## Microphone vật lý Pixel và XVF3800 trên build 12

PASS lượt đầu trong 30.1 giây: ADB điều khiển Pixel 10 Pro XL phát mẫu Azure TTS đã khóa hash qua loa thật. Production RecorderButton của Enjoy thu bằng `Default - reSpeaker XVF3800 4-Mic Array (2886:001a)`, một lần `getUserMedia`, không có fake-media flags. Pixel bắt đầu sau khi capture sẵn sàng, acknowledgement trong 1040 ms; active AudioTrack dùng device port 3, đối chiếu với `AUDIO_DEVICE_OUT_SPEAKER` và ảnh Files đang phát.

Azure `eastus.stt.speech.microsoft.com` nhận đủ lexical `cup i have a cup of tea`, 7 từ và 15 phoneme. Điểm pronunciation 74.8, accuracy 84, completeness 71, fluency 77; từ `cup` đầu và `tea` cuối bị đánh dấu Mispronunciation. Đây là nghiệm thu luồng thu và đánh giá vật lý với giọng TTS phát qua loa theo yêu cầu user, không phải chứng nhận điểm cao hoặc phép thử giọng người học.

MP3 thu được dài 11.664 giây, 46880 bytes, SHA-256 `01c63cdcde370b3eb58ca673e97a55a0450a14153fa143a777e73ed9db174e90`. Bản ghi phát được, UI có card kết quả; MP3 và SQLite recording/assessment rows giữ nguyên digest sau full restart offline, zero inference/offline requests và zero Enjoy/blocked operations. ASAR khớp build 12 `1b5375ce...`; toàn bộ 615 source files giữ nguyên.

Profile disposable, file credential private, coordination directory và hai file thử trên Pixel đã được dọn và kiểm lại. Quét exact bytes Azure Key1 trong 1106 file evidence/harness không có match; phạm vi này không bao gồm tool-output history, Key2 hoặc tunnel token. Giữ default input XVF3800 theo yêu cầu user. Bằng chứng: `physical-microphone-build12-summary.json`, `physical-microphone-private-cleanup.json`, `physical-path-independent-review.md` và thư mục `pixel-xvf-20260910T084946Z/`.


Review cuối không còn finding actionable. Harness tái sử dụng đã được gia cố sau lượt live: chờ trạng thái recorder production, kiểm nội dung/thời gian ACK, khóa expected ASAR và buộc lỗi nếu thiếu bằng chứng thiết bị. Đây là validation source-only; archived spec `d2a522...` và wrapper `83c912...` vẫn là provenance của lượt live PASS. Source app không đổi và không phát sinh thêm inference. Audit toàn goal: `goal-final-build12-audit.md`; trạng thái kỹ thuật/chức năng và bàn giao local PASS, R9 giữ historical FAIL/user-owned/unverified.
