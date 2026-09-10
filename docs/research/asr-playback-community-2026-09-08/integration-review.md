## Playback: cộng đồng đã có bản sửa sát hiện tượng

Enjoy cài WaveSurfer 7.9.1 và truyền native MediaElement. Source có `region.play()` và handler `region-out` gọi pause ngay. Ở phiên bản này, chỉ `region.play(true)` mới truyền điểm end cho bounded playback. Plugin phát event theo membership của `currentTime`, kể cả khi seek lúc paused. [Source 7.9.1](https://raw.githubusercontent.com/katspaugh/wavesurfer.js/7.9.1/src/plugins/regions.ts), [phân tích Luna](playback-luna.md).

Chuỗi issue [#3866](https://github.com/katspaugh/wavesurfer.js/issues/3866), [#3631](https://github.com/katspaugh/wavesurfer.js/issues/3631), [#3781](https://github.com/katspaugh/wavesurfer.js/issues/3781) báo Chrome phát `region-out` sớm với start dạng thập phân. PR [#4359](https://github.com/katspaugh/wavesurfer.js/pull/4359), merge 2026-09-03, sửa phép kiểm start bằng tolerance 50 ms. Agent chính đã đọc cả diff, xác nhận end không được nới. Cơ chế phù hợp với hiện tượng Enjoy, nhưng root cause tại runtime vẫn chưa được chứng minh.

Một bản sửa khác, [#4318](https://github.com/katspaugh/wavesurfer.js/pull/4318), có trong [7.12.8](https://github.com/katspaugh/wavesurfer.js/releases/tag/7.12.8), clamp thời gian về điểm stop sau khi timer đi quá end. Việc clamp vị trí hiển thị sau pause không chứng minh âm thanh chưa từng phát quá biên. Phải đo audio/time thực tế trong Chromium và các playback rate. Chưa xác nhận release ổn định chứa #4359; không đề xuất nâng lên một version đoán trước.

Hướng ưu tiên là trace đúng click câu #2: native time/paused/seeking/readyState; region ID và bounds; create/remove; `setTime`, `play`, `pause` kèm caller; `region-in/out` theo thứ tự. Đối chiếu race thay region sau debounce 100 ms với race rounding upstream. Sau đó mới chọn áp patch có phạm vi hẹp hoặc nâng dependency. Không sao chép toàn bộ PR đang gồm cả thay đổi Record/mobile khi chỉ cần sửa playback câu.

Tách bounded playback khỏi loop và kiểm active instance/region trước khi pause. Chạy câu #2, #3, start nhiều số lẻ, chuyển nhanh giữa câu, nhấn Play lặp, zoom, single/loop, 0.5x/1x/1.5x và recording player. Các case, trường trace và vị trí source đầy đủ có trong báo cáo Luna. Chưa sửa hoặc chạy playback mới trong lượt nghiên cứu này.

## Nghiệm thu đề xuất cho vòng triển khai tiếp theo

| Nhóm | Phép kiểm có thể phát hiện lỗi | Điều kiện đánh giá |
| --- | --- | --- |
| Đúng nội dung | Reference do người nghe xác nhận, đo substitution/deletion/insertion trên toàn file và từng vùng nối ±3 giây. | Không lấy timestamp cuối hoặc HTTP 200 làm pass; báo riêng từ mất, từ lặp, tên riêng. [JiWER](https://jitsi.github.io/jiwer/usage/). |
| Giữ audio | Manifest sample start/end, kiểm khoảng nguồn và sample coverage trước encode. | Không bỏ âm thanh vì VAD nếu chưa đo false negative; chunk là audio container hợp lệ. [FFmpeg](https://ffmpeg.org/ffmpeg-filters.html#atrim). |
| Ngữ cảnh | Cùng audio/model, A/B không prompt, glossary và context ngắn. | Ghi cả cải thiện và lỗi lặp lan từ chunk trước; không mặc định prompt luôn tốt. [Whisper](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/whisper/transcribe.py). |
| Timestamp | Kiểm bounds nguồn, offset, thứ tự, từ ở seam và nghe click từng câu. | Đo chữ đúng và thời gian đúng riêng; không dùng forced alignment để chứng minh ASR không mất chữ. [WhisperX](https://github.com/m-bain/whisperX/blob/2cfd7b7c5c7bba144954364db747319b50e8232b/README.md). |
| Điều phối | Response đảo thứ tự, retry, cancel rồi trả response trễ, resume khác options. | Manifest không trộn model/cấu hình; không append trùng; transcript live chỉ thay khi hoàn tất. Đây là tiêu chí thiết kế Enjoy, chưa chạy. |
| Playback | Native event trace và audio thật trong exact packaged build. | Click câu chạy xuyên vùng; không pause sớm; đúng single/loop, tốc độ và main/recording. [PR tham chiếu](https://github.com/katspaugh/wavesurfer.js/pull/4359). |

Audio 53:57 hiện chưa có reference toàn bộ đã được xác nhận, nên chưa thể báo WER cho file đó. Vòng benchmark cần reference trước khi kết luận provider nào chất lượng hơn. Trước mắt có thể dùng toàn bộ clip ngắn, các cửa sổ quanh seam, đầu/giữa/cuối của file dài để tìm failure; phải gọi rõ đó là đánh giá theo mẫu.

## Phương pháp, phản biện và giới hạn

Terra nhận ownership ASR và so sánh provider; Luna nhận WaveSurfer. Agent chính đọc artifact, đối chiếu source Enjoy và kiểm lại các nguồn quyết định: Cloudflare schema/tutorial/SDK, dự án turbo nguyên file, code ghép Whisper, vLLM, nghiên cứu WhisperX, API provider và diff WaveSurfer. Nghiên cứu ưu tiên primary source, source code pin commit, issue có reproduction và tài liệu API chính thức. Số URL không tương đương số bằng chứng độc lập; LICENSE được đếm riêng.

Các sửa sau phản biện đã được đưa vào kết luận: rút khẳng định chưa có chứng cứ về release whisper.cpp sửa issue 3683; không gọi 20 hoặc 30 giây là limit Cloudflare; không dùng midpoint đơn độc để dedup; không đồng nhất vùng tìm điểm cắt của vLLM với audio overlap; bổ sung phản chứng turbo nguyên file; tách lỗi player khỏi pipeline ASR mới. Report cộng đồng mất lyric là một reproduction, không phải tỷ lệ false negative của VAD nói chung.

Metadata ba bài nghiên cứu được đối chiếu arXiv; hai bài năm 2023 có publication khớp qua Crossref và publisher. Preprint tháng 8/2026 chưa có publication Crossref được xác nhận. Trường cập nhật trống không chứng minh đã kiểm toàn diện việc rút bài. Chi tiết nằm trong [academic-metadata-check.json](academic-metadata-check.json).

Độ tin cậy cao ở hợp đồng/source đã kiểm, trung bình ở mức phù hợp của giải pháp, chưa xác định ở chất lượng audio 53:57 và root cause runtime playback. Không có benchmark so sánh provider mới, chi phí đo thực tế hoặc chất lượng seam sau triển khai. Lượt này chỉ tạo tài liệu nghiên cứu.
