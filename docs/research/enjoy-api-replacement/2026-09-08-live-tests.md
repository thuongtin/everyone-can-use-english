# Kiểm thử thật các giải pháp thay Enjoy API

Ngày 08/09/2026. Phạm vi người dùng cấp: dùng OpenRouter key để thử các giải pháp AI trong báo cáo thay Enjoy API. Không đổi provider/settings của app và không dùng nội dung học riêng của người dùng làm corpus.

## Kết quả và hướng chọn

**OpenRouter dùng được cho ASR, TTS, LLM và sinh ảnh. Nó không thay các API nghiệp vụ Enjoy hoặc Azure Pronunciation Assessment.** Hướng triển khai nên ưu tiên:

| Chức năng | Hướng chọn từ bằng chứng hiện tại | Bằng chứng và giới hạn |
|---|---|---|
| ASR cloud cần word timing và phân vai | `microsoft/mai-transcribe-2` | JFK đúng; 4 lượt thoại gán 2 speaker đúng; silence rỗng; có word timing. Số được format, cần adapter |
| ASR cloud EN/VI không cần phân vai | `x-ai/grok-stt-1.0` là ứng viên đối chiếu | VI synthetic khớp toàn bộ; EN bỏ filler; chưa test diarization |
| ASR offline | whisper.cpp hoặc integrated Whisper qua Echogarden | Runtime local `tiny.en` chạy thật dưới network deny; corpus còn nhỏ |
| Căn từ và IPA | Echogarden DTW + eSpeak local | Tạo `word > token > phone`, 69 phone hợp lệ trong JFK; đây là timing, không phải chấm phát âm |
| TTS EN/VI | `x-ai/grok-voice-tts-1.0`, voice `eve` | MP3 decode; nội dung VI đúng qua hai ASR; chưa chấm độ tự nhiên bằng người nghe |
| TTS English thay thế | MAI Voice 2 Flash; các model trong bảng TTS | 18/18 audio EN giữ nội dung qua roundtrip; Gemini cần PCM adapter |
| Chat, dịch, IPA, bài học | OpenRouter qua provider OpenAI-compatible hoặc ACP hiện có | 3 model đại diện đã qua 18 probe API và 9 command thật qua factory Enjoy |
| Minh họa bài học | GPT-5 Image Mini qua OpenRouter dedicated images | Native PNG có trứng và bánh mì, đã mở kiểm tra; không phải URL tự bịa |
| Pronunciation Assessment | Azure Speech direct hoặc provider đánh giá tương đương | Chưa test trực tiếp vì OpenRouter key không cấp quyền Azure/Speechace; ASR/LLM không trả bộ điểm thay thế tương đương |
| Lịch sử, từ vựng, note, story/preset | SQLite, file và local repository/catalog | Model API không thay CRUD, auth, payment, sync hay catalog Enjoy |

Đây là lựa chọn kỹ thuật từ corpus nhỏ và khả năng ghép với app, không phải bảng xếp hạng chất lượng phổ quát. **Chưa tích hợp OpenRouter speech vào Enjoy, chưa có acceptance end-to-end trong UI.**

## Đã test những gì?

| Nhóm | Phủ được | Kết quả |
|---|---|---|
| ASR catalog | Cả 20 model output `transcription` | 20/20 chép đúng mẫu JFK; 8/20 trả word timing qua request đã thử; Qwen 1.7B timeout rồi retry JSON thành công |
| ASR sâu | 6 model x 3 fixture | Hội thoại 2 giọng, VI và silence; có failure nội dung và hallucination, ghi bên dưới |
| MAI style | `verbatim`, `clean` | Cả hai nhận 200; mẫu vẫn còn `um`, chưa chứng minh clean được áp dụng |
| TTS catalog | Cả 18 model output `speech` | 17 direct MP3; Gemini PCM rồi transcode; tất cả decode được |
| Nội dung TTS | 18 EN qua MAI ASR; 3 VI qua 2 ASR | EN 18/18 giữ nội dung; VI chỉ Grok đạt với cấu hình đã thử |
| LLM | 3 model đại diện, 6 probe/model, thêm 3 command thật/model | 18 API probe và 9 command qua `createChatModel` đều pass: dịch, lookup, IPA, JSON schema, SSE, tool |
| Image | 1 model, 1 ảnh thành công | PNG 1024 x 1024; request đầu bị giới hạn kích thước được sửa |
| Local | 5 tác vụ offline, chạy xác minh lần 2 | 47 điều kiện kiểm động pass, 2 ghi chú mô tả; control xác nhận network bị chặn bằng EPERM |
| System TTS | Giọng Samantha, Daniel, Linh | Tạo WAV EN/VI dùng làm fixture synthetic |

