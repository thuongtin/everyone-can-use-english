# Từ điển Anh - Việt và Việt - Anh của Enjoy

Văn bản từ điển thuộc các cộng tác viên Wiktionary, phân phối theo CC BY-SA 4.0. Dữ liệu phái sinh trong thư mục này cũng được phân phối theo CC BY-SA 4.0, tách biệt với giấy phép mã nguồn ứng dụng. Toàn văn giấy phép: `LICENSE-CC-BY-SA-4.0.txt`, hoặc https://creativecommons.org/licenses/by-sa/4.0/ . Dữ liệu được cung cấp nguyên trạng, không có bảo đảm về độ chính xác hoặc độ phủ.

Nguồn và ghi công:

- Cộng tác viên Wiktionary tiếng Việt: https://vi.wiktionary.org/ . Mỗi mục từ Anh - Việt có URL đến trang nguồn và lịch sử đóng góp của trang đó.
- Cộng tác viên Wiktionary tiếng Anh: https://en.wiktionary.org/ . Mỗi mục từ Việt - Anh có URL đến trang nguồn và lịch sử đóng góp của trang đó.
- Tatu Ylonen và cộng tác viên Wiktextract/Kaikki: https://kaikki.org/ , https://github.com/tatuylonen/wiktextract . Tham khảo: Tatu Ylonen, “Wiktextract: Wiktionary as Machine-Readable Structured Data”, LREC 2022, trang 1317-1325, https://www.lrec-conf.org/proceedings/lrec2022/pdf/2022.lrec-1.140.pdf .

Đã thay đổi dữ liệu để dùng trong Enjoy: lọc đúng chiều ngôn ngữ và các mục từ chữ Latin, bỏ mục ký tự Hán/Nôm, bỏ nghĩa trống, bỏ các ví dụ có nguồn trích dẫn riêng ở bản raw Anh - Việt và bỏ toàn bộ ví dụ của bản postprocessed Việt - Anh vì có trích dẫn gộp vào nội dung, chọn trường nghĩa/từ loại/IPA/ví dụ, chuẩn hóa Unicode NFC và khoảng trắng của khóa tra cứu, đổi dấu gạch ngang dài thành dấu gạch ngang thường, nhóm các mục cùng khóa và chuyển sang SQLite. Giữ chữ Hán xuất hiện bên trong một số nghĩa như đối tượng giải thích ngôn ngữ, không dùng làm ngôn ngữ giải nghĩa. Không đóng gói âm thanh, ảnh, từ nguyên hoặc metadata thể loại. Bản này không phải toàn bộ Wiktionary và không được Wikimedia hay Kaikki bảo chứng.

`editorial-corrections.json` ghi riêng các sửa chữa có nguồn đối chiếu, hiện gồm nghĩa bị lỗi chữ và IPA Mỹ của mục `learn`. Kết quả tra từ hiển thị ghi chú biên tập cùng nguồn.

`manifest.json` ghi ngày dump, ngày trích xuất, URL nguồn, SHA-256 của đầu vào, SHA-256 của bản SQLite và archive, số khóa tra cứu, số mục, số nghĩa cùng số mục bị lọc. Bản Anh - Việt dùng raw JSONL. Bản Việt - Anh hiện dùng snapshot postprocessed theo ngôn ngữ, đã được Kaikki đánh dấu deprecated. Snapshot đã được đóng gói trong kho mã nên build/chạy không phụ thuộc URL này; khi cập nhật nguồn nên chuyển sang raw JSONL và rà soát lại metadata ngày/hash, chất lượng và giấy phép.

Tạo lại bằng Python 3.11 trở lên với hai tệp đầu vào khớp hash trong manifest:

```sh
python3 enjoy/scripts/build-bilingual-dictionaries.py --en-vi /path/to/viwiktionary.jsonl.gz --vi-en /path/to/vietnamese.jsonl
```

Lệnh này thay các archive và manifest do dự án tạo trong `enjoy/dictionaries/`, không tác động thư viện hoặc từ điển do người dùng nhập. Khi khởi động/build, `scripts/download-dictionaries.mjs` kiểm tra hash và giải nén các archive có sẵn, không tải từ Internet.
