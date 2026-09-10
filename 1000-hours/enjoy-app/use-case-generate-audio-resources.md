# Ví dụ: tạo tài liệu luyện tập bằng AI

Một mục tiêu quan trọng khi học ngoại ngữ là diễn đạt được điều chính mình muốn nói. Tài liệu gốc nhận xét rằng nhiều câu trong sách hội thoại có sẵn không đúng với nhu cầu thực tế của từng người, và đề xuất tự tạo một cuốn sách hội thoại riêng. Enjoy có thể hỗ trợ quy trình này.

## Kiểm tra dịch vụ AI {#check-ai-service}

Trước khi bắt đầu, cần có dịch vụ AI hoạt động: cấu hình [nhà cung cấp văn bản](./settings.md#openai-settings) và chọn OpenAI hoặc Azure Speech cho TTS. Thao tác tạo văn bản và giọng đọc phụ thuộc kết nối, tài khoản và dịch vụ đã chọn.

## Tạo huấn luyện viên tiếng Anh {#create-english-coach}

Trong giao diện trợ lý được mô tả ở tài liệu gốc, chọn **Trợ lý AI** ở thanh bên trái, rồi nhấn **Cuộc trò chuyện mới**. Chọn vai trò có sẵn **Huấn luyện viên tiếng Anh**.

Trong giao diện trò chuyện mới hơn, tạo tác nhân từ mẫu huấn luyện viên theo [hướng dẫn tác nhân AI](./chat-with-agent.md#gpt-agent), rồi tạo cuộc trò chuyện với tác nhân đó.

![Chọn vai trò AI trong tài liệu gốc](/images/enjoy/select-ai-role.png)
_* Chọn vai trò AI trong giao diện được tài liệu gốc mô tả._

Chọn nhà cung cấp AI và model đã cấu hình theo tài khoản đang sử dụng. Với [OpenAI riêng](./settings.md#openai-settings), kiểm tra cả **Địa chỉ API** nếu dùng cấu hình tùy chỉnh.

Cuộn xuống cuối phần cấu hình và chọn **Công cụ TTS** phù hợp để tạo giọng đọc.

![Cấu hình cuộc trò chuyện trong tài liệu gốc](/images/enjoy/conversation-form.png)
_* Cấu hình cuộc trò chuyện._

Sau khi điền xong, nhấn **Xác nhận** để tạo.

## Gửi điều bạn muốn nói {#send-text}

Gửi nội dung muốn diễn đạt cho huấn luyện viên như khi nhắn tin. Mẫu trong tài liệu gốc yêu cầu AI chuyển nội dung sang tiếng Anh tự nhiên theo cách nói New York.

::: info Điều chỉnh cho người học Việt Nam
Mẫu huấn luyện viên trong bản Việt hóa hướng tới người Việt học tiếng Anh: trả lời bằng tiếng Anh và giải thích bằng tiếng Việt khi được yêu cầu. Mẫu mới áp dụng khi tạo trợ lý; không tự sửa lời nhắc của cuộc trò chuyện đã lưu.

Bạn có thể bắt đầu bằng một tình huống thật, chẳng hạn: “Tôi muốn xin đổi lịch họp sang sáng thứ Sáu. Hãy giúp tôi nói lịch sự bằng tiếng Anh và giải thích cách dùng từ bằng tiếng Việt.”
:::

## Tạo giọng đọc {#generate-speech}

Đọc lại câu trả lời. Nếu nội dung đúng ý, nhấn biểu tượng đọc thành tiếng bên dưới tin nhắn để tạo âm thanh.

![Trò chuyện với huấn luyện viên tiếng Anh](/images/enjoy/english-coach-gpt-conversation.png)
_* Ví dụ trò chuyện từ tài liệu gốc._

## Luyện nhại theo giọng đọc {#shadowing}

Nhấn biểu tượng micro để thêm âm thanh vừa tạo vào thư viện và bắt đầu luyện nhại.

![Thêm giọng đọc vào thư viện luyện tập](/images/enjoy/conversation-add-speech-to-audio.png)
_* Thêm âm thanh làm tài liệu luyện tập._

Sau đó, bạn có thể tìm lại tài liệu trong [trang âm thanh](./audios.md) để tiếp tục luyện.
