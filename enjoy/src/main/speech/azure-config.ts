import { safeStorage } from "electron";
import { UserSetting } from "@main/db/models";
import { UserSettingKeyEnum } from "@/types/enums";

export type AzureSpeechConfig = Readonly<{
  region: string;
  endpoint: string;
  configured: boolean;
  transcriptionConfigured: boolean;
}>;

export type AzureSpeechConfigUpdate = Readonly<{
  region?: unknown;
  endpoint?: unknown;
  key?: unknown;
  clearKey?: unknown;
}>;

type StoredAzureSpeechConfig = {
  region: string;
  endpoint?: string;
  encryptedKey?: string;
};

export class AzureSpeechConfigError extends Error {
  readonly code = "speech_not_configured";

  constructor(message: string) {
    super(message);
    this.name = "AzureSpeechConfigError";
  }
}

const cleanString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const normalizeRegion = (value: unknown): string => {
  const region = cleanString(value).toLowerCase();
  if (region && !/^[a-z0-9-]+$/u.test(region)) {
    throw new AzureSpeechConfigError("Azure Speech region is invalid.");
  }
  return region;
};

const normalizeEndpoint = (value: unknown): string => {
  const endpoint = cleanString(value);
  if (!endpoint) return "";
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      url.search || url.hash || (url.pathname !== "/" && url.pathname !== "") ||
      !/^[a-z0-9][a-z0-9-]*\.cognitiveservices\.azure\.com$/u.test(url.hostname)) {
      throw new Error("invalid endpoint");
    }
    return url.origin;
  } catch {
    throw new AzureSpeechConfigError("Use the Azure resource HTTPS endpoint, such as https://resource.cognitiveservices.azure.com.");
  }
};

const publicConfig = (stored: StoredAzureSpeechConfig): AzureSpeechConfig => ({
  region: stored.region,
  endpoint: stored.endpoint || "",
  configured: Boolean(stored.region && stored.encryptedKey),
  transcriptionConfigured: Boolean(stored.endpoint && stored.encryptedKey),
});

async function readStored(): Promise<StoredAzureSpeechConfig> {
  const raw = await UserSetting.get(UserSettingKeyEnum.AZURE_SPEECH);
  const encryptedKey = cleanString(raw?.encryptedKey);
  return {
    region: normalizeRegion(raw?.region),
    endpoint: normalizeEndpoint(raw?.endpoint),
    ...(encryptedKey ? { encryptedKey } : {}),
  };
}

function requireEncryption(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new AzureSpeechConfigError(
      "Secure credential storage is unavailable."
    );
  }
}

export async function getAzureSpeechConfig(): Promise<AzureSpeechConfig> {
  const stored = await readStored();
  return publicConfig(stored);
}

export async function getAzureSpeechCredentials(): Promise<{
  subscriptionKey: string;
  region: string;
  endpoint: string;
}> {
  const stored = await readStored();
  if (!stored.region || !stored.encryptedKey) {
    throw new AzureSpeechConfigError("Azure Speech is not configured.");
  }
  return { subscriptionKey: decryptStoredKey(stored), region: stored.region, endpoint: stored.endpoint || "" };
}

export async function getAzureTranscriptionCredentials(): Promise<{
  key: string;
  endpoint: string;
  region?: string;
}> {
  const stored = await readStored();
  if (!stored.endpoint || !stored.encryptedKey) {
    throw new AzureSpeechConfigError("Azure transcription is not configured.");
  }
  return { key: decryptStoredKey(stored), endpoint: stored.endpoint, region: stored.region || undefined };
}

function decryptStoredKey(stored: StoredAzureSpeechConfig): string {
  requireEncryption();
  try {
    const subscriptionKey = safeStorage
      .decryptString(Buffer.from(stored.encryptedKey || "", "base64"))
      .trim();
    if (!subscriptionKey) {
      throw new Error("empty key");
    }
    return subscriptionKey;
  } catch {
    throw new AzureSpeechConfigError(
      "The saved Azure Speech key could not be decrypted."
    );
  }
}

export async function setAzureSpeechConfig(
  update: AzureSpeechConfigUpdate
): Promise<AzureSpeechConfig> {
  const key = cleanString(update?.key);
  const clearKey = update?.clearKey === true;
  if (key && clearKey) {
    throw new AzureSpeechConfigError("Set or clear the key in one operation.");
  }

  const stored = await readStored();
  const region = update?.region === undefined ? stored.region : normalizeRegion(update.region);
  const endpoint = update?.endpoint === undefined ? stored.endpoint || "" : normalizeEndpoint(update.endpoint);
  if (stored.region && region !== stored.region && stored.encryptedKey && !key) {
    throw new AzureSpeechConfigError(
      "Enter the Azure Speech key again when changing the region."
    );
  }
  if (stored.endpoint && endpoint !== stored.endpoint && stored.encryptedKey && !key && !clearKey) {
    throw new AzureSpeechConfigError("Enter the Azure Speech key again when changing the endpoint.");
  }

  let encryptedKey = clearKey ? undefined : stored.encryptedKey;
  if (key) {
    requireEncryption();
    encryptedKey = safeStorage.encryptString(key).toString("base64");
  }
  await UserSetting.set(UserSettingKeyEnum.AZURE_SPEECH, {
    region,
    endpoint,
    ...(encryptedKey ? { encryptedKey } : {}),
  });
  return publicConfig({ region, endpoint, encryptedKey });
}
