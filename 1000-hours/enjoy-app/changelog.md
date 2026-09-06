# Lịch sử phiên bản

Bản dịch đầy đủ lịch sử phát hành của dự án gốc. Các mục bên dưới ghi lại thay đổi ở từng phiên bản, không phải danh sách chức năng vừa hoàn thành trong bản Việt hóa. Mục hỗ trợ tiếng Việt ở v0.5.0 không đồng nghĩa với việc giao diện và tài liệu gốc đã được dịch toàn bộ.

## v0.7.9

### Tính năng mới

- Nhúng cộng đồng vào ứng dụng.

## v0.7.8

### Sửa lỗi

- Sửa một số lỗi hiển thị.
- Sửa lỗi thiếu kết quả đánh giá phát âm khi bản ghi dài hơn 40 giây.
- Sửa lỗi thay đổi giọng đọc không có tác dụng khi nhập tài liệu.

## v0.7.7

### Sửa lỗi

- Sửa cửa sổ báo lỗi `Unhandle Error`.
- Sửa lỗi chia sẻ bản ghi âm thất bại.
- Sửa lỗi phát giọng đọc gốc trong phần đánh giá phát âm.

## v0.7.6

### Sửa lỗi

- Sửa lỗi cửa sổ bật lên bị che khuất.

## v0.7.5

### Tính năng mới

- Cho phép đổi bố cục trang đọc tài liệu theo chiều ngang hoặc dọc.
- Cho phép in trang tài liệu hiện tại, bao gồm bản dịch.
- Cho phép sao chép toàn bộ bản chép lời từ trang luyện nhại, không kèm mốc thời gian.
- Thêm đánh giá phát âm từng từ vào bảng tra từ.

### Sửa lỗi

- Sửa lỗi khi phát lặp và phát lại.
- Sửa lỗi các phím tắt như sao chép và dán không hoạt động.
- Sửa lỗi một số nút trong kết quả đánh giá phát âm bị che, không thể nhấn.

### Thay đổi khác

- Tắt cập nhật tự động, chuyển sang kiểm tra cập nhật thủ công.

## v0.7.4

### Sửa lỗi

- Sửa lỗi chuyển giọng nói thành văn bản khiến một số máy Windows không phản hồi.

## v0.7.3

### Sửa lỗi

- Thêm nhật ký cần thiết để hỗ trợ chẩn đoán lỗi.
- Sửa lỗi tùy chọn nén không có tác dụng khi nhập âm thanh và video.

## v0.7.2

### Sửa lỗi

- Sửa bố cục cửa sổ đánh giá phát âm.

## v0.7.1

### Sửa lỗi

- Sửa lỗi bố cục.

## v0.7.0

### Tính năng mới

- Thêm chức năng nhập tài liệu để luyện nhại, dịch và các thao tác khác; hỗ trợ tệp EPUB, TXT, Markdown trên máy và bài viết trực tuyến.
- Tổ chức lại thanh trên cùng và thanh bên của ứng dụng.
- Thêm tùy chọn cho whisper cục bộ, cho phép chọn phiên bản `whisper.cpp`.
- Thêm lựa chọn có nén tệp hay không khi nhập âm thanh và video.
- Thêm cấu hình TTS mặc định.
- Cho phép đăng nhập Mixin bằng cách quét mã.

### Sửa lỗi

- Sửa lỗi do định dạng bản chép lời cũ.
- Khi nhập lại tài nguyên đã có, cập nhật thời gian sửa đổi để tài nguyên xuất hiện gần đầu danh sách.
- Sửa lỗi hiển thị khi bản chép lời chứa ký hiệu đặc biệt, chẳng hạn dấu gạch ngang dài.

### Thay đổi khác

- Tổ chức lại một phần mã nguồn để dễ bảo trì hơn.
- Cải thiện kiểu hiển thị của giao diện.

## v0.6.1

### Sửa lỗi

- Sửa lỗi `Foreign key constraint failed` khi một số người dùng nhập âm thanh hoặc video.

## v0.6.0

### Tính năng mới

