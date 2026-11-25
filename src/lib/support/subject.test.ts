import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SUBJECT_TEMPLATE, renderSubject } from "./subject";

const VARS = { client: "Dabur", project: "Dabur SFA", period: "MTD", reportDate: "2026-11-27" };

test("fills {client}, {period} and {date}", () => {
  assert.equal(renderSubject("{client}: Ticket Summary {period} | {date}", VARS), "Dabur: Ticket Summary MTD | 27 Nov 2026");
});

test("placeholders are case-insensitive, repeatable, and {project} is the Flux project name", () => {
  assert.equal(renderSubject("{Client} / {CLIENT} — {project}", VARS), "Dabur / Dabur — Dabur SFA");
});

test("[Date]-style brackets work too", () => {
  assert.equal(renderSubject("[client]: Ticket Summary [period] | [date]", VARS), "Dabur: Ticket Summary MTD | 27 Nov 2026");
});

test("unknown placeholders stay as typed; whitespace is tidied", () => {
  assert.equal(renderSubject("  {client}   {nope}  ", VARS), "Dabur {nope}");
});

test("the default template reproduces the original subject", () => {
  assert.equal(
    renderSubject(DEFAULT_SUBJECT_TEMPLATE, { ...VARS, client: "Acme" }),
    "Issue Report — Daily Update | Acme | 27 Nov 2026",
  );
});

test("an empty template falls back to the default", () => {
  assert.equal(renderSubject("   ", VARS), "Issue Report — Daily Update | Dabur | 27 Nov 2026");
});
