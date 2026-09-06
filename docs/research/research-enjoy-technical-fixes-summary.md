---
title: "Giải pháp mã nguồn mở cho lỗi Enjoy: bản rút gọn"
date: 2026-09-06
mode: deep
sources: 51
confidence: hỗn hợp
parent: research-enjoy-technical-fixes
---

# Có mã nguồn mở đã giải quyết các lỗi hiện tại của Enjoy không?

**Có, nhưng cần chọn theo từng nguyên nhân lỗi.** Đã đối chiếu 51 tài liệu nguồn gốc với phiên bản thư viện và lỗi thực tế của fork này. [Báo cáo đầy đủ](research-enjoy-technical-fixes.md) có bảng quyết định, giới hạn và nhật ký nguồn.

| Vấn đề | Kết quả nghiên cứu | Hướng áp dụng |
|---|---|---|
| Portal build treo | 🟢 fdir 6.4.4 sửa đúng vòng lặp khi quét `/` | Đã thử trước/sau và generate thành công; ghim bản sửa này |
| Thiếu module trong app đóng gói | 🟡 Yarn có `nmSelfReferences: false`; Electron có quy tắc ASAR/native rõ ràng | Phòng ngừa self-reference ở install mới, giữ guard và verifier; chưa chứng minh nguyên nhân artifact cũ |
| Gõ phím gây `undefined.split` | 🟢 Enjoy truyền giá trị sai contract của react-hotkeys-hook | Sửa default map và dữ liệu cấu hình; nâng thư viện riêng lẻ không đủ |
| Audio và YouTube | 🟡 WaveSurfer có hướng dẫn/bản sửa lifecycle; yt-dlp và YouTube.js đã xử lý lockup view model | Dùng pattern và parser phù hợp; chưa cần thay toàn bộ kiến trúc |
| DB sau logout và E2E startup | 🟡 React/Sequelize/Electron có API phù hợp, nhưng cần logic theo phiên của Enjoy | Generation, serialize connect/disconnect, cài network guard trước load |

Nguồn: [fdir 6.4.4](https://github.com/thecodrr/fdir/releases/tag/v6.4.4), [Yarn config](https://yarnpkg.com/configuration/yarnrc), [hotkeys 4.6.1](https://raw.githubusercontent.com/JohannesKlauss/react-hotkeys-hook/v4.6.1/src/types.ts), [WaveSurfer maintainer](https://github.com/katspaugh/wavesurfer.js/discussions/3739), [yt-dlp fix](https://github.com/yt-dlp/yt-dlp/pull/13665), [React cleanup](https://react.dev/reference/react/useEffect).

**Điều cần biết trước khi áp dụng:** các PR trình phát Enjoy từ năm 2024 đã nằm trong lịch sử Git của fork. Thông báo Enjoy mới chuyển sang web không chứng minh có mã nguồn web để thay trực tiếp cho Electron hiện tại. ([PR 1231](https://github.com/ZuodaoTech/everyone-can-use-english/pull/1231), [thông báo 2026](https://github.com/ZuodaoTech/everyone-can-use-english/issues/1322))

Khuyến nghị là tiếp tục sửa fork hiện tại bằng các bản sửa hẹp đã xác minh. Nếu sau này mở rộng tìm kiếm YouTube và continuation, YouTube.js là ứng viên phù hợp để thử trong Electron main. Chưa có kết quả tích hợp cho phép cam kết chuyển thư viện sẽ tự sửa toàn bộ lỗi. ([YouTube.js parser](https://raw.githubusercontent.com/LuanRT/YouTube.js/main/src/parser/classes/LockupView.ts), [browser guide](https://ytjs.dev/guide/browser-usage))

Năm nguồn nên đọc trước:

1. [fdir 6.4.4](https://github.com/thecodrr/fdir/releases/tag/v6.4.4): bản sửa khớp trực tiếp với lỗi build.
2. [Yarn nmSelfReferences](https://yarnpkg.com/configuration/yarnrc): cấu hình phòng ngừa self-link.
3. [WaveSurfer discussion 3739](https://github.com/katspaugh/wavesurfer.js/discussions/3739): pattern load và cleanup từ maintainer.
4. [yt-dlp PR 13665](https://github.com/yt-dlp/yt-dlp/pull/13665): hỗ trợ `LOCKUP_CONTENT_TYPE_VIDEO`.
5. [react-hotkeys-hook Keys](https://raw.githubusercontent.com/JohannesKlauss/react-hotkeys-hook/v4.6.1/src/types.ts): contract giúp phân biệt lỗi caller với lỗi thư viện.

Bằng chứng build và runtime cuối được nghiệm thu riêng. Chưa coi các luồng AI trả phí, microphone, upload hoặc lưu tiến độ trên backend là đã kiểm chứng.

Cập nhật tích hợp: candidate2 verifier PASS, 6 E2E PASS, 3 native model SKIP. App đã mở bằng hồ sơ QA GitHub. Review Luna cuối về packaging/DB và inventory chưa hoàn tất vì usage limit.
