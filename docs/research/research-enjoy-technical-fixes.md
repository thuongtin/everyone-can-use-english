---
title: "Giải pháp mã nguồn mở cho các lỗi kỹ thuật hiện tại của Enjoy"
date: 2026-09-06
mode: deep
sources: 51
confidence: hỗn hợp
status: research-complete-with-runtime-limits
method: Đối chiếu nguồn upstream, phiên bản khóa và bằng chứng chạy cục bộ
---

# Giải pháp mã nguồn mở cho các lỗi kỹ thuật hiện tại của Enjoy

**Có giải pháp mã nguồn mở đã xử lý một số lỗi đang gặp.** Lỗi build portal có bản sửa upstream khớp trực tiếp. Lỗi YouTube và trình phát có mã nguồn, bản sửa hoặc hướng dẫn có thể áp dụng. Hai lỗi về phím tắt và vòng đời database cần sửa cách Enjoy sử dụng thư viện. Chưa tìm thấy một bản Enjoy công khai có thể thay vào để giải quyết toàn bộ các lỗi đã quan sát.

Đây là bản nghiên cứu kỹ thuật cho fork Enjoy đang Việt hóa, dùng trên macOS arm64. Phạm vi không gồm tìm ứng dụng học tiếng Anh thay thế, kiểm toán bảo mật toàn bộ dependency, chất lượng từ điển hay chất lượng dịch thuật.

## Kết quả tích hợp ngày 2026-09-06

Candidate2 đã build và verifier PASS; 6 E2E PASS, 3 native model SKIP. Bundle bàn giao đã mở bằng hồ sơ QA GitHub, thấy trang chủ Việt và danh sách YouTube thật. Các thay đổi DB chỉ có kiểm thử async với fixture, chưa có logout thật giữa request đang chờ; AI trả phí, microphone, upload và tiến độ backend chưa kiểm chứng. Review Luna cuối cho packaging/DB và inventory bị ngắt bởi usage limit; controller đã tiếp quản, không coi đó là review độc lập đã PASS.

[Verifier candidate2](</tmp/enjoy-candidate2-artifact-verifier.log>), [E2E candidate2](</tmp/enjoy-candidate2-e2e.log>), [bằng chứng runtime](</Users/ethan/VibeCoding/everyone-can-use-english/.superpowers/sdd/2026-09-06-enjoy-vietnamese-stabilization/runtime-evidence.md>).

## Kết luận chính

