# Thiết lập Azure API key và model cho Enjoy

Hướng dẫn này dành cho bản Enjoy đã tích hợp Azure OpenAI, Azure Speech và MAI-Transcribe-2. Bạn sẽ lấy key của tài nguyên Azure, chọn đúng endpoint/model, lưu cấu hình trong Enjoy rồi kiểm tra từng chức năng.

Đối chiếu tài liệu Microsoft và source Enjoy ngày **10/09/2026**. Ví dụ `tinopenai` và `tin35turbo` lấy từ tài nguyên đã kiểm thử trong dự án; khi dùng tài khoản khác, thay bằng thông tin của bạn. Tên menu Azure có thể khác giữa Foundry mới và Foundry classic.

## 1. Chọn đúng nhóm dịch vụ

| Nhu cầu trong Enjoy | Provider cần chọn | Thông tin cần chuẩn bị | Có tạo deployment riêng? |
| --- | --- | --- | --- |
| Hội thoại, dịch, tra từ, trích xuất Story, bài học và mindmap | **Azure OpenAI** | Base URL, API key, tên deployment | Có, nếu tài nguyên chưa có deployment text phù hợp |
| Chép lời bằng MAI | **Azure MAI-Transcribe-2** | Speech resource endpoint, subscription key | Không deploy MAI như một GPT model |
| Chép lời bằng Speech Fast | **Azure Speech Fast Transcription** | Speech resource endpoint, subscription key, locale | Không cần deployment GPT |
| Đọc thành tiếng | **Azure** trong TTS | Speech subscription key, region, voice | Không cần deployment GPT |
| Chấm phát âm | **Azure Speech** | Speech subscription key, region, bản ghi và câu tham chiếu | Không cần deployment GPT |

