# Trang sơ đồ học từ vựng tự trình bày

Ngày: 2026-09-07. Yêu cầu gốc: người dùng cung cấp ảnh sách mindmap và yêu cầu nghiên cứu kỹ rồi thực hiện. Hướng đã được chấp thuận trong hội thoại: app tự chọn từ, phân nhóm, tạo minh họa, dàn trang; người học mở ra là học, không kéo node để sửa bố cục.

## Quyết định

Dùng React document flow và SVG nhánh cong đo theo DOM; không thêm layout dependency. Mind Elixir giải quyết cây trên canvas, ELK/Dagre giải quyết tọa độ, còn cả hai vẫn cần Enjoy tự chia trang. Tham khảo [nghiên cứu layout](../research/2026-09-07-automatic-study-map-layout.md) và [nghiên cứu học từ](../research/2026-09-07-illustrated-vocabulary-learning.md).

Thiết kế như một trang sách minh họa: nền giấy sáng, chữ đậm rõ, root/topic badge, nhánh và nhóm có màu ổn định, từ kèm IPA và nghĩa Việt. Mỗi nhóm có một hình ngữ cảnh được tạo riêng, đặt sát những từ nó minh họa, và ví dụ song ngữ. Không gắn hình nhóm như thể đó là định nghĩa trực quan chính xác của từng từ. Chi tiết definition/example/evidence mở theo từ. Các quan hệ graph vẫn đọc được trong phần chi tiết, không vẽ mọi cạnh xuyên trang.

Mỗi trang rộng có tối đa hai nhóm, mỗi nhóm tối đa sáu từ. Nhóm lớn của dữ liệu cũ được tách thành phần tiếp theo, không bỏ hoặc cắt từ. Màn hình hẹp chuyển một cột và giữ cỡ chữ đọc được, không scale cả canvas. Height theo document flow; trang dài có thể cuộn dọc. Không cam kết trang màn hình tương đương một tờ A4 và không thêm nút export chưa được kiểm thử. Nút che nghĩa và hiện lại hỗ trợ tự nhớ, không chấm hoặc ghi tiến độ giả.

Màu và nhánh là dấu hiệu bổ sung; heading/list/focus order đủ để hiểu khi không nhìn màu. SVG trang trí không nhận pointer hoặc accessibility focus. Chữ/IPA/tiếng Việt do React render, không nhúng vào ảnh AI.

## Contract thống nhất

Giữ nguyên nodes/edges/rootNodeId. Thêm `MindmapNode.ipa?: string` và `MindmapGraph.studyGroups?: MindmapStudyGroup[]` để graph cũ vẫn đọc được.

```ts
type MindmapStudyGroup = {
  id: string;
  title: string;
  translationVi: string;
  nodeIds: string[]; // ordered, 1..6
  example: string;
  exampleTranslationVi: string;
  illustration?: { prompt: string; alt: string };
};
type MapBrief = { level: CefrLevel; illustrations: boolean };
```

Persist `MapBrief` trong JSON `LearningMapRevision.brief`, với migration riêng. `createMap` nhận optional `level`, `illustrations`, vẫn nhận title/lessonRevisionId; default A2 (hoặc linked lesson level), illustrations=false cho caller cũ. Form mới bật illustrations mặc định khi Codex image capability sẵn sàng. `reviseMap` giữ brief cũ. Migration điền brief cho revision cũ, giữ nguyên graph, positions, assets và dữ liệu học khác.

Persisted schema cho phép studyGroups vắng mặt. Generation mới bắt groups hiện diện, IPA cho từ, group IDs duy nhất không đụng node/edge IDs, members là partition chính xác của toàn bộ nonroot nodes, không duplicate hoặc dangling. Với illustrations=true, mỗi group phải có prompt/alt. Generation mặc định khoảng ba nhóm, mỗi nhóm ba đến bốn từ, bám đúng chủ đề/level; các chủ đề semantic như bộ phận cơ thể vẫn được tôn trọng. Ví dụ ngắn, đúng nghĩa; không hứa validator chứng minh ngữ nghĩa hoặc CEFR hoàn hảo.

Graph cũ không có groups được trình bày bằng các phần từ liên quan theo thứ tự đã lưu, mỗi phần tối đa sáu từ. Không đoán taxonomy từ cyclic graph hoặc gán lại ý nghĩa edge. Root luôn hiển thị và mỗi nonroot node đúng một lần. Không tự ghi layout mới vào DB và không xóa saved positions.

## Hình và pipeline

Text vẫn qua ACP Codex/Claude, image qua Codex native image capability hiện có. Thêm asset `sourceType: group`; hash nguồn là composite `{group, nodes: members}`. Khi map accepted, tạo slot cho group có illustration; nếu brief bật hình thì thêm queued image stage trong cùng transaction. Asset drain hiện có tự chạy sau text và UI cập nhật từng ảnh. Revision mới tạo slot nguồn mới, giữ variant cũ; lỗi hoặc hủy giữ text đã lưu và trạng thái thực để thử lại. Không lấy mock/synthetic ảnh làm inference proof.

Không sửa auth, credential, capability transport hoặc phạm vi MCP. Hình chỉ nhận bytes qua existing native adapter và kiểm/import bằng asset store. Không render HTML/SVG do model tự tạo, không tải URL bất kỳ từ output AI.

## Luồng người dùng

`Sơ đồ minh họa mới` -> chủ đề/từ khóa, A2 mặc định -> `Tạo trang học`. Form tự chọn provider text sẵn sàng (ưu tiên cấu hình ACP mặc định hợp lệ), provider/model và hình là tùy chọn giải thích được. Chọn một provider trong danh sách advanced nếu cần; không đòi người dùng tạo nhóm hoặc sửa layout. Sau một lần submit, tạo draft rồi khởi chạy generation theo ID trả về, không dựa vào React state chưa cập nhật. Khi text ready, trang học xuất hiện ngay và hình tiếp tục tải. Tránh panel kỹ thuật chiếm trước nội dung đã hoàn tất. Thiếu image capability thì nêu rõ bản chữ; thiếu text provider thì giữ input và hướng dẫn cấu hình.

## Nghiệm thu

- Schema/storage/migration/asset tests: legacy read; group partition; level durable; immutable revisions; slot source hashes; automatic image stage; wrong revision/stale/cancel rejected.
- Renderer: mọi từ còn đủ, hai nhóm/trang, legacy 40 node, nghĩa dài, IPA, responsive, no overlap/truncation, keyboard, reveal nghĩa, nghe callback, empty/single-root.
- E2E packaged: chủ đề mới -> một submit -> ACP thật -> groups/IPA -> image bytes thật -> SQLite -> cold restart offline -> cùng nội dung/ảnh. Kiểm chọn trang và viewport hẹp. Có receipt tách thật/fixture.
- Build/typecheck/scoped lint, kiểm signature/package, review phản biện source và visual. Root quyết định acceptance sau đọc nội dung và nhìn screenshot.
- Snapshot 657 source files và backup SQLite/settings hiện tại: `enjoy/tmp/automatic-study-map/2026-09-07/`. Dữ liệu người dùng đang có một lesson, không có map; không dùng snapshot cũ thay trạng thái live.
- Giữ worktree `codex/learning-studio` và dirty changes hiện tại; không commit/push/deploy.