- Làm lại chức năng trò chuyện AI, thêm chỉ định người trả lời, chuyển tiếp tin nhắn và các chức năng khác.
- Cho phép mở cửa sổ trò chuyện từ mọi trang để trao đổi với AI bất kỳ lúc nào.
- Tối ưu định dạng tệp ghi âm, giảm đáng kể dung lượng.
- Cho phép xóa tệp ghi âm bằng một thao tác để giải phóng ổ đĩa, vẫn giữ số liệu thời lượng ghi âm.
- Hỗ trợ chuyển các hội thoại trợ lý cũ sang chức năng trò chuyện.

### Sửa lỗi

- Sửa lỗi cài đặt proxy không tự áp dụng.

### Thay đổi khác

- Thay thành phần whisper.cpp cục bộ bằng phiên bản dùng onnxruntime để tăng khả năng tương thích.
- Tự sao lưu cơ sở dữ liệu trên máy khi chuyển đổi dữ liệu và khi khởi động mỗi ngày.

## v0.5.2

### Sửa lỗi

- Sửa lỗi tạo bản chép lời thất bại do mạng kém.

## v0.5.1

### Tính năng mới

- Hỗ trợ nhập từ điển MDX.
- Làm lại giao diện luyện nhại, cho phép kéo để đổi kích thước từng vùng.
- Tự tìm và tải bản chép lời khi mở trang luyện nhại.

### Sửa lỗi

- Sửa lỗi xuất hiện cửa sổ bất thường khi nhấn phát âm trong từ điển trên Windows.
- Sửa lỗi trạng thái mạng không tự làm mới khi cập nhật proxy.

### Thay đổi khác

- Cải thiện bố cục thanh bên trái, cho phép thu gọn và mở rộng thủ công.

## v0.5.0

### Tính năng mới

- Hỗ trợ nhập từ điển của bên thứ ba.
- Cho phép gộp bản ghi của tất cả đoạn thuộc cùng tài nguyên để tải xuống.
- Hiển thị đoạn âm thanh gốc khi chia sẻ bản ghi lên cộng đồng.
- Hỗ trợ tiếng Việt.

### Sửa lỗi

- Sửa lỗi không hiển thị thông báo khi đánh giá phát âm thất bại.
- Sửa nút đặt lại.
- Sửa lỗi không hiển thị thông báo khi yêu cầu trong cuộc trò chuyện thất bại.

### Thay đổi khác

- Tổ chức lại tệp cấu hình, tách biệt thiết lập của từng người dùng.
- Cải thiện quy trình mở ứng dụng, cho phép sử dụng ngoại tuyến khi mạng kém.

## v0.4.1

### Tính năng mới

- Thêm gợi ý AI trong cuộc trò chuyện.
- Thêm tùy chọn ghi âm nâng cao.
- Cho phép mở tệp cấu hình.
- Hỗ trợ tiếng Thái.

### Sửa lỗi

- Sửa giới hạn ghi âm một phút trong chế độ đọc toàn bộ văn bản.
- Sửa vị trí cửa sổ tra từ trong cộng đồng.
- Xóa nội dung ô soạn thảo sau khi gửi tin nhắn.

### Thay đổi khác

- Cải thiện cách hiển thị từ trong kết quả đánh giá phát âm.
- Cải thiện một số thông báo lỗi.
- Cải thiện lời nhắc trò chuyện.

## v0.4.0

### Tính năng mới

- Thêm trò chuyện bằng giọng nói với AI.
- Áp dụng cấu hình proxy khi tải video YouTube.
- Thêm kiểm tra trạng thái mạng.
- Hỗ trợ phím tắt thay đổi tốc độ phát khi luyện nhại.
- Cho phép xem chi phí gần đây.
- Hiển thị thông tin chi tiết của thư viện trên máy.
- Cho phép dọn các tài nguyên bị mất tệp nguồn bằng một thao tác.
- Cho phép chia sẻ bản ghi từ trang đánh giá phát âm.
- Hỗ trợ tiếng Quảng Đông.

### Sửa lỗi

- Sửa lỗi không mở được trang cài đặt do cấu hình mô hình AI.

### Thay đổi khác

- Cải thiện chức năng ghi âm.

## v0.3.4

### Sửa lỗi

- Sửa lỗi mô hình đã chọn trong cài đặt OpenAI không sử dụng được.
- Sửa lỗi phát lặp của trình phát trong trang luyện nhại.
- Sửa việc tải mẫu GPT khi mạng kém.
- Sửa lỗi Azure AI STT không phản hồi trong một số trường hợp.
- Sửa lỗi trình phát trong trang luyện nhại đột ngột ngừng hoạt động.

