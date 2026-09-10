# Inventory Enjoy API cần thay thế

Ngày rà soát: 2026-09-08
Phạm vi: đọc tĩnh working tree hiện tại, không gọi Enjoy API, không đọc credential, không xác nhận response live.

## Kết luận dùng cho kế hoạch thay thế

`Client` khai báo 70 method API, tạo ra 69 cặp HTTP method và path duy nhất. Hai method `consumeSpeechToken` và `revokeSpeechToken` dùng chung `PUT /api/speech/tokens/:id`. Mọi response thành công đều bị interceptor đổi snake_case sang camelCase sâu rồi trả thẳng `response.data`; request body được từng method đổi sang snake_case khi có `decamelizeKeys` ([client.ts:37](../../../enjoy/src/api/client.ts:37), [client.ts:44](../../../enjoy/src/api/client.ts:44), [client.ts:56](../../../enjoy/src/api/client.ts:56)). Các contract dưới đây chỉ là TypeScript khai báo hoặc shape mà consumer đòi hỏi, không phải contract server đã kiểm chứng.

Local profile hiện là chế độ bắt buộc (`LOCAL_PROFILE_MODE = true`) ([runtime.ts:1](../../../enjoy/src/constants/runtime.ts:1)). Tuy vậy provider vẫn tạo `webApi` cho `apiUrl`, chỉ thiếu Bearer vì local user không có `accessToken` ([app-settings-provider.tsx:339](../../../enjoy/src/renderer/context/app-settings-provider.tsx:339)). `Client` chỉ thêm Bearer khi có token ([client.ts:44](../../../enjoy/src/api/client.ts:44)); `UserSetting.accessToken()` cũng ép trả `null` trong local mode ([user-setting.ts:72](../../../enjoy/src/main/db/models/user-setting.ts:72)). Vì vậy không được xem local mode là một network kill switch.

Client không có auth gate theo endpoint. Nó gửi mọi request dù không có token, nên yêu cầu auth phía server của từng path là Unknown nếu chỉ dựa vào repo này. Chỉ có thể suy ra nhóm session/config cần hoạt động trước login từ consumer cũ; không coi suy luận đó là server contract. Trong local mode, các call UI nhóm `A` đi ra không Bearer. EnjoyAI là gate riêng ở tầng provider: engine `enjoyai` phải có key đã cấu hình hoặc legacy credential, nếu thiếu thì chat/command throw trước request ([use-conversation.tsx:47](../../../enjoy/src/renderer/hooks/use-conversation.tsx:47), [ai-settings-provider.tsx:548](../../../enjoy/src/renderer/context/ai-settings-provider.tsx:548)).

Các phụ thuộc non-speech còn reachable từ router và chưa có local guard:

- Stories: list, create, detail, meanings, batch lookup, extract vocabulary, star/unstar. Route vẫn được mount tại `/stories`, `/stories/:id`, `/stories/preview/:uri` ([router.tsx:156](../../../enjoy/src/renderer/router.tsx:156)); các call trực tiếp nằm ở [stories.tsx:19](../../../enjoy/src/renderer/pages/stories.tsx:19), [story.tsx:35](../../../enjoy/src/renderer/pages/story.tsx:35), [story.tsx:50](../../../enjoy/src/renderer/pages/story.tsx:50), [story.tsx:134](../../../enjoy/src/renderer/pages/story.tsx:134), [story-preview.tsx:54](../../../enjoy/src/renderer/pages/story-preview.tsx:54).
- Vocabulary: `/vocabulary` gọi `mineMeanings` ngay khi mount và tiếp tục phân trang ([router.tsx:92](../../../enjoy/src/renderer/router.tsx:92), [vocabulary.tsx:80](../../../enjoy/src/renderer/pages/vocabulary.tsx:80)).
- Transcription cloud discovery: media route dùng `useTranscriptions`; hook gọi `GET /api/transcriptions` không có local guard, nhưng bắt lỗi và giữ local transcription ([media-shadow-provider.tsx:163](../../../enjoy/src/renderer/context/media-shadow-provider.tsx:163), [use-transcriptions.tsx:88](../../../enjoy/src/renderer/hooks/use-transcriptions.tsx:88)). Đây là download/share metadata, tách khỏi speech generation.
- Conversations: `/conversations` gọi bốn config endpoint khi mount hoặc khi có `postId`: `gpt_presets`, `default_gpt_preset`, `default_tts_preset`, và `GET /api/posts/:id` ([conversations.tsx:62](../../../enjoy/src/renderer/pages/conversations.tsx:62), [conversations.tsx:105](../../../enjoy/src/renderer/pages/conversations.tsx:105), [conversations.tsx:169](../../../enjoy/src/renderer/pages/conversations.tsx:169)). Config có fallback trong `catch`, còn `postId` không có fallback.

