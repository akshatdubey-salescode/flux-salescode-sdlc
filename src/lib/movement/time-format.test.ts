import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatIst, plainParseNotes } from "./time-format";

describe("formatIst", () => {
  it("is a fixed IST (UTC+5:30) format: 12-hour clock, no locale, same input same text", () => {
    assert.equal(formatIst("2026-11-19T16:21:12.841Z"), "19 Nov, 9:51 pm IST");
    assert.equal(formatIst(new Date("2026-11-19T16:21:59Z")), "19 Nov, 9:51 pm IST", "seconds do not matter, so a re-check keeps the same text within the minute");
    assert.equal(formatIst("2026-11-19T18:30:00Z"), "20 Nov, 12:00 am IST", "midnight, next day");
    assert.equal(formatIst("2026-12-31T06:30:00Z"), "31 Dec, 12:00 pm IST", "noon");
    assert.equal(formatIst("2026-01-01T00:05:00Z"), "1 Jan, 5:35 am IST");
    assert.equal(formatIst("not a date"), "not a date");
  });
  it("plainParseNotes maps every parser code to words and never prints a code", () => {
    const codes = ["json_missing", "json_malformed", "json_disagrees", "section_missing", "section_duplicate", "section_title_mismatch", "header_mismatch", "date_unparseable", "extractor_failed", "truncated"];
    for (const c of codes) {
      const t = plainParseNotes([c]);
      assert.ok(t.length > 10 && !t.includes("_") && !t.includes(c), `${c} -> ${t}`);
    }
    assert.equal(plainParseNotes(["mystery"]), "the record has formatting notes");
    assert.equal(plainParseNotes(["mystery", "other"]), "the record has formatting notes");
  });
});
