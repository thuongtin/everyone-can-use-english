type ConversationEngineId =
  | "enjoyai"
  | "openai"
  | "gemini"
  | "deepseek"
  | "openrouter"
  | "ollama"
  | "lmstudio"
  | "google-generative-ai";

type ConversationEngine = ConversationEngineId | (string & {});

type ConversationType = {
  id: string;
  type: "gpt" | "tts";
  engine: ConversationEngine;
  name: string;
  configuration: { [key: string]: any };
  model: string;
  language?: string;
  messages?: MessageType[];
  createdAt?: string;
};
