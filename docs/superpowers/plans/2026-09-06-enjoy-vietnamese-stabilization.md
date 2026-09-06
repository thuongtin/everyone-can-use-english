# Kế hoạch ổn định bản Enjoy Anh - Việt

> **For agentic workers:** Use superpowers:subagent-driven-development to execute the assigned task. Steps use checkbox syntax. The controller dispatches implementation and review; workers do not spawn agents.

**Goal:** Xử lý các lỗi còn lại của bản Việt hóa, tạo bản Enjoy mở được và có kiểm chứng tra từ hai chiều, đồng thời ghi rõ giới hạn của kiểm thử tài khoản thật.

**Architecture:** Giữ kiến trúc Electron, React và Nuxt hiện tại. Tách chính sách phân phối khỏi dịch vụ tài khoản upstream; dùng cấu hình build cho liên kết và cập nhật. Kiểm thử logic bằng fixture cục bộ, kiểm thử bản đóng gói bằng thư mục dữ liệu riêng, đối chiếu phiên thật ở bước nghiệm thu.

**Tech Stack:** Electron 34, Electron Forge 7, React 18, TypeScript 5, Playwright, Node 24, Nuxt 3, SQLite.

**Spec:** Yêu cầu trong task hiện tại: Việt hóa toàn bộ để người Việt học tiếng Anh, thay bằng Anh - Việt và Việt - Anh, sửa lỗi khởi động, lập plan và điều phối Luna mức max thực thi. Bảy phát hiện của lần phân tích vừa rồi là phạm vi bên dưới.

## Global Constraints

- Mọi agent thực thi và review dùng `gpt-5.6-luna`, reasoning effort `max`.
- Giao tiếp và báo cáo bằng tiếng Việt có dấu; code, identifier, log và inline comment bằng English. Không dùng ký tự U+2014.
- Đang có nhiều thay đổi Việt hóa chưa commit. Không reset, clean, stage, commit, push, publish hoặc ghi đè thay đổi của người khác.
- Thực thi trên nhánh `codex/enjoy-vietnamese-stabilization`; giữ dữ liệu hiện có trong worktree. Bản build và runtime QA dùng thư mục tạm riêng.
- Không đọc ra token, mật khẩu hay thông tin định danh. Không tạo tài khoản, gửi OTP, prompt AI tính phí hoặc upload học liệu. Không sao chép tài khoản QA vào hồ sơ mặc định.
- Không thay URL backend tài khoản hoặc đoán domain triển khai. Repo đã xác minh: `https://github.com/thuongtin/everyone-can-use-english`.
- Không thử lại yêu cầu imagegen đã bị từ chối. Dùng giao diện HTML/CSS hoặc ảnh chụp thật khi phục hồi demo; không ghi ảnh chưa xem là đã review.
- Không coi mock login là đăng nhập thật, build thành công là kiểm chứng nội dung, hoặc quét chữ Hán là kiểm chứng media.
- Không cài dependency mới nếu runtime và thư viện hiện có đáp ứng được. Node dùng `/opt/homebrew/opt/node@24/bin/node`.
- Worker chỉ sửa các tệp thuộc nhiệm vụ, đọc thêm theo dependency cần thiết, ghi report và bàn giao reviewer. Không tự tạo subagent.

## Thứ tự và quyền sở hữu

Task 2 và Task 3 được thực thi đồng thời vì sở hữu hai cây tệp độc lập Enjoy và portal. Task 4 có thể chuẩn bị scripts và E2E độc lập, nhưng chỉ sửa forge.config.js sau khi Task 2 bàn giao. Task 5 tổng hợp sau nghiệm thu. Controller chuẩn bị môi trường và đối chiếu trạng thái chỉ đọc trong lúc worker sửa code. Sau mỗi nhiệm vụ, một reviewer độc lập kiểm tra cả yêu cầu và chất lượng bằng diff so với snapshot đầu task. Không tạo commit để lấy diff.

### Task 1: Giữ player hoạt động khi transcript thiếu hoặc lỗi

**Files:**
- Modify: `enjoy/src/renderer/components/posts/post-audio.tsx`.
- Create: `enjoy/src/renderer/lib/post-audio-transcription.ts` nếu cần tách logic request và chọn segment để kiểm thử trực tiếp.
- Create: `enjoy/scripts/check-post-audio.mjs`.

**Interfaces:** Consumes `webApi.transcriptions({ targetMd5 })`, response có thể thiếu hoặc có `transcriptions: []`; Produces component `PostAudio` giữ nguyên props. Helper phải được component sử dụng, không sao chép implementation vào test.

