// The Team Pulse date range lives only in the URL, so moving between a team and
// one of its sub-teams has to copy it across explicitly. This picks a coherent
// selection out of a set of search params, ready to append to the target URL.

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

type Getter = (key: string) => string | null | undefined;

/**
 * Board params are `mode` / `date` / `tstart` / `tend`; the project timeline
 * keeps the same values under `ptmode` / `ptdate` / `pttstart` / `pttend`
 * (the board keys win when both exist). Returns an empty set unless the
 * selection is complete and well-formed, so the target page's defaults apply
 * instead of a half-applied range.
 */
export function pickRangeParams(get: Getter): URLSearchParams {
  const read = (key: string, ptKey: string) => get(key) ?? get(ptKey) ?? undefined;
  const mode = read("mode", "ptmode");
  const date = read("date", "ptdate");
  const tstart = read("tstart", "pttstart");
  const tend = read("tend", "pttend");

  const out = new URLSearchParams();
  if (mode === "range") {
    if (tstart && tend && ISO_DAY.test(tstart) && ISO_DAY.test(tend)) {
      out.set("mode", "range");
      out.set("tstart", tstart);
      out.set("tend", tend);
    }
  } else if ((mode === "single" || mode === undefined) && date && ISO_DAY.test(date)) {
    out.set("mode", "single");
    out.set("date", date);
  }
  return out;
}
