# Sử dụng Azure trong Enjoy

Nếu chưa có API key hoặc deployment, bắt đầu với [hướng dẫn thiết lập Azure API key và model](../../docs/azure-api-key-models-setup.vi.md). Tài liệu này tập trung vào cách sử dụng sau khi cấu hình.

Azure có hai cấu hình riêng: deployment cho văn bản và tài nguyên Speech cho âm thanh. Một tài nguyên Foundry có thể cung cấp cả hai endpoint, nhưng mỗi API dùng cách gọi và tên model khác nhau.

## Văn bản, hội thoại và nội dung học

Trong **Cài đặt > Nâng cao > Dịch vụ nâng cao**, tại ô **Dịch vụ AI** chọn **Azure OpenAI**, bấm chỉnh sửa rồi nhập:

- **Base URL:** `https://<resource>.openai.azure.com/openai/v1` hoặc endpoint Foundry tương ứng kết thúc bằng `/openai/v1`.
- **API key:** key của tài nguyên Azure. Ứng dụng mã hóa key trong SQLite bằng Electron safeStorage.
- **Model tùy chỉnh:** tên deployment đang hoạt động, phân cách bằng dấu phẩy. Đây là tên deployment trong **Models + endpoints**, có thể khác tên model.

Sau khi lưu, chọn Azure OpenAI và deployment làm provider/model cho tác vụ mong muốn. Có thể chọn model riêng cho tra từ, dịch, phân tích và trích xuất từ vựng. Hội thoại, chat agent và các tác vụ văn bản dùng cùng bộ xử lý Azure v1.

Danh sách model Azure trả về qua `/models` là catalog, không chứng minh model đã được deploy. Ứng dụng không tự thêm toàn bộ catalog vào lựa chọn, không tạo deployment và không thay lựa chọn provider đang lưu.

## Chép lời audio/video và nhập giọng nói

Trong **Cài đặt > Nâng cao > Azure Speech và MAI Transcribe**, nhập:

- **Resource endpoint:** `https://<resource>.cognitiveservices.azure.com`.
- **Region:** vùng của tài nguyên, ví dụ `eastus`. Cần cho TTS và chấm phát âm; chép lời REST chỉ cần endpoint và key.
- **Subscription key:** key của chính tài nguyên đó. Để trống để giữ key cũ khi region và endpoint không đổi; nhập lại key khi đổi region hoặc endpoint đã lưu.

Sau đó chọn một trong hai dịch vụ ở cài đặt chép lời, hộp tạo transcript hoặc cấu hình STT của hội thoại:

| Dịch vụ | API/model | Cách sử dụng |
| --- | --- | --- |
| Azure MAI-Transcribe-2 | `MAI-Transcribe-2` qua Azure Speech REST | Chép lời bằng model MAI, lấy timestamp từ Azure rồi kiểm tra và alignment trong ứng dụng |
| Azure Speech Fast Transcription | Model Fast Transcription mặc định của Azure | Chép lời bằng locale cụ thể như `en-US`, `en-GB`, `vi-VN` |

Cả hai dịch vụ dùng trực tiếp tài nguyên Azure. Tùy chọn **MAI qua OpenRouter** hiện có là một provider riêng và dùng key OpenRouter.

Luồng chép lời giữ kiểm tra độ phủ audio, lời nói bị bỏ sót, ghép đoạn, alignment, mốc thời gian, hủy tác vụ và checkpoint. Chọn ngôn ngữ đúng với audio; kết quả đạt kiểm tra kỹ thuật vẫn cần được người học rà lại khi audio khó nghe.

## Đọc thành tiếng và chấm phát âm

Chọn provider **Azure** trong cấu hình TTS và chọn giọng tương ứng với ngôn ngữ. TTS và chấm phát âm dùng subscription key/region trong cấu hình Speech; không dùng tên deployment Azure OpenAI.

Chấm phát âm hoạt động trên bản ghi âm và văn bản tham chiếu. Điểm, từ và âm vị do Azure trả về được lưu cùng kết quả để xem lại. Kiểm thử bằng giọng tổng hợp chỉ xác minh tích hợp, không chứng minh độ chính xác chấm phát âm của người thật.

## Learning Studio

Sau khi cấu hình Azure OpenAI trong Dịch vụ nâng cao, mở **Kiểm tra kết nối AI** trong Learning Studio và kiểm tra lại nếu Azure vẫn báo chưa sẵn sàng:

