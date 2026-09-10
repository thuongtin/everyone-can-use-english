# Nghiên cứu renderer mindmap cho Enjoy

Ngày kiểm tra nguồn live: 2026-09-07, múi giờ Asia/Ho_Chi_Minh.

## Kết luận

**Giữ `@xyflow/react` 12.11.6 cho learning mindmap hiện tại.** Đây là lựa chọn có điều kiện: schema tiếp tục là graph tổng quát có node giàu dữ liệu, cạnh có loại và evidence, người học tiếp tục được kéo từng node tới tọa độ tự do, và sản phẩm cần gắn hành động React như phát âm hoặc chọn target ngay trên node. Trong các điều kiện này, thay renderer tạo thêm adapter và regression risk nhưng không giải quyết một thiếu sót cốt lõi nào đã được chứng minh.

**Chỉ chọn Mind Elixir nếu roadmap đổi trọng tâm sang authoring mindmap phân cấp** với thêm node, sửa topic, đổi parent/thứ tự, multi-select và undo/redo là nhu cầu gần hạn. Trước khi đổi cần một spike riêng chứng minh ba việc: ánh xạ graph hiện tại thành một spanning tree cộng `arrows` không làm sai nghĩa typed edges; node tùy biến vẫn phát âm và chọn target được; keyboard và screen reader vẫn đạt khi giữ danh sách accessible bên cạnh. Không dùng Markmap thay view chính. Markmap phù hợp với preview hoặc export một outline Markdown, không phù hợp với graph học từ hiện tại.

Phản chứng mạnh nhất chống lựa chọn dẫn đầu là React Flow chỉ cung cấp primitive cho node-based UI. Enjoy vẫn phải tự xây CRUD, undo/redo và layout mindmap tốt hơn. Layout hiện tại là BFS theo depth với slot cố định, nên một graph dày có thể cho nhiều đường chéo hoặc giao nhau. Nếu user research xác nhận authoring phân cấp quan trọng hơn tự do bố cục và typed graph, Mind Elixir có thể giảm đáng kể phần editor phải tự viết.

## Hợp đồng thực tế của Enjoy

