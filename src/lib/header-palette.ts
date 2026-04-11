export const HEADER_PALETTE = [
  "#1e293b", // Slate
  "#1e3a5f", // Navy
  "#0c4a6e", // Ocean
  "#0e7490", // Cyan
  "#134e4a", // Teal
  "#14532d", // Forest
  "#4a1942", // Plum
  "#2e1065", // Violet
  "#312e81", // Indigo
  "#581c87", // Purple
  "#7f1d1d", // Crimson
  "#881337", // Rose
  "#78350f", // Amber
  "#44403c", // Stone
  "#3f3f46", // Zinc
  "#374151", // Cool Gray
] as const;

/** Deterministically pick a palette color from a project UUID */
export function paletteColorForId(id: string): string {
  // Sum char codes of the first 8 chars of the UUID for a stable index
  let n = 0;
  for (let i = 0; i < Math.min(8, id.length); i++) {
    n += id.charCodeAt(i);
  }
  return HEADER_PALETTE[n % HEADER_PALETTE.length];
}

/** Pick a random palette color (for use at creation time) */
export function randomPaletteColor(): string {
  return HEADER_PALETTE[Math.floor(Math.random() * HEADER_PALETTE.length)];
}
