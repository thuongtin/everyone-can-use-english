# Bố cục study map tự động như trang sách

Ngày xác minh: 2026-09-07
Phạm vi: nghiên cứu chỉ đọc, chưa cài package, chưa sửa runtime

## Kết luận

**Nên làm một `StudyMapView` dạng nhiều trang bằng React/HTML, với nhánh SVG mỏng phủ trên từng group.** Giữ `MindmapGraph` và view xyflow hiện tại cho màn hình khám phá quan hệ, nhưng không dùng canvas graph làm trải nghiệm học mặc định.

Lý do quyết định là tiêu chí mới cần nội dung mở ra đọc ngay, tự phân nhóm, không kéo node, responsive và xuất nhiều trang. Không layout engine nào trong các lựa chọn vừa suy luận được nhóm học có nghĩa, vừa phân trang card giàu nội dung. Mind Elixir giải quyết cây tương tác. D3, ELK và Dagre giải quyết tọa độ. Phân trang vẫn là phần Enjoy phải sở hữu.

Thứ tự chọn cho use case này:

1. Custom deterministic paginated study sheet.
2. ELK + xyflow nếu vẫn bắt buộc xem toàn bộ graph trên một canvas tự xếp.
3. Mind Elixir nếu product chấp nhận một cây mindmap trên canvas và ưu tiên thời gian làm bản đầu.
4. D3 hierarchy/tree chỉ nên dùng cho helper cây nhỏ có card cùng kích thước, không làm layout chính.

Nguồn quyết định chính:

