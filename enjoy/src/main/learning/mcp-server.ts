import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { LearningCapabilityGrant, LearningCapabilityRegistry } from "./capability-registry";
import {
  registerLearningTools,
  type LearningMcpApplication,
  type LearningMcpAuthorizationRequest,
} from "./tool-registry";

export type { LearningMcpApplication } from "./tool-registry";

const MCP_PATH = "/mcp";
const MAX_BODY_BYTES = 512 * 1024;
const MAX_CONCURRENCY = 8;
const REQUEST_TIMEOUT_MS = 30_000;
const HTTP_ERROR_CODES = new Set<HttpErrorCode>([
  "host_rejected",
  "origin_rejected",
  "capability_denied",
  "body_too_large",
  "malformed_json",
  "method_not_allowed",
  "not_found",
  "server_closed",
  "mcp_request_failed",
]);

type HttpErrorCode = "host_rejected" | "origin_rejected" | "capability_denied" | "body_too_large" | "malformed_json" | "method_not_allowed" | "not_found" | "server_closed" | "mcp_request_failed";

const httpError = (code: HttpErrorCode): Error => Object.assign(new Error(code), { code });

const writeError = (response: ServerResponse, status: number, code: HttpErrorCode): void => {
  if (response.writableEnded) return;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(JSON.stringify({ error: { code } })),
  });
  response.end(JSON.stringify({ error: { code } }));
};

const headerValue = (request: IncomingMessage, name: string): string | undefined => {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
};

const readBody = (request: IncomingMessage): Promise<string> => new Promise((resolve, reject) => {
  let total = 0;
  const chunks: Buffer[] = [];
  let settled = false;
  const finish = (error?: Error, body?: string) => {
    if (settled) return;
    settled = true;
    if (error) {
      request.resume();
      reject(error);
    } else {
      resolve(body ?? "");
    }
  };
  request.on("data", (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_BODY_BYTES) {
      finish(httpError("body_too_large"));
      return;
    }
    chunks.push(buffer);
  });
  request.once("end", () => finish(undefined, Buffer.concat(chunks).toString("utf8")));
  request.once("aborted", () => finish(httpError("mcp_request_failed")));
  request.once("error", () => finish(httpError("mcp_request_failed")));
});

const parseBearer = (request: IncomingMessage): string | undefined => {
  const authorization = headerValue(request, "authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/u);
  return match?.[1];
};

export type LearningMcpServerOptions = Readonly<{
  capabilities: LearningCapabilityRegistry;
  application: LearningMcpApplication;
}>;

export type LearningMcpServer = Readonly<{
  url: string;
  close: () => Promise<void>;
}>;

const isKnownHttpError = (error: unknown): error is Error & { code: HttpErrorCode } => {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && HTTP_ERROR_CODES.has(code as HttpErrorCode);
};

/** Starts a stateless, loopback-only Streamable HTTP MCP server for Enjoy learning jobs. */
export async function createLearningMcpServer(options: LearningMcpServerOptions): Promise<LearningMcpServer> {
  if (!options || !options.capabilities || !options.application || typeof options.capabilities.resolve !== "function" || typeof options.capabilities.authorize !== "function") {
    throw new TypeError("Learning MCP server options are invalid");
  }

  const sockets = new Set<Socket>();
  const requests = new Set<Promise<void>>();
  let inFlight = 0;
  let closed = false;
  let port = 0;
  let closePromise: Promise<void> | undefined;

  const server = createServer((request, response) => {
    const task: Promise<void> = handleRequest(request, response).finally(() => {
      requests.delete(task);
    });
    requests.add(task);
    void task.catch((): undefined => undefined);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  const handleRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setTimeout(REQUEST_TIMEOUT_MS, () => response.destroy());
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy());
    try {
      if (closed) {
        writeError(response, 503, "server_closed");
        return;
      }
      const expectedHost = `127.0.0.1:${port}`;
      if (headerValue(request, "host") !== expectedHost) {
        writeError(response, 403, "host_rejected");
        return;
      }
      const origin = headerValue(request, "origin");
      const expectedOrigin = `http://${expectedHost}`;
      if (origin !== undefined && origin !== expectedOrigin) {
        writeError(response, 403, "origin_rejected");
        return;
      }
      if (request.url !== MCP_PATH) {
        writeError(response, 404, "not_found");
        return;
      }
      if (request.method !== "POST") {
        response.setHeader("allow", "POST");
        writeError(response, 405, "method_not_allowed");
        return;
      }

      const token = parseBearer(request);
      if (!token) {
        writeError(response, 401, "capability_denied");
        return;
      }
      let grant: LearningCapabilityGrant;
      try {
        grant = options.capabilities.resolve(token);
      } catch {
        writeError(response, 401, "capability_denied");
        return;
      }
      if (inFlight >= MAX_CONCURRENCY) {
        writeError(response, 429, "mcp_request_failed");
        return;
      }
      inFlight += 1;
      try {
        const contentLength = headerValue(request, "content-length");
        if (contentLength !== undefined && (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
          writeError(response, 413, "body_too_large");
          request.resume();
          return;
        }
        const body = await readBody(request);
        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(body);
        } catch {
          writeError(response, 400, "malformed_json");
          return;
        }

        const authorize = (scope: LearningMcpAuthorizationRequest): LearningCapabilityGrant => options.capabilities.authorize(token, {
          profileId: grant.profileId,
          connectionId: grant.connectionId,
          jobId: scope.jobId ?? grant.jobId,
          stageId: scope.stageId ?? grant.stageId,
          attemptId: scope.attemptId ?? grant.attemptId,
          revisionId: scope.revisionId ?? grant.revisionId,
          tool: scope.tool,
        });
        const mcp = new McpServer({ name: "Enjoy Learning MCP", version: "0.1.0" });
        registerLearningTools(mcp, { grant, authorize, application: options.application });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        await mcp.connect(transport);
        try {
          await transport.handleRequest(request, response, parsedBody);
        } finally {
          await mcp.close().catch((): undefined => undefined);
        }
      } finally {
        inFlight -= 1;
      }
    } catch (error) {
      if (response.writableEnded) return;
      const code = isKnownHttpError(error) ? error.code : "mcp_request_failed";
      const status = code === "body_too_large" ? 413 : code === "malformed_json" ? 400 : 500;
      writeError(response, status, code);
    }
  };

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("MCP server did not bind to a TCP port"));
        return;
      }
      port = address.port;
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });

  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = (async () => {
      await new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      });
      await Promise.allSettled([...requests]);
    })();
    return closePromise;
  };

  return Object.freeze({ url: `http://127.0.0.1:${port}${MCP_PATH}`, close });
}
