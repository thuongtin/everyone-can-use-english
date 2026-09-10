export function lexicalKey(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase().replace(/[’‘`]/gu, "'").replace(/[^\p{L}\p{M}\p{N}']/gu, "");
}

export function lexicalUnits(text: string): string[] {
  return (text.normalize("NFKC").toLocaleLowerCase().replace(/[’‘`]/gu, "'")
    .match(/[\p{L}\p{M}\p{N}]+(?:['.-][\p{L}\p{M}\p{N}]+)*/gu) || [])
    .map(lexicalKey).filter(Boolean);
}

export function equalText(left: string, right: string): boolean {
  return lexicalUnits(left).join(" ") === lexicalUnits(right).join(" ");
}

export function joinWordText(words: readonly { text: string }[]): string {
  return words.map(word => word.text).join(" ")
    .replace(/\s+([,.;:!?%)\]}])/gu, "$1")
    .replace(/([[({])\s+/gu, "$1")
    .replace(/(\d):\s+(?=\d)/gu, "$1:")
    .trim();
}
