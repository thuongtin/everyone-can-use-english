# Automatic Study Map Implementation Plan

> Thực hiện bằng subagent-driven-development trong task hiện tại. User đã yêu cầu nghiên cứu và triển khai. Spec: [automatic-study-map-design](./2026-09-07-automatic-study-map-design.md).

Mục tiêu: sơ đồ học từ tự trình bày như trang sách, có hình thật, mở lại offline. Giữ source/data baseline hiện tại, không commit/push/deploy.

## Task 1: Contract, storage và image pipeline

- [x] Mở schema/types với MapBrief, studyGroups và IPA; giữ legacy parse; validate generation mới chặt.
- [x] Migration revision brief, controller/createMap/reviseMap/getJobContext.
- [x] Map group image source/slot/hash/stage, reuse native image drain, retry/revision guards.
- [x] Bổ sung test có giá trị cho dữ liệu cũ, partition, migration và image lifecycle; chạy focused checks/typecheck/lint.
- [x] Root và reviewer kiểm diff so với source-before, xử lý finding.

Ownership: backend worker sở hữu learning-schemas/types/learning, learning-models/new migration, learning storage/service/controller/native-generation/native-assets và checker tương ứng. Không sửa renderer.

## Task 2: Trang học tự dàn

- [x] Tạo presenter helper chia nhóm/trang deterministic và fallback legacy.
- [x] Thay default MindmapView bằng trang giấy, topic/nhánh màu, từ/IPA/nghĩa, group image, example, detail/reveal/audio.
- [x] Giữ API props cũ để không xóa persisted layout; thêm image resolver props theo spec.
- [x] Kiểm DOM semantic/partition/no positions write và browser geometry ở kích thước rộng/hẹp/40 node.
- [x] Root xem screenshot và reviewer kiểm correctness/accessibility.

Ownership: renderer worker sở hữu mindmap-view.tsx, mindmap-study-layout.ts, mindmap-study.css và check-learning-mindmap-view.mjs. Không sửa host hoặc backend.

## Task 3: Luồng tạo một lần bấm và tích hợp asset

- [x] Form topic/level/advanced provider, hình theo capability; giữ input khi lỗi.
- [x] createMap -> generate trực tiếp từ returned revision IDs, chặn stale navigation và duplicate request.
- [x] Truyền ảnh đúng revision và trạng thái generation/retry tới view. Ưu tiên nội dung học khi ready.
- [x] Cập nhật targeted host checks theo thay đổi UX có chủ đích.
- [x] Review source/state lifecycle.

Ownership: integration worker sở hữu learning-studio.tsx và check-learning-studio.mjs. Contract phụ thuộc Task 1, renderer props phụ thuộc Task 2, phối hợp thông qua spec và root.

## Task 4: Runtime, visual và báo cáo

- [x] Root viết E2E automatic-study-map riêng và cập nhật phần test cũ bị thay UX có chủ đích.
- [x] Chạy checks đã thống nhất, build signed package, exact-source fingerprint.
- [x] Chạy packaged actual ACP + native image, đọc manual quality, inspect rendered image/geometry; restart offline.
- [x] Mở app qua giao diện macOS, xác minh dữ liệu người dùng với backup hiện tại; tránh thêm test data vào thư viện chính.
- [x] Review phản biện cuối; cập nhật execution-notes.md và báo cáo rõ các giới hạn còn thật.

## Kiểm giao diện chung trước triển khai

| Giao nhau | Quy ước |
|---|---|
| Task 1 -> Task 2 | MindmapStudyGroup đúng spec; optional graph.studyGroups; node.ipa optional |
| Task 1 -> Task 3 | createMap thêm level/illustrations, revision.brief; group image slots sourceType=group |
| Task 2 -> Task 3 | Props `groupImages?: Readonly<Record<string, {src:string;alt:string}>>`, `illustrationsRequested?: boolean`, `onGenerateGroupImage?: (groupId:string)=>void`; props graph/onSpeakNode cũ giữ |
| Task 1/test fixtures | Caller cũ createMap default hình false nhưng generation mới cần studyGroups; cập nhật fixtures chứ không nới validator |
| Task 4/baseline | Dùng snapshot 2026-09-07 mới của task, không so toàn dirty branch với HEAD để quy lỗi |

Các task giữ ownership riêng. Review yêu cầu cả đúng spec và chất lượng code; worker hoàn tất không đồng nghĩa đã nghiệm thu. Chủ đề sách là tham chiếu bố cục, không sao chép artwork hoặc nguyên trang.

Nghiệm thu cuối: [automatic-study-map-acceptance](./2026-09-07-automatic-study-map-acceptance.md). Inference thật 4 E2E PASS; sau polish, 3 E2E PASS trên package cuối với output thật được giữ nguyên.