- Schema là graph phẳng, tối đa 40 node và 120 cạnh. Node có `term`, `sense`, `definition`, `translationVi`, `partOfSpeech`, `example` và `evidence`. Cạnh có ID riêng, `source`, `target`, `kind` và `evidence`; bảy loại cạnh là `category`, `synonym`, `antonym`, `word-family`, `collocation`, `situation`, `related-concept`. Validator còn chặn ID trùng, dangling reference, self-edge và cạnh trùng loại. Xem [learning-schemas.ts](../../enjoy/src/lib/learning-schemas.ts#L7) và [validator](../../enjoy/src/lib/learning-schemas.ts#L670).
- View đang biến mỗi node thành custom React component và mỗi cạnh thành edge độc lập có nhãn, màu và mũi tên. Node có button chọn, button `Nghe`, nội dung sense, nghĩa, ví dụ, evidence; danh sách song song dùng button và `aria-pressed`. Xem [mindmap-view.tsx](../../enjoy/src/renderer/components/learning/mindmap-view.tsx#L120) và [phần accessible list](../../enjoy/src/renderer/components/learning/mindmap-view.tsx#L242).
- Canvas hiện có drag node, pan/zoom, controls, minimap và `fitView`. Tọa độ `{id, x, y}` được lưu theo `mapRevisionId`, kiểm finite, unique và phải tham chiếu node tồn tại. Xem [canvas config](../../enjoy/src/renderer/components/learning/mindmap-view.tsx#L320), [queue lưu layout](../../enjoy/src/renderer/components/learning/learning-studio.tsx#L569) và [storage validation](../../enjoy/src/main/learning/storage.ts#L673).
- Phát âm node đã nối từ button tới `narrateMapNode`, asset audio và player. Target selection mới chỉ có contract `onSelectNode` và trạng thái local trong `MindmapView`; `LearningStudio` hiện không truyền `onSelectNode` hoặc `selectedNodeId`, nên chưa có luồng dùng các node đã chọn để tạo lesson brief. Đây là host workflow gap, không phải lý do đổi renderer. Xem [props của view](../../enjoy/src/renderer/components/learning/mindmap-view.tsx#L30) và [chỗ mount hiện tại](../../enjoy/src/renderer/components/learning/learning-studio.tsx#L739).
- Repo đã pin `@xyflow/react` 12.11.6 trong [package.json](../../enjoy/package.json#L208). Lần kiểm tra này chạy `node scripts/check-learning-mindmap-view.mjs` và PASS cho deterministic layout, edge labels, chọn node từ accessible list và action phát âm. Test này dùng JSDOM, không phải Electron E2E. E2E trong repo có assertion kéo node, lưu layout, restart và đọc lại tọa độ, nhưng lần nghiên cứu này không chạy lại E2E đó; xem [learning-studio.spec.ts](../../enjoy/e2e/learning-studio.spec.ts#L136).

## So sánh

| Tiêu chí | `@xyflow/react` hiện tại | Mind Elixir 5.15.1 | Markmap 0.18.12 |
|---|---|---|---|
| License | MIT trong [package manifest chính thức](https://github.com/xyflow/xyflow/blob/0a1f9575b25679f2880175de8d3eae21aedde921/packages/react/package.json#L1-L52) và [LICENSE](https://github.com/xyflow/xyflow/blob/0a1f9575b25679f2880175de8d3eae21aedde921/LICENSE) | MIT trong [package manifest](https://github.com/SSShooter/mind-elixir-core/blob/0aaa83afb25e7eab970c10e6792a06740eb818e4/package.json#L1-L75) và [LICENSE](https://github.com/SSShooter/mind-elixir-core/blob/0aaa83afb25e7eab970c10e6792a06740eb818e4/LICENSE) | MIT trong [markmap-view manifest](https://github.com/markmap/markmap/blob/99fc93e6efd4a1df01260232d818fb57955d71df/packages/markmap-view/package.json#L1-L43) và [LICENSE](https://github.com/markmap/markmap/blob/99fc93e6efd4a1df01260232d818fb57955d71df/LICENSE) |
| Electron/React offline | Đã bundle trong app hiện tại, không cần CDN. Targeted source test PASS; packaged Electron không chạy lại trong lượt này | ESM package có types và CSS exports, framework-agnostic theo README, nên có đường bundle offline. React example tồn tại nhưng wrapper React nằm ở ecosystem riêng. Chưa thử trong Enjoy/Electron | `markmap-view` là ESM browser package dùng D3, có thể bundle offline. `markmap-cli --offline` inline asset vào HTML, nhưng đó là CLI output, không chứng minh Electron integration |
| Fit data | Native fit với arrays `nodes` và `edges`; edge data có thể giữ nguyên | Data chính là một root `nodeData` có `children`; crosslink nằm trong `arrows`. Cần chọn spanning tree hoặc biến mọi cạnh thành arrow. Adapter hai chiều có nguy cơ đổi parent/order thành thay đổi dữ liệu học | `IPureNode` chỉ có `content`, `payload`, `children`; renderer tạo link từ quan hệ parent-child. Không có first-party crosslink/typed edge model |
| Typed edges/crosslinks | Mỗi edge giữ ID, kind, evidence; custom edge/label là React component | `Arrow` có ID, label, from/to, style và generic metadata, nên có thể chứa kind/evidence. Cạnh cây là quan hệ `children` ngầm, không có payload edge riêng | Link được sinh từ `children`; không có edge object để giữ kind/evidence hoặc crosslink |
| Nội dung node, phát âm, chọn target | Custom React node nhận full schema và callback. Đây là cách hiện tại đang chạy | `NodeObj.metadata` giữ được data tùy ý và bus có `selectNodes`. Node audio/button cần DOM customization hoặc companion UI; chưa có spike chứng minh React controls trong node | Node content là HTML string. API có `setHighlight`, nhưng source view chỉ click circle để fold/unfold; node target selection và audio cần code ngoài renderer |
| Layout persistence | Tọa độ node tự do map trực tiếp vào storage hiện có | Node data không có absolute x/y. Drag là move `in`, `before`, `after`, tức reparent hoặc reorder; `Arrow` chỉ giữ control-point deltas. Có thể lưu tree/order, không giữ semantics tọa độ hiện tại | Auto-layout tính `state.rect` sau render. Không có node drag hoặc persisted absolute positions trong public data type |
| Pan/zoom | Có sẵn và đang dùng | README và shortcut guide có zoom/reset/center; source có pan helper và scale options | Public API có `pan`, `zoom`, `fit`, `centerNode`, `ensureVisible`, `rescale` |
| Export | Không phải built-in end-to-end. Ví dụ chính thức dùng `html-to-image` 1.11.11 và cảnh báo bản mới hơn có lỗi | README headline nói SVG/PNG/HTML. Phần chi tiết lại yêu cầu `@zumer/snapdom` cho image, đánh dấu `exportSvg()` deprecated, và liệt kê HTML exporter trong ecosystem. Phải prototype exact export path trước khi cam kết | CLI chính thức xuất interactive HTML và có `--offline`; renderer là SVG. Tài liệu đã đọc không công bố PNG export built-in |
| Editing | Có primitives cho drag, connect, select; Enjoy phải tự xây editor domain, validation và history | Điểm mạnh: edit node, drag/reparent, multi-select, undo/redo, operation guards và cross-node arrows là first-party claim | View tập trung render/collapse tree Markdown. Không thấy API editing node hoặc edge trong tài liệu chính thức |
| Accessibility evidence | Tài liệu chính thức mô tả focus node/edge, Tab, Enter/Space, Escape, arrow-key move, auto-pan, ARIA labels và live region. Enjoy còn có button/list riêng | Tài liệu shortcut chứng minh keyboard navigation và editing. Quét source core tại commit đã pin thấy container `tabindex=0`, nhưng không thấy ARIA role/label cho từng node. Chưa kiểm screen reader runtime | Quét `markmap-view/src` tại commit đã pin không thấy `aria-*`, `role`, `tabindex` hoặc keyboard handler cho graph node. Toolbar có button riêng, nhưng không thay thế semantic node list. Chưa kiểm screen reader runtime |
| Maintenance evidence, không suy diễn | Package 12.11.6 được cập nhật trong [release commit 2026-09-01](https://github.com/xyflow/xyflow/commit/0a1f9575b25679f2880175de8d3eae21aedde921); docs accessibility ghi cập nhật 2026-08-24 | [v5.15.1 phát hành 2026-08-05](https://github.com/SSShooter/mind-elixir-core/releases/tag/v5.15.1); default branch tại [commit 2026-08-07](https://github.com/SSShooter/mind-elixir-core/commit/0aaa83afb25e7eab970c10e6792a06740eb818e4) | Manifest đang là 0.18.12; default branch tại [commit 2026-06-21](https://github.com/markmap/markmap/commit/99fc93e6efd4a1df01260232d818fb57955d71df). GitHub latest release vẫn là [v0.18.0 ngày 2024-12-19](https://github.com/markmap/markmap/releases/tag/v0.18.0), nên release page không phản ánh đủ các package patch |

## Mind Elixir: phù hợp có điều kiện

README chính thức công bố framework-agnostic, touch, shortcuts, interactive editing, multi-select, undo/redo, node connections và export SVG/PNG/HTML tại [readme.md dòng 42-71](https://github.com/SSShooter/mind-elixir-core/blob/0aaa83afb25e7eab970c10e6792a06740eb818e4/readme.md#L42-L71). Event bus có `operation`, `selectNodes`, `expandNode`, còn `getData()` và `refresh(data)` cung cấp đường đồng bộ state tại [dòng 259-298](https://github.com/SSShooter/mind-elixir-core/blob/0aaa83afb25e7eab970c10e6792a06740eb818e4/readme.md#L259-L298).

Khả năng crosslink là thật ở type level. `MindElixirData` có `nodeData` và `arrows`; `Arrow` có `from`, `to`, `label`, `bidirectional`, control-point deltas và generic `metadata` tại [types/index.ts](https://github.com/SSShooter/mind-elixir-core/blob/0aaa83afb25e7eab970c10e6792a06740eb818e4/src/types/index.ts#L182-L251) và [arrow.ts](https://github.com/SSShooter/mind-elixir-core/blob/0aaa83afb25e7eab970c10e6792a06740eb818e4/src/arrow.ts#L32-L71). Vì vậy adapter có thể giữ `kind` và `evidence` trong metadata của arrow.

Giới hạn nằm ở primary structure. `NodeObj.children` quyết định cây, còn source của move operation thực hiện `moveNodeIn`, `moveNodeBefore`, `moveNodeAfter` và cập nhật object tree tại [nodeOperation.ts](https://github.com/SSShooter/mind-elixir-core/blob/0aaa83afb25e7eab970c10e6792a06740eb818e4/src/nodeOperation.ts#L259-L332). Đây không tương đương với kéo node tới `{x,y}`. Với graph có nhiều parent hợp lệ hoặc chu kỳ, Enjoy phải chọn một cây trình bày, còn các cạnh khác thành arrows. Lựa chọn đó cần deterministic rule và không được ghi ngược thành thay đổi quan hệ học nếu user chỉ kéo để sắp xếp.

Node có generic metadata nhưng UI giàu dữ liệu hiện tại không tự xuất hiện. `dangerouslySetInnerHTML` thay toàn bộ node, còn default `topic` dùng text an toàn khi không bật markdown. Nếu spike cần HTML custom node, phải giữ schema content ở text nodes hoặc sanitize rõ ràng; không đưa trực tiếp model output vào HTML. Nút phát âm nên vẫn do React host quản lý hoặc được gắn bằng API có cleanup, thay vì nhúng chuỗi HTML có handler.

Accessibility evidence hẹp hơn shortcut evidence. [Shortcut guide](https://docs.mind-elixir.com/docs/guides/shortcuts) có điều hướng bằng phím, edit, move, zoom và collapse/expand. Source core ở commit được kiểm chỉ đặt `tabindex=0` cho container tại [index.ts](https://github.com/SSShooter/mind-elixir-core/blob/0aaa83afb25e7eab970c10e6792a06740eb818e4/src/index.ts#L339-L348); quét source không thấy ARIA role/label cho node. Điều đó không chứng minh thư viện không accessible, nhưng chưa đủ bằng chứng để bỏ danh sách accessible của Enjoy.

Export cần đọc theo hai tầng bằng chứng. Headline README công bố SVG/PNG/HTML, nhưng hướng dẫn cụ thể yêu cầu `@zumer/snapdom` cho image và nói `exportSvg()` sẽ bị loại bỏ tại [dòng 346-368](https://github.com/SSShooter/mind-elixir-core/blob/0aaa83afb25e7eab970c10e6792a06740eb818e4/readme.md#L346-L368). HTML exporter và React wrapper được liệt kê là ecosystem package tại [dòng 421-425](https://github.com/SSShooter/mind-elixir-core/blob/0aaa83afb25e7eab970c10e6792a06740eb818e4/readme.md#L421-L425). Do đó chưa nên ghi acceptance là core export ba format cho đến khi exact package/version chạy trong packaged Electron.

## Markmap: chỉ phù hợp với Markdown preview/export

Mục đích chính thức là “Visualize your Markdown as mindmaps” trong [README](https://github.com/markmap/markmap/blob/99fc93e6efd4a1df01260232d818fb57955d71df/README.md#L1-L9). `markmap-lib` biến Markdown thành một node tree, rồi `markmap-view` render tree vào SVG theo [tài liệu transform](https://markmap.js.org/docs/packages--markmap-lib) và [tài liệu view](https://markmap.js.org/docs/packages--markmap-view).

Public `IPureNode` chỉ có HTML `content`, `payload` và `children`; tọa độ nằm trong render-only `state.rect` sau layout tại [markmap-common types](https://github.com/markmap/markmap/blob/99fc93e6efd4a1df01260232d818fb57955d71df/packages/markmap-common/src/types/common.ts#L1-L54). Source view tạo link bằng cách duyệt `node.children`, không từ edge records, tại [view.ts](https://github.com/markmap/markmap/blob/99fc93e6efd4a1df01260232d818fb57955d71df/packages/markmap-view/src/view.ts#L472-L483). Đây là mismatch trực tiếp với typed graph của Enjoy.

Markmap có pan/zoom tốt cho đọc. [Public API](https://markmap.js.org/api/classes/markmap-view.Markmap.html) công bố `fit`, `centerNode`, `ensureVisible`, `rescale`, `setData`, `setHighlight` và options `pan`, `zoom`. Tuy nhiên source click handler được gắn vào circle để fold/unfold, không phải node selection domain; node audio, multi-target selection và free-position persistence vẫn phải tự xây.

Điểm phù hợp nhất là export tài liệu. [CLI docs](https://markmap.js.org/docs/packages--markmap-cli) công bố output HTML và `--offline`; source inline assets trước khi ghi file HTML tại [markmap-cli](https://github.com/markmap/markmap/blob/99fc93e6efd4a1df01260232d818fb57955d71df/packages/markmap-cli/src/index.ts#L68-L106). Nếu Enjoy sau này có “Xuất outline Markdown thành mindmap HTML”, Markmap là ứng viên gọn cho feature đó, tách khỏi learning graph runtime.

## Vì sao giữ xyflow hợp lý

React Flow map trực tiếp graph hiện có, không cần chọn parent chính. [Custom node guide](https://reactflow.dev/learn/customization/custom-nodes) cho phép render React component, inputs và nhiều handles; [custom edge guide](https://reactflow.dev/learn/customization/custom-edges) cho phép edge React/SVG tùy chỉnh. Điều này khớp với node có phát âm, evidence, meaning và edge label theo loại.

[Accessibility guide](https://reactflow.dev/learn/advanced-use/accessibility) công bố Tab focus, Enter/Space selection, Escape, arrow-key node movement, auto-pan, cấu hình ARIA và live announcements. Đây là bằng chứng upstream mạnh nhất trong ba lựa chọn. Enjoy vẫn nên giữ semantic button và list riêng vì graph trực quan không thể hiện tốt mọi nghĩa và evidence cho screen reader.

[Save and Restore example](https://reactflow.dev/examples/interaction/save-and-restore) lưu nodes, edges và viewport. Enjoy hiện chủ động chỉ lưu positions theo map revision, hợp với domain storage đang có. Nếu cần nhớ viewport, có thể mở rộng layout record riêng mà không đổi graph schema.

Điểm yếu phải chấp nhận là layout và export không hoàn chỉnh sẵn. [Download Image example](https://reactflow.dev/examples/misc/download-image) dùng `html-to-image` 1.11.11 và ghi rõ các version sau đó đang export lỗi. Vì node Enjoy là HTML React, export SVG thuần cũng không tự bảo toàn toàn bộ node. Export nên là workstream riêng với prototype trên packaged Electron, font tiếng Việt, dark/light, node ngoài viewport và graph 40 node.

## Điều kiện đổi quyết định

Chuyển từ xyflow sang Mind Elixir chỉ khi tất cả điều kiện sau cùng đúng:

1. User research xác nhận tác vụ chính là tạo và sửa cây bằng bàn phím, drag/reparent, undo/redo, thay vì xem và sắp xếp typed semantic graph.
2. Product quyết định rõ primary tree edge là gì. Ví dụ chỉ `category` hoặc `situation` được làm parent-child, còn synonym, antonym, word-family, collocation và related-concept luôn là arrows. Graph không có primary tree hợp lệ phải có fallback được giải thích cho người học.
3. Adapter round-trip giữ nguyên mọi node ID, edge ID, kind, evidence và không biến thay đổi layout thành sửa semantic graph ngoài ý muốn.
4. Companion accessible list, node target selection và pronunciation vẫn hoạt động bằng keyboard và screen reader.
5. Package bundled chạy offline trong packaged Electron; CSP, theme, cleanup khi đổi revision, 40-node performance và export exact formats đều có runtime evidence.

Markmap chỉ nên được chọn cho một feature khác có input gốc là Markdown và output chính là interactive HTML/SVG tree. Nó không nên trở thành adapter bắt buộc giữa learning schema và view.

## Checks đã thực hiện và khoảng trống

Đã thực hiện:

- Đọc source schema, validator, renderer, host wiring, layout storage và E2E hiện có trong repo.
- Chạy targeted check hiện tại: `node scripts/check-learning-mindmap-view.mjs`, kết quả PASS.
- Đọc live README, LICENSE, package manifests, docs/API, release và default-branch commit chính thức của ba dự án.
- Clone shallow ba repository chính thức tại commit nêu trên vào thư mục tạm để kiểm type và source implementation. Không sửa runtime hoặc dependency của Enjoy.
- Quét source Mind Elixir và Markmap cho keyboard/ARIA evidence, đồng thời kiểm cấu trúc node, edge/crosslink và layout state.

Chưa kiểm:

- Không cài Mind Elixir hoặc Markmap vào repo, không chạy spike React/Electron, không đo bundle size hoặc performance.
- Không chạy screen reader, touch, IME, keyboard acceptance hoặc export runtime cho hai ứng viên.
- Không chạy lại packaged Electron E2E của view hiện tại trong lượt nghiên cứu này.
- Claim UX/performance của README Mind Elixir và khả năng hoạt động trong Electron vẫn là upstream claim cho đến khi có prototype của Enjoy.
