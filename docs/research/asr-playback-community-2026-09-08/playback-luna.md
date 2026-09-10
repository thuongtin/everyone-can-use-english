> Cập nhật sau nghiên cứu: đã có [nghiệm thu live ngày 2026-09-08](live-acceptance.md) cho OpenAI, Cloudflare, MAI 53:57 và runtime playback. Các mục “chưa thử” bên dưới phản ánh thời điểm nghiên cứu; xem báo cáo live để biết kết quả mới.

# WaveSurfer.js region playback: chain nguồn và kế hoạch chứng minh

Kiểm tra ngày 2026-09-08, chỉ đọc. Nghiên cứu tập trung vào WaveSurfer OSS và đường playback region trong Enjoy. Danh mục nguồn đã kiểm tra nằm trong [`playback-sources.json`](playback-sources.json). Không có thay đổi source, UI, dữ liệu người dùng hoặc dependency trong lượt này.

## Kết luận có thể dùng ngay

Enjoy đang cài `wavesurfer.js` 7.9.1: [`enjoy/package.json:206`](../../../enjoy/package.json:206), lockfile resolve về 7.9.1 và thư mục cục bộ cũng là 7.9.1. Tag bất biến là commit [`1df2bd9`](https://github.com/katspaugh/wavesurfer.js/tree/1df2bd924fdec4f86263de4ae0fa2c6bade9a289).

Chain giải thích mạnh nhất cho hiện tượng click region rồi dừng ngay là:

1. Trong 7.9.1, `region.play()` không có đối số chỉ phát từ đầu region; `region.play(true)` mới truyền `end` vào `wavesurfer.play(start, end)` để thư viện tự dừng ở cuối. Xem [`regions.ts`, `play()`](https://raw.githubusercontent.com/katspaugh/wavesurfer.js/7.9.1/src/plugins/regions.ts#L337-L340) và [`saveRegion()`](https://raw.githubusercontent.com/katspaugh/wavesurfer.js/7.9.1/src/plugins/regions.ts#L572-L593).
2. Enjoy dùng native `HTMLMediaElement` qua `media: mediaProvider` trong [`media-shadow-provider.tsx:238-252`](../../../enjoy/src/renderer/context/media-shadow-provider.tsx:238). Đây là backend đúng với issue Chrome đã báo: `region-out` có thể phát ngay sau `region.play()` trước khi audio thực sự bắt đầu, rồi handler gọi `pause()`.
3. `RegionsPlugin` tính `region-in` và `region-out` từ các lần `timeupdate` và phép so sánh biên thời gian. Nếu MediaElement làm tròn hoặc kẹp `currentTime` hơi nhỏ hơn `region.start`, một lần `region-out` giả có thể đến ngay sau seek. PR upstream mới nhất mô tả đúng race này và thêm tolerance 0.05 giây ở biên start.
4. Hai đường code của Enjoy đều gọi `pause()` ngay khi nhận `region-out`: [`media-player-controls.tsx:303-329`](../../../enjoy/src/renderer/components/medias/media-bottom-panel/media-player-controls.tsx:303) và [`media-current-recording.tsx:344-351`](../../../enjoy/src/renderer/components/medias/media-bottom-panel/media-current-recording.tsx:344). Vì vậy một event `region-out` giả, vốn có thể chỉ là sai khác boundary, trở thành dừng playback thật.

Đây là giả thuyết có độ ưu tiên cao, không phải kết luận runtime. Chưa có trace của đúng phiên Enjoy chứng minh thứ tự `region-clicked -> play -> region-out -> pause` hay giá trị `currentTime` tại từng event. Không nên gọi đây là root cause đã xác minh cho đến khi trace đó có mặt.

## Bằng chứng upstream theo một chain liên tục

### 1. Semantics của 7.9.1

- `Region.play(stopAtEnd?)` phát event `play`; chỉ khi truyền `true` mới gửi `this.end` làm điểm dừng. [`regions.ts:337-340`](https://raw.githubusercontent.com/katspaugh/wavesurfer.js/7.9.1/src/plugins/regions.ts#L337-L340)
- Listener của plugin chuyển event đó thành `wavesurfer.play(region.start, end)`. [`regions.ts:591-593`](https://raw.githubusercontent.com/katspaugh/wavesurfer.js/7.9.1/src/plugins/regions.ts#L591-L593)
- `WaveSurfer.play(start, end)` gọi `setTime(start)`, sau đó với MediaElement ghi `stopAtPosition = end`. [`wavesurfer.ts:567-596`](https://raw.githubusercontent.com/katspaugh/wavesurfer.js/7.9.1/src/wavesurfer.ts#L567-L596)
- Timer nội bộ chạy khoảng 16 ms, phát `timeupdate` và tự pause khi `currentTime >= stopAtPosition`; các event native của MediaElement cũng phát `timeupdate`, `play`, `pause`, `ended` và `finish`. [`wavesurfer.ts:213-273`](https://raw.githubusercontent.com/katspaugh/wavesurfer.js/7.9.1/src/wavesurfer.ts#L213-L273)
- `RegionsPlugin` theo dõi các region đang chứa `currentTime`; chênh lệch membership tạo `region-in` hoặc `region-out`. Vì đây là event theo membership của `timeupdate`, nó không phải một promise rằng audio đã chạy ổn định từ start tới end. [`regions.ts:447-479`](https://raw.githubusercontent.com/katspaugh/wavesurfer.js/7.9.1/src/plugins/regions.ts#L447-L479)

Ví dụ chính thức của tag 7.9.1 dùng `region.play(true)` khi click và chỉ dùng `region.play()` cho loop sau khi đã ở trong region. [`examples/regions.js:77-103`](https://raw.githubusercontent.com/katspaugh/wavesurfer.js/7.9.1/examples/regions.js#L77-L103). Test không có audio cũng xác nhận `setTime(2)` có thể phát `region-in` dù `isPlaying()` vẫn là `false`, nên event region không đồng nghĩa với trạng thái đang phát. [`regions-no-audio.cy.js:50-76`](https://raw.githubusercontent.com/katspaugh/wavesurfer.js/7.9.1/cypress/e2e/regions-no-audio.cy.js#L50-L76)

### 2. Issue sát với đường code Enjoy

- [Issue #3866](https://github.com/katspaugh/wavesurfer.js/issues/3866) mô tả Chrome với MediaElement phát `region-out` ngay khi gọi `region.play()`, trong khi Safari và WebAudio không gặp. Reproduction có handler `region-out` gọi `wavesurfer.pause()`, giống pattern của Enjoy. Issue đã được đóng sau đó, nhưng đây là first-hand report, không phải benchmark tỷ lệ lỗi.
- [Issue #3631](https://github.com/katspaugh/wavesurfer.js/issues/3631) mô tả start có nhiều chữ số thập phân `9.16454684654654`; `region-out` đến ngay sau `region-clicked` trên Chrome.
- [Issue #3781](https://github.com/katspaugh/wavesurfer.js/issues/3781) ghi nhận `region-in` và `region-out` cách nhau 7 ms với start `6.310421089646` và end `8.87566764644661`.
- [Issue #4058](https://github.com/katspaugh/wavesurfer.js/issues/4058) cho thấy region sau drag có thể fail khi dùng `region-out` để pause; làm tròn start là workaround không ổn định.

PR [#4359](https://github.com/katspaugh/wavesurfer.js/pull/4359), merge ngày 2026-09-03, gom đúng các issue #3631, #3781 và #3866. Phần sửa thêm `REGION_BOUNDARY_TOLERANCE = 0.05` chỉ ở biên start của kiểm tra `region-in/out`; biên end vẫn chính xác. PR có test high-precision start seek và reproduction thủ công dùng start `9.16454684654654` cùng handler pause ở `region-out`. Điều này là bằng chứng upstream mạnh nhất cho cơ chế, nhưng không chứng minh phiên bản đã build của Enjoy đã chứa patch. Tag cài đặt của Enjoy vẫn là 7.9.1, trước PR này.

### 3. Vấn đề dừng ở end là chain khác

PR [#4014](https://github.com/katspaugh/wavesurfer.js/pull/4014) đưa `play(start, stop)` vào 7.9.1. PR ghi rõ MediaElement theo dõi `timeupdate` và không chính xác tuyệt đối. Vì vậy 7.9.1 có bounded playback API, nhưng độ chính xác stop vẫn còn phụ thuộc timer và event native.

PR [#4318](https://github.com/katspaugh/wavesurfer.js/pull/4318), đã merge ngày 2026-06-10 và có trong release [7.12.8](https://github.com/katspaugh/wavesurfer.js/releases/tag/7.12.8), sửa hai điểm: timer MediaElement có thể overshoot stop position và giữ lại thời gian overshoot; WebAudio có thể tính sai delay khi playback rate khác 1. Đây là lý do 7.9.1 không nên được coi là implementation exact-stop hiện hành. PR này xử lý boundary cuối, còn PR #4359 xử lý race ở boundary đầu. Hai vấn đề cần test riêng.

### 4. Click, lazy region và listener là nhánh phụ

Release [7.8.10](https://github.com/katspaugh/wavesurfer.js/releases/tag/7.8.10) và PR [#3945](https://github.com/katspaugh/wavesurfer.js/pull/3945) sửa region click/seek trong virtual append khi zoom. [Issue #3804](https://github.com/katspaugh/wavesurfer.js/issues/3804) và [#3911](https://github.com/katspaugh/wavesurfer.js/issues/3911) là các report Chrome/Edge/Safari liên quan click, zoom và seek. Chúng chỉ trở thành ưu tiên nếu trace cho thấy click không tới handler hoặc seek bị nuốt, không giải thích trực tiếp `region-out` ngay sau play.

PR [#4291](https://github.com/katspaugh/wavesurfer.js/pull/4291) sửa region lazy render khi `setOptions(start/end)` lúc paused. PR [#4209](https://github.com/katspaugh/wavesurfer.js/pull/4209) gom các fix listener/rAF và duplicate subscription. Chúng là lý do cần test recreation, zoom và paused state khi cân nhắc upgrade, nhưng không thay thế trace event.

## Đối chiếu tĩnh với Enjoy

Các quan sát sau chỉ là static evidence:

| Vị trí | Quan sát | Ý nghĩa điều tra |
| --- | --- | --- |
| [`media-shadow-provider.tsx:238-252`](../../../enjoy/src/renderer/context/media-shadow-provider.tsx:238) | WaveSurfer nhận `media: mediaProvider`, tức native MediaElement path | Issue #3866 trên Chrome có thể áp dụng trực tiếp |
| [`media-player-controls.tsx:295-301`](../../../enjoy/src/renderer/components/medias/media-bottom-panel/media-player-controls.tsx:295) | Meaning-group click gọi `region.play()` không truyền `true` | Playback bounded dựa vào handler `region-out`, không dùng stopAtPosition của WaveSurfer |
| [`media-player-controls.tsx:303-329`](../../../enjoy/src/renderer/components/medias/media-bottom-panel/media-player-controls.tsx:303) | `region-out` gọi `wavesurfer.pause()` ngay, sau đó RAF reset/replay | False early out sẽ dừng audio trước khi start ổn định |
| [`media-player-controls.tsx:333-364`](../../../enjoy/src/renderer/components/medias/media-bottom-panel/media-player-controls.tsx:333) | Interval 50 ms kiểm tra active region và có thêm pause/reset cho loop | Có thêm scheduler cạnh timer 16 ms của WaveSurfer; cần log thứ tự |
| [`media-current-recording.tsx:344-351`](../../../enjoy/src/renderer/components/medias/media-bottom-panel/media-current-recording.tsx:344) | Recording region click cũng gọi `region.play()` và region-out pause | Có thể có cùng lỗi ở recording player, độc lập với main media |
| [`media-shadow-provider.tsx:554-557`](../../../enjoy/src/renderer/context/media-shadow-provider.tsx:554) | State `currentTime` làm tròn lên 2 chữ số | UI/index có thể lệch so với raw currentTime mà plugin dùng; không dùng state này thay trace native |
| [`media-transcription.tsx:94-110`](../../../enjoy/src/renderer/components/medias/media-left-panel/media-transcription.tsx:94) | play/pause/finish listener có cleanup | Nhánh transcription không cho thấy leak listener tại đây |
| [`wavesurfer-lifecycle.ts:79-146`](../../../enjoy/src/renderer/lib/wavesurfer-lifecycle.ts:79) | Helper lifecycle lưu unsubscribe, chặn callback của instance cũ | Đây là pattern tốt cần giữ khi sửa hoặc nâng wrapper |

`region.play()` không có `true` có thể là quyết định thiết kế của Enjoy để dùng `region-out` cho single/loop. Vì vậy không tự đổi sang `region.play(true)` trong lượt nghiên cứu này: cần xác định semantics mong muốn của `playMode`, active region và recording compare trước khi sửa.

## Trace tối thiểu để chuyển giả thuyết thành kết luận

Gắn một trace tạm thời quanh một click, không thay đổi hành vi. Mỗi record cần có `performance.now()`, `instanceId`, `region.id`, `region.start`, `region.end`, native `media.currentTime`, `media.paused`, `media.readyState`, `media.seeking`, `wavesurfer.getCurrentTime()` và `wavesurfer.isPlaying()`.

Ghi riêng các event theo thứ tự:

1. `region-clicked` và mọi `interaction`.
2. Lời gọi `region.play()` hoặc `region.play(true)`, tham số thực tế và Promise resolve/reject của `media.play()` nếu có.
3. `seeking`, native `play`, WaveSurfer `play`, `timeupdate`, `audioprocess`, native `pause`, WaveSurfer `pause`, `region-in`, `region-out`, `finish`.
4. Mọi lời gọi `pause()`, `setTime()`, `playPause()`, `setScrollTime()`, gồm caller tag: handler region-out, interval 50 ms, RAF, timeout hoặc nút UI.
5. `regions.getRegions()` và object identity của `activeRegion` khi region được tạo, remove, update hoặc thay thế.

Pass cho một click bounded là: start seek đúng, audio chuyển sang playing, không có `region-out` trước khi `currentTime` hợp lệ trong region, chỉ một đường pause ở end, và `currentTime` không overshoot ngoài tolerance đã chọn. Nếu fail, trace phải chỉ ra event đầu tiên phá invariant. Nếu event đúng nhưng audio không chạy, kiểm `media.play()` rejection/autoplay hoặc `readyState`; không gán cho RegionsPlugin.

## Ma trận regression nên chạy trước khi sửa

| Case | Biến thể | Câu hỏi |
| --- | --- | --- |
| Boundary start | start/end integer | Baseline có play ổn không? |
| Precision start | `9.16454684654654`, `6.310421089646` | Có early `region-out` không? |
| Drag/update | region được kéo tạo float | Có tái hiện #4058 không? |
| API semantics | `region.play()` và `region.play(true)` | Chỉ `true` mới bounded đúng không? |
| Pause policy | không pause ở region-out, pause có guard end | False out có còn làm audio dừng không? |
| Playback rate | 0.5, 1, 1.5 | Stop position có overshoot không? |
| State | paused tại start, đang phát region khác, click lặp | Có stale activeRegion hoặc duplicate event không? |
| Rendering | zoom, scroll, paused update, remove/recreate region | Có click/seek hoặc lazy-render regression không? |
| Player | main media và recording player | Chỉ một backend/component lỗi hay cả hai? |

Chạy cùng case trên 7.9.1, release có exact-stop fix như 7.12.8, và bản chứa PR #4359 nếu dependency audit cho phép. Không dùng pass của một bản upstream để suy ra pass của Enjoy nếu trace hoặc build runtime khác.

## Hướng xử lý được đề xuất

1. Tạo trace và reproduction tối thiểu trong đúng Chromium/MediaElement path của Enjoy.
2. Tách hai quyết định: bounded playback dùng `region.play(true)` hoặc `wavesurfer.play(start, end)`; loop dùng logic riêng sau khi đã có `region-in` hợp lệ. Không dùng một `region-out` không guard để vừa phát hiện end vừa quyết định mọi lần pause.
3. Nếu phải giữ handler hiện tại trong khi xác minh, chỉ coi một `region-out` là end khi current time đã ở gần end; một `region-out` xảy ra trước start phải được log và bỏ qua. Đây là workaround chẩn đoán, chưa phải patch chốt.
4. Đánh giá nâng `wavesurfer.js` sau khi chạy ma trận. 7.12.8 có exact-stop fix; PR #4359 đã merge sau tag 7.12.11 nhưng release chứa PR này chưa được xác nhận trong nghiên cứu. Cần pin version, build, rồi test main media và recording player.
5. Giữ cleanup unsubscribe và instance identity. Không tạo listener mới trong effect mà không hủy listener cũ; không coi `currentTime` đã làm tròn ở React state là bằng chứng boundary.

## Giới hạn bằng chứng

- Chưa chạy app, Chromium, audio thật hoặc thiết bị trong lượt nghiên cứu này.
- Chưa có event trace của case lỗi và chưa chứng minh component nào là case người dùng đang gặp.
- Issue upstream là reproductions theo browser/version cụ thể. Chúng chứng minh khả năng và cơ chế được báo, không cho biết tỷ lệ lỗi trong Enjoy.
- `wavesurfer-lifecycle.ts` cho thấy một pattern cleanup tốt, nhưng không chứng minh mọi WaveSurfer instance của Enjoy đều có cùng lifecycle.
- Không có matched issue riêng cho repository Enjoy trong các nguồn OSS đã kiểm tra. Phần đối chiếu Enjoy là static code evidence và cần runtime xác nhận.
