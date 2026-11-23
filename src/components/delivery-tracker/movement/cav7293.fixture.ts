/**
 * The one-Jira checklist of CAV-7293 exactly as GET items/<issueId>/checklist answered on the real DEMO movement (21 Nov 2026), reduced to what the
 * view reads (key, text, severity, label, needsAttention, chips, seq, group). It includes the parser junk of that day (`cover:before#1147`,
 * `cover:inside#1147`) so the view's own guard is tested on real data. The fact-derived duplicates of release-page rows (`db:` items, `deploynote:`,
 * `sdk`, `restartnote:`, `app:`, `role:`) are left out, as the checklist no longer builds them. Test support only.
 */
import type { Checklist } from "./api-types";

type Raw = { k: string; t: string; s?: "info" | "warn" | "blocker"; l?: string; n?: 1; c?: string[]; q?: number; g?: string };

const SECTIONS: Array<{ id: string; i: Raw[] }> = [
  { id: "header", i: [
    { k: "rec:union:before#1147,channelkart#1147", t: "union of 6 merged PRs: Collections: Order Source (SFA / DMS / eB2B) on the invoice collection APIs, the 3 collection screens (with a filter) and 3 collection reports; plus a caller-scope guard (403) on 3 invoice APIs. All behind switches, default off. Author abhaythakur71181. Target: ckcoeuat and ckcoedemo" },
    { k: "status:before#1147", t: "Review status: HELD in the DEMO movement (blocked) · PARTIAL (prod setting values and ckcoeuat index not in any file)", s: "warn", n: 1 },
    { k: "row:meeting", t: "Production meeting + everyone invited: Unknown (release manager)", s: "warn", n: 1 },
  ] },
  { id: "branches", i: [
    { k: "cover:channelkart#1147", t: "channelkart#1147 master 33e8209192 19 Nov APIs, guard, 2 properties (approved and merged by dev-b) [merged]" },
    { k: "cover:before#1147", t: "before#1147 [merged]" },
    { k: "cover:inside#1147", t: "inside#1147 [merged]" },
    { k: "cover:channelkart#1186", t: "channelkart#1186 master 47dbf2b259 19 Nov test-only Sonar fix for InvoiceCollectionOrderSourceTest; main CAV-7317 PR [merged]" },
    { k: "cover:kpi-dashboard#246", t: "kpi-dashboard#246 master 9fa6bbcb09 19 Nov columns + filter on 3 screens (merged by dev-b, no formal approval) [merged] - no formal approval" },
    { k: "noapproval:kpi-dashboard#246", t: "No formal approval: kpi-dashboard#246", s: "warn" },
    { k: "cover:slake-custom-reports#918", t: "slake-custom-reports#918 main f70b8fde80 19 Nov Order Source in 3 executors (approved and merged by dev-b) [merged]" },
    { k: "cover:slake-reporting-config#1294", t: "slake-reporting-config#1294 main 78c5a2e1f3 19 Nov ckcoedemo + ckcoeuat report configs (approved and merged by dev-b) [merged]" },
    { k: "stillopen:channelkart#1182", t: "Still open (not released): channelkart#1182 (CAV-7037 Sonar new-code issues; names CAV-7293, 7296, 7299, 7300; not in this union)", s: "warn", n: 1 },
    { k: "stackonly:channelkart#1156", t: "Merged into stack branches only, nothing is released: channelkart#1156 CAV-7293-collections-order-source 12c2cd9153 17 Nov batching fixes, merged into the feature branch", s: "warn" },
    { k: "merged:before #1147 so it is inside #1147 self merged by the author no", t: "Merged PRs: before #1147, so it is inside #1147 (self-merged by the author, no approval" },
    { k: "merged:approved and merged by dev b", t: "Merged PRs: approved and merged by dev-b" },
    { k: "row:code_reviewed", t: "Code reviewed, no breakage other LOBs: core, executors and configs DONE (approved). kpi#246 NOT DONE (no formal approval). #1156 had no review of its own. Breakage risk for other LOBs: YES, low-medium, shared code: a) InvoiceCollectionDTO: a null status now maps to null instead of failing with 500; this applies to EVERY LOB with no switch (D2) b) the guard (switch off = no check, no extra query) sits on getUnpaidInvoicesByOutletCode, getBySupplierAndOutlet and filterByLoginIdAndOrderDate, used by the DMS portal and the SFA app of every LOB c) CustomLoadingCollectionsReportExecutor is shared with ckcoe (prod) and hfcoedemo, which do not set the new arg: they run exactly the previous SQL d) pom.xml: 3 new test classes in the CI include list" },
    { k: "row:bundle_reviewed", t: "Bundle code review required?: No no bundle PR" },
    { k: "row:ui_reviewed", t: "UI code review required / done?: Yes / NOT DONE kpi#246 has no formal approval" },
  ] },
  { id: "prodBranch", i: [
    { k: "row:cherry_pick", t: "Cherry-pick + re-test effort: channelkart: M. Against prod_blue_21_sep_2026_branch: PropertyDefinition.java and pom.xml changed on both (list edits, easy conflicts); 10 main files, no migration. The ckcoe prod branch is not confirmed (unknown, devops) kpi-dashboard: M, 22 files incl. tests. Against prod-17-july-blue the API listed no overlap (the compare shows the first 300 files only) slake-custom-reports: M. Loading Collections exists on prod_branch with different content; Day-wise and Customer Outstanding executors are not on prod_branch. slake-reporting-config: S. Re-test: M" },
    { k: "prod:(unknown repo)", t: "(unknown repo): prod_blue_21_sep_2026_branch" },
  ] },
  { id: "deploy", i: [
    { k: "row:services_deploy", t: "Services to deploy: Channel Kart · KPI Dashboard - UI · Slake Reporting (no bundle, no app)" },
    { k: "row:bundle_sdk", t: "Bundle SDK build required?: No" },
  ] },
  { id: "restart", i: [
    { k: "row:services_restart", t: "Services to restart: Channel Kart (code); properties need cache clear only. Slake Reporting: executor jar + config reload (how: unknown (devops)). KPI Dashboard UI: static deploy, users log in again" },
  ] },
  { id: "appRelease", i: [
    { k: "row:app_release", t: "App release required?: No no app PR. See rows 19 and 21 for the SFA app and the caller-scope switch" },
    { k: "row:old_app_version", t: "Old app version testing required?: Yes an old SFA build opening collections with the guard switch on; oldest supported build: unknown (mobile lead)" },
  ] },
  { id: "database", i: [
    { k: "row:previous_data", t: "Previous data fix required?: Yes reports: after deploy run each of the 3 reports once with full: true per tenant (ckcoedemo, ckcoeuat), so rows already synced get the Order Source column; row_hash is unchanged, so rows merge in place. APIs: no data fix (an invoice row without a source, loaded by ETL, takes ck_orders.source)" },
    { k: "row:db_queries", t: "DB change queries required?: No no DDL, migration or data script. The properties are set through the API (row 11)" },
    { k: "row:db_index", t: "DB index required?: No on prod and ckcoedemo: the PR's EXPLAIN on prod db_ckcoe_new (ck_sales about 5.2M rows, 16 Nov) shows invoice_number -> UK_tm80okqm5deqt4gap961b5nnc, and inv_ser_no + supplierid -> idx_sales_invser_supplier; ckcoedemo uses idx_sales_inv_ser_no_supplier. YES on any tenant that lacks it: CREATE INDEX on ck_sales (inv_ser_no, supplierid). Gate: SHOW INDEX FROM ck_sales WHERE Column_name IN ('inv_ser_no','supplierid') on ckcoeuat before the merge deploys there and on ckcoe before any port (not yet verified on ckcoeuat). Not verified: EXPLAIN of the ck_orders lookup (order_number IN) on prod, and of the ORDER BY id bill-number query" },
    { k: "row:ui_indexdb", t: "UI index db versions update required?: No no IndexedDB, Dexie, openDB, createIndex or objectStore in the diff; the key showCollectionOrderSource only joins the existing localStorage key list" },
  ] },
  { id: "configs", i: [
    { k: "row:configs_prod", t: "Configs to add or update: Yes four switches, all default off, per LOB: a) channelkart client property collections.invoice.order.source.enabled = true (PUT /v1/properties?name=...&value=true, then clear cache). On for ckcoeuat only b) channelkart client property invoice.collection.caller.scope.enabled = true (same call). On for ckcoeuat since 17 Nov. This is a security guard (COCA-1651 class); it stays open on every LOB where it is off c) kpi-dashboard clientconfig showCollectionOrderSource = true (also stored in localStorage); users log in again. With the UI on and the backend property off the column shows a dash d) slake-reporting-config: ckcoedemo configs set classExec arg order.source.enabled \"true\" and add the column; ckcoeuat SQL carries the logic. ckcoe, hfcoedemo and other tenants: unchanged Current values on each LOB: unknown (devops config compare)", c: ["collections.invoice.order.source.enabled", "invoice.collection.caller.scope.enabled", "order.source.enabled"] },
  ] },
  { id: "roles", i: [
    { k: "row:designations", t: "Different designations required?: Yes admin (not limited); distributor (own supplier 200, another supplier 403); supervisor above; salesman (own salesRep 200, another salesman 403); an outlet alone 403. Test by calling the API directly as well" },
  ] },
  { id: "compat", i: [
    { k: "row:new_app_old_data", t: "New code works with old data?: Yes no source anywhere = NA; unknown non-blank sources are shown as stored" },
    { k: "row:features_old_data", t: "Features work with old data: Yes see row 6" },
    { k: "row:beta_compat", t: "Beta app backward compatibility req.?: Yes with invoice.collection.caller.scope.enabled on, an old SFA or DMS build that calls these APIs with an outlet only (no supplier, salesRep or createdBy) gets 403. With the switch off nothing changes" },
  ] },
  { id: "order", i: [
    { k: "step:pr:slake-custom-reports#918", t: "slake-custom-reports#918 2 slake-reporting-config#1294 3 channelkart#1147 (+#1186) 4 kpi-dashboard#246 5 properties / clientconfig per LOB 6 full:true run per report 7 SHOW INDEX gate before step 2 on each tenant", q: 1 },
    { k: "rollback:CAV-7293:set the property or clientconfig to false and clear", t: "Rollback: set the property or clientconfig to false (and clear cache; users log in again); remove the executor arg; or revert the PRs", g: "CAV-7293" },
  ] },
  { id: "testing", i: [
    { k: "missed:all switches off", t: "Likely to be missed: All switches OFF (default) on every LOB: APIs, screens and reports exactly as before; the only change is D2 (null status gives 200, not 500)", l: "Note" },
    { k: "missed:invoice number found only by bill number", t: "Likely to be missed: Invoice number found only by bill number (inv_ser_no), the same bill number under two suppliers, case differences, ETL invoice rows with no source", l: "Note" },
    { k: "missed:guard on distributor for another supplier 403", t: "Likely to be missed: Guard on: distributor for another supplier 403; outlet alone 403; salesman for another salesman 403; admin unrestricted; DMS portal and SFA app still work", l: "Note" },
    { k: "missed:ui on backend property off", t: "Likely to be missed: UI on + backend property off: the column shows a dash, no error; the Order source filter All / SFA / DMS / eB2B / Others works in the browser", l: "Note" },
    { k: "missed:day wise loading collections", t: "Likely to be missed: Day-wise, Loading Collections and Customer Outstanding: same row count with the arg off and on; order_source never blank; ckcoe and hfcoedemo reports unchanged", l: "Note" },
    { k: "missed:three apis not guarded", t: "Likely to be missed: Three APIs not guarded and not changed: GET /v1/invoiceCollection, /findByInvoices, /outstanding-amount still have no caller check (follow-up, security owner)", l: "Note" },
    { k: "missed:collecting a payment", t: "Likely to be missed: Collecting a payment from the screens after the change (RecordPayment and CollectCashScreen were touched)", l: "Note" },
    { k: "row:performance", t: "Performance tests required?: Yes (1) the 3 invoice APIs at page size 5000 with the switch on: added lookups are batches of at most 1,000 numbers; UAT slowest call 1.43 s (PR text); target under 2 s on prod size (2) EXPLAIN + time of the ck_orders lookup and of the ORDER BY id query on prod (about 1 s) (3) the 3 reports on ckcoedemo and ckcoeuat at prod size, arg on vs off: duration and row count equal (4) the full: true run of row 5 (5) the guard: one hierarchy check per call, no visible slowdown" },
    { k: "row:automation_run", t: "Automation tests to run: Yes Collections screens (invoice-wise, outlet-wise, salesman-wise), the 3 invoice APIs, the 3 reports. What QA ran = unknown (QA). UAT by the author: blocked cases listed in the PRs (reports not deployed, no eB2B data)" },
    { k: "row:automation_updated", t: "Automation suite update required?: Yes add: orderSource on each API row; Order source filter on the 3 screens; 403 for another supplier and for an outlet alone" },
    { k: "row:scenarios", t: "Scenarios to be tested: see LIKELY TO BE MISSED below" },
  ] },
  { id: "risks", i: [
    { k: "open:the ckcoeuat index check", t: "Open: the ckcoeuat index check; EXPLAIN of ck_orders and ORDER BY id on prod; day-wise ckcoeuat query not run (DB policy); channelkart#1182 open;", l: "Note" },
    { k: "open:kpi#246 no formal approval", t: "Open: kpi#246 no formal approval; the three unguarded invoice APIs", l: "Note" },
    { k: "raw:label:not read test files", t: "Other: NOT READ: test files; the full ckcoeuat SQL of the three reports; the UI component bodies beyond the file list and PR text" },
  ] },
  { id: "verify", i: [
    { k: "verify:one invoice in each screen shows its source", t: "one invoice in each screen shows its source and matches ck_sales" },
    { k: "verify:a report run with full true has the same row count", t: "a report run with full: true has the same row count and order_source on every row" },
  ] },
];

