# Thiết lập Vertex AI Express cho Enjoy

Tài liệu này hướng dẫn kết nối Enjoy với **Vertex AI Express** qua API key của Google Cloud. Cấu hình này dành cho nhà cung cấp `Vertex AI Express` trong Enjoy và tách biệt với `Gemini` dùng Gemini Developer API.

## Phân biệt hai nhà cung cấp

| Trong Enjoy | Dịch vụ Google | API restriction | Endpoint |
| --- | --- | --- | --- |
| `Gemini` | Gemini Developer API | Gemini API, `generativelanguage.googleapis.com` | `generativelanguage.googleapis.com` |
| `Vertex AI Express` | Agent Platform API, trước đây hiển thị là Vertex AI API ở một số nơi | Agent Platform API, `aiplatform.googleapis.com` | `https://aiplatform.googleapis.com/v1` |

Không dùng lại API key chỉ được phép gọi Gemini API cho Vertex AI Express. Hãy tạo key riêng để giới hạn quyền và dễ thu hồi khi cần.

## Chuẩn bị trên Google Cloud

Bạn cần một Google Cloud project có billing đang hoạt động và **Agent Platform API** đã bật. Tên dịch vụ kỹ thuật của API này là `aiplatform.googleapis.com`; tên hiển thị trong Google Cloud Console có thể thay đổi.

### 1. Tạo service account cho Enjoy

1. Mở **IAM & Admin > Service Accounts** trong đúng project.
2. Chọn **Create service account**.
3. Đặt tên dễ nhận biết, ví dụ `enjoy-vertex-express`.
4. Gán role **Gemini Enterprise Agent Platform Express User (Beta)**, mã role `roles/aiplatform.expressUser`.
5. Hoàn tất việc tạo service account.

Role Express User là role Google hướng dẫn cho service account dùng Agent Platform Express. Không cần cấp Owner, Editor hoặc role quản trị rộng hơn.

### 2. Tạo API key riêng

1. Mở **APIs & Services > Credentials**.
2. Chọn **Create credentials > API key**.
3. Bật **Authenticate API calls through a service account** trước khi chọn dịch vụ được phép gọi.
4. Chọn service account vừa tạo.
5. Trong **API restrictions**, chỉ cho phép **Agent Platform API** có service name `aiplatform.googleapis.com`.
6. Đặt tên dễ nhận biết, ví dụ `Enjoy Vertex Express`.
7. Tạo key và giữ chuỗi key ở nơi an toàn.

Nếu tùy chọn gắn service account bị chặn, quản trị viên tổ chức cần cho phép tạo authorization key qua policy `iam.managed.disableServiceAccountApiKeyCreation`. Google khuyến nghị dùng API key cho thử nghiệm và dùng Application Default Credentials cho hệ thống production. Enjoy hiện kết nối bằng API key nên key này là một bearer credential có quyền của service account đã gắn.

### Trạng thái đã thiết lập cho project Sellnity

Ngày 10 tháng 9 năm 2026, cấu hình dùng cho Enjoy gồm:

- Service account `enjoy-vertex-express@sellnity.iam.gserviceaccount.com` có role `roles/aiplatform.expressUser`.
- API key riêng có tên hiển thị `Enjoy Vertex Express` được dùng cho kết nối này. Giá trị key không được ghi vào tài liệu hoặc artifact kiểm thử.
- Cấu hình hiện có mang tên `BiBung` không bị thay đổi.

## Chọn model đang được hỗ trợ

Danh sách model và hạn mức của Express có thể thay đổi. Mở mục **Available models and rate limits in express mode** trong tài liệu Express của Google, sau đó lấy đúng model ID mà project của bạn đang được phép dùng.

Ngày 10 tháng 9 năm 2026, `gemini-3.5-flash-lite` là lựa chọn đã được kiểm tra thành công cho project Sellnity:

