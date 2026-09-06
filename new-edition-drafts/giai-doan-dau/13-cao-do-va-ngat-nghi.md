# Cao độ và ngắt nghỉ

Học và luyện với lượng lớn là cách đáng tin nhất, nhưng không có nghĩa không coi trọng phương pháp hay chiến lược. Việc nào cũng cần thứ tự ưu tiên, vì vậy hãy chú ý điều quan trọng nhất trước.

Trong vài năm qua, tổng hợp giọng nói được AI hỗ trợ phát triển nhanh. TTS hiện nay hoàn thiện đến đáng kinh ngạc, như Microsoft Natural Sound hoặc Bark của Suno-AI. Đằng sau là mô hình [ToBI](https://en.wikipedia.org/wiki/ToBI), viết tắt của *Tones and Breaks Indices*. Ban đầu các nhà khoa học máy tính tạo nó để nghiên cứu cách khiến máy nói như người, hướng vào tiếng Anh Mỹ, rồi phát hiện có thể áp dụng cho nhiều ngôn ngữ, gồm tiếng Anh Anh, Nhật, Đức và Trung.

_Tones_, tức ngữ điệu, chủ yếu là biến đổi **cao độ** (*pitch*). Cao hạ dần là giọng xuống, thấp lên là giọng lên, hạ rồi lên là giọng xuống lên. _Breaks_ là **chỗ ngắt** trong câu. Thực ra giữa các âm tiết đều có thể có ngắt, chỉ khác độ dài. Ngữ điệu và ngắt, khi nói cũng như hát, tạo nên **nhịp điệu**.

Đọc câu tiếng Anh cần chú ý rất nhiều, nhưng như các nhà khoa học dùng ToBI mô phỏng giọng người, **chỉ ưu tiên ngắt và cao độ có thể tạo hiệu quả tốt hơn tương đối**.

> - Ngắt giữa các cụm ý, *breaks*.
> - Cao độ của âm tiết, *pitches*.

Thứ tự ưu tiên là **ngắt > cao độ**.

Điều này ngược cách dạy truyền thống. Trong lớp tiếng Anh, ta thường bắt đầu từ âm vị, phụ âm và nguyên âm, cố luyện từng âm thật chuẩn, rồi mới đến âm tiết và sau đó là ngữ điệu. Nhiều người bỏ giữa chừng mà chưa từng chú ý ngữ điệu. Ngắt gần như không được quan tâm. Người học được xem là cao cấp thường nghiên cứu nối âm, không phải ngắt.

Để hiểu vì sao **chỉ ưu tiên ngắt và cao độ đã có thể cải thiện lớn**, hãy xem một ví dụ về cơ chế não. Tôi từng thấy trên [Reddit](https://www.reddit.com/r/moviecritic/comments/195b90j/can_you_name_all_the_films_depicted_in_this/) một Infinite Zoom Art chứa nhiều áp phích phim. Video được đặt trong thư mục video: [infinite-zoom-art-movie-poster.mp4](vidio/infinite-zoom-art-movie-poster.mp4).

![](../images/posters.png)

Điều thú vị là vô số chi tiết bị bỏ qua. Các khuôn mặt trên áp phích trống, không có lông mày, mắt, mũi, miệng, nhưng nhìn qua bạn vẫn nhận ra họ vẽ gì. Khi nhận diện một vật, não không dựa vào mọi chi tiết mà dựa vào một số trọng điểm. Chỉ cần các trọng điểm tồn tại là nhận diện được. Nhiều chi tiết thiếu hoặc chưa chính xác không còn quan trọng.

Phần mềm có thể phân tích đường cao độ (*pitch contour*) trong một câu để ta thấy vị trí ngắt và quá trình đi từ thấp lên cao hoặc cao xuống thấp. Ví dụ:

> Yet, it is a fact of life that an unlettered peasant is considered ignorant.

<video src="../videos/yet-it-is-a-fact-of-life.mp4"></video>

> Video chụp màn hình dùng công cụ demo tôi tự viết tháng 10 năm 2003, [ToBI Player](https://github.com/xiaolai/tobiplayer). Hiện đã có ứng dụng hoàn chỉnh hơn là [Enjoy](https://github.com/zuodaotech/everyone-can-use-english/tags), dù khi nguồn viết còn là alpha và cần tiếp tục hoàn thiện.

Dạng sóng cho thấy ngắt lớn:

> Yet, | it is a fact of life | that an unlettered peasant is considered ignorant.

Khi nghe và xem lặp lại, ta tìm được gần như mọi chỗ ngắt. Ví dụ trong *that an unlettered peasant* có ngắt gây ngạc nhiên: *that an | unlettered peasant*. Giữa *an* và *unlettered* không có nối âm như nhiều người nghĩ, mà có ngắt.

Đường cao độ cũng trực quan. *Yet* lên giọng, *fact* đi lên, *life* đi xuống. Trong *unlettered peasant*, *un* lên nhẹ, *lettered* giữ ngang, rồi *pa* lên cao hơn trước khi xuống. Trong *is considered ignorant*, *con* hạ nhẹ còn *ig* được kéo cao rõ. Khi đã làm rõ các trọng điểm đó, có thể bắt đầu đọc theo.

Ban đầu nhiều âm vị sẽ chưa chuẩn, không sao. Các lỗi chi tiết có thể dần loại bằng học và luyện đủ, hoặc bằng cách kỹ hơn về sau. Không thể giải quyết mọi vấn đề ngay, nhưng ngắt và cao độ theo ToBI đơn giản, dễ hiểu, dễ luyện và rất hiệu quả.

**Não của phần lớn mọi người có giới hạn về âm thanh.** Ít nhất một nửa không thể bắt chước tốt giọng điệu người khác. Việc này cần đầu vào âm thanh mạnh, khả năng phân biệt, phân tích, nhớ và điều khiển giọng. Ngoài ra, nhiều người phân biệt cao độ kém. Bản thảo ước lượng tỷ lệ có thể không dưới bốn phần năm, dựa vào quan sát số người hát đủ hay.

Tôi biết rõ bản thân. Trí nhớ âm thanh ngắn và kém, phân biệt cao độ gần bằng không. Khi hát không có guitar hỗ trợ, tôi có thể lạc giọng xa và loạn nhịp. Không chỉ tiếng Anh khó, nói tiếng mẹ đẻ cũng không nhẹ nhàng. Tôi có hai tiếng mẹ đẻ, Trung và Triều Tiên, vì là người Triều Tiên sống trong môi trường song ngữ từ nhỏ. Tiếng Trung của tôi chỉ đủ đạt, giọng không đẹp và đôi lúc phát âm chưa rõ, kém xa phát thanh viên. Vì vậy tôi phải làm lại nhiều khi thu bài giảng.

Nhiều năm sau, khi về quê và nói tiếng Triều Tiên, người không biết tôi đôi khi nói: “Người Hán này nói tiếng Triều Tiên hay thật!”

<audio src="../audios/tieng-han-do-nguoi-trung-quoc-noi.mp3"></audio>

Nghĩa là tiếng Triều Tiên của tôi dù khá trôi chảy vẫn có giọng ngoại quốc trong tai họ. Đó từng là một tiếng mẹ đẻ của tôi, nhưng dùng ít lâu dài vẫn thoái lui. Tôi đã có ba lần mất khả năng nói tiếng Triều Tiên: không dùng hoàn toàn thời gian dài, đột nhiên không nói được, dù vẫn nghe hiểu.

**Tạo hình phát âm cần thời gian rất lâu**, lâu hơn nhiều lần so với tưởng tượng của phần lớn người học ngôn ngữ hai. Lý thuyết và phương pháp truyền thống quá nóng vội. Không ai vừa học phát âm đã chuẩn. Trẻ bập bẹ từ khoảng một tuổi, cần ít nhất hai năm rưỡi mới bắt đầu phát âm cơ bản rõ. Phần lớn người học tiếng Anh trong nhiều năm chưa từng đầu tư ít nhất một nghìn giờ chú ý trong một năm. Bản thân tôi cũng vậy.

Khi tự luyện, đừng mong có người đứng cạnh giám sát và tìm lỗi. Dù có, dịch vụ ấy sẽ cực đắt và tốn thời gian, phần lớn chúng ta không thể chi trả.

Phải đọc to, cố đọc to, với âm lượng như khi giáo viên gọi bạn đứng trước lớp đọc bài. Ít nhất phải bằng âm lượng nói bình thường. Giọng hơi nhỏ hoặc lẩm nhẩm đều giảm hiệu quả. **Phải đọc to, cố đọc to**, nhưng không cần hét và vẫn phải bảo vệ giọng.

Cần chọn tài liệu đọc theo. Trong nhiệm vụ khởi động, ta nói điều mình muốn nói rồi dùng TTS tạo giọng. Điều đó tốt. Nhưng sau một thời gian phải tăng phạm vi bắt chước, nên dùng giọng người thật thay TTS vì TTS dù giống người vẫn thiếu cảm xúc.

Con người luôn có cảm xúc khi nói, kể cả “không có cảm xúc” cũng là một cảm xúc. Vì thế, đoạn sách nói có thể là tài liệu đọc theo tốt hơn. Đoạn thoại phim có thể còn tốt hơn vì diễn xuất khiến cảm xúc đầy, thậm chí phóng đại. Tôi không nghĩ sự thú vị đặc biệt quan trọng, nhưng không được đọc theo khô khan. Hãy bắt chước cả điệu bộ và giọng, vì cuối cùng bạn phải nắm cách **nói tự nhiên như con người, dù bằng ngôn ngữ nào**.

Khi bắt đầu, đừng tham đoạn dài. Luyện ba giờ mà chỉ lặp hai hoặc ba câu vẫn được. Bắt đầu từ một phút vì phần lớn có thể khởi động ở độ dài đó, và đoạn ngắn giúp lặp đủ trong thời gian ngắn.

Các âm vị chi tiết chỉ nên tinh chỉnh sau một thời gian. Một đoạn nói thường chứa gần như mọi phụ âm và nguyên âm, một đoạn chưa đủ thì dùng vài đoạn. Mọi tinh chỉnh phải dựa trên lượng học và luyện đủ. Tinh chỉnh ngay từ đầu là tối ưu hóa quá sớm, thứ được gọi là gốc rễ của mọi điều xấu trong kỹ thuật.

::: info Ghi chú biên tập
ToBI, TTS, các nhận định về khả năng âm thanh, tỷ lệ hát hay, chi tiết Enjoy và những diễn giải trong bài là nội dung nguồn ở các thời điểm khác nhau. Không dùng chúng để đánh giá giá trị người có giọng địa phương, khó hát, suy giảm ngôn ngữ hoặc khuyết tật nghe nói. Với người học Việt Nam, hãy dùng âm lượng an toàn, nghỉ khi khàn hoặc đau và tìm chuyên gia phù hợp khi vấn đề giọng kéo dài.
:::
