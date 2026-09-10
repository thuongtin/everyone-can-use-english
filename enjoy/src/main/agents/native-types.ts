import type { ExecutablePin } from "./process-manager";

export type NativeAgentProvider = "codex" | "claude";

export type NativeAgentProbe = {
  provider: NativeAgentProvider;
  executable: ExecutablePin | null;
  version: string | null;
  authenticated: boolean;
  text: boolean;
  image: boolean;
  reason: string | null;
};

export type NativeAgentEvent = {
  type: "started" | "tool" | "text" | "completed";
  toolName?: string;
  text?: string;
};

export type NativeImageResult = {
  bytes: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  providerItemId: string;
};

export type NativeAgentRequest = {
  executable: ExecutablePin;
  workspace: string;
  privateHome: string;
  prompt: string;
  systemPrompt?: string;
  model?: string;
  mcp?: { url: string; token: string };
  outputSchema?: Record<string, unknown>;
  image?: boolean;
  timeoutMs?: number;
  signal: AbortSignal;
  onEvent?: (event: NativeAgentEvent) => void;
};

export type NativeAgentResult = {
  provider: NativeAgentProvider;
  text: string;
  images: NativeImageResult[];
  model: string | null;
};

export interface NativeAgentAdapter {
  run(request: NativeAgentRequest): Promise<NativeAgentResult>;
}

export class NativeAgentError extends Error {
  constructor(readonly code: string, readonly cleanup?: () => Promise<void>) {
    super(code);
    this.name = "NativeAgentError";
  }
}
