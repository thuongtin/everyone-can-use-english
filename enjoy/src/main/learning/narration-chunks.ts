export type NarrationChunk = Readonly<{
  index: number;
  text: string;
  startOffset: number;
  endOffset: number;
}>;

const DEFAULT_MAX_CHARACTERS = 3_800;
const SENTENCE_TERMINATORS = new Set([".", "!", "?", "。", "！", "？"]);
const SENTENCE_CLOSERS = new Set([
  '"',
  "'",
  "”",
  "’",
  "»",
  ")",
  "]",
  "}",
]);

const isWhitespace = (value: string): boolean => /^\s$/u.test(value);

const isSentenceTerminator = (value: string): boolean =>
  SENTENCE_TERMINATORS.has(value);

const isSentenceCloser = (value: string): boolean => SENTENCE_CLOSERS.has(value);

function sourceOffsets(codePoints: readonly string[]): number[] {
  const offsets = [0];
  for (const codePoint of codePoints) {
    offsets.push(offsets[offsets.length - 1] + codePoint.length);
  }
  return offsets;
}

function consumeWhitespace(
  codePoints: readonly string[],
  start: number,
  limit: number,
): number {
  let cursor = start;
  while (cursor < limit && isWhitespace(codePoints[cursor])) cursor += 1;
  return cursor;
}

function containsNonWhitespace(
  codePoints: readonly string[],
  start: number,
  end: number,
): boolean {
  for (let cursor = start; cursor < end; cursor += 1) {
    if (!isWhitespace(codePoints[cursor])) return true;
  }
  return false;
}

function sentenceBoundary(
  codePoints: readonly string[],
  punctuationIndex: number,
  limit: number,
): number {
  let boundary = punctuationIndex + 1;
  while (boundary < limit && isSentenceCloser(codePoints[boundary])) {
    boundary += 1;
  }
  if (boundary < codePoints.length && !isWhitespace(codePoints[boundary])) {
    return punctuationIndex + 1;
  }
  return consumeWhitespace(codePoints, boundary, limit);
}

/**
 * Splits narration into provider-sized source slices without changing their
 * text. Character limits count Unicode code points, while offsets remain
 * native JavaScript string offsets so source.slice(startOffset, endOffset)
 * returns the exact chunk text.
 */
export function splitNarrationText(
  text: string,
  maxCharacters = DEFAULT_MAX_CHARACTERS,
): NarrationChunk[] {
  if (typeof text !== "string") {
    throw new TypeError("Narration text must be a string");
  }
  if (!Number.isInteger(maxCharacters) || maxCharacters <= 0) {
    throw new RangeError("Narration maximum characters must be a positive integer");
  }

  const codePoints = Array.from(text);
  if (codePoints.every(isWhitespace)) {
    throw new Error("Narration text must contain non-whitespace text");
  }

  const offsets = sourceOffsets(codePoints);
  const chunks: NarrationChunk[] = [];
  let start = 0;

  while (start < codePoints.length) {
    const limit = Math.min(start + maxCharacters, codePoints.length);
    let paragraphEnd = -1;
    let sentenceEnd = -1;
    let whitespaceEnd = -1;

    for (let cursor = start + 1; cursor <= limit; cursor += 1) {
      const previous = codePoints[cursor - 1];
      if (previous === "\n" || previous === "\r") {
        let boundary = cursor;
        if (previous === "\r" && codePoints[cursor] === "\n") boundary += 1;
        boundary = consumeWhitespace(codePoints, boundary, limit);
        if (boundary > start && boundary <= limit) paragraphEnd = boundary;
      }

      if (isSentenceTerminator(previous)) {
        const boundary = sentenceBoundary(codePoints, cursor - 1, limit);
        if (boundary > start && boundary <= limit) sentenceEnd = boundary;
      }

      if (isWhitespace(previous)) {
        const boundary = consumeWhitespace(codePoints, cursor - 1, limit);
        if (boundary > start && boundary <= limit) whitespaceEnd = boundary;
      }
    }

    let end = paragraphEnd > start
      ? paragraphEnd
      : sentenceEnd > start
        ? sentenceEnd
        : whitespaceEnd > start
          ? whitespaceEnd
          : limit;

    // Keep separators in the source slice. A whitespace-only chunk is valid
    // when the source contains a separator longer than the provider limit.
    if (end <= start) end = limit;
    if (!containsNonWhitespace(codePoints, start, end) && end < limit) {
      // Keep a short leading separator with the next source characters when
      // the provider limit allows it, avoiding an unnecessary empty narration
      // request while preserving exact source offsets.
      end = limit;
    }

    const startOffset = offsets[start];
    const endOffset = offsets[end];
    const chunkText = text.slice(startOffset, endOffset);
    if (!chunkText) {
      throw new Error("Narration splitter produced an empty chunk");
    }
    chunks.push({
      index: chunks.length,
      text: chunkText,
      startOffset,
      endOffset,
    });
    start = end;
  }

  return chunks;
}