- [x] Viết kiểm tra hồi quy bằng `node:assert/strict`, load TypeScript qua `typescript.transpileModule` hoặc compiler có sẵn. Các case bắt buộc: response rỗng, thiếu result, malformed result object, reject request, đổi md5 trong lúc request pending, unmount, thiếu API và thiếu sourceUrl.
- [x] Sửa effect theo mẫu vòng đời dưới đây; request lỗi hoặc thiếu transcript chỉ xóa transcript, không thay player bằng lỗi transcript. Chọn segment chỉ trên array đã kiểm tra shape.

```tsx
useEffect(() => {
  let active = true;
  setTranscription(undefined);
  setCurrentTime(0);
  setError(null);
  if (!webApi || !audio.md5) return;
  Promise.resolve().then(() => webApi.transcriptions({ targetMd5: audio.md5 }))
    .then((response) => {
      const item = response?.transcriptions?.[0];
      if (active && item?.targetMd5 === audio.md5) setTranscription(item);
    }).catch(() => { if (active) setTranscription(undefined); });
  return () => { active = false; };
}, [webApi, audio.md5]);
```

- [x] Bảo vệ sourceUrl trước `.match`; lỗi phát media vẫn dùng UI retry hiện có. Không thêm thông báo thành công giả khi không có transcript.
- [x] Chạy `node enjoy/scripts/check-post-audio.mjs` và `node enjoy/node_modules/typescript/bin/tsc --noEmit -p enjoy/tsconfig.json` bằng Node 24. Report các case đạt và diff tệp đã sửa.

### Task 2: Tách kênh cập nhật và hoàn thiện giao diện tiếng Việt

**Files:**
- Modify: `enjoy/src/constants/index.ts`, `enjoy/src/main/window.ts`, `enjoy/forge.config.js`, `enjoy/vite.base.config.ts`, `enjoy/vite.renderer.config.ts`, `enjoy/src/renderer/context/app-settings-provider.tsx`.
- Modify when needed: `enjoy/src/renderer/components/layouts/title-bar.tsx`, `enjoy/src/renderer/components/preferences/about.tsx`, nơi render UpgradeNotice trong `enjoy/src/renderer/pages/home.tsx`.
- Modify: `enjoy/src/renderer/components/login/bandu-login-form.tsx`, `enjoy/src/renderer/components/login/login-form.tsx`, `enjoy/src/renderer/components/ui/pagination.tsx`, `enjoy/src/renderer/components/widgets/lookup/lookup-widget.tsx`, `enjoy/src/i18n/en.json`, `enjoy/src/i18n/vi.json`, interceptor HTTP trong `enjoy/src/api/client.ts`.
- Create: `enjoy/src/constants/distribution.ts`, `enjoy/src/utils/api-error-message.ts`, `enjoy/scripts/check-distribution.mjs`, `enjoy/scripts/check-api-errors.mjs`.

**Interfaces:** Produces policy từ build environment `ENJOY_UPDATE_FEED_URL`, `ENJOY_DOWNLOAD_URL`, `ENJOY_DOCS_URL`, `ENJOY_REPO_URL`. Không có feed hợp lệ thì update bị tắt ở main và renderer. Mặc định repo là fork đã xác minh, docs/download dùng trang source trong fork khi chưa có website công khai. API/WS của tài khoản giữ nguyên.

- [x] Tạo chính sách thuần để test bằng input environment. URL phải là http/https phù hợp; update feed chỉ nhận HTTPS, không nhận credential trong URL. Feed cấu hình là URL cuối cùng do người build cung cấp, không tự thêm đường dẫn platform. Không có feed thì không setFeedURL/checkForUpdates/quitAndInstall; UI giải thích bản này chưa cấu hình cập nhật tự động và dẫn nguồn cài đặt bản Việt.

```ts
export type DistributionConfig = {
  updateFeedUrl?: string;
  repositoryUrl: string;
  docsUrl: string;
  downloadUrl: string;
};
// Export a pure resolver and one build-configured constant.
// Use the same resolved policy for main-process IPC and renderer controls.
```

