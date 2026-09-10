/** Legacy library routes must never provide a second path to protected learning assets. */
export function isLearningAssetReference(value: string): boolean {
  let decoded = value;
  for (let depth = 0; depth < 4; depth++) {
    if (/(?:^|[\\/])learning-assets(?:[\\/?#]|$)/iu.test(decoded)) return true;
    let next: string;
    try { next = decodeURIComponent(decoded); } catch { return false; }
    if (next === decoded) return false;
    decoded = next;
  }
  return /(?:^|[\\/])learning-assets(?:[\\/?#]|$)/iu.test(decoded);
}
