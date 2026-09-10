# Ký bản Enjoy trên máy Mac

Build local có thể dùng chứng chỉ đã có trong Keychain để giữ định danh ứng dụng ổn định giữa các lần đóng gói. Không lưu private key hoặc mật khẩu vào dự án.

## Cấu hình một lần

Xem các chứng chỉ có thể ký:

```sh
security find-identity -v -p codesigning
```

Tạo `enjoy/.local-signing.json` với SHA-1 hoặc tên đầy đủ của chứng chỉ muốn dùng:

```json
{
  "identity": "SHA1_OF_YOUR_LOCAL_SIGNING_CERTIFICATE"
}
```

File này đã được Git ignore. Có thể ghi đè cho một lần chạy bằng biến môi trường `ENJOY_LOCAL_SIGN_IDENTITY`. Build sẽ dừng nếu cấu hình có lỗi hoặc không ký được bằng chứng chỉ đã chọn.

Từ thư mục `enjoy`, chạy lệnh đóng gói thông thường:

```sh
yarn package
codesign --verify --deep --strict out/Enjoy-darwin-arm64/Enjoy.app
codesign -d -r- --verbose=2 out/Enjoy-darwin-arm64/Enjoy.app
```

Kiểm tra `Authority` là chứng chỉ đã chọn và designated requirement dựa trên identifier cùng chứng chỉ. Chữ ký ad-hoc có thể chỉ dùng `cdhash`, thay đổi khi nội dung build thay đổi.

## Keychain sau khi đổi chữ ký

Lần đầu chuyển từ bản ad-hoc sang chứng chỉ local, macOS có thể yêu cầu xác nhận quyền truy cập dữ liệu đã mã hóa. Chọn **Always Allow / Luôn cho phép** nếu hộp thoại đúng là Enjoy và bạn muốn cho các build cùng định danh tiếp tục truy cập. Nhập mật khẩu trực tiếp trong hộp thoại macOS. Việc ký không tự cấp quyền đối với mục Keychain đã tồn tại.

Giữ cùng chứng chỉ và bundle identifier qua các build. Đổi chứng chỉ, đổi bundle identifier hoặc thay đổi quyền Keychain có thể yêu cầu xác nhận lại. Khóa dịch vụ vẫn được mã hóa bằng `safeStorage`.

## Phạm vi

Đây là chữ ký phục vụ chạy local, không có notarization. Cấu hình giữ hành vi runtime development và không gọi dịch vụ timestamp. Luồng release có đủ `APPLE_ID`, `APPLE_APP_PASSWORD`, `APPLE_TEAM_ID` vẫn được ưu tiên như trước. Không dùng bản development này làm bằng chứng đủ điều kiện phát hành cho máy khác.

Nếu không có cấu hình local và không có cấu hình release, luồng fallback ad-hoc cũ vẫn áp dụng. Lệnh `yarn start` chạy Electron development riêng; hướng dẫn này áp dụng cho app đã đóng gói.

Nguồn: [Apple, Code Signing In Depth](https://developer.apple.com/library/archive/technotes/tn2206/) và [Electron osx-sign](https://github.com/electron/osx-sign).