const UNKNOWNS: Array<{ o: string; i: string[] }> = [
  { o: "devops", i: ["Services to restart Channel Kart (code); properties need cache clear only. Slake Reporting: executor jar + config reload (how: unknown (devops)). KPI Dashboard UI: static deploy, users log in again"] },
  { o: "devops config compare", i: ["Configs to add or update YES four switches, all default off, per LOB: a) channelkart client property collections.invoice.order.source.enabled = true (PUT /v1/properties?name=...&value=true, then cle"] },
  { o: "mobile lead", i: ["Old app version testing required? YES an old SFA build opening collections with the guard switch on; oldest supported build: unknown (mobile lead)"] },
  { o: "qa", i: ["Automation tests to run YES Collections screens (invoice-wise, outlet-wise, salesman-wise), the 3 invoice APIs, the 3 reports. What QA ran = unknown (QA). UAT by the author: blocked cases listed in t"] },
  { o: "release manager", i: ["Production meeting + everyone invited unknown (release manager)"] },
];

/** The checklist pieces the per-Jira view reads. */
export function cav7293(): Pick<Checklist, "sections" | "unknownsByOwner"> {
  return {
    sections: SECTIONS.map((s) => ({
      id: s.id,
      number: 0,
      title: s.id,
      items: s.i.map((r) => ({
        id: `${s.id}|${r.k}`,
        ih: "x",
        key: r.k,
        text: r.t,
        sources: [],
        ...(r.s ? { severity: r.s } : {}),
        ...(r.l ? { label: r.l } : {}),
        ...(r.n ? { needsAttention: true as const } : {}),
        ...(r.c ? { chips: r.c } : {}),
        ...(r.q ? { seq: r.q } : {}),
        ...(r.g ? { group: r.g } : {}),
      })),
    })) as unknown as Checklist["sections"],
    unknownsByOwner: UNKNOWNS.map((g) => ({ owner: g.o, items: g.i.map((t) => ({ text: t, sources: [] })) })) as unknown as Checklist["unknownsByOwner"],
  };
}
