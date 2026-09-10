# Inventory phụ thuộc backend Enjoy

Inventory này là baseline tĩnh cho U1, đối chiếu working tree ngày 2026-09-09. `reachable` nghĩa là còn caller có thể chạy; `guarded` nghĩa là có policy trước egress; `dead` chỉ dùng khi không còn đường gọi. Trạng thái có thể đổi trong U2-U11 và phải quét lại trên đúng source/package fingerprint trước G7.

## Hostname đã ngừng dùng

- `enjoy.bot` và mọi subdomain có ranh giới hostname, gồm `ai-worker.enjoy.bot`, `storage.enjoy.bot`, `discuss.enjoy.bot`, `dl.enjoy.bot`.
- `api.getenjoyapp.com` là alias backend được ghi trong tài liệu cũ. Chỉ hostname alias này bị chặn; không suy đoán và chặn toàn bộ `getenjoyapp.com`.
- `enjoy-storage.baizhiheizi.com` là alias storage có trong metadata endpoint cũ. Chỉ hostname alias này bị chặn; không chặn parent domain hoặc hostname cùng parent không có evidence.
- URL được parse trước khi so sánh. Policy normalize chữ hoa và mọi trailing dot. Userinfo, path, query, fragment và URL Enjoy được encode trong query của một host khác không tham gia nhận diện hostname đích.

## Ma trận transport

| Bề mặt | Owner / điểm egress | Trạng thái U1 | Policy và test path | Khoảng trống còn lại |
|---|---|---|---|---|
| Chromium HTTP(S), WebSocket, resource, redirect | `main/network-policy.ts`, Electron `Session.webRequest.onBeforeRequest` | guarded | `main.ts` cài `installChromiumNetworkPolicy()` trước bootstrap window cho default session và mọi `session-created`; `check-no-enjoy-network.mjs` kiểm positive/negative callback và redirect destination | Packaged trace thuộc G4. E2E helper hiện cài listener cuối riêng nên phải compose thay vì overwrite app policy. |
| Classifier BrowserWindow/session riêng | `main/learning-asr/music-classifier.ts` | guarded | `installChromiumSessionNetworkPolicy(..., allowRequest)` hợp nhất block Enjoy với allow-origin loopback; contract kiểm cả hai rule | Chưa chạy classifier đóng gói trong U1. Dev model fetch chỉ cho phép loopback HTTP và dùng `redirect: error`. |
| Node fetch do `proxy-agent` cấp cho OpenAI speech | `main/proxy-agent.ts` | guarded | `createGuardedFetch()` kiểm request ban đầu và từng redirect; contract kiểm `Request` input, cross-origin credential stripping và method/body redirect semantics | Chỉ các caller dùng facade này được bảo vệ. Streaming body không thể replay an toàn qua 307/308 bị từ chối rõ ràng. Không được diễn giải thành global Node coverage. |
| Node global fetch / SDK fetch riêng | `main/cloudflare-transcribe/service.ts`, provider SDK và main adapters khác | reachable, chưa guard toàn bộ | Adapter có thể nhận `createGuardedFetch()` với `transport`/`operation` cố định | U6-U8 phải wire từng adapter. Không monkeypatch `globalThis.fetch` vì SDK có thể capture implementation lúc import và behavior redirect/cancel khác nhau. |
| Axios backend client | `api/client.ts`, các model DB, renderer config/story/speech callers | reachable, chưa guard trong U1 | Dùng `isRetiredEnjoyUrl`, `noteLegacyBackendAttempt`, rồi `assertAllowedNetworkUrl` trong request interceptor/facade | Owner U3-U11 phải gỡ caller và client. Chromium policy chỉ bảo vệ axios ở renderer, không bảo vệ axios chạy trong main. |
| Axios storage client | `main/storage.ts` | reachable khi không ở local mode | Chưa wire; hostname literal `storage.enjoy.bot` bị static inventory bắt | Owner U9 gỡ network side effect. Guard local-mode hiện có không chứng minh nhánh khác an toàn. |
| Download | `main/downloader.ts` qua `webContents.downloadURL` | reachable | Đi qua Chromium Session sau startup wiring | Cần packaged positive/negative download và redirect trace. |
| Navigation / external browser | `main/window.ts`, provider BrowserView, `shell.openExternal` IPC | reachable | Session policy bảo vệ in-app `loadURL`; pure helper sẵn cho navigation validation | `shell.openExternal` rời Chromium Session, nên parent phải gọi `assertAllowedNetworkUrl` trước mở. User tự mở website ngoài app không thuộc phạm vi. |
| Custom protocol `enjoy://` | `main.ts` protocol handler | reachable, local | Đây là scheme file/learning asset của ứng dụng, không phải hostname `enjoy.bot` | URL nhập vào handler vẫn cần path ownership validation riêng; network policy không thay thế file policy. |
| Subprocess | `yt-dlp`, ACP/Codex/Claude process manager, ffmpeg/ffprobe helpers | reachable | Chưa có process-wide network interception | Owner từng subprocess phải kiểm args/env và có positive/negative traffic control. U1 không tuyên bố Session hoặc guarded fetch chặn được subprocess. |
| Portal, README badge và distribution | `1000h-portal`, `1000-hours`, root `README.md` | reachable ở baseline | Static scan thấy API/badge/download literals | Owner U10 gỡ. Desktop policy không bảo vệ browser của portal hoặc request do badge service tạo. |

