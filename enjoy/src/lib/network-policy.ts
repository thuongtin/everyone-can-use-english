const RETIRED_ENJOY_ROOT = "enjoy.bot";
const RETIRED_ENJOY_ALIASES = new Set([
  "api.getenjoyapp.com",
  "enjoy-storage.baizhiheizi.com",
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_REDIRECT_HEADERS = [
  "authorization",
  "cookie",
  "proxy-authorization",
  "api-key",
  "x-api-key",
  "x-goog-api-key",
  "x-goog-user-project",
  "ocp-apim-subscription-key",
];

export type NetworkPolicyContext = Readonly<{
  transport: string;
  operation: string;
}>;

export type LegacyBackendAttempt = NetworkPolicyContext & Readonly<{
  url?: string | URL;
  hostname?: string;
}>;

export type NetworkPolicyDiagnostics = Readonly<{
  blockedAttemptCount: number;
  legacyBackendOperationCount: number;
  observedRequestCount: number;
  blockedAttempts: Readonly<Record<string, number>>;
  legacyBackendOperations: Readonly<Record<string, number>>;
  observedRequests: Readonly<Record<string, number>>;
}>;

export type ObservedNetworkRequest = Readonly<{
  transport: string;
  hostname: string;
}>;

type FetchResponse = {
  status: number;
  type?: string;
  headers: { get(name: string): string | null };
};

export type GuardedFetchInput = string | URL | Request;

type FetchImplementation<TResponse extends FetchResponse> = (
  input: GuardedFetchInput,
  init?: RequestInit,
) => Promise<TResponse>;

const counters = {
  blockedAttemptCount: 0,
  legacyBackendOperationCount: 0,
  observedRequestCount: 0,
  blockedAttempts: new Map<string, number>(),
  legacyBackendOperations: new Map<string, number>(),
  observedRequests: new Map<string, number>(),
};

function safeDimension(value: string, fallback: string): string {
  const trimmed = value.trim().split(/[?#\s]/u, 1)[0];
  const safe = trimmed.replace(/[^a-zA-Z0-9._:/-]+/gu, "_").slice(0, 80);
  return safe || fallback;
}

function increment(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function diagnosticKey(context: NetworkPolicyContext, hostname: string): string {
  return [
    safeDimension(context.transport, "unknown-transport"),
    safeDimension(context.operation, "unknown-operation"),
    normalizeNetworkHostname(hostname) || "unknown-host",
  ].join("|");
}

function observedRequestKey(transport: string, hostname: string): string {
  return [
    safeDimension(transport, "unknown-transport"),
    normalizeNetworkHostname(hostname) || "unknown-host",
  ].join("|");
}

function parseUrl(value: unknown): URL | undefined {
  try {
    if (value instanceof URL) return new URL(value.href);
    if (typeof value === "string") return new URL(value);
    if (value && typeof value === "object" && "url" in value) {
      const requestUrl = (value as { url?: unknown }).url;
      if (typeof requestUrl === "string") return new URL(requestUrl);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function recordBlockedAttempt(context: NetworkPolicyContext, hostname: string): void {
  counters.blockedAttemptCount += 1;
  increment(counters.blockedAttempts, diagnosticKey(context, hostname));
}

export function normalizeNetworkHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.+$/u, "");
}

export function isRetiredEnjoyHostname(hostname: string): boolean {
  const normalized = normalizeNetworkHostname(hostname);
  return normalized === RETIRED_ENJOY_ROOT
    || normalized.endsWith(`.${RETIRED_ENJOY_ROOT}`)
    || RETIRED_ENJOY_ALIASES.has(normalized);
}

export function isRetiredEnjoyUrl(value: unknown): boolean {
  const parsed = parseUrl(value);
  return parsed ? isRetiredEnjoyHostname(parsed.hostname) : false;
}

export class NetworkPolicyError extends Error {
  readonly code:
    | "invalid_network_url"
    | "non_local_media_path"
    | "retired_enjoy_host"
    | "redirect_disallowed"
    | "redirect_body_not_replayable"
    | "redirect_uninspectable";
  readonly hostname?: string;
  readonly transport: string;
  readonly operation: string;

  constructor(
    code: NetworkPolicyError["code"],
    context: NetworkPolicyContext,
    hostname?: string,
  ) {
    const normalizedHostname = hostname ? normalizeNetworkHostname(hostname) : undefined;
    const safeTransport = safeDimension(context.transport, "unknown-transport");
    const safeOperation = safeDimension(context.operation, "unknown-operation");
    const message = code === "retired_enjoy_host"
      ? `Blocked retired Enjoy host ${normalizedHostname || "unknown-host"}.`
      : code === "non_local_media_path"
        ? "The subprocess only accepts a local filesystem media path."
      : code === "redirect_body_not_replayable"
        ? "The network adapter cannot safely replay this request body after a redirect."
      : code === "redirect_uninspectable"
        ? "The network adapter cannot inspect this redirect destination."
      : code === "redirect_disallowed"
        ? "The network adapter does not allow redirects for this operation."
        : "The network request URL is invalid.";
    super(message);
    this.name = "NetworkPolicyError";
    this.code = code;
    this.hostname = normalizedHostname;
    this.transport = safeTransport;
    this.operation = safeOperation;
  }
}

export function assertLocalSubprocessMediaPath(
  value: unknown,
  context: NetworkPolicyContext,
): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new NetworkPolicyError("non_local_media_path", context);
  }
  const inspectedValue = value.trim();

  // A drive-letter path is local even though its colon resembles a URI scheme.
  if (/^[a-zA-Z]:[\\/]/u.test(inspectedValue)) return value;

  if (/^[\\/]{2}/u.test(inspectedValue)) {
    throw new NetworkPolicyError("non_local_media_path", context);
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/u.test(inspectedValue)) {
    // Record a retired-host attempt with the same sanitized diagnostics as fetch.
    assertAllowedNetworkUrl(inspectedValue, context);
    throw new NetworkPolicyError("non_local_media_path", context);
  }

  return value;
}

export function assertAllowedNetworkUrl(
  value: unknown,
  context: NetworkPolicyContext,
): URL {
  const parsed = parseUrl(value);
  if (!parsed) throw new NetworkPolicyError("invalid_network_url", context);
  const hostname = normalizeNetworkHostname(parsed.hostname);
  if (isRetiredEnjoyHostname(hostname)) {
    recordBlockedAttempt(context, hostname);
    throw new NetworkPolicyError("retired_enjoy_host", context, hostname);
  }
  return parsed;
}

export function noteLegacyBackendAttempt(attempt: LegacyBackendAttempt): void {
  const parsed = attempt.url ? parseUrl(attempt.url) : undefined;
  const hostname = parsed?.hostname || attempt.hostname || "unknown-host";
  counters.legacyBackendOperationCount += 1;
  increment(counters.legacyBackendOperations, diagnosticKey(attempt, hostname));
}

export function noteObservedNetworkRequest(request: ObservedNetworkRequest): void {
  const hostname = normalizeNetworkHostname(request.hostname);
  if (!hostname) return;
  counters.observedRequestCount += 1;
  increment(counters.observedRequests, observedRequestKey(request.transport, hostname));
}

export function getNetworkPolicyDiagnostics(): NetworkPolicyDiagnostics {
  return Object.freeze({
    blockedAttemptCount: counters.blockedAttemptCount,
    legacyBackendOperationCount: counters.legacyBackendOperationCount,
    observedRequestCount: counters.observedRequestCount,
    blockedAttempts: Object.freeze(Object.fromEntries(counters.blockedAttempts)),
    legacyBackendOperations: Object.freeze(Object.fromEntries(counters.legacyBackendOperations)),
    observedRequests: Object.freeze(Object.fromEntries(counters.observedRequests)),
  });
}

function headersWithoutCredentials(headers: HeadersInit | undefined): Headers | undefined {
  if (!headers) return undefined;
  const safeHeaders = new Headers(headers);
  for (const name of SENSITIVE_REDIRECT_HEADERS) safeHeaders.delete(name);
  return safeHeaders;
}

function redirectInit(
  init: RequestInit,
  status: number,
  from: URL,
  to: URL,
): RequestInit {
  const next: RequestInit = { ...init, redirect: "manual" };
  if (from.origin !== to.origin) next.headers = headersWithoutCredentials(init.headers);

  const method = (init.method || "GET").toUpperCase();
  if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
    next.method = "GET";
    delete next.body;
    const headers = new Headers(next.headers);
    headers.delete("content-length");
    headers.delete("content-type");
    next.headers = headers;
  }
  return next;
}

function isRequestInput(input: GuardedFetchInput): input is Request {
  return typeof input === "object"
    && !(input instanceof URL)
    && typeof input.url === "string"
    && typeof input.method === "string"
    && typeof input.headers === "object";
}

function initialRequestInit(input: GuardedFetchInput, init: RequestInit): RequestInit {
  if (!isRequestInput(input)) return { ...init };
  return {
    method: input.method,
    headers: input.headers,
    body: input.body,
    cache: input.cache,
    credentials: input.credentials,
    integrity: input.integrity,
    keepalive: input.keepalive,
    mode: input.mode,
    referrer: input.referrer,
    referrerPolicy: input.referrerPolicy,
    signal: input.signal,
    ...init,
  };
}

function isReplayableRedirectBody(body: BodyInit | null | undefined): boolean {
  if (body == null || typeof body === "string") return true;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return true;
  if (typeof Blob !== "undefined" && body instanceof Blob) return true;
  if (typeof FormData !== "undefined" && body instanceof FormData) return true;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return true;
  return false;
}

export function createGuardedFetch<TResponse extends FetchResponse>(
  fetchImplementation: FetchImplementation<TResponse>,
  context: NetworkPolicyContext,
): FetchImplementation<TResponse> {
  return async (input, init = {}) => {
    let currentUrl = assertAllowedNetworkUrl(input, context);
    let currentInput: GuardedFetchInput = input;
    let effectiveInit = initialRequestInit(input, init);
    const redirectMode = init.redirect
      ?? (isRequestInput(input) ? input.redirect : undefined)
      ?? "follow";
    let currentInit: RequestInit = { ...init, redirect: "manual" };

    for (let redirectCount = 0; redirectCount <= 20; redirectCount += 1) {
      const response = await fetchImplementation(currentInput, currentInit);
      if (response.type === "opaqueredirect") {
        if (redirectMode === "manual") return response;
        throw new NetworkPolicyError("redirect_uninspectable", context);
      }
      if (!REDIRECT_STATUSES.has(response.status)) return response;

      const location = response.headers.get("location");
      if (!location) return response;
      if (redirectMode === "manual") return response;
      if (redirectMode === "error") {
        throw new NetworkPolicyError("redirect_disallowed", context);
      }
      if (redirectCount === 20) {
        throw new NetworkPolicyError("redirect_disallowed", context);
      }

      let redirectUrl: URL;
      try {
        redirectUrl = new URL(location, currentUrl);
      } catch {
        throw new NetworkPolicyError("invalid_network_url", context);
      }
      const nextUrl = assertAllowedNetworkUrl(redirectUrl, context);
      const nextInit = redirectInit(effectiveInit, response.status, currentUrl, nextUrl);
      if (!isReplayableRedirectBody(nextInit.body)) {
        throw new NetworkPolicyError("redirect_body_not_replayable", context);
      }
      effectiveInit = nextInit;
      currentInit = effectiveInit;
      currentInput = nextUrl;
      currentUrl = nextUrl;
    }

    throw new NetworkPolicyError("redirect_disallowed", context);
  };
}
