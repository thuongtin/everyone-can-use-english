# Speech contracts cần giữ khi bỏ Enjoy API

Ngày rà soát: 08/09/2026. Bổ sung runtime cùng ngày: [kiểm thử live](2026-09-08-live-tests.md). JSON minh họa ở tài liệu này vẫn được ghi rõ là synthetic.

## Kết luận kỹ thuật

Có thể bỏ Enjoy API khỏi transcription nếu giữ nguyên contract nội bộ `transcript + nested timeline` và tiếp tục dùng Echogarden để align. Đường local Echogarden và đường OpenAI BYOK đã tồn tại. Azure Speech-to-Text, Azure Pronunciation Assessment và Azure TTS hiện chưa phải BYOK trực tiếp: cả ba vẫn phụ thuộc token ngắn hạn lấy từ `/api/speech/tokens` của Enjoy.

Blocker lớn nhất không phải gọi ASR, mà là giữ đủ dữ liệu thời gian và phát âm cho UI:

1. UI media đọc sentence timeline và `word > token`. Khi token có phone children, UI dùng chúng để dựng IPA; nếu thiếu thì fallback sang `token.text`. Output DTW đã kiểm có `word > token > phone`. `subphone` là loại optional, không phải node bắt buộc của consumer đã kiểm. Azure STT hiện chỉ cung cấp segment seed; app dùng Echogarden DTW để dựng lại cấu trúc sâu trước khi ghi DB.
2. Pronunciation Assessment cần score tổng, score theo word, `ErrorType`, offset/duration 100 ns và phoneme IPA. Thay Azure bằng ASR thường sẽ không đáp ứng contract này.
3. TTS chỉ cần audio để các màn hình hiện tại chạy. Không có speech marks trong contract đang lưu. Mọi provider mới phải trả đúng MIME và bytes, thay vì gắn nhãn MP3 cố định.
4. Local account mode đang bật toàn cục, nhưng default STT vẫn là Enjoy Azure. Một profile mới có thể vào ngay một lựa chọn cần remote token mà không có credential phù hợp.

## Quy ước mức bằng chứng

- **Declared in code**: hành vi hoặc shape được khai báo trực tiếp trong source hiện tại.
- **Declared upstream**: capability được tài liệu chính chủ ghi nhận trong [danh mục nguồn](2026-09-08-sources.md:1).
- **Inferred**: kết luận suy ra từ nhiều đoạn code, chưa có runtime capture chứng minh.
- **Unknown**: source không đủ để kết luận.
- **Live chưa gọi**: rà soát này không gọi Azure, OpenAI, Cloudflare hay Enjoy API và không dùng credential riêng. JSON bên dưới đều synthetic. Lượt kiểm thử live bổ sung dùng OpenRouter và local Echogarden được lưu riêng, không thay nguồn gốc của các ví dụ này.

## Contract timeline nội bộ

Echogarden khai báo một `TimelineEntry` gồm `type`, `text`, `startTime`, `endTime`, các offset text tùy chọn, `confidence` tùy chọn và `timeline` con tùy chọn. Các loại có thể là `segment`, `paragraph`, `sentence`, `clause`, `phrase`, `word`, `token`, `letter`, `phone`, `subphone` ([Timeline.d.ts:10-24](../../../enjoy/node_modules/echogarden/dist/utilities/Timeline.d.ts:10)).

Hình dạng DTW đã kiểm mà UI có thể dùng là (phone children optional đối với consumer, fallback đọc `token.text`):

```text
Transcription.result
  transcript: string
  timeline: sentence[]
    sentence: { text, startTime, endTime, timeline: word[] }
      word: { text, startTime, endTime, timeline: token[] }
        token: { text: IPA, startTime, endTime, timeline: phone[] }
          phone: { text: IPA, startTime, endTime, timeline?: TimelineEntry[] }
  originalText?: string
  tokenId?: number | string
```

**Consumer không đồng nhất:** phần hiển thị caption có fallback `token.text` khi thiếu phone children, nhưng thao tác Copy IPA gọi `token.timeline.map(...)` không có guard tại [media-caption-actions.tsx:219-223](../../../enjoy/src/renderer/components/medias/media-right-panel/media-caption-actions.tsx:219). Raw Whisper token đã test không có `timeline`; không đưa thẳng output đó vào toàn bộ UI rồi kết luận tương thích. DTW cung cấp array phone cần cho nhánh này; adapter cũng phải validate shape.

`startTime` và `endTime` trong timeline nội bộ là giây. Azure raw dùng tick 100 ns rồi code chia `10_000_000` khi tạo segment ([use-transcribe.tsx:482-490](../../../enjoy/src/renderer/hooks/use-transcribe.tsx:482)).

## Transcription từ form tới UI

### 1. Input và lựa chọn provider