Các phần đã chặn đúng khi local mode:

- Đồng bộ/xóa/upload nền cho audio, video, recording, document, note, segment, transcription và pronunciation assessment đều return sớm trước network. Ví dụ audio tại [audio.ts:211](../../../enjoy/src/main/db/models/audio.ts:211), [audio.ts:231](../../../enjoy/src/main/db/models/audio.ts:231), document tại [document.ts:130](../../../enjoy/src/main/db/models/document.ts:130), segment tại [segment.ts:117](../../../enjoy/src/main/db/models/segment.ts:117), transcription tại [transcription.ts:86](../../../enjoy/src/main/db/models/transcription.ts:86).
- Remote lookup và translation cache đi qua `readRemoteBestEffort`/`writeRemoteBestEffort`, return ngay trong local mode ([local-ai-services.ts:27](../../../enjoy/src/lib/local-ai-services.ts:27), [local-ai-services.ts:39](../../../enjoy/src/lib/local-ai-services.ts:39)). Local lookup vẫn chạy AI và lưu cache cục bộ ([use-ai-command.tsx:81](../../../enjoy/src/renderer/hooks/use-ai-command.tsx:81), [use-ai-command.tsx:121](../../../enjoy/src/renderer/hooks/use-ai-command.tsx:121)).
- Optional remote config `ipa_mappings`, `gpt_providers`, `tts_providers_v2`, `ytb_channels`, `chat_agent_templates` có local guard ([app-settings-provider.tsx:366](../../../enjoy/src/renderer/context/app-settings-provider.tsx:366), [ai-settings-provider.tsx:450](../../../enjoy/src/renderer/context/ai-settings-provider.tsx:450), [ai-settings-provider.tsx:514](../../../enjoy/src/renderer/context/ai-settings-provider.tsx:514), [home.tsx:80](../../../enjoy/src/renderer/pages/home.tsx:80), [chat-agent-form.tsx:63](../../../enjoy/src/renderer/components/chats/chat-agent-form.tsx:63)).

Auth, social feed, courses/enrollments, server LLM chat, payment/balance và email profile có source consumer nhưng không có route/component mount từ cây UI hiện tại. Đây là dead/unrouted code, không phải bằng chứng endpoint không còn tồn tại. Router hiện không khai báo `/courses`; profile mới chỉ đọc DB local ([router.tsx:27](../../../enjoy/src/renderer/router.tsx:27), [profile.tsx:77](../../../enjoy/src/renderer/pages/profile.tsx:77)). Landing chọn local profile và không render `LoginForm` ([landing.tsx:14](../../../enjoy/src/renderer/pages/landing.tsx:14)).

## Quy ước trạng thái và độ chắc chắn

- `A`: active UI, route/component reachable và call không bị local guard.
- `L`: active code nhưng local-mode blocked hoặc có local fallback chặn call.
- `C`: cloud-only/background, source vẫn có hook/call nhưng local-mode blocked.
- `D`: không tìm thấy call site, hoặc call site chỉ nằm trong UI không được route/mount.
- `S`: speech endpoint, chỉ liệt kê để đủ inventory; cần báo cáo speech riêng phân tích sâu.
- `Declared`: type/return annotation trong source. `Inferred`: field consumer thực đọc. `Unknown`: không có annotation hoặc consumer bỏ response. Không mục nào là observed-live.

## Appendix A: 70 method của `Client`

