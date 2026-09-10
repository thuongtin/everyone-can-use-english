import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const PIPELINE_VERSION = "study-asr-v1";
export const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

/** Per-user, content-addressed work. Only complete responses are atomically published. */
export function createCheckpointStore(root: string, identity: string) {
  const directory = path.join(root, sha256(`${PIPELINE_VERSION}:${identity}`));
  return {
    async read<T>(key: string, validate: (value: unknown) => value is T): Promise<T | undefined> {
      try {
        const file = path.join(directory, `${sha256(key)}.json`);
        if ((await fs.stat(file)).size > 16_000_000) return undefined;
        const envelope = JSON.parse(await fs.readFile(file, "utf8"));
        if (envelope.version !== PIPELINE_VERSION || envelope.digest !== sha256(JSON.stringify(envelope.value))) return undefined;
        return validate(envelope.value) ? envelope.value : undefined;
      } catch { return undefined; }
    },
    async write(key: string, value: unknown): Promise<void> {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const file = path.join(directory, `${sha256(key)}.json`);
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify({ version: PIPELINE_VERSION, digest: sha256(JSON.stringify(value)), value }), { mode: 0o600 });
        await fs.rename(temporary, file);
      } finally { await fs.rm(temporary, { force: true }); }
    },
  };
}