Form nhận `language`, `service`, `text` tùy chọn và `isolate` tùy chọn. `service` gồm local, Enjoy Azure, Enjoy Cloudflare, OpenAI hoặc upload transcript ([transcription-create-form.tsx:39-44](../../../enjoy/src/renderer/components/transcriptions/transcription-create-form.tsx:39), [transcription-create-form.tsx:171-184](../../../enjoy/src/renderer/components/transcriptions/transcription-create-form.tsx:171)). Giá trị ban đầu dùng `sttEngine`, trừ khi đã có original text thì ép sang upload ([transcription-create-form.tsx:67-74](../../../enjoy/src/renderer/components/transcriptions/transcription-create-form.tsx:67)).

File transcript hỗ trợ TXT, SRT và VTT. Form parse cue, chuẩn hóa timestamp về SRT text, xóa nội dung trong ngoặc tròn rồi chuyển `text` cho hook cha ([transcription-create-form.tsx:89-131](../../../enjoy/src/renderer/components/transcriptions/transcription-create-form.tsx:89), [transcription-create-form.tsx:268-303](../../../enjoy/src/renderer/components/transcriptions/transcription-create-form.tsx:268)). Form được nối tới `generateTranscription` với đủ `text`, `language`, `service`, `isolate` tại [media-loading-modal.tsx:63-77](../../../enjoy/src/renderer/components/medias/media-loading-modal.tsx:63).

### 2. Audio preprocessing

Mọi đường audio đi qua `transcode(mediaSrc)` trước khi chọn provider. Blob đầu vào được ghi vào cache; sau đó Echogarden giải mã và tạo WAV 16 kHz trong cache ([use-transcribe.tsx:42-51](../../../enjoy/src/renderer/hooks/use-transcribe.tsx:42), [echogarden.ts:199-217](../../../enjoy/src/main/echogarden.ts:199)). Hook fetch lại URL WAV thành `Blob` để gửi provider hoặc align local ([use-transcribe.tsx:74-85](../../../enjoy/src/renderer/hooks/use-transcribe.tsx:74)).

`isolate` không tác động request STT. Nó chỉ được chuyển cho Echogarden ở bước align DTW ([use-transcribe.tsx:123-137](../../../enjoy/src/renderer/hooks/use-transcribe.tsx:123)).

### 3. Azure AI qua Enjoy

**Token request, declared in code.** Client gọi `POST /api/speech/tokens` với JSON snake_case và kỳ vọng `{ id, token, region }` ([client.ts:317-324](../../../enjoy/src/api/client.ts:317)). Transcription gửi:

```json
{
  "purpose": "transcribe",
  "target_id": "<media UUID>",
  "target_type": "Audio hoặc Video"
}
```

Đây là JSON synthetic dựa trên params code, không phải request đã capture. Hook Azure dùng `webApi.generateSpeechToken`, tức bearer của `webApi` là `user.accessToken`, không phải EnjoyAI API key riêng ([use-transcribe.tsx:402-420](../../../enjoy/src/renderer/hooks/use-transcribe.tsx:402), [app-settings-provider.tsx:339-356](../../../enjoy/src/renderer/context/app-settings-provider.tsx:339)).

**Azure SDK input, declared in code.** App tạo `SpeechConfig.fromAuthorizationToken(token, region)`, `AudioConfig.fromWavFileInput(file)`, đặt recognition language, yêu cầu word timestamps, `Detailed` output và profanity raw ([use-transcribe.tsx:420-429](../../../enjoy/src/renderer/hooks/use-transcribe.tsx:420)).

Audio WAV được đưa thẳng cho Azure Speech SDK trong renderer. Source không POST audio lên `/api/transcriptions`; endpoint đó chỉ dùng để đọc hoặc sync transcription record. URL transport Azure cụ thể do SDK suy ra từ `region`, không được khai báo trong repo nên là **unknown**. Đây là direct SDK data path sau bước broker token, không phải direct Azure BYOK.

**Raw response shape, declared by local type and parser.** Mỗi event `recognized` đọc `SpeechServiceResponse_JsonResult` rồi `JSON.parse` ([use-transcribe.tsx:441-447](../../../enjoy/src/renderer/hooks/use-transcribe.tsx:441)). Type local khai báo:

- top level: `Id`, `RecognitionStatus`, `Offset`, `Duration`, `Channel`, `DisplayText`, `NBest`;
- mỗi `NBest`: `Confidence`, `Lexical`, `ITN`, `MaskedITN`, `Display`, `Words`;
- mỗi word: `Word`, `Offset`, `Duration` ([pronunciation-assessment.d.ts:70-89](../../../enjoy/src/types/pronunciation-assessment.d.ts:70)).

Ví dụ synthetic:

```json
{
  "Id": "synthetic-result-1",
  "RecognitionStatus": "Success",
  "Offset": 5000000,
  "Duration": 12500000,
  "Channel": 0,
  "DisplayText": "Hello world.",
  "NBest": [
    {
      "Confidence": 0.91,
      "Lexical": "hello world",
      "ITN": "hello world",
      "MaskedITN": "hello world",
      "Display": "Hello world.",
      "Words": [
        { "Word": "Hello", "Offset": 5000000, "Duration": 5000000 },
        { "Word": "world", "Offset": 10500000, "Duration": 7000000 }
      ]
    }
  ]
}
```