| # | Client method | HTTP path | Response contract khai báo | Field consumer thực đọc | Trạng thái |
|---:|---|---|---|---|---|
| 1 | `up` | `GET /up` ([client.ts:90](../../../enjoy/src/api/client.ts:90)) | Unknown | Không có call qua Client; network settings tự `fetch(apiUrl + "/up")` | D, endpoint probe active ngoài Client |
| 2 | `auth` | `POST /api/sessions` ([client.ts:94](../../../enjoy/src/api/client.ts:94)) | Declared `UserType` | `id`, `accessToken` | D, login UI unrouted |
| 3 | `oauthState` | `POST /api/sessions/oauth_state` ([client.ts:105](../../../enjoy/src/api/client.ts:105)) | Declared `UserType` | `id`, `accessToken` | D |
| 4 | `config` | `GET /api/config/:key` ([client.ts:109](../../../enjoy/src/api/client.ts:109)) | Declared `any` | Xem Appendix B | A/L/D tùy key |
| 5 | `deviceCode` | `POST /api/sessions/device_code` ([client.ts:113](../../../enjoy/src/api/client.ts:113)) | Declared `{deviceCode,userCode,verificationUri,expiresIn,interval}` | Cả 5 field ([github-login-form.tsx:62](../../../enjoy/src/renderer/components/login/github-login-form.tsx:62)) | D |
| 6 | `me` | `GET /api/me` ([client.ts:123](../../../enjoy/src/api/client.ts:123)) | Declared `UserType` | Merge toàn object vào local user | D |
| 7 | `updateProfile` | `PUT /api/users/:id` ([client.ts:127](../../../enjoy/src/api/client.ts:127)) | Declared `UserType` | Response dẫn tới refresh `me`; không đọc trực tiếp | D |
| 8 | `loginCode` | `POST /api/sessions/login_code` ([client.ts:138](../../../enjoy/src/api/client.ts:138)) | Declared `void` | Không có | D |
| 9 | `rankings` | `GET /api/users/rankings` ([client.ts:146](../../../enjoy/src/api/client.ts:146)) | Declared `{rankings: UserType[],range:string}` | `rankings` | D |
| 10 | `users` | `GET /api/users` ([client.ts:153](../../../enjoy/src/api/client.ts:153)) | Declared `{users} & Pagy` | Không có call site | D |
| 11 | `user` | `GET /api/users/:id` ([client.ts:161](../../../enjoy/src/api/client.ts:161)) | Declared `UserType` | Không có call site | D |
| 12 | `userFollowing` | `GET /api/users/:id/following` ([client.ts:165](../../../enjoy/src/api/client.ts:165)) | Declared `{users} & Pagy` | Không có call site | D |
| 13 | `userFollowers` | `GET /api/users/:id/followers` ([client.ts:178](../../../enjoy/src/api/client.ts:178)) | Declared `{users} & Pagy` | Không có call site | D |
| 14 | `follow` | `POST /api/users/:id/follow` ([client.ts:191](../../../enjoy/src/api/client.ts:191)) | Declared `{user,following}` | Không có call site | D |
| 15 | `unfollow` | `POST /api/users/:id/unfollow` ([client.ts:201](../../../enjoy/src/api/client.ts:201)) | Declared `{user,following}` | Không có call site | D |
| 16 | `posts` | `GET /api/posts` ([client.ts:211](../../../enjoy/src/api/client.ts:211)) | Declared `{posts: PostType[]} & Pagy` | Dead consumer đọc `posts`, `next` | D |
| 17 | `post` | `GET /api/posts/:id` ([client.ts:233](../../../enjoy/src/api/client.ts:233)) | Declared `PostType` | `metadata.content.configuration.roleDefinition` | A, chỉ khi query `postId` |
| 18 | `updatePost` | `PUT /api/posts/:id` ([client.ts:237](../../../enjoy/src/api/client.ts:237)) | Declared `PostType` | Không có call site | D |
| 19 | `deletePost` | `DELETE /api/posts/:id` ([client.ts:241](../../../enjoy/src/api/client.ts:241)) | Declared `void` | Không có | D |
| 20 | `likePost` | `POST /api/posts/:id/like` ([client.ts:245](../../../enjoy/src/api/client.ts:245)) | Declared `PostType` | Dead consumer dùng toàn Post object | D |
| 21 | `unlikePost` | `DELETE /api/posts/:id/unlike` ([client.ts:249](../../../enjoy/src/api/client.ts:249)) | Declared `PostType` | Dead consumer dùng toàn Post object | D |
| 22 | `transcriptions` | `GET /api/transcriptions` ([client.ts:253](../../../enjoy/src/api/client.ts:253)) | Declared `{transcriptions: TranscriptionType[]} & Pagy` | `transcriptions`, từng item `id,targetMd5,result,engine,model,language,downloadsCount`; list UI còn đọc `page,next` | A, cloud discovery |
| 23 | `usages` | `GET /api/mine/usages` ([client.ts:269](../../../enjoy/src/api/client.ts:269)) | Declared `{label:string,data:number[]}[]` | Dead balance chart đọc `label`, `data` | D |
| 24 | `syncAudio` | `POST /api/mine/audios` ([client.ts:273](../../../enjoy/src/api/client.ts:273)) | Unknown | Response bỏ qua | C |
| 25 | `deleteAudio` | `DELETE /api/mine/audios/:id` ([client.ts:277](../../../enjoy/src/api/client.ts:277)) | Unknown | Response bỏ qua | C |
| 26 | `syncVideo` | `POST /api/mine/videos` ([client.ts:281](../../../enjoy/src/api/client.ts:281)) | Unknown | Response bỏ qua | C |
| 27 | `deleteVideo` | `DELETE /api/mine/videos/:id` ([client.ts:285](../../../enjoy/src/api/client.ts:285)) | Unknown | Response bỏ qua | C |
| 28 | `syncTranscription` | `POST /api/transcriptions` ([client.ts:289](../../../enjoy/src/api/client.ts:289)) | Unknown | Response bỏ qua | C |
| 29 | `syncSegment` | `POST /api/segments` ([client.ts:293](../../../enjoy/src/api/client.ts:293)) | Unknown | Response bỏ qua | C |
| 30 | `syncNote` | `POST /api/notes` ([client.ts:299](../../../enjoy/src/api/client.ts:299)) | Unknown | Response bỏ qua | C |
| 31 | `deleteNote` | `DELETE /api/notes/:id` ([client.ts:303](../../../enjoy/src/api/client.ts:303)) | Unknown | Response bỏ qua | C |
| 32 | `syncRecording` | `POST /api/mine/recordings` ([client.ts:307](../../../enjoy/src/api/client.ts:307)) | Unknown, method còn có thể trả `undefined` | Response bỏ qua | C |
| 33 | `deleteRecording` | `DELETE /api/mine/recordings/:id` ([client.ts:313](../../../enjoy/src/api/client.ts:313)) | Unknown | Response bỏ qua | C |
| 34 | `generateSpeechToken` | `POST /api/speech/tokens` ([client.ts:317](../../../enjoy/src/api/client.ts:317)) | Declared `{id:number,token:string,region:string}` | `id`, `token`, `region` | S, active speech |
| 35 | `consumeSpeechToken` | `PUT /api/speech/tokens/:id`, body `state=consumed` ([client.ts:326](../../../enjoy/src/api/client.ts:326)) | Unknown | Response bỏ qua | S |
| 36 | `revokeSpeechToken` | `PUT /api/speech/tokens/:id`, body `state=revoked` ([client.ts:332](../../../enjoy/src/api/client.ts:332)) | Unknown | Response bỏ qua | S |
| 37 | `syncPronunciationAssessment` | `POST /api/mine/pronunciation_assessments` ([client.ts:338](../../../enjoy/src/api/client.ts:338)) | Unknown, có thể `undefined` | Response bỏ qua | C/S |
| 38 | `recordingAssessment` | `GET /api/mine/recordings/:id/assessment` ([client.ts:349](../../../enjoy/src/api/client.ts:349)) | Unknown | Không có call site | D/S |
| 39 | `lookup` | `POST /api/lookups` ([client.ts:353](../../../enjoy/src/api/client.ts:353)) | Declared `LookupType` | `id`, `meaning`, `meaningOptions`; widget cũng dùng toàn object | L, có local fallback |
| 40 | `updateLookup` | `PUT /api/lookups/:id` ([client.ts:363](../../../enjoy/src/api/client.ts:363)) | Declared `LookupType` | Response bỏ qua | L |
| 41 | `lookupInBatch` | `POST /api/lookups/batch` ([client.ts:374](../../../enjoy/src/api/client.ts:374)) | Declared `{successCount,errors,total}` | Response bỏ qua, chỉ refetch meanings | A |
| 42 | `extractVocabularyFromStory` | `POST /api/stories/:id/extract_vocabulary` ([client.ts:387](../../../enjoy/src/api/client.ts:387)) | Declared `string[]` | Response bỏ qua, rồi refetch story | A |
| 43 | `storyMeanings` | `GET /api/stories/:id/meanings` ([client.ts:400](../../../enjoy/src/api/client.ts:400)) | Declared `{meanings,pendingLookups?} & Pagy` | `meanings`, `pendingLookups` | A |
| 44 | `mineMeanings` | `GET /api/mine/meanings` ([client.ts:417](../../../enjoy/src/api/client.ts:417)) | Declared `{meanings} & Pagy` | `meanings`, `next`; Meaning UI đọc `id,word,lemma,pronunciation,pos,definition,translation,lookups[].{id,context,contextTranslation}` ([meaning-card.tsx:9](../../../enjoy/src/renderer/components/meanings/meaning-card.tsx:9), [meaning-memorizing-card.tsx:76](../../../enjoy/src/renderer/components/meanings/meaning-memorizing-card.tsx:76)) | A |
| 45 | `createStory` | `POST /api/stories` ([client.ts:433](../../../enjoy/src/api/client.ts:433)) | Declared `StoryType` | `id` để navigate | A |
| 46 | `story` | `GET /api/stories/:id` ([client.ts:437](../../../enjoy/src/api/client.ts:437)) | Declared `StoryType` | `id,title,content,extraction,extracted,starred` và metadata/url trong viewer | A |
| 47 | `stories` | `GET /api/stories` ([client.ts:441](../../../enjoy/src/api/client.ts:441)) | Declared `{stories} & Pagy` | Không có call site | D |
| 48 | `mineStories` | `GET /api/mine/stories` ([client.ts:449](../../../enjoy/src/api/client.ts:449)) | Declared `{stories} & Pagy` | `stories`, `next`; card đọc Story fields | A |
| 49 | `starStory` | `POST /api/mine/stories`, body `story_id` ([client.ts:459](../../../enjoy/src/api/client.ts:459)) | Declared `{starred:boolean}` | `starred` | A |
| 50 | `unstarStory` | `DELETE /api/mine/stories/:storyId` ([client.ts:463](../../../enjoy/src/api/client.ts:463)) | Declared `{starred:boolean}` | `starred` | A |
| 51 | `createPayment` | `POST /api/payments` ([client.ts:467](../../../enjoy/src/api/client.ts:467)) | Declared `PaymentType` | Dead consumer đọc `payUrl` | D |
| 52 | `payments` | `GET /api/payments` ([client.ts:476](../../../enjoy/src/api/client.ts:476)) | Declared `{payments} & Pagy` | Dead consumer đọc `payments[0].status` và payment fields | D |
| 53 | `payment` | `GET /api/payments/:id` ([client.ts:488](../../../enjoy/src/api/client.ts:488)) | Declared `PaymentType` | Không có call site | D |
| 54 | `segments` | `GET /api/segments` ([client.ts:492](../../../enjoy/src/api/client.ts:492)) | Declared `{segments} & Pagy` | Dead post consumer đọc `segments`, rồi Segment fields | D |
| 55 | `courses` | `GET /api/courses` ([client.ts:507](../../../enjoy/src/api/client.ts:507)) | Declared `{courses} & Pagy` | Unrouted list đọc `courses`, `next`; card đọc `id,title,coverUrl` ([courses/index.tsx:21](../../../enjoy/src/renderer/pages/courses/index.tsx:21), [course-card.tsx:10](../../../enjoy/src/renderer/components/courses/course-card.tsx:10)) | D |
| 56 | `course` | `GET /api/courses/:id` ([client.ts:520](../../../enjoy/src/api/client.ts:520)) | Declared `CourseType` | Unrouted detail đọc `id,title,description,coverUrl,enrolled,enrollment.progress,currentChapterSequence,enrollmentsCount` | D |
| 57 | `createEnrollment` | `POST /api/enrollments` ([client.ts:524](../../../enjoy/src/api/client.ts:524)) | Declared `EnrollmentType` | Response bỏ qua rồi refetch course | D |
| 58 | `courseChapters` | `GET /api/courses/:courseId/chapters` ([client.ts:528](../../../enjoy/src/api/client.ts:528)) | Declared `{chapters} & Pagy` | Unrouted consumer đọc `chapters,page,next,last`; Chapter UI đọc contract trong `chapter.d.ts` | D |
| 59 | `coursechapter` | `GET /api/courses/:courseId/chapters/:id` ([client.ts:545](../../../enjoy/src/api/client.ts:545)) | Declared `ChapterType` | Unrouted consumer đọc `id,title,course.title,enrollment.id,content,examples,translations,finished` | D |
| 60 | `finishCourseChapter` | `POST /api/courses/:courseId/chapters/:id/finish` ([client.ts:549](../../../enjoy/src/api/client.ts:549)) | Declared `void` | Không có | D |
| 61 | `enrollments` | `GET /api/enrollments` ([client.ts:553](../../../enjoy/src/api/client.ts:553)) | Declared `{enrollments} & Pagy` | Unrouted consumer đọc `enrollments`, rồi `id,course,progress` | D |
| 62 | `updateEnrollment` | `PUT /api/enrollments/:id` ([client.ts:561](../../../enjoy/src/api/client.ts:561)) | Declared `EnrollmentType` | Response bỏ qua | D |
| 63 | `createLlmChat` | `POST /api/chats` ([client.ts:570](../../../enjoy/src/api/client.ts:570)) | Declared `LLmChatType` | Unrouted consumer dùng toàn object, sau đó `id` | D |
| 64 | `llmChat` | `GET /api/chats/:id` ([client.ts:577](../../../enjoy/src/api/client.ts:577)) | Declared `LLmChatType` | Unrouted consumer dùng `id`; message UI có thể dùng `user`, `agent` | D |
| 65 | `createLlmMessage` | `POST /api/chats/:chatId/messages` ([client.ts:581](../../../enjoy/src/api/client.ts:581)) | Declared `LlmMessageType` | Unrouted reducer/UI đọc `id,query,response,user.{name,avatarUrl},agent.{name,avatarUrl},createdAt` ([llm-message.tsx:177](../../../enjoy/src/renderer/components/llm-chats/llm-message.tsx:177)) | D |
| 66 | `llmMessages` | `GET /api/chats/:chatId/messages` ([client.ts:595](../../../enjoy/src/api/client.ts:595)) | Declared `{messages} & Pagy` | `messages`, cuối mảng, rồi đúng các LlmMessage fields ở hàng 65 | D |
| 67 | `syncDocument` | `POST /api/mine/documents` ([client.ts:611](../../../enjoy/src/api/client.ts:611)) | Unknown | Response bỏ qua | C |
| 68 | `deleteDocument` | `DELETE /api/mine/documents/:id` ([client.ts:615](../../../enjoy/src/api/client.ts:615)) | Unknown | Response bỏ qua | C |
| 69 | `translations` | `GET /api/translations` ([client.ts:619](../../../enjoy/src/api/client.ts:619)) | Declared `{translations} & Pagy` | `translations.length`, `[0].translatedContent` | L, local cache replaces it |
| 70 | `createTranslation` | `POST /api/translations` ([client.ts:633](../../../enjoy/src/api/client.ts:633)) | Declared `TranslationType` | Response bỏ qua | L |

