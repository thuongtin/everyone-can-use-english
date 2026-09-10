import { textCommand } from "../commands/text.command";
import type { ChatModelOptions } from "./chat-model";
import { briefSuggestionPrompt, parseBriefSuggestion } from "./learning-brief-suggestion";
import type { LessonBrief, RawBriefInput } from "../types/learning";

export type AzureBriefSuggestionConfig = Readonly<
  Required<Pick<ChatModelOptions, "key" | "baseUrl" | "modelName">> &
    Pick<ChatModelOptions, "maxTokens">
>;

/** Suggests the same reviewable brief through the configured Azure deployment. */
export async function suggestLessonBriefWithAzure(
  input: RawBriefInput,
  config: AzureBriefSuggestionConfig,
  signal: AbortSignal,
): Promise<LessonBrief> {
  if (signal.aborted) throw new DOMException("Suggestion cancelled", "AbortError");
  try {
    const text = await textCommand(briefSuggestionPrompt(input), {
      ...config,
      provider: "azure-openai",
      signal,
    });
    if (signal.aborted) throw new DOMException("Suggestion cancelled", "AbortError");
    return parseBriefSuggestion(input, text);
  } catch (error) {
    if (signal.aborted) throw new DOMException("Suggestion cancelled", "AbortError");
    const message = error instanceof Error ? error.message : "";
    if (/401|403|unauthori[sz]ed|authentication|api.?key/iu.test(message)) {
      throw new Error("Azure OpenAI chưa xác thực được API key. Hãy kiểm tra cấu hình trong Dịch vụ AI.");
    }
    if (/429|quota|rate.?limit/iu.test(message)) {
      throw new Error("Azure OpenAI đã hết hạn mức hoặc đang giới hạn yêu cầu. Hãy thử lại sau.");
    }
    if (/timeout|timed out/iu.test(message)) {
      throw new Error("Azure OpenAI phản hồi quá lâu. Hãy thử lại.");
    }
    throw new Error("Gợi ý Azure chưa hoàn tất hoặc chưa đúng định dạng. Bạn có thể thử lại; đầu vào vẫn được giữ nguyên.");
  }
}
