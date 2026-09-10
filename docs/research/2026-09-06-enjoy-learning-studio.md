# Nghiên cứu Learning Studio cho Enjoy

Ngày kiểm tra: 2026-09-06. Source app: `f21f4304ae45cf0f43acde3473f4ca824db9ed11`, kèm các thay đổi YouTube chưa commit tại thời điểm khảo sát. Đây là nghiên cứu source và tài liệu, chưa phải kết quả chạy các tính năng đề xuất.

## 1. Kết luận cho sản phẩm

Luồng chính đã được người dùng chọn: tạo nội dung ngay trong Enjoy. Đề xuất thêm **Xưởng bài học**, nơi một brief gồm level, chủ đề hoặc từ khóa tạo ra bài học có câu chuyện, mindmap, ảnh, audio và bài luyện liên quan. Agent là bộ máy tạo nội dung ở bên trong; người học không phải chuyển sang terminal hoặc tự viết prompt dài.

Không cần viết lại toàn bộ app. Đợt nâng cấp AI trước đã tạo provider factory, structured JSON và chuẩn hóa TTS. Phần còn thiếu là domain bài học local, điều phối tác vụ bền vững, kết nối agent, quản lý tài nguyên sinh ra và vòng luyện tập.

## 2. Hiện trạng đã đối chiếu với code

| Thành phần | Bằng chứng hiện tại | Quyết định |
|---|---|---|
| AI factory | `enjoy/src/lib/chat-model.ts:264`, `enjoy/src/commands/json.command.ts:35` | Tái sử dụng cho text/JSON; không coi đây là agent runtime hay MCP host. |
| Tạo story | `enjoy/src/commands/extract-story.command.ts:7` chỉ lấy words/idioms từ nội dung đã có | Tạo command riêng cho sáng tác truyện, không đổi ý nghĩa `extractStory`. |
| Stories | `enjoy/src/types/story.d.ts:1`, `enjoy/src/renderer/pages/story.tsx:36` theo URL và server API | Giữ domain này; bài học sinh mới có SQLite identity và revision riêng. |
| Media | `enjoy/src/main/db/models/speech.ts:51` có source, segment, hash, local URL | Tái sử dụng provider/player, giữ Speech cho nguồn cũ. Do source bắt buộc, hash unique và cleanup hook, learning audio dùng một owner GeneratedAsset riêng để tránh metadata kép. |
| TTS | `enjoy/src/main/db/models/speech.ts:185`, `enjoy/src/lib/speech-models.ts:224` khóa model OpenAI và `.mp3` | Provider local cần output contract riêng, không giả làm model OpenAI. |
| Persistence | `enjoy/src/main/db/index.ts:63`, `enjoy/src/preload.ts:516` | Theo mẫu model, migration, handler, preload và public type hiện có. |
| Assets | Story viewer/card nhận ảnh URL/Markdown | Lưu bytes ảnh vào thư viện, không phụ thuộc URL tạm của provider. |
| Security | `enjoy/src/main/db/models/user-setting.ts:30`, `use-speech.tsx:83` cho thấy settings JSON và một số client ở renderer | Domain mới đặt secrets, agent process và tool handler ở main. Không mở rộng cách truyền key sang renderer. |

Tài liệu `docs/research/ai-modernization/architecture-baseline.md` tự ghi là snapshot trước thay đổi. Không dùng các kết luận cũ như “chưa có Responses” để mô tả source hiện tại.

## 3. Học gì từ Buzz

Snapshot Buzz: `3c7f288c60d67df78577b237e27c3dfc8831aaa1`. Ba thành phần khác nhau cần được phân biệt:

- **AgentHost** trong Enjoy khởi chạy, gửi yêu cầu, nhận tiến độ, hủy và phục hồi tiến trình AI.
- **ACP/App Server** là giao thức điều khiển phiên AI.
- **MCP** cho AI sử dụng các công cụ có phạm vi như đọc brief bài học và gửi bản nháp về Enjoy.

