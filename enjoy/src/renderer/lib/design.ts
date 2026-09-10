/**
 * Helpers for the Enjoy design language: cover fallbacks and score semantics.
 * Colors come from the `--ej-*` tokens declared in src/index.css.
 */

/** Cover fallback gradients, picked by hashing the record id. */
export const COVER_GRADIENTS: [string, string][] = [
  ["#1F3A8A", "#4F7BE8"],
  ["#5B2A86", "#A66BE0"],
  ["#0F6B5C", "#3FB59B"],
  ["#8A3B12", "#E08A4F"],
  ["#1C1B18", "#5A5750"],
  ["#9B1D3A", "#E0587A"],
  ["#245C8A", "#5FA8DA"],
  ["#6B5A10", "#C9A94A"],
];

/** Stable, order-independent-ish hash so a record always gets the same cover. */
export function hashCode(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function gradientFor(id?: string): string {
  const [from, to] = COVER_GRADIENTS[hashCode(id || "enjoy") % COVER_GRADIENTS.length];
  return `linear-gradient(160deg, ${from}, ${to})`;
}

/** Two-letter initials used on avatars and profile blocks. */
export function initialsOf(name?: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "EN";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export type ScoreTone = "ok" | "warn" | "bad" | "none";

/** ≥80 good, 60–79 needs work, <60 poor. */
export function scoreTone(score?: number | null): ScoreTone {
  if (score === undefined || score === null || Number.isNaN(score)) return "none";
  if (score >= 80) return "ok";
  if (score >= 60) return "warn";
  return "bad";
}

export function scoreColor(score?: number | null): string {
  switch (scoreTone(score)) {
    case "ok":
      return "var(--ej-ok)";
    case "warn":
      return "var(--ej-warn)";
    case "bad":
      return "var(--ej-bad)";
    default:
      return "var(--ej-muted)";
  }
}

export function scoreSoftColor(score?: number | null): string {
  switch (scoreTone(score)) {
    case "ok":
      return "var(--ej-ok-soft)";
    case "warn":
      return "var(--ej-warn-soft)";
    case "bad":
      return "var(--ej-bad-soft)";
    default:
      return "var(--ej-surface2)";
  }
}

/** Tailwind classes for a soft score chip (background + text). */
export function scoreChipClass(score?: number | null): string {
  switch (scoreTone(score)) {
    case "ok":
      return "bg-ej-ok-soft text-ej-ok";
    case "warn":
      return "bg-ej-warn-soft text-ej-warn";
    case "bad":
      return "bg-ej-bad-soft text-ej-bad";
    default:
      return "bg-ej-surface2 text-ej-muted";
  }
}
