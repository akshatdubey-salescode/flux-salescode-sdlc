// Unit tests for the Team Pulse date-range carry-over between teams.
//
// Run: ./node_modules/.bin/tsx --test "src/lib/observer/range-params.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickRangeParams } from "./range-params";

const from = (o: Record<string, string>) => (k: string) => o[k];
const str = (p: URLSearchParams) => p.toString();

test("a range selection is carried as mode, tstart and tend", () => {
  const p = pickRangeParams(from({ mode: "range", tstart: "2026-10-01", tend: "2026-10-13", tab: "overdue", q: "x" }));
  assert.equal(str(p), "mode=range&tstart=2026-10-01&tend=2026-10-13", "only the date range, not the tab or search");
});

test("a single date is carried, with or without an explicit mode", () => {
  assert.equal(str(pickRangeParams(from({ mode: "single", date: "2026-10-05" }))), "mode=single&date=2026-10-05");
  assert.equal(str(pickRangeParams(from({ date: "2026-10-05" }))), "mode=single&date=2026-10-05");
});

test("nothing is carried when no date is selected, so defaults apply", () => {
  assert.equal(str(pickRangeParams(from({}))), "");
  assert.equal(str(pickRangeParams(from({ mode: "single" }))), "");
  assert.equal(str(pickRangeParams(from({ tab: "overdue" }))), "");
});

test("a half-applied or malformed range is dropped rather than carried", () => {
  assert.equal(str(pickRangeParams(from({ mode: "range", tstart: "2026-10-01" }))), "", "missing end");
  assert.equal(str(pickRangeParams(from({ mode: "range", tstart: "2026-10-01", tend: "soon" }))), "", "bad end");
  assert.equal(str(pickRangeParams(from({ mode: "range", date: "2026-10-01" }))), "", "range mode needs tstart+tend");
  assert.equal(str(pickRangeParams(from({ mode: "single", date: "01/10/2026" }))), "", "bad date");
  assert.equal(str(pickRangeParams(from({ mode: "weird", date: "2026-10-01" }))), "", "unknown mode");
  assert.equal(str(pickRangeParams(from({ mode: "range", tstart: "2026-10-01", tend: "2026-10-02&x=1" }))), "", "no param injection");
});

test("project-timeline keys are mapped onto the board keys", () => {
  assert.equal(
    str(pickRangeParams(from({ ptmode: "range", pttstart: "2026-09-01", pttend: "2026-09-30" }))),
    "mode=range&tstart=2026-09-01&tend=2026-09-30",
  );
  assert.equal(str(pickRangeParams(from({ ptmode: "single", ptdate: "2026-09-02" }))), "mode=single&date=2026-09-02");
});

test("board keys win over project-timeline keys", () => {
  const p = pickRangeParams(from({ mode: "single", date: "2026-10-05", ptmode: "range", pttstart: "2026-09-01", pttend: "2026-09-30" }));
  assert.equal(str(p), "mode=single&date=2026-10-05");
});