- Agent Studio của project hiển thị model này và mã mẫu dùng `genai.Client(vertexai=True, api_key=GOOGLE_CLOUD_API_KEY)` với model ID `gemini-3.5-flash-lite`.
- Yêu cầu preflight tới endpoint Express `countTokens` trả HTTP 200 và `totalTokens: 3`.
- RUN2 từ bản `local-signed-build12` đã tạo một story thật bằng `POST /v1/publishers/google/models/gemini-3.5-flash-lite:generateContent`, nhận HTTP 200 và trích xuất đúng sáu từ mong đợi.
- Dữ liệu story trong SQLite giữ nguyên hash sau khi khởi động lại. Kết quả vẫn đọc được khi offline, không có thao tác tới backend Enjoy, và hồ sơ dùng một lần đã được dọn sau kiểm thử.
- Trang model chính thức ghi nhận Structured output và Count Tokens đều được hỗ trợ.
- Model đang ở trạng thái GA, phát hành ngày 21 tháng 7 năm 2026 và có ngày retirement từ 21 tháng 7 năm 2027 trở đi.
- Model này chỉ hỗ trợ endpoint `global`, `us` và `eu`. Với Express, location đã chọn khi đăng ký được dùng xuyên suốt và không được truyền trong URL API.

`countTokens` tự nó không chứng minh `generateContent`. Bằng chứng RUN2 ở trên xác nhận đúng luồng tạo story với `gemini-3.5-flash-lite`, project Sellnity và `local-signed-build12` tại ngày kiểm tra. Kết quả này không phải đánh giá chất lượng model nói chung, không kiểm tra streaming, và không bảo đảm cho project, key, location hoặc model khác.

Không dùng `gemini-2.5-flash-lite` làm model mặc định cho project đã resolve về `asia-southeast1`: yêu cầu `countTokens` thực tế đã trả 404, và trang model riêng của Google không liệt kê khu vực này. Trang tổng quan Express và trang location tổng hợp vẫn có thể liệt kê model theo phạm vi rộng hơn, vì vậy danh sách tổng quan không thay thế được kiểm tra thực tế trên đúng project và key.

Không chọn `gemini-2.0-flash-lite-001` dù ID này vẫn xuất hiện trong một bảng Express: release notes và lifecycle hiện hành cho biết Gemini 2.0 Flash-Lite đã ngừng phục vụ từ ngày 1 tháng 6 năm 2026.

Chỉ nhập model ID, ví dụ theo dạng `<MODEL_ID>`. Không nhập tiền tố `publishers/google/models/`, URL endpoint, dấu cách hoặc dấu ngoặc nhọn.

Enjoy không tự chọn model mặc định cho Vertex AI Express. Điều này tránh lưu sẵn một model đã ngừng hoạt động hoặc chưa được cấp cho project.

## Nhập cấu hình trong Enjoy

### 1. Lưu key và danh sách model

1. Mở **Enjoy > Nâng cao**.
2. Mở **Cấu hình chi tiết dịch vụ**.
3. Trong **Nhà cung cấp AI**, chọn **Vertex AI Express**.
4. Chọn **Chỉnh sửa**.
5. Nhập API key vào ô **API key**.
6. Trong **Mô hình tùy chỉnh**, nhập một hoặc nhiều model ID, phân cách bằng dấu phẩy.
7. Kiểm tra **Endpoint dịch vụ cố định** hiển thị `https://aiplatform.googleapis.com/v1`.
8. Chọn **Lưu**.

Endpoint của Vertex AI Express trong Enjoy là cố định và không thể đổi sang URL tùy chỉnh.

### 2. Chọn dịch vụ và model mặc định

1. Trong **Enjoy > Nâng cao**, mở **Cấu hình chi tiết dịch vụ**.
2. Tìm mục **Dịch vụ AI mặc định** và chọn **Chỉnh sửa**.
3. Trong **Dịch vụ AI**, chọn **Vertex AI Express**.
4. Trong **Mô hình AI mặc định**, chọn một model đã nhập.
5. Chọn **Lưu**.

Việc lưu key ở phần cấu hình chi tiết không tự đổi dịch vụ hoặc model mặc định của ứng dụng.

## Kiểm tra kết nối

1. Tạo một hội thoại mới trong Enjoy.
2. Xác nhận hội thoại đang dùng **Vertex AI Express** và đúng model ID.
3. Gửi một yêu cầu text ngắn, ví dụ `Trả lời đúng một từ: OK`.
4. Xác nhận Enjoy nhận được câu trả lời và không báo lỗi HTTP.

