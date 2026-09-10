import assert from "node:assert/strict";
import type { Page } from "@playwright/test";

import {
  isRetiredEnjoyHostname,
  type NetworkPolicyDiagnostics,
} from "../../src/lib/network-policy";

export type ProviderNetworkCapture = Readonly<{
  main: NetworkPolicyDiagnostics;
  renderer: NetworkPolicyDiagnostics;
  retiredObservedKeys: readonly string[];
}>;

const observedHostname = (key: string): string => key.split("|").at(-1) || "";

/** Captures both process-local policy counters and enforces the live-provider boundary. */
export async function captureProviderNetwork(page: Page): Promise<ProviderNetworkCapture> {
  const diagnostics = await page.evaluate(async () => ({
    main: await window.__ENJOY_APP__.app.networkPolicyDiagnostics(),
    renderer: window.__ENJOY_RENDERER_NETWORK_POLICY__(),
  }));
  const retiredObservedKeys = [diagnostics.main, diagnostics.renderer]
    .flatMap(policy => Object.keys(policy.observedRequests))
    .filter(key => isRetiredEnjoyHostname(observedHostname(key)));

  for (const [processName, policy] of [
    ["main", diagnostics.main],
    ["renderer", diagnostics.renderer],
  ] as const) {
    assert.equal(policy.blockedAttemptCount, 0, `${processName} blocked a network operation`);
    assert.equal(policy.legacyBackendOperationCount, 0, `${processName} attempted a retired backend operation`);
  }
  assert.deepEqual(retiredObservedKeys, [], "A retired Enjoy hostname was observed");

  return { ...diagnostics, retiredObservedKeys };
}

export function observedHostCount(
  diagnostics: NetworkPolicyDiagnostics,
  hostname: string,
): number {
  const normalized = hostname.trim().toLowerCase().replace(/\.+$/u, "");
  return Object.entries(diagnostics.observedRequests).reduce(
    (total, [key, count]) =>
      observedHostname(key).trim().toLowerCase().replace(/\.+$/u, "") === normalized
        ? total + count
        : total,
    0,
  );
}
