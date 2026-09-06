# Câu hỏi thường gặp

::: info Bối cảnh tài liệu
Các mô tả dịch vụ, hạn mức và thanh toán bên dưới được dịch từ tài liệu gốc. Bản Việt hóa không xác nhận rằng chính sách thương mại hoặc địa chỉ dịch vụ thay thế vẫn còn hiệu lực. Hãy đối chiếu thông tin đang hiển thị trong tài khoản trước khi thay đổi cấu hình hoặc thanh toán.
:::

## Liên tục gặp lỗi mạng thì phải làm gì? {#network-errors}

Nếu khi đăng nhập gặp `Network Error`, hoặc khi đánh giá phát âm hay sử dụng chức năng khác gặp `connect ETIMEDOUT`, hãy mở [trang Enjoy](https://enjoy.bot) bằng trình duyệt thông thường. Tài liệu gốc lưu ý không mở trong trình duyệt tích hợp của WeChat.

Nếu không thể mở trang, hoặc bị chuyển sang một trang không liên quan, kết nối hiện tại có thể không tới được dịch vụ Enjoy. Cần kiểm tra kết nối, DNS, proxy và trạng thái dịch vụ thay vì mặc định rằng lỗi do tài khoản.

Tài liệu gốc đưa ra cách xử lý sau:

1. [Nâng cấp Enjoy App](./install.md) lên v0.3.2 trở lên.
2. Tại trang đăng nhập, mở **Cài đặt nâng cao**. Nếu đã đăng nhập, mở **Cài đặt ứng dụng / Cài đặt nâng cao**. Đổi địa chỉ API thành `https://api.getenjoyapp.com`, rồi lưu.
3. Chờ ứng dụng tải lại.

Địa chỉ thay thế trên được giữ lại từ tài liệu gốc, chưa được xác minh là dịch vụ đang hoạt động cho bản Việt hóa. Một phương án khác mà tài liệu gốc đề cập là sử dụng proxy khi mạng đang dùng yêu cầu điều đó.

## Vì sao không tải được video YouTube? {#youtube-download}

Tài liệu gốc viết cho người dùng tại Trung Quốc, nơi kết nối trực tiếp tới YouTube bị hạn chế. Điều này không mặc nhiên áp dụng cho mạng tại Việt Nam.

Nếu kết nối của bạn cần proxy và phần mềm proxy chưa chuyển tiếp toàn bộ lưu lượng, có thể cấu hình trong **Cài đặt ứng dụng / Cài đặt nâng cao / Cài đặt proxy**. Lấy địa chỉ từ phần mềm proxy đang dùng, chẳng hạn `http://localhost:7890`. Địa chỉ ví dụ chỉ hoạt động khi máy thực sự có proxy lắng nghe tại cổng đó.

## Vì sao không chia sẻ được bản ghi âm lên cộng đồng? {#share-recording}

Trước khi chia sẻ, ứng dụng phải tải bản ghi âm lên máy chủ tài nguyên. Theo tài liệu gốc, nguyên nhân thường gặp là không kết nối được máy chủ này.

Mở **Cài đặt ứng dụng / Cài đặt nâng cao / Trạng thái mạng** để kiểm tra kết nối tới máy chủ tài nguyên. Nếu mạng đang dùng yêu cầu proxy, sử dụng proxy toàn hệ thống hoặc cấu hình tại **Cài đặt ứng dụng / Cài đặt nâng cao / Cài đặt proxy**.

## Dùng cùng một tài khoản trên nhiều máy như thế nào? {#multiple-devices}

Phần lớn dữ liệu của Enjoy App được lưu trên ổ đĩa máy tính, trong thư mục tên `EnjoyLibrary`.

Theo tài liệu gốc, Enjoy không cung cấp đồng bộ đám mây cho thư viện này. Nếu cần dùng nhiều máy, có thể dùng dịch vụ lưu trữ đám mây để đồng bộ dữ liệu. Ví dụ gốc sử dụng Baidu Netdisk; với người dùng Việt Nam, có thể chọn dịch vụ có chức năng đồng bộ thư mục phù hợp, nhưng phải kiểm tra khả năng đồng bộ đầy đủ trước.

Quy trình trong tài liệu gốc:

1. Thêm thư mục `EnjoyLibrary`, tức [đường dẫn lưu thư viện](./settings.md#library-path), vào danh sách đồng bộ.
2. Sau mỗi lần sử dụng Enjoy, trước khi tắt máy, chờ toàn bộ thư mục `EnjoyLibrary` đồng bộ xong.
3. Trên máy thứ hai, chờ dịch vụ đám mây tải đầy đủ phiên bản mới nhất của thư mục `EnjoyLibrary`.
4. Đăng nhập cùng tài khoản Enjoy trên máy thứ hai.
5. Lặp lại các bước 2 đến 4 khi đổi máy.

Không sử dụng cùng thư viện trên nhiều máy cùng lúc khi đang đồng bộ theo cách này, vì có thể gây xung đột dữ liệu. Nên đóng Enjoy trước khi đồng bộ cơ sở dữ liệu và giữ một bản sao lưu có thể khôi phục.

## Chuyển sang Enjoy AI như thế nào? {#switch-to-enjoy-ai}

Nếu ban đầu dùng khóa OpenAI riêng và muốn chuyển sang Enjoy AI:

- Mở **Cài đặt ứng dụng / Cài đặt cơ bản / Dịch vụ AI mặc định**, nhấn **Chỉnh sửa**, rồi chọn `Enjoy AI`.

Với hội thoại trợ lý kiểu cũ được tài liệu gốc mô tả, dịch vụ AI được cố định khi tạo. Sau khi đổi dịch vụ mặc định, cần tạo hội thoại mới. Trong chức năng **Trò chuyện** hiện tại, có thể đổi dịch vụ AI trong [cài đặt riêng của thành viên](./chat-with-agent.md#member-settings).

## Vượt hạn mức sử dụng hằng ngày thì phải làm gì? {#daily-limit}

Theo tài liệu gốc, người dùng mới được cấp một khoản tín dụng dùng thử để trải nghiệm các dịch vụ trả phí, đồng thời bị giới hạn số lần sử dụng mỗi ngày. Khi vượt giới hạn, ứng dụng sẽ báo lỗi.

Tài liệu gốc cho biết nạp tiền một lần, với bất kỳ số tiền nào, sẽ gỡ giới hạn này. Đây là mô tả chính sách tại thời điểm biên soạn, không phải cam kết hiện tại của bản Việt hóa. Kiểm tra hạn mức và điều kiện thực tế trong tài khoản trước khi quyết định nạp tiền.

## Dùng khóa OpenAI riêng có cần nạp tiền vào Enjoy không? {#own-openai-key}

Nhiều chức năng của Enjoy App sử dụng AI. EnjoyAI được dự án gốc cung cấp để tích hợp nhiều nhà cung cấp và mô hình, cho phép sử dụng bằng số dư tài khoản Enjoy.

Enjoy cũng cho phép cấu hình nhà cung cấp và khóa riêng. Theo tài liệu gốc, Enjoy không thu phí cho phần sử dụng AI thông qua cấu hình riêng này; phí của nhà cung cấp do người dùng tự thanh toán theo tài khoản tương ứng.

Tuy nhiên, đánh giá phát âm không phải dịch vụ do OpenAI cung cấp. Tài liệu gốc mô tả đây là chức năng trả phí của Enjoy và yêu cầu tài khoản Enjoy có số dư.

## Vì sao chuyển giọng nói thành văn bản cục bộ không hoạt động? {#local-stt}

Enjoy tích hợp [whisper.cpp](https://github.com/ggerganov/whisper.cpp) để chuyển giọng nói thành văn bản (STT) trên máy. Một số máy có cấu hình thấp hoặc hệ điều hành cũ có thể gặp vấn đề tương thích.

Khi gặp lỗi, có thể cấu hình dịch vụ STT đám mây khác trong [cài đặt chuyển giọng nói thành văn bản](./settings.md#speech-to-text). Tài liệu gốc ưu tiên Azure AI; hãy kiểm tra khả năng truy cập và điều kiện sử dụng của dịch vụ phù hợp với tài khoản của bạn.

## Lỗi `403 Insufficient balance` {#insufficient-balance}

Theo tài liệu gốc, lỗi này xuất hiện khi đang dùng một chức năng trả phí của Enjoy nhưng số dư tài khoản không đủ.

Các chức năng như [trợ lý AI](./ai-assistant.md), dịch thông minh và phân tích câu sử dụng AI. Nếu chọn `OpenAI` làm [dịch vụ AI mặc định](./settings.md#default-ai-engine), chúng sử dụng cấu hình OpenAI riêng và theo mô tả gốc không trừ số dư Enjoy cho phần AI đó.

Trong [hội thoại trợ lý kiểu cũ](./ai-assistant.md), dịch vụ AI không thay đổi sau khi tạo; muốn chuyển từ Enjoy AI sang OpenAI hoặc ngược lại, cần tạo hội thoại mới. Với chức năng **Trò chuyện** hiện tại, hãy kiểm tra [cấu hình dịch vụ của từng thành viên](./chat-with-agent.md#member-settings).

Riêng [đánh giá phát âm](./audios.md#pronunciation-assessment) là dịch vụ trả phí riêng, không do OpenAI cung cấp. Theo tài liệu gốc, chức năng này vẫn trừ số dư Enjoy bất kể lựa chọn dịch vụ AI mặc định.

Nếu cần tìm hiểu việc nạp tiền, xem [phần số dư và nạp tiền](./settings.md#deposit), rồi đối chiếu với điều kiện thực tế trong tài khoản.

## Tải âm thanh và bản ghi âm như thế nào? {#download-audio}

Enjoy cung cấp chức năng tải tệp âm thanh, video và bản ghi âm để có thể sử dụng trên thiết bị khác.
