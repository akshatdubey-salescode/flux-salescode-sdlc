import test from "node:test";
import assert from "node:assert/strict";
import { toSupportTicketRow, type RawSupportTicket } from "./ticket-row";

const created = new Date("2026-11-10T05:00:00Z");
const updated = new Date("2026-11-12T05:00:00Z");
const completed = new Date("2026-11-11T05:00:00Z");

function raw(over: Partial<RawSupportTicket> = {}): RawSupportTicket {
  return {
    issueId: "i1",
    jiraKey: "RL-1",
    summary: "Something broke",
    status: "Open",
    statusCategory: "To Do",
    canonicalStatus: null,
    issueType: "Task",
    priority: "High",
    customFields: {},
    jiraCreatedAt: created,
    jiraUpdatedAt: updated,
    completedAt: null,
    rcaFieldIds: ["customfield_rca"],
    endDateFieldIds: null,
    storedCategory: null,
    ownerSide: null,
    firstRespondedAt: null,
    usersReported: null,
    usersImpacted: null,
    fluxEta: null,
    events: null,
    ...over,
  };
}

test("category: stored wins, bug-family defaults to bug, else null", () => {
  assert.equal(toSupportTicketRow(raw()).category, null);
  assert.equal(toSupportTicketRow(raw({ issueType: "  Bug " })).category, "bug");
  assert.equal(toSupportTicketRow(raw({ issueType: "Sub-bug" })).category, "bug");
  assert.equal(
    toSupportTicketRow(raw({ issueType: "Bug", storedCategory: "understanding" })).category,
    "understanding",
  );
});

test("resolvedAt: open is null; done uses completedAt then jiraUpdatedAt", () => {
  assert.equal(toSupportTicketRow(raw({ completedAt: completed })).resolvedAt, null);
  assert.equal(
    toSupportTicketRow(raw({ canonicalStatus: "DONE", completedAt: completed })).resolvedAt,
    completed,
  );
  assert.equal(toSupportTicketRow(raw({ canonicalStatus: "CANCELLED" })).resolvedAt, updated);
  // No mapping row: falls back to statusCategory.
  assert.equal(toSupportTicketRow(raw({ statusCategory: "Done" })).resolvedAt, updated);
  // Mapping row says open even though the category looks done.
  assert.equal(
    toSupportTicketRow(raw({ canonicalStatus: "IN_PROGRESS", statusCategory: "Done" })).resolvedAt,
    null,
  );
});

test("priority buckets with null -> P4", () => {
  assert.equal(toSupportTicketRow(raw()).priority, "P2");
  assert.equal(toSupportTicketRow(raw({ priority: null })).priority, "P4");
});

test("eta: Flux value, else Jira due date, else null", () => {
  assert.equal(toSupportTicketRow(raw()).eta, null);
  const withDue = toSupportTicketRow(raw({ customFields: { duedate: "2026-11-25" } }));
  assert.equal(withDue.eta, "2026-11-25");
  assert.equal(withDue.jiraDueDate, "2026-11-25");
  const both = toSupportTicketRow(
    raw({ customFields: { duedate: "2026-11-25" }, fluxEta: "2026-11-22" }),
  );
  assert.equal(both.eta, "2026-11-22");
  assert.equal(both.fluxEta, "2026-11-22");
});

test("rcaGiven reads the discovered RCA field", () => {
  assert.equal(toSupportTicketRow(raw()).rcaGiven, false);
  assert.equal(
    toSupportTicketRow(raw({ customFields: { customfield_rca: "  config drift " } })).rcaGiven,
    true,
  );
});

test("events parsed from ISO strings and sorted; ownerSide defaults to salescode", () => {
  const row = toSupportTicketRow(
    raw({
      events: [
        { side: "salescode", at: "2026-11-10T09:00:00+05:30" },
        { side: "client", at: "2026-11-10T08:00:00+05:30" },
      ],
    }),
  );
  assert.deepEqual(
    row.events.map((e) => [e.side, e.at.toISOString()]),
    [
      ["client", "2026-11-10T02:30:00.000Z"],
      ["salescode", "2026-11-10T03:30:00.000Z"],
    ],
  );
  assert.equal(row.ownerSide, "salescode");
  assert.equal(toSupportTicketRow(raw({ ownerSide: "client" })).ownerSide, "client");
});
