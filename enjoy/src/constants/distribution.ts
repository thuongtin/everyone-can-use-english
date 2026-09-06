export type DistributionConfig = {
  updateFeedUrl?: string;
  repositoryUrl: string;
  docsUrl: string;
  downloadUrl: string;
};

export type DistributionEnvironment = Partial<
  Record<
    | "ENJOY_UPDATE_FEED_URL"
    | "ENJOY_DOWNLOAD_URL"
    | "ENJOY_DOCS_URL"
    | "ENJOY_REPO_URL",
    string | undefined
  >
>;

export const DEFAULT_REPOSITORY_URL =
  "https://github.com/thuongtin/everyone-can-use-english";

const isSafeHttpUrl = (value: unknown, protocol?: "http:" | "https:") => {
  if (typeof value !== "string" || !value.trim()) return false;

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (protocol && url.protocol !== protocol) return false;
    if (!url.hostname || url.username || url.password) return false;
    return true;
  } catch {
    return false;
  }
};

const readHttpUrl = (value: unknown, fallback: string) =>
  isSafeHttpUrl(value) ? (value as string).trim() : fallback;

const readUpdateFeedUrl = (value: unknown) =>
  isSafeHttpUrl(value, "https:") ? (value as string).trim() : undefined;

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export const resolveDistributionConfig = (
  environment: DistributionEnvironment = {}
): DistributionConfig => {
  const repositoryUrl = readHttpUrl(
    environment.ENJOY_REPO_URL,
    DEFAULT_REPOSITORY_URL
  );
  const sourceRepositoryUrl = stripTrailingSlash(repositoryUrl);

  const docsUrl = readHttpUrl(
    environment.ENJOY_DOCS_URL,
    `${sourceRepositoryUrl}/blob/main/README.md`
  );
  const downloadUrl = readHttpUrl(
    environment.ENJOY_DOWNLOAD_URL,
    `${sourceRepositoryUrl}/releases`
  );
  const updateFeedUrl = readUpdateFeedUrl(environment.ENJOY_UPDATE_FEED_URL);

  return {
    ...(updateFeedUrl ? { updateFeedUrl } : {}),
    repositoryUrl,
    docsUrl,
    downloadUrl,
  };
};

const buildEnvironment: DistributionEnvironment = {
  ENJOY_UPDATE_FEED_URL: process.env.ENJOY_UPDATE_FEED_URL,
  ENJOY_DOWNLOAD_URL: process.env.ENJOY_DOWNLOAD_URL,
  ENJOY_DOCS_URL: process.env.ENJOY_DOCS_URL,
  ENJOY_REPO_URL: process.env.ENJOY_REPO_URL,
};

export const DISTRIBUTION_CONFIG = resolveDistributionConfig(buildEnvironment);