**Normalization.** Transcript nối `DisplayText` của mọi result. Với mỗi result, code lấy một candidate từ `NBest`, bỏ result không có words hoặc confidence dưới 0.5, rồi tạo segment từ word đầu và word cuối ([use-transcribe.tsx:470-497](../../../enjoy/src/renderer/hooks/use-transcribe.tsx:470)). Raw word list không được giữ vào DB. Code dùng `sortedUniqBy` nhưng không tự sort theo confidence, nên đang phụ thuộc thứ tự `NBest` từ Azure. Adapter mới nên chọn max confidence tường minh.

**Token lifecycle.** Azure transcription trả `tokenId` để ghi vào transcription, nhưng source không gọi `consumeSpeechToken` hoặc `revokeSpeechToken` trong hook này ([use-transcribe.tsx:507-513](../../../enjoy/src/renderer/hooks/use-transcribe.tsx:507)). Server có tự chuyển state hay không là **unknown**. Replacement không nên sao chép sự mơ hồ này: direct BYOK không cần ledger token; broker mode phải định nghĩa acquire, consume và revoke rõ ràng.

### 4. Local Echogarden, gồm whisper.cpp

Local gọi `EnjoyApp.echogarden.recognize(url, { language, ...echogardenSttConfig })`. Nó trả `RecognitionResult.transcript` và `RecognitionResult.timeline`, sau đó được đổi tên thành `segmentTimeline` ([use-transcribe.tsx:245-283](../../../enjoy/src/renderer/hooks/use-transcribe.tsx:245)). Config UI hỗ trợ engine `whisper` và `whisper.cpp`; model được lấy từ nhánh config tương ứng ([use-transcribe.tsx:261-270](../../../enjoy/src/renderer/hooks/use-transcribe.tsx:261)).

Config bootstrap mới mặc định `engine: "whisper"`, model từ `tiny` đến `large-v3-turbo`, ưu tiên biến thể `.en` cho English ở một số kích thước ([ai-settings-provider.tsx:405-447](../../../enjoy/src/renderer/context/ai-settings-provider.tsx:405)). whisper.cpp có word timestamps nhưng upstream ghi experimental ([sources.md:14](2026-09-08-sources.md:14)). Vì Enjoy vẫn chạy DTW alignment sau recognition, replacement không nên coi raw whisper.cpp word timestamps là contract duy nhất.

### 5. OpenAI BYOK trực tiếp

App dùng key và `baseUrl` trong cấu hình OpenAI, tạo browser client và tắt retry ([use-transcribe.tsx:286-311](../../../enjoy/src/renderer/hooks/use-transcribe.tsx:286)). Request chuẩn hóa thành:

```json
{
  "file": "<audio.mp3 File>",
  "model": "whisper-1 hoặc gpt-transcribe",
  "response_format": "verbose_json",
  "timestamp_granularities": ["word", "segment"],
  "language": "en"
}
```

Đây là JSON synthetic. Contract builder ở [speech-models.ts:47-53](../../../enjoy/src/lib/speech-models.ts:47) và [speech-models.ts:279-291](../../../enjoy/src/lib/speech-models.ts:279). Normalizer chỉ nhận text không rỗng, lọc segment/word có timing số hợp lệ, rồi trả `{ transcript, segments, words? }` ([speech-models.ts:294-336](../../../enjoy/src/lib/speech-models.ts:294)). Hook tiếp tục đổi segment thành `segmentTimeline`; mảng `words` có trả ra nhưng luồng DB không destructure hoặc lưu nó ([use-transcribe.tsx:316-342](../../../enjoy/src/renderer/hooks/use-transcribe.tsx:316), [use-transcriptions.tsx:140-176](../../../enjoy/src/renderer/hooks/use-transcriptions.tsx:140)).

Endpoint logical là OpenAI-compatible `audio/transcriptions`, vì code gọi `client.audio.transcriptions.create`; URL thật là `openai.baseUrl` hoặc default của SDK ([use-transcribe.tsx:306-323](../../../enjoy/src/renderer/hooks/use-transcribe.tsx:306)).

Có mâu thuẫn tài liệu cần chặn bằng test model-specific: guide OpenAI nói `timestamp_granularities[]` chỉ hỗ trợ `whisper-1`, trong khi API reference liệt kê `gpt-transcribe` và mô tả generic không đủ chứng minh model này trả word timestamps ([sources.md:12-13](2026-09-08-sources.md:12)). Vì vậy `gpt-transcribe` hiện **declared by app, upstream capability unknown** đối với word/segment timestamps. Không được xem request mock thành bằng chứng runtime.

### 6. Enjoy Cloudflare và upload transcript

Cloudflare gửi blob tới `${AI_WORKER_ENDPOINT}/audio/transcriptions` với bearer `user.accessToken`; shape local kỳ vọng `text`, `vtt`, `words_count`, `words[]` ([use-transcribe.tsx:352-396](../../../enjoy/src/renderer/hooks/use-transcribe.tsx:352), [index.d.ts:111-120](../../../enjoy/src/types/index.d.ts:111)). Nếu có VTT, code đổi cue thành segment. Đây vẫn là phụ thuộc Enjoy auth và hạ tầng, không phải replacement độc lập.