## Tám gap integration còn hành động được

1. **Standalone ASR Node fetch.** `main/cloudflare-transcribe/service.ts` và `main/mai-transcribe/service.ts` vẫn chọn `options.fetch || fetch`; MAI để redirect mặc định có thể follow cùng `Authorization`. Inject `createGuardedFetch()` tại hai IPC/service factory với operation riêng. Test redirect sang hostname retired và redirect cross-origin không mang key. `main/learning-asr/providers.ts` đã validate endpoint đầu và dùng `redirect: error`, nhưng vẫn cần traffic positive control cho từng provider được quảng bá.
2. **OpenAI SDK construction.** `main/proxy-agent.ts` cung cấp guarded fetch cho caller dùng facade, và chat factory có guarded fetch riêng. Quét mọi `new OpenAI`/LangChain constructor còn lại để bắt buộc truyền facade; contract phải có `Request` input, custom `baseURL`, cancel và redirect. Một constructor chỉ truyền `httpAgent` không được tính là có URL policy.
3. **Azure Speech SDK internal transport.** `main/azure-speech-sdk.ts` và Azure TTS trong `main/speech/provider.ts` gọi `SpeechConfig.fromSubscription(key, region)` rồi để SDK tự tạo kết nối. `Session.webRequest` và guarded fetch không chứng minh lớp này. Giữ region validation, thêm harness/proxy có positive control cho SDK thật và xác nhận hostname đích theo resource đã cấu hình; không log key, audio hoặc result riêng tư.
4. **Electron download.** `main/downloader.ts` nhận URL từ Audio/Video/Document IPC và gọi `webContents.downloadURL`. Startup Session policy chặn hostname retired và redirect, nhưng G4 vẫn cần một download loopback thành công, một redirect loopback sang retired bị chặn trước destination, counters đúng, và listener E2E không overwrite listener ứng dụng.
5. **`yt-dlp` và binary `youtubedr`.** `main/yt-dlp.ts` truyền URL bằng argv sau `--`, dùng `--ignore-config`, nhưng subprocess tự follow media redirects. `main/youtubedr.ts` fallback còn dùng `exec`/`spawn`, và cả hai đường nhận `process.env` cộng `HTTP_PROXY`/`HTTPS_PROXY` từ setting. Giữ allowlist YouTube đầu vào; thu hẹp env xuống PATH/proxy cần thiết, không log URL query, và dùng proxy fixture có positive control cùng retired-host negative control. Không gọi YouTube hoặc Enjoy thật trong contract.
6. **Codex/Claude/ACP subprocess.** `main/agents/process-manager.ts` đã pin executable, `shell: false` và allowlist env; Codex tắt web search/network trong runtime đã verify. Tuy vậy `input.mcp.url` đi vào Codex config, Claude MCP config và ACP adapter, còn validator chỉ yêu cầu HTTP(S). Gọi `assertAllowedNetworkUrl()` trước khi ghi config/spawn, giới hạn MCP URL vào loopback server do app sở hữu nếu đó là contract thực, rồi test token không xuất hiện trong diagnostics. Native CLI provider traffic vẫn cần quan sát riêng, không suy từ process sandbox sang mọi binary.
7. **ffmpeg/ffprobe subprocess.** `main/learning/asset-store.ts` và `main/learning/narration-synthesis.ts` đã có `-protocol_whitelist file,pipe`; đây là evidence tốt nhưng không bao phủ lệnh khác. `main/cloudflare-transcribe/preparation.ts` dùng trusted absolute cache path nhưng chưa truyền protocol whitelist cho probe/transcode. Thêm cùng allowlist ở mọi invocation đọc input và contract với local file positive control; không cần OS-wide block.
8. **Receipt aggregation và test listener.** Counters là module-local theo process/bundle. Main Session/main adapter và renderer guarded fetch phải được G4 đọc rồi cộng có provenance, không trộn thành một số mất transport. `e2e/helpers/isolated-app.ts` hiện cài `onBeforeRequest` listener cuối sau launch; sửa harness để compose hoặc capture ở proxy mà không vô hiệu policy ứng dụng, rồi chứng minh positive/negative control riêng cho Chromium, Node/SDK và subprocess.

