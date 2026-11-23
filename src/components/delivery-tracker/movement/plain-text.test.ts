/** The plain-language layer, on the real strings of the CAV-7293 / CAV-7300 / CAV-7280 review comments. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanNoise, makeDeduper, notKnownYet, plainCopy, plainify, plainLines, plainStatus, pointerRows, sentencesOf, splitEnumeration } from "./plain-text";

const RESTART = "Channel Kart (code); properties need cache clear only. Slake Reporting: executor jar + config reload (how: unknown (devops)). KPI Dashboard UI: static deploy, users log in again";
const CODE_REVIEWED =
  "core, executors and configs DONE (approved). kpi#246 NOT DONE (no formal approval). #1156 had no review of its own. Breakage risk for other LOBs: YES, low-medium, shared code: a) InvoiceCollectionDTO: a null status now maps to null instead of failing with 500; this applies to EVERY LOB with no switch (D2) b) the guard (switch off = no check, no extra query) sits on getUnpaidInvoicesByOutletCode, getInvoiceCollectionsByDate c) the reports add a column only when the arg is set (D3)";
const PERF = "Yes (1) the 3 invoice APIs at page size 5000 with the switch on: added lookups are batches of at most 1,000 numbers; UAT slowest call 1.43 s (PR text); target under 2 s on prod size (2) EXPLAIN + time of the ck_orders lookup and of the ORDER BY id query on prod (about 1 s) (3) the 3 reports on ckcoedemo and ckcoeuat at prod size, arg on vs off: duration and row count equal (4) the full: true run of reports";
const ROLES = "Yes admin (not limited); distributor (own supplier 200, another supplier 403); supervisor above; salesman (own salesRep 200, another salesman 403); an outlet alone 403. Test by calling the API directly as well";

describe("cleanNoise: tags, unknowns and pointers", () => {
  it("strips [V] [I] [author] tags and (D2) decision tags without touching numbers or keys", () => {
    assert.equal(cleanNoise("Rows merge in place [V] row_hash is unchanged [I] by the author [author, UAT] (D2) on 5000 rows").text, "Rows merge in place row_hash is unchanged by the author on 5000 rows");
    assert.equal(cleanNoise("the only change is D2 (null status gives 200, not 500)").text, "the only change is (null status gives 200, not 500)");
  });
  it("turns every 'unknown' spelling into 'Not known yet — X to confirm'", () => {
    assert.equal(cleanNoise("Unknown (release manager)").text, "Not known yet — release manager to confirm");
    assert.equal(cleanNoise("oldest supported build: unknown (mobile lead)").text, "oldest supported build: not known yet — mobile lead to confirm");
    assert.equal(cleanNoise("executor jar + config reload (how: unknown (devops))").text, "executor jar + config reload (how: not known yet — devops to confirm)");
    assert.equal(cleanNoise("how: unknown, devops)").text, "how: not known yet — devops to confirm)");
    assert.equal(cleanNoise("The ckcoe prod branch is not confirmed (unknown, devops)").text, "The ckcoe prod branch is not confirmed (not known yet — devops to confirm)");
    assert.equal(cleanNoise("the oracle is unknown, owner to confirm: QA lead.").text, "the oracle is not known yet — QA lead to confirm.");
    assert.equal(notKnownYet(), "Not known yet");
  });
  it("repairs the glued 'unknownrelease manager' / 'unknowndevops' / 'unknownQA' of a styled word read as one text", () => {
    assert.equal(cleanNoise("unknownrelease manager").text, "unknown release manager");
    assert.equal(cleanNoise("unknowndevops").text, "unknown devops");
    assert.equal(cleanNoise("unknownQA").text, "unknown QA");
  });
  it("removes pointers and returns them apart: 'see row 6', 'See rows 19 and 21 ...', 'see LIKELY TO BE MISSED below', '(row 11)'", () => {
    assert.deepEqual(cleanNoise("see row 6"), { text: "", pointers: ["see row 6"] });
    const a = cleanNoise("no app PR. See rows 19 and 21 for the SFA app and the caller-scope switch");
    assert.equal(a.text, "no app PR.");
    assert.deepEqual(pointerRows(a.pointers), [19, 21]);
    assert.equal(cleanNoise("see LIKELY TO BE MISSED below").text, "");
    assert.equal(cleanNoise("no DDL, migration or data script. The properties are set through the API (row 11)").text, "no DDL, migration or data script. The properties are set through the API");
    assert.equal(cleanNoise("see the release page").text, "");
  });
});

describe("lists inside one sentence", () => {
  it("a) b) c): the items, with the text before them kept as the head", () => {
    const e = splitEnumeration(CODE_REVIEWED.replace(/ \(D\d\)/g, ""));
    assert.ok(e);
    assert.equal(e.items.length, 3);
    assert.match(e.head, /Breakage risk for other LOBs: YES, low-medium, shared code:$/);
    assert.match(e.items[0], /^InvoiceCollectionDTO: a null status now maps to null/);
    assert.match(e.items[2], /^the reports add a column only when the arg is set/);
  });
  it("(1) (2) (3) (4): four items; the 'full: true' colon and '(PR text)' are not markers", () => {
    const e = splitEnumeration(PERF);
    assert.ok(e);
    assert.equal(e.items.length, 4);
    assert.match(e.items[0], /^the 3 invoice APIs at page size 5000/);
    assert.match(e.items[3], /^the full: true run of reports$/);
  });
  it("a lone '(3)' or 'a)' is not a list", () => {
    assert.equal(splitEnumeration("run it (3) times"), null);
    assert.equal(splitEnumeration("see a) above"), null);
  });
});

describe("plainify", () => {
  it("CAV-7293 'Code reviewed' row: a short lead, the list as bullets, no tags, nothing dropped", () => {
    const p = plainify(CODE_REVIEWED);
    assert.match(p.lead, /^core, executors and configs DONE \(approved\)\.?$/i);
    const all = plainLines(p).join(" ");
    assert.ok(!/\(D\d\)/.test(all));
    for (const must of ["kpi#246 NOT DONE", "#1156 had no review", "getUnpaidInvoicesByOutletCode", "getInvoiceCollectionsByDate", "null instead of failing with 500", "Breakage risk for other LOBs"]) assert.ok(all.includes(must), must);
    assert.ok(p.bullets.length <= 4);
  });
  it("performance row: (1)..(4) become four bullets after the lead word", () => {
    const p = plainify(PERF);
    assert.equal(p.lead, "Yes");
    assert.equal(p.bullets.length, 4);
    assert.match(p.bullets[1], /^EXPLAIN \+ time of the ck_orders lookup/);
  });
  it("';' list of three or more clauses: the label is the lead, each clause a point, the last sentence kept", () => {
    const p = plainify(ROLES.replace(/^Yes /, "Check: "));
    assert.equal(p.lead, "Check:");
    assert.equal(p.bullets[0], "admin (not limited)");
    assert.ok(p.bullets.some((b) => b.startsWith("distributor (own supplier 200, another supplier 403)")));
    assert.ok([...p.bullets, ...p.more].includes("Test by calling the API directly as well"));
  });
  it("more than four points: the rest is behind 'more' and still in the copy text", () => {
    const p = plainify("a) one thing b) two things c) three things d) four things e) five things f) six things");
    assert.equal(p.bullets.length, 4);
    assert.deepEqual(p.more, ["five things", "six things"]);
    assert.equal(plainCopy(p).length, 6);
  });
  it("restart row: one sentence per service, the unknown owner in words", () => {
    const p = plainify(RESTART);
    assert.equal(p.lead, "Channel Kart (code); properties need cache clear only.".slice(0, -1));
    assert.equal(p.bullets[0], "Slake Reporting: executor jar + config reload (how: not known yet — devops to confirm)");
    assert.equal(p.bullets[1], "KPI Dashboard UI: static deploy, users log in again");
  });
  it("only a pointer: empty text, the pointer kept apart", () => {
    const p = plainify("see row 6");
    assert.equal(p.lead, "");
    assert.deepEqual(p.pointers, ["see row 6"]);
  });
  it("never adds anything: every number, key and file name of the input is still in the output", () => {
    const input = "UAT slowest call 1.43 s (PR text); target under 2 s on prod size. EXPLAIN on prod db_ckcoe_new (ck_sales about 5.2M rows, 16 Nov) shows UK_tm80okqm5deqt4gap961b5nnc and idx_sales_invser_supplier. Gate: SHOW INDEX FROM ck_sales";
    const out = plainLines(plainify(input)).join(" ");
    for (const tok of ["1.43", "5.2M", "16 Nov", "db_ckcoe_new", "UK_tm80okqm5deqt4gap961b5nnc", "idx_sales_invser_supplier", "SHOW INDEX FROM ck_sales"]) assert.ok(out.includes(tok), tok);
  });
  it("a long first sentence is split at a clause only when both halves are meaningful; otherwise it stays whole", () => {
    const longer = "channelkart: M. Against prod_blue_21_sep_2026_branch: PropertyDefinition.java and pom.xml changed on both (list edits, easy conflicts); 10 main files, no migration.";
    const p = plainify(longer);
    assert.ok(plainLines(p).join(" ").includes("PropertyDefinition.java and pom.xml changed on both"));
    assert.ok(sentencesOf("Use e.g. a flag. Then run it.").length === 2);
  });
  it("empty and whitespace input", () => {
    assert.deepEqual(plainify("   "), { lead: "", bullets: [], more: [], pointers: [] });
    assert.deepEqual(plainify(null), { lead: "", bullets: [], more: [], pointers: [] });
  });
});

describe("makeDeduper: the same fact is shown once", () => {
  it("'Previous data fix required? YES x' and the row 'Previous data fix required?: Yes x' are one sentence", () => {
    const d = makeDeduper();
    const a = plainify("Previous data fix required?: Yes reports: after deploy run each of the 3 reports once with full: true per tenant (ckcoedemo, ckcoeuat), so rows already synced get the Order Source column", { dedupe: d });
    const b = plainify("Previous data fix required? YES reports: after deploy run each of the 3 reports once with full: true per tenant (ckcoedemo, ckcoeuat), so rows already synced get the Order Source column", { dedupe: d });
    assert.ok(a.lead.length > 0);
    assert.equal(plainLines(b).length, 0);
    assert.ok(d.dropped >= 1);
  });
  it("the services row and the Services block: 'Channel Kart · KPI Dashboard - UI · Slake Reporting (no bundle, no app)' once", () => {
    const d = makeDeduper();
    const t = "Channel Kart · KPI Dashboard - UI · Slake Reporting (no bundle, no app)";
    assert.equal(plainLines(plainify(t, { dedupe: d })).length, 1);
    assert.equal(plainLines(plainify(`Services to deploy: ${t}`.replace("Services to deploy: ", ""), { dedupe: d })).length, 0);
  });
  it("a shorter sentence contained in an earlier longer one is a repeat; a different one is kept; the first kept point becomes the lead", () => {
    const d = makeDeduper();
    d.add("Slake Reporting: executor jar + config reload (how: not known yet — devops to confirm)");
    const p = plainify("Slake Reporting: executor jar + config reload. Rollback: revert the PRs", { dedupe: d });
    assert.equal(p.lead, "Slake Reporting: executor jar + config reload".length > 0 ? p.lead : "");
    assert.ok(plainLines(p).includes("Rollback: revert the PRs"));
    assert.ok(!plainLines(p).some((s) => s.startsWith("Slake Reporting: executor jar + config reload")));
  });
  it("short answers are never treated as repeats of each other", () => {
    const d = makeDeduper();
    assert.deepEqual(plainLines(plainify("No", { dedupe: d })), ["No"]);
    assert.deepEqual(plainLines(plainify("No", { dedupe: d })), ["No"]);
  });
});

describe("plainStatus", () => {
  it("HELD + PARTIAL line in plain words", () => {
    const s = plainStatus("HELD", "HELD in the DEMO movement (blocked) · PARTIAL (prod setting values and ckcoeuat index not in any file)");
    assert.equal(s.verdict, "Held");
    assert.equal(s.reason.lead, "in the DEMO movement (blocked)");
    assert.deepEqual(s.reason.bullets, ["Partly reviewed: prod setting values and ckcoeuat index not in any file"]);
  });
  it("HELD · PARTIAL · NET RESULT (CAV-7300): the three parts stay apart, with their spaces", () => {
    const s = plainStatus("HELD", "HELD in the DEMO movement (blocked) · PARTIAL · NET RESULT: only channelkart #1146 + #1181 stay active; the bundle, UI and report changes were REVERTED on 20 Nov");
    assert.equal(s.reason.lead, "in the DEMO movement (blocked)");
    assert.deepEqual(s.reason.bullets, ["Partly reviewed", "NET RESULT: only channelkart #1146 + #1181 stay active; the bundle, UI and report changes were REVERTED on 20 Nov"]);
  });
  it("no status: 'Not stated'", () => {
    assert.equal(plainStatus(null, null).verdict, "Not stated");
  });
});
