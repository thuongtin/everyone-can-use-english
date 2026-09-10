# Nguyên tắc trình bày trang học từ vựng minh họa tự động

Ngày kiểm tra nguồn live: 2026-09-07, múi giờ Asia/Ho_Chi_Minh.

## Kết luận

Enjoy nên tự tạo một trang học giống một trang sách mindmap hoàn chỉnh: chủ đề ở điểm neo trung tâm, các nhánh phân cấp có màu ổn định, mỗi từ đi cùng IPA, nghĩa tiếng Việt và hình minh họa sát bên, còn ví dụ nằm trong ngữ cảnh của từng nhánh. Người học mở trang là có thể đọc ngay. Pan, zoom hoặc kéo node không được là công việc bắt buộc để sửa một bố cục chưa đạt.

Cấu trúc mindmap vẫn phù hợp với trải nghiệm người dùng đã xác nhận. Rủi ro cần xử lý nằm ở cách chọn từ trong từng nhánh. Nghiên cứu từ vựng L2 cho thấy việc dạy đồng thời nhiều từ mới là co-hyponym, synonym hoặc antonym rất gần nhau có thể gây nhầm trong cùng nhóm. Nghiên cứu này không chứng minh mọi semantic map đều có hại, cũng không phủ nhận giá trị của việc nhìn toàn cảnh hoặc ôn các từ đã quen. Cách áp dụng an toàn là:

- ưu tiên nhánh theo tình huống hoặc một micro-scene, chẳng hạn `At the airport` gồm `passport`, `queue`, `board`, `delayed`, thay vì gom toàn bộ từ mới cùng loại như một danh sách các phương tiện;
- vẫn cho phép nhóm gần nghĩa khi mục tiêu là so sánh có chủ đích hoặc khi phần lớn từ đã quen;
- nếu người dùng yêu cầu một tập semantic hẹp như màu sắc, động vật hoặc bộ phận cơ thể, chia từ mới thành nhiều lượt và dùng recall có trộn thứ tự, thay vì hiển thị một loạt từ mới cạnh tranh rồi coi việc xem trang là đã học xong.

Các paper ủng hộ mạnh việc đặt thông tin liên quan sát nhau và giảm thao tác tìm kiếm bằng mắt. Chúng không trực tiếp kiểm nghiệm đúng công thức `term + IPA + nghĩa tiếng Việt + một hình + ví dụ theo nhóm`. Công thức đó là suy luận thiết kế hợp lý cần được kiểm chứng bằng usability test và retention test trên chính người học Enjoy.

## Phạm vi áp dụng trong Enjoy

Đây là thay đổi cách trình bày và tạo mindmap, không phải đề xuất xây một LMS mới. Phạm vi thực dụng gồm ba phần:

1. Generator chọn nhánh và nội dung theo một hợp đồng có thể validate.
2. Layout engine tự dàn một trang dễ đọc và tự chia trang khi quá dày.
3. Trang có một lượt recall ngắn bằng cách che và mở đáp án từ chính nội dung đã tạo.

Schema hiện tại có `term`, `sense`, `definition`, `translationVi`, `partOfSpeech`, `example` và evidence, nhưng chưa có IPA, nhánh trình bày hoặc asset hình trên từng node. View hiện tại dùng card rộng 236 px, layout theo depth, cho kéo node và lưu tọa độ. Vì vậy hướng này cần một presentation contract rõ hơn, không chỉ đổi thuật toán xếp tọa độ. Graph và typed edges vẫn có thể là dữ liệu gốc; trang sách là một projection phân cấp, xác định từ dữ liệu đó.

## Bằng chứng và cách diễn giải

