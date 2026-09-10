# Nghiệm thu trang sơ đồ học tự động

Ngày: 2026-09-07. Trạng thái: đã triển khai và nghiệm thu trên Enjoy đóng gói cho macOS arm64.

## Hành vi đã hoàn tất

Người học vào Xưởng bài học, chọn Mindmap mới, nhập chủ đề và trình độ rồi bấm Tạo trang học. App tự tạo nội dung, chia nhóm và dàn trang. Bản đọc có IPA, nghĩa Việt, ví dụ song ngữ, chi tiết từ và quan hệ có hướng, cùng nút che hoặc hiện nghĩa. Không cần kéo thả hoặc thu nhỏ canvas để xem toàn bộ sơ đồ.

Mỗi trang có tối đa hai nhóm, mỗi nhóm tối đa sáu từ. Container queries điều chỉnh theo vùng đọc thực. Nội dung tiếp tục theo chiều dọc khi cần, không co chữ để ép vào một trang cố định. Sơ đồ cũ không có metadata nhóm được chia theo thứ tự node đã lưu, giữ mọi node, edge và vị trí cũ.

Codex và Claude tạo phần chữ qua ACP. Khi bật minh họa, ảnh từng nhóm được tạo bằng Codex native và lưu vào asset slot của đúng revision. Phần chữ dùng được ngay khi đã hoàn tất, trong lúc ảnh tiếp tục chạy. Ảnh được hiển thị trọn vẹn bằng contain; không cắt đầu hoặc tay như khung cover ban đầu.

## Cơ sở nghiên cứu

- [Đối chiếu giải pháp bố cục](../research/2026-09-07-automatic-study-map-layout.md): chọn HTML document flow kết hợp SVG đo theo DOM, phù hợp trang đọc tự trình bày và phân trang.
- [Nghiên cứu học từ có minh họa](../research/2026-09-07-illustrated-vocabulary-learning.md): sáu paper, phân biệt bằng chứng nghiên cứu với suy luận thiết kế. Nhóm từ theo ngữ cảnh, đặt ảnh và chữ gần nhau, ví dụ song ngữ và thao tác tự nhớ nghĩa. Không tuyên bố hiệu quả học tập của app đã được đo bằng thử nghiệm người dùng.
- [Design contract](2026-09-07-automatic-study-map-design.md).

## Bằng chứng thực thi

Thư mục artifact: `enjoy/tmp/automatic-study-map/2026-09-07`.

| Kiểm tra | Kết quả | Bằng chứng |
| --- | --- | --- |
| TypeScript toàn Enjoy và scoped ESLint | PASS | Các lệnh Node 24 canonical, `final-lint.log` |
| Backend và SQLite | PASS | `backend-report.md`: contracts, migration, storage, MCP application, native assets/generation, controller, jobs, runtime, asset protocol, DB integration |
| Review backend độc lập | Không có finding cần sửa | `backend-review.md`, đối chiếu source snapshot trước task |
| Presenter và host DOM | PASS | `final-presenter-check.log`, `final-host-check.log`, worker reports |
| Sơ đồ cũ 40 node | PASS | `packaged-final` và `packaged-polished`: đủ 39 từ nhánh cùng root, rộng 1440 và hẹp 720, không chồng hoặc tràn chữ, mọi từ cuộn tới được, vị trí SQLite không đổi |
| Codex thật | PASS | `packaged-final/.../codex-study-map-receipt.json`: một submit, một job, 13 node, 3 nhóm, 3 ảnh native thật, SHA256 ảnh khớp bytes đã lưu |
| Claude thật | PASS | `packaged-final/.../claude-study-map-receipt.json`: một submit, một job, 13 node, 3 nhóm, không yêu cầu ảnh |
| Khởi động lại offline | PASS | Hai receipt AI thật giữ nguyên graph, brief và asset sau cold restart; ảnh decode thành công |
| Bản trình bày cuối với ảnh thật đã lưu | PASS | `packaged-polished/.../restored-actual-receipt.json`: khôi phục bản sao SQLite và ba ảnh thật vào profile kiểm thử mới, kiểm offline và SHA256, không gọi inference mới |
| Bài học, practice, audio và restart | PASS | `learning-studio.spec.ts` trên final package; nội dung fixture và âm tone được ghi rõ, không nhận là speech inference thật |
| Cấu trúc bản đóng gói và native dependencies | PASS | `package-check-final.log`; package hook ký và verify ad-hoc bundle |
| Dữ liệu thật sau migration | PASS | `live-data-migration-receipt.json`: 27 bảng bằng nhau trên các cột cũ; thêm một migration; một dòng cache chỉ đổi `updated_at`; integrity_check = ok |

Lần inference thật và kiểm restart gồm 4 E2E PASS trong 6 phút. Sau đó chỉ thay presenter TSX/CSS để sửa crop và thu gọn bố cục. Bản đóng gói cuối được kiểm lại bằng 3 E2E PASS, gồm legacy 40 node, mở lại chính output AI đã lưu và regression bài học/practice/audio. Backend generation không thay đổi giữa hai lần.

Bản cuối: `enjoy/out/Enjoy-darwin-arm64/Enjoy.app`.
SHA256 của `Contents/Resources/app.asar`: `ca2c4ea6a58c62f1fe05363ae7a34ff1118fa8a78e85254757568ffbb8371478`.
Danh tính đầy đủ được lưu trong `final-package-identity.json`.

## Kiểm tra nội dung và hình bằng mắt

Đã đọc 26 node của hai output thực, IPA, nghĩa Việt và ví dụ nhóm. Các nhóm body parts và train station phù hợp chủ đề; không thấy lỗi ngữ pháp rõ ràng trong những ví dụ đã tạo. Mục stomach dùng nghĩa thông dụng chỉ vùng bụng. Output AI giữ evidence là unverified, không gắn nhãn đã xác minh từ điển.

Đã xem cả ba file ảnh gốc: hình đầu và mặt có bốn tư thế chỉ bộ phận, hình cánh tay thể hiện khuỷu tay, bàn tay và năm ngón, hình thân mình có góc trước và sau. Đây là minh họa theo nhóm và ngữ cảnh, không phải sơ đồ giải phẫu có nhãn riêng cho từng từ. Screenshot cuối giữ trọn ảnh, chữ đọc được và có ví dụ song ngữ bên dưới.

Ảnh trang cuối để xem: `packaged-polished/automatic-study-map-saved--4c80d-ations-on-the-final-package/restored-wide-page-1-sheet.png`.

Đã mở bản cuối bằng giao diện macOS trên hồ sơ Ethan. Xưởng bài học vẫn hiển thị một bài A Coffee Order và không có map thử nghiệm. Form mới có Chủ đề hoặc từ khóa, Trình độ A2 và Tạo trang học. Các lần tạo dữ liệu nghiệm thu đều nằm trong profile kiểm thử riêng.

## Giới hạn nghiệm thu

Chưa kiểm xuất PDF/in giấy, thử nghiệm học tập với người dùng hoặc speech inference mới cho node trong task này. Form và ảnh mới không thay đổi cơ chế xác thực hoặc nội dung thư viện thật. Task chưa thực hiện commit, push hoặc deploy.
