# Tái sử dụng CLI trong Enjoy: Buzz và Obsidian Agent Client

Ngày kiểm: 2026-09-07. Đây là đối chiếu source, kèm auth status trên CLI local; chưa phải nghiệm thu inference hoặc ứng dụng đóng gói.

## Kết luận áp dụng

Enjoy mặc định dùng phiên đăng nhập CLI hiện có. CLI tự xử lý credential và refresh; Enjoy quản lý job, permission, dữ liệu bài học và artifact. Yêu cầu đăng nhập riêng trước đây là lựa chọn triển khai của Enjoy, đã được thay thế theo điều chỉnh của người dùng.

## Nguồn đã kiểm

- Buzz HEAD: `3c7f288c60d67df78577b237e27c3dfc8831aaa1`, đã đối chiếu remote. [Readiness](https://github.com/block/buzz/blob/3c7f288c60d67df78577b237e27c3dfc8831aaa1/desktop/src-tauri/src/managed_agents/readiness.rs#L395-L458) gọi status CLI; [spawn](https://github.com/block/buzz/blob/3c7f288c60d67df78577b237e27c3dfc8831aaa1/crates/buzz-acp/src/acp.rs#L462-L517) kế thừa environment.
- Obsidian Agent Client: `55dc9e3a3d5bfa3e2b0535585e0ea096689eec85`, package `0.12.1`, clone trực tiếp repo được người dùng cung cấp. [Claude setup](https://github.com/RAIT-09/obsidian-agent-client/blob/55dc9e3a3d5bfa3e2b0535585e0ea096689eec85/docs/agent-setup/claude-code.md#L56-L92) và [Codex setup](https://github.com/RAIT-09/obsidian-agent-client/blob/55dc9e3a3d5bfa3e2b0535585e0ea096689eec85/docs/agent-setup/codex.md#L56-L92) nêu CLI tạo phiên đăng nhập mà plugin sử dụng; để trống API key khi dùng account login.

## Những phần nên học

| Mẫu trong Obsidian Agent Client | Áp dụng cho Enjoy |
|---|---|
| Preset registry chứa command, args, hướng dẫn cài và auth mode | Một provider registry phục vụ discovery, cài đặt và preflight; tránh rải điều kiện Codex/Claude trong UI. |
| Adapter là tiến trình riêng, giao tiếp ACP qua stdio | Giữ transport phía main sau interface chung; UI nhận event typed. ACP là phương án có thể khảo nghiệm, không phải điều kiện để tái dùng auth. |
| Kế thừa identity/profile của người dùng; chỉ inject API key đã chọn và có giá trị | Native-account mode giữ HOME/USER/profile path cần thiết, không tự inject API key rỗng hoặc đổi billing route. |
| Chỉ đi vào nhánh authenticate khi có lỗi auth cụ thể | Phân biệt thiếu binary, lỗi launch, hết hạn auth, thiếu capability và quota; lỗi probe không mặc định thành yêu cầu login. |
| Capability được chuẩn hóa từ initialize; lịch sử chọn load/resume tùy support | UI chỉ hiện tính năng backend hỗ trợ; giữ local history và revision của Enjoy độc lập với session provider. |
| Một kênh session update, gán session ID trước khi await load/resume | Lọc event theo attempt/session, nhận đúng replay và loại event trễ của job cũ. |
| Path detection riêng cho desktop và cấu hình command rõ ràng | Kiểm discovery trên packaged Electron; spawn bằng executable canonical + argv đã pin, ngoài job directory. |

Nguồn: [preset registry](https://github.com/RAIT-09/obsidian-agent-client/blob/55dc9e3a3d5bfa3e2b0535585e0ea096689eec85/src/services/preset-agents.ts#L99-L151), [environment và spawn](https://github.com/RAIT-09/obsidian-agent-client/blob/55dc9e3a3d5bfa3e2b0535585e0ea096689eec85/src/acp/acp-client.ts#L170-L263), [auth error handling](https://github.com/RAIT-09/obsidian-agent-client/blob/55dc9e3a3d5bfa3e2b0535585e0ea096689eec85/src/services/message-sender.ts#L886-L923), [path detection](https://github.com/RAIT-09/obsidian-agent-client/blob/55dc9e3a3d5bfa3e2b0535585e0ea096689eec85/src/ui/SettingsTab.ts#L1588-L1635).

Nguồn session: [capability converter](https://github.com/RAIT-09/obsidian-agent-client/blob/55dc9e3a3d5bfa3e2b0535585e0ea096689eec85/src/acp/type-converter.ts#L224-L270), [event filter](https://github.com/RAIT-09/obsidian-agent-client/blob/55dc9e3a3d5bfa3e2b0535585e0ea096689eec85/src/acp/acp-handler.ts#L47-L61), [history restoration](https://github.com/RAIT-09/obsidian-agent-client/blob/55dc9e3a3d5bfa3e2b0535585e0ea096689eec85/src/hooks/useSessionHistory.ts#L533-L617).

## Những điểm phải điều chỉnh cho Enjoy

Obsidian chủ động cho agent dùng MCP, skills và quyền hệ thống như chạy terminal. Enjoy có phạm vi bài học theo job nên không kế thừa toàn bộ environment, hooks và tool catalog rồi coi đó là isolation. ACP session MCP list không tự loại MCP trong cấu hình người dùng. [Phạm vi của plugin](https://github.com/RAIT-09/obsidian-agent-client/blob/55dc9e3a3d5bfa3e2b0535585e0ea096689eec85/README.md#security--permissions).

Source gửi `mcpServers: []` khi new/load/resume, tận dụng cấu hình agent có sẵn. Nếu dùng adapter này, Enjoy phải bổ sung scoped MCP của job và kiểm catalog thực tế. Cancel gửi notification rồi hủy thao tác cục bộ; disconnect mới kill process tree và không chờ xác nhận thoát. Enjoy giữ cơ chế chờ cleanup và vô hiệu capability đang có. [Session requests](https://github.com/RAIT-09/obsidian-agent-client/blob/55dc9e3a3d5bfa3e2b0535585e0ea096689eec85/src/acp/acp-client.ts#L496-L505), [cancel/disconnect](https://github.com/RAIT-09/obsidian-agent-client/blob/55dc9e3a3d5bfa3e2b0535585e0ea096689eec85/src/acp/acp-client.ts#L609-L698).

Plugin chạy qua login shell trên macOS/Linux để giải quyết PATH. Enjoy giữ discovery tách khỏi execution, vì login shell có thể bổ sung environment ngoài allowlist. Source có escaping rõ ràng, nhưng đó là mô hình môi trường khác. [Shell wrapper](https://github.com/RAIT-09/obsidian-agent-client/blob/55dc9e3a3d5bfa3e2b0535585e0ea096689eec85/src/utils/platform.ts#L580-L608).

Preset hướng dẫn cài adapter latest, không phải compatibility pin của Enjoy. Trước khi chọn ACP cần kiểm exact CLI + adapter versions, structured output, MCP scope, cancellation và native image bytes. UI nhận được ảnh đầu vào không chứng minh tạo ảnh đầu ra. [ACP support matrix](https://github.com/RAIT-09/obsidian-agent-client/blob/55dc9e3a3d5bfa3e2b0535585e0ea096689eec85/docs/reference/acp-support.md).

## Bằng chứng local và phần còn thiếu

`enjoy/scripts/check-native-existing-auth.mjs` đã đạt: Codex login status exit 0; Claude loggedIn=true và authMethod=claude.ai. Script chỉ xuất trường trạng thái đã chọn, không đọc file credential, không giữ raw output trong báo cáo. Các kiểm environment identity, loại credential env và missing binary cũng đạt.

Claude 2.1.263 trên máy này báo false nếu child thiếu USER, rồi true khi thêm USER trong cùng phép kiểm. Không dùng bare mode vì nó bỏ OAuth/keychain reads. Giữ HOME/USER cùng profile paths đã cấu hình, không tạo profile auth mới.

Production ProcessManager và spike inference cũ vẫn ép home riêng. Cần sửa execution policy và kiểm effective catalog trong profile hiện có trước khi nối generation. Auth status đạt không chứng minh quota, inference, ảnh hoặc toàn tuyến app đã đạt. Các tiêu chí nội dung, cancel, persistence và packaged acceptance trong kế hoạch vẫn giữ.
