// Splits an item's cases into groups small enough for one model call. Cases stay in their tab order; a tab is only
// split when it alone is too big. Every call also gets an index of ALL cases (see prompt.ts) so coverage is judged
// against the whole item, not just the group in front of the model.

export const CHUNK_CHARS = 80_000;

export type Sized = { size: number };

export function chunkBySize<T extends Sized>(items: T[], maxChars: number = CHUNK_CHARS): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let used = 0;
  for (const it of items) {
    if (current.length > 0 && used + it.size > maxChars) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(it);
    used += it.size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks.length > 0 ? chunks : [[]];
}
