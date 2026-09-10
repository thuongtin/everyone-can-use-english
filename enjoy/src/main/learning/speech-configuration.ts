import type { ClientOptions } from "openai";

import {
  buildOpenAiSpeechRequest,
  resolveTtsModel,
  selectCanonicalOpenAiConfig,
} from "@/lib/speech-models";
import { UserSettingKeyEnum } from "@/types/enums";
import type { SpeechProvider } from "@main/speech/provider";

export type LearningSpeechConfigurationErrorCode = "speech_not_configured";

export class LearningSpeechConfigurationError extends Error {
  readonly code: LearningSpeechConfigurationErrorCode;

  constructor(message = "Learning speech is not configured") {
    super(message);
    this.name = "LearningSpeechConfigurationError";
    this.code = "speech_not_configured";
  }
}

type StoredTtsConfiguration = Readonly<{
  engine?: unknown;
  model?: unknown;
  voice?: unknown;
  baseUrl?: unknown;
}>;

type StoredOpenAiConfiguration = Readonly<{
  key?: unknown;
  baseUrl?: unknown;
}>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function notConfigured(): never {
  throw new LearningSpeechConfigurationError();
}

export async function createConfiguredLearningSpeechProvider(): Promise<SpeechProvider | null> {
  const { UserSetting } = await import("@main/db/models/user-setting");
  const storedValue = await UserSetting.get(UserSettingKeyEnum.TTS_CONFIG);
  if (storedValue === null || storedValue === undefined) return null;

  const configuration = asRecord(storedValue) as StoredTtsConfiguration | null;
  if (!configuration) return notConfigured();

  let resolved;
  try {
    resolved = resolveTtsModel(configuration.engine, configuration.model);
  } catch {
    return notConfigured();
  }

  const voice = trimmedString(configuration.voice);
  if (!voice) return notConfigured();
  if (resolved.provider === "azure") {
    try {
      const [{ getAzureSpeechCredentials }, providerModule] = await Promise.all([
        import("@main/speech/azure-config"),
        import("@main/speech/provider"),
      ]);
      return providerModule.createAzureSpeechProvider({
        configuration: Object.freeze({
          engine: "azure",
          model: resolved.model,
          voice,
        }),
        credentials: await getAzureSpeechCredentials(),
      });
    } catch {
      return notConfigured();
    }
  }

  let validatedVoice: string;
  try {
    validatedVoice = buildOpenAiSpeechRequest({
      engine: resolved.engine,
      model: resolved.model,
      voice,
      text: "learning speech configuration validation",
    }).voice;
  } catch {
    return notConfigured();
  }

  const { default: settings } = await import("@main/settings");
  const canonicalConfig = await UserSetting.get(UserSettingKeyEnum.OPENAI);
  const savedConfig = selectCanonicalOpenAiConfig(
    canonicalConfig as StoredOpenAiConfiguration | null | undefined,
    () => settings.getSync("openai") as StoredOpenAiConfiguration | null,
  );
  const apiKey = trimmedString(savedConfig?.key);
  if (!apiKey) return notConfigured();
  const baseURL =
    trimmedString(configuration.baseUrl) ||
    trimmedString(savedConfig?.baseUrl) ||
    undefined;

  const [{ default: proxyAgent }, providerModule] = await Promise.all([
    import("@main/proxy-agent"),
    import("@main/speech/provider"),
  ]);
  const proxy = proxyAgent();
  const clientOptions: ClientOptions = {
    apiKey,
    baseURL,
    httpAgent: proxy.httpAgent,
    // node-fetch and OpenAI expose structurally compatible adapters with
    // different RequestInfo declarations.
    fetch: proxy.fetch as unknown as ClientOptions["fetch"],
  };
  const providerConfiguration = Object.freeze({
    engine: resolved.engine,
    model: resolved.model,
    voice: validatedVoice,
  });

  try {
    return Object.freeze(
      providerModule.createOpenAiSpeechProvider({
        configuration: providerConfiguration,
        clientOptions,
      }),
    );
  } catch {
    return notConfigured();
  }
}