1. Mở **Learning Studio**, tạo bản nháp bài học và nhập chủ đề hoặc từ vựng. Chọn **Azure OpenAI** trong phần gợi ý để hoàn thiện từ, nghĩa, bản dịch và ví dụ; rà lại trước khi lưu.
2. Trong bản nháp đã lưu, bấm **Tạo bằng Azure OpenAI**. Azure tạo nội dung và bài tập; ứng dụng kiểm tra cấu trúc, từ mục tiêu và các tham chiếu trước khi nhận kết quả.
3. Để tạo sơ đồ, mở form mindmap, chọn trình độ và **Azure OpenAI**, rồi tạo. Sơ đồ được kiểm tra liên kết và nhóm từ trước khi lưu.
4. Muốn có giọng đọc, bật **Tạo giọng đọc cho bài học** và cấu hình TTS **Azure**. Mỗi phần có một bước audio riêng; có thể thử lại bước thất bại.

Learning Studio dùng deployment mặc định đã chọn khi provider mặc định là Azure OpenAI và deployment còn trong danh sách cấu hình; nếu chưa có lựa chọn phù hợp, ứng dụng dùng deployment đầu tiên. Có thể dừng tác vụ đang chạy hoặc thử lại bước thất bại. Nội dung và media đã tải được lưu local để mở lại offline.

Azure OpenAI hiện tạo văn bản cho Learning Studio; ảnh minh họa vẫn dùng luồng Codex hiện có. Để chỉ dùng Azure, chọn **Không tạo ảnh** cho bài học và tắt minh họa của mindmap. Tích hợp này không tạo deployment ảnh hoặc video trên tài khoản Azure.

## Xử lý lỗi

- **Thiếu cấu hình:** kiểm tra key, region và đúng loại endpoint. TTS có thể đã hoạt động trong khi chép lời chưa có resource endpoint.
- **Unauthorized:** key có thể sai tài nguyên hoặc đã thay đổi. Nhập lại đúng key, không đưa key vào log hay ảnh chụp hỗ trợ.
- **Deployment không tồn tại hoặc Disabled:** chọn deployment đang hoạt động trong Foundry. Không thay bằng tên model trong catalog.
- **Model hoặc tính năng chưa hỗ trợ tại region:** kiểm tra hỗ trợ hiện tại của Azure cho tài nguyên đó; ứng dụng không tự chuyển sang provider khác.
- **Hết quota hoặc rate limit:** kiểm tra hạn mức Azure. Hủy tác vụ nếu không muốn chờ retry.
- **Không giải mã được key:** nhập lại key trên máy hiện tại; key được mã hóa gắn với cơ chế lưu trữ an toàn của hệ điều hành.

## Tài liệu chính thức

- [Azure OpenAI v1 API](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/api-version-lifecycle)
- [MAI-Transcribe](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe)
- [Fast Transcription](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/fast-transcription-create)
- [Ngôn ngữ Speech được hỗ trợ](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support)

Bằng chứng kiểm thử của đợt tích hợp nằm trong `.superpowers/sdd/2026-09-10-azure-models/`. Báo cáo nghiệm thu phân biệt lời gọi API thật, kiểm thử ứng dụng đóng gói và giới hạn của từng mẫu.

Kiểm thử ngày 2026-09-10 trên bản ký local build 9: MAI và Fast đều chép lời audio tiếng Anh 722.512 giây, WER lần lượt 1.4908% và 1.3188% so transcript TED published. Timeline đầy đủ và dữ liệu sau offline restart đều PASS. Bài học có Azure narration và sơ đồ cafe cũng có bằng chứng live trên các build tương ứng.

Bản ký local mới nhất tại thời điểm cập nhật tài liệu là build 12. Đường loa Pixel 10 Pro XL tới microphone XVF3800, production recorder và Azure assessment đã PASS trên build này: nhận đủ 7 từ/15 phoneme, điểm pronunciation 74.8 và bản ghi/kết quả giữ nguyên sau restart offline. User đã nghe và xác nhận các mẫu TTS OpenAI/Azure lịch sử. Chưa kiểm Azure image, tiếng Việt ASR hoặc giọng người học thật; phép thử microphone dùng TTS phát qua loa theo yêu cầu user.

Các kết quả Azure khác giữ provenance build 9 và các build lịch sử tương ứng, không coi đó là inference được chạy lại trên build 12. Xem [báo cáo nghiệm thu](provider-independence-acceptance.md).
