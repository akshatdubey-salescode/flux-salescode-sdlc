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

export type RangePreset = { label: string; start: string; end: string };

/**
 * Relative quick-select ranges (rolling windows + calendar/fiscal periods) for
 * filter bars. End-inclusive YYYY-MM-DD strings. Rolling windows include today,
 * so "Last 7 days" is today and the 6 days before it.
 */
export function getRangePresets(): RangePreset[] {
  const now = new Date();
  const today = localDateStr(now);

  const minusDays = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return localDateStr(d);
  };

  // Month-to-date (1st of the current month → today).
  const monthStart = localDateStr(new Date(now.getFullYear(), now.getMonth(), 1));

  // Previous full calendar month. Day 0 of the current month = last day of the
  // previous month; month-1 with day 1 = its first day (JS rolls Jan→prev Dec).
  const lastMonthStart = localDateStr(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const lastMonthEnd = localDateStr(new Date(now.getFullYear(), now.getMonth(), 0));

  // Fiscal-year-to-date (1 April of the current fiscal year → today).
  const fyStartYear = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;

  return [
    { label: "Last 7 days", start: minusDays(6), end: today },
    { label: "Last 30 days", start: minusDays(29), end: today },
    { label: "Last 90 days", start: minusDays(89), end: today },
    { label: "This month", start: monthStart, end: today },
    { label: "Last month", start: lastMonthStart, end: lastMonthEnd },
    { label: "FY to date", start: `${fyStartYear}-04-01`, end: today },
  ];
}

// ---------------------------------------------------------------------------
// Weekly helpers — GitHub's contributor-stats source is weekly, with each
// bucket keyed to the Sunday that starts the week. These snap day-precise
// selections onto those Sunday→Saturday weeks so the UI can't ask for a slice
// finer than the data actually has.
// ---------------------------------------------------------------------------

const dayMs = 86_400_000;
const parseLocal = (s: string) => new Date(`${s}T00:00:00`);

/** The Sunday (YYYY-MM-DD) that starts the week containing `dateStr`. */
export function weekStartOf(dateStr: string): string {
  const d = parseLocal(dateStr);
  d.setDate(d.getDate() - d.getDay()); // getDay(): 0 = Sunday
  return localDateStr(d);
}

/** The Saturday (YYYY-MM-DD) that ends the week containing `dateStr`. */
export function weekEndOf(dateStr: string): string {
  const d = parseLocal(dateStr);
  d.setDate(d.getDate() - d.getDay() + 6);
  return localDateStr(d);
}

export type CoveredWeeks = {
  /** First day actually shown — the Sunday of the earliest included week. */
  firstDay: string;
  /** Last day actually shown — the Saturday of the latest included week. */
  lastDay: string;
  /** Count of whole Sunday–Saturday weeks in the span. */
  weeks: number;
};

/**
 * Snap a selected [start, end] day range onto the whole Sunday–Saturday weeks
 * it touches — i.e. the exact dates whose contributions the weekly query will
 * include. Use this for both the DB window and the "showing …" disclosure so
 * the displayed span and the counted data can never disagree.
 */
export function coveredWeekSpan(start: string, end: string): CoveredWeeks {
  const firstDay = weekStartOf(start);
  const lastDay = weekEndOf(end);
  const days = Math.round((parseLocal(lastDay).getTime() - parseLocal(firstDay).getTime()) / dayMs);
  return { firstDay, lastDay, weeks: Math.max(0, Math.round((days + 1) / 7)) };
}

/**
 * Weekly quick-ranges (Sunday–Saturday aligned) for the Lines of Code view.
 * Day-based presets like "Last 7 days" are intentionally omitted here: the LOC
 * data is weekly, so a sub-week window would silently under- or over-count.
 */
export function getWeekRangePresets(): RangePreset[] {
  const now = localDateStr(new Date());
  const thisSun = weekStartOf(now);
  const thisSat = weekEndOf(now);

  const sundaysAgo = (n: number) => {
    const d = parseLocal(thisSun);
    d.setDate(d.getDate() - 7 * n);
    return localDateStr(d);
  };

  const fyStartYear = currentFyStartYear();

  return [
    { label: "This week", start: thisSun, end: thisSat },
    { label: "Last 4 weeks", start: sundaysAgo(3), end: thisSat },
    { label: "Last 12 weeks", start: sundaysAgo(11), end: thisSat },
    { label: "Last 26 weeks", start: sundaysAgo(25), end: thisSat },
    { label: "FY to date", start: weekStartOf(`${fyStartYear}-04-01`), end: thisSat },
  ];
}

/**
 * Minutes per cache-key bucket for `now`. See `bucketNowForCache`.
 */
export const NOW_CACHE_BUCKET_MINUTES = 15;

/**
 * Floors an ISO-ish local timestamp ("YYYY-MM-DDTHH:MM[:SS]") to a
 * 15-minute bucket, returning "YYYY-MM-DDTHH:MM:00".
 *
 * The analytics routes pass `now` into their cached fetchers, so it lands in
 * the cache key. At minute precision that key changed 60 times an hour, so
 * every request was a guaranteed miss and paid the full query cost. Bucketing
 * makes the key change 4 times an hour instead.
 *
 * `now` only feeds the at-risk/overdue classification (working hours left
 * before a due date), so a sub-bucket shift can move an issue across the
 * at-risk threshold at most `NOW_CACHE_BUCKET_MINUTES` early or late. The date
 * portion — which decides "overdue" — is untouched.
 *
 * Malformed input is returned normalised to the minute rather than throwing,
 * matching the previous behaviour.
 */
export function bucketNowForCache(raw: string): string {
  const datePart = raw.slice(0, 11); // "YYYY-MM-DDT"
  const hh = Number(raw.slice(11, 13));
  const mm = Number(raw.slice(14, 16));
  if (
    raw.length < 16 ||
    raw[10] !== "T" ||
    !Number.isInteger(hh) ||
    !Number.isInteger(mm) ||
    hh < 0 ||
    hh > 23 ||
    mm < 0 ||
    mm > 59
  ) {
    return raw.slice(0, 16) + ":00";
  }
  const bucketed = Math.floor(mm / NOW_CACHE_BUCKET_MINUTES) * NOW_CACHE_BUCKET_MINUTES;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${datePart}${pad(hh)}:${pad(bucketed)}:00`;
}