## Backend operation còn reachable ở baseline

`Client` vẫn được tạo trong main bootstrap, renderer bootstrap/settings, Stories/Vocabulary, speech/pronunciation và các model sync. Constants vẫn có `WEB_API_URL`, `WS_URL`, `AI_WORKER_ENDPOINT`, `STORAGE_WORKER_ENDPOINT` và `DISCUSS_URL`. Các nhánh `settings.localMode` chỉ là guard có điều kiện, chưa đủ để đánh dấu dead.

Khi một legacy facade còn tồn tại, caller phải gọi `noteLegacyBackendAttempt()` trước khi xử lý và `assertAllowedNetworkUrl()` trước egress. Hai bộ đếm độc lập:

- `legacyBackendOperationCount` phát hiện caller legacy kể cả khi operation được trả lỗi trước network.
- `blockedAttemptCount` chỉ tăng khi policy từ chối hostname đã ngừng dùng.

Snapshot từ `getNetworkPolicyDiagnostics()` chỉ chứa tổng và key `transport|operation|hostname`. Policy không giữ URL đầy đủ, query, body, header, credential hoặc signed URL. `transport` và `operation` phải là nhãn code cố định; implementation cắt phần sau whitespace, `?` hoặc `#`, giới hạn character set và độ dài.

## Evidence và giới hạn U1

`node scripts/check-no-enjoy-network.mjs` là contract offline. Nó không gửi request mạng thật. Test bao phủ root/subdomain, chữ hoa, trailing dot, userinfo, lookalike, alias exact, HTTP/WebSocket URL, encoded nested URL, request được phép, `Request` POST giữ method/body/header, redirect bị chặn, redirect được phép và bỏ credential khi đổi origin, streaming body fail closed, opaque redirect không thể inspect, counters và listener composition.

U1 chưa phải G4 PASS. G4 vẫn cần packaged app, clean/legacy profile, idle, offline/reconnect, full restart và traffic observation riêng cho Chromium, Node/SDK và subprocess. Zero outgoing request chỉ có ý nghĩa khi positive control chứng minh harness nhìn thấy đúng lớp transport, và các normal flow đồng thời có `blockedAttemptCount = 0`, `legacyBackendOperationCount = 0`.