Upload SRT giữ cue timestamp làm segment. Plain text được bỏ markup và có thể gọi AI để thêm dấu câu, rồi để Echogarden align toàn transcript ([use-transcribe.tsx:179-241](../../../enjoy/src/renderer/hooks/use-transcribe.tsx:179)).

### 7. Alignment chung

Nếu provider trả segment timeline, app gọi `alignSegments` với audio bytes, engine DTW, language ngắn và `isolate`; sau đó `wordToSentenceTimeline` chia thành sentence theo transcript ([use-transcribe.tsx:123-144](../../../enjoy/src/renderer/hooks/use-transcribe.tsx:123)). Nếu chỉ có transcript, app gọi `align` toàn văn rồi flatten các entry không phải sentence ([use-transcribe.tsx:145-173](../../../enjoy/src/renderer/hooks/use-transcribe.tsx:145)).

Điều này dẫn tới contract migration:

- provider chỉ bắt buộc trả `text`;
- segment timing tốt giúp DTW có seed và giảm phạm vi align;
- word timing của provider là dữ liệu tham khảo, vì source hiện không lưu nó;
- output bắt buộc cuối cùng là nested Echogarden timeline theo giây.

### 8. Preprocess, DB và UI

Trước khi ghi DB, `preProcessTranscription` nối các sentence chưa kết thúc, xử lý token nối bằng dấu gạch ngang và phần trăm, đồng thời điều chỉnh word timeline ([use-transcriptions.tsx:185-258](../../../enjoy/src/renderer/hooks/use-transcriptions.tsx:185)). Sau đó app ghi `state`, `timeline`, `transcript`, `originalText`, `tokenId`, `engine`, `model`, `language` vào local `Transcription` ([use-transcriptions.tsx:152-176](../../../enjoy/src/renderer/hooks/use-transcriptions.tsx:152)). Model Sequelize lưu `result` bằng JSON và chỉ sync remote khi không ở local mode ([transcription.ts:49-63](../../../enjoy/src/main/db/models/transcription.ts:49), [transcription.ts:86-99](../../../enjoy/src/main/db/models/transcription.ts:86)).

Ví dụ DB JSON synthetic:

```json
{
  "transcript": "Hello world.",
  "timeline": [
    {
      "type": "sentence",
      "text": "Hello world.",
      "startTime": 0.5,
      "endTime": 1.75,
      "timeline": [
        {
          "type": "word",
          "text": "Hello",
          "startTime": 0.5,
          "endTime": 1.0,
          "timeline": [
            {
              "type": "token", "text": "həloʊ", "startTime": 0.5, "endTime": 1.0,
              "timeline": [
                { "type": "phone", "text": "h", "startTime": 0.5, "endTime": 0.62 },
                { "type": "phone", "text": "ə", "startTime": 0.62, "endTime": 0.7 },
                { "type": "phone", "text": "l", "startTime": 0.7, "endTime": 0.8 },
                { "type": "phone", "text": "oʊ", "startTime": 0.8, "endTime": 1.0 }
              ]
            }
          ]
        },
        {
          "type": "word",
          "text": "world",
          "startTime": 1.05,
          "endTime": 1.75,
          "timeline": []
        }
      ]
    }
  ],
  "originalText": null,
  "tokenId": 12345
}
```

UI danh sách sentence seek player theo `sentence.startTime` và hiển thị timestamp theo giây ([media-transcription.tsx:135-179](../../../enjoy/src/renderer/components/medias/media-left-panel/media-transcription.tsx:135)). UI caption tìm active word bằng `word.startTime <= currentTime < word.endTime` ([media-right-panel.tsx:77-88](../../../enjoy/src/renderer/components/medias/media-right-panel/media-right-panel.tsx:77)). IPA caption không đến từ Azure STT raw; nó được dựng từ các timeline con của word và mapping bundled ([media-caption.tsx:38-58](../../../enjoy/src/renderer/components/medias/media-right-panel/media-caption.tsx:38)). Vì vậy dictionary IPA là phần trình bày của aligned phone timeline, tách khỏi Pronunciation Assessment IPA.

## Pronunciation Assessment

### Input, token và SDK

User có thể record hoặc upload audio, chọn language và nhập `referenceText`. Blob được lưu thành local `Recording` trước khi assessment ([pronunciation-assessment-form.tsx:43-48](../../../enjoy/src/renderer/components/pronunciation-assessments/pronunciation-assessment-form.tsx:43), [pronunciation-assessment-form.tsx:91-143](../../../enjoy/src/renderer/components/pronunciation-assessments/pronunciation-assessment-form.tsx:91)). Hook transcode recording thành WAV, rồi xin token:

```json
{
  "purpose": "pronunciation_assessment",
  "target_id": "<recording UUID>",
  "target_type": "Recording"
}
```

JSON này là synthetic. Khác Azure transcription, hook này tự tạo `Client` với bearer là EnjoyAI API key ([use-pronunciation-assessments.tsx:31-69](../../../enjoy/src/renderer/hooks/use-pronunciation-assessments.tsx:31)).

