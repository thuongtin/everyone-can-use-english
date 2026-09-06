export type UserStats = {
  name?: string;
  avatarUrl?: string;
  recordingsDuration?: number;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as UnknownRecord;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asFiniteDuration(value: unknown): number | undefined {
  const duration =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : undefined;

  return typeof duration === "number" && Number.isFinite(duration) && duration >= 0
    ? duration
    : undefined;
}

export function parseUserStats(data: unknown): UserStats | null {
  const root = asRecord(data);
  const payload = asRecord(root?.data) ?? root;

  if (!payload) return null;

  const name = asNonEmptyString(payload.name);
  const avatarUrl = asNonEmptyString(payload.avatar_url);
  const recordingsDuration = asFiniteDuration(payload.recordings_duration);

  if (!name && !avatarUrl && recordingsDuration === undefined) return null;

  const stats: UserStats = {};
  if (name) stats.name = name;
  if (avatarUrl) stats.avatarUrl = avatarUrl;
  if (recordingsDuration !== undefined) {
    stats.recordingsDuration = recordingsDuration;
  }

  return stats;
}

export async function request(url: string) {
  const perfix = "http-cache";
  const key = `${perfix}-${url}`;

  try {
    const value = JSON.parse(localStorage.getItem(key) || "");

    if (Number(value.expire_time) > new Date().getTime()) {
      return value.data;
    }
  } catch (error) {
    // ignore
  }

  try {
    const resp = await fetch(url, { method: "Get" });
    const data = await resp.json();

    localStorage.setItem(
      key,
      JSON.stringify({
        expire_time: new Date().getTime() + 1000 * 60 * 60 * 24,
        data,
      })
    );

    return data;
  } catch (error) {
    console.log("request error", error);
  }
}
