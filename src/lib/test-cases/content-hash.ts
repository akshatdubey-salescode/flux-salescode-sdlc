// Fingerprints used to RECOGNISE the same content again (an unchanged
// resubmission, the same workbook on another item). They are never used to merge
// stored files: each round keeps its own immutable copy of what was reviewed.

import { createHash } from "node:crypto";
import { trimGrid } from "./xlsx";

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Hash of an item's test cases: the ticked tabs' titles and cell text. Sorted by
 * tab title and with padding rows/columns trimmed, so the order the tabs were
 * ticked in and a sheet's blank filler don't change it, while any edited cell does.
 */
export function contentHash(tabs: { title: string; grid: unknown[][] }[]): string {
  const h = createHash("sha256");
  for (const tab of [...tabs].sort((a, b) => a.title.localeCompare(b.title))) {
    h.update(`T${tab.title.length}:${tab.title}\n`);
    for (const row of trimGrid(tab.grid)) {
      h.update(row.map((c) => `${c.length}:${c}`).join("\u0002"));
      h.update("\u0003");
    }
    h.update("\u0004");
  }
  return h.digest("hex");
}
