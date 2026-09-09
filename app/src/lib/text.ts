/**
 * Byte-aware text limits. The program stores a narrative's name and ticker as
 * UTF-8 bytes, so the form has to count the same way: an emoji is one glyph,
 * two JavaScript characters and four bytes, and a name that passes a character
 * count can still be refused at launch.
 */

const encoder = new TextEncoder();

/** Length of `s` in UTF-8 bytes, which is what the program counts. */
export function utf8Length(s: string): number {
  return encoder.encode(s).length;
}

/** What a person would call characters: emoji and their modifiers stay whole. */
function graphemes(s: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(s), (g) => g.segment);
  }
  return Array.from(s);
}

/** Cuts `s` down to at most `max` UTF-8 bytes without splitting a glyph. */
export function clipUtf8(s: string, max: number): string {
  if (utf8Length(s) <= max) return s;
  let out = "";
  for (const g of graphemes(s)) {
    if (utf8Length(out + g) > max) break;
    out += g;
  }
  return out;
}
