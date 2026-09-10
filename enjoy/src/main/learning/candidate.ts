import { createHash } from "node:crypto";

const MAX_CANONICAL_DEPTH = 32;

const invalidPayload = (message: string): Error => Object.assign(
  new Error(message),
  { code: "invalid_payload" },
);

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function canonicalize(value: unknown, seen: Set<object>, depth: number): string {
  if (depth > MAX_CANONICAL_DEPTH) throw invalidPayload("payload_depth_exceeded");
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidPayload("payload_number_invalid");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw invalidPayload("payload_value_invalid");
  if (seen.has(value)) throw invalidPayload("payload_cycle");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Object.keys(value);
      if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
        throw invalidPayload("payload_array_invalid");
      }
      return `[${value.map((item) => canonicalize(item, seen, depth + 1)).join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw invalidPayload("payload_object_invalid");
    }
    const entries = Object.keys(value).sort().map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) throw invalidPayload("payload_property_invalid");
      return `${JSON.stringify(key)}:${canonicalize(descriptor.value, seen, depth + 1)}`;
    });
    return `{${entries.join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

/** Returns a canonical JSON string and rejects values that cannot be represented as JSON. */
export function normalizeJsonPayload(payload: unknown): string {
  return canonicalize(payload, new Set<object>(), 0);
}

/** Computes the authoritative candidate payload hash at the MCP boundary. */
export function canonicalPayloadHash(payload: unknown): string {
  return createHash("sha256").update(normalizeJsonPayload(payload)).digest("hex");
}

export type CanonicalJsonValue = JsonValue;