SDK được cấu hình bằng reference text, thang 100, granularity phoneme, `enableMiscue: true`, `phonemeAlphabet = "IPA"` và recognition language ([use-pronunciation-assessments.tsx:122-153](../../../enjoy/src/renderer/hooks/use-pronunciation-assessments.tsx:122)). Recording dưới 30 giây dùng `recognizeOnceAsync`; từ 30 giây trở lên dùng continuous recognition và tự merge phrase results ([use-pronunciation-assessments.tsx:74-94](../../../enjoy/src/renderer/hooks/use-pronunciation-assessments.tsx:74), [use-pronunciation-assessments.tsx:192-223](../../../enjoy/src/renderer/hooks/use-pronunciation-assessments.tsx:192)). Tài liệu upstream cũng mô tả reference text, score nhiều cấp, prosody en-US và continuous mode cho audio dài ([sources.md:10](2026-09-08-sources.md:10)).

### Result fields phải giữ

App cần các field sau từ `PronunciationAssessmentResult` và `detailResult`:

- top-level scalar: `pronunciationScore`, `accuracyScore`, `completenessScore`, `fluencyScore`, `prosodyScore`;
- optional content scores: `grammarScore`, `vocabularyScore`, `topicScore`;
- detail text: `Confidence`, `Display`, `ITN`, `Lexical`, `MaskedITN`;
- detail assessment: `PronunciationAssessment.AccuracyScore`, `CompletenessScore`, `FluencyScore`, `ProsodyScore`, `PronScore`;
- `Words[]`: `Word`, `Offset`, `Duration`, `PronunciationAssessment.AccuracyScore`, `ErrorType`;
- mỗi word có `Phonemes[]`: `Phoneme`, `Offset`, `Duration`, `PronunciationAssessment.AccuracyScore`;
- mỗi word có `Syllables[]` theo contract Azure cần normalize, gồm text syllable, offset, duration và accuracy score.

Source type thể hiện word, phoneme và syllable fields ở [pronunciation-assessment.d.ts:37-68](../../../enjoy/src/types/pronunciation-assessment.d.ts:37). Có hai điểm type debt:

1. Type dùng `markedItn`, trong khi merge code đọc `MaskedITN`; sau `camelcaseKeys` runtime field sẽ là `maskedItn` ([pronunciation-assessment.d.ts:15-28](../../../enjoy/src/types/pronunciation-assessment.d.ts:15), [use-pronunciation-assessments.tsx:300-307](../../../enjoy/src/renderer/hooks/use-pronunciation-assessments.tsx:300)).
2. Type hiện khai báo `syllables` là một object, không phải array, và UI hiện không đọc syllable. Shape live của SDK chưa được capture trong lượt này. Adapter mới phải fixture theo response thật rồi normalize thành mảng ổn định.

Ví dụ JSON synthetic cho canonical result, dựa trên field code đang đọc:

```json
{
  "confidence": 0.93,
  "display": "Hello.",
  "itn": "hello",
  "lexical": "hello",
  "maskedItn": "hello",
  "pronunciationAssessment": {
    "accuracyScore": 88,
    "completenessScore": 100,
    "fluencyScore": 84,
    "prosodyScore": 81,
    "pronScore": 86
  },
  "words": [
    {
      "word": "Hello",
      "offset": 5000000,
      "duration": 6000000,
      "pronunciationAssessment": { "accuracyScore": 88, "errorType": "None" },
      "phonemes": [
        {
          "phoneme": "h",
          "offset": 5000000,
          "duration": 1000000,
          "pronunciationAssessment": { "accuracyScore": 92 }
        }
      ],
      "syllables": [
        {
          "syllable": "hɛˈloʊ",
          "offset": 5000000,
          "duration": 6000000,
          "pronunciationAssessment": { "accuracyScore": 88 }
        }
      ]
    }
  ],
  "tokenId": 12345,
  "duration": 1800
}
```

### Merge, normalize, DB và UI

Continuous mode nối `Display`, `ITN`, `Lexical`, `MaskedITN`, cộng `Words`, rồi lấy trung bình các score ở cấp phrase ([use-pronunciation-assessments.tsx:295-348](../../../enjoy/src/renderer/hooks/use-pronunciation-assessments.tsx:295), [use-pronunciation-assessments.tsx:350-387](../../../enjoy/src/renderer/hooks/use-pronunciation-assessments.tsx:350)). Các score sau `.toFixed(2)` trở thành string trong object merged dù type và cột DB mô tả number. Adapter mới nên trả number nhất quán.

Trước khi ghi DB, app serialize `detailResult`, camel-case sâu, thêm `tokenId` và recording duration. DB lưu cả scalar score và JSON result ([use-pronunciation-assessments.tsx:96-119](../../../enjoy/src/renderer/hooks/use-pronunciation-assessments.tsx:96), [pronunciation-assessment.ts:66-92](../../../enjoy/src/main/db/models/pronunciation-assessment.ts:66)). Local mode chặn remote sync ở model ([pronunciation-assessment.ts:102-113](../../../enjoy/src/main/db/models/pronunciation-assessment.ts:102)). Hook không consume hoặc revoke token assessment, nên server lifecycle là **unknown**.