Một lần lưu cấu hình thành công chỉ xác nhận dữ liệu đã được nhập. Cần gửi yêu cầu thật để xác nhận API key, IAM role, API restriction, model và quota cùng hoạt động.

Bản đã nghiệm thu là `local-signed-build12` trong thư mục build local. Bản này chưa thay thế ứng dụng Enjoy đang cài và chưa thay đổi hồ sơ người dùng hiện tại.

## Xử lý lỗi thường gặp

| Lỗi | Nguyên nhân thường gặp | Cách kiểm tra |
| --- | --- | --- |
| `403 API_KEY_SERVICE_BLOCKED` | Key đang bị giới hạn cho API khác, thường là Gemini API | Mở API key và đổi API restriction sang riêng `aiplatform.googleapis.com`; không ghép restriction Gemini API vào key Express này |
| `401 UNAUTHENTICATED` | Key sai, bị thu hồi hoặc chưa có hiệu lực | Nhập lại đúng key; nếu vừa tạo, đợi ngắn rồi thử lại |
| `403 PERMISSION_DENIED` | Service account thiếu role Express User, Agent Platform API chưa bật, hoặc policy chặn | Kiểm tra `roles/aiplatform.expressUser`, trạng thái `aiplatform.googleapis.com` và binding của key |
| `404 NOT_FOUND` | Model ID sai, model không có ở location gắn với Express, không được cấp cho tài khoản hoặc đã retired | Đối chiếu trang riêng của model, location của project và model picker trong Agent Studio; sau đó thử `countTokens` trên đúng key trước khi gọi tạo nội dung |
| `429 RESOURCE_EXHAUSTED` | Hết quota, chạm rate limit hoặc dịch vụ tạm thiếu capacity | Xem quota và billing của project; giảm tần suất rồi thử lại với backoff |
| `400 INVALID_ARGUMENT` | Model ID hoặc nội dung yêu cầu không hợp lệ | Kiểm tra model ID không chứa path và thử lại bằng một yêu cầu text ngắn |

Nếu đổi API restriction hoặc IAM role, thay đổi có thể cần một khoảng ngắn để có hiệu lực.

## Bảo mật và giới hạn hiện tại

- Không đưa API key vào source code, Git, ảnh chụp màn hình, ticket hoặc log hỗ trợ.
- Enjoy gửi key bằng header `x-goog-api-key`; ứng dụng không đặt key trong URL.
- API key Vertex AI Express hiện được lưu trong cơ sở dữ liệu của hồ sơ Enjoy trên máy. Hãy coi thư mục thư viện, file cơ sở dữ liệu và mọi bản sao lưu của hồ sơ là dữ liệu nhạy cảm.
- Nếu key bị lộ, tạo key mới, cập nhật Enjoy, kiểm tra kết nối rồi thu hồi key cũ.
- Adapter Vertex AI Express hiện hỗ trợ hội thoại text. Nội dung đa phương thức và tool calls chưa được hỗ trợ qua adapter này.
- Express Mode là tính năng Preview và tập model, quota hoặc giao diện Google Cloud có thể thay đổi.

## Tài liệu Google chính thức

- [Get a Google Cloud API key](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/api-keys?usertype=standard)
- [Gemini Enterprise Agent Platform in express mode overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/express-mode/overview)
- [Manage API keys](https://docs.cloud.google.com/docs/authentication/api-keys)
- [Best practices for managing API keys](https://docs.cloud.google.com/docs/authentication/api-keys-best-practices)
- [Adding restrictions to API keys](https://docs.cloud.google.com/api-keys/docs/add-restrictions-api-keys)
- [Structured output](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/control-generated-output)
- [Gemini 3.5 Flash-Lite](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash-lite)
- [Google model endpoint locations](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations)
- [Agent Platform pricing](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing)
- [Vertex AI API errors](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/api-errors)
- [Model versions and lifecycle](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions)

Tài liệu được đối chiếu lần cuối ngày 10 tháng 9 năm 2026.