- [x] Loại bỏ đường update upstream khỏi maker mặc định và không lấy `webApi.config("app_version")` làm thông báo nâng cấp cho fork. Giữ các config khác như IPA. Không sửa publishers để tự publish.
- [x] Dịch nhãn menu main bằng i18next gồm Edit/Help/Check for Updates/Report an Issue và nhãn role cần hiển thị; không phá accelerator/role. Điều hướng trợ giúp/báo lỗi dùng policy. Dịch các aria-label phân trang và sr-only More pages đã thấy còn English trong khóa học, dùng locale chung.
- [x] Sửa popover tra từ trong bài bị title bar che phần đầu ở cửa sổ 1280x720: đặt collisionPadding đủ tránh title bar (top 40, các cạnh khác 16), giới hạn width theo viewport và height theo Radix available-height; phần nghĩa cuộn bên trong, header chọn từ điển vẫn truy cập được. Controller kiểm chứng bằng CUA trên artifact cuối.
- [x] Bandu là lựa chọn tùy chọn, có giải thích tiếng Việt về tài khoản/số điện thoại đã được Bandu hỗ trợ; nêu GitHub/email là lựa chọn có sẵn. Không tự tuyên bố hỗ trợ OTP Việt Nam hoặc đổi backend contract. Loại bỏ cảm giác bắt buộc dùng số Trung Quốc ở luồng mặc định.
- [x] Tạo mapper lỗi API cho network/timeout/401/403/429/5xx và fallback an toàn bằng locale, dùng tại interceptor chung. Giữ original error/cause cho chẩn đoán nội bộ, không ghi token/request headers vào log; không đưa raw backend message có thể là tiếng Trung vào toast.
- [x] Viết kiểm tra trực tiếp resolver và mapper: thiếu feed, feed HTTPS riêng, URL javascript/file/credential bị loại, các mã lỗi nêu trên, locale fallback. Chạy hai scripts mới, `check-localization.mjs` và TypeScript. Report thay đổi consumer updater đầy đủ.

### Task 3: Khôi phục demo portal và sửa đường dẫn bản Việt

**Files:**
- Modify: `1000h-portal/components/DemoScreen.vue`, `1000h-portal/components/Slogan.vue`, `1000h-portal/components/Introduction.vue`, `1000h-portal/components/layout/PageHeader.vue`, `1000h-portal/nuxt.config.ts`.
- Create: `1000h-portal/utils/distribution-links.ts`, `1000h-portal/README.md`.
- Không sửa binary media hoặc localization ledger ở task này.

**Interfaces:** Consumes runtime public config có `docsUrl`, `downloadUrl`, `repositoryUrl`, lấy environment `NUXT_PUBLIC_DOCS_URL`, `NUXT_PUBLIC_DOWNLOAD_URL`, `NUXT_PUBLIC_REPOSITORY_URL`. Canonical site URL chỉ xuất hiện khi `NUXT_SITE_URL` hợp lệ được cấu hình. Không fallback `example.com`.

- [x] Khôi phục khu vực nội dung DemoScreen đã bị xóa: render thẻ học liệu tiếng Anh với hướng dẫn Việt hoặc dùng content1/content2 hiện đã dịch sau khi xem ảnh. Demo phải có nhãn minh họa rõ và nội dung nhìn được trên mobile/desktop, không chỉ sidebar rỗng.

```vue
<section class="content-container" aria-label="Minh họa thư viện học liệu">
  <article v-for="item in examples" :key="item.title">
    <h3>{{ item.title }}</h3><p>{{ item.description }}</p>
  </article>
</section>
```

- [x] Các CTA hướng dẫn, tải app và repo dùng chung config; fallback source README/install trong repo fork đã xác minh. Giữ attribution nguồn gốc khi mang tính lịch sử, không quảng bá upstream như bản Việt đang được phân phối.
- [x] Xóa site.url placeholder, cho zoom trình duyệt hoạt động. README giải thích cấu hình build/static và ví dụ địa chỉ local, không đoán domain production.
- [x] Generate bằng `node 1000h-portal/node_modules/nuxt/bin/nuxt.mjs generate 1000h-portal` nếu CLI hỗ trợ, hoặc chạy CLI trong cwd portal. Kiểm tra output không có `example.com` và CTA upstream không còn ở UI chính. Controller kiểm tra portal bằng browser ở 375/1280px sau build; worker report route và file output.

### Task 4: Kiểm thử độc lập và chặn tái phát lỗi đóng gói

**Files:**
- Modify: `enjoy/e2e/renderer.spec.ts`, `enjoy/e2e/main.spec.ts`, `enjoy/playwright.config.ts`, `enjoy/package.json`, `enjoy/forge.config.js` (chỉ guard đóng gói, giữ policy Task 2).
- Modify after runtime diagnosis: `enjoy/src/renderer/context/db-provider.tsx`, chặn auto-connect trước khi có user/library và giữ reconnect đúng vòng đời.
- Create: `enjoy/e2e/helpers/isolated-app.ts`, `enjoy/e2e/offline-dictionary.spec.ts`, `enjoy/scripts/check-packaged-app.mjs`, `enjoy/scripts/check-package-guard.mjs`; helper guard nếu cần đặt `enjoy/scripts/package-guard.mjs`.

