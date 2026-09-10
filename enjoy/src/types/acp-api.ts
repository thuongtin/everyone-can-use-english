export type AcpProvider = "codex" | "claude";

export type AcpConnectionStatus = {
  provider: AcpProvider;
  available: boolean;
  reason: string | null;
  models: { id: string; name: string }[];
  currentModel: string | null;
};

export type AcpTextRequest = {
  requestId: string;
  provider: AcpProvider;
  model?: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
};

export type AcpTextUpdate = {
  requestId: string;
  type: "started" | "text" | "completed";
  text?: string;
};

export interface AcpBridge {
  status(): Promise<AcpConnectionStatus[]>;
  invoke(request: AcpTextRequest): Promise<{ text: string; model: string | null }>;
  cancel(requestId: string): Promise<void>;
  onUpdate(callback: (update: AcpTextUpdate) => void): () => void;
}