## v0.3.3

### Tính năng mới

- Cải thiện độ chính xác khi căn chỉnh bản chép lời cho âm thanh có nhạc nền hoặc tiếng ồn.
- Cải thiện chỉnh sửa bản chép lời, cho phép sửa mốc thời gian.
- Cho phép hiển thị phụ đề trong trình phát video.
- Cho phép cấu hình mô hình tùy chỉnh trong cài đặt OpenAI.
- Hỗ trợ nạp tiền bằng giao dịch tiền mã hóa trên blockchain.

### Sửa lỗi

- Sửa lỗi đánh giá phát âm với bản ghi tự do.
- Sửa lỗi không mở được thanh toán Mixin.

### Thay đổi khác

- Cải thiện các trải nghiệm khác.

## v0.3.2

### Tính năng mới

- Cho phép thay đổi URL API.

### Sửa lỗi

- Sửa lỗi từ đầu tiên trong bản chép lời nhấp nháy.

## v0.3.1

### Tính năng mới

- Hiển thị điểm đánh giá khi chia sẻ bản ghi lên cộng đồng.
- Hiển thị số người hoàn thành từng chương của khóa học.
- Cho phép xuất bản chép lời âm thanh và video thành PDF có phiên âm.
- Cho phép thích bài đăng trong cộng đồng.
- Cho phép tải bản chép lời có sẵn từ đám mây trong quá trình STT.

### Sửa lỗi

- Sửa lỗi so sánh bản ghi không hoạt động.
- Sửa lỗi không hiển thị kết quả đánh giá phát âm trong khóa học.
- Sửa cách hiển thị thanh bên khi cửa sổ nhỏ.

### Thay đổi khác

- Cải thiện quy trình đánh giá phát âm.

## v0.3.0

### Tính năng mới

- Thêm khóa học tương tác.

### Sửa lỗi

- Sửa lỗi ứng dụng không phản hồi sau lỗi mạng trong quá trình STT.
- Sửa lỗi hiển thị một số ký hiệu phiên âm trong phần đánh giá phát âm.

## v0.2.14

### Tính năng mới

- Cho phép chọn ngôn ngữ TTS trong hội thoại với trợ lý.
- Thêm tách giọng nói khi chuyển âm thanh thành văn bản, dưới dạng chức năng thử nghiệm.

### Sửa lỗi

- Sửa kiểu hiển thị đánh giá phát âm trong giao diện tối.
- Không nhận dạng lại khi quá trình STT đã có văn bản nguồn.

### Thay đổi khác

- Cải thiện cài đặt STT, ẩn các tùy chọn nâng cao.
- Cải thiện việc xử lý kết quả và lỗi khi thêm tài nguyên trên máy.

## v0.2.13

### Tính năng mới

- Cho phép tùy chỉnh STT, bao gồm tải lên tệp phụ đề.
- Thêm sắp xếp vào danh sách đánh giá phát âm.
- Thêm sắp xếp, lọc và tìm kiếm vào danh sách âm thanh và video.

## v0.2.12

### Sửa lỗi

- Sửa lỗi cập nhật cơ sở dữ liệu trên Windows.

## v0.2.11

### Tính năng mới

- Thêm trang đánh giá phát âm riêng, hỗ trợ đánh giá bản ghi không có văn bản tham chiếu và tải lên tệp ghi âm để đánh giá.
- Thêm phím tắt đánh giá phát âm, mặc định là `A`.
- Cho phép tổ hợp phím tắt gồm tối đa ba phím, chẳng hạn `Ctrl`+`Shift`+`A`.
- Tự ghi nhớ câu đã luyện gần nhất trên trang luyện nhại.

### Sửa lỗi

- Sửa lỗi OpenAI TTS khi dùng `tts-1-hd`.
- Sửa lỗi phím tắt không hoạt động.
- Sửa lỗi không thể nhấn gửi mã xác minh điện thoại khi mạng kém.
- Sửa lỗi nhiều bản ghi phát cùng lúc trên trang cộng đồng.
- Sửa lỗi không thể dừng tiến trình STT dùng whisper cục bộ.
- Sửa lỗi không tải được phông chữ phiên âm.

