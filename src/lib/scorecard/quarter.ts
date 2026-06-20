// Quarter selection for the performance-review dashboard. Reuses the project's
// fiscal-quarter math (Apr–Mar) from date-utils and produces a stable string
// key per quarter that's used as the performance_scorecards primary grouping.

import {
  quarterBounds,
  currentFyStartYear,
  currentQuarterNum,
} from "@/lib/date-utils";

export type Quarter = {
  /** Stable storage key, e.g. "FY2026-Q1". */
  key: string;
  /** Display label, e.g. "Q1 FY2026 (Apr–Jun)". */
  label: string;
  start: string; // YYYY-MM-DD (inclusive)
  end: string; // YYYY-MM-DD (inclusive)
};

const MONTH_RANGES = ["Apr–Jun", "Jul–Sep", "Oct–Dec", "Jan–Mar"];

function makeQuarter(fyStartYear: number, q: number): Quarter {
  const { start, end } = quarterBounds(fyStartYear, q);
  return {
    key: `FY${fyStartYear}-Q${q}`,
    label: `Q${q} FY${fyStartYear} (${MONTH_RANGES[q - 1]})`,
    start,
    end,
  };
}

/**
 * Quarters offered in the dashboard selector: the current fiscal quarter and
 * the previous three (reviews are retrospective, so future quarters are
 * omitted). Most-recent first.
 */
export function selectableQuarters(): Quarter[] {
  const currentQ = currentQuarterNum();
  const currentFy = currentFyStartYear();
  return [0, -1, -2, -3].map((offset) => {
    let q = currentQ + offset;
    let fy = currentFy;
    while (q < 1) {
      q += 4;
      fy -= 1;
    }
    return makeQuarter(fy, q);
  });
}

export function currentQuarter(): Quarter {
  return makeQuarter(currentFyStartYear(), currentQuarterNum());
}

/** Resolve a stored key back to its bounds; null if malformed/unknown. */
export function quarterFromKey(key: string): Quarter | null {
  const m = /^FY(\d{4})-Q([1-4])$/.exec(key);
  if (!m) return null;
  return makeQuarter(Number(m[1]), Number(m[2]));
}
