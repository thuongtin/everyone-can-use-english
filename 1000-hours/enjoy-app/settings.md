# Cài đặt ứng dụng

Enjoy mở bằng hồ sơ local, không cần đăng nhập Enjoy. Thư viện và từ điển dùng được trên máy; các tác vụ AI cần chọn và cấu hình provider phù hợp.

Mở Enjoy rồi nhấn biểu tượng bánh răng ở cuối thanh bên trái để mở **Cài đặt**.

::: info Ghi chú cho bản tiếng Việt
Bản này dùng tiếng Việt cho giao diện và tiếng mẹ đẻ mặc định, tiếng Anh Mỹ cho ngôn ngữ học. Lựa chọn đã lưu của người dùng được giữ nguyên. Bản này không dùng backend, ví hoặc token dịch vụ của Enjoy. Việc có adapter không đồng nghĩa tài khoản provider đã có quyền dùng mô hình; hãy kiểm tra cấu hình của từng dịch vụ.
:::

## Cài đặt cơ bản {#basic-settings}

### Tiếng mẹ đẻ {#native-language}

Chọn tiếng mẹ đẻ của bạn. Giá trị mặc định cho người dùng mới trong bản Việt hóa là **Tiếng Việt** (`vi-VN`). Bản gốc dùng tiếng Trung giản thể.

Thiết lập này quyết định ngôn ngữ của bản dịch, phần phân tích và giải thích trong lúc học; nó không quyết định ngôn ngữ giao diện.

### Ngôn ngữ đang học {#learning-language}

Chọn ngôn ngữ muốn học. Mặc định là **English (United States)**, tức tiếng Anh Mỹ (`en-US`).

### Dịch vụ chuyển giọng nói thành văn bản {#speech-to-text}

::: info Đường dẫn cài đặt
Cài đặt -> Cơ bản -> Dịch vụ AI chép lời
:::