| Nguồn | Bằng chứng trực tiếp | Suy luận được phép dùng | Giới hạn cần giữ |
|---|---|---|---|
| [Moreno & Mayer, 1999, Journal of Educational Psychology](https://doi.org/10.1037/0022-0663.91.2.358) | Hai thí nghiệm với bài giải thích quá trình hình thành sét. Trong thí nghiệm 1, người học đạt kết quả tốt hơn khi text và hình liên quan ở gần nhau so với ở xa nhau. | Đặt term, IPA, nghĩa và hình tương ứng trong cùng một visual unit; không buộc mắt nối một danh sách từ ở một phía với gallery hình ở phía khác. | Đây là multimedia explanation về một quá trình khoa học, không phải học từ vựng L2 và không kiểm tra IPA hay nghĩa tiếng Việt. |
| [Chandler & Sweller, 1991, Cognition and Instruction](https://doi.org/10.1207/s1532690xci0804_2) | Sáu thí nghiệm với tài liệu kỹ thuật điện và sinh học. Tích hợp text và diagram giúp khi hai nguồn phải được ghép trong đầu để hiểu; không tốt hơn khi từng nguồn tự hiểu được. Thêm phần giải thích không thiết yếu còn có thể làm kết quả xấu đi. | Hình phải có nhiệm vụ làm rõ đúng sense; connector, badge và mô tả phụ chỉ xuất hiện khi giúp người học hiểu hoặc thao tác. | Không chứng minh rằng thêm hình luôn tốt, hoặc mọi node càng nhiều nội dung càng tốt. Tác động phụ thuộc nhu cầu tích hợp. |
| [Ginns, 2006, Learning and Instruction](https://doi.org/10.1016/j.learninstruc.2006.10.001) | Meta-analysis trên 50 nghiên cứu độc lập về spatial và temporal contiguity. Nhóm spatial contiguity có mean weighted effect `d = 0.72`, CI 95% `[0.61, 0.82]`; hiệu ứng lớn hơn với tài liệu có element interactivity cao (`d = 0.78`) so với thấp (`d = 0.28`, CI chứa 0). | Có cơ sở khá vững để auto-layout giảm split attention. Lợi ích dự kiến lớn nhất khi người học phải kết nối nhiều phần, chẳng hạn term, nghĩa, hình và câu dùng từ. | Đây là trung bình của nhiều domain và format. Không thể chuyển `d = 0.72` thành dự báo hiệu quả riêng cho trang từ vựng Enjoy. |
| [Karpicke & Roediger, 2008, Science](https://doi.org/10.1126/science.1152408) | Trong nhiệm vụ học từ vựng ngoại ngữ bằng các vòng study-test, tiếp tục test từ đã trả lời đúng tạo lợi ích lớn cho delayed recall, còn chỉ tiếp tục study từ đó không tạo lợi ích tương ứng. | Sau trang đọc nên có một lượt recall rất ngắn: che English term hoặc nghĩa, yêu cầu nhớ, rồi mới reveal. Đây có thể là cùng một view, không cần hệ thống khóa học mới. | Nghiên cứu kiểm tra retrieval schedule trong phòng thí nghiệm, không kiểm tra mindmap, hình minh họa hoặc UI cụ thể. |
| [Tinkham, 1997, Second Language Research](https://doi.org/10.1191/026765897672376469) | Các thí nghiệm so sánh semantic clustering và thematic clustering cho từ vựng L2 cho thấy semantic clustering cản trở, còn thematic clustering hỗ trợ việc học so với tập đối chứng tương ứng. | Nhánh ban đầu nên là scene, hành động, vai trò hoặc mục đích chung. Có thể giữ hình thức mindmap nhưng đổi logic nhóm từ mới từ taxonomic sang thematic. | Task dùng học cặp từ và đo số lượt tới criterion. Kết quả không cho biết một người dùng cụ thể sẽ phản ứng thế nào với trang sách có hình. |
| [Nakata & Suzuki, 2019, Studies in Second Language Acquisition](https://doi.org/10.1017/S0272263118000219) | 133 sinh viên Nhật học 48 cặp English-Japanese. Related và unrelated items không khác có ý nghĩa về tổng điểm immediate hoặc delayed posttest, nhưng related items gây nhiều lỗi nhầm trong cùng tập hơn khi học dồn. Spacing giảm lỗi nhầm của related items, dù lợi ích spacing về retention lại rõ hơn với unrelated items. | Không nên biến kết quả cũ thành lệnh cấm semantic grouping. Generator nên coi semantic similarity là một risk signal, theo dõi lỗi nhầm và dùng spacing hoặc tách lượt khi nhiều từ đều mới. | Chỉ dùng một kiểu posttest dịch L2 sang L1. Tác giả cũng nêu kết quả trước đó không nhất quán và nhiều nghiên cứu cũ chưa kiểm soát chặt độ khó item. |

## Trang học đề xuất

### 1. Cấu trúc thông tin

Một trang có ba tầng đọc rõ ràng:

1. **Topic anchor:** tên chủ đề, một câu định hướng ngắn và có thể có một hình tổng quan. Trên desktop, anchor có thể ở giữa. Trên màn hình hẹp, nó là phần đầu trang để không phải thu nhỏ toàn bộ canvas.
2. **Thematic branches:** mỗi nhánh là một tình huống, hành động, chức năng hoặc micro-scene. Mỗi nhánh có heading, một color token và một cặp câu ví dụ English-Vietnamese ngắn dùng tự nhiên hai hoặc ba target terms khi phù hợp.
3. **Lexical cards:** mỗi card có `term`, IPA, nghĩa tiếng Việt theo đúng sense, hình minh họa và từ loại khi cần. Definition tiếng Anh hoặc example riêng có thể mở khi focus để trang tổng quan không quá nặng chữ.

Màu dùng để nhận ra nhánh, không dùng làm dấu hiệu duy nhất. Heading, vị trí, connector và reading order phải truyền đạt cùng cấu trúc cho người không phân biệt được màu. Mỗi nhánh dùng một màu ổn định; các card con dùng tint nhẹ của màu đó thay vì nhiều mảng bão hòa cạnh tranh.

### 2. Vị trí chữ và hình

Mỗi lexical card là một unit không bị tách:

```text
┌──────── image ────────┐
│        passport       │
│       /ˈpɑːspɔːt/      │
│       hộ chiếu         │
└───────────────────────┘
```

Đây chỉ là wireframe thứ tự, không phải yêu cầu mọi card phải có hình nằm trên. Với card ngang, hình có thể ở trái và text ở phải. Quy tắc quan trọng là khoảng cách trong card ngắn hơn rõ rệt so với khoảng cách tới card khác, để phép ghép từ-hình không mơ hồ.

Hình cần bám đúng sense, không chỉ bám chuỗi ký tự. `bank` ở nghĩa ngân hàng và `bank` ở nghĩa bờ sông phải có visual brief khác nhau. Với từ trừu tượng, generator có thể dùng một micro-scene rõ nghĩa hoặc bỏ hình. Một icon trang trí chung chung dễ tăng nhiễu hơn là giúp học.

App nên compose chữ bằng UI trên asset hình, không yêu cầu model tạo cả trang sách dưới dạng một ảnh có chữ. Cách compose này giữ IPA và tiếng Việt chính xác, cho phép sửa nội dung, hỗ trợ screen reader và tránh lỗi chữ trong ảnh do model tạo. Đây là suy luận kỹ thuật từ yêu cầu dữ liệu có thể sửa, không phải kết quả trực tiếp của các paper trên.

### 3. Ví dụ theo nhóm

Mỗi nhánh có một micro-scene, một câu English ở mức CEFR đã chọn và một bản dịch tiếng Việt ngắn ngay bên dưới. Câu nhóm nên:

- dùng tự nhiên hai hoặc ba term trong nhánh, không nhồi toàn bộ target terms vào một câu;
- tô đậm target term bằng typography, còn màu chỉ lặp lại branch token;
- giữ đúng sense đã dùng cho hình và nghĩa tiếng Việt;
- cho phép mở example riêng của một card khi người học muốn xem thêm.

Ví dụ cho nhánh `Checking in`:

> I showed my **passport**, joined the **queue**, and waited for the desk to open.
>
> Tôi đưa **hộ chiếu**, xếp vào **hàng chờ** và đợi quầy mở cửa.

Cách này làm các từ có chung một tình huống nhưng không nhất thiết cạnh tranh như các nhãn cùng loại. Tác dụng của đúng format câu nhóm này vẫn là giả thuyết sản phẩm, chưa được sáu nguồn trực tiếp kiểm tra.

## Hợp đồng cho generator

Generator nên trả nội dung có cấu trúc trước, sau đó layout engine compose trang. Một contract tối thiểu có thể chứa:

```ts
type IllustratedVocabularyPage = {
  topic: {
    title: string;
    summary: string;
    overviewImageAssetId?: string;
  };
  branches: Array<{
    id: string;
    title: string;
    grouping: "thematic" | "semantic-contrast";
    colorToken: string;
    sceneExample: string;
    sceneExampleVi: string;
    items: Array<{
      term: string;
      ipa: string;
      translationVi: string;
      sense: string;
      partOfSpeech?: string;
      example?: string;
      imageAssetId?: string;
      imageAlt?: string;
      visualGrounding: "exact" | "contextual" | "none";
      familiarity: "new" | "familiar" | "unknown";
    }>;
  }>;
};
```

Các giá trị `familiarity` chỉ nên đến từ dữ liệu học local đã có. Nếu không có dữ liệu, dùng `unknown` và áp dụng chính sách thận trọng như với từ mới, không để model tự đoán lịch sử người học.

### Quy tắc chọn và nhóm từ

1. Chọn đúng level, sense và mục tiêu người học trước khi chọn hình hoặc layout.
2. Ưu tiên thematic branches. Mỗi branch cần diễn tả được bằng một micro-scene hoặc một mục đích chung.
3. Đánh dấu cặp có nguy cơ interference: co-hyponym cùng cấp, synonym rất gần, antonym dễ đảo và form gần giống.
4. Không đặt dày các cặp nguy cơ nếu cả hai có `familiarity = new | unknown`. Ngưỡng ban đầu có thể là tối đa hai từ cạnh tranh trong một branch, nhưng đây là heuristic cần A/B test, không phải con số từ paper.
5. Cho phép `semantic-contrast` khi brief yêu cầu phân biệt hoặc khi item đã quen. Card lúc đó phải làm nổi distinct cue, chẳng hạn context, collocation hoặc visual feature riêng.
6. Nếu chủ đề bắt buộc là một semantic set hẹp, tự chia thành nhiều page hoặc round; không yêu cầu người dùng tự kéo node ra xa để khắc phục.

### Quy tắc layout tự động

Layout phải deterministic với cùng content và viewport class. Quy trình đề xuất:

1. Chọn primary tree `topic -> branch -> lexical card`; giữ synonym, antonym, word-family và relation khác trong detail hoặc crosslink có kiểm soát.
2. Đo kích thước card từ nội dung thật, bao gồm font IPA và tiếng Việt, trước khi chốt tọa độ.
3. Dàn nhánh cân bằng quanh topic trên desktop; trên mobile, chuyển thành reading order dọc theo branch mà không thu nhỏ chữ.
4. Chạy collision check cho card, label, connector và hình.
5. Nếu scale cần nhỏ hơn ngưỡng đọc được, tự chia thành hai page theo branch. Không dùng `fitView` để biến một graph quá dày thành chữ rất nhỏ.
6. Cung cấp `Tự sắp xếp lại` để phục hồi layout chuẩn. Nếu vẫn giữ drag như một tùy chọn nâng cao, layout đã tạo phải đọc tốt trước khi có bất kỳ thao tác kéo nào.

Số nhánh và item mỗi nhánh nên bắt đầu bằng một budget sản phẩm, chẳng hạn 4 đến 6 nhánh và 3 đến 5 item mỗi nhánh, rồi điều chỉnh bằng test. Đây là giới hạn để bảo vệ readability và thời gian sinh asset, không phải giới hạn của trí nhớ được chứng minh từ các nguồn trên.

### Validator cần chặn

- Thiếu `term`, IPA hoặc `translationVi` trên target card.
- IPA không khớp sense hoặc dialect đã chọn khi có dictionary evidence.
- Hai card dùng cùng image asset nhưng diễn tả hai sense khác nhau.
- `visualGrounding = exact | contextual` nhưng thiếu `imageAlt` hoặc asset.
- Branch không có heading, cặp scene example English-Vietnamese hoặc reading order ổn định.
- Target term trong scene example không thuộc branch hoặc dùng sai sense.
- Các card hoặc connector chồng nhau sau layout.
- Text nhỏ hơn typography floor khi compose ở viewport mục tiêu.
- Một page vượt content budget mà không được split.
- Color token là dấu hiệu duy nhất để biết branch hoặc trạng thái.

## Một lượt recall nhỏ, không mở rộng thành LMS

Trang sách giúp encoding và tổ chức. Retrieval practice bổ sung bước nhớ lại mà việc chỉ nhìn trang không có. Có thể triển khai ngay trong page bằng hai nút:

- `Nhớ từ`: giữ hình và nghĩa tiếng Việt, che English term cùng IPA, người học nghĩ hoặc nói đáp án rồi tap để mở.
- `Nhớ nghĩa`: giữ English term cùng IPA, che nghĩa và example, rồi tap để mở.

Thứ tự recall nên được trộn qua các branch để giảm việc đoán từ dựa trên danh sách cạnh bên. Sau reveal, hiển thị lại card đúng vị trí để người học nối đáp án với cấu trúc trang. Hệ thống chỉ cần lưu kết quả tối thiểu nếu sản phẩm đã có practice history; tài liệu này không đề xuất streak, course graph, teacher dashboard hoặc một subsystem LMS mới.

## Cách xử lý semantic clustering mà vẫn giữ trải nghiệm sách

Không nên dùng một quy tắc tuyệt đối như “không bao giờ đặt từ gần nghĩa cạnh nhau”. Có ba trường hợp khác nhau:

| Trường hợp | Cách trình bày |
|---|---|
| Học lần đầu nhiều từ mới | Nhóm theo tình huống, trộn part of speech và vai trò trong scene, hạn chế competitor gần nghĩa. |
| Ôn một chủ đề đã quen | Giữ semantic overview để củng cố cấu trúc và giúp tra cứu nhanh. |
| Học phân biệt từ dễ nhầm | Dùng branch `semantic-contrast`, đặt cạnh nhau có chủ đích, thêm distinct cue, collocation, hình hoặc example đối chiếu, sau đó test từng từ theo thứ tự trộn. |

Thiết kế này giữ ưu điểm người dùng cảm nhận ở sách mindmap: trang có cấu trúc, hình dễ nhớ, màu làm mốc và không phải tự dàn canvas. Đồng thời nó giảm một rủi ro đã có bằng chứng: nhiều nhãn mới gần nghĩa cạnh tranh trong cùng lượt encoding và retrieval.

## Nghiệm thu nên đo

### UI và generation

- 100% trang test mở ra không cần kéo node để đọc được mọi card.
- Không có overlap ở các viewport mục tiêu; khi quá budget, page tự split.
- Mỗi target card giữ term, IPA, nghĩa và hình trong cùng unit; sense, gloss, hình và example nhất quán.
- Keyboard và screen reader đi theo thứ tự `topic -> branch -> item`, độc lập với vị trí hình học.
- Tắt màu hoặc dùng mô phỏng color-vision deficiency vẫn nhận ra được branch.

### Học tập

Với cùng target set, so sánh prototype tự dàn với view hiện tại trên ba phép đo riêng:

1. Thời gian tìm đúng hình hoặc nghĩa của một term.
2. Delayed recall sau khoảng thời gian định trước, không chỉ immediate preference.
3. Tỷ lệ within-set error, đặc biệt với các từ gần nghĩa.

Ngoài ra ghi nhận subjective ease và preference. Trải nghiệm “tôi học tốt với kiểu sách này” là bằng chứng quan trọng cho product fit, nhưng không thay thế delayed recall; delayed recall cũng không thay thế preference và khả năng người dùng muốn quay lại học.

## Khoảng trống bằng chứng

- Chưa có nguồn nào trong tập này kiểm tra đúng người học tiếng Anh nói tiếng Việt, font IPA, Vietnamese gloss và hình AI trên cùng một mindmap page.
- Spatial contiguity có bằng chứng tốt, nhưng phần lớn nghiên cứu dùng diagram hoặc animation giải thích quan hệ phức tạp. Hiệu ứng có thể nhỏ hơn với một từ concrete đơn giản.
- Chưa có bằng chứng trực tiếp cho số branch, số item, vị trí topic ở chính giữa, hệ màu hoặc radial layout đề xuất. Đây là quyết định UI cần prototype và test.
- Bằng chứng semantic clustering không hoàn toàn nhất quán. Nghiên cứu 2019 không thấy khác biệt tổng điểm retention theo relatedness, dù thấy nhiều lỗi nhầm trong cùng nhóm. Vì vậy nên dùng risk-based generation và đo lỗi, không dùng validator cấm mọi semantic group.
- Chưa biết hình AI exact hoặc contextual tốt hơn cho từng loại từ. Abstract words, polysemy, phrasal verbs và collocations cần bộ test riêng.
- Chưa kiểm tác động của việc đặt một group example so với example riêng trên từng card.
- Chưa đo khả năng đọc trang đã auto-layout trong packaged Electron, ở light/dark mode, màn hình nhỏ, touch, zoom hệ điều hành hoặc với screen reader.

## Sáu nguồn chính

1. Moreno, R., & Mayer, R. E. (1999). [Cognitive principles of multimedia learning: The role of modality and contiguity](https://doi.org/10.1037/0022-0663.91.2.358). *Journal of Educational Psychology, 91*(2), 358-368.
2. Chandler, P., & Sweller, J. (1991). [Cognitive load theory and the format of instruction](https://doi.org/10.1207/s1532690xci0804_2). *Cognition and Instruction, 8*(4), 293-332.
3. Ginns, P. (2006). [Integrating information: A meta-analysis of the spatial contiguity and temporal contiguity effects](https://doi.org/10.1016/j.learninstruc.2006.10.001). *Learning and Instruction, 16*(6), 511-525.
4. Karpicke, J. D., & Roediger, H. L. III. (2008). [The critical importance of retrieval for learning](https://doi.org/10.1126/science.1152408). *Science, 319*(5865), 966-968.
5. Tinkham, T. (1997). [The effects of semantic and thematic clustering on the learning of second language vocabulary](https://doi.org/10.1191/026765897672376469). *Second Language Research, 13*(2), 138-163.
6. Nakata, T., & Suzuki, Y. (2019). [Effects of massing and spacing on the learning of semantically related and unrelated words](https://doi.org/10.1017/S0272263118000219). *Studies in Second Language Acquisition, 41*(2), 287-311.
