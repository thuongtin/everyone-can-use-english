import { createHash } from "node:crypto";

import type {
  GeneratedAssetAttributes,
  LearningModels,
} from "../db/learning-models";
import type {
  LearningProfileContext,
  LearningProfileScope,
} from "./profile-scope";

export const LEARNING_ASSET_MAX_BYTES = 64 * 1024 * 1024;
const LEARNING_ASSET_URL_PREFIX = "enjoy://library/learning-assets/";
const LEARNING_ASSET_URL_ROOT = LEARNING_ASSET_URL_PREFIX.slice(0, -1);
const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RELATIVE_PATH_PATTERN = new RegExp(`^${UUID_PATTERN}\\.(png|jpg|webp|wav|mp3|ogg|webm)$`);
const CONTEXT_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

const ASSET_TYPES: Readonly<Record<string, Readonly<{ kind: "image" | "audio"; mimeType: string }>>> = Object.freeze({
  png: Object.freeze({ kind: "image", mimeType: "image/png" }),
  jpg: Object.freeze({ kind: "image", mimeType: "image/jpeg" }),
  webp: Object.freeze({ kind: "image", mimeType: "image/webp" }),
  wav: Object.freeze({ kind: "audio", mimeType: "audio/wav" }),
  mp3: Object.freeze({ kind: "audio", mimeType: "audio/mpeg" }),
  ogg: Object.freeze({ kind: "audio", mimeType: "audio/ogg" }),
  webm: Object.freeze({ kind: "audio", mimeType: "audio/webm" }),
});

const CACHE_CONTROL = "private, no-store";
const GENERIC_NOT_FOUND_BODY = "Learning asset unavailable";
const GENERIC_FORBIDDEN_BODY = "Learning asset access denied";
const GENERIC_METHOD_BODY = "Method not allowed";
const GENERIC_RANGE_BODY = "Range not satisfiable";

type AssetProtocolErrorCode =
  | "learning_asset_url_invalid"
  | "learning_asset_context_denied"
  | "learning_asset_not_found"
  | "learning_asset_integrity_failed"
  | "learning_asset_range_invalid";

const protocolError = (code: AssetProtocolErrorCode): Error => Object.assign(new Error(code), { code });

export type LearningAssetContext = Readonly<Pick<LearningProfileContext, "profileId" | "connectionId">>;

export type LearningAssetReader = Readonly<{
  read: (relativePath: string) => Promise<Buffer>;
  resolve: (relativePath: string) => string;
}>;

export type LearningAssetProtocolOptions = Readonly<{
  scope: LearningProfileScope;
  models: LearningModels;
  assets: LearningAssetReader;
}>;

export type LearningAssetProtocolErrorCode = AssetProtocolErrorCode;

function isContext(value: unknown): value is LearningAssetContext {
  if (!value || typeof value !== "object") return false;
  const context = value as Partial<LearningAssetContext>;
  return typeof context.profileId === "string" && context.profileId.length > 0 &&
    typeof context.connectionId === "string" && context.connectionId.length > 0 &&
    context.connectionId.length <= 200 && CONTEXT_ID_PATTERN.test(context.connectionId);
}

function assertContext(value: unknown): asserts value is LearningAssetContext {
  if (!isContext(value)) throw protocolError("learning_asset_context_denied");
}

function assertRelativePath(value: unknown): asserts value is string {
  if (typeof value !== "string" || !RELATIVE_PATH_PATTERN.test(value)) {
    throw protocolError("learning_asset_url_invalid");
  }
}

function extensionFor(relativePath: string): string {
  const extension = relativePath.slice(relativePath.lastIndexOf(".") + 1);
  if (!ASSET_TYPES[extension]) throw protocolError("learning_asset_url_invalid");
  return extension;
}

/** Returns the canonical renderer URL for an immutable profile-scoped asset. */
export function learningAssetUrl(context: LearningAssetContext, relativePath: string): string {
  assertContext(context);
  assertRelativePath(relativePath);
  return `${LEARNING_ASSET_URL_PREFIX}${context.connectionId}/${relativePath}`;
}

/** Parses only the exact canonical URL emitted by learningAssetUrl. */
export function parseLearningAssetUrl(url: string, context: LearningAssetContext): string {
  assertContext(context);
  if (typeof url !== "string" || url.length > 1024 || !url.startsWith(LEARNING_ASSET_URL_ROOT)) {
    throw protocolError("learning_asset_url_invalid");
  }
  const expectedPrefix = `${LEARNING_ASSET_URL_PREFIX}${context.connectionId}/`;
  if (!url.startsWith(expectedPrefix)) throw protocolError("learning_asset_context_denied");
  const relativePath = url.slice(expectedPrefix.length);
  assertRelativePath(relativePath);
  if (url !== learningAssetUrl(context, relativePath)) throw protocolError("learning_asset_url_invalid");
  return relativePath;
}

function errorCode(error: unknown): unknown {
  return error instanceof Error ? (error as { code?: unknown }).code : undefined;
}

function isProtocolError(error: unknown, code: AssetProtocolErrorCode): boolean {
  return errorCode(error) === code;
}

function isScopeError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "profile_changed" || code === "profile_closed" || code === "profile_quiesce_failed";
}

function responseBody(body: string, status: number, method: string, headers: Record<string, string> = {}): Response {
  const bytes = Buffer.from(body, "utf8");
  const responseHeaders = new Headers({
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": String(bytes.length),
    ...headers,
  });
  return new Response(method === "HEAD" ? null : bytes, { status, headers: responseHeaders });
}