### Thay đổi khác

- Cải thiện giao diện trang luyện nhại.

## v0.2.10

### Tính năng mới

- Hỗ trợ Azure TTS với nhiều ngôn ngữ và giọng đọc.

### Sửa lỗi

- Không áp dụng hiệu chỉnh phiên âm tiếng Anh cho các ngôn ngữ khác.
- Chỉ định phần mở rộng khi tải tệp âm thanh.
- Sửa lỗi không cuộn được danh sách thả xuống quá dài.
- Điều chỉnh ngưỡng cắt bản ghi để tránh cắt mất quá nhiều âm thanh.

### Thay đổi khác

- Dùng Azure làm dịch vụ STT mặc định cho người dùng mới.

## v0.2.9

### Tính năng mới

- Hỗ trợ nhiều loại tiền mã hóa khi nạp tiền qua Mixin.
- Cho phép chọn nhiều ngôn ngữ học khác nhau.

### Sửa lỗi

- Sửa lỗi tính thời gian ghi âm trong chế độ đọc toàn bộ văn bản.
- Sửa lỗi echogarden `No match found in uncrop timeline`.

## v0.2.8

### Sửa lỗi

- Sửa lỗi tự thoát khi nhấn bất kỳ nút nào sau khi chuyển từ hội thoại trợ lý sang trang luyện nhại.

## v0.2.7

### Tính năng mới

- Thêm chế độ đọc toàn bộ văn bản.
- Thêm kênh YouTube làm nguồn video.

### Sửa lỗi

- Sửa lỗi không tra được từ điển thông minh.
- Sửa lỗi hiển thị và thống kê thời gian không theo múi giờ địa phương.
- Sửa lỗi tải tài nguyên âm thanh từ audible.com.
- Sửa lỗi tạo hội thoại trợ lý khi mạng kém.

### Thay đổi khác

- Nâng cấp whisper.cpp lên [v1.6.0](https://github.com/ggerganov/whisper.cpp/releases/tag/v1.6.0).

## v0.2.6

### Tính năng mới

- Cập nhật danh sách mô hình, hỗ trợ GPT-4o.
- Thêm các mô hình ngoài OpenAI vào EnjoyAI, chẳng hạn gemini-pro-1.5.
- Cho phép cấu hình mô hình AI chi tiết hơn, bao gồm mô hình riêng cho từ điển thông minh.

### Sửa lỗi

- Sửa kiểu hiển thị trang đăng nhập Mixin trong giao diện tối.
- Chuyển vị trí ký hiệu trọng âm trong phiên âm sang phụ âm.

### Thay đổi khác

- Cải thiện danh sách trợ lý AI.
- Hỗ trợ cập nhật danh sách mô hình qua API.

## v0.2.5

### Sửa lỗi

- Sửa lỗi không gửi được mã xác minh khi Mixin ID có năm chữ số.

## v0.2.4

### Tính năng mới

- Cho phép mô hình whisper cục bộ nhận dạng ngôn ngữ ngoài tiếng Anh; cần chọn mô hình không có hậu tố `.en`.
- Thêm ghi chú trên trang luyện nhại.
- Thêm chỉnh sửa bản chép lời.
- Dùng AI đề xuất tiêu đề cho âm thanh.
- Cho phép tra từ điển và dịch thông minh trong toàn ứng dụng bằng cách chọn văn bản rồi mở menu chuột phải.
- Hỗ trợ phím tắt cho sổ từ vựng.
- Cho phép tải âm thanh của đoạn được chọn bất kỳ.

### Sửa lỗi

- Sửa một số lỗi hiển thị trong giao diện tối.
- Sửa lỗi STT khi văn bản gốc bắt đầu bằng `-`.
- Sửa lỗi phím tắt trên trang luyện nhại không hoạt động.
- Sửa lỗi không lưu được cấu hình proxy.
- Sửa lỗi ghi âm không tự dừng khi hết thời gian.
- Sửa lỗi nhập tài nguyên có phần mở rộng viết hoa.
- Sửa lỗi không tải được video YouTube.
- Sửa lỗi bản ghi âm không đầy đủ.

### Thay đổi khác

- Chuyển đăng nhập GitHub sang quy trình xác minh thiết bị.
- Chuyển đăng nhập Mixin sang phương thức mã xác minh.
