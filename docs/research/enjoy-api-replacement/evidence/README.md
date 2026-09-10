# Phạm vi evidence trong mã nguồn

Thư mục này giữ các kết quả nghiên cứu có cấu trúc, transcript tham chiếu ngắn, hash và script kiểm chứng của đợt 08/09/2026. Những kết quả này phản ánh từng phép thử tại thời điểm ghi nhận, không phải trạng thái hiện tại của mọi provider.

Audio TTS trong `audio/`, các file WAV trong `fixtures/` và ảnh `lesson-breakfast.png` là output/fixture của lượt chạy local, được Git ignore. Các đường dẫn tới những file đó trong báo cáo hoặc JSON chỉ dùng để đối chiếu với bộ evidence trên máy đã chạy; chúng không phải file tải xuống từ PR.

Nguồn corpus được ghi ở `fixtures.json`: mẫu JFK từ whisper.cpp, hội thoại và câu tiếng Việt tổng hợp bằng macOS `say`, cùng PCM silence. Đợt nghiên cứu không dùng ghi âm hoặc nội dung học riêng của người dùng.

`key-before.json` và `key-after.json` chỉ lưu số liệu sử dụng, không chứa API key. Credential dùng để chạy lại phải được cung cấp riêng qua môi trường của người thực hiện.
