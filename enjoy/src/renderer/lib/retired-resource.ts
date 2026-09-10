import { isRetiredEnjoyUrl } from "@/lib/network-policy";

export type DisplayResource = Readonly<{
  url?: string;
  retired: boolean;
}>;

export const resolveDisplayResource = (value: unknown): DisplayResource => {
  if (typeof value !== "string" || !value.trim()) {
    return { retired: false };
  }

  const url = value.trim();
  const policyUrl = url.startsWith("//") ? `https:${url}` : url;
  if (isRetiredEnjoyUrl(policyUrl)) {
    return { retired: true };
  }

  return { url, retired: false };
};

export const displayableResourceUrl = (value: unknown): string | undefined =>
  resolveDisplayResource(value).url;
