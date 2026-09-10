export enum UserSettingKeyEnum {
  PROFILE = "profile",
  LANGUAGE = "language",
  NATIVE_LANGUAGE = "native_language",
  LEARNING_LANGUAGE = "learning_language",
  WHISPER = "whisper",
  OPENAI = "openai",
  ENJOYAI = "enjoyai",
  GEMINI = "gemini",
  VERTEX_EXPRESS = "vertex_express",
  DEEPSEEK = "deepseek",
  OPENROUTER = "openrouter",
  CLOUDFLARE_TRANSCRIBE = "cloudflare_transcribe",
  AZURE_SPEECH = "azure_speech",
  AZURE_OPENAI = "azure_openai",
  OLLAMA = "ollama",
  LMSTUDIO = "lmstudio",
  CODEX_ACP = "codex_acp",
  CLAUDE_ACP = "claude_acp",
  HOTKEYS = "hotkeys",
  GPT_ENGINE = "gpt_engine",
  STT_ENGINE = "stt_engine",
  TTS_CONFIG = "tts_config",
  PROVIDER_SELECTION_MIGRATION = "provider_selection_migration_v1",
  VOCABULARY = "vocabulary",
  DICTS = "dicts",
  RECORDER = "recorder",
  ECHOGARDEN = "echogarden",
  YOUTUBE_CHANNELS = "youtube_channels",
}

export enum SttEngineOptionEnum {
  AZURE_MAI = "azure_mai",
  AZURE_SPEECH = "azure_speech",
  LOCAL = "local",
  MAI_TRANSCRIBE = "mai_transcribe",
  CLOUDFLARE_WORKERS_AI = "cloudflare_workers_ai",
  ENJOY_AZURE = "enjoy_azure",
  ENJOY_CLOUDFLARE = "enjoy_cloudflare",
  OPENAI = "openai",
}

export enum AppSettingsKeyEnum {
  LIBRARY = "library",
  USER = "user",
  API_URL = "api_url",
}

export enum ChatTypeEnum {
  CONVERSATION = "CONVERSATION",
  GROUP = "GROUP",
  TTS = "TTS",
}

export enum ChatAgentTypeEnum {
  GPT = "GPT",
  TTS = "TTS",
}

export enum ChatMessageRoleEnum {
  USER = "USER",
  AGENT = "AGENT",
  SYSTEM = "SYSTEM",
}

export enum ChatMessageCategoryEnum {
  DEFAULT = "DEFAULT",
  MEMBER_JOINED = "MEMBER_JOINED",
  MEMBER_LEFT = "MEMBER_LEFT",
  CONTEXT_BREAK = "CONTEXT_BREAK",
}

export enum ChatMessageStateEnum {
  PENDING = "pending",
  COMPLETED = "completed",
}