UI full-text dùng `result.words`, highlight word theo offset/duration 100 ns và cho phát đúng đoạn recording ([recording-detail.tsx:73-79](../../../enjoy/src/renderer/components/recordings/recording-detail.tsx:73), [pronunciation-assessment-word-result.tsx:79-100](../../../enjoy/src/renderer/components/pronunciation-assessments/pronunciation-assessment-word-result.tsx:79)). Nó hiện phoneme IPA và accuracy từng phoneme ([pronunciation-assessment-word-result.tsx:116-140](../../../enjoy/src/renderer/components/pronunciation-assessments/pronunciation-assessment-word-result.tsx:116), [pronunciation-assessment-word-result.tsx:249-274](../../../enjoy/src/renderer/components/pronunciation-assessments/pronunciation-assessment-word-result.tsx:249)). Error UI phụ thuộc `None`, `Mispronunciation`, `Omission`, `Insertion`, `UnexpectedBreak`, `MissingBreak`, `Monotone` ([pronunciation-assessment-word-result.tsx:45-77](../../../enjoy/src/renderer/components/pronunciation-assessments/pronunciation-assessment-word-result.tsx:45)). Syllable hiện chưa có consumer UI.

## TTS, audio blob và speech marks

### Đường renderer đang dùng

`useSpeech.tts` resolve hai provider thực:

- direct OpenAI khi engine `openai`;
- EnjoyAI proxy cho OpenAI-compatible TTS hoặc Enjoy token broker cho Azure khi engine `enjoyai` ([use-speech.tsx:43-73](../../../enjoy/src/renderer/hooks/use-speech.tsx:43), [speech-models.ts:109-168](../../../enjoy/src/lib/speech-models.ts:109)).

OpenAI request là `{ input, model, voice, response_format: "mp3" }`, nhận response rồi lấy `arrayBuffer` ([speech-models.ts:224-242](../../../enjoy/src/lib/speech-models.ts:224), [use-speech.tsx:95-138](../../../enjoy/src/renderer/hooks/use-speech.tsx:95)). Direct OpenAI dùng key/base URL do user cấu hình. EnjoyAI OpenAI-compatible dùng EnjoyAI key và `${apiUrl}/api/ai`.

Azure TTS gửi token request synthetic:

```json
{
  "purpose": "tts",
  "input": "Synthetic text to synthesize"
}
```

Hook tạo speech config từ token, đặt voice và gọi `speakTextAsync`. Nó lấy duy nhất `result.audioData` ([use-speech.tsx:141-174](../../../enjoy/src/renderer/hooks/use-speech.tsx:141), [use-speech.tsx:181-203](../../../enjoy/src/renderer/hooks/use-speech.tsx:181)). Success gọi consume token best effort; mọi failure cố revoke best effort ([use-speech.tsx:176-207](../../../enjoy/src/renderer/hooks/use-speech.tsx:176)).

Sau synthesis, cả OpenAI và Azure đều bị đóng gói thành `{ type: "audio/mp3", arrayBuffer }` rồi gửi qua IPC ([use-speech.tsx:75-92](../../../enjoy/src/renderer/hooks/use-speech.tsx:75)). Handler ghi bytes, hash MD5, đổi tên file và tạo `Speech` record với `text`, source, section/segment, engine/model/voice ([speeches-handler.ts:22-57](../../../enjoy/src/main/db/handlers/speeches-handler.ts:22)). `Speech.src` là URL `enjoy://library/speeches/<md5><extname>` ([speech.ts:89-137](../../../enjoy/src/main/db/models/speech.ts:89)); Wavesurfer dùng URL đó để phát và vẽ pitch ([speech-player.tsx:24-50](../../../enjoy/src/renderer/components/conversations/speech-player.tsx:24)).

**MIME risk, inferred.** Đường Azure renderer không set `speechSynthesisOutputFormat`, nhưng luôn lưu output dưới nhãn MP3. Source không đủ để chứng minh SDK default hiện tại là MP3. Provider mới phải trả `{ bytes, mimeType }` và kiểm magic bytes trước khi persistence.

**Speech marks, declared absent.** Source không đăng ký `wordBoundary`, viseme hoặc bookmark callback, không có field marks trong `Speech`, và UI chỉ dùng audio URL. Do đó contract hiện tại không yêu cầu speech marks. Nếu Learning Studio cần karaoke/highlight theo TTS sau này, thêm contract mới `marks?: [{ type, text, startMs, endMs? }]` thay vì suy ra từ audio.

### Provider main-process mới nhưng chưa nối Azure production

`main/speech/provider.ts` đã định nghĩa output mạnh hơn: bytes, MIME `audio/mpeg | audio/wav`, engine, model, voice ([provider.ts:32-53](../../../enjoy/src/main/speech/provider.ts:32)). Azure provider mới yêu cầu `SpeechTokenBroker` có `acquire`, `consume`, `revoke`, set output `Riff24Khz16BitMonoPcm`, kiểm WAV bytes và quản lý timeout/cancel/cleanup ([provider.ts:436-479](../../../enjoy/src/main/speech/provider.ts:436), [provider.ts:579-610](../../../enjoy/src/main/speech/provider.ts:579), [provider.ts:668-755](../../../enjoy/src/main/speech/provider.ts:668)).

