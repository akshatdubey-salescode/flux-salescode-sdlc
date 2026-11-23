import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TIME_ZONE,
  addDays,
  dateInZone,
  formatZonedDateTime,
  fromZonedInputValue,
  isValidTimeZone,
  minutesOfDayInZone,
  toZonedInputValue,
  wallTimeToInstant,
  weekdayOf,
  zoneLabel,
} from "./tz";

const KOLKATA = "Asia/Kolkata";
const BA = "America/Argentina/Buenos_Aires";
const NY = "America/New_York";

test("default zone is Asia/Kolkata", () => {
  assert.equal(DEFAULT_TIME_ZONE, KOLKATA);
});

test("dateInZone: the calendar day depends on the zone", () => {
  const d = new Date("2026-11-20T20:00:00Z"); // 01:30 21 Nov IST, 17:00 20 Nov ART
  assert.equal(dateInZone(d, KOLKATA), "2026-11-21");
  assert.equal(dateInZone(d, BA), "2026-11-20");
  assert.equal(dateInZone(d, "UTC"), "2026-11-20");
});

test("wallTimeToInstant handles fixed and DST zones", () => {
  assert.equal(wallTimeToInstant("2026-11-20", "10:00", KOLKATA).toISOString(), "2026-11-20T04:30:00.000Z");
  assert.equal(wallTimeToInstant("2026-11-20", "10:00", BA).toISOString(), "2026-11-20T13:00:00.000Z");
  // New York: EDT (-4) in July, EST (-5) in December.
  assert.equal(wallTimeToInstant("2026-07-01", "10:00", NY).toISOString(), "2026-07-01T14:00:00.000Z");
  assert.equal(wallTimeToInstant("2026-12-01", "10:00", NY).toISOString(), "2026-12-01T15:00:00.000Z");
  // "24:00" is midnight at the end of the day.
  assert.equal(wallTimeToInstant("2026-11-20", "24:00", KOLKATA).toISOString(), "2026-11-20T18:30:00.000Z");
});

test("input values round-trip in the given zone", () => {
  const d = new Date("2026-11-20T13:00:00Z");
  assert.equal(toZonedInputValue(d, KOLKATA), "2026-11-20T18:30");
  assert.equal(toZonedInputValue(d, BA), "2026-11-20T10:00");
  assert.equal(fromZonedInputValue("2026-11-20T10:00", BA)?.toISOString(), d.toISOString());
  assert.equal(fromZonedInputValue("2026-11-20T18:30", KOLKATA)?.toISOString(), d.toISOString());
  assert.equal(fromZonedInputValue("nope", KOLKATA), null);
  assert.equal(fromZonedInputValue("", KOLKATA), null);
});

test("formatZonedDateTime", () => {
  const iso = "2026-01-05T05:00:00Z";
  assert.equal(formatZonedDateTime(iso, KOLKATA), "5 Jan 2026, 10:30");
  assert.equal(formatZonedDateTime(iso, BA), "5 Jan 2026, 02:00");
});

test("weekday, minutes of day and addDays", () => {
  assert.equal(weekdayOf("2026-11-20"), 5); // Friday
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(minutesOfDayInZone(new Date("2026-11-20T11:30:00Z"), KOLKATA), 17 * 60);
  assert.equal(minutesOfDayInZone(new Date("2026-11-20T20:00:00Z"), BA), 17 * 60);
});

test("zone labels prefer a familiar abbreviation", () => {
  assert.equal(zoneLabel(KOLKATA), "IST");
  assert.equal(zoneLabel(BA), "GMT-3");
  assert.equal(zoneLabel(NY, new Date("2026-12-01T12:00:00Z")), "EST");
  assert.equal(zoneLabel(NY, new Date("2026-07-01T12:00:00Z")), "EDT");
});

test("isValidTimeZone", () => {
  assert.equal(isValidTimeZone(KOLKATA), true);
  assert.equal(isValidTimeZone("Asia/Calcutta"), true);
  assert.equal(isValidTimeZone(BA), true);
  assert.equal(isValidTimeZone("Mars/Olympus"), false);
  assert.equal(isValidTimeZone(""), false);
  assert.equal(isValidTimeZone(42), false);
});
