import settings from "@main/settings";
import { HttpsProxyAgent } from "https-proxy-agent";
import { ProxyAgent } from "proxy-agent";
import fetch from "node-fetch";
import {
  createGuardedFetch,
  type GuardedFetchInput,
} from "@/lib/network-policy";

const guardedFetch = createGuardedFetch(
  fetch as unknown as (
    input: GuardedFetchInput,
    init?: RequestInit,
  ) => Promise<Response>,
  { transport: "node-fetch", operation: "proxy-agent.fetch" },
);

export default function () {
  const proxyConfig = settings.getSync("proxy") as ProxyConfigType;
  let proxyAgent = new ProxyAgent();

  if (proxyConfig.enabled && proxyConfig.url) {
    proxyAgent = new ProxyAgent({
      httpAgent: new HttpsProxyAgent(proxyConfig.url),
      httpsAgent: new HttpsProxyAgent(proxyConfig.url),
    });
  }

  return {
    httpAgent: proxyAgent,
    fetch: guardedFetch as unknown as typeof fetch,
  };
}
