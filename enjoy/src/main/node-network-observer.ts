import diagnosticsChannel from "node:diagnostics_channel";
import { isIP } from "node:net";
import {
  getNetworkPolicyDiagnostics,
  noteObservedNetworkRequest,
  type NetworkPolicyDiagnostics,
} from "@/lib/network-policy";

const HTTP_CLIENT_REQUEST_CHANNEL = "http.client.request.start";
const UNDICI_REQUEST_CHANNEL = "undici:request:create";

export const NODE_NETWORK_DIAGNOSTICS_GLOBAL =
  "__ENJOY_NETWORK_POLICY_DIAGNOSTICS__" as const;

type DiagnosticMessage = Readonly<{ request?: unknown }>;
type DiagnosticHandler = (message: DiagnosticMessage) => void;
type DiagnosticGlobal = typeof globalThis & {
  __ENJOY_NETWORK_POLICY_DIAGNOSTICS__?: () => NetworkPolicyDiagnostics;
};

let activeDisposer: (() => void) | undefined;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function readProperty(record: Record<string, unknown>, key: string): unknown {
  try {
    return record[key];
  } catch {
    return undefined;
  }
}

function hostnameFromAuthority(value: unknown): string | undefined {
  if (value instanceof URL) return value.hostname || undefined;
  if (typeof value !== "string") return undefined;
  const authority = value.trim();
  if (!authority) return undefined;
  if (isIP(authority)) return authority;
  try {
    const parsed = new URL(
      authority.includes("://") ? authority : `http://${authority}`,
    );
    return parsed.hostname || undefined;
  } catch {
    return undefined;
  }
}

function httpHostname(request: Record<string, unknown>): string | undefined {
  const direct = hostnameFromAuthority(readProperty(request, "host"));
  if (direct) return direct;
  const getHeader = readProperty(request, "getHeader");
  if (typeof getHeader !== "function") return undefined;
  try {
    return hostnameFromAuthority(getHeader.call(request, "host"));
  } catch {
    return undefined;
  }
}

function observeHttp(message: DiagnosticMessage): void {
  try {
    const request = asRecord(message?.request);
    if (!request) return;
    const hostname = httpHostname(request);
    if (!hostname) return;
    const protocol = readProperty(request, "protocol");
    noteObservedNetworkRequest({
      transport: protocol === "https:" ? "node:https" : "node:http",
      hostname,
    });
  } catch {
    // Diagnostics callbacks must never interfere with the observed request.
  }
}

function observeUndici(message: DiagnosticMessage): void {
  try {
    const request = asRecord(message?.request);
    if (!request) return;
    const hostname = hostnameFromAuthority(readProperty(request, "origin"))
      ?? httpHostname(request);
    if (!hostname) return;
    noteObservedNetworkRequest({ transport: "undici", hostname });
  } catch {
    // Diagnostics callbacks must never interfere with the observed request.
  }
}

function exposeReadOnlyDiagnosticsGetter(): void {
  const diagnosticGlobal = globalThis as DiagnosticGlobal;
  if (Object.hasOwn(diagnosticGlobal, NODE_NETWORK_DIAGNOSTICS_GLOBAL)) return;
  Object.defineProperty(diagnosticGlobal, NODE_NETWORK_DIAGNOSTICS_GLOBAL, {
    value: getNetworkPolicyDiagnostics,
    writable: false,
    configurable: false,
    enumerable: false,
  });
}

export function installNodeNetworkObserver(): () => void {
  exposeReadOnlyDiagnosticsGetter();
  if (activeDisposer) return () => undefined;

  const httpHandler: DiagnosticHandler = observeHttp;
  const undiciHandler: DiagnosticHandler = observeUndici;
  diagnosticsChannel.subscribe(HTTP_CLIENT_REQUEST_CHANNEL, httpHandler);
  diagnosticsChannel.subscribe(UNDICI_REQUEST_CHANNEL, undiciHandler);

  let active = true;
  const dispose = () => {
    if (!active) return;
    active = false;
    diagnosticsChannel.unsubscribe(HTTP_CLIENT_REQUEST_CHANNEL, httpHandler);
    diagnosticsChannel.unsubscribe(UNDICI_REQUEST_CHANNEL, undiciHandler);
    if (activeDisposer === dispose) activeDisposer = undefined;
  };
  activeDisposer = dispose;
  return dispose;
}