Buzz tách relay, harness ACP và subprocess; lifecycle có initialize, session, prompt, reconnect và crash recovery. Enjoy nên học cách quản lý vòng đời và chuẩn hóa event. Desktop local hiện tại không cần đem theo relay, mobile pairing hoặc toàn bộ stack Tauri/Rust. [Nguồn Buzz](https://github.com/block/buzz/blob/3c7f288c60d67df78577b237e27c3dfc8831aaa1/crates/buzz-acp/README.md#L265-L345).

Danh sách MCP được truyền vào ACP **không tự tạo sự cô lập**. Buzz kế thừa environment; `codex-acp` thêm MCP vào config hiện hữu thay vì loại tất cả server cũ. Enjoy cần working directory riêng và kiểm effective tool/config trong runtime giữ auth profile hiện có. Home riêng từng được chọn để đơn giản hóa isolation, nhưng không phải yêu cầu của native auth; quyết định đó được thay thế ngày 2026-09-07 theo yêu cầu người dùng. [Buzz process config](https://github.com/block/buzz/blob/3c7f288c60d67df78577b237e27c3dfc8831aaa1/crates/buzz-acp/src/acp.rs#L472-L517), [codex-acp config merge](https://github.com/agentclientprotocol/codex-acp/blob/1a3c01e8ca317f83e3b60bc5632cf052882bea15/src/CodexAcpClient.ts#L732-L793).

### Xác minh lại auth theo Buzz, 2026-09-07

Đã đối chiếu HEAD remote với source local, cùng commit `3c7f288c60d67df78577b237e27c3dfc8831aaa1`. Buzz gọi `codex login status` và `claude auth status` để kiểm readiness, rồi spawn subprocess kế thừa environment người dùng. Vì vậy CLI có thể dùng login hiện có; Buzz không bắt tạo profile auth riêng. [Readiness](https://github.com/block/buzz/blob/3c7f288c60d67df78577b237e27c3dfc8831aaa1/desktop/src-tauri/src/managed_agents/readiness.rs#L395-L458), [spawn](https://github.com/block/buzz/blob/3c7f288c60d67df78577b237e27c3dfc8831aaa1/crates/buzz-acp/src/acp.rs#L462-L517).

Phép kiểm live `enjoy/scripts/check-native-existing-auth.mjs` đạt cả hai CLI: Codex status exit 0; Claude `loggedIn=true`, `authMethod=claude.ai`. Không đọc file credential hoặc in raw output. Claude trên máy này cần giữ `USER` ngoài `HOME`: bỏ USER cho kết quả false, thêm lại cho true. Không dùng `--bare` cho OAuth vì CLI help nêu rõ mode này bỏ đọc keychain/OAuth.

Hai kết quả cần phân biệt: auth hiện có đã được CLI xác nhận; inference, tool isolation trong profile hiện có và native generation trong app chưa nghiệm thu. ProcessManager cùng các spike cũ vẫn ép home riêng, nên cần thay execution policy trước khi tích hợp. Claude có `--restricted`, `--setting-sources ""`, `--strict-mcp-config` và `--tools ""` để thử giới hạn runtime; phải kiểm catalog/plugins thật. `--safe-mode` tắt cả MCP nên không dùng cho job cần Enjoy MCP. Codex config overlay không được coi là allowlist nếu chưa chứng minh effective catalog.

### Codex và tạo ảnh

Chọn kết nối trực tiếp `codex app-server` để giữ đầy đủ item/event, thay vì thêm lớp chuyển đổi ACP cho Codex. App Server được thiết kế cho UI tích hợp, dùng stdio JSONL và có thread/turn lifecycle. [App Server](https://github.com/openai/codex/blob/ac192cd7937b0d73edc6dffe009940ae53782dd4/codex-rs/app-server/README.md#L20-L96).

Đã kiểm tra binary local `codex-cli 0.153.2` và xuất schema bằng lệnh chính binary cung cấp. Schema có item `imageGeneration`, `result`, `status`, `savedPath` tùy chọn và lỗi `usageLimitExceeded`. Source upstream cũng có native image tool và lưu artifact. Điều này chứng minh **có contract nhận ảnh**, chưa chứng minh tài khoản hoặc binary cấu hình riêng sẽ tạo ảnh thành công. [Native image tool](https://github.com/openai/codex/blob/ac192cd7937b0d73edc6dffe009940ae53782dd4/codex-rs/ext/image-generation/src/tool.rs#L58-L95), [artifact output](https://github.com/openai/codex/blob/ac192cd7937b0d73edc6dffe009940ae53782dd4/codex-rs/ext/image-generation/src/tool.rs#L180-L239).

`buzz-dev-mcp.view_image` dùng để xem ảnh đã tồn tại, không phải tool tạo ảnh. Không được suy luận rằng thêm MCP này là có image generation. [Tool source](https://github.com/block/buzz/blob/3c7f288c60d67df78577b237e27c3dfc8831aaa1/crates/buzz-dev-mcp/src/lib.rs#L40-L123).

Quyết định cập nhật 2026-09-07: Codex tự dùng phiên đăng nhập CLI hiện có, giữ HOME và CODEX_HOME nếu người dùng đã cấu hình; không lấy/copy `auth.json` hoặc truyền OAuth token sang API khác. Không yêu cầu đăng nhập lại trong profile Enjoy. Một bài thử phải đi hết từ nút tạo trong app đến ảnh local mở lại sau restart trước khi bật tính năng cho người học.

### Claude Code: điều kiện kết nối

Máy hiện có Claude Code `2.1.263`, với print mode, JSON/stream-json, JSON schema và cấu hình MCP riêng. Buzz chứng minh hướng ACP adapter có thể dùng, nhưng cài adapter không pin nên chưa phải dependency phù hợp để sao chép nguyên trạng.

Hai trường hợp không được nhập làm một:

1. Người dùng đăng nhập vào binary Claude Code nguyên bản bằng phương thức do Anthropic cung cấp. Tài liệu hiện cho phép nền tảng chạy binary đó theo các điều kiện được nêu, bao gồm người dùng tự xác thực và tự chịu usage.
2. Sản phẩm dùng Agent SDK hoặc gọi API riêng. Tài liệu SDK yêu cầu API-key authentication, không cho tự cung cấp Claude.ai login nếu chưa được chấp thuận.

[Điều kiện chạy Claude Code trong sản phẩm](https://code.claude.com/docs/en/legal-and-compliance#can-customers-offer-claude-code-in-their-products), [ranh giới credential](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use), [Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview).

Đề xuất cho bản đầu: adapter gọi binary Claude Code nguyên bản, để CLI sở hữu auth, giới hạn tool/config của job và chứng minh MCP hoạt động. Không dùng SDK/ACP để mặc định suy ra quyền sử dụng gói thuê bao. Nếu chọn SDK sau này, cấu hình API riêng và thông báo billing path. Việc binary đăng nhập được không chứng minh tạo ảnh được; ảnh vẫn là capability riêng của Codex.

## 4. Video được nghiên cứu và ứng dụng

Video: [99% Người học tiếng Anh chưa biết dùng AI để Rút Ngắn thời gian](https://www.youtube.com/watch?v=RgnsPddE-hU), AlexD Music Insight, đăng 2026-04-15, dài 1:44:02. Đã lấy metadata và phụ đề gốc tiếng Việt, đọc toàn bộ 11 chapter. Không xem trực tiếp toàn bộ hình ảnh demo; phụ đề tự động có lỗi tên công cụ và thuật ngữ.

Tóm tắt nguồn: video trình bày học theo ngữ cảnh, echoing, tạo audio cá nhân hóa, echoing ngược, tương tác camera, luyện có đáp án rồi nói tự do, podcast, phân tích lỗi nói và phỏng vấn để xây lịch học. Mốc [57:58](https://www.youtube.com/watch?v=RgnsPddE-hU&t=3478s) nằm trong phần tái dùng cùng nhóm từ ở nhiều dạng bài. Demo cũng có AI quên từ mục tiêu và đưa feedback chưa đúng. Các cam kết rút ngắn xuống ba tháng không được dùng làm cam kết của Enjoy.

Các quyết định dưới đây là **đề xuất của Enjoy**, không phải tính năng được video xác nhận:

| Mốc liên quan | Quyết định thiết kế |
|---|---|
| [06:47](https://www.youtube.com/watch?v=RgnsPddE-hU&t=407s) | Nghe từng câu, ghi âm, nghe lại, luyện lại ngay tại bài học. |
| [28:06](https://www.youtube.com/watch?v=RgnsPddE-hU&t=1686s) | Script có ngữ cảnh cá nhân; text đã chốt làm nguồn duy nhất cho audio. |
| [38:29](https://www.youtube.com/watch?v=RgnsPddE-hU&t=2309s) | Gợi ý kể lại rồi so sánh với câu tham khảo; không coi STT là điểm phát âm. |
| [43:20](https://www.youtube.com/watch?v=RgnsPddE-hU&t=2600s) | Bản đầu dùng cảnh minh họa để hỏi/kể; camera realtime để giai đoạn sau. |
| [56:16](https://www.youtube.com/watch?v=RgnsPddE-hU&t=3376s) | Bài tập giữ cố định target IDs; điền từ, chọn nghĩa, xếp câu rồi kể lại. |
| [1:03:03](https://www.youtube.com/watch?v=RgnsPddE-hU&t=3783s) | Hội thoại nhiều giọng là hướng mở rộng, chưa kéo vào bản đầu. |
| [1:07:55](https://www.youtube.com/watch?v=RgnsPddE-hU&t=4075s) | Feedback cần bằng chứng và khả năng sửa khi AI nghe sai; chưa thêm thang điểm mới. |
| [1:29:58](https://www.youtube.com/watch?v=RgnsPddE-hU&t=5398s) | Lưu sở thích, level tự chọn và kết quả làm bài; lộ trình thích ứng để sau khi có dữ liệu. |

Mindmap không phải nội dung video trực tiếp trình bày. Nó đáp ứng yêu cầu riêng của người dùng và liên kết các từ trong cùng tình huống.

## 5. OmniVoice MLX

Snapshot model được người dùng chỉ định: `mlx-community/OmniVoice`, revision `defe4bdce0decb321d17e96a4774417be08022ea`. Runtime khả thi cần khảo nghiệm: `mlx-audio` 0.5.1, source `41537ec5cf79bcf731a0dd6749cac12ab554a691`.

### Kỹ thuật

OmniVoice upstream có cả English và Vietnamese. MLX cần Mac Apple Silicon, Python native và macOS phù hợp; target của nhánh thử nghiệm là macOS 14+. Chưa đo chất lượng English/Vietnamese, tốc độ hoặc RAM trên máy người dùng. [Ngôn ngữ upstream](https://github.com/k2-fsa/OmniVoice/blob/08be0b4ccbac3e13e374e86fbfead4b4cac343e2/docs/languages.md), [MLX requirements](https://github.com/ml-explore/mlx/blob/ce916dbbcaa88e433b6fd1e60a17f766d49c27fe/docs/src/install.rst).

File tree bản mặc định khoảng 3,04 GiB; bản 4-bit khoảng 1,06 GiB, chưa tính Python/runtime/cache. Đây là dung lượng lưu trữ, không phải yêu cầu RAM. Không tự đổi checkpoint sang bản quantized trước khi thử chất lượng. [Model gốc được yêu cầu](https://huggingface.co/mlx-community/OmniVoice), [variant 4-bit](https://huggingface.co/mlx-community/OmniVoice-4bit).

`mlx-audio` có `/v1/audio/speech`, nhưng OmniVoice hiện chạy xong diffusion/decode mới yield một lần. `stream:true` không có nghĩa người học nghe được ngay. Model không trả word timestamps; abort HTTP chưa ngắt compute giữa chừng. Chọn audio theo đoạn/câu, `stream:false`, WAV, explicit language; hủy tác vụ bằng cách dừng sidecar do app sở hữu khi cần. [OmniVoice implementation](https://github.com/Blaizzy/mlx-audio/blob/41537ec5cf79bcf731a0dd6749cac12ab554a691/mlx_audio/tts/models/omnivoice/omnivoice.py#L483-L645), [server](https://github.com/Blaizzy/mlx-audio/blob/41537ec5cf79bcf731a0dd6749cac12ab554a691/mlx_audio/server.py).

Model card bản người dùng chỉ định hướng dẫn runtime `ailuntx/OmniVoice-MLX`, còn tài liệu `mlx-audio` dùng biến thể `OmniVoice-bf16`. Không coi mọi variant có cùng layout và tương thích trực tiếp. Bước thử phải chứng minh exact model/runtime pair trước khi pin bản dùng trong Enjoy. [Model card](https://huggingface.co/mlx-community/OmniVoice/blob/defe4bdce0decb321d17e96a4774417be08022ea/README.md), [mlx-audio OmniVoice guide](https://github.com/Blaizzy/mlx-audio/blob/41537ec5cf79bcf731a0dd6749cac12ab554a691/docs/models/tts/omnivoice.md).

### Giấy phép và quyết định

Code upstream là Apache-2.0, `mlx-audio` là MIT. Tuy nhiên model card pretrained upstream ghi **CC-BY-NC**; tokenizer kèm theo có **Boson Higgs Audio 2 Community License**. Metadata Apache trên bản chuyển đổi chưa giải quyết được sự khác nhau này. [Upstream model license](https://huggingface.co/k2-fsa/OmniVoice/blob/c5fdb5ccb189668d56333f77ba2629f4cd7535f4/README.md#license), [tokenizer license](https://huggingface.co/mlx-community/OmniVoice/blob/defe4bdce0decb321d17e96a4774417be08022ea/audio_tokenizer/LICENSE).

Đưa OmniVoice vào kế hoạch thử nghiệm local tùy chọn. Chưa bundle weights hoặc bật download cho bản phát hành thương mại khi phạm vi sử dụng chưa rõ. Bài học vẫn phát được bằng TTS đã cấu hình; không tự chuyển sang nhà cung cấp trả phí khi local gặp lỗi. Voice cloning để sau.

## 6. Các nguồn bổ sung quyết định triển khai

- [CEFR của Council of Europe](https://www.coe.int/en/web/common-european-framework-reference-languages/level-descriptions): sáu mức A1-C2 là mô tả năng lực, không phải công thức đếm từ. Enjoy dùng nhãn mức gợi ý, rubric và bộ mẫu kiểm tra.
- [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports): loopback cần kiểm Origin, chỉ bind localhost và xác thực kết nối. Giới hạn tool theo job là quyết định bổ sung của Enjoy.
- [React Flow mindmap](https://reactflow.dev/learn/tutorials/mind-map-app-with-react-flow): phù hợp graph React có node tương tác. Dữ liệu giáo dục vẫn do schema của Enjoy sở hữu, không lưu state UI làm nội dung gốc.

## 7. Giới hạn bằng chứng

Đã kiểm source app, repo tham chiếu, tài liệu chính thức, CLI version/schema và transcript. Chưa chạy agent inference, tải model, tạo ảnh/audio bằng tích hợp mới, benchmark, đóng gói hoặc kiểm giao diện mới. Các bước đó nằm trong cổng nghiệm thu của kế hoạch. Các thay đổi YouTube đang có được giữ nguyên.
