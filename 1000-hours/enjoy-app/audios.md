# Tài nguyên âm thanh

Luyện nhại theo giọng đọc từ âm thanh và video là một trong những chức năng chính của Enjoy.

## Thêm tài nguyên âm thanh {#add-audio}

Enjoy hỗ trợ cả tệp âm thanh trên máy và tài nguyên trực tuyến. Trên trang âm thanh, nhấn **Thêm học liệu**, nhập URL trong cửa sổ hiện ra hoặc chọn **Tệp trên máy** để thêm tệp từ máy tính.

Với tài nguyên trực tuyến, Enjoy tải tệp về thư mục tải xuống mặc định, thường là `Downloads`, rồi tự động thêm vào [thư viện](./settings.md#library-path).

## Luyện nhại theo âm thanh {#shadowing}

Sau khi thêm thành công, ứng dụng tự chuyển đến trang phát âm thanh.

Lần đầu mở tệp, ứng dụng cần phân tích dạng sóng, tạo đường biểu diễn cao độ (pitch contour) và tạo bản chép lời bằng [dịch vụ chuyển giọng nói thành văn bản](./settings.md#speech-to-text). Bước này có thể mất một khoảng thời gian. Khi dữ liệu đã được tạo, những lần mở sau thường nhanh hơn.

::: tip Nếu trang tải quá lâu
Khi mở một tệp âm thanh, ứng dụng lần lượt:

1. Phân tích dữ liệu dạng sóng.
2. Chuyển giọng nói thành văn bản.

Nếu dừng rất lâu ở bước đầu, tệp có thể quá lớn, đặc biệt là thời lượng quá dài, khiến việc xử lý chậm hoặc thất bại. Nếu không phải do kích thước tệp, có thể ứng dụng gặp lỗi khác; hãy ghi lại thông tin lỗi để báo cho người phát triển.

Nếu bước chuyển giọng nói thành văn bản thất bại, hãy kiểm tra có đang dùng whisper cục bộ hay không. Thành phần này có thể không hoạt động trên một số máy do vấn đề tương thích hoặc lỗi chưa xác định. Có thể đổi sang dịch vụ STT đám mây trong [phần cấu hình STT](./settings.md#speech-to-text).
:::

## Phát âm thanh {#playback}

Nhấn nút phát hoặc phím <kbd>Space</kbd> để phát hay tạm dừng.

Enjoy chia âm thanh thành các câu. Chế độ mặc định là **Phát một đoạn**, giúp nghe và luyện lại từng câu.

Các chế độ khác gồm:

- Lặp lại một câu.
- Phát tất cả.

## Chia câu thành cụm {#sentence-segmentation}

Enjoy dựa vào khoảng ngừng trong bản gốc và dấu câu để chia câu hiện tại thành các cụm nhỏ, giúp luyện riêng từng cụm nhiều lần.

Bạn cũng có thể nhấp vào một từ trong câu để chọn từ hoặc cụm từ cần nghe. Giữ <kbd>Shift</kbd> khi nhấp để chọn nhiều từ.

## Ghi âm {#recording}

Enjoy chia tài nguyên thành các câu để luyện nhại từng câu. Bên dưới câu đang chọn, nhấn nút ghi âm màu đỏ hoặc phím <kbd>r</kbd> để bắt đầu. Nghe mẫu và thử đọc lại câu theo giọng đọc gốc.

![Trang phát âm thanh trong tài liệu gốc](/images/enjoy/audio-page.png)
_* Trang phát âm thanh. Ảnh từ tài liệu gốc; giao diện trong ảnh chưa phản ánh đầy đủ bản Việt hóa._

::: tip Quyền sử dụng micro
Trên Mac, khi ghi âm lần đầu, hệ thống sẽ hỏi quyền sử dụng micro. Chọn cho phép nếu muốn dùng chức năng ghi âm; ứng dụng không thể thu giọng nói khi chưa được cấp quyền.
:::

## So sánh bản ghi âm {#recording-comparison}

So sánh đường cao độ của bản ghi âm với bản gốc để tự điều chỉnh phát âm. Trong chế độ so sánh, nút phát sẽ phát cả bản ghi của bạn và bản gốc cùng lúc.

![So sánh bản ghi âm với bản gốc](/images/enjoy/recording-comparing.png)
_* So sánh bản ghi với bản gốc trong tài liệu gốc._

## Đánh giá phát âm {#pronunciation-assessment}

Enjoy tích hợp chức năng đánh giá phát âm của Microsoft Azure để người học có thêm thông tin tham khảo khi tự kiểm tra.

Chức năng này dùng **văn bản của câu đang luyện lúc ghi âm làm nội dung tham chiếu** để đánh giá cách phát âm. Ý nghĩa từng chỉ số được giải thích trong [tài liệu chính thức của Microsoft](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment?pivots=programming-language-javascript#scripted-assessment-results).

![Ví dụ đánh giá phát âm trong tài liệu gốc](/images/enjoy/pronouce-assessment.png)
_* Ví dụ kết quả đánh giá phát âm từ tài liệu gốc._

::: warning Sử dụng kết quả đánh giá
Bản local dùng credential và quota của tài khoản Azure Speech do bạn cấu hình, có thể phát sinh phí tại Azure. Xem [thiết lập dịch vụ](./settings.md) trước khi sử dụng; chức năng này không dùng số dư Enjoy.

Tài liệu gốc lưu ý rằng chức năng này tập trung vào cách phát âm từ và không dùng để kết luận việc thay đổi ngữ điệu có đúng hay không. Hãy xem điểm số như phản hồi tham khảo, kết hợp nghe lại và so sánh bản ghi.
:::

## Sửa thông tin âm thanh {#edit-audio}

Chuyển sang chế độ danh sách ở phía trên trang âm thanh để chỉnh sửa tiêu đề, thêm mô tả hoặc xóa tài nguyên.
