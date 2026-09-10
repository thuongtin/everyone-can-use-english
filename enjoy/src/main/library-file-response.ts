import type { FileHandle } from "node:fs/promises";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { lookup } from "mime-types";

type ByteRange = { start: number; end: number };

function emptyResponse(status: number, headers: HeadersInit = {}): Response {
  return new Response(null, {
    status,
    headers: { "Content-Length": "0", ...headers },
  });
}

function parseRange(value: string | null, size: number): ByteRange | null {
  if (value === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/iu.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) throw new Error("invalid range");

  const sizeValue = BigInt(size);
  if (!match[1]) {
    const suffixLength = BigInt(match[2]);
    if (suffixLength === 0n) throw new Error("invalid range");
    const start = suffixLength >= sizeValue ? 0n : sizeValue - suffixLength;
    return { start: Number(start), end: size - 1 };
  }

  const start = BigInt(match[1]);
  if (start >= sizeValue) throw new Error("invalid range");
  const requestedEnd = match[2] ? BigInt(match[2]) : sizeValue - 1n;
  if (requestedEnd < start) throw new Error("invalid range");
  const end = requestedEnd >= sizeValue ? sizeValue - 1n : requestedEnd;
  return { start: Number(start), end: Number(end) };
}

async function openRegularFile(filePath: string): Promise<{ handle: FileHandle; size: number } | null> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(filePath, "r");
    const info = await handle.stat();
    if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size < 0) {
      await handle.close();
      return null;
    }
    return { handle, size: info.size };
  } catch {
    await handle?.close().catch((): void => {});
    return null;
  }
}

function streamedResponse(
  handle: FileHandle,
  request: Request,
  range: ByteRange,
  status: number,
  headers: HeadersInit,
): Response {
  const stream = handle.createReadStream({
    autoClose: true,
    start: range.start,
    end: range.end,
  });
  const abort = (): void => {
    const reason = request.signal.reason;
    stream.destroy(reason instanceof Error ? reason : new Error("Request aborted"));
  };
  request.signal.addEventListener("abort", abort, { once: true });
  stream.once("close", () => request.signal.removeEventListener("abort", abort));

  try {
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers });
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

export async function serveLibraryFile(request: Request, filePath: string): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return emptyResponse(405, { Allow: "GET, HEAD" });
  }
  if (request.signal.aborted) throw request.signal.reason ?? new Error("Request aborted");

  const opened = await openRegularFile(filePath);
  if (!opened) return emptyResponse(404);
  const { handle, size } = opened;

  let range: ByteRange | null;
  try {
    range = parseRange(request.headers.get("range"), size);
  } catch {
    await handle.close().catch((): void => {});
    return emptyResponse(416, {
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes */${size}`,
    });
  }

  const mimeType = lookup(filePath) || "application/octet-stream";
  const selected = range ?? (size > 0 ? { start: 0, end: size - 1 } : null);
  const contentLength = selected ? selected.end - selected.start + 1 : 0;
  const headers: Record<string, string> = {
    "Accept-Ranges": "bytes",
    "Content-Length": String(contentLength),
    "Content-Type": mimeType,
  };
  const status = range ? 206 : 200;
  if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;

  if (method === "HEAD" || !selected) {
    await handle.close();
    return new Response(null, { status, headers });
  }
  if (request.signal.aborted) {
    await handle.close().catch((): void => {});
    throw request.signal.reason ?? new Error("Request aborted");
  }
  return streamedResponse(handle, request, selected, status, headers);
}