**Interfaces:** Consumes package path từ `ENJOY_E2E_APP_PATH`, runtime Node-mode Electron từ `ENJOY_ELECTRON_NODE_PATH` hoặc electron dev dependency đã cài. Mỗi launch dùng `mkdtemp` cho settings/library/chromium, teardown chỉ dọn thư mục do test tạo. Regression scripts Task 1/2 trở thành scripts package rõ ràng.

- [ ] Xóa credential fixture giống token thật khỏi E2E. Tất cả traffic HTTP/WS của test fixture phải được chặn hoặc mock trước navigation, không gửi fake auth tới enjoy.bot. Test fixture phải tự ghi nhãn mock và không dùng dữ liệu user thật.
- [x] Thêm E2E mở bản đóng gói chưa đăng nhập, tra `learn` theo Anh - Việt và `học` theo Việt - Anh, kiểm tra nghĩa thực từ SQLite và giữ chiều tra sau relaunch cùng test profile. Assert console/pageerror và lỗi main process, không chỉ kiểm tra title trang.
- [x] Kiểm tra đường settings/library E2E cũ dùng `test-results` cố định; chuyển sang helper isolated, không tự tải model nặng trong bộ smoke. Các bài native cần tải model phải là suite explicit opt-in hoặc ghi yêu cầu riêng.
- [x] Tách guard recursive symlink thành helper test được; chỉ unlink đúng symlink `node_modules/node_modules` trỏ về root node_modules. Không xóa directory thật hoặc symlink sang nơi khác; xử lý missing path. Đường dẫn dựa project config, không cwd tình cờ.
- [x] Artifact verifier chạy trên `.app` thật: đọc ASAR, phát hiện path recursion, assert production dependencies `fs-extra`, `universalify`, `sqlite3`, `sequelize`, `onnxruntime-node` load được qua Electron Node-mode, hai SQLite được unpack và query từ thật. Không coi `require.resolve` là load native module thành công.
- [ ] Chạy unit guard và cập nhật scripts. Controller tạo artifact cuối sau khi review task rồi chạy verifier/E2E trên artifact đó; worker có thể dùng bản hiện có để kiểm thử harness nhưng phải ghi rõ artifact cũ.

### Task 5: Nghiệm thu và cập nhật trạng thái chính xác

**Files:**
- Modify: `localization/README.md`, `localization/verification-notes.md`, `execution-notes.md`, inventory/review JSON chỉ khi có bằng chứng tương ứng.
- Modify: `localization/inventory_media.py`, `localization/test_media_reviews.py`, tạo `localization/inventory_paths.py` nếu cần bao gồm untracked non-ignored media mà không stage Git.

**Interfaces:** Consumes report Task 1-4 và bằng chứng runtime do controller cung cấp. Produces trạng thái mới có thời gian, lệnh kiểm chứng và giới hạn; lịch sử trước đó được gắn nhãn lịch sử.

- [x] Controller tạo bản build độc lập bằng `ditto enjoy <temporary-directory>` rồi chạy Forge với Node 24. Không chép đè artifact đang mở. Chạy artifact verifier, E2E từ điển, i18n, TypeScript và portal/docs build thích hợp.
- [x] Controller đối chiếu chỉ đọc hồ sơ mặc định và `/tmp/enjoy-vi-qa/settings` bằng boolean có user, không xuất định danh/credential. Khi cần mở app QA dùng đúng hồ sơ cũ, không migrate tài khoản tự động. Xác minh nghe/học liệu/tra từ có thể làm trong phạm vi dữ liệu hiện có; không giả kết quả AI hoặc tiến độ nếu chưa thao tác thật.
- [x] Worker cập nhật inventory nhận cả tracked và untracked non-ignored media, không theo symlink hay mở file nhạy cảm kể cả bước hash; giữ tests bảo vệ. Khoảng trống đã xác nhận ở dòng 17 và vòng hash của inventory_media.py. Tách danh sách asset khỏi nguồn tìm references: loại chính inventory/ledger JSON và tài liệu điều phối (localization/, docs/superpowers/, execution-notes.md) khỏi reference scan vì không phải nơi dùng media trong sản phẩm, tránh tự tham chiếu vô hạn. Vẫn kiểm kê media mới trong các thư mục sản phẩm. Test bằng repo Git tạm có tracked/untracked/ignored/symlink/sensitive fixture; không stage worktree thật.
- [x] Worker cập nhật trạng thái hiện tại trên đầu tài liệu dựa bằng chứng đã bàn giao; phân biệt lỗi đã sửa, kiểm thử mock, luồng thật và dependency bên ngoài. Ba asset từng bị imagegen từ chối và 64 URL media ngoài vẫn phải ghi rõ nếu chưa có bằng chứng mới.
- [ ] Reviewer cuối kiểm tra diff toàn bộ Task 1-5 và nghiệm thu artifact, xác nhận không mất bản dịch/tài khoản, không có thông báo hoàn tất vượt quá bằng chứng. Controller trả plan, app artifact và các phụ thuộc còn lại bằng đường dẫn có thể mở.

