import { safeStorage } from "electron";
import { UserSetting } from "@main/db/models";
import { UserSettingKeyEnum } from "@/types/enums";
import type {
  CloudflareTranscribeConfig,
  CloudflareTranscribeConfigUpdate,
} from "@/types/cloudflare-transcribe";
import {
  CloudflareTranscribeError,
  normalizeCloudflareBaseUrl,
} from "./service";

type StoredConfig = { baseUrl: string; encryptedToken?: string };

const cleanString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

async function readStored(): Promise<StoredConfig> {
  const raw = await UserSetting.get(UserSettingKeyEnum.CLOUDFLARE_TRANSCRIBE);
  return {
    baseUrl: cleanString(raw?.baseUrl),
    ...(cleanString(raw?.encryptedToken)
      ? { encryptedToken: cleanString(raw.encryptedToken) }
      : {}),
  };
}

function decryptToken(encryptedToken?: string): string | null {
  if (!encryptedToken) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new CloudflareTranscribeError(
      "cf_failed",
      "Secure credential storage is unavailable."
    );
  }
  try {
    return safeStorage.decryptString(Buffer.from(encryptedToken, "base64")).trim() || null;
  } catch {
    throw new CloudflareTranscribeError(
      "cf_failed",
      "The saved Cloudflare Worker token could not be decrypted."
    );
  }
}

export async function getCloudflareTranscribeConfig(): Promise<CloudflareTranscribeConfig> {
  const stored = await readStored();
  return {
    baseUrl: stored.baseUrl,
    configured: Boolean(stored.baseUrl && stored.encryptedToken),
  };
}

export async function getCloudflareTranscribeSecretConfig(): Promise<{
  baseUrl: string;
  token: string | null;
}> {
  const stored = await readStored();
  return { baseUrl: stored.baseUrl, token: decryptToken(stored.encryptedToken) };
}

export async function setCloudflareTranscribeConfig(
  update: CloudflareTranscribeConfigUpdate
): Promise<CloudflareTranscribeConfig> {
  const baseUrl = normalizeCloudflareBaseUrl(update?.baseUrl);
  const token = cleanString(update?.token);
  const stored = await readStored();
  if (token && update?.clearToken) {
    throw new CloudflareTranscribeError(
      "cf_failed",
      "Set or clear the token in one operation."
    );
  }
  if (
    stored.baseUrl &&
    baseUrl !== stored.baseUrl &&
    stored.encryptedToken &&
    !token
  ) {
    throw new CloudflareTranscribeError(
      "cf_failed",
      "Enter the app token again when changing the Worker URL."
    );
  }
  let encryptedToken = update?.clearToken ? undefined : stored.encryptedToken;
  if (token) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new CloudflareTranscribeError(
        "cf_failed",
        "Secure credential storage is unavailable."
      );
    }
    encryptedToken = safeStorage.encryptString(token).toString("base64");
  }
  await UserSetting.set(UserSettingKeyEnum.CLOUDFLARE_TRANSCRIBE, {
    baseUrl,
    ...(encryptedToken ? { encryptedToken } : {}),
  });
  return { baseUrl, configured: Boolean(encryptedToken) };
}