Tuy vậy factory Learning Speech trả `null` ngay khi model resolve thành Azure vì token broker vẫn thuộc renderer ([speech-configuration.ts:53-70](../../../enjoy/src/main/learning/speech-configuration.ts:53)). Vì default TTS mới vẫn là `engine: enjoyai`, model `openai/tts-1`, Learning Speech chỉ chạy nếu có EnjoyAI key; direct OpenAI chạy được nếu user chuyển config và có key ([ai-settings-provider.tsx:388-403](../../../enjoy/src/renderer/context/ai-settings-provider.tsx:388), [speech-configuration.ts:86-105](../../../enjoy/src/main/learning/speech-configuration.ts:86)).

## Khả năng thay thế hiện có

| Capability | Đường hiện có | Mức sẵn sàng bỏ Enjoy | Blocker |
|---|---|---|---|
| File STT local | Echogarden `whisper` hoặc `whisper.cpp`, sau đó DTW align | Cao, declared in code | Cần package/model sẵn; word timestamps whisper.cpp là experimental; phải giữ DTW fallback |
| File STT direct | OpenAI BYOK | Khá | `gpt-transcribe` word/segment timestamps chưa được upstream xác nhận rõ; vẫn cần fixture live và DTW fallback |
| File STT Azure | Azure SDK với token Enjoy | Thấp | Chưa có Azure key/region setting, secure main-process credential path hoặc direct selector |
| Cloudflare STT | Enjoy worker + user access token | Thấp | Vẫn phụ thuộc Enjoy auth và endpoint |
| Pronunciation | Azure SDK với token Enjoy | Thấp | Không có direct Azure BYOK; không có local provider tương đương score/phoneme contract |
| TTS direct | OpenAI BYOK | Khá | Chỉ audio, không marks; cần giữ MIME validation và persistence |
| TTS Azure | Azure SDK với token Enjoy | Thấp | Renderer broker cũ còn phụ thuộc Enjoy; main provider đã có broker interface nhưng chưa có production broker |
| Learning narration Azure | Provider code tồn tại | Chưa hoạt động | Factory cố ý trả `null` cho Azure |

## Local account mode và default stale

`LOCAL_PROFILE_MODE = true` là constant hiện hành ([runtime.ts:1](../../../enjoy/src/constants/runtime.ts:1)). DB sync của transcription, pronunciation và segment đều dừng ở local mode, nhưng UI vẫn tạo `webApi` nếu có `apiUrl` ([app-settings-provider.tsx:339-356](../../../enjoy/src/renderer/context/app-settings-provider.tsx:339)). `findOrCreateTranscription` còn thử đọc `/api/transcriptions` trước khi generate, không gate theo local mode; lỗi chỉ bị nuốt và trả null ([use-transcriptions.tsx:61-79](../../../enjoy/src/renderer/hooks/use-transcriptions.tsx:61), [use-transcriptions.tsx:88-110](../../../enjoy/src/renderer/hooks/use-transcriptions.tsx:88)).

Các default stale cần migration:

- state ban đầu và bootstrap khi chưa có stored setting chọn `ENJOY_AZURE` ([ai-settings-provider.tsx:167-194](../../../enjoy/src/renderer/context/ai-settings-provider.tsx:167), [ai-settings-provider.tsx:226-231](../../../enjoy/src/renderer/context/ai-settings-provider.tsx:226));
- form vẫn luôn hiện Enjoy Azure và Enjoy Cloudflare ([transcription-create-form.tsx:171-183](../../../enjoy/src/renderer/components/transcriptions/transcription-create-form.tsx:171));
- TTS bootstrap mới vẫn chọn engine `enjoyai` ([ai-settings-provider.tsx:388-403](../../../enjoy/src/renderer/context/ai-settings-provider.tsx:388));
- agent fixtures còn pin `enjoyai + azure/speech` ([constants/index.ts:87-115](../../../enjoy/src/constants/index.ts:87));
- stored `STT_ENGINE` được nạp thẳng, không validate capability hoặc credential ([ai-settings-provider.tsx:532-575](../../../enjoy/src/renderer/context/ai-settings-provider.tsx:532)).

Hệ quả **inferred**: profile local mới có thể chọn Azure STT mặc định, gọi token endpoint với thiếu remote session bearer và thất bại. Pronunciation/TTS có thông báo yêu cầu EnjoyAI key rõ hơn, nhưng vẫn không phải direct Azure. Source không có evidence runtime cho từng trạng thái credential, nên mã lỗi cụ thể là **unknown**.

Migration default nên làm có chủ đích:

