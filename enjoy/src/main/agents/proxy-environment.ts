import settings from "@main/settings";
import { assertAllowedNetworkUrl } from "@/lib/network-policy";

type NativeProxyConfig = Readonly<{
  enabled?: boolean;
  url?: string;
}> | null | undefined;

const LOOPBACK_PROXY_BYPASS = "localhost,127.0.0.1,::1,[::1]";

export function nativeProxyEnvironmentFor(config: NativeProxyConfig): Record<string, string> {
  if (!config?.enabled || typeof config.url !== "string" || !config.url.trim()) return {};
  const proxyUrl = assertAllowedNetworkUrl(config.url, {
    transport: "native-subprocess",
    operation: "configured-proxy",
  }).href;
  return {
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    NO_PROXY: LOOPBACK_PROXY_BYPASS,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    no_proxy: LOOPBACK_PROXY_BYPASS,
  };
}

export function configuredNativeProxyEnvironment(): Record<string, string> {
  return nativeProxyEnvironmentFor(settings.getSync("proxy") as NativeProxyConfig);
}