function errorResponse(error: unknown, method: string): Response {
  if (isProtocolError(error, "learning_asset_context_denied") || isScopeError(error)) {
    return responseBody(GENERIC_FORBIDDEN_BODY, 403, method);
  }
  return responseBody(GENERIC_NOT_FOUND_BODY, 404, method);
}

type ByteRange = Readonly<{ start: number; end: number }>;

function parseDecimal(value: string): number {
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw protocolError("learning_asset_range_invalid");
  return Number(parsed);
}

function parseRangeHeader(value: string | null, length: number): ByteRange | null {
  if (value === null) return null;
  const range = value.trim();
  if (!range.startsWith("bytes=") || range.slice(6).includes(",")) {
    throw protocolError("learning_asset_range_invalid");
  }
  const spec = range.slice(6);
  let match = /^(\d+)-(\d+)$/u.exec(spec);
  if (match) {
    const start = parseDecimal(match[1]);
    const requestedEnd = parseDecimal(match[2]);
    if (start >= length || start > requestedEnd) throw protocolError("learning_asset_range_invalid");
    return { start, end: Math.min(requestedEnd, length - 1) };
  }
  match = /^(\d+)-$/u.exec(spec);
  if (match) {
    const start = parseDecimal(match[1]);
    if (start >= length) throw protocolError("learning_asset_range_invalid");
    return { start, end: length - 1 };
  }
  match = /^-(\d+)$/u.exec(spec);
  if (match) {
    const suffix = parseDecimal(match[1]);
    if (suffix <= 0 || length <= 0) throw protocolError("learning_asset_range_invalid");
    return { start: suffix >= length ? 0 : length - suffix, end: length - 1 };
  }
  throw protocolError("learning_asset_range_invalid");
}

function successResponse(
  bytes: Buffer,
  method: string,
  status: number,
  headers: Record<string, string>,
): Response {
  return new Response(method === "HEAD" ? null : bytes, {
    status,
    headers: new Headers({
      "Content-Length": String(bytes.length),
      ...headers,
    }),
  });
}

/** Resolves authorized learning assets in the Electron main process only. */
export class LearningAssetProtocol {
  private readonly scope: LearningProfileScope;
  private readonly models: LearningModels;
  private readonly assets: LearningAssetReader;

  constructor(options: LearningAssetProtocolOptions) {
    if (!options?.scope || !options.models?.GeneratedAsset || !options.assets?.read || !options.assets?.resolve) {
      throw new TypeError("scope, models, and asset reader are required");
    }
    this.scope = options.scope;
    this.models = options.models;
    this.assets = options.assets;
  }

  async handle(request: Request): Promise<Response> {
    const method = typeof request?.method === "string" ? request.method.toUpperCase() : "";
    if (method !== "GET" && method !== "HEAD") {
      return responseBody(GENERIC_METHOD_BODY, 405, method, { Allow: "GET, HEAD" });
    }

    try {
      return await this.scope.run(async (context) => {
        const relativePath = parseLearningAssetUrl(request.url, context);
        const asset = await this.models.GeneratedAsset.findOne({
          where: { profileId: context.profileId, relativePath },
        }) as unknown as GeneratedAssetAttributes | null;
        this.scope.assertOpen(context);
        if (!asset) throw protocolError("learning_asset_not_found");

        const extension = extensionFor(relativePath);
        const expected = ASSET_TYPES[extension];
        if (
          asset.kind !== expected.kind ||
          asset.mimeType !== expected.mimeType ||
          !SHA256_PATTERN.test(asset.sha256) ||
          !Number.isSafeInteger(asset.sizeBytes) ||
          asset.sizeBytes < 0 ||
          asset.sizeBytes > LEARNING_ASSET_MAX_BYTES
        ) {
          throw protocolError("learning_asset_integrity_failed");
        }

        void this.assets.resolve(relativePath);
        let bytes: Buffer;
        try {
          bytes = await this.assets.read(relativePath);
        } catch {
          this.scope.assertOpen(context);
          throw protocolError("learning_asset_not_found");
        }
        this.scope.assertOpen(context);
        if (!Buffer.isBuffer(bytes) || bytes.length !== asset.sizeBytes || bytes.length > LEARNING_ASSET_MAX_BYTES) {
          throw protocolError("learning_asset_integrity_failed");
        }
        const actualSha256 = createHash("sha256").update(bytes).digest("hex");
        if (actualSha256 !== asset.sha256) throw protocolError("learning_asset_integrity_failed");

        let range: ByteRange | null;
        try {
          range = parseRangeHeader(request.headers.get("range"), bytes.length);
        } catch (error) {
          if (isProtocolError(error, "learning_asset_range_invalid")) {
            this.scope.assertOpen(context);
            return responseBody(GENERIC_RANGE_BODY, 416, method, {
              "Accept-Ranges": "bytes",
              "Content-Range": `bytes */${bytes.length}`,
            });
          }
          throw error;
        }

        this.scope.assertOpen(context);
        const commonHeaders = {
          "Accept-Ranges": "bytes",
          "Cache-Control": CACHE_CONTROL,
          "Content-Type": asset.mimeType,
          ETag: `"${asset.sha256}"`,
        };
        if (!range) return successResponse(bytes, method, 200, commonHeaders);
        const rangedBytes = bytes.subarray(range.start, range.end + 1);
        return successResponse(rangedBytes, method, 206, {
          ...commonHeaders,
          "Content-Range": `bytes ${range.start}-${range.end}/${bytes.length}`,
        });
      });
    } catch (error) {
      return errorResponse(error, method);
    }
  }
}