Chuyển giọng nói thành văn bản, hay STT (Speech to Text), là một chức năng cốt lõi của Enjoy và là bước cần thiết trước khi [luyện nhại theo âm thanh](./audios.md#shadowing).

Lựa chọn ở đây là mặc định. Mỗi lần chép lời, bạn vẫn có thể chọn dịch vụ khác.

<details>
<summary>Trên máy (Whisper)</summary>

Lựa chọn mặc định trong tài liệu gốc là **Trên máy**: dùng thành phần Whisper tích hợp trong Enjoy và hoàn toàn dựa vào khả năng tính toán của máy bạn. Dịch vụ chạy trên máy không thu phí sử dụng.

Enjoy mặc định chọn mô hình Whisper `tiny.en`. Nếu máy có cấu hình cao, bạn có thể chọn mô hình lớn hơn để tăng độ chính xác khi chép lời.

::: tip Chọn mô hình Whisper
Lần sử dụng đầu tiên, ứng dụng tự tải mô hình. Mô hình càng lớn, thời gian tải càng dài. Tài liệu gốc đề xuất thông thường dùng mô hình nhỏ hơn `medium` là đủ.

Về lý thuyết, mô hình lớn hơn thường nhận dạng chính xác hơn nhưng chạy chậm hơn, thậm chí không chạy được trên một số máy cấu hình thấp.

Mô hình có đuôi `.en`, chẳng hạn `base.en`, chỉ hỗ trợ tiếng Anh và được tối ưu cho nhận dạng tiếng Anh. Mô hình không có đuôi này, chẳng hạn `base`, hỗ trợ nhiều ngôn ngữ. Khi học tiếng Anh, hãy để ngôn ngữ cần nhận dạng là tiếng Anh; không đổi nó sang tiếng Việt chỉ vì giao diện là tiếng Việt.
:::

::: warning Kiểm tra Whisper trên máy
Một số máy hoặc hệ điều hành, ví dụ macOS 11 được nhắc trong tài liệu gốc, có thể không dùng được Whisper do tương thích hoặc nguyên nhân khác. Nhấn **Kiểm tra** để xác định dịch vụ có hoạt động trên máy hay không. Nếu không, bạn có thể chọn dịch vụ khác.
:::
</details>

Các dịch vụ chép lời cloud được cấu hình riêng:

- **Cloudflare Workers AI:** endpoint Worker và token của bạn.
- **MAI Transcribe:** mô hình MAI qua cấu hình OpenRouter của bạn.
- **OpenAI:** API key và mô hình transcription phù hợp.

Ứng dụng không tự đổi provider khi hết hạn mức hoặc thiếu cấu hình. Cấu hình STT Enjoy cũ cần chọn lại dịch vụ; dữ liệu chép lời đã lưu vẫn được giữ.

### Dịch vụ chuyển văn bản thành giọng nói {#text-to-speech}

::: info Đường dẫn cài đặt
Cài đặt -> Cơ bản -> Dịch vụ chuyển văn bản thành giọng nói
:::

Chuyển văn bản thành giọng nói, hay TTS (Text to Speech), tổng hợp âm thanh từ văn bản để luyện đọc theo mẫu. Lựa chọn ở đây là mặc định; mỗi lần tạo giọng nói, bạn vẫn có thể chọn dịch vụ khác.

Chọn OpenAI hoặc Azure Speech với cấu hình riêng, sau đó chọn mô hình và giọng đọc tương thích. Azure Speech dùng credential/resource riêng; key OpenRouter dùng cho MAI không thay thế cấu hình này. Không cần số dư Enjoy.

### Dịch vụ AI mặc định {#default-ai-engine}

::: info Đường dẫn cài đặt
Cài đặt -> Cơ bản -> Dịch vụ AI mặc định
:::

Enjoy có nhiều chức năng hỗ trợ việc học.

Chọn một provider đã cấu hình: OpenAI, Gemini, DeepSeek, OpenRouter, Ollama, LM Studio hoặc Codex/Claude qua ACP. Mỗi dịch vụ chỉ cung cấp những khả năng tương ứng được hiển thị trong ứng dụng. Khi chưa chọn dịch vụ, các tác vụ AI sẽ hướng dẫn cấu hình; nội dung local vẫn mở được.

Trong phần mô hình mặc định, bạn có thể chọn mô hình khác nhau cho từng chức năng.

## Cài đặt từ điển {#dictionary-settings}

### Từ điển có sẵn

Enjoy có hai bộ từ điển offline:

| Từ điển | Dùng khi | Số khóa tra cứu trong bản hiện tại |
| --- | --- | --- |
| Anh - Việt | Đọc/nghe tiếng Anh và tìm nghĩa tiếng Việt | 118.926 |
| Việt - Anh | Tìm từ hoặc cách diễn đạt bằng tiếng Anh | 29.730 |

Hai bộ đi kèm ứng dụng, không cần tải ZIP, tài khoản, API hoặc kết nối mạng để tra nghĩa và phiên âm IPA. Liên kết nguồn cần Internet; bộ này không kèm âm thanh phát âm. Dữ liệu cộng đồng có thể thiếu từ hoặc có nghĩa chưa chính xác, nên đối chiếu ngữ cảnh; ví dụ sử dụng hiện chỉ có ở bộ Anh - Việt.

Ở màn hình chào hoặc đăng nhập, chọn **Mở từ điển offline**. Chọn chiều tra cứu, nhập từ hoặc cụm từ rồi nhấn **Tra từ**. Ví dụ: `learn`, `bank`, `take care` ở chiều Anh - Việt; `học`, `xin chào`, `ngân hàng` ở chiều Việt - Anh. Nhập đủ dấu tiếng Việt để phân biệt các từ như `ma` và `má`. Trang tra từ nhớ chiều đã chọn trên thiết bị.

Trong nội dung học, chọn từ hoặc cụm từ rồi chọn **Anh - Việt** hoặc **Việt - Anh** ở danh sách từ điển. Khi chưa có lựa chọn mặc định đã lưu và đang học tiếng Anh, Enjoy dùng **Anh - Việt**. Vào **Cài đặt -> Từ điển** và nhấn **Đặt làm mặc định** cạnh bộ muốn dùng để lưu lựa chọn cho tài khoản. Từ điển do bạn nhập trước đây và lựa chọn đã lưu được giữ.

### Nguồn và giấy phép

Nghĩa tiếng Việt của mục từ tiếng Anh lấy từ [Wiktionary tiếng Việt qua Kaikki](https://kaikki.org/viwiktionary/Ti%E1%BA%BFng%20Anh/index.html); nghĩa tiếng Anh của mục từ tiếng Việt lấy từ [Wiktionary tiếng Anh qua Kaikki](https://kaikki.org/dictionary/Vietnamese/index.html). Đây là hai nguồn riêng, không đảo ngược máy móc danh sách dịch. Dữ liệu được biên tập, lọc mục từ chữ Latin và phân phối theo [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), ghi công cộng tác viên Wiktionary và Kaikki. Mỗi kết quả có liên kết nguồn. Chi tiết phiên bản, hash và thay đổi được đóng gói cùng từ điển.

### Nhập từ điển riêng {#import-dictionary}

::: info Đường dẫn cài đặt
Cài đặt -> Từ điển -> Nhập từ điển
:::

Enjoy vẫn hỗ trợ MDict. Với bộ chỉ có một tệp `.mdx`, nhập trực tiếp. Với bộ có nhiều tệp, chọn đầy đủ các tệp liên quan, gồm `.mdx`, `.mdd`, `.js` và các tệp đi kèm. Chỉ nhập bộ từ điển và mã đi kèm từ nguồn bạn tin cậy, có quyền sử dụng.

Đường nhập ZIP của các phiên bản Enjoy cũ được giữ cho dữ liệu tương thích. Hai bộ Anh - Việt và Việt - Anh có sẵn không cần nhập lại. Danh sách từ điển và kho tải của bản gốc được lưu riêng làm tư liệu đối chiếu; không còn dùng để thiết lập bản dành cho người Việt.

## Cài đặt nâng cao {#advanced-settings}

### Cài đặt API {#api-settings}

Ứng dụng không còn địa chỉ API backend Enjoy chung. Cấu hình endpoint nằm trong từng provider; không dùng địa chỉ backend Enjoy cũ hoặc địa chỉ thay thế của backend đó.

### Cài đặt proxy {#proxy-settings}

Cấu hình proxy cho Enjoy App.

### Trạng thái mạng {#network-status}

Kiểm tra cấu hình và kết nối của provider đang dùng. Một provider không khả dụng không ngăn bạn mở thư viện local.

### Cấu hình OpenAI {#openai-settings}

::: info Đường dẫn cài đặt
Cài đặt -> Nâng cao -> OpenAI
:::

Cấu hình API key OpenAI. Bạn có thể tạo key tại [trang API key của OpenAI](https://platform.openai.com/api-keys). Dịch vụ đã cấu hình có thể dùng cho [trò chuyện](./chat.md) và các chức năng khác.

- **API key:** key của OpenAI.
- **Mô hình:** mô hình dùng mặc định.
- **Địa chỉ API:** nếu key được cấp trực tiếp bởi OpenAI, không cần điền. Nếu dùng nhà cung cấp khác, điền theo hướng dẫn của nhà cung cấp đó.

::: warning Địa chỉ API
Tài liệu gốc đề cập việc OpenAI không cung cấp dịch vụ tại một số khu vực, nên có người dùng dịch vụ trung gian. Nếu sử dụng, hãy điền **Địa chỉ API** theo thông tin nhà cung cấp. Nếu có lỗi, địa chỉ có thể cần kết thúc bằng `/v1`.
:::

### Đặt lại cài đặt {#reset-settings}

Đưa cài đặt về mặc định. Đọc phạm vi xóa hiển thị trong ứng dụng trước khi xác nhận; cấu hình provider có thể cần nhập lại.

### Đặt lại tất cả {#reset-all}

Xóa dữ liệu theo phạm vi hiển thị trong hộp xác nhận. Sao lưu thư viện trước khi thực hiện.

## Cài đặt tài khoản {#account-settings}

### Đường dẫn thư viện {#library-path}

::: info Đường dẫn cài đặt
Cài đặt -> Tài khoản -> Đường dẫn thư viện
:::

Enjoy áp dụng thiết kế **ưu tiên lưu trên máy**. Phần lớn dữ liệu nằm trên thiết bị, trong **Đường dẫn thư viện**.

Thư viện là thư mục có tên `EnjoyLibrary`, mặc định nằm trong `My Documents` (Tài liệu của tôi).

Khi dùng lâu, thư viện có thể chứa nhiều tệp bộ nhớ đệm và chiếm dung lượng lớn. Bạn có thể đổi vị trí theo nhu cầu, ví dụ chuyển từ ổ _C_ sang ổ _D_ có nhiều chỗ trống hơn.

Nếu đã có dữ liệu, trước tiên sao chép thư mục `EnjoyLibrary` cũ sang vị trí mới. Sau đó nhấn **Chỉnh sửa** trong Enjoy, chọn vị trí đích và khởi động lại ứng dụng để hoàn tất.

::: tip Bên trong thư viện có gì?
Mở `EnjoyLibrary`, bạn sẽ thấy cấu trúc tương tự:

```
.
├── 2400xxxx
│   ├── audios
│   │   ├── 0687ae31c4178bbf0466503e56d887f8.mp3
│   │   └── ...
│   ├── enjoy_database.sqlite
│   ├── recordings
│   │   ├── 025542894635903d5ea6f2395cb404c0.wav
│   │   └── ...
│   ├── speeches
│   │   ├── 0687ae31c4178bbf0466503e56d887f8.mp3
│   │   └── ...
│   └── videos
│       ├── 23876d46305bae2e049c691872dd3cde.mkv
│       └── ...
├── cache
│   ├── 0687ae31c4178bbf0466503e56d887f8.json
│   └── ...
├── logs
│   ├── main.log
│   └── main.old.log
├── waveforms
│   ├── 0687ae31c4178bbf0466503e56d887f8.waveform.json
│   └── ...
└── whisper
│   ├── models
│   │   ├── tiny.en.bin
│   │   └── ...
```

- `/2400xxxx/`: ID hồ sơ local, có thể giữ ID từ bản cũ. Thư mục chứa dữ liệu cá nhân tạo trong quá trình sử dụng.
  - `/2400xxxx/audios/`: tệp âm thanh đã thêm.
  - `/2400xxxx/speeches/`: tệp giọng nói do TTS tạo.
  - `/2400xxxx/videos/`: tệp video đã thêm.
  - `/2400xxxx/recordings/`: bản ghi âm.
  - `/2400xxxx/enjoy_database.sqlite`: cơ sở dữ liệu cá nhân.
- `/cache/`: bộ nhớ đệm tạo khi sử dụng; tài liệu gốc cho biết có thể xóa an toàn khi chiếm quá nhiều chỗ.
- `/logs/`: nhật ký hoạt động giúp nhà phát triển tìm lỗi.
- `/waveforms/`: bộ nhớ đệm dạng sóng sau khi giải mã âm thanh và video.
- `/whisper/models`: mô hình Whisper dùng để chuyển giọng nói thành văn bản.

:::

::: danger An toàn dữ liệu cá nhân
Mọi tệp trong `EnjoyLibrary/2400xxxx/` đều là dữ liệu cá nhân tạo khi dùng Enjoy. **Không tự xóa hoặc sửa** các tệp này, vì có thể gây mất dữ liệu hoặc khiến ứng dụng không hoạt động bình thường.

Như đã giải thích, Enjoy ưu tiên lưu trên máy; phần lớn dữ liệu không được tải lên máy chủ đám mây. Hãy bảo quản và sao lưu dữ liệu cá nhân của bạn.
:::

### Dung lượng ổ đĩa đã dùng {#disk-usage}

Nhấn **Chi tiết** để xem dung lượng thư viện Enjoy đang sử dụng.

Nhấn **Giải phóng** để xóa hàng loạt tệp ghi âm và giải phóng dung lượng.

### Tài khoản và chi phí provider {#deposit}

Bản này không có ví hoặc chức năng nạp tiền Enjoy. Hạn mức, quyền dùng mô hình và chi phí thuộc tài khoản provider bạn chọn. Cấu hình provider riêng không khôi phục dữ liệu chỉ còn trên server Enjoy; dùng file export bạn đã có để nhập dữ liệu được hỗ trợ.

## Phím tắt {#hotkeys}

Danh sách phím tắt của Enjoy. Nhấn tổ hợp phím để thay đổi.

## Giao diện {#appearance}

Thay đổi chủ đề và ngôn ngữ giao diện.

## Giới thiệu {#about}

Phiên bản hiện tại và liên kết cập nhật.
