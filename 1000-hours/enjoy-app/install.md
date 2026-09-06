# Tải xuống và cài đặt

Enjoy App là ứng dụng máy tính đa nền tảng, chạy trên Windows, Mac và Linux. Hãy chọn gói cài đặt phù hợp với hệ điều hành và loại chip của máy.

::: info Phiên bản của các liên kết bên dưới
Tài liệu gốc giới thiệu **v0.7.9** là phiên bản mới nhất tại thời điểm biên soạn. Các liên kết bên dưới được giữ lại để tham khảo bản phát hành của dự án gốc, không phải gói cài đặt của bản Việt hóa này. Để biết bản phát hành hiện có, xem [trang Releases của dự án gốc](https://github.com/zuodaotech/everyone-can-use-english/releases).
:::

## Windows

Theo tài liệu gốc, ứng dụng hỗ trợ Windows 10 trở lên.

[Tải gói cài đặt Windows v0.7.9](https://dl.enjoy.bot/app/win32/x64/Enjoy-0.7.9%20Setup.exe)

Sau khi tải xuống, nhấp đúp vào tệp để cài đặt.

::: tip Xử lý lỗi cài đặt trên Windows 10
Nếu gặp thông báo:

```text
A JavaScript error occurred in the main process
```

Một nguyên nhân được tài liệu gốc ghi nhận là máy thiếu thành phần phụ thuộc. Có thể thử:

1. Cập nhật hệ điều hành.
2. Tải và cài đặt [Microsoft Visual C++ Redistributable x64](https://aka.ms/vs/17/release/vc_redist.x64.exe).

Sau đó thử cài đặt Enjoy lại. Nếu lỗi vẫn xảy ra, giữ lại thông báo lỗi để xác định nguyên nhân cụ thể.
:::

## Mac

Chọn phiên bản theo chip của máy Mac:

- [Apple Silicon, arm64, v0.7.9](https://dl.enjoy.bot/app/darwin/arm64/Enjoy-0.7.9-arm64.dmg)
- [Intel, x64, v0.7.9](https://dl.enjoy.bot/app/darwin/x64/Enjoy-0.7.9-x64.dmg)

::: info Kiểm tra cấu hình máy
Các máy Mac dùng chip M1, M2, M3 và những chip thuộc dòng Apple M là máy Apple Silicon.

Nếu chưa biết loại chip, nhấp biểu tượng  ở góc trên bên trái màn hình, chọn **Giới thiệu về máy Mac này (About This Mac)**. Cửa sổ hiện ra cho biết phần cứng và hệ điều hành. Nếu tên chip thuộc dòng **Apple M**, hãy chọn bản Apple Silicon.
:::

::: warning Phiên bản macOS
Tài liệu gốc khuyến nghị macOS 12 trở lên; một số chức năng có thể không hoạt động trên macOS 11.
:::

## Linux

Chọn định dạng phù hợp với bản phân phối Linux đang dùng:

- [Tải gói deb v0.7.9](https://dl.enjoy.bot/app/linux/x64/enjoy_0.7.9_amd64.deb)
- [Tải gói zip v0.7.9](https://dl.enjoy.bot/app/linux/x64/Enjoy-linux-x64-0.7.9.zip)

## Các phiên bản trước {#previous-releases}

Các bản phát hành trước nằm trên [trang Releases của dự án gốc](https://github.com/zuodaotech/everyone-can-use-english/releases).

## Chạy bản Việt hóa từ mã nguồn {#vietnamese-source-build}

Phần này được bổ sung cho bản Việt hóa. Hiện chưa có gói cài đặt tiếng Việt được phát hành từ kho mã này. Trong môi trường phát triển đã kiểm tra, Node.js 20 và bản Yarn đi kèm kho mã có thể cài các thành phần phụ thuộc và khởi chạy ứng dụng Electron.

Từ thư mục gốc của kho mã, chạy:

```sh
node .yarn/releases/yarn-4.6.0.cjs install --immutable
node .yarn/releases/yarn-4.6.0.cjs enjoy:start
```

Sử dụng Node.js 20 cho các lệnh trên. Các thành phần native có thể cần công cụ biên dịch của hệ điều hành. Đây là hướng dẫn chạy mã nguồn, không phải xác nhận rằng mọi chức năng học, AI hoặc mọi hệ điều hành đã được kiểm thử hoàn tất.
