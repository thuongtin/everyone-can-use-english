import { runAcpSession } from "./acp-client";
import {
  NativeAgentError,
  type NativeAgentAdapter,
  type NativeAgentProvider,
  type NativeAgentRequest,
  type NativeAgentResult,
} from "./native-types";

function assertProvider(provider: NativeAgentProvider): void {
  if (provider !== "codex" && provider !== "claude") {
    throw new TypeError("unsupported_provider");
  }
}

/** Text-only ACP adapter. Codex image generation remains on CodexNativeAgent. */
export class AcpNativeAgent implements NativeAgentAdapter {
  constructor(private readonly provider: NativeAgentProvider) {
    assertProvider(provider);
  }

  async run(request: NativeAgentRequest): Promise<NativeAgentResult> {
    if (request.image) throw new NativeAgentError("native_image_unsupported");
    const result = await runAcpSession({
      provider: this.provider,
      executable: request.executable,
      workspace: request.workspace,
      privateHome: request.privateHome,
      prompt: request.prompt,
      systemPrompt: request.systemPrompt,
      model: request.model,
      mcp: request.mcp,
      timeoutMs: request.timeoutMs,
      signal: request.signal,
      onEvent: request.onEvent,
    });
    return {
      provider: this.provider,
      text: result.text,
      images: [],
      model: result.model,
    };
  }
}