Type source cho các contract lớn: `UserType` ([user.d.ts:1](../../../enjoy/src/types/user.d.ts:1)), `PostType` ([post.d.ts:1](../../../enjoy/src/types/post.d.ts:1)), `TranscriptionType` ([transcription.d.ts:1](../../../enjoy/src/types/transcription.d.ts:1)), `LookupType`, `MeaningType`, `PagyResponseType` ([index.d.ts:129](../../../enjoy/src/types/index.d.ts:129)), `StoryType` ([story.d.ts:1](../../../enjoy/src/types/story.d.ts:1)), `CourseType` ([course.d.ts:1](../../../enjoy/src/types/course.d.ts:1)), `ChapterType` ([chapter.d.ts:1](../../../enjoy/src/types/chapter.d.ts:1)), `EnrollmentType` ([enrollment.d.ts:1](../../../enjoy/src/types/enrollment.d.ts:1)), `LLmChatType` ([llm-chat.d.ts:1](../../../enjoy/src/types/llm-chat.d.ts:1)), `LlmMessageType` ([llm-message.d.ts:1](../../../enjoy/src/types/llm-message.d.ts:1)), `TranslationType` ([translation.d.ts:1](../../../enjoy/src/types/translation.d.ts:1)).

## Appendix B: config keys thực tế

