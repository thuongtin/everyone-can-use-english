# Portal Enjoy bản Việt

Đây là landing page Nuxt 3 cho bản Việt hóa của Enjoy. Portal giới thiệu cách học, học liệu tiếng Anh và đường dẫn đến mã nguồn trong fork đã xác minh:

`https://github.com/thuongtin/everyone-can-use-english`

## Cấu hình đường dẫn

Các CTA đọc cùng một runtime public config:

- `NUXT_PUBLIC_DOCS_URL`: trang hướng dẫn học.
- `NUXT_PUBLIC_DOWNLOAD_URL`: trang hướng dẫn tải và cài Enjoy App.
- `NUXT_PUBLIC_REPOSITORY_URL`: mã nguồn bản phân phối.

Nuxt tự ánh xạ ba biến trên vào `runtimeConfig.public.docsUrl`, `runtimeConfig.public.downloadUrl` và `runtimeConfig.public.repositoryUrl`. Mỗi giá trị phải là URL `http` hoặc `https` không chứa thông tin đăng nhập. Khi biến bị bỏ trống hoặc không hợp lệ, portal dùng các trang nguồn trong fork:

- Hướng dẫn: `README.md` ở thư mục gốc của fork.
- Tải và cài đặt: `1000-hours/enjoy-app/install.md` trong fork.
- Mã nguồn: trang gốc của fork.

## Dependency cho static build

Root `package.json` ghim `fdir` exact ở bản `6.4.4` qua `resolutions`. Bản này chứa upstream fix cho lỗi recursive symlink crawl mà Nuxt và `unimport` có thể gặp khi generate trong workspace hoặc thư mục tạm. Chi tiết release và source fix được ghi tại https://github.com/thecodrr/fdir/releases/tag/v6.4.4.

Ví dụ cấu hình local trước khi generate:

```sh
export NUXT_PUBLIC_DOCS_URL="http://127.0.0.1:3000/huong-dan"
export NUXT_PUBLIC_DOWNLOAD_URL="http://127.0.0.1:3000/tai-app"
export NUXT_PUBLIC_REPOSITORY_URL="http://127.0.0.1:3000/ma-nguon"
export NUXT_SITE_URL="http://127.0.0.1:3000"
```

`NUXT_SITE_URL` là tùy chọn. Chỉ khi biến này là URL `http` hoặc `https` hợp lệ thì cấu hình SEO mới có canonical site URL. Không cần đặt biến này cho bản preview local nếu không muốn sinh canonical.

Sitemap chỉ được bật khi `NUXT_SITE_URL` là URL `http` hoặc `https` hợp lệ. Khi biến này bỏ trống hoặc không hợp lệ, portal tắt sitemap để generate không yêu cầu một domain canonical giả.

## Phát triển

Từ thư mục gốc của repo, dùng Node.js 24 và chạy:

```sh
node 1000h-portal/node_modules/nuxt/bin/nuxt.mjs dev 1000h-portal --host 127.0.0.1
```

Hoặc từ thư mục portal:

```sh
cd 1000h-portal
node node_modules/nuxt/bin/nuxt.mjs dev --host 127.0.0.1
```

Portal dev server mặc định dùng địa chỉ local `http://127.0.0.1:3000`.

## Generate bản static

Lệnh generate được chạy từ thư mục gốc:

```sh
node 1000h-portal/node_modules/nuxt/bin/nuxt.mjs generate 1000h-portal
```

Nuxt tạo site static trong `1000h-portal/.output/public`. Các giá trị `NUXT_PUBLIC_*` cần có trước lệnh generate vì chúng được đưa vào runtime config của bản build. Có thể phục vụ thư mục output bằng static server hoặc adapter đã cấu hình cho môi trường triển khai.

Để xem output local sau khi generate:

```sh
cd 1000h-portal
node node_modules/nuxt/bin/nuxt.mjs preview --host 127.0.0.1
```

Địa chỉ preview thường là `http://127.0.0.1:3000`. Domain triển khai không được giả định trong repo này.