"Toàn bộ" ở bảng speech là toàn bộ 20 ASR và 18 TTS model trong catalog endpoint tại thời điểm test. Không gọi hàng trăm model text hoặc model music/video không thuộc chức năng cần thay. Đối với giải pháp yêu cầu credential/resource riêng hoặc weights chưa có trên máy, bảng phạm vi chưa kiểm ở dưới nêu rõ.

## Những lỗi kiểm thử đã phát hiện

1. **Text đúng chưa đủ cho shadowing.** 12 model ASR không trả word timestamps trong request thành công đã thử. App phải giữ forced alignment, không đưa text hoặc timestamp chia đều vào timeline.
2. **Silence vẫn có thể sinh chữ.** Qwen 0.6B sinh `Ahora.`, Whisper-1 sinh `you` trên PCM toàn số 0. Cần VAD và validation trước khi lưu transcript.
3. **HTTP 200 không bảo đảm ngôn ngữ đúng.** Deepgram Nova 3 trả text rỗng với sample VI. TTS Fish S2.1 Pro và Voxtral trả audio decode được nhưng hai ASR đều nhận sai nhiều nội dung VI.
4. **Format audio khác nhau theo model.** Gemini TTS từ chối MP3 trực tiếp, chỉ nhận PCM trong lượt thử. Cần transcode và MIME đúng.
5. **Normalization làm sai cách đọc WER.** MAI đổi `seven four two` thành `742`, `ten fifteen` thành `10:15`. WER thô bị phạt dù nội dung đúng; không dùng số đó để kết luận MAI kém chính xác hơn Qwen.
6. **Whisper alignment khác DTW alignment.** Whisper chỉ tạo `word > token`; DTW mới có `word > token > phone` để UI dựng IPA. `subphone` là optional type của thư viện, consumer đã kiểm không đòi node riêng. Caption có fallback khi thiếu phone, nhưng Copy IPA đang gọi `token.timeline.map` không guard: raw Whisper token không phải drop-in cho nhánh này.
7. **Option được chấp nhận chưa chắc được áp dụng.** MAI `clean` và `verbatim` đều giữ filler trên mẫu; cần thêm bằng chứng trước khi công bố style switch hoạt động.
8. **LLM IPA vẫn cần nguồn kiểm chứng.** Schema pass không làm IPA thành chuẩn từ điển; có biến thể không nên dùng làm canonical. Giữ IPA từ dictionary làm nguồn chính, LLM là fallback có nhãn.

## Corpus, độ tin cậy và việc chưa kiểm

Corpus gồm JFK public 11 giây, dialogue synthetic 19,465 giây, tiếng Việt synthetic 9,167 giây và silence 3 giây. Không gửi ghi âm cá nhân. JFK có thể nằm trong training data. Các fixture sạch và ngắn không đại diện cho giọng người Việt nói tiếng Anh, tạp âm, nói chồng hoặc bài học dài.

Roundtrip TTS dùng model ASR để kiểm nội dung, chưa thay đánh giá nghe về giọng, ngữ điệu hoặc sự tự nhiên. Kiểm timestamp mới xác nhận cấu trúc/range và speaker theo turn; chưa có annotation từng từ của người nghe để tính timing error.