| Key | Consumer field/shape thực đọc | Trạng thái |
|---|---|---|
| `bugsnag_api_key` | `{bugsnagApiKey}` | Packaged-only, bỏ qua trong local mode ở main và renderer ([main.ts:23](../../../enjoy/src/main.ts:23), [app.tsx:23](../../../enjoy/src/renderer/app.tsx:23)) |
| `ipa_mappings` | Toàn object `{[key:string]:string}` | L, bundled fallback |
| `gpt_providers` | Toàn config object để merge provider catalog | L, local/provider settings thay thế |
| `tts_providers_v2` | Toàn object để `mergeRemoteTtsProviders` | L, bundled catalog fallback |
| `ytb_channels` | Mảng string sau normalize | L, default và custom local fallback |
| `chat_agent_templates` | Mảng template | L, form reachable trong Chats nhưng effect return sớm |
| `gpt_presets` | Mảng preset; dùng `length`, mỗi preset `configuration` | A, `/conversations` mount |
| `default_gpt_preset` | `engine,key,name,configuration.model,configuration.tts` | A, fallback local constant |
| `default_tts_preset` | `engine,configuration.type,configuration.tts.engine` | A, fallback local settings |

## Appendix C: bề mặt mạng ngoài `Client`

| Bề mặt | Endpoint/operation | Contract source hoặc field dùng | Trạng thái và thay thế cần tính |
|---|---|---|---|
| Storage worker | `GET https://storage.enjoy.bot/:key`, `POST multipart /:key`, URL công khai `/:key` ([storage.ts:25](../../../enjoy/src/main/storage.ts:25)) | Axios response unknown; upload consumer đòi `result.data.success`; video cover dùng URL trả từ `getUrl` | `put` bị local guard ([storage.ts:33](../../../enjoy/src/main/storage.ts:33)); URL cũ trong DB vẫn có thể được phát/download. Cần migration hoặc compatibility cho asset cloud cũ. |
| Storage host recognition | `storage.enjoy.bot`, `enjoy-storage.baizhiheizi.com` ([constants/index.ts:27](../../../enjoy/src/constants/index.ts:27)) | Chỉ nhận diện `audio.sourceUrl` là storage source | Dead post UI hiện tại, nhưng dữ liệu cũ có thể chứa URL này. |
| Enjoy OpenAI-compatible proxy | Base `${apiUrl}/api/ai` cho chat/AI command ([use-conversation.tsx:50](../../../enjoy/src/renderer/hooks/use-conversation.tsx:50), [use-ai-command.tsx:47](../../../enjoy/src/renderer/hooks/use-ai-command.tsx:47)) | Declared policy của provider `enjoyai` là `chat-completions` ([chat-model.ts:104](../../../enjoy/src/lib/chat-model.ts:104)); URL cuối `/api/ai/chat/completions` là Inferred từ `ChatOpenAI`, không phải literal trong repo | Active nếu engine `enjoyai`; bắt buộc provider key, local mode thiếu key thì throw hướng dẫn cấu hình ([use-conversation.tsx:57](../../../enjoy/src/renderer/hooks/use-conversation.tsx:57)). Cần đổi default engine/preset hoặc giữ proxy tương thích. |
| Enjoy OpenAI-compatible speech proxy | Base `${apiUrl}/api/ai`; OpenAI SDK tạo speech/transcription | Speech contract, xem báo cáo speech riêng | S. `UserSetting.enjoyAiApiKey()` chỉ cho request chọn EnjoyAI dùng credential riêng ([user-setting.ts:77](../../../enjoy/src/main/db/models/user-setting.ts:77)). |
| AI Worker STT | `POST https://ai-worker.enjoy.bot/audio/transcriptions` multipart ([use-transcribe.tsx:364](../../../enjoy/src/renderer/hooks/use-transcribe.tsx:364)) | Speech transcription response; không đánh giá sâu ở đây | S, engine Enjoy Cloudflare. |
| WebSocket/ActionCable | Default `wss://enjoy.bot`, channel `NotificationsChannel`, action `mark_as_seen` ([constants/index.ts:36](../../../enjoy/src/constants/index.ts:36), [notifications_channel.ts:11](../../../enjoy/src/renderer/cables/channels/notifications_channel.ts:11)) | Received `string` hoặc `{type,message,id}` | D: provider hard-code `cable: undefined`, sidebar chỉ subscribe nếu có cable ([app-settings-provider.tsx:455](../../../enjoy/src/renderer/context/app-settings-provider.tsx:455), [sidebar.tsx:124](../../../enjoy/src/renderer/components/layouts/sidebar.tsx:124)). |
| Generic download | Electron `webContents.downloadURL(url)` qua IPC `download-start` ([downloader.ts:16](../../../enjoy/src/main/downloader.ts:16), [downloader.ts:177](../../../enjoy/src/main/downloader.ts:177)) | Resolve local save path hoặc `undefined`; state `{name,state,received,total}` | Active và không riêng Enjoy. Phải giữ để download media/recording/document/YouTube/Audible/TED hoặc thay từng consumer. |
| Generic remote page load/scrape | `WebContentsView.webContents.loadURL(url)` qua IPC `view-load`/`view-scrape` ([window.ts:225](../../../enjoy/src/main/window.ts:225), [window.ts:359](../../../enjoy/src/main/window.ts:359)) | `view-load` phát state và HTML; `view-scrape` cũng scrape HTML | Active cho Story Preview và provider web. Không thuộc Enjoy API, phải giữ hoặc thay bằng fetch/parser tương ứng. |
| App update/download links | Default GitHub repository releases; optional HTTPS feed từ `ENJOY_UPDATE_FEED_URL` ([distribution.ts:43](../../../enjoy/src/constants/distribution.ts:43), [window.ts:495](../../../enjoy/src/main/window.ts:495)) | Electron autoUpdater contract | Không mặc định phụ thuộc enjoy.bot. Cần đổi tên env trong cleanup branding, nhưng không phải Enjoy account API. |
| Legacy dictionary downloads | 8 URL `https://dl.enjoy.bot/dicts/*.zip` ([legacy-dicts.ts:1](../../../enjoy/src/constants/legacy-dicts.ts:1)) | Metadata compatibility cho dictionary đã import | Không còn build dependency: forge script đọc archive bundled và kiểm SHA-256, không tải mạng ([download-dictionaries.mjs:1](../../../enjoy/scripts/download-dictionaries.mjs:1)). Có thể giữ metadata hoặc bỏ sau khi xác minh importer không expose download. |
| API health probe | Direct renderer `fetch(apiUrl + "/up")` ([network-state.tsx:25](../../../enjoy/src/renderer/components/preferences/network-state.tsx:25)) | Chỉ đo latency/throw | A khi mở Advanced settings, không bị local guard. |
| Connectivity probe | `fetch("https://ipapi.co/json")` ([network-state.tsx:41](../../../enjoy/src/renderer/components/preferences/network-state.tsx:41)) | Không đọc body | A, third-party và không thuộc Enjoy; cần quyết định privacy/offline riêng. |
| Ahoy analytics | `ahoy.configure({urlPrefix: apiUrl})` ([app-settings-provider.tsx:358](../../../enjoy/src/renderer/context/app-settings-provider.tsx:358)) | Không có `track`/`trackView` call tường minh trong `enjoy/src`; request tự động của thư viện là Unknown | Provider cấu hình cả trong local mode. Cần bỏ hoặc xác minh runtime của `ahoy.js` để bảo đảm không còn telemetry tới Enjoy. |
| Bugsnag bootstrap | Lấy `config/bugsnag_api_key`, rồi `Bugsnag.start` ([main.ts:23](../../../enjoy/src/main.ts:23), [app.tsx:23](../../../enjoy/src/renderer/app.tsx:23)) | Config `{bugsnagApiKey}`; traffic sau đó thuộc Bugsnag SDK | L, cả main và renderer return sớm khi local mode. |
| Media/document direct fetch | `fetch(document.src)` và `fetch(media.src)` ([document-text-renderer.tsx:14](../../../enjoy/src/renderer/components/documents/document-text-renderer.tsx:14), [media-shadow-provider.tsx:252](../../../enjoy/src/renderer/context/media-shadow-provider.tsx:252)) | Blob/text body | Active generic fetch. URL có thể là local `enjoy://` hoặc cloud URL cũ; cần giữ protocol local và xử lý asset legacy. |
| `enjoy://` protocol | Electron `net.fetch(file://...)` sau khi map library path ([main.ts:131](../../../enjoy/src/main.ts:131)) | Local file response | Active local infrastructure, tên scheme không phải Enjoy cloud API và không nên xóa cùng network integration. |

Không tìm thấy một API tên `directFetch`/`directfetch` hay IPC HTTP proxy tổng quát trong `enjoy/src`. Những direct fetch thực tế là các mục health/connectivity/media ở trên; `net.fetch` duy nhất là bridge local `enjoy://` sang `file://`.

## Thứ tự tách non-speech đề xuất từ dependency

1. Chặn hoặc thay route-level calls ở Stories, Vocabulary, Conversations và transcription discovery, vì đây là call reachable hiện tại và local mode chưa loại bỏ.
2. Chuyển `apiUrl`/health UI và default `enjoyai` base URL sang provider-neutral settings. Việc chỉ xóa account/token chưa đủ vì `webApi` vẫn được tạo.
3. Giữ các guard của background sync/upload, sau đó xóa hook và Client methods theo nhóm khi đã xác minh không cần cloud migration.
4. Xử lý URL asset cũ trong DB trước khi bỏ storage host/downloader. Generic downloader và `enjoy://` local protocol không phải phần nên xóa theo tên thương hiệu.
5. Xóa dead auth/social/course/payment/server-LLM code sau cùng hoặc trong một cleanup riêng; chúng không chặn local runtime nhưng làm tăng bề mặt migration và dễ gây nhận định sai về tính năng đang dùng.
