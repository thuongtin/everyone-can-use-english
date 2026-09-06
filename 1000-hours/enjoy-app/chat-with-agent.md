# Trò chuyện với tác nhân AI

## Tạo tác nhân AI {#create-agent}

Trên trang **Trò chuyện**, nhấn nút **+** ở góc trên bên phải của thanh bên trái để mở hộp thoại tạo tác nhân.

Enjoy hỗ trợ hai loại tác nhân:

- **GPT:** trò chuyện bằng văn bản, có thể đóng các vai trò khác nhau theo lời nhắc.
- **TTS:** chuyển văn bản nhập vào thành giọng nói, có thể chọn ngôn ngữ và giọng đọc.

### Tác nhân GPT {#gpt-agent}

Khi chọn loại GPT, bạn có thể chọn một lời nhắc có sẵn trong mục **Mẫu**.

![Chọn mẫu tác nhân GPT](/images/enjoy/chat-gpt-select-template.png)

Sau khi chọn mẫu, ứng dụng tự điền tên, mô tả và lời nhắc của tác nhân. Bạn có thể sửa các mục này theo nhu cầu.

Nhấn **Lưu** để tạo tác nhân.

### Tác nhân TTS {#tts-agent}

Khi chọn loại TTS, ngoài tên và mô tả, cần cấu hình:

- **Công cụ giọng nói:** chọn `OpenAI` nếu dùng khóa OpenAI riêng; chọn `EnjoyAI` nếu sử dụng dịch vụ của Enjoy.
- **Mô hình giọng nói:** tài liệu gốc mô tả EnjoyAI hỗ trợ hai mô hình của OpenAI, cùng với `Azure/Speech`. Azure/Speech có nhiều lựa chọn ngôn ngữ và giọng địa phương hơn. Danh sách thực tế phụ thuộc dịch vụ và phiên bản đang dùng.
- **Ngôn ngữ TTS:** áp dụng cho `Azure/Speech`, dùng để chọn ngôn ngữ và giọng địa phương.
- **Giọng đọc:** với `Azure/Speech`, mỗi ngôn ngữ có các giọng đọc tương ứng để lựa chọn.

![Cấu hình tác nhân TTS](/images/enjoy/chat-tts-agent.png)

Nhấn **Lưu** để tạo tác nhân.

## Tạo cuộc trò chuyện {#new-chat}

Chọn một tác nhân, rồi nhấn **Cuộc trò chuyện mới** ở phía dưới thanh bên trái.

Tác nhân GPT phản hồi câu hỏi của bạn dựa trên **lời nhắc đã cấu hình**. Câu trả lời do AI tạo cần được đối chiếu khi dùng làm tài liệu học.

![Cuộc trò chuyện mới với GPT](/images/enjoy/chat-new-chat-gpt.png)

Tác nhân TTS chuyển văn bản bạn nhập thành giọng nói.

![Cuộc trò chuyện mới với TTS](/images/enjoy/chat-new-chat-tts.png)

## Cài đặt cuộc trò chuyện {#chat-settings}

Nhấn biểu tượng bánh răng ở góc trên bên phải để cấu hình cuộc trò chuyện và các thành viên hiện tại.

![Cài đặt cuộc trò chuyện](/images/enjoy/chat-settings.png)

::: info Lời nhắc bổ sung cho cả cuộc trò chuyện
Có thể đặt **Lời nhắc bổ sung** trong cài đặt cuộc trò chuyện. Nội dung này được chia sẻ với tất cả tác nhân trong cuộc trò chuyện như một phần bổ sung của `SYSTEM PROMPT`.

Ví dụ, nếu muốn chỉ luyện một chủ đề nhất định, hãy nêu phạm vi đó trong lời nhắc bổ sung của cuộc trò chuyện.
:::

## Cài đặt thành viên {#member-settings}

Khi thêm tác nhân vào một cuộc trò chuyện mới, bạn có thể cấu hình riêng cho thành viên đó. Thiết lập LLM ban đầu lấy từ **Mô hình AI mặc định** trong cài đặt ứng dụng; thiết lập TTS ban đầu lấy từ **Mô hình TTS mặc định**.

![Cài đặt thành viên trò chuyện](/images/enjoy/chat-member-settings.png)

::: info Lời nhắc bổ sung cho một thành viên
**Lời nhắc bổ sung** trong cài đặt thành viên chỉ áp dụng cho tác nhân đó trong cuộc trò chuyện hiện tại.

Ví dụ, nếu nhiều tác nhân đang tranh luận và bạn muốn một thành viên giữ một quan điểm cụ thể, hãy mô tả quan điểm đó tại đây.

Mục **Xem trước lời nhắc** hiển thị đầy đủ `SYSTEM PROMPT` của thành viên theo thời gian thực. Tài liệu gốc mô tả thứ tự là **lời nhắc bổ sung của cuộc trò chuyện**, **lời nhắc của tác nhân**, rồi **lời nhắc bổ sung của thành viên**. Trong mã nguồn hiện tại, thứ tự ghép để xem trước là **lời nhắc của tác nhân**, **lời nhắc bổ sung của cuộc trò chuyện**, rồi **lời nhắc bổ sung của thành viên**.
:::

## Nhập bằng giọng nói {#voice-input}

Nhấn biểu tượng micro ở bên trái ô nhập tin nhắn để bắt đầu nhập bằng giọng nói.

Sau khi ghi âm, Enjoy dùng dịch vụ STT đã cấu hình để chuyển giọng nói thành văn bản. Tin nhắn chưa tự gửi mà được giữ trong ô soạn thảo.

Nếu nhận dạng sai, bạn có thể sửa văn bản hoặc ghi âm lại. Nếu muốn cải thiện cách diễn đạt, nhấn **Chỉnh sửa câu** để nhận gợi ý từ AI, rồi thử ghi âm lại.

![Gợi ý cải thiện cách diễn đạt](/images/enjoy/chat-refine.png)

Khi nội dung đã đúng ý, nhấn **Gửi** và chờ phản hồi của AI.

## Gợi ý trò chuyện {#chat-suggestions}

Để luyện đối thoại, có thể bật **Trợ lý trò chuyện** trong cài đặt cuộc trò chuyện. Biểu tượng đũa thần sẽ xuất hiện bên phải ô nhập. Nhấn vào đó để nhận gợi ý dựa trên lịch sử trao đổi hiện tại.

![Gợi ý tiếp tục cuộc trò chuyện](/images/enjoy/chat-suggest.png)