Enjoy lưu cấu hình text và Speech riêng. Một tài nguyên Foundry có thể cung cấp cả hai nhóm API; nếu bạn dùng hai tài nguyên riêng thì phải lấy đúng key cho từng tài nguyên. Key hợp lệ cho Speech không tự chứng minh deployment text đã sẵn sàng. Xem [mô hình tài nguyên Foundry](https://learn.microsoft.com/en-us/azure/ai-services/multi-service-resource).

## 2. Mở tài nguyên Azure và lấy key

Nếu đã có tài nguyên `tinopenai`, dùng tài nguyên đó và bỏ qua bước tạo mới.

1. Đăng nhập [Azure Portal](https://portal.azure.com/), chọn đúng directory và subscription.
2. Mở **All resources**, tìm tài nguyên Foundry/Speech của bạn.
3. Nếu chưa có, tạo **Microsoft Foundry** resource, chọn resource group, tên và region hỗ trợ tính năng cần dùng. Hoàn tất **Review + create**. Không cần tạo thêm resource chỉ để có key thứ hai.
4. Trong tài nguyên, mở **Resource Management > Keys and Endpoint**. Ghi lại tên resource, **Location/Region** và endpoint; dùng nút Copy để lấy **KEY 1** hoặc **KEY 2**.
5. Dán key trực tiếp vào đúng ô cấu hình Enjoy bên dưới. Không cần bấm **Regenerate** để sử dụng một key đang hoạt động.

Key không phải subscription ID, tenant ID, project ID hoặc tên deployment. Không đưa key vào tài liệu, Git, ảnh chụp hay nội dung trao đổi hỗ trợ. Enjoy dùng key trực tiếp; giao diện cấu hình hiện chưa có luồng đăng nhập Microsoft Entra ID thay cho key. [Microsoft: lấy key và region cho Speech](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/get-started-speech-to-text).

Khi chọn region, đối chiếu riêng từng dịch vụ. Tài liệu Microsoft hiện liệt kê `eastus` cho MAI transcription; đừng đổi chữ region trong Enjoy để cố chuyển một resource sang vùng khác. [Bảng region Azure Speech](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/regions).

## 3. Thiết lập model văn bản trong Foundry

1. Mở [Microsoft Foundry](https://ai.azure.com/) và chọn đúng resource/project.
2. Mở danh sách deployment. Foundry classic thường đặt tại **My assets > Models + endpoints**.
3. Nếu đã có deployment text ở trạng thái **Succeeded**, mở chi tiết và ghi lại **Deployment name**, **Model name**, version và endpoint.
4. Nếu chưa có, chọn **Deploy model**, chọn model text hỗ trợ API mà ứng dụng dùng, đặt deployment name rồi xem quota và chi phí trước khi tạo.
5. Chờ deployment sẵn sàng. Nhập **Deployment name** vào Enjoy, kể cả khi tên đó khác hẳn tên model gốc.

Ví dụ: deployment `enjoy-text` chạy model `gpt-4.1-mini` thì ô Model của Enjoy phải là `enjoy-text`. Đây là quy tắc gọi Azure bằng deployment name. [Microsoft: tạo và deploy model](https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/create-resource).

### Model đã có bằng chứng trong dự án

| Deployment | Model gốc | Trạng thái đã ghi nhận | Cách dùng |
| --- | --- | --- | --- |
| `tin35turbo` | `gpt-4.1-mini`, version `2025-04-14` | Deployment Succeeded; đã có inference text, bài học và mindmap | Nhập `tin35turbo` vào Enjoy |
| `tin-35-turbo-instruct` | `gpt-35-turbo-instruct`, version `0914` | Deployment Disabled ở lần kiểm tra | Không thêm vào lựa chọn sử dụng |

Bảng này phản ánh lần kiểm thử ngày 10/09/2026, không bảo đảm deployment vẫn hoạt động sau khi tài khoản được chỉnh sửa. Receipt nguồn: [inventory deployment](../.superpowers/sdd/2026-09-10-azure-models/resource-deployments.json). Tên `tin35turbo` không có nghĩa model bên dưới vẫn là GPT-3.5.

Bạn có thể cấu hình deployment khác, nhưng cần kiểm tra tương thích thực tế. Adapter Enjoy dùng Azure v1 Chat Completions; tác vụ cấu trúc còn cần model xử lý được JSON theo contract của ứng dụng. Không suy rằng mọi model hiện trong catalog đều dùng được. Azure image, video, realtime voice và embedding chưa được tích hợp chỉ bằng việc thêm tên model vào danh sách này.

## 4. Nhập Azure OpenAI vào Enjoy

Mở **Cài đặt > Nâng cao**, mở nhóm thu gọn **Dịch vụ nâng cao**. Tại ô **Dịch vụ AI**, chọn **Azure OpenAI**, bấm chỉnh sửa rồi điền:

| Ô cấu hình | Giá trị mẫu cho resource đã kiểm thử |
| --- | --- |
| Provider | `Azure OpenAI` |
| Base URL | `https://tinopenai.openai.azure.com/openai/v1` |
| API key | Dán key của resource `tinopenai` |
| Model tùy chỉnh | `tin35turbo` |

Nếu có nhiều deployment, nhập tên phân cách bằng dấu phẩy, ví dụ `enjoy-text,enjoy-text-large`, nhưng chỉ khi cả hai deployment đó thật sự tồn tại.

Azure v1 chấp nhận endpoint dạng `https://<resource>.openai.azure.com/openai/v1` hoặc `https://<resource>.services.ai.azure.com/openai/v1`. Lấy host từ endpoint resource của bạn. Không dán project endpoint có `/api/projects/...`, URL portal, hoặc đường dẫn đầy đủ `/chat/completions` vào Base URL. Với v1, không thêm tham số `api-version` kiểu cũ. [Microsoft: Azure OpenAI v1 API](https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle).

Sau khi lưu, chọn **Azure OpenAI + deployment** cho provider/model mặc định hoặc cho từng tác vụ. Đổi cấu hình provider không tự đổi mọi conversation cũ. Với conversation legacy yêu cầu chọn lại provider, mở chỉnh sửa và chọn rõ provider/model mới.

Trong **Learning Studio**, dùng **Kiểm tra kết nối AI**, sau đó thử tạo một bài học ngắn. Luồng này dùng deployment Azure mặc định phù hợp đã chọn, hoặc deployment đầu tiên nếu chưa có lựa chọn phù hợp. Khi chỉ dùng Azure, chọn **Không tạo ảnh** và tắt minh họa mindmap; ảnh vẫn thuộc luồng Codex riêng. Xem [cách dùng Azure trong Enjoy](../enjoy/docs/azure-models.md).

## 5. Nhập Azure Speech và MAI Transcribe

Mở **Cài đặt > Nâng cao > Azure Speech và MAI Transcribe**:

| Ô cấu hình | Giá trị mẫu |
| --- | --- |
| Resource endpoint | `https://tinopenai.cognitiveservices.azure.com` |
| Region | `eastus` |
| Subscription key | Dán key của chính resource đó |

Bấm **Lưu Azure Speech**. Khi chỉnh sửa cấu hình đã có key, để trống chỉ giữ key cũ nếu region và endpoint không đổi. Khi đổi region hoặc endpoint đã lưu, nhập lại key. Chép lời REST cần endpoint và key; TTS/chấm phát âm cần key và region. Điền đủ cả ba để sử dụng toàn bộ nhóm chức năng.

Endpoint Speech là địa chỉ gốc của resource. Không nhập `/openai/v1`, `/api/projects/...`, `/speechtotext/...` hoặc một URL phát audio vào ô này. Enjoy tự ghép đường dẫn API.

### Các model và dịch vụ âm thanh

Các lựa chọn STT/TTS nằm trong **Cài đặt > Nâng cao > Dịch vụ nâng cao**, và trong cấu hình tác vụ tương ứng.

| Chọn trong Enjoy | Model/voice thực tế | Thiết lập thêm |
| --- | --- | --- |
| Azure MAI-Transcribe-2 | `MAI-Transcribe-2` | Chọn ngôn ngữ phù hợp với audio |
| Azure Speech Fast Transcription | Model Fast mặc định do Azure quản lý | Locale như `en-US`, `en-GB`, `vi-VN` |
| Azure TTS tiếng Anh | Ví dụ `en-US-JennyNeural`, đã kiểm thử | Chọn provider Azure và voice trong TTS |
| Azure TTS tiếng Việt | Microsoft có `vi-VN-HoaiMyNeural`, `vi-VN-NamMinhNeural` | Chọn ngôn ngữ `vi-VN` và voice có trong danh sách; chưa nghiệm thu hai voice này trong dự án |
| Azure Pronunciation Assessment | Dịch vụ chấm phát âm của Speech | Chọn ngôn ngữ/giọng vùng, thu âm và nhập câu tham chiếu |

Danh sách voice phụ thuộc ngôn ngữ và dịch vụ. `en-US-JennyNeural` là voice ID, không phải deployment text. [Microsoft: ngôn ngữ và voice](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts).

MAI-Transcribe-2 hiện là Preview. Trong Enjoy, adapter chọn model này qua Speech REST bằng `enhancedMode.enabled=true` và `enhancedMode.model="MAI-Transcribe-2"`; bạn không cần tạo deployment tên đó trong Azure OpenAI. Tùy chọn **MAI qua OpenRouter** là provider khác, dùng key OpenRouter. [Microsoft: MAI-Transcribe](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe).

Fast Transcription dùng adapter riêng. Chọn dịch vụ ở cài đặt chép lời, hộp tạo transcript hoặc STT của conversation; việc lưu key Speech chưa tự thay provider đang chọn. [Microsoft: Fast Transcription](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/fast-transcription-create).

## 6. Kiểm tra sau khi lưu

Các bước tạo nội dung dưới đây gọi API thật và có thể phát sinh chi phí. Dùng mẫu ngắn trước.

| Bước | Thao tác | Kết quả cần thấy |
| --- | --- | --- |
| Text | Chọn Azure OpenAI + deployment, gửi một câu hoặc trích xuất Story | Có câu trả lời hoặc danh sách từ; không báo thiếu deployment |
| MAI | Mở audio tiếng Anh 10-20 giây và chọn Azure MAI-Transcribe-2 | Có transcript, câu/từ và timeline phát được |
| Fast | Thử cùng audio, chọn Azure Speech Fast Transcription và locale đúng | Có kết quả riêng; nghe và so lại lời |
| TTS | Đọc “Cup. I have a cup of tea.” bằng Azure/JennyNeural | Nghe đủ câu, không mất đầu/cuối hoặc rè |
| Chấm phát âm | Thu câu trên trong Enjoy rồi gửi đánh giá | Có điểm, từ và phoneme; xem lại được bản ghi |
| Lưu local | Đóng app, mở lại offline | Nội dung và audio đã tải vẫn mở được; tạo nội dung mới cần mạng |

Trên macOS, cấp quyền **Microphone** cho Enjoy khi được hỏi. Enjoy hiện thu từ đầu vào mặc định của hệ thống; nếu dùng XVF3800, chọn thiết bị đó trong **System Settings > Sound > Input** trước khi thu. Chấm phát âm phản ánh audio được gửi lên, nên điểm từ loa phát TTS không đại diện cho phát âm của người học. [Microsoft: Pronunciation Assessment](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment).

Trong dự án, Azure text/lesson/mindmap, hai ASR ngắn/dài, TTS và assessment đã có bằng chứng thật. Riêng build 12 đã kiểm đường loa Pixel tới XVF3800, Azure nhận đủ 7 từ/15 phoneme và dữ liệu giữ nguyên qua restart offline. Các lượt trước giữ đúng provenance build gốc; không coi tất cả là inference mới trên build 12. Xem [báo cáo nghiệm thu](../enjoy/docs/provider-independence-acceptance.md).

## 7. Sửa lỗi thường gặp

| Hiện tượng | Kiểm tra và xử lý |
| --- | --- |
| `401`, key không hợp lệ | Key có thuộc đúng resource và endpoint không? Nhập lại key đang hoạt động trong Azure Portal |
| `403` hoặc bị chặn truy cập | Kiểm tra quyền, key authentication, Networking/firewall và policy của resource với người quản trị; không tự bỏ giới hạn bảo mật |
| `404`, `DeploymentNotFound`, Disabled | Dùng deployment name đang Succeeded, không dùng model catalog hoặc deployment Disabled |
| `400`, JSON hoặc tham số không được hỗ trợ | Kiểm tra model/API tương thích với tác vụ; thử text ngắn, sau đó tác vụ cấu trúc |
| `429`, quota/rate limit | Kiểm tra quota deployment, tần suất và capacity; giảm số tác vụ đồng thời |
| Text chạy nhưng Speech lỗi | Cấu hình Speech được lưu riêng; đối chiếu endpoint, key và region của Speech |
| TTS chạy nhưng chép lời lỗi | Kiểm tra thêm Speech resource endpoint và hỗ trợ MAI/Fast tại region |
| Chép lời sai ngôn ngữ | Kiểm tra audio và locale đã chọn; không ép locale không khớp audio |
| Không thu được âm thanh | Kiểm tra quyền microphone, đầu vào mặc định và mức input trước khi gửi Azure |
| Không giải mã được key | Nhập lại key trên máy hiện tại; không sao chép ciphertext để thay cho key |

Enjoy mã hóa key Azure bằng Electron safeStorage. Bản sao dữ liệu vẫn cần được bảo vệ và có thể không giải mã được trên máy hoặc danh tính hệ điều hành khác. Khi bạn tự thay key trên Azure, cập nhật từng cấu hình text/Speech có sử dụng key đó rồi kiểm tra lại; không cần tạo lại toàn bộ thư viện.

## 8. Thông số tham khảo cho người tích hợp

Đây là thông số của adapter Enjoy hiện tại, không phải nội dung cần nhập nguyên khối vào giao diện:

```text
Text provider: azure-openai
Text API: POST <Azure OpenAI Base URL>/chat/completions
Text model field: <deployment-name>

MAI engine: azure_mai
MAI model: MAI-Transcribe-2
Speech REST: POST <Speech resource endpoint>/speechtotext/transcriptions:transcribe
Speech REST api-version: 2025-10-15
Speech REST key header: Ocp-Apim-Subscription-Key
MAI word timestamps: enhancedMode.modelOptions.timestamps = word

Fast engine: azure_speech
Fast app model identifier: azure-speech-fast
TTS example voice: en-US-JennyNeural
Speech example region: eastus
```

`azure-speech-fast` là identifier trong Enjoy, không phải tên deployment cần tạo trên Azure. Với API MAI ngoài Enjoy, Microsoft cho phép tự nhận diện ngôn ngữ nếu bỏ `locales`; khả năng API không đồng nghĩa mọi tùy chọn đều có trong giao diện ứng dụng.

Tài liệu này không chứa API key và việc viết tài liệu không thay đổi tài nguyên, deployment, billing hoặc cấu hình Enjoy của bạn.
