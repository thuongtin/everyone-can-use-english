import type { IpcMainInvokeEvent } from "electron";

const MAX_CONTEXT_ID_LENGTH = 200;
const IPC_SENDER_DENIED = "learning_ipc_sender_denied" as const;
const CONTEXT_DENIED = "learning_context_denied" as const;
const EXPECTED_URL_INVALID = "learning_ipc_expected_url_invalid" as const;

type GuardErrorCode = typeof IPC_SENDER_DENIED | typeof CONTEXT_DENIED | typeof EXPECTED_URL_INVALID;

const guardError = (code: GuardErrorCode): Error => Object.assign(new Error(code), { code });

type PinnedUrl = Readonly<{
  protocol: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  encodedPath: string;
}>;

const hasMalformedPercentEncoding = (value: string): boolean => /%(?![0-9a-f]{2})/iu.test(value);

const rawPath = (value: string): string => {
  const schemeEnd = value.indexOf("://");
  if (schemeEnd < 0) return "";
  const authorityEnd = value.indexOf("/", schemeEnd + 3);
  const queryEnd = value.search(/[?#]/u);
  const end = queryEnd < 0 ? value.length : queryEnd;
  return authorityEnd >= 0 && authorityEnd < end ? value.slice(authorityEnd, end) : "";
};

const hasPathAlias = (value: string): boolean => {
  const path = rawPath(value);
  return /(?:^|\/)(?:\.{1,2})(?:\/|$)/u.test(path) || /%2e/iu.test(path);
};

const parsePinnedUrl = (value: unknown): PinnedUrl => {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || hasMalformedPercentEncoding(value) || hasPathAlias(value)) {
    throw guardError(EXPECTED_URL_INVALID);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw guardError(EXPECTED_URL_INVALID);
  }
  if (!(["http:", "https:", "file:"] as readonly string[]).includes(parsed.protocol) || parsed.username || parsed.password) {
    throw guardError(EXPECTED_URL_INVALID);
  }
  if (parsed.protocol === "file:" && (!value.startsWith("file:///") || parsed.hostname !== "" || parsed.pathname.length === 0)) {
    throw guardError(EXPECTED_URL_INVALID);
  }
  if ((parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname.length === 0) {
    throw guardError(EXPECTED_URL_INVALID);
  }
  return Object.freeze({
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port,
    pathname: parsed.pathname,
    search: parsed.search,
    encodedPath: rawPath(value),
  });
};

const samePinnedUrl = (expected: PinnedUrl, actual: unknown): boolean => {
  if (typeof actual !== "string" || actual.length === 0 || hasMalformedPercentEncoding(actual) || hasPathAlias(actual)) return false;
  let parsed: URL;
  try {
    parsed = new URL(actual);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password || parsed.protocol !== expected.protocol) return false;
  if (parsed.protocol === "file:" && (!actual.startsWith("file:///") || parsed.hostname !== "" || parsed.pathname.length === 0)) return false;
  return parsed.hostname === expected.hostname &&
    parsed.port === expected.port &&
    parsed.pathname === expected.pathname &&
    parsed.search === expected.search &&
    rawPath(actual) === expected.encodedPath;
};

export type LearningIpcGuardOptions = Readonly<{
  webContentsId: number;
  mainFrameRoutingId?: number;
  expectedUrl: string;
}>;

export type LearningIpcGuard = Readonly<{
  assertSender: (event: IpcMainInvokeEvent) => void;
}>;

const assertSenderFor = (options: LearningIpcGuardOptions, pinnedUrl: PinnedUrl, event: IpcMainInvokeEvent): void => {
  try {
    if (!event || !event.sender || event.sender.id !== options.webContentsId || event.sender.isDestroyed()) throw guardError(IPC_SENDER_DENIED);
    const frame = event.senderFrame;
    const mainFrame = event.sender.mainFrame;
    if (!frame || !mainFrame || frame !== mainFrame || typeof frame.url !== "string" || !samePinnedUrl(pinnedUrl, frame.url)) {
      throw guardError(IPC_SENDER_DENIED);
    }
    if (options.mainFrameRoutingId !== undefined && (typeof frame.routingId !== "number" || frame.routingId !== options.mainFrameRoutingId)) {
      throw guardError(IPC_SENDER_DENIED);
    }
    if (frame.parent !== undefined && frame.parent !== null) throw guardError(IPC_SENDER_DENIED);
    if (frame.top !== undefined && frame.top !== frame) throw guardError(IPC_SENDER_DENIED);
  } catch (error) {
    if (error instanceof Error && (error as { code?: unknown }).code === IPC_SENDER_DENIED) throw error;
    throw guardError(IPC_SENDER_DENIED);
  }
};

/** Creates a sender and main-frame guard for one app window lifecycle. */
export function createLearningIpcGuard(options: LearningIpcGuardOptions): LearningIpcGuard {
  if (!options || !Number.isInteger(options.webContentsId) || options.webContentsId < 0 ||
    (options.mainFrameRoutingId !== undefined && (!Number.isInteger(options.mainFrameRoutingId) || options.mainFrameRoutingId < 0))) {
    throw guardError(EXPECTED_URL_INVALID);
  }
  const pinnedUrl = parsePinnedUrl(options.expectedUrl);
  return Object.freeze({ assertSender: (event: IpcMainInvokeEvent) => assertSenderFor(options, pinnedUrl, event) });
}

export type LearningContextIdentity = Readonly<{
  profileId: string;
  connectionId: string;
}>;

const isContextId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= MAX_CONTEXT_ID_LENGTH;

/** Checks an IPC request's immutable profile and connection binding before service access. */
export function assertLearningContext(expected: LearningContextIdentity, received: unknown): void {
  if (!expected || !isContextId(expected.profileId) || !isContextId(expected.connectionId) ||
    !received || typeof received !== "object" || Array.isArray(received)) {
    throw guardError(CONTEXT_DENIED);
  }
  const actual = received as Partial<LearningContextIdentity>;
  if (!isContextId(actual.profileId) || !isContextId(actual.connectionId) ||
    actual.profileId !== expected.profileId || actual.connectionId !== expected.connectionId) {
    throw guardError(CONTEXT_DENIED);
  }
}
