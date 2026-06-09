export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function quarterBounds(fyStartYear: number, q: number): { start: string; end: string } {
  const y = fyStartYear;
  const dates = [
    { start: `${y}-04-01`,   end: `${y}-06-30`   }, // Q1 Apr–Jun
    { start: `${y}-07-01`,   end: `${y}-09-30`   }, // Q2 Jul–Sep
    { start: `${y}-10-01`,   end: `${y}-12-31`   }, // Q3 Oct–Dec
    { start: `${y+1}-01-01`, end: `${y+1}-03-31` }, // Q4 Jan–Mar (next cal year)
  ];
  return dates[q - 1];
}

export function currentFyStartYear(): number {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}

export function currentQuarterNum(): number {
  const month = new Date().getMonth() + 1;
  if (month >= 4 && month <= 6) return 1;
  if (month >= 7 && month <= 9) return 2;
  if (month >= 10) return 3;
  return 4; // Jan–Mar
}

export type QuarterChip = { label: string; start: string; end: string };

/** Fiscal-quarter chips (Apr–Mar) for filter bars: last 2, current, next. */
export function getQuarterChips(): QuarterChip[] {
  return getRelevantQuarters().map((q) => ({
    label: `${q.label} ${q.year}`,
    start: q.start,
    end: q.end,
  }));
}

/** The chip for the current fiscal quarter — the sensible default selection. */
export function currentFiscalQuarterChip(): QuarterChip {
  const { start } = quarterBounds(currentFyStartYear(), currentQuarterNum());
  const chips = getQuarterChips();
  return chips.find((q) => q.start === start) ?? chips[0];
}

/** Fiscal-quarter bounds containing the given YYYY-MM-DD date. */
export function fiscalQuarterOf(dateStr: string): { start: string; end: string } {
  const [y, m] = dateStr.split("-").map(Number);
  const fyStart = m >= 4 ? y : y - 1;
  const q = m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 ? 3 : 4;
  return quarterBounds(fyStart, q);
}

export function getRelevantQuarters() {
  const monthRanges = ["Apr–Jun", "Jul–Sep", "Oct–Dec", "Jan–Mar"];
  const currentQ = currentQuarterNum();
  const currentFy = currentFyStartYear();

  // Pragmatic window: Last 2, Current, Next
  return [-2, -1, 0, 1].map((offset) => {
    let q = currentQ + offset;
    let fy = currentFy;

    while (q < 1) {
      q += 4;
      fy -= 1;
    }
    while (q > 4) {
      q -= 4;
      fy += 1;
    }

    const displayYear = q === 4 ? fy + 1 : fy;
    return {
      label: `Q${q}`,
      year: displayYear,
      sublabel: monthRanges[q - 1],
      ...quarterBounds(fy, q),
    };
  });
}
