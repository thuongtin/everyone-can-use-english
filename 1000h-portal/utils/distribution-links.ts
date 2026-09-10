import { isRetiredEnjoyHostname } from "../../enjoy/src/lib/network-policy";

export type DistributionLinks = {
  docsUrl: string;
  downloadUrl: string;
  repositoryUrl: string;
};

export type DistributionRuntimeConfig = Partial<DistributionLinks>;

const VERIFIED_REPOSITORY_URL =
  "https://github.com/thuongtin/everyone-can-use-english";

export const DEFAULT_DISTRIBUTION_LINKS: Readonly<DistributionLinks> =
  Object.freeze({
    docsUrl: `${VERIFIED_REPOSITORY_URL}/blob/main/README.md`,
    downloadUrl: `${VERIFIED_REPOSITORY_URL}/blob/main/1000-hours/enjoy-app/install.md`,
    repositoryUrl: VERIFIED_REPOSITORY_URL,
  });

export function isValidHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }

  try {
    const url = new URL(value.trim());

    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0 &&
      !isRetiredEnjoyHostname(url.hostname) &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

function resolveLink(value: unknown, fallback: string): string {
  return isValidHttpUrl(value) ? value.trim() : fallback;
}

export function resolveDistributionLinks(
  config: DistributionRuntimeConfig = {},
): DistributionLinks {
  return {
    docsUrl: resolveLink(config.docsUrl, DEFAULT_DISTRIBUTION_LINKS.docsUrl),
    downloadUrl: resolveLink(
      config.downloadUrl,
      DEFAULT_DISTRIBUTION_LINKS.downloadUrl,
    ),
    repositoryUrl: resolveLink(
      config.repositoryUrl,
      DEFAULT_DISTRIBUTION_LINKS.repositoryUrl,
    ),
  };
}

export function resolveConfiguredSiteUrl(value: unknown): string | undefined {
  return isValidHttpUrl(value) ? value.trim() : undefined;
}