| Giải pháp/luồng | Trạng thái và lý do |
|---|---|
| Azure Speech direct STT/TTS/Pronunciation Assessment | Chưa kiểm live: thiếu Azure resource credential; không thể dùng OpenRouter key như Azure key |
| Speechace | Chưa kiểm live: thiếu credential riêng |
| OpenAI/Deepgram/Fish/Mistral direct API | Model tương ứng đã test qua OpenRouter; chưa chứng minh auth, billing hoặc endpoint direct của hãng |
| Cloudflare Workers AI | Chưa test với Cloudflare account/token riêng |
| Kokoro local, local LLM Ollama/LM Studio | Chưa chạy: chưa có weights phù hợp sẵn; Kokoro được test qua cloud TTS, không phải local acceptance |
| ACP đăng nhập CLI | Đường hiện có trong app; đợt OpenRouter này không chạy lại session ACP |
| Luồng Enjoy UI, SQLite persistence và voice playback thực | Chưa test end-to-end với provider OpenRouter mới vì chưa triển khai adapter vào app |
| Corpus người thật, long audio, real-time streaming speech, concurrency/quota/retry dài | Chưa kiểm trong mẫu smoke nhỏ này |
| Backend nghiệp vụ Enjoy | Không được thay bởi OpenRouter; cần implementation local repository theo inventory 70 method |

## Chi phí và artifact

**Usage của key tăng từ $0 lên $0,083797509**, khoảng 8,38 US cent cho toàn cửa sổ kiểm thử. Đối chiếu lần cuối lúc 14:06 +0700, ngày 08/09/2026. [Billing evidence](evidence/billing-summary.json).

| Nhóm | Tổng receipts USD |
|---|---:|
| ASR baseline, sâu và MAI style | 0,0201925505 |
| ASR kiểm nội dung TTS | 0,0029048611 |
| TTS synthesis | 0,0284199200 |
| LLM direct | 0,0172452000 |
| Factory Enjoy, lần có capture receipts | 0,0064532000 |
| Image | 0,0022910000 |
| **Tổng receipts** | **0,0775067316** |

Chênh lệch với usage của key là **$0,0062907774**. Có một lần chạy 9 command factory thành công trước khi bổ sung capture receipts; lần đó không có chi phí từng request được giữ lại. Đây là nguồn chính có thể giải thích chênh lệch, nhưng không gán số tiền chính xác cho từng request thiếu receipt hoặc bị timeout. Usage key là số đo toàn cửa sổ, tổng receipts là phần đối chiếu chi tiết được.

Không suy chi phí từ đơn vị giá catalog. File key tạm đã được xóa sau khi dừng paid calls; key không được nhập vào settings app hoặc chép vào báo cáo/evidence. Việc revoke key phía OpenRouter vẫn do người dùng thực hiện.

Các phụ lục có response, generationId, model, latency, cost, fixture và phạm vi nghiệm thu:

- [20 model ASR](2026-09-08-asr-live.md).
- [18 model TTS và roundtrip](2026-09-08-tts-live.md).
- [LLM, actual factory và ảnh](2026-09-08-llm-live.md).
- [Local offline](2026-09-08-local-live.md).
- [Source/contract mapping đầy đủ](2026-09-08-report.md).
- [Evidence JSON](evidence/asr-matrix.json).

## Mẫu kết quả để nghe/xem

Grok TTS tiếng Việt, voice `eve`: “Hôm nay tôi học tiếng Anh trong mười phút.”

![Grok TTS Vietnamese](evidence/audio/x-ai__grok-voice-tts-1.0/vi.mp3)

Grok TTS English: “The train leaves at seven thirty. Please bring your blue notebook.”

![Grok TTS English](evidence/audio/x-ai__grok-voice-tts-1.0/en.mp3)

Ảnh minh họa bài học từ OpenRouter GPT-5 Image Mini, đã mở kiểm tra: trứng và bánh mì trên đĩa, không có chữ thừa.

![Lesson breakfast illustration](evidence/lesson-breakfast.png)

## Áp dụng tiếp vào sản phẩm

Nếu triển khai từ kết quả này, thêm OpenRouter provider cho STT và TTS ở main process, pin model/voice đã test, bảo vệ key qua secure store, normalize output theo contract Enjoy và giữ DTW. Sau đó kiểm trên profile disposable bằng file mới: import audio/video, transcript, seek theo câu/từ, IPA, lưu/mở lại SQLite và phát TTS.

Pronunciation Assessment cần quyết định provider riêng. Không dùng WER, ASR confidence hoặc nhận xét LLM làm điểm Accuracy/Fluency/phoneme giả tương đương Azure. Các API nghiệp vụ còn phụ thuộc Enjoy phải được thay riêng theo local repository plan.
