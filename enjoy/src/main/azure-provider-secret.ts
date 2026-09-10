import { safeStorage } from "electron";

type ProviderRecord = Record<string, unknown>;

const record = (value: unknown): ProviderRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Azure provider configuration is invalid.");
  }
  return value as ProviderRecord;
};

const requireEncryption = (): void => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure credential storage is unavailable.");
  }
};

export function encodeAzureProviderSecret(value: unknown): ProviderRecord {
  const source = record(value);
  if (source.credentialError === "azure_key_unavailable" &&
    (typeof source.key !== "string" || !source.key.trim())) {
    throw new Error("Enter the Azure key again before saving this configuration.");
  }
  const { key, encryptedKey: ignored, credentialError: ignoredError, ...config } = source;
  void ignored;
  void ignoredError;
  const secret = typeof key === "string" ? key.trim() : "";
  if (!secret) return config;
  requireEncryption();
  return { ...config, encryptedKey: safeStorage.encryptString(secret).toString("base64") };
}

export function decodeAzureProviderSecret(value: unknown): ProviderRecord {
  const { encryptedKey, ...config } = record(value);
  if (!encryptedKey) return config;
  requireEncryption();
  try {
    const key = safeStorage.decryptString(Buffer.from(String(encryptedKey), "base64")).trim();
    if (!key) throw new Error("empty key");
    return { ...config, key };
  } catch {
    throw new Error("The saved Azure provider key could not be decrypted.");
  }
}

/** A locked or damaged Azure key must not prevent unrelated providers from loading. */
export function readAzureProviderConfig(value: unknown): ProviderRecord {
  try {
    return decodeAzureProviderSecret(value);
  } catch {
    const source = value && typeof value === "object" && !Array.isArray(value)
      ? value as ProviderRecord : {};
    const { key: ignoredKey, encryptedKey: ignoredCipher, ...config } = source;
    void ignoredKey;
    void ignoredCipher;
    return { ...config, credentialError: "azure_key_unavailable" };
  }
}
