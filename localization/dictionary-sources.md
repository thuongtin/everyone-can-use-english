# Nguồn từ điển cho người Việt học tiếng Anh

Cập nhật ngày 05/09/2026: đã tích hợp và đóng gói hai bộ từ điển thật trong Enjoy, đã tra hai chiều trên ứng dụng macOS arm64. Đây là trạng thái thay thế hồ sơ khảo sát ban đầu.

## Dữ liệu đã tích hợp

| Chiều | Nguồn snapshot | Khóa tra cứu | Mục theo từ loại | Nghĩa |
| --- | --- | ---: | ---: | ---: |
| Anh - Việt | [Raw Wiktionary tiếng Việt](https://kaikki.org/viwiktionary/rawdata.html), dump 01/09/2026, trích xuất 03/09/2026 | 118.926 | 133.300 | 190.653 |
| Việt - Anh | [Vietnamese trong Wiktionary tiếng Anh](https://kaikki.org/dictionary/Vietnamese/index.html), dump 05/08/2026, trích xuất 28/08/2026 | 29.730 | 36.043 | 43.424 |

Hai chiều lấy từ hai nguồn riêng, không đảo danh sách dịch để giả thành từ điển chiều ngược. Các số là dữ liệu sau lọc, không phải cam kết phủ mọi từ tiếng Anh/tiếng Việt. Bản Việt - Anh dùng snapshot postprocessed đã được Kaikki đánh dấu deprecated. Archive được giữ trong kho mã nên build và tra nghĩa không phụ thuộc endpoint này; lần cập nhật dữ liệu sau nên chuyển sang raw và xác minh lại metadata.

Archive, SHA-256 đầu vào/đầu ra, ngày snapshot và thống kê nằm ở `enjoy/dictionaries/manifest.json`. `NOTICE.md`, toàn văn CC BY-SA 4.0 và `editorial-corrections.json` được đóng gói cùng SQLite. Dữ liệu phái sinh có giấy phép riêng với mã nguồn Enjoy; kết quả có liên kết đến mục từ gốc và ghi công Wiktionary/Kaikki.

Pipeline giữ nghĩa, từ loại, IPA có nhãn giọng và ví dụ được chọn; bỏ mục chữ Hán/Nôm, nghĩa trống, trích dẫn có nguồn riêng của bản raw và toàn bộ ví dụ bản postprocessed Việt - Anh vì phát hiện trích dẫn lẫn trong nội dung. Còn 27.097 ví dụ ở chiều Anh - Việt, không có ví dụ ở chiều Việt - Anh. Không đóng gói âm thanh, ảnh hay từ nguyên. Một số nghĩa còn chữ Hán làm đối tượng phân tích ngôn ngữ, không phải ngôn ngữ giải nghĩa.

Đã sửa riêng mục `learn` có lỗi chữ từ nguồn và IPA Mỹ, đối chiếu [Wiktionary](https://en.wiktionary.org/wiki/learn). Sửa chữa có nguồn và ghi chú hiển thị ở kết quả; chưa biên tập ngữ nghĩa thủ công toàn bộ dữ liệu cộng đồng.

## Thay đổi trong Enjoy

- Hai từ điển có sẵn là Anh - Việt và Việt - Anh. Người học tiếng Anh chưa có lựa chọn hợp lệ được mặc định Anh - Việt; lựa chọn đã lưu và bộ tự nhập được giữ.
- Bỏ đường tra Cambridge SQLite cũ khỏi runtime/package. Collins Anh - Trung chỉ còn metadata tương thích cho dữ liệu người dùng đã nhập, không được gợi ý cho cài đặt mới. Hướng dẫn gốc đã dịch được lưu ở `legacy-dictionary-guide.md` làm tư liệu lịch sử.
- Tra từ qua SQLite chỉ đọc, SQL có tham số, kiểm tra chiều/ngưỡng độ dài, chuẩn hóa NFC/chữ hoa/khoảng trắng và giữ dấu tiếng Việt. Hỗ trợ cụm từ, kết quả thiếu từ và lỗi tải rõ ràng; render bằng text React.
- Trang từ điển offline mở từ welcome/login, không cần tài khoản. Tra trong học liệu và phần Cài đặt dùng chung bộ kết quả. Trang độc lập nhớ chiều tra cứu trên thiết bị; mặc định của tài khoản dùng cơ chế cài đặt hiện có.

## Kiểm chứng và giới hạn

- Build/package macOS arm64 thành công; hai SQLite trong artifact có hash khớp manifest, không còn Cambridge trong thư mục dữ liệu từ điển đóng gói.
- Test dữ liệu thật đạt: hello/learn/bank, học/ngân hàng/xin chào, cụm từ, Unicode tổ hợp, giữ khác biệt ma/má, thiếu từ, truy vấn SQL độc hại, đầu vào sai, truy vấn đồng thời và lựa chọn cũ.
- CUA trên bản Enjoy đã đóng gói: `learn` có bốn nghĩa tiếng Việt và IPA RP/GA; `ngân hàng` trả a bank, `học` trả to study; to learn. Chuỗi viết hoa có dấu tổ hợp và nhiều khoảng trắng vẫn tra đúng. Đóng rồi mở lại vẫn giữ Việt - Anh.
- In-app browser đã mở trang hướng dẫn mới nhất và mục Cambridge Anh - Việt `learn`; không cần phiên Chrome riêng cho bước kiểm tra này.
- Chưa kiểm chứng tương tác trong học liệu, lưu mặc định của tài khoản và AI sau đăng nhập bằng tài khoản hợp lệ. Kiểm thử hàm không thay thế bước runtime đó. Không tắt kết nối mạng của hệ điều hành để thử; lookup trong mã và artifact dùng SQLite cục bộ.
- Bộ dữ liệu có thể thiếu từ hoặc chứa nghĩa chưa chuẩn; ví dụ `look up` và `quả táo` chưa có mục tương ứng. Không gọi số khóa là số từ đã được chuyên gia duyệt.

## Nguồn trực tuyến đã khảo sát

| Nguồn | Chiều tra cứu | Bằng chứng và giới hạn |
| --- | --- | --- |
| [Laban Dictionary](https://dict.zlb.zapps.me/) | Anh - Việt, Việt - Anh, Anh - Anh | Trang chính thức liệt kê cả ba chiều. [Trang dành cho nhà phát triển](https://dict.zlb.zapps.me/api) cung cấp khung tra từ và công cụ quét từ cho website. Chưa xác nhận giấy phép tải hoặc phân phối lại bộ dữ liệu trong Enjoy; công cụ nhúng không phải bộ từ điển offline. Chưa kiểm thử tra từ thực tế. |
| [Tra Câu](https://www.tracau.vn/pages/api.html) | Anh - Việt, Việt - Anh | Tài liệu API chính thức có cả tra câu và tra từ hai chiều. Điều khoản yêu cầu email chấp thuận trước, giới hạn phi lợi nhuận nếu chưa có thỏa thuận thương mại và yêu cầu ghi nguồn ở kết quả, ứng dụng và nơi phân phối. Chưa gửi email hoặc gọi API; chưa chọn làm nguồn mặc định. |
| [Cambridge Dictionary](https://dictionary.cambridge.org/vi/) | Anh - Việt | Trang chính thức liệt kê từ điển Anh - Việt. Lần khảo sát đầu gặp HTTP 403/Cloudflare. Sau đó đã mở được mục `learn` Anh - Việt bằng in-app browser và xem nghĩa học/biết được; một số trang khác vẫn gặp challenge. Chưa xác nhận giấy phép nhúng hoặc phân phối dữ liệu; bộ online này khác bộ SQLite Anh - Anh đi kèm. |

## Các nguồn khác

Lần khảo sát đầu đã kiểm tra [FreeDict](https://freedict.org/downloads/) nhưng chưa thấy cặp có tiếng Việt. Không tích hợp dữ liệu thương mại hoặc API yêu cầu chấp thuận. Tham khảo cấu trúc đầu vào ở [Wiktextract](https://github.com/tatuylonen/wiktextract); điều kiện phân phối văn bản ở [điều 7 của Wikimedia](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use#7._Licensing_of_Content) và [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