- [React Flow layouting guide](https://reactflow.dev/learn/layouting/layouting): bảng so sánh dynamic node size, sub-flow và edge routing của Dagre, D3 hierarchy, ELK.
- [Mind Elixir link renderer](https://github.com/SSShooter/mind-elixir-core/blob/v5.15.1/src/linkDiv.ts#L17-L72): đọc kích thước DOM thật và tô branch color.
- [Mind Elixir summary model](https://github.com/SSShooter/mind-elixir-core/blob/v5.15.1/src/summary.ts#L25-L95): group chỉ là khoảng sibling cùng parent.
- [Electron `printToPDF`](https://www.electronjs.org/docs/latest/api/web-contents#contentsprinttopdfoptions): đường xuất PDF nhiều trang từ HTML/CSS.
- [ELK official overview](https://eclipse.dev/elk/): ELK chỉ tính layout, không render giao diện.

Đây là quyết định khác với [nghiên cứu renderer trước](./2026-09-07-enjoy-mindmap-renderers.md), vì bài toán trước ưu tiên typed graph, drag, pan/zoom và lưu tọa độ. Bài toán hiện tại ưu tiên đọc và học theo trang.

## Khoảng trống dữ liệu phải xử lý trước renderer

Schema hiện tại có `term`, `sense`, `definition`, `translationVi`, `partOfSpeech`, `example`, `evidence`, nhưng **không có IPA, ảnh hoặc group**. Nó là graph phẳng với tối đa 40 node và 120 edge, xem [learning-schemas.ts](../../enjoy/src/lib/learning-schemas.ts#L327). Không layout engine nào tự hiểu nhóm từ vựng theo chủ đề từ bảy loại edge hiện có.

Nên tạo một presentation contract được sinh một lần cùng revision, thay vì chạy clustering lại mỗi lần render:

- `groups[]`: `id`, `title`, `summary`, `colorToken`, `imageAssetId`, `nodeIds`, `order`; tối đa 6 từ mỗi group.
- `nodePresentation[]`: `nodeId`, `ipa`, `imageAssetId`, `orderInGroup`.
- Validator yêu cầu mỗi node xuất hiện đúng một lần, mọi ID tồn tại, màu lấy từ palette cho phép, thứ tự không trùng, ảnh tham chiếu asset local hợp lệ.
- Graph quan hệ vẫn là nguồn dữ liệu chính. Group là cách trình bày, không biến thành edge mới và không ghi ngược thay đổi bố cục vào semantics.

Nếu muốn “tự phân nhóm”, AI nên trả contract này trong generation stage. Renderer chỉ validate, sắp xếp và dàn trang. Cách này làm kết quả ổn định khi mở lại, test được và không phụ thuộc viewport.

Khi mở revision cũ chưa có presentation contract, dùng fallback xác định và không bỏ node:

1. Giữ `rootNodeId` làm topic hero ở trang đầu.
2. Lấy các node còn lại theo đúng thứ tự đang lưu trong `graph.nodes`.
3. Chia tuần tự thành các chunk tối đa 6 từ. Đặt tên group đầu là “Từ liên quan”, các group sau là “Từ liên quan (tiếp theo)”.
4. Giữ nguyên mọi typed edge để xem trong relational details; fallback không tạo, đổi hoặc loại edge.
5. Kiểm hậu điều kiện: hợp của các `nodeIds` cộng root bằng đúng tập node gốc, không trùng và không thiếu, kể cả node cô lập và disconnected component.

Multi-source BFS từ các node kề root đã được cân nhắc nhưng bị loại khỏi quyết định cuối. Graph cũ có thể có cycle, disconnected component và nhiều edge không mang quan hệ taxonomy. Dùng khoảng cách graph để đặt tên group sẽ tạo ra ý nghĩa mà dữ liệu không cam kết. Fallback order/chunk chỉ giúp revision cũ mở được; semantic grouping đúng phải đến từ presentation contract do AI sinh.

## So sánh thực dụng

| Hướng | Node có kích thước thay đổi | Group và nhánh màu | Responsive, nhiều trang | Electron/React offline | Export | Nhận định |
|---|---|---|---|---|---|---|
| Custom React/HTML + SVG overlay | Có, dùng document flow và đo DOM thật | Group là section có dữ liệu rõ; một trunk và các stem cùng màu trong mỗi group | Tốt nhất. Mobile xếp một cột, desktop hai trang hoặc hai cột; export dùng profile A4 riêng | Không thêm layout runtime; dùng stack hiện có | PDF bằng Electron `printToPDF`; PNG từng trang bằng `capturePage` nếu cần | **Phù hợp nhất** với trải nghiệm học như sách |
| Mind Elixir 5.15.1 | Có. CSS dùng `fit-content`/`max-content`; code nối nhánh đọc `offsetWidth` và `offsetHeight` thật | Có `branchColor`, image kích thước rõ và `summaries`; summary chỉ bao một dải sibling liên tiếp | Canvas `overflow: hidden` với pan/zoom. Không có contract phân trang trong API/source đã kiểm | ESM package và CSS có thể bundle local; React host phải quản lý lifecycle DOM imperative | Hướng dẫn hiện dùng thêm `@zumer/snapdom`; `exportSvg()` đã deprecated; không xuất nhiều trang | Bản mindmap nhanh nhất, nhưng vẫn là editor/canvas một cây |
| D3 hierarchy/tree + SVG/HTML custom | Không ở layout gốc. `tree.nodeSize([w,h])` là một kích thước chung; React Flow cũng ghi rõ D3 hierarchy không hỗ trợ dynamic node sizes | Chỉ có hierarchy một root. Group box, crosslink, màu và routing phải tự viết | Không có pagination. Pure SVG phải tự wrap text; HTML overlay hoặc `foreignObject` làm export phức tạp hơn | ESM, bundle local, license ISC | Không có export end-to-end; tự serialize SVG hoặc chụp DOM | Viết gần như toàn bộ phần khó nhưng vẫn bị giới hạn node size |
| ELK + xyflow hiện có | Có. Input `ElkNode` nhận `width`/`height`; React Flow xếp ELK vào nhóm hỗ trợ dynamic sizes | ELK có hierarchical nodes, ports và edge routing; giữ được graph nhiều edge tốt nhất | Vẫn là một graph lớn cần fit/pan/zoom. Không phân trang | Có `elk.bundled.js` và worker local. Official README liệt kê các issue React/Webpack và worker resolution; chạy không worker có thể chặn UI | ELK chỉ tính vị trí, không render/export; xyflow example dùng `html-to-image` | Tốt nhất nếu yêu cầu chính quay lại auto-layout graph đầy đủ, nhưng quá nặng cho study sheet |
| Dagre + xyflow hiện có | Có, phải truyền kích thước node trước layout | Compound/sub-flow có hỗ trợ, nhưng React Flow cảnh báo sub-flow có edge nối ra ngoài còn lỗi | Không phân trang; vẫn cần canvas | ESM/CJS bundle local, MIT; tích hợp đơn giản hơn ELK | Dagre chỉ tính vị trí; export vẫn do xyflow/DOM | Phương án graph đơn giản, không hợp group có nhiều cross-group edge |

License đã xác minh từ package/repository chính thức:

- Mind Elixir: MIT, xem [package manifest](https://github.com/SSShooter/mind-elixir-core/blob/v5.15.1/package.json) và [LICENSE](https://github.com/SSShooter/mind-elixir-core/blob/v5.15.1/LICENSE).
- D3 hierarchy: ISC, xem [package manifest](https://github.com/d3/d3-hierarchy/blob/v3.1.2/package.json) và [LICENSE](https://github.com/d3/d3-hierarchy/blob/v3.1.2/LICENSE).
- Dagre: MIT, xem [package manifest](https://github.com/dagrejs/dagre/blob/v3.1.1/package.json) và [LICENSE](https://github.com/dagrejs/dagre/blob/v3.1.1/LICENSE).
- elkjs: package công bố `EPL-2.0 OR GPL-3.0-or-later`, xem [package manifest](https://github.com/kieler/elkjs/blob/0.12.0/package.json) và [LICENSE](https://github.com/kieler/elkjs/blob/0.12.0/LICENSE.md). Việc phân phối Electron cần giữ đúng notice và quy trình license của sản phẩm.
- `@xyflow/react` hiện tại: MIT và đã được pin ở 12.11.6, xem [package.json](../../enjoy/package.json#L217) và [upstream LICENSE](https://github.com/xyflow/xyflow/blob/0a1f9575b25679f2880175de8d3eae21aedde921/LICENSE).

## Kiến trúc đề xuất để triển khai ngay

### 1. Mỗi group là một “đảo học” độc lập

Topic hero nằm ở đầu trang đầu. Bên dưới, mỗi group là một panel có hub, ảnh minh họa chung, mô tả ngắn và tối đa 6 word card xòe quanh hub. Màn hình rộng đặt tối đa 2 panel trên một page; màn hình hẹp đặt 1 panel mỗi hàng và cuộn theo chiều dọc. Word card hiển thị từ, IPA, nghĩa Việt, ví dụ, part of speech, nút nghe và ảnh riêng nếu có.

Ảnh nên là asset đã sinh và lưu local. Một ảnh native Codex cho mỗi group là mức mặc định khả thi và nhẹ hơn 40 ảnh từ; `imageAssetId` ở word card là tùy chọn khi cần minh họa riêng. Renderer không gọi mạng lúc mở map hoặc export.

Chỉ vẽ nhánh trong phạm vi group: một trunk màu từ header tới các card, sau đó các stem ngắn. Quan hệ synonym, antonym, collocation và word-family nên hiện thành badge hoặc dòng “Liên quan” trong card. Không cố vẽ cả 120 edge xuyên trang, vì kết quả lại trở thành graph phải pan/zoom.

### 2. Layout hai pass, không lưu tọa độ kéo tay

1. Normalize và stable-sort presentation contract bằng `order`. Với graph cũ, giữ nguyên thứ tự `graph.nodes` khi chunk fallback.
2. Render vào measurement surface ẩn với đúng font, width, image aspect ratio và breakpoint.
3. Chờ `document.fonts.ready` và ảnh local decode xong, rồi đo chiều cao group/card.
4. Pack tuần tự vào page budget cố định, tối đa 2 group/page ở profile rộng và 1 group/hàng ở profile hẹp. Không dùng tối ưu bin-packing làm đảo thứ tự học.
5. Nếu group không vừa một trang, tách tại ranh giới card và lặp lại group header dạng “tiếp theo”. Không tách một card qua hai trang.
6. Render page thật, đo anchor card và tạo SVG path trong cùng page.

Để kết quả lặp lại giữa máy và export, cần bundle font, khóa width card theo presentation profile, dùng tỉ lệ ảnh cố định và quy định overflow cho text quá dài. CSS Fragmentation định nghĩa `break-inside: avoid`, nhưng đây là yêu cầu tránh break, không phải bảo đảm tuyệt đối nếu một card cao hơn page. Vì vậy split rule của app vẫn cần thiết, xem [CSS Fragmentation Level 3](https://www.w3.org/TR/css-break-3/#break-within).

### 3. Responsive theo reflow, không thu nhỏ cả canvas

- Mobile: một cột, một group mỗi hàng, page chrome biến thành section liên tục.
- Tablet/desktop: tối đa hai group panel trên một page hoặc book spread; mỗi page có chiều rộng tối đa và nút chuyển trang.
- Print/PDF: profile A4 hoặc Letter cố định, dùng `@page size`, margin và page break rõ. W3C định nghĩa page size/orientation trong [CSS Paged Media Level 3](https://www.w3.org/TR/css-page-3/#page-size-prop).
- Không dùng `fitView` để ép 40 card giàu chữ vào một viewport, vì chữ sẽ nhỏ đúng lúc người học cần đọc.

### 4. Export dùng renderer của chính app

Electron `webContents.printToPDF()` trả `Buffer`, hỗ trợ `printBackground`, `pageSize` và `preferCSSPageSize`, nên PDF nhiều trang có thể dùng đúng DOM/CSS của study view, xem [Electron webContents](https://www.electronjs.org/docs/latest/api/web-contents#contentsprinttopdfoptions). Nếu cần PNG từng trang, `capturePage()` trả `NativeImage`, sau đó `toPNG()`, xem [capturePage](https://www.electronjs.org/docs/latest/api/web-contents#contentscapturepagerect-opts) và [NativeImage](https://www.electronjs.org/docs/latest/api/native-image#imagetopngoptions).

Export acceptance nên đợi font và ảnh local sẵn sàng, bật background, không gọi network, và đối chiếu số page/card trước khi ghi file. Điều này tránh phụ thuộc `html-to-image`; ví dụ chính thức của React Flow hiện vẫn khóa thư viện đó ở 1.11.11 vì version mới hơn export lỗi, xem [Download Image example](https://reactflow.dev/examples/misc/download-image).

## Đánh giá từng thư viện

### Mind Elixir: phản chứng mạnh nhất chống lựa chọn custom

Mind Elixir gần hình dung “mindmap mở ra là có bố cục” nhất. `NodeObj` có `image`, `branchColor`, custom style và `summaries`; ảnh bắt buộc có width/height, xem [official types](https://github.com/SSShooter/mind-elixir-core/blob/v5.15.1/src/types/index.ts#L182-L230). Layout dùng DOM flow, còn link renderer đọc kích thước và vị trí thật của topic/wrapper, xem [linkDiv.ts](https://github.com/SSShooter/mind-elixir-core/blob/v5.15.1/src/linkDiv.ts#L17-L72). Vì vậy nó xử lý text/ảnh cao thấp khác nhau tốt hơn D3 tree gốc. CSS chính thức cũng dùng `width: fit-content` và container `max-content`, xem [index.css](https://github.com/SSShooter/mind-elixir-core/blob/v5.15.1/src/index.css#L140-L207).

Đây là phản chứng quan trọng: nếu acceptance cho phép một canvas pan/zoom, mỗi map là một cây, và “nhiều trang” có thể đổi thành nhiều map riêng, Mind Elixir có thể ra bản đẹp nhanh hơn custom. Nó đã có branch palette, ảnh, top-down/left/right layout, collapse và summary.

Tuy nhiên summary là bracket trên một khoảng `start..end` của các sibling cùng parent, không phải semantic grouping tùy ý, xem [summary.ts](https://github.com/SSShooter/mind-elixir-core/blob/v5.15.1/src/summary.ts#L25-L95). Node giàu nội dung phải đi qua `dangerouslySetInnerHTML` hoặc DOM customization thay vì React component tự nhiên. Export ảnh chính thức cần thêm `@zumer/snapdom`, còn `exportSvg()` đã deprecated, xem [README](https://github.com/SSShooter/mind-elixir-core/blob/v5.15.1/readme.md#L344-L368). Quan trọng nhất, API không có phân trang study sheet.

Nếu spike Mind Elixir, phải pin chính xác `5.15.1`. Registry tại ngày kiểm tra đang gắn dist-tag `latest` vào `6.0.0-next.4`, nên không dùng version range hoặc cài mặc định mà không kiểm lockfile.

### D3 hierarchy/tree: primitive tốt, layout sai bài toán

Tài liệu chính thức nói `tree.nodeSize([width, height])` đặt một cặp kích thước cho layout và `tree.separation` chỉ tùy chỉnh khoảng cách giữa node, xem [D3 tree API](https://d3js.org/d3-hierarchy/tree). Chính React Flow ghi D3 hierarchy có `Dynamic node sizes: No`, `Sub-flow layouting: No`, `Edge routing: No`, xem [React Flow layouting guide](https://reactflow.dev/learn/layouting/layouting).

Có thể ép mọi card cùng width/height và line-clamp để D3 hoạt động, nhưng đó là hy sinh nghĩa Việt và ví dụ dài. Nếu tự đo rồi viết separation/contour tránh va chạm, ta đang xây layout engine riêng. D3 vẫn hữu ích để tạo hierarchy và path cho cây nhỏ, không đáng làm dependency trung tâm của study sheet.

### ELK hoặc Dagre cùng xyflow: chỉ chọn khi graph vẫn là sản phẩm chính

React Flow chưa có layout engine tích hợp. Hướng dẫn chính thức so sánh trực tiếp: Dagre và ELK hỗ trợ dynamic node sizes và sub-flow; ELK thêm edge routing; D3 hierarchy không hỗ trợ ba mục này, xem [layouting guide](https://reactflow.dev/learn/layouting/layouting). ELK nhận `width`, `height`, nested `children` và trả vị trí, còn ELK core mô tả hierarchical nodes/ports nhưng cũng nói rõ ELK không render, xem [ELK](https://eclipse.dev/elk/) và [elkjs README](https://github.com/kieler/elkjs/blob/0.12.0/README.md).

ELK hợp nhất khi phải giữ nhiều typed edge, nested group và giảm edge crossing trên một canvas. Chi phí là option surface lớn, async layout, đo node trước layout và bundling worker. Official elkjs README có sẵn bundled browser build, đồng thời liệt kê các issue `Can't resolve web-worker` và React/Webpack integration. Với tối đa 40 node, có thể chạy bundled engine không worker trong spike, nhưng phải đo main-thread stall trên Electron thật trước khi chấp nhận.

Dagre đơn giản hơn và nhận width/height thật. Tuy nhiên React Flow vẫn cảnh báo sub-flow có node nối ra ngoài có open issue. Study map nhiều group gần như chắc chắn có synonym/collocation xuyên group, đúng trường hợp yếu này. Cả ELK lẫn Dagre đều không tạo page, typography, image policy hoặc export.

## Điều kiện đổi quyết định

Chọn Mind Elixir thay custom chỉ khi product chấp nhận cả bốn điều kiện:

1. Một map là một tree có root rõ, không cần giữ mọi typed edge trên mặt chính.
2. Canvas pan/zoom được chấp nhận, không cần page navigation/PDF nhiều trang đúng nghĩa.
3. Node React tương tác được thay bằng DOM node hoặc companion panel mà không mất nút nghe và accessibility.
4. Spike packaged Electron chứng minh offline image, font, resize và export hoạt động với dữ liệu Việt thật.

Chọn ELK + xyflow khi yêu cầu đổi lại thành “tự xếp toàn bộ graph 40 node/120 edge trên một canvas”. Chọn Dagre khi graph gần tree, group không có nhiều edge xuyên biên. Không chọn D3 tree gốc nếu card vẫn cần hiển thị đầy đủ nghĩa, IPA và ví dụ.

## Acceptance cho spike custom

- Dataset xấu nhất: 40 node, 8 group, nghĩa/ví dụ tiếng Việt gần giới hạn schema, ảnh group và ảnh từ đủ cả 40 node.
- Topic hero ở đầu, mỗi group có tối đa 6 word card xòe quanh hub; profile rộng không quá 2 group/page, profile hẹp một group mỗi hàng.
- Mở revision lần đầu không có overlap, không cần kéo, text đọc được ở 100% zoom.
- Resize desktop xuống mobile không mất card, nhánh không vượt group, thứ tự học giữ nguyên.
- Mỗi node xuất hiện đúng một lần; group lớn split lặp header; không card nào bị cắt giữa hai page.
- Nút nghe, focus keyboard và semantic heading/list vẫn hoạt động vì nội dung là DOM thật; SVG chỉ trang trí và đặt `aria-hidden`.
- Reload cùng revision/profile tạo cùng page assignment.
- Revision cũ không có presentation contract vẫn chứa đúng toàn bộ node theo thứ tự lưu sau fallback, không trùng và không mất node cô lập.
- Packaged Electron chạy offline hoàn toàn; PDF có đủ màu nền, font, ảnh, IPA và số trang; PNG page nếu có khớp viewport đã định.

## Giới hạn của lượt nghiên cứu

- Đã đọc source/schema/view hiện tại và tài liệu/source chính thức live của Mind Elixir, D3 hierarchy, ELK/elkjs, Dagre, React Flow, Electron và W3C.
- Đã đối chiếu package live ngày 2026-09-07: Mind Elixir stable 5.15.1 nhưng dist-tag `latest` trỏ pre-release 6; d3-hierarchy 3.1.2; elkjs 0.12.0; `@dagrejs/dagre` 3.1.1; `@xyflow/react` 12.11.6.
- Chưa cài hoặc chạy bất kỳ ứng viên nào trong Enjoy, chưa đo bundle/runtime, chưa render dataset thật, chưa kiểm packaged Electron/PDF/screen reader.
- “Không có pagination” là kết luận từ API, README và source chính thức đã kiểm, không phải runtime proof. Bản triển khai vẫn cần spike acceptance ở trên trước khi xóa hoặc thay view hiện tại.