### Task 6: Xử lý lỗi runtime phát hiện khi dùng tài khoản thật

**Files:**
- Modify: `enjoy/src/renderer/components/misc/wavesurfer-player.tsx`, `enjoy/src/main/providers/youtube-provider.ts`.
- Create when needed: `enjoy/src/renderer/lib/wavesurfer-lifecycle.ts`, `enjoy/src/main/providers/youtube-video-parser.ts`.
- Create: `enjoy/scripts/check-wavesurfer-player.mjs`, `enjoy/scripts/check-youtube-parser.mjs`.
- Không sửa locale, package.json, forge, API client hoặc file của worker khác. Dùng các key dịch hiện có nếu cần hiển thị lỗi.

**Interfaces:** `WavesurferPlayer` giữ props hiện có; `onError` là optional. `YoutubeProvider.extractVideos(html)` giữ kết quả danh sách video gồm title, thumbnail, videoId và duration optional. Task 5 tổng hợp trạng thái cuối sau Task 6; build cuối phải bao gồm Task 6.

- [x] Đọc bằng chứng trong `.superpowers/sdd/2026-09-06-enjoy-vietnamese-stabilization/runtime-evidence.md`. Chẩn đoán source trước khi sửa: skeleton vẫn tồn tại khi đã cuộn tới player; source tạo WaveSurfer vào container đang hidden, đợi ready để bỏ hidden, đăng ký ready/error ở effect sau create và gọi onError không kiểm tra.
- [x] Viết test thực thi component hoặc helper được component sử dụng: init khi giao nhau một phần, container đo được chiều rộng khi loading, đăng ký listener trước load, ready chuyển trạng thái, lỗi khi không có callback không throw, retry tạo lại instance và load lại cùng URL, đổi src/unmount hủy instance/timer và bỏ callback cũ. Có thể dùng WaveSurfer fake cho lifecycle nhưng không sao chép logic component vào test.
- [x] Sửa theo kết quả chẩn đoán: giữ container trong layout khi loading, skeleton phủ lên thay vì display:none; tạo instance rồi đăng ký listener trước `load(src)`; đóng lifecycle trong một effect có cleanup, dùng ref/callback hiện tại, reset đúng khi retry hoặc đổi src. Nếu vẫn không có bằng chứng phát từ upstream, report rõ để controller kiểm tra sau build.

```ts
const ws = WaveSurfer.create({ container, ...options });
const removeReady = ws.on("ready", handleReady);
const removeError = ws.on("error", handleError);
void ws.load(src).catch(handleLoadRejection);
// Cleanup removes listeners, clears scheduled work and destroys this instance.
```

- [x] Parser YouTube phải kiểm tra các node không phải video và field thiếu trước khi đọc. Không để một quảng cáo/short/mục tiếp trang làm mất toàn bộ danh sách video hợp lệ. Tách parser thuần dùng trực tiếp từ provider nếu cần; giữ shape output và không thay network/auth.
- [x] Test parser bằng HTML fixture chứa script ytInitialData: video hợp lệ, một richItem không có videoRenderer xen giữa hai video hợp lệ, thiếu thumbnail/title/id, thiếu tabs, invalid JSON và HTML không có data. Không gọi YouTube thật trong tests.
- [x] Chạy scripts mới và TypeScript với Node 24. Report rõ phần có test fixture và phần controller còn phải xác minh từ mạng thật. Reviewer kiểm tra cả spec và quality bằng diff riêng trước build cuối.

## Mốc bàn giao sau nghiên cứu

Candidate2 build/verifier và 6 E2E PASS; 3 native model SKIP. Bundle mới đã mở bằng hồ sơ QA. Báo cáo lưu trong docs/research. Task4 implementation và runtime có bằng chứng controller; checkbox review cuối giữ mở vì Luna chạm usage limit. Task5 inventory đã refresh nhưng 26 context còn chờ review, 3 asset unused còn pending. Không tuyên bố toàn bộ Việt hóa hoàn tất.