1. Khi local mode và chưa có stored STT preference, chọn `LOCAL`, không ghi `ENJOY_AZURE`.
2. Khi stored value là Enjoy Azure/Cloudflare nhưng capability đã bỏ, hiển thị migration prompt hoặc chọn fallback deterministic; không âm thầm gửi audio ra provider khác.
3. TTS mới nên là `unconfigured` nếu không có direct key, hoặc chọn direct OpenAI chỉ khi key đã tồn tại. Không bootstrap bằng EnjoyAI.
4. Ẩn provider Enjoy khỏi form/catalog sau khi migration settings hoàn tất.
5. Gate mọi online transcription lookup bằng `!localMode`.

## Contract adapter đề xuất

### Transcription provider

```ts
type ProviderSegment = {
  text: string;
  startSec: number;
  endSec: number;
  confidence?: number;
};

type ProviderWord = {
  text: string;
  startSec: number;
  endSec: number;
  confidence?: number;
};

type TranscriptionProviderResult = {
  provider: "local" | "openai" | "azure";
  model: string;
  providerSchemaVersion: string;
  rawArtifactRef?: string;
  language: string;
  text: string;
  segments: ProviderSegment[];
  words?: ProviderWord[];
};
```

Normalizer provider phải validate finite, non-negative, monotonic timestamps. Pipeline chung vẫn đổi segment thành Echogarden timeline, align DTW, chia sentence, preprocess và ghi format DB hiện tại.

Chính sách raw đề xuất thống nhất với báo cáo chính: adapter lưu JSON result đã loại credential thành artifact local theo profile/revision, trả `rawArtifactRef` nếu capture an toàn thành công và luôn ghi `providerSchemaVersion`. Artifact có cùng vòng đời với revision, được xóa cùng revision khi người dùng xóa; không ghi raw vào log chung. Không lưu token broker, Authorization header hoặc URL có credential. Có raw thì chạy lại normalization/alignment từ output đã lưu; không có raw thì chỉ dùng canonical data còn đủ hoặc chạy ASR lại từ audio gốc. Đổi model/provider cần inference mới. Đây là contract migration đề xuất, chưa phải field đang có trong DB.

### Pronunciation provider

```ts
type PronunciationProviderResult = {
  pronunciationScore: number;
  accuracyScore: number;
  completenessScore: number;
  fluencyScore: number;
  prosodyScore?: number;
  contentScores?: { grammar?: number; vocabulary?: number; topic?: number };
  words: Array<{
    text: string;
    startSec: number;
    endSec: number;
    accuracyScore: number;
    errorType: string;
    phonemes: Array<{
      ipa: string;
      startSec: number;
      endSec: number;
      accuracyScore: number;
    }>;
    syllables: Array<{
      text: string;
      startSec: number;
      endSec: number;
      accuracyScore: number;
    }>;
  }>;
};
```

Adapter Azure đổi tick 100 ns sang giây một lần tại boundary. Nếu muốn giữ schema DB cũ trong migration đầu, có thể chuyển ngược sang offset/duration tick khi persist, nhưng canonical runtime nên dùng giây để thống nhất transcription/UI.

### TTS provider

```ts
type TtsProviderResult = {
  bytes: Uint8Array;
  mimeType: "audio/mpeg" | "audio/wav";
  provider: "openai" | "azure" | "local";
  model: string;
  voice: string;
  marks?: Array<{ type: "word" | "viseme" | "bookmark"; startMs: number; text?: string }>;
};
```

Persistence lấy extension từ MIME đã kiểm magic bytes. `marks` optional để không mở rộng scope UI hiện tại.

## Acceptance cần có trước khi xóa Enjoy path

- Fixture STT riêng cho `whisper-1`, `gpt-transcribe`, local whisper và whisper.cpp, kiểm text, segment timing, word timing có/không và DTW fallback.
- Một file có dấu câu, số, phần trăm, từ nối bằng dấu gạch ngang và silence để kiểm preprocess không làm lệch word index.
- Pronunciation fixture ngắn và dài, có phonemes, syllables, mọi `ErrorType`, prosody thiếu và content scores thiếu.
- Kiểm offset/duration: Azure raw tick 100 ns, canonical giây, UI seek đúng word.
- TTS fixture MP3 và WAV, kiểm header, MIME, extension, bytes không rỗng, player decode được.
- Migration test cho profile mới, stored `enjoy_azure`, stored `enjoy_cloudflare`, TTS `enjoyai/openai/*` và `enjoyai/azure/speech`.
- Packaged Electron acceptance cho local STT, OpenAI BYOK STT/TTS và recording playback. Mock request không chứng minh provider capability.
- Direct Azure chỉ được coi là hoàn tất khi có setting key/region, secret nằm ở main process hoặc secure store, token/subscription auth chạy thật, pronunciation result render đủ phoneme và TTS WAV/MP3 phát được.

## Giới hạn rà soát

- Live chưa gọi bất kỳ speech API nào, nên latency, quota, region support, exact SDK runtime shape và provider quality chưa được xác minh.
- Không có raw production response hoặc private credential được đọc hay ghi.
- `gpt-transcribe` có trong code và test request, nhưng timestamp capability chưa được chứng minh bằng official guide hoặc live response.
- Syllable shape của Azure cần một fixture sanitized từ SDK thật để đóng type debt.
- Direct Azure BYOK hiện là thiết kế cần triển khai, chưa phải capability có sẵn.
