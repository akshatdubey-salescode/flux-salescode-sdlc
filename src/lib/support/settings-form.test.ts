import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEmailChips, settingsErrorField } from "./settings-form";
import { parseSettingsBody } from "./validate";

test("splits pasted lists on commas, semicolons and whitespace, lowercased", () => {
  assert.deepEqual(parseEmailChips("A@x.com, b@y.io;c@z.org  d@w.net"), {
    added: ["a@x.com", "b@y.io", "c@z.org", "d@w.net"],
    invalid: [],
  });
});

test("dedupes against existing chips and within the input", () => {
  assert.deepEqual(parseEmailChips("a@x.com, A@X.com, b@y.io", ["B@y.io"]), {
    added: ["a@x.com"],
    invalid: [],
  });
});

test("returns non-emails as invalid, keeping their original text", () => {
  assert.deepEqual(parseEmailChips("a@x.com, Priya, foo@bar"), {
    added: ["a@x.com"],
    invalid: ["Priya", "foo@bar"],
  });
});

test("empty and separator-only input adds nothing", () => {
  assert.deepEqual(parseEmailChips(" , ;  "), { added: [], invalid: [] });
});

test("maps validation messages to form sections", () => {
  assert.equal(settingsErrorField("supportLabel is required"), "supportLabel");
  assert.equal(settingsErrorField("sharedBy is required"), "sharedBy");
  assert.equal(settingsErrorField("Invalid email in toEmails: x"), "toEmails");
  assert.equal(
    settingsErrorField("At least one To recipient is required to enable the report"),
    "toEmails",
  );
  assert.equal(settingsErrorField("Invalid email in ccEmails: x"), "ccEmails");
  assert.equal(settingsErrorField("periodStart (YYYY-MM-DD) is required for a custom period"), "period");
  assert.equal(settingsErrorField("periodMode must be mtd, ytd or custom"), "period");
  assert.equal(settingsErrorField("sla.P2.resolutionMin must be a positive integer"), "sla");
  assert.equal(settingsErrorField("officeHours.start must be before end"), "officeHours");
  assert.equal(settingsErrorField("approverUserIds must be an array of non-empty strings"), "approvers");
  assert.equal(settingsErrorField("Invalid JSON body"), "form");
});

test("every parseSettingsBody error lands in a named section", () => {
  const valid = {
    enabled: true,
    supportLabel: "support",
    sharedBy: "L2 Support",
    toEmails: ["a@x.com"],
    ccEmails: [],
    periodMode: "mtd",
    periodStart: null,
    sla: {
      P1: { responseMin: 10, resolutionMin: 240 },
      P2: { responseMin: 10, resolutionMin: 480 },
      P3: { responseMin: 30, resolutionMin: 1440 },
      P4: { responseMin: 30, resolutionMin: 2400 },
    },
    officeHours: { start: "10:00", end: "19:00", days: [1, 2, 3, 4, 5] },
    approverUserIds: [],
  };
  assert.equal(parseSettingsBody(valid).ok, true);
  const broken: [Record<string, unknown>, string][] = [
    [{ enabled: "yes" }, "enabled"],
    [{ supportLabel: " " }, "supportLabel"],
    [{ sharedBy: "" }, "sharedBy"],
    [{ toEmails: ["nope"] }, "toEmails"],
    [{ toEmails: [] }, "toEmails"],
    [{ ccEmails: ["nope"] }, "ccEmails"],
    [{ periodMode: "custom", periodStart: null }, "period"],
    [{ sla: { ...valid.sla, P3: { responseMin: 0, resolutionMin: 1 } } }, "sla"],
    [{ officeHours: { start: "19:00", end: "10:00", days: [1] } }, "officeHours"],
    [{ officeHours: { start: "10:00", end: "19:00", days: [] } }, "officeHours"],
    [{ approverUserIds: [""] }, "approvers"],
  ];
  for (const [patch, field] of broken) {
    const r = parseSettingsBody({ ...valid, ...patch });
    assert.equal(r.ok, false, JSON.stringify(patch));
    if (!r.ok) assert.equal(settingsErrorField(r.error), field, r.error);
  }
});
