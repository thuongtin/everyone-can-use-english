import { readFileSync } from "node:fs";
import path from "node:path";

// Keep the selected certificate local to this checkout. Never store private keys.
export function localSigningOptions(projectRoot, env = process.env) {
  let identity = env.ENJOY_LOCAL_SIGN_IDENTITY?.trim();
  if (!identity) {
    try {
      const config = JSON.parse(
        readFileSync(path.join(projectRoot, ".local-signing.json"), "utf8"),
      );
      if (typeof config.identity !== "string" || !config.identity.trim()) {
        throw new Error("Local signing requires a nonempty certificate identity.");
      }
      identity = config.identity.trim();
    } catch (error) {
      if (error.code === "ENOENT") return undefined;
      throw error;
    }
  }
  if (identity === "-") {
    throw new Error("Local signing requires a certificate, not ad-hoc signing.");
  }
  return {
    identity,
    continueOnError: false,
    type: "development",
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    // Preserve local development runtime behavior, including debugger access.
    optionsForFile: () => ({ hardenedRuntime: false, timestamp: "none" }),
  };
}
