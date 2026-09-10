import {
  assertAllowedNetworkUrl,
  type NetworkPolicyContext,
} from "@/lib/network-policy";

type BeforeRequestDetails = Readonly<{ url: string }>;
type BeforeRequestCallback = (response: { cancel: boolean }) => void;
type ChromiumSession = Readonly<{
  webRequest: {
    onBeforeRequest(
      listener: (details: BeforeRequestDetails, callback: BeforeRequestCallback) => void,
    ): void;
  };
}>;
type SessionCreatingApp = Readonly<{
  on(event: "session-created", listener: (createdSession: ChromiumSession) => void): unknown;
}>;

export type ChromiumSessionPolicyOptions = NetworkPolicyContext & Readonly<{
  allowRequest?: (url: string) => boolean;
}>;

export function createChromiumBeforeRequestListener(
  options: ChromiumSessionPolicyOptions,
): (details: BeforeRequestDetails, callback: BeforeRequestCallback) => void {
  return (details, callback) => {
    try {
      assertAllowedNetworkUrl(details.url, options);
      callback({ cancel: options.allowRequest ? !options.allowRequest(details.url) : false });
    } catch {
      callback({ cancel: true });
    }
  };
}

export function installChromiumSessionNetworkPolicy(
  targetSession: ChromiumSession,
  options: ChromiumSessionPolicyOptions = {
    transport: "chromium-session",
    operation: "session.request",
  },
): void {
  // Electron 34 keeps only the last listener for a webRequest event. Callers with
  // a stricter sandbox policy must pass it as allowRequest so both rules compose.
  targetSession.webRequest.onBeforeRequest(createChromiumBeforeRequestListener(options));
}

export function installChromiumNetworkPolicy(
  electronApp: SessionCreatingApp,
  defaultSession: ChromiumSession,
): void {
  installChromiumSessionNetworkPolicy(defaultSession);
  electronApp.on("session-created", createdSession => {
    installChromiumSessionNetworkPolicy(createdSession);
  });
}