1. 🟢 **Áp dụng `fdir 6.4.4` để sửa treo build.** Issue upstream mô tả `parent="/"`, `state.root=""`; trace local chỉ xác nhận crawl root `/`, nên ánh xạ tới đúng trạng thái nội bộ này là suy luận. Release 6.4.4 chứa bản sửa. Phép thử cục bộ với 6.4.3 bị timeout, còn 6.4.4 kết thúc; portal đã tạo được `.output/public`. ([fdir, 2025](https://github.com/thecodrr/fdir/issues/135), [fdir, 2025](https://github.com/thecodrr/fdir/releases/tag/v6.4.4))
2. 🟡 **Dùng cấu hình Yarn có sẵn để ngăn self-link, giữ kiểm tra bản đóng gói.** `nmSelfReferences: false` ngăn Yarn tạo liên kết workspace tự trỏ. Nó không bổ sung một dependency đã bị bỏ sót vào app cũ; vẫn phải build mới và thử `require()` trong Electron. ([Yarn, truy cập 2026](https://yarnpkg.com/configuration/yarnrc), [Electron, truy cập 2026](https://www.electronjs.org/docs/latest/tutorial/asar-archives))
3. 🟢 **Sửa đầu vào phím tắt ở Enjoy.** `react-hotkeys-hook 4.6.1` nhận chuỗi hoặc mảng chuỗi. Baseline HEAD của fork khởi tạo map rỗng và có callsite truyền giá trị chưa được nạp; parser 5.3.3 cũng không biến giá trị đó thành đầu vào hợp lệ. Nâng riêng thư viện không thay thế việc khởi tạo và kiểm tra cấu hình. ([react-hotkeys-hook, tag 4.6.1](https://raw.githubusercontent.com/JohannesKlauss/react-hotkeys-hook/v4.6.1/src/types.ts), [react-hotkeys-hook, tag 5.3.3](https://raw.githubusercontent.com/JohannesKlauss/react-hotkeys-hook/v5.3.3/packages/react-hotkeys-hook/src/lib/parseHotkeys.ts))
4. 🟡 **Có thể dùng kinh nghiệm upstream cho audio và YouTube mà chưa phải thay toàn bộ kiến trúc.** WaveSurfer có hướng dẫn xử lý load/cleanup và các bản sửa mới hơn; yt-dlp đã hỗ trợ `LOCKUP_CONTENT_TYPE_VIDEO`, còn YouTube.js có parser tương ứng. Khả năng tích hợp toàn bộ các thư viện mới chưa được chạy thử trong fork này. ([WaveSurfer, 2024](https://github.com/katspaugh/wavesurfer.js/discussions/3739), [yt-dlp, 2025](https://github.com/yt-dlp/yt-dlp/pull/13665), [YouTube.js, truy cập 2026](https://raw.githubusercontent.com/LuanRT/YouTube.js/main/src/parser/classes/LockupView.ts))
5. 🟡 **Database và kiểm thử startup cần ràng buộc thứ tự tại ứng dụng.** React hướng dẫn loại bỏ kết quả async cũ; Sequelize `close()` trả Promise. Playwright chỉ cài route sau khi `launch()` trả về thì chưa chứng minh đã chặn request đầu tiên của executable. ([React, truy cập 2026](https://react.dev/reference/react/useEffect), [Sequelize v6, truy cập 2026](https://sequelize.org/docs/v6/getting-started/), [Playwright, truy cập 2026](https://playwright.dev/docs/api/class-electron))

## Tách nguồn upstream, kiểm chứng cục bộ và suy luận

Các URL `main` hoặc `master` phản ánh nội dung đã đọc ngày 2026-09-06. Chưa chọn chúng làm dependency động; một lần tích hợp mới phải ghim phiên bản hoặc commit.

| Nhóm | FACT từ upstream | LOCAL PROOF | INFERENCE và giới hạn |
|---|---|---|---|
| fdir | Issue #135, PR #137/#139 và release 6.4.4 sửa root normalization | [Trace Nuxt](</tmp/enjoy-portal-controller-fdir.log>), [trace Nitro](</tmp/enjoy-portal-scan-disabled-trace.log>), [generate cuối](</tmp/enjoy-portal-runtime-fixed-generate.log>) | Trace không ghi parent/state.root. Repro dùng resolvePaths:false, trace ứng dụng dùng true. Build thành công ủng hộ áp dụng fix, không chứng minh mọi crawl mode. |
| Yarn và đóng gói | Cấu hình nmSelfReferences phòng ngừa self-reference khi install có điều kiện phát sinh | [Verifier candidate1](</tmp/enjoy-stabilization-artifact-verifier.log>), [guard](</Users/ethan/VibeCoding/everyone-can-use-english/enjoy/scripts/check-package-guard.mjs>) | Fixture Yarn true/false đều không tạo symlink. Không chứng minh Yarn là nguyên nhân duy nhất; cấu hình không xóa link cũ hoặc bổ sung module thiếu. |
| Hotkey | Keys 4.6.1 nhận string hoặc readonly string[]; parser 5.3.3 vẫn yêu cầu string | [Chẩn đoán stack và snapshot baseline](</Users/ethan/VibeCoding/everyone-can-use-english/.superpowers/sdd/2026-09-06-enjoy-vietnamese-stabilization/task-4-report.md>), [regression persisted map](</Users/ethan/VibeCoding/everyone-can-use-english/enjoy/scripts/check-hotkeys-settings.mjs>) | Baseline HEAD 3d799132 có currentHotkeys:{} và callsite Copilot. Candidate1 tái hiện undefined.split; candidate2 đã vượt qua E2E nhấn phím và startup. |
| WaveSurfer | Local 7.9.1, PR #4314 có trong release 7.12.8 mới hơn | [Fixture](</tmp/enjoy-final-check-wavesurfer-player.log>), [QA candidate1](</Users/ethan/VibeCoding/everyone-can-use-english/.superpowers/sdd/2026-09-06-enjoy-vietnamese-stabilization/runtime-evidence.md>) | Root đã thấy waveform và phát/tạm dừng audio thật trên candidate1. Chưa kiểm chứng memory leak dài hạn hoặc mọi hidden container, chưa nâng WaveSurfer. |
| YouTube | yt-dlp hỗ trợ lockup video ở nhánh đã sửa; YouTube.js có LockupView | [Fixture parser](</tmp/enjoy-final-check-youtube-parser.log>), [QA danh sách TED/CNN/NYTimes](</Users/ethan/VibeCoding/everyone-can-use-english/.superpowers/sdd/2026-09-06-enjoy-vietnamese-stabilization/runtime-evidence.md>) | Root đã thấy danh sách thật ở candidate1. Chưa thử continuation hoặc account feed, chưa so sánh ba thư viện trong cùng artifact. |

YouTube.js là client cho private InnerTube API, không phải API YouTube chính thức. Browser cần proxy theo guide, một số endpoint cần session; yt-dlp thêm Python/JS runtime và flat-playlist có thể thiếu metadata. Giá trị license trong manifest chỉ là thông tin nguồn, không phải kết luận tương thích pháp lý.

DB có năm regression về serialization và kết quả stale, gồm helper đồng bộ phiên mà AppSettings gọi. Đây chưa phải thao tác logout thật trong UI có tài khoản. Proxy loopback E2E được tạo trước launch để kiểm soát traffic Chromium của fixture, nhưng không được gọi là chứng minh chặn mọi network từ mọi process hoặc bắt mọi lỗi trước khi Playwright trả về.

## Phiên bản đã đối chiếu

| Thành phần | Phiên bản cục bộ được đọc | Điểm cần phân biệt |
|---|---|---|
| Enjoy | 0.7.9 | Trùng tên phiên bản desktop mới nhất được GitHub upstream liệt kê tại ngày nghiên cứu |
| Electron / Forge / Packager | 34.3.3 / 7.7.0 / 18.3.6 | Kiểm tra app đóng gói bằng Electron, không chỉ Node hệ thống |
| Yarn | 4.6.0 | Có cấu hình `nmSelfReferences` |
| Plugin dependency / dependencies-tree | 1.0.0 / 2.0.0 | Cần chép đủ cây dependency production |
| Nuxt / unimport | 3.15.4 / 4.1.2 | Còn nhánh unimport riêng của Nitro |
| fdir trước sửa | 6.4.2 và 6.4.3 | Resolution mới ghim 6.4.4 cho cả hai nhánh |
| react-hotkeys-hook | 4.6.1 | So sánh thêm parser 5.3.3, không khẳng định đó là mọi phiên bản tương lai |
| WaveSurfer | 7.9.1 | Các bản sửa lifecycle trong PR #4314 ra sau phiên bản này |
| React / Sequelize | 18.3.1 / 6.37.6 | Cleanup effect không tự hủy Promise hoặc thao tác IPC đang chạy |
| Playwright | 1.51.0 | Tài liệu Electron hiện vẫn ghi experimental |

Các số phiên bản cục bộ được đọc từ `package.json` trong cây dependency và lockfile tại thời điểm nghiên cứu. Thông tin release desktop được kiểm tra qua cả GitHub page và API. ([Enjoy, 2025](https://github.com/ZuodaoTech/everyone-can-use-english/releases/tag/v0.7.9))

## Bảng quyết định theo lỗi

| Lỗi đang xử lý | Giải pháp công khai | Mức khớp | Quyết định cho fork này |
|---|---|---|---|
| `Cannot find module 'universalify'`, cây `node_modules` lặp trong artifact | Yarn `nmSelfReferences: false`; Forge dependency-copy plugin; Electron ASAR/native rules | Có cấu hình phòng ngừa và cơ chế đóng gói, chưa thấy exact Enjoy PR sửa toàn bộ | Giữ plugin hiện có, ngăn self-link, kiểm tra dependency thật sau build |
| Portal build treo trước Vite | fdir #135, #137, #139, release 6.4.4 | Khớp trực tiếp với trace và phép thử | Ghim fdir 6.4.4 bằng Yarn resolution, bỏ workaround tắt quét imports |
| Gõ phím làm `undefined.split` | Contract của react-hotkeys-hook | Xác nhận lỗi ở caller | Khởi tạo cấu hình hợp lệ, kiểm tra dữ liệu lưu trước đăng ký hotkey |
| Audio tải lâu, callback cũ, container chưa đo được | WaveSurfer 7.9.1 source, maintainer trả lời #3739, PR 4314 | Khớp từng phần, không phải một bản nâng cấp tự sửa tất cả | Sửa lifecycle tại caller; đánh giá nâng WaveSurfer riêng sau khi có regression playback |
| DB reconnect sau logout, connect khi chưa có path | React cleanup/ignore; Sequelize async close | Pattern có sẵn, không có mutex phiên người dùng thay sẵn | Xếp hàng connect/disconnect, dùng generation, hủy retry khi logout |
| YouTube thay shape từ `videoRenderer` sang `lockupViewModel` | yt-dlp #13665; YouTube.js LockupView | Khớp shape; phạm vi đầy đủ rộng hơn local adapter | Giữ adapter đã sửa cho danh sách hiện tại; cân nhắc YouTube.js nếu mở rộng search/continuation |
| E2E bỏ lọt startup request/error | Electron session.webRequest; Playwright Electron examples | API phù hợp, cần thiết kế startup của chính Enjoy | Đặt guard trước load đầu tiên; bắt stderr/signal và lỗi renderer, không nới allowlist để làm test xanh |

Nguồn theo hàng: [Yarn](https://yarnpkg.com/configuration/yarnrc), [fdir 6.4.4](https://github.com/thecodrr/fdir/releases/tag/v6.4.4), [hotkeys 4.6.1](https://raw.githubusercontent.com/JohannesKlauss/react-hotkeys-hook/v4.6.1/src/parseHotkeys.ts), [WaveSurfer #3739](https://github.com/katspaugh/wavesurfer.js/discussions/3739), [React useEffect](https://react.dev/reference/react/useEffect), [yt-dlp #13665](https://github.com/yt-dlp/yt-dlp/pull/13665), [Electron webRequest](https://raw.githubusercontent.com/electron/electron/main/docs/api/web-request.md).

## Phân tích và giới hạn áp dụng

### 1. Đóng gói: ngăn cây thư mục sai và kiểm tra thành phẩm

`nmHoistingLimits: workspaces` chỉ giới hạn vị trí đưa dependency lên thư mục cha. Nó không tắt self-reference. Cấu hình `nmSelfReferences: false` giải quyết phần Yarn có thể tạo liên kết tự trỏ; guard trước package vẫn có ích với liên kết còn lại từ lần cài cũ. Đây là phòng ngừa cho một nguồn gây cây thư mục sai, không phải bằng chứng rằng mọi self-link đều gây cùng lỗi thiếu `universalify`. ([Yarn, truy cập 2026](https://yarnpkg.com/configuration/yarnrc))

Forge Vite 7.7.0 build bundle và chuẩn bị package metadata; dependency production được externalize phải được cung cấp bằng đường chép riêng. Plugin `electron-forge-plugin-dependencies` và `dependencies-tree` cung cấp cơ chế này. Source dependency-tree đang công khai có cách xử lý path và symlink đáng lưu ý, nhưng suy luận nó là nguyên nhân duy nhất của lỗi Enjoy cần phép thử riêng. ([Forge Vite 7.7.0](https://raw.githubusercontent.com/electron/forge/v7.7.0/packages/plugin/vite/src/VitePlugin.ts), [dependency plugin](https://raw.githubusercontent.com/caoxiemeihao/electron-forge-plugin-dependencies/main/src/DependenciesPlugin.ts), [dependencies-tree](https://raw.githubusercontent.com/caoxiemeihao/dependencies-tree/main/src/utils.ts))

`auto-unpack-natives` đưa file `.node` ra khỏi ASAR. Nó không bổ sung JavaScript package còn thiếu. Vì thế phải kiểm tra cả `app.asar` và `app.asar.unpacked`, sau đó chạy `require()` và thao tác SQLite/native bằng Electron thực. Forge issue #3624 là bằng chứng về một lỗi symlink khác trong quá trình copy, không phải exact fix cho Enjoy. ([AutoUnpackNatives 7.7.0](https://raw.githubusercontent.com/electron/forge/v7.7.0/packages/plugin/auto-unpack-natives/src/AutoUnpackNativesPlugin.ts), [ASAR](https://www.electronjs.org/docs/latest/tutorial/asar-archives), [Forge #3624](https://github.com/electron/forge/issues/3624))

### 2. Portal: dùng bản sửa fdir đã phát hành

Lỗi được sửa ở bước chuẩn hóa root: không được cắt `/` thành chuỗi rỗng. PR 137 xử lý POSIX; PR 139 bổ sung Windows. Release 6.4.4 chứa bản hoàn chỉnh, nên phù hợp hơn việc tự sửa vòng `while` trong `node_modules`. tinyglobby 0.2.13 cũng ghi nhận bản sửa này và nâng yêu cầu fdir lên `^6.4.4`. ([fdir #137](https://github.com/thecodrr/fdir/pull/137), [fdir #139](https://github.com/thecodrr/fdir/pull/139), [tinyglobby 0.2.13](https://github.com/SuperchupuDev/tinyglobby/releases/tag/0.2.13))

Nuxt 3.15.4 ghim tinyglobby 0.2.10 và có nhánh unimport riêng của Nitro. Chỉ tắt `imports.scan` bỏ qua một bước quét; trace cục bộ cho thấy Nitro vẫn gọi đường gây treo. Resolution fdir áp dụng đồng thời cho các nhánh cũ là thay đổi hẹp hơn nâng toàn bộ Nuxt. Phép thử trước/sau và build thành công là bằng chứng cục bộ, không phải benchmark hiệu năng tổng quát. ([Nuxt 3.15.4 manifest](https://registry.npmjs.org/nuxt/3.15.4), [fdir 6.4.4 manifest](https://registry.npmjs.org/fdir/6.4.4))

### 3. Phím tắt và database: sửa contract của ứng dụng

Source upstream Enjoy hiện vẫn có lời gọi `useHotkeys(currentHotkeys.OpenCopilot, ...)`. Contract 4.6.1 không nhận `undefined`; bản parser 5.3.3 cũng yêu cầu chuỗi. Do nhiều màn hình sử dụng cùng map phím tắt, sửa provider khởi tạo/đọc cấu hình có thể bảo vệ rộng hơn chỉ thêm guard tại Copilot. Đây là đề xuất dựa trên callsite cục bộ, cần regression cho cấu hình rỗng, cấu hình hỏng và thao tác gõ phím trước khi tải xong. ([Enjoy upstream Copilot](https://github.com/ZuodaoTech/everyone-can-use-english/blob/main/enjoy/src/renderer/context/copilot-provider.tsx), [hotkeys 4.6.1](https://raw.githubusercontent.com/JohannesKlauss/react-hotkeys-hook/v4.6.1/src/useHotkeys.ts), [hotkeys 5.3.3](https://raw.githubusercontent.com/JohannesKlauss/react-hotkeys-hook/v5.3.3/packages/react-hotkeys-hook/src/lib/parseHotkeys.ts))

Với database, React cleanup không hủy một Promise đang chạy; kết quả cũ cần bị bỏ qua bằng cờ hoặc generation. Sequelize 6 `close()` bất đồng bộ và instance đã đóng không được mở lại. Retry query mặc định của 6.37.6 chỉ nhắm `SQLITE_BUSY`, không bảo vệ việc connect phiên cũ sau logout. Vì vậy cần giải quyết ở ranh giới phiên người dùng và IPC, với kiểm tra logout xảy ra khi probe/connect vẫn đang chờ. ([React](https://react.dev/reference/react/useEffect), [Sequelize v6](https://sequelize.org/docs/v6/getting-started/), [Sequelize 6.37.6](https://raw.githubusercontent.com/sequelize/sequelize/v6.37.6/src/sequelize.js))

### 4. Audio: upstream đã có hướng dẫn và các bản sửa mới hơn

WaveSurfer 7.9.1 cố ý trì hoãn load sang microtask để caller kịp đăng ký event ngay sau `create()`. Nếu Enjoy đợi một React effect khác sau `setState` mới đăng ký, thứ tự đó không còn được bảo đảm. Maintainer đề xuất tạo instance không có URL rồi gọi `load(url).catch(...)`; cách này cũng giúp xử lý hủy tải khi component bị dọn. Renderer đọc `clientWidth`, nên container có width 0 không thể được coi là đã sẵn sàng chỉ vì giao với viewport. ([WaveSurfer 7.9.1 core](https://raw.githubusercontent.com/katspaugh/wavesurfer.js/7.9.1/src/wavesurfer.ts), [renderer 7.9.1](https://raw.githubusercontent.com/katspaugh/wavesurfer.js/7.9.1/src/renderer.ts), [maintainer #3739](https://github.com/katspaugh/wavesurfer.js/discussions/3739))

PR 4314 đã merge các guard sau `await`, chống load chồng và dọn timer/listener. Trang release ghi các thay đổi audit trong7.12.8, và liệt kê7.12.11 tại ngày truy cập. Đây là hướng nâng cấp cần đánh giá thêm, không phải bằng chứng rằng phiên bản mới tự sửa mọi lỗi layout hoặc cách đăng ký event của Enjoy. ([WaveSurfer4314](https://github.com/katspaugh/wavesurfer.js/pull/4314), [WaveSurfer releases](https://github.com/katspaugh/wavesurfer.js/releases))

### 5. YouTube: có parser dùng lại được, cân nhắc chi phí tích hợp

yt-dlp đã merge hỗ trợ `LOCKUP_CONTENT_TYPE_VIDEO` trong nhánh extractor subscriptions feed ngày 2025-07-07. Parser hiện đọc `contentId`, phân biệt video với playlist/podcast và có continuation. YouTube.js có class `LockupView` cùng các API `search`, `getChannel`, `getPlaylist`. Đây là mã nguồn thích hợp để đối chiếu khi YouTube đổi shape. ([yt-dlp #13665](https://github.com/yt-dlp/yt-dlp/pull/13665), [yt-dlp extractor](https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/yt_dlp/extractor/youtube/_tab.py), [YouTube.js LockupView](https://raw.githubusercontent.com/LuanRT/YouTube.js/main/src/parser/classes/LockupView.ts), [Innertube](https://raw.githubusercontent.com/LuanRT/YouTube.js/main/src/Innertube.ts))

| Phương án | Được gì | Chi phí và giới hạn | Đề xuất |
|---|---|---|---|
| Adapter TypeScript nhỏ đang có | Ít thay đổi, đã hiển thị danh sách thực trong candidate | Phải cập nhật khi shape đổi; chưa bao phủ toàn bộ continuation/account feeds | Giữ cho phạm vi sửa lỗi hiện tại |
| YouTube.js | Có parser và API rộng, package `youtubei.js` 18.0.0 có ESM/TypeScript, manifest ghi MIT | Chưa kiểm thử tích hợp Electron; browser cần proxy theo guide; một số flow phụ thuộc session | Ứng viên ưu tiên nếu mở rộng search/list |
| yt-dlp | Extractor rộng, tìm kiếm và playlist/channel sẵn | Python/runtime và đóng gói phức tạp hơn; flat-playlist có thể thiếu metadata | Dùng khi phạm vi tải/trích xuất cần năng lực đó |

Nguồn so sánh: [YouTube.js manifest](https://raw.githubusercontent.com/LuanRT/YouTube.js/main/package.json), [browser guide](https://ytjs.dev/guide/browser-usage), [authentication guide](https://ytjs.dev/guide/authentication), [yt-dlp README](https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/README.md). Đây là đánh giá khả năng tích hợp, chưa phải kết quả thử nghiệm ba phương án trong cùng môi trường. Không thu thập cookie hoặc dữ liệu tài khoản để làm nghiên cứu này.

### 6. E2E: tận dụng API chính thức nhưng đặt guard đúng thời điểm

Electron có `session.webRequest.onBeforeRequest` để hủy hoặc chuyển hướng request. Cần cài trước lần load đầu tiên của cửa sổ. Ví dụ kiểm thử chính thức của Playwright tạo navigation sau khi route đã đăng ký; nó không chứng minh một executable tự mở cửa sổ trong startup sẽ chờ guard được cài sau `launch()`. Giải pháp cho Enjoy phải có bằng chứng thời điểm, đồng thời kiểm tra renderer error, main stderr và process signal. ([Electron webRequest](https://raw.githubusercontent.com/electron/electron/main/docs/api/web-request.md), [Playwright Electron](https://playwright.dev/docs/api/class-electron), [Playwright tests](https://raw.githubusercontent.com/microsoft/playwright/main/tests/electron/electron-app.spec.ts))

## Vì sao không chỉ nâng Enjoy upstream

GitHub vẫn liệt kê release desktop0.7.9 ngày2025-03-07. Các PR trình phát1216,1230,1231 đã có trong lịch sử HEAD của fork, được kiểm tra bằng `git merge-base --is-ancestor`. Áp lại các commit đó không phải giải pháp mới. Danh sách thay đổi từ v0.7.9 đến main không có các file Copilot, DbProvider, WavesurferPlayer hay YouTube provider cần sửa trong đợt này. ([Enjoy release](https://github.com/ZuodaoTech/everyone-can-use-english/releases/tag/v0.7.9), [PR1216](https://github.com/ZuodaoTech/everyone-can-use-english/pull/1216), [PR1230](https://github.com/ZuodaoTech/everyone-can-use-english/pull/1230), [PR1231](https://github.com/ZuodaoTech/everyone-can-use-english/pull/1231), [compare](https://github.com/ZuodaoTech/everyone-can-use-english/compare/v0.7.9...main))

Maintainer công bố ngày 2026-02-03 rằng Enjoy đã được viết lại thành web và bản desktop tiếp theo sẽ bọc web. Thông báo này không chứng minh mã nguồn bản web mới đã được công khai, không chứng minh dữ liệu local chuyển sang được, và không phải bản vá thay trực tiếp cho fork Electron hiện tại. ([Enjoy1322](https://github.com/ZuodaoTech/everyone-can-use-english/issues/1322))

## Bằng chứng phản biện và phần chưa xác minh

- **Có release mới không đồng nghĩa sửa đúng lỗi.** Hotkeys5.3.3 vẫn yêu cầu chuỗi; WaveSurfer mới hơn có fix nội bộ nhưng caller vẫn phải có container và cleanup đúng.
- **Tắt scanner không giải quyết dependency lỗi.** `imports.scan:false` đã được thử và Nitro vẫn treo, nên workaround đó đã được gỡ.
- **Tự unpack native không chữa thiếu JavaScript dependency.** Kiểm tra `.node` riêng lẻ chưa đủ để xác nhận `universalify` có trong thành phẩm.
- **yt-dlp/YouTube.js không phải giao diện học liệu thay sẵn.** Phải giữ contract dữ liệu của Enjoy; danh sách công khai chạy được không chứng minh mọi video, khu vực, session hay tài khoản đều chạy.
- **Nguồn GitHub không đại diện cho mọi fork.** Tìm exact `universalify` trong issue upstream không có kết quả; đây là giới hạn tìm kiếm, không phải khẳng định chưa ai trên thế giới từng sửa.

## Trình tự áp dụng và nghiệm thu

1. Chấp nhận thay đổi hẹp `fdir 6.4.4` và cấu hình Yarn, giữ nguyên các bản nâng cấp lớn chưa thử.
2. Hoàn tất review hotkey/provider, DB session lifecycle và E2E startup guard.
3. Build lại Enjoy trong thư mục riêng, chạy verifier ASAR/native/SQLite và E2E trên cùng executable đó.
4. Mở bản cuối bằng tài khoản QA hiện có để kiểm tra tra từ, playback và danh sách YouTube. Phân biệt rõ kiểm thử thật với mock và phần bị skip.
5. Cập nhật hồ sơ nghiệm thu. Không coi các luồng AI trả phí, microphone, upload hay lưu tiến độ trên backend là đã kiểm thử nếu chưa thao tác và đọc lại kết quả.

Các mục này là quyết định kỹ thuật cho dự án, không phải cam kết từ nhà cung cấp thư viện. Bằng chứng tích hợp cuối sẽ được ghi riêng sau khi build và review hoàn tất.

## Phương pháp, độ tin cậy và giới hạn

- Đọc 51 URL nguồn gốc gồm source đúng tag, issue, PR, release, package manifest và tài liệu chính thức. Có 62 URL attempted ở năm nhóm, 51 URL success trong ledger và 11 URL failed hoặc fallback. Đây không phải 51 nghiên cứu độc lập. Nhiều URL cùng trace về một bản sửa.
- Bốn nhóm Luna max nghiên cứu Nuxt/fdir, packaging/E2E, React/audio/database và YouTube. Controller đối chiếu với phiên bản local, lịch sử Git, source map và thử nghiệm build/runtime.
- Kiểm tra coverage của từng JSON: mọi URL đã thử phải có trạng thái thành công hoặc thất bại; mọi fact phải dẫn về URL thành công. URL404 hoặc fetch không hỗ trợ được giữ trong nhật ký tạm, không dùng làm bằng chứng nội dung.
- Đã đọc lại nguồn của các kết luận chính: fdir issue/release, Yarn config, hotkeys type/parser, WaveSurfer maintainer/PR, yt-dlp PR, Enjoy release/roadmap.
- Không áp dụng academic API hoặc so sánh pháp luật theo quốc gia: đây là điều tra lỗi phần mềm cụ thể. Bối cảnh Việt Nam ảnh hưởng ngôn ngữ UI và dữ liệu học, không làm thay đổi cơ chế lỗi Electron/React.
- Mức 🟢 chỉ dành cho contract/source hoặc phép thử trực tiếp; 🟡 dành cho khả năng áp dụng, thông tin maintainer tự công bố và các phương án chưa tích hợp. Không lấy số sao GitHub làm bằng chứng sửa lỗi.
- Không có benchmark tốc độ, tải, bộ nhớ dài hạn; không có thử nghiệm Windows/Linux cho fork; không kiểm toán toàn bộ giấy phép và dependency. Các lỗi portal hình ảnh che nội dung và badge `NaN` được phát hiện và sửa local, Chrome 375/1280px đã kiểm chứng; chưa có evidence về exact upstream PR cho hai lỗi đó.

## Nhật ký xác minh nguồn

| # | Nguồn | Truy cập / Tier | Nội dung đã đối chiếu | Tin cậy và giới hạn |
|---|---|---|---|---|
| 1 | [thecodrr/fdir, reporter SuperchupuDev, 2025](https://github.com/thecodrr/fdir/issues/135) | Đã đọc / 1 | Direct root cause: fdir treo khi crawl / với symlink trực tiếp. Trong isRecursive, parent vẫn là / nhưng state.root là chuỗi rỗng, nên điều kiện dừng không bao giờ đạt. | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 2 | [thecodrr/fdir, contributor pralkarz, 2025](https://github.com/thecodrr/fdir/pull/137) | Đã đọc / 1 | Direct fix upstream cho root loop được merge trong PR #137. PR xác định state.root rỗng khi root là / và sửa cách chuẩn hóa root. | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 3 | [thecodrr/fdir, 2025](https://github.com/thecodrr/fdir/commit/bef3d32dafbee31922b3b3e77b0494fd519ca06c) | Đã đọc / 1 | Commit POSIX đầu tiên sửa lỗi bằng cách giữ nguyên root khi this.root là /. Trước đó code luôn slice ký tự cuối, biến / thành chuỗi rỗng. | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 4 | [thecodrr/fdir, 2025](https://github.com/thecodrr/fdir/pull/139) | Đã đọc / 1 | Follow-up PR #139 hoàn thiện direct fix cho Windows root. Bản cuối dùng isRootDirectory để giữ nguyên cả / và root dạng drive như C:\. | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 5 | [thecodrr/fdir, 2025](https://github.com/thecodrr/fdir/commit/65d500b7fc8f4f58c69c672b5a05b91be9254793) | Đã đọc / 1 | Direct follow-up commit triển khai isRootDirectory để giữ nguyên root POSIX / và root drive Windows trước khi slice trailing separator. Đây là diff bổ sung cho PR #139. | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 6 | [thecodrr/fdir, 2025](https://github.com/thecodrr/fdir/releases/tag/v6.4.4) | Đã đọc / 1 | fdir v6.4.4 là bản package đầu tiên công bố fix root crawl trực tiếp. Đây là version nên ưu tiên để thay 6.4.3. | 🟢 Source/manifest trực tiếp; giới hạn đúng phiên bản |
| 7 | [thecodrr/fdir, npm registry, 2025](https://registry.npmjs.org/fdir/6.4.4) | Đã đọc / 1 | Manifest xác nhận bản cài đặt cụ thể 6.4.4 và gitHead đúng release commit của upstream. | 🟢 Source/manifest trực tiếp; giới hạn đúng phiên bản |
| 8 | [SuperchupuDev/tinyglobby, 2024](https://github.com/SuperchupuDev/tinyglobby/issues/54) | Đã đọc / 1 | tinyglobby 0.2.7 thêm symlink resolution và có thể loop khi symlink trỏ vào parent. 0.2.9 tạm revert để giảm rủi ro, sau đó chờ fdir fix upstream. | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 9 | [SuperchupuDev/tinyglobby, 2025](https://github.com/SuperchupuDev/tinyglobby/releases/tag/0.2.13) | Đã đọc / 1 | tinyglobby 0.2.13 là release đầu tiên ghi rõ performance khi crawl / được sửa nhờ fdir upstream fix. Đây là route nâng cấp phụ, rộng hơn việc chỉ resolve fdir. | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 10 | [SuperchupuDev/tinyglobby, npm registry, 2025](https://registry.npmjs.org/tinyglobby/0.2.13) | Đã đọc / 1 | Manifest tinyglobby 0.2.13 nâng floor dependency fdir lên ^6.4.4, khớp bản root fix. Đây là bằng chứng version dependency đã được upstream điều chỉnh. | 🟢 Source/manifest trực tiếp; giới hạn đúng phiên bản |
| 11 | [nuxt/nuxt, npm registry, 2025](https://registry.npmjs.org/nuxt/3.15.4) | Đã đọc / 1 | Nuxt 3.15.4 phụ thuộc trực tiếp tinyglobby 0.2.10 và unimport ^4.0.0. Vì tinyglobby 0.2.10 vẫn dùng fdir range cũ, chỉ nâng unimport hoặc nhánh tinyglobby của unimport có thể vẫn để lại... | 🟢 Source/manifest trực tiếp; giới hạn đúng phiên bản |
| 12 | [Yarn, 2026](https://yarnpkg.com/configuration/yarnrc) | Đã đọc / 1 | Yarn node-modules có cấu hình nmSelfReferences. Khi đặt false, Yarn không tạo self-referencing symlink cho workspace; tùy chọn này có thể ghi đè theo workspace bằng installConfig.selfRe... | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 13 | [Yarn, 2022](https://github.com/yarnpkg/berry/blob/master/CHANGELOG.md) | Đã đọc / 1 | Yarn đã có lịch sử sửa đúng lớp lỗi này: 3.1.0 thêm nmSelfReferences để điều khiển self-reference; 3.3.0 tránh circular symlink; 4.0.1 sửa tạo symlink của node-modules khi inner workspa... | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 14 | [Electron Forge, issue reporter noah10, 2024](https://github.com/electron/forge/issues/3624) | Đã đọc / 1 | Forge issue #3624 mô tả local module symlink bị copy nguyên symlink vào thư mục tạm, sau đó Vite dependency copy lỗi ENOENT. Workaround được nêu là packageAfterCopy xóa các symlink đã b... | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 15 | [caoxiemeihao, electron-forge-plugin-dependencies, 2024](https://raw.githubusercontent.com/caoxiemeihao/electron-forge-plugin-dependencies/main/src/DependenciesPlugin.ts) | Đã đọc / 1 | Plugin hiện thực hóa cách thu gom production dependency cho Forge Vite/Webpack: trong packageAfterCopy, lấy direct dependencies cấu hình, gọi dependencies-tree để flatten dependency clo... | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 16 | [caoxiemeihao, dependencies-tree, 2024](https://raw.githubusercontent.com/caoxiemeihao/dependencies-tree/main/src/utils.ts) | Đã đọc / 1 | dependencies-tree dùng fs.promises.stat trong isDirectory nên dereference symlink; lookupNodeModulesPaths coi mọi ancestor/node_modules hợp lệ; resolveDependencies giữ depPath dạng chuỗ... | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 17 | [Electron Forge, 2025](https://raw.githubusercontent.com/electron/forge/v7.7.0/packages/plugin/vite/src/VitePlugin.ts) | Đã đọc / 1 | VitePlugin v7.7.0 ở prePackage build main và renderer; resolveForgeConfig đặt ignore để chỉ giữ cây /.vite; packageAfterCopy chỉ đọc package.json, kiểm tra main có .vite và ghi package.... | 🟢 Source/manifest trực tiếp; giới hạn đúng phiên bản |
| 18 | [Electron Forge, 2025](https://raw.githubusercontent.com/electron/forge/v7.7.0/packages/plugin/auto-unpack-natives/src/AutoUnpackNativesPlugin.ts) | Đã đọc / 1 | AutoUnpackNativesPlugin chỉ yêu cầu asar truthy rồi ghép glob **/{.**,**}/**/*.node vào asar.unpack. Nó tự động đưa native .node ra app.asar.unpacked nhưng không kiểm tra hoặc bổ sung J... | 🟢 Source/manifest trực tiếp; giới hạn đúng phiên bản |
| 19 | [Electron Packager, 2024](https://raw.githubusercontent.com/electron/packager/v18.3.6/src/platform.ts) | Đã đọc / 1 | Packager v18.3.6 copyTemplate gọi fs.copy với dereference: this.opts.derefSymlinks; option derefSymlinks mặc định true theo type docs cùng release. Sau đó asarApp đóng gói và xóa app so... | 🟢 Source/manifest trực tiếp; giới hạn đúng phiên bản |
| 20 | [Electron contributors, 2026](https://www.electronjs.org/docs/latest/tutorial/asar-archives) | Đã đọc / 1 | Electron coi ASAR như virtual directory cho fs.readFile và require; process.dlopen dùng cho require native module cần file thật. --unpack tạo app.asar.unpacked cạnh app.asar và thư mục ... | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 21 | [Electron contributors, 2026](https://raw.githubusercontent.com/electron/electron/main/docs/api/web-request.md) | Đã đọc / 1 | session.webRequest.onBeforeRequest là main-process hook, nhận filter urls và callback; callback có thể redirectURL hoặc cancel. Vì hook nằm trên Session, cách đáng tin để chặn request đ... | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 22 | [Microsoft Playwright, 2026](https://playwright.dev/docs/api/class-electron) | Đã đọc / 1 | Playwright Electron support là experimental. electron.launch khởi động executable và trả ElectronApplication; electronApp.evaluate chạy trong main process; firstWindow chờ cửa sổ đầu ti... | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 23 | [Microsoft Playwright, 2026](https://raw.githubusercontent.com/microsoft/playwright/main/tests/electron/electron-app.spec.ts) | Đã đọc / 1 | Test chính thức route network gọi launchElectronApp trước, tạo cửa sổ test, đăng ký app.context().route, rồi mới page.goto URL cần mock. Mẫu này chứng minh route được cài trước navigati... | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 24 | [Johannes Klauss / react-hotkeys-hook, 2026](https://raw.githubusercontent.com/JohannesKlauss/react-hotkeys-hook/v4.6.1/src/useHotkeys.ts) | Đã đọc / 1 | useHotkeys v4.6.1 khai báo keys theo type Keys rồi biến thành _keys và gọi parseKeysHookInput ở listener, proxy registration và cleanup. Khi caller truyền undefined, parser nhận undefin... | 🟢 Source/manifest trực tiếp; giới hạn đúng phiên bản |
| 25 | [Johannes Klauss / react-hotkeys-hook, 2026](https://raw.githubusercontent.com/JohannesKlauss/react-hotkeys-hook/v4.6.1/src/parseHotkeys.ts) | Đã đọc / 1 | parseKeysHookInput có chữ ký keys: string và thực thi keys.split(splitKey). Đây là exact throw path cho lỗi undefined.split; parseHotkey tiếp tục yêu cầu từng hotkey là string. | 🟢 Source/manifest trực tiếp; giới hạn đúng phiên bản |
| 26 | [Johannes Klauss / react-hotkeys-hook, 2026](https://raw.githubusercontent.com/JohannesKlauss/react-hotkeys-hook/v4.6.1/src/types.ts) | Đã đọc / 1 | Keys của react-hotkeys-hook v4.6.1 chỉ là string hoặc readonly string[], không gồm undefined. Không suy ra trạng thái của Enjoy từ file type thư viện; bằng chứng caller được ghi riêng bên dưới. | 🟢 Source/manifest trực tiếp; giới hạn đúng phiên bản |
| 27 | [Johannes Klauss / react-hotkeys-hook, 2026](https://raw.githubusercontent.com/JohannesKlauss/react-hotkeys-hook/v5.3.3/packages/react-hotkeys-hook/src/lib/parseHotkeys.ts) | Đã đọc / 1 | Parser v5.3.3 vẫn gọi keys.toLowerCase().split(delimiter), không có guard cho undefined. Vì vậy nâng từ v4.6.1 lên v5 không tự sửa startup nếu callsite vẫn truyền undefined. | 🟢 Source/manifest trực tiếp; giới hạn đúng phiên bản |
| 28 | [katspaugh / wavesurfer.js, 2026](https://raw.githubusercontent.com/katspaugh/wavesurfer.js/7.9.1/src/wavesurfer.ts) | Đã đọc / 1 | WaveSurfer 7.9.1 khởi tạo init và load trong Promise.resolve microtask, có comment cho phép external events đăng ký trước load. loadAudio phát ready sau decode; load bắt error, emit err... | 🟢 Source/manifest trực tiếp; giới hạn đúng phiên bản |
| 29 | [katspaugh / wavesurfer.js, 2026](https://raw.githubusercontent.com/katspaugh/wavesurfer.js/7.9.1/src/renderer.ts) | Đã đọc / 1 | Renderer đo parent.clientWidth qua ResizeObserver và renderMultiCanvas return sớm khi width bằng 0. Container display:none hoặc chưa có kích thước làm waveform không render; source khôn... | 🟢 Source/manifest trực tiếp; giới hạn đúng phiên bản |
| 30 | [katspaugh / wavesurfer.js maintainer, 2024](https://github.com/katspaugh/wavesurfer.js/discussions/3739) | Đã đọc / 1 | Maintainer xác nhận instance bị destroy trong lúc loading có thể tạo unhandled error, và khuyến nghị create không truyền URL, đăng ký listener trước, rồi gọi player.current.load(url).ca... | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 31 | [katspaugh / wavesurfer.js contributors, 2026](https://github.com/katspaugh/wavesurfer.js/pull/4314) | Đã đọc / 1 | PR #4314 mô tả 27 fixes trên 14 files, gồm destroyed guard sau await, _loadVersion chống reentrancy, tránh double error emission, và cleanup listener/timeout. Đây là upstream bugfix liê... | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 32 | [katspaugh / wavesurfer.js, 2026](https://github.com/katspaugh/wavesurfer.js/releases) | Đã đọc / 1 | Release notes liên kết PR #4314 vào 7.12.8 với mô tả comprehensive bug fixes và memory leak fixes; trang hiện cũng liệt kê 7.12.11. Local resolved 7.9.1 thấp hơn các release này, nên kh... | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 33 | [React team, 2026](https://react.dev/reference/react/useEffect) | Đã đọc / 1 | React yêu cầu Effect cleanup chạy trước setup mới khi dependency đổi và khi unmount. Docs minh họa biến ignore trong async Effect để stale response không set state sau cleanup; đây là m... | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 34 | [Sequelize project, 2026](https://sequelize.org/docs/v6/getting-started/) | Đã đọc / 1 | Sequelize authenticate() dùng để test connection. sequelize.close() là async và sau khi close thì instance không thể mở lại; cần tạo Sequelize instance mới. Disconnect cần await để call... | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 35 | [Sequelize project, 2026](https://raw.githubusercontent.com/sequelize/sequelize/v6.37.6/src/sequelize.js) | Đã đọc / 1 | Sequelize v6.37.6 constructor có retry mặc định max 5 cho SQLITE_BUSY: database is locked; query merge retry options. Đây là retry cho query/SQLite busy, không phải retry an toàn cho co... | 🟢 Source/manifest trực tiếp; giới hạn đúng phiên bản |
| 36 | [yt-dlp maintainers, 2025](https://github.com/yt-dlp/yt-dlp/pull/13665) | Đã đọc / 1 | yt-dlp đã merge PR #13665 vào master ngày 07/07/2025 để thêm hỗ trợ view model có content type LOCKUP_CONTENT_TYPE_VIDEO, và PR này đóng issue #13658. | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 37 | [yt-dlp maintainers, 2026](https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/yt_dlp/extractor/youtube/_tab.py) | Đã đọc / 1 | Extractor hiện tại của yt-dlp đọc contentId từ lockupViewModel; với LOCKUP_CONTENT_TYPE_VIDEO, nó tạo YoutubeIE và URL watch tương ứng, còn playlist hoặc podcast được chuyển sang Youtub... | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 38 | [yt-dlp maintainers, 2026](https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/README.md) | Đã đọc / 1 | yt-dlp hỗ trợ tìm kiếm YouTube bằng prefix ytsearch: và các bộ lọc, cùng playlist, channel và feed; đây là lựa chọn public list/search có sẵn trong extractor. | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 39 | [LuanRT và YouTube.js contributors, 2026](https://raw.githubusercontent.com/LuanRT/YouTube.js/main/package.json) | Đã đọc / 1 | Package youtubei.js của repository YouTube.js ở version 18.0.0, dùng ESM, xuất types TypeScript và có conditional exports cho Node, browser, web, agnostic và cf-worker; license trong manifest là MIT. | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 40 | [LuanRT và YouTube.js contributors, 2026](https://raw.githubusercontent.com/LuanRT/YouTube.js/main/src/parser/classes/LockupView.ts) | Đã đọc / 1 | YouTube.js có class LockupView native: parse contentImage và metadata, lấy contentId, nhận content type VIDEO, PLAYLIST và SHORT, rồi chuẩn hóa tiền tố LOCKUP_CONTENT_TYPE_. Đây là pars... | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 41 | [LuanRT và YouTube.js contributors, 2026](https://raw.githubusercontent.com/LuanRT/YouTube.js/main/src/Innertube.ts) | Đã đọc / 1 | YouTube.js cung cấp Innertube.search(query, filters) cho search có bộ lọc, cùng getChannel, getSubscriptionsFeed, getChannelsFeed, getPlaylists và getPlaylist như API surface; quyền truy cập phụ thuộc endpoint và session. | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 42 | [YouTube.js maintainers, 2026](https://ytjs.dev/guide/browser-usage) | Đã đọc / 1 | YouTube.js trong browser phải proxy request qua server riêng; guide dùng import youtubei.js/web và custom fetch. Vì vậy renderer Electron không có flow browser-side trực tiếp hoàn chỉnh... | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 43 | [YouTube.js maintainers, 2026](https://ytjs.dev/guide/authentication) | Đã đọc / 1 | Guide khuyến nghị cookie để authenticate với hầu hết web client types; OAuth2 chỉ hoạt động với TV InnerTube client do thay đổi của Google. Cách lấy cookie được mô tả là đăng nhập trong... | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 44 | [ZuodaoTech, 2025](https://github.com/ZuodaoTech/everyone-can-use-english/releases/tag/v0.7.9) | Đã đọc / 1 | GitHub latest release là v0.7.9, published_at 2025-03-07T12:24:05Z. Local enjoy/package.json cũng 0.7.9. | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 45 | [an-lee / ZuodaoTech, 2026](https://github.com/ZuodaoTech/everyone-can-use-english/issues/1322) | Đã đọc / 1 | Bản cập nhật nội dung ngày 2026-02-03 nói Enjoy đã được viết lại thành web và desktop tiếp theo sẽ bọc bản web. Không có bằng chứng từ trang này rằng mã nguồn web mới có sẵn hoặc là bản... | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 46 | [ZuodaoTech, 2024](https://github.com/ZuodaoTech/everyone-can-use-english/pull/1216) | Đã đọc / 1 | PR #1216 merged commit 5c9651c thuộc lịch sử HEAD hiện tại, đã có từ trước, không thể coi là giải pháp mới cho lỗi đang quan sát. | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 47 | [ZuodaoTech, 2024](https://github.com/ZuodaoTech/everyone-can-use-english/pull/1230) | Đã đọc / 1 | PR #1230 merged commit 0fc5773 thuộc lịch sử HEAD hiện tại. | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 48 | [ZuodaoTech, 2024](https://github.com/ZuodaoTech/everyone-can-use-english/pull/1231) | Đã đọc / 1 | PR #1231 merged 2024-12-08, commit ff093775ad549f7cdfe7038adedf68e980e526ba thuộc lịch sử HEAD hiện tại. | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 49 | [ZuodaoTech, 2026](https://github.com/ZuodaoTech/everyone-can-use-english/blob/main/enjoy/src/renderer/context/copilot-provider.tsx) | Đã đọc / 1 | Source main đã fetch vẫn gọi useHotkeys(currentHotkeys.OpenCopilot, ...). Trạng thái local và stack candidate được ghi riêng trong bảng bằng chứng local. | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 50 | [ZuodaoTech, 2026](https://github.com/ZuodaoTech/everyone-can-use-english/compare/v0.7.9...main) | Đã đọc / 1 | GitHub compare API trả16 commits sau v0.7.9. Các file thay đổi không gồm copilot-provider, DbProvider, WavesurferPlayer hoặc youtube-provider. Không chứng minh mọi fork đều chưa sửa. | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |
| 51 | [ZuodaoTech, 2026](https://github.com/ZuodaoTech/everyone-can-use-english/blob/main/LICENSE) | Đã đọc / 1 | LICENSE trong repo là GNU General Public License Version3. | 🟡 Nguồn trực tiếp; khả năng áp dụng vẫn cần thử tại Enjoy |


Nhật ký chi tiết có metadata, phương pháp đọc và giới hạn theo từng nguồn tại [sources.json](sources.json). Các URL không truy cập được hoặc đã cần fallback được ghi riêng tại [failed-sources.json](failed-sources.json); không dùng nội dung chưa đọc để chứng minh kết luận.
