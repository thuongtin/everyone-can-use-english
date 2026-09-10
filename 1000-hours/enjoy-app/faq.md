# Câu hỏi thường gặp

::: info Bản local
Ứng dụng dùng hồ sơ và thư viện trên máy, cùng các provider được cấu hình riêng. Không đăng nhập, xin token hoặc nạp tiền qua backend Enjoy.
:::

## Liên tục gặp lỗi mạng thì phải làm gì? {#network-errors}

Kiểm tra provider được chọn trong Cài đặt, endpoint, mô hình và trạng thái credential. Nếu mạng cần proxy, kiểm tra proxy đang hoạt động. Không đổi sang một địa chỉ backend Enjoy cũ để xử lý lỗi.

Khi một dịch vụ AI không khả dụng, bạn vẫn có thể đọc và phát nội dung đã lưu local. Lỗi hết hạn mức, timeout hoặc xác thực cần được xử lý ở đúng provider; ứng dụng không tự chuyển sang dịch vụ khác.

## Vì sao không tải được video YouTube? {#youtube-download}

Tài liệu gốc viết cho người dùng tại Trung Quốc, nơi kết nối trực tiếp tới YouTube bị hạn chế. Điều này không mặc nhiên áp dụng cho mạng tại Việt Nam.

Nếu kết nối của bạn cần proxy và phần mềm proxy chưa chuyển tiếp toàn bộ lưu lượng, có thể cấu hình trong **Cài đặt ứng dụng / Cài đặt nâng cao / Cài đặt proxy**. Lấy địa chỉ từ phần mềm proxy đang dùng, chẳng hạn `http://localhost:7890`. Địa chỉ ví dụ chỉ hoạt động khi máy thực sự có proxy lắng nghe tại cổng đó.

## Vì sao không chia sẻ được bản ghi âm lên cộng đồng? {#share-recording}

Bản local không kết nối cộng đồng hoặc tải bản ghi âm lên server Enjoy. Dùng chức năng xuất file để lấy bản ghi âm của bạn và tự chia sẻ qua dịch vụ bạn chọn.

## Dùng thư viện trên nhiều máy như thế nào? {#multiple-devices}

Phần lớn dữ liệu của Enjoy App được lưu trên ổ đĩa máy tính, trong thư mục tên `EnjoyLibrary`.

Theo tài liệu gốc, Enjoy không cung cấp đồng bộ đám mây cho thư viện này. Nếu cần dùng nhiều máy, có thể dùng dịch vụ lưu trữ đám mây để đồng bộ dữ liệu. Ví dụ gốc sử dụng Baidu Netdisk; với người dùng Việt Nam, có thể chọn dịch vụ có chức năng đồng bộ thư mục phù hợp, nhưng phải kiểm tra khả năng đồng bộ đầy đủ trước.

Quy trình trong tài liệu gốc:

1. Thêm thư mục `EnjoyLibrary`, tức [đường dẫn lưu thư viện](./settings.md#library-path), vào danh sách đồng bộ.
2. Sau mỗi lần sử dụng Enjoy, trước khi tắt máy, chờ toàn bộ thư mục `EnjoyLibrary` đồng bộ xong.
3. Trên máy thứ hai, chờ dịch vụ đám mây tải đầy đủ phiên bản mới nhất của thư mục `EnjoyLibrary`.
4. Chọn đúng thư viện và hồ sơ local trên máy thứ hai. Credential của provider có thể cần cấu hình lại trên máy mới.
5. Lặp lại các bước 2 đến 4 khi đổi máy.

Không sử dụng cùng thư viện trên nhiều máy cùng lúc khi đang đồng bộ theo cách này, vì có thể gây xung đột dữ liệu. Nên đóng Enjoy trước khi đồng bộ cơ sở dữ liệu và giữ một bản sao lưu có thể khôi phục.

## Chuyển nhà cung cấp AI như thế nào? {#switch-to-enjoy-ai}

Mở Cài đặt, chọn provider và mô hình phù hợp. Với hội thoại hoặc thành viên có cấu hình riêng, cập nhật selection tại đó. Binding EnjoyAI cũ không tự được chuyển sang một provider trả phí; lịch sử đã tạo vẫn được giữ.

## Vượt hạn mức sử dụng thì phải làm gì? {#daily-limit}

Kiểm tra hạn mức ở provider đang dùng. Bạn có thể thử lại sau hoặc tự chọn provider khác đã cấu hình. Không nạp tiền Enjoy để xử lý lỗi này.

## Dùng khóa OpenAI riêng có cần nạp tiền vào Enjoy không? {#own-openai-key}

Không. Tác vụ OpenAI dùng cấu hình OpenAI của bạn. Đánh giá phát âm dùng Azure Speech với cấu hình riêng và không được thay thế bằng transcription OpenAI.

## Vì sao chuyển giọng nói thành văn bản cục bộ không hoạt động? {#local-stt}

Enjoy tích hợp [whisper.cpp](https://github.com/ggerganov/whisper.cpp) để chuyển giọng nói thành văn bản (STT) trên máy. Một số máy có cấu hình thấp hoặc hệ điều hành cũ có thể gặp vấn đề tương thích.

Khi gặp lỗi, có thể cấu hình dịch vụ STT đám mây khác trong [cài đặt chuyển giọng nói thành văn bản](./settings.md#speech-to-text). Tài liệu gốc ưu tiên Azure AI; hãy kiểm tra khả năng truy cập và điều kiện sử dụng của dịch vụ phù hợp với tài khoản của bạn.

## Lỗi `403 Insufficient balance` {#insufficient-balance}

Đọc tên provider trong thông báo lỗi và kiểm tra tài khoản tương ứng. Nếu cấu hình của bản cũ còn trỏ tới Enjoy, chọn lại provider hợp lệ trong Cài đặt hoặc trong hội thoại đang dùng. Ứng dụng không gửi yêu cầu tới ví hay API Enjoy.

## Tải âm thanh và bản ghi âm như thế nào? {#download-audio}

Enjoy cung cấp chức năng tải tệp âm thanh, video và bản ghi âm để có thể sử dụng trên thiết bị khác.
