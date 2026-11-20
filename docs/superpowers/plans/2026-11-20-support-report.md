# Support Tickets & Daily Client Support Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Support tab per project for maintaining support tickets in Flux
(category, Salescode/Client ownership, response time, user counts, ETA). It
also builds a daily client report at 17:00 IST, which is sent only after an
approver clicks Approve.

**Architecture:**
- **Pure core in `src/lib/support/`:** time math, IST windows, aggregation and
  the email renderer. All of it is unit-tested.
- **Thin DB layer:** `store.ts` and `build.ts`.
- **Guarded send path:** `send.ts`, behind an env gate and an atomic status
  claim.
- **Routes:** Next 16 route handlers under `/api/projects/[id]/support/*`, plus
  a cron route.
- **UI:** shadcn components in `src/components/support/`, mounted as a new
  project tab behind a feature flag.

**Tech Stack:** Next.js 16.2 (app router), Drizzle ORM + Postgres, Resend,
`node:test` via `tsx`, shadcn/ui, date-fns.

**Spec:** `docs/superpowers/specs/2026-11-20-support-report-design.md`. Read it
in full before starting any task.

## Global Constraints

- **Next.js:** read `node_modules/next/dist/docs/` before writing route or page
  code. Route params are `Promise<{…}>` and must be awaited.
- **Packages:** `pnpm` only. `pnpm <script>` can fail on ignored builds, so call
  binaries directly: `./node_modules/.bin/tsx`, `./node_modules/.bin/tsc`,
  `./node_modules/.bin/drizzle-kit`.
- **Migrations:**
  - Use `drizzle-kit generate`. **Never `db:push`.**
  - Do **not** run `drizzle-kit migrate` from this plan. `.env.local` points at
    the shared prod/UAT database, so applying is the user's step at deploy.
- **Cache:** `revalidateTag(tag, "max")`. Always pass the second argument.
- **UI:** shadcn components from `src/components/ui/` only.
- **Timezone:** all dates are IST calendar days (`istToday()` in
  `src/lib/scheduled-processes/recurrence.ts`). Timestamps are stored as
  timestamptz.
- **Categories:** fixed set, in this order:
  - `bug`
  - `understanding`
  - `data_issue`
  - `data_upload`
  - `image_upload`
  - `others`
- **Category labels:** "Bug", "Understanding", "Data Issue", "Data Upload",
  "Image Upload", "Others".
- **Default SLA (minutes):** P1 10/240, P2 10/480, P3 30/1440, P4 30/2400
  (response/resolution).
- **Defaults:** `support_label` default `support` (matched case-insensitively);
  `shared_by` default `L2 Support`.
- **Office hours:** every SLA duration counts only Salescode-owned minutes
  inside office hours. Default **10:00–19:00 IST, Mon–Fri**
  (`workDays [1,2,3,4,5]`, Sunday-first). Configurable per project.
- **Cron:** `30 11 * * *` (11:30 UTC = 17:00 IST), bearer `CRON_SECRET`.
- **Env gate:** sends and cron builds require `SUPPORT_REPORTS_SEND_ENABLED === "true"`.
- **Sender:** `process.env.EMAIL_FROM ?? "Flux <noreply@example.com>"`, as in
  `send-progress-email.ts`.
- **Feature flag:** `enableSupportReports`, default `false`.
- **Display names:** taken from `session?.user?.name?.trim() || user.email`
  (there is no `users.name`).
- **Tests:** `./node_modules/.bin/tsx --test "src/lib/support/*.test.ts"`.
  **Typecheck:** `./node_modules/.bin/tsc --noEmit`. Worktrees need a symlinked
  `node_modules`.
- **Commits:** end every commit message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **IST day boundaries.** A ticket created at 2026-11-19T19:00Z is IST
   2026-11-20 00:30, so it counts as FTD for report date 2026-11-20, not
   the 19th. Task 3 (`istDateOf`) and Task 4 (FTD bucketing).
2. **Tickets that span nights and weekends.** A ticket raised Friday 18:30 IST
   and resolved Monday 10:30 IST counts 60 min (30 Fri + 30 Mon). A ticket
   raised and resolved entirely outside office hours counts 0. Task 2.
3. **Backdated or out-of-window ownership events:**
   - an event before `createdAt` clamps to the start
   - an event after `end` is ignored
   - events entered out of order are sorted
   - a client stretch that is still open at `end` stops counting at `end`

   Task 2.
4. **Two approvers, or a double click.** Exactly one send happens. The second
   gets 409. Task 7 (`claimForSending` is a single conditional UPDATE … RETURNING).
5. **Uncategorised and null-priority tickets:**
   - uncategorised tickets are listed in `uncategorised` and block approval
   - null priority buckets to P4, so P1+P2+P3+P4 == All in every column

   Task 4, Task 7.

---

## File Structure

```
src/lib/support/
  types.ts            constants, enums-as-unions, input & report-data types
  time.ts             salescodeMinutes, formatDuration, ageDays        (+ time.test.ts)
  windows.ts          istDateOf, reportWindow                          (+ windows.test.ts)
  aggregate.ts        buildReportData                                  (+ aggregate.test.ts)
  render-email.ts     renderSupportReportEmail, approverNoticeEmail    (+ render-email.test.ts)
  store.ts            all DB reads/writes for the feature
  build.ts            buildSupportReport (store → aggregate → store)
  send.ts             isSendEnabled, canApproveReports, approveAndSend, notifyApprovers (+ send.test.ts for pure parts)
src/lib/db/schema.ts  + 4 tables, 3 enums
drizzle/0096_*.sql    generated
src/lib/defaultFeatureFlags.json, src/lib/feature-flags.ts  + enableSupportReports
src/app/api/projects/[id]/support/
  tickets/route.ts                          GET
  tickets/[issueId]/route.ts                PATCH
  tickets/[issueId]/ownership/route.ts      GET, POST
  tickets/[issueId]/ownership/[eventId]/route.ts  DELETE
  settings/route.ts                         GET, PUT
  reports/route.ts                          GET (list), POST (build today now)
  reports/[reportId]/route.ts               GET (row + rendered html)
  reports/[reportId]/rebuild/route.ts       POST
  reports/[reportId]/approve/route.ts       POST (approve, or retry when failed)
  reports/[reportId]/delivery/route.ts      GET
src/app/api/cron/support-reports/route.ts   GET, POST
vercel.json                                  + cron entry
src/components/support/
  support-tab.tsx       sub-view switcher (Tickets / Reports / Settings)
  tickets-table.tsx
  ownership-dialog.tsx
  reports-view.tsx
  settings-form.tsx
src/components/project-tabs.tsx, src/app/(app)/projects/[id]/page.tsx  wire the tab
docs/support-reports.md
```

---

### Task 1: Schema, migration, feature flag, shared types

**Files:**
- Modify: `src/lib/db/schema.ts` (append after `scheduledProcessRuns`)
- Create: `drizzle/0096_<generated>.sql`, `drizzle/meta/*` (generated)
- Create: `src/lib/support/types.ts`
- Modify: `src/lib/defaultFeatureFlags.json`, `src/lib/feature-flags.ts`

**Interfaces:**
- Produces, from `schema.ts`:
  - **Enums:**
    - `supportCategoryEnum("support_category", SUPPORT_CATEGORIES)`
    - `supportOwnerSideEnum("support_owner_side", ["salescode","client"])`
    - `supportReportStatusEnum("support_report_status", ["awaiting_approval","sending","sent","failed","lapsed"])`
  - **`supportReportSettings`** (`support_report_settings`):
    - `projectId` uuid PK → `jiraProjects.id` cascade
    - `enabled` bool default false
    - `supportLabel` text default `'support'`
    - `periodMode` text default `'mtd'`
    - `periodStart` date null
    - `toEmails` and `ccEmails` text[] default `{}`
    - `approverUserIds` text[] default `{}`
    - `sharedBy` text default `'L2 Support'`
    - `sla` jsonb `$type<SlaTargets>()`, not null
    - `workStart` text default `'10:00'`, `workEnd` text default `'19:00'`
    - `workDays` integer[] default `{1,2,3,4,5}`
    - `updatedBy` → users.id, `updatedAt`
  - **`supportTickets`** (`support_tickets`):
    - `id` uuid PK
    - `issueId` uuid unique → `jiraIssues.id` cascade
    - `projectId` uuid → `jiraProjects.id` cascade
    - `category` supportCategoryEnum null
    - `ownerSide` default `'salescode'`
    - `firstRespondedAt` timestamptz null
    - `usersReported` and `usersImpacted` int null
    - `eta` date null
    - `updatedBy`, `updatedByName`, `updatedAt`
    - index on `projectId`
  - **`supportTicketOwnershipEvents`** (`support_ticket_ownership_events`):
    - `id` uuid PK
    - `issueId` → `jiraIssues.id` cascade
    - `side` supportOwnerSideEnum
    - `at` timestamptz not null
    - `createdAt` default now
    - `byUser`, `byName`
    - `deletedAt`, `deletedBy`, `deletedByName`
    - index on `(issueId, at)`
  - **`supportReports`** (`support_reports`):
    - `id` uuid PK
    - `projectId` → `jiraProjects.id` cascade
    - `reportDate` date
    - `status` supportReportStatusEnum default `'awaiting_approval'`
    - `data` jsonb `$type<SupportReportData>()` not null
    - `builtAt`, `builtBy` (text null), `builtByName`
    - `approvedBy`, `approvedByName`, `approvedAt`
    - `sentAt`, `recipientsTo` and `recipientsCc` (text[] null)
    - `providerMessageId`, `error`
    - **unique** `(projectId, reportDate)`
- Produces, from `types.ts`:
  - `SUPPORT_CATEGORIES`, `SupportCategory`, `CATEGORY_LABELS: Record<SupportCategory,string>`
  - `OwnerSide`, `Priority = "P1"|"P2"|"P3"|"P4"`, `PRIORITIES`
  - `PeriodMode = "mtd"|"ytd"|"custom"`
  - `SlaTargets = Record<Priority,{responseMin:number;resolutionMin:number}>`, `DEFAULT_SLA`
  - `OwnershipEvent = { side: OwnerSide; at: Date }`
  - `OfficeHours = { start: string; end: string; days: number[] }`, with
    `start`/`end` as `HH:MM` IST and `days` Sunday-first;
    `DEFAULT_OFFICE_HOURS = { start: "10:00", end: "19:00", days: [1,2,3,4,5] }`
  - `ReportTicketInput`:
    ```ts
    {
      issueId: string; jiraKey: string; summary: string; priority: Priority;
      category: SupportCategory | null; createdAt: Date; resolvedAt: Date | null; /* null = open */
      firstRespondedAt: Date | null; rcaGiven: boolean;
      usersReported: number | null; usersImpacted: number | null;
      eta: string | null; /* YYYY-MM-DD, Flux value or Jira due-date fallback */
      events: OwnershipEvent[]; /* live (non-deleted) only */
    }
    ```
  - `Cell = { ftd: number; period: number; open: number }`
  - `SummaryRowKey = "bugs"|"rca"|"understanding"|"data_issue"|"data_upload"|"image_upload"|"others"|"total"`
  - `SupportReportData`:
    ```ts
    {
      projectName: string; reportDate: string; periodLabel: string; sharedBy: string;
      summary: Record<SummaryRowKey, Record<"all" | Priority, Cell>>;
      sla: Record<Priority, { agreed: { responseMin: number; resolutionMin: number };
                              avgResponseMin: number | null; avgResolutionMin: number | null }>;
      impact: { jiraKey: string; summary: string; priority: "P1" | "P2";
                usersReported: number | null; usersImpacted: number | null }[];
      openBugs: { jiraKey: string; summary: string; createdOn: string; ageDays: number;
                  priority: Priority; eta: string | null }[];
      uncategorised: { issueId: string; jiraKey: string; summary: string }[];
    }
    ```
- Produces: `FEATURE_FLAGS.SUPPORT_REPORTS = "enableSupportReports"`.

- [ ] **Step 1:** Write `types.ts` with the exact unions and constants above.
  `schema.ts` imports `SupportReportData` and `SlaTargets` as types only, so
  there is no runtime cycle.
- [ ] **Step 2:** Add the enums and 4 tables to `schema.ts`. Follow the existing
  conventions: `timestamp(..., { withTimezone: true })`, and a
  `` sql`'{}'::text[]` `` default for arrays.
- [ ] **Step 3:** Add `"enableSupportReports": false` to
  `defaultFeatureFlags.json`, and `SUPPORT_REPORTS: "enableSupportReports"` to
  `FEATURE_FLAGS`.
- [ ] **Step 4:** Run `./node_modules/.bin/drizzle-kit generate`.
  Expected: a single new `drizzle/0096_*.sql` that only creates the 3 enums,
  the 4 tables, their indexes and FKs. Open it and confirm no unrelated
  ALTER/DROP statements.
- [ ] **Step 5:** Run `./node_modules/.bin/tsc --noEmit`. Expected: no new
  errors. Pre-existing `RouteContext` errors in worktrees are known.
- [ ] **Step 6:** Commit:
  `git add src/lib/db/schema.ts src/lib/support/types.ts drizzle src/lib/defaultFeatureFlags.json src/lib/feature-flags.ts && git commit -m "Support report: schema, types, feature flag"`

---

### Task 2: Salescode-time math within office hours

**Files:**
- Create: `src/lib/support/time.ts`, `src/lib/support/time.test.ts`

**Interfaces:**
- Consumes: `OwnershipEvent`, `OfficeHours`, `DEFAULT_OFFICE_HOURS` (Task 1).
- Produces:
  - `officeMinutesBetween(start: Date, end: Date, hours: OfficeHours): number`:
    minutes of `[start, end)` that fall on an IST working day between
    `hours.start` and `hours.end`
  - `salescodeMinutes(start: Date, end: Date, events: OwnershipEvent[], hours: OfficeHours): number`
    - the sum of `officeMinutesBetween` over the Salescode-owned segments
    - whole minutes, floored
    - returns 0 when `end <= start`
  - `formatDuration(min: number | null): string`
  - `ageDays(createdOnIst: string, reportDate: string): number`

- [ ] **Step 1: Write failing tests** in `time.test.ts`.
  - Setup:
    - helper `ist = (s) => new Date(s + "+05:30")`
    - `H = DEFAULT_OFFICE_HOURS`
    - 2026-11-02 is a Monday
    - for the 24/7 cases, use `ALL = { start: "00:00", end: "24:00", days: [0,1,2,3,4,5,6] }`
      so the ownership logic is tested in isolation, with start `ist("2026-11-02T00:00")`
  - **`officeMinutesBetween` cases:**
    - Mon 09:00→Mon 20:00 → `540`
    - Fri 18:30→Mon 10:30 (`2026-11-06T18:30`→`2026-11-09T10:30`) → `60`
    - Mon 20:00→Tue 09:00 → `0`
    - Sat 11:00→Sat 15:00 → `0`
    - Mon 10:00→Tue 19:00 → `1080`
  - **Ownership with `ALL`:**
    - `no events → whole span`: start→+10h = `600`
    - `client stretch excluded`: events `[client @+2h, salescode @+5h]`, end +10h → `420`
    - `out-of-order events are sorted`: same events reversed → `420`
    - `event before start clamps`: `[client @-1h]`, end +3h → `0`
    - `event after end ignored`: `[client @+12h]`, end +10h → `600`
    - `open client stretch stops at end`: `[client @+4h]`, end +10h → `240`
    - `same side twice is a no-op`: `[salescode @+1h, client @+2h, client @+3h]`, end +4h → `120`
    - `end <= start → 0`
  - **Combined, with `H`:** Mon 10:00 → Tue 19:00 with `[client @Mon 15:00, salescode @Tue 12:00]` → `300 + 420 = 720`.
  - `formatDuration`:
    - `null`→`"–"`
    - `0`→`"0 min"`
    - `5`→`"5 min"`
    - `60`→`"1 hr"`
    - `720`→`"12 hr"`
    - `818`→`"13 hr 38 min"`
  - `ageDays("2026-11-16","2026-11-20")` → `4`. Same day → `0`.
- [ ] **Step 2:** Run `./node_modules/.bin/tsx --test src/lib/support/time.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `time.ts`. Approach:
  1. Filter events to `at < end`.
  2. Sort by `at`.
  3. The side at `start` is the last event with `at <= start`, defaulting to `salescode`.
  4. Walk the boundaries and sum `officeMinutesBetween` for each salescode segment.

  For `officeMinutesBetween`, iterate IST calendar days from `start` to `end`.
  For each working day, intersect `[start, end)` with that day's
  `[hours.start, hours.end)` (IST = UTC+5:30). This is O(days) and fine for
  YTD.
- [ ] **Step 4:** Re-run. Expected: all PASS.
- [ ] **Step 5:** Commit `"Support report: Salescode-time math"`.

---

### Task 3: IST windows

**Files:**
- Create: `src/lib/support/windows.ts`, `src/lib/support/windows.test.ts`

**Interfaces:**
- Consumes: `PeriodMode`.
- Produces:
  - `istDateOf(d: Date): string`, returning `YYYY-MM-DD` in Asia/Kolkata.
  - `reportWindow(reportDate: string, mode: PeriodMode, customStart: string | null): { start: string; end: string; label: string }`
    - `end = reportDate`
    - **mtd:** start is the 1st of the month; label `"MTD"`
    - **ytd:** start is 1 Jan; label `"YTD"`
    - **custom:**
      - start = `customStart`
      - label `"d MMM – d MMM yyyy"`, e.g. `"1 Nov – 20 Nov 2026"`
      - when `customStart` is null, fall back to mtd
      - when `customStart > reportDate`, return start = customStart (the window
        is empty), not an error

- [ ] **Step 1: Failing tests:**
  - `istDateOf(new Date("2026-11-19T19:00:00Z"))` → `"2026-11-20"`.
  - `istDateOf(new Date("2026-11-19T18:29:00Z"))` → `"2026-11-19"`.
  - `reportWindow("2026-11-20","mtd",null)` → `{start:"2026-11-01",end:"2026-11-20",label:"MTD"}`.
  - `reportWindow("2026-11-01","mtd",null).start` → `"2026-11-01"`.
  - `reportWindow("2026-11-20","ytd",null)` → start `"2026-01-01"`, label `"YTD"`.
  - `reportWindow("2026-11-20","custom","2026-11-01").label` → `"1 Nov – 20 Nov 2026"`.
  - `reportWindow("2026-11-20","custom",null).label` → `"MTD"`.
- [ ] **Step 2:** Run the test. Expected: FAIL.
- [ ] **Step 3:** Implement. Use the same offset approach as `istToday`
  (+5:30). date-fns `format` is allowed for the label.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `"Support report: IST windows"`.

---

### Task 4: Aggregation into `SupportReportData`

**Files:**
- Create: `src/lib/support/aggregate.ts`, `src/lib/support/aggregate.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  ```ts
  buildReportData(args: {
    projectName: string; reportDate: string; sharedBy: string;
    window: { start: string; end: string; label: string };
    sla: SlaTargets; officeHours: OfficeHours; tickets: ReportTicketInput[]; now: Date;
  }): SupportReportData
  ```
  Every `salescodeMinutes` call passes `officeHours`.
  ```ts
  ```

**Rules (from the spec):**
- **FTD:** `istDateOf(createdAt) === reportDate`.
- **period:** the created IST date falls within `[window.start, window.end]`.
- **open:** `resolvedAt === null`, regardless of date.
- **Row mapping:**
  - each category maps to its row
  - `rca` = `bugs` ∧ `rcaGiven`
  - `total` = the sum of the six category rows (`rca` is excluded)
  - `all` = P1+P2+P3+P4
- **Uncategorised:** tickets with `category === null` are excluded from every
  count. They appear in `uncategorised` when they are FTD, in the period, or
  open.
- **SLA, per priority, over tickets in the period:**
  - `avgResponseMin`: mean of `salescodeMinutes(createdAt, firstRespondedAt, events)`
    over tickets that have `firstRespondedAt`
  - `avgResolutionMin`: mean of `salescodeMinutes(createdAt, resolvedAt, events)`
    over tickets with `resolvedAt`
  - both are `Math.round`-ed; `null` when no tickets qualify
- **impact:** P1/P2 tickets in the period, sorted P1 first, then by `createdAt`.
- **openBugs:**
  - contents: `category==="bug"` and open
  - `createdOn = istDateOf(createdAt)`
  - `ageDays(createdOn, reportDate)`
  - sorted by priority, then oldest first

- [ ] **Step 1: Failing tests** (fixture builder `mk(partial)` with defaults P4,
  category `bug`, created on `2026-11-20T05:00Z`, open):
  - `counts FTD, period and open per priority`. Use:
    - 1 P3 bug created today, open
    - 1 P3 bug created on 11-05, resolved
    - 1 P4 data_issue created on 10-20, open (outside MTD)

    Expect:
    - `bugs.P3` = `{ftd:1,period:2,open:1}`
    - `data_issue.P4` = `{ftd:0,period:0,open:1}`
    - `total.all` = `{ftd:1,period:2,open:2}`
  - `rca is a subset not added to total`: 2 bugs, one `rcaGiven`. Expect
    `rca.all.period===1` and `total.all.period===2`.
  - `uncategorised excluded and listed`: one `category:null` today → `total.all.ftd===0`, `uncategorised.length===1`.
  - `all equals sum of priorities` for every row and column, over a mixed fixture of 8 tickets.
  - `sla averages exclude client time` (pass the 24/7 `ALL` hours from Task 2):
    - P3 ticket created at `T`, resolved at `T+24h`, with
      `[client@T+2h, salescode@T+14h]` → `avgResolutionMin===720`
  - `sla averages respect office hours`: with `DEFAULT_OFFICE_HOURS`, a P4
    created Fri 18:30 IST and resolved Mon 10:30 IST → `avgResolutionMin===60`.
    - `firstRespondedAt=T+5min` → `avgResponseMin===5`
    - P1 has no tickets → both `null`
  - `impact lists P1/P2 in period only`.
  - `openBugs sorted by priority then age, with ageDays`.
  - `1st-of-month report: ftd equals period` with reportDate `2026-11-01`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement `buildReportData`.
- [ ] **Step 4:** Run all `src/lib/support/*.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `"Support report: aggregation"`.

---

### Task 5: Email renderer

**Files:**
- Create: `src/lib/support/render-email.ts`, `src/lib/support/render-email.test.ts`

**Interfaces:**
- Consumes: `SupportReportData`, `formatDuration`, `CATEGORY_LABELS`.
- Produces:
  - `renderSupportReportEmail(data: SupportReportData): { subject: string; html: string }`
  - `approverNoticeEmail(args: { projectName: string; reportDate: string; reviewUrl: string; uncategorisedCount: number }): { subject: string; html: string }`

**Requirements:**
- **Subject:** `Issue Report — Daily Update | {projectName} | {d MMM yyyy}`.
- **HTML:** table-based with inline styles only (mail clients). Match the
  mock's colours:
  - header gradient: teal `#1f4e5f` → `#3a9a9a`
  - section bars `#4aa6a6`
  - P1 `#e58a7d`, P2 `#e8bd7d`, P3 `#9b8cc4`, P4 `#7a9cc0`
- **Sections, numbered 1–4,** with copy exactly as the spec's "Report sections":
  - §1 groups rows under "ISSUES RECEIVED" (Understanding, Data Issue) and
    "REQUESTS RECEIVED" (Data Upload, Image Upload, Others)
  - §1 columns:
    - All / P1 / P2: FTD / {periodLabel} / Open
    - P3 / P4: FTD / {periodLabel}
  - zero cells render muted grey
  - §2 title is `SLA REPORT — {periodLabel}`. Agreed cell:
    `Response: {formatDuration(responseMin)}<br>Resolution: {formatDuration(resolutionMin)}`
  - §3 title is `P1 & P2 TICKET IMPACT REPORT — {periodLabel}`. Empty state:
    `No P1 / P2 tickets reported.`
  - §4 empty state: `No open bugs.` Age is shown as `{n} d`. ETA is shown as
    `d MMM yyyy` or `–`.
- **Footer:** `Issue Report — {sharedBy} · FTD = For The Day | {periodLabel}`
  on the left, `Confidential` on the right.
- **Escaping:** every Jira-sourced string is HTML-escaped.

- [ ] **Step 1: Failing tests:**
  - subject equals `"Issue Report — Daily Update | Acme | 20 Nov 2026"`
  - html contains `"SLA REPORT — MTD"`, `"Shared by: L2 Support"` and `"Confidential"`
  - html does not contain `"Internal Use Only"`
  - a summary `"<b>x</b>"` renders as `"&lt;b&gt;x&lt;/b&gt;"`
  - empty impact shows `"No P1 / P2 tickets reported."`
  - P3 has exactly 2 sub-headers: count the occurrences of the P3 header colspan
    marker `data-col="P3"`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep it a pure string builder. No React.
- [ ] **Step 4:** Run. Expected: PASS. Then write one HTML file to the
  scratchpad with a fixture and eyeball it against the mock (not committed).
- [ ] **Step 5:** Commit `"Support report: email renderer"`.

---

### Task 6: Store and report build

**Files:**
- Create: `src/lib/support/store.ts`, `src/lib/support/build.ts`

**Interfaces:**
- Consumes: Tasks 1–4; `extractRcaText` (`src/lib/jira/rca.ts`);
  `extractDueDate(cf, project.endDateFieldIds)` (`src/lib/jira/dates.ts`);
  `bugBoardPriorityBucket` and `isDoneOrCancelled` (`src/lib/bug-summary.ts`);
  `BUG_ISSUE_TYPES` (`src/lib/scorecard/config.ts`); `projectStatusMappings`
  joined like `bug-summary-query.ts`.
- Produces, in `store.ts`:
  - `type SettingsInput = { enabled: boolean; supportLabel: string; periodMode: PeriodMode; periodStart: string|null; toEmails: string[]; ccEmails: string[]; approverUserIds: string[]; sharedBy: string; sla: SlaTargets; officeHours: OfficeHours }`
    (`officeHours` maps to the `workStart`/`workEnd`/`workDays` columns)
  - `getSettings(projectId): Promise<SettingsInput>`. Returns defaults when there
    is no row.
  - `saveSettings(projectId, input: SettingsInput, userId): Promise<void>`. Upserts.
  - `type SupportTicketRow = ReportTicketInput & { status: string; issueType: string; ownerSide: OwnerSide; storedCategory: SupportCategory|null; fluxEta: string|null; jiraDueDate: string|null }`
  - `listSupportTickets(projectId): Promise<SupportTicketRow[]>`:
    - label match via `` exists (select 1 from unnest(labels) l where lower(l) = lower(${label})) ``
    - LEFT JOIN `support_tickets`
    - live events aggregated per issue
    - `category` = the stored value, else `"bug"` when `lower(trim(issueType))`
      is in `BUG_ISSUE_TYPES`, else null
    - `resolvedAt` = `completedAt ?? jiraUpdatedAt` when `isDoneOrCancelled`, else null
    - `eta` = `fluxEta ?? jiraDueDate`
  - `updateSupportTicket(projectId, issueId, patch: Partial<{category: SupportCategory|null; firstRespondedAt: Date|null; usersReported: number|null; usersImpacted: number|null; eta: string|null}>, by: {id: string; name: string}): Promise<void>`.
    Upserts the `support_tickets` row. Refuses (throws `NotFoundError`) an issue
    outside the project.
  - `listOwnershipEvents(issueId): Promise<Array<{id; side; at; createdAt; byName; deletedAt; deletedByName}>>`
  - `addOwnershipEvent(projectId, issueId, side, at: Date, by): Promise<void>`
    - throws `ValidationError` when `at` is before the issue's `jiraCreatedAt`
      or after now + 1 min
    - afterwards it recomputes `owner_side` from the latest live event
  - `deleteOwnershipEvent(projectId, issueId, eventId, by): Promise<void>`.
    Soft delete, then recompute `owner_side`.
  - Report rows:
    - `getReport(id)`
    - `listReports(projectId, limit=60)`
    - `upsertAwaitingReport(projectId, reportDate, data, builtBy|null): Promise<{ id: string; created: boolean } | { blocked: "already_final" }>`.
      ON CONFLICT updates only `WHERE status='awaiting_approval'`.
    - `lapseOlderAwaiting(projectId, reportDate): Promise<number>`
    - `claimForSending(id): Promise<boolean>`. One
      `UPDATE … SET status='sending' WHERE id=$1 AND status IN ('awaiting_approval','failed') RETURNING id`.
    - `markSent(id, {approvedBy, approvedByName, to, cc, messageId})`
    - `markFailed(id, {approvedBy, approvedByName, error})`
  - `listEnabledProjectIds(): Promise<string[]>`
  - Error classes `NotFoundError` and `ValidationError`, exported from `store.ts`.
- Produces, in `build.ts`:
  - `buildSupportReport(projectId: string, reportDate: string, by: {id: string; name: string} | null): Promise<{ id: string; created: boolean } | { blocked: "already_final" }>`
    - loads the settings, the project name and the tickets
    - calls `reportWindow` → `buildReportData` (`now = new Date()`)
    - calls `upsertAwaitingReport`

- [ ] **Step 1:** Implement `store.ts` with the signatures above.
- [ ] **Step 2:** Implement `build.ts`.
- [ ] **Step 3:** Run `./node_modules/.bin/tsc --noEmit`. Expected: clean.
- [ ] **Step 4:** Commit `"Support report: store and build"`.

(This layer is DB-bound and is verified end to end in Task 12. The logic that
can go wrong lives in Tasks 2–4.)

---

### Task 7: Send path, permissions, env gate

**Files:**
- Create: `src/lib/support/send.ts`, `src/lib/support/send.test.ts`

**Interfaces:**
- Consumes: store (Task 6), renderer (Task 5), `AuthUser` (`src/lib/auth/server.ts`), `hasMinRole`.
- Produces:
  - `isSendEnabled(env = process.env): boolean`, true iff
    `env.SUPPORT_REPORTS_SEND_ENABLED === "true"`.
  - `canApproveReports(user: Pick<AuthUser,"id"|"email"|"role">, settings: Pick<SettingsInput,"approverUserIds">): boolean`.
    True for ADMIN+, or when `user.id` or the lowercased email is in
    `approverUserIds`.
  - `approvalBlocker(report: { status: string; data: SupportReportData }, settings: SettingsInput, env?): string | null`.
    Returns the first blocker, in this order:
    1. `"Sending is disabled in this environment"`
    2. `"This report has lapsed"` when status is `lapsed`
    3. `"Already sent"` when status is `sent` or `sending`
    4. `"{n} ticket(s) are uncategorised — categorise them and rebuild"`
    5. `"No To recipients configured"`

    Otherwise null.
  - `approveAndSend(reportId: string, approver: {id: string; name: string}): Promise<{ status: "sent" } | { status: "failed"; error: string }>`
    - throws `ConflictError` when `claimForSending` returns false
    - renders from the stored `data`
    - sends one Resend call: `to: toEmails`, `cc: ccEmails`, `from` per Global
      Constraints
    - calls `markSent`/`markFailed`
    - never throws after the claim; failures are recorded instead
  - `notifyApprovers(projectId, reportDate, reportId, appUrl): Promise<void>`
    - resolves approver emails from `approverUserIds`; `users.id` is the email
    - review URL: `${appUrl}/projects/${projectId}?tab=support&view=reports`
    - errors are logged and swallowed
  - `ConflictError` class.

- [ ] **Step 1: Failing tests** for the pure functions:
  - `isSendEnabled({})===false`; `isSendEnabled({SUPPORT_REPORTS_SEND_ENABLED:"true"})===true`
  - `canApproveReports`:
    - ADMIN not in the list → true
    - USER in the list → true
    - USER with an uppercase email listed lowercase → true
    - USER not in the list → false
  - `approvalBlocker`:
    - env off → the env message, even when other blockers also apply
    - 2 uncategorised → `"2 ticket(s) are uncategorised — categorise them and rebuild"`
    - empty To → the recipients message
    - status `failed` with everything else fine → `null` (Retry)
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement `send.ts`.
- [ ] **Step 4:** Run all support tests. Expected: PASS.
- [ ] **Step 5:** Commit `"Support report: guarded send path"`.

---

### Task 8: Ticket API routes

**Files:**
- Create: `src/app/api/projects/[id]/support/tickets/route.ts`, `.../tickets/[issueId]/route.ts`, `.../tickets/[issueId]/ownership/route.ts`, `.../tickets/[issueId]/ownership/[eventId]/route.ts`

**Interfaces:**
- Consumes: store (Task 6), `requireAuth`, `isValidUuid`,
  `getServerSession(authOptions)` for the display name, `isEnabled(FEATURE_FLAGS.SUPPORT_REPORTS)`.
- Produces:
  - **`GET tickets`** → `{ tickets: SupportTicketRow[], settings: { supportLabel, enabled, officeHours } }`.
    Dates are ISO strings.
  - **`PATCH tickets/[issueId]`**:
    - body: any of `{category, firstRespondedAt, usersReported, usersImpacted, eta}`
    - validation:
      - `category` ∈ `SUPPORT_CATEGORIES` or null
      - counts are integers ≥ 0 or null
      - `firstRespondedAt` is ISO or null
      - `eta` is `YYYY-MM-DD` or null
    - errors: 400 on invalid input, 404 on `NotFoundError`
    - returns `{ ok: true }`
  - **`GET ownership`** → `{ events }`.
  - **`POST ownership`**: body `{ side, at? }`, where `at` defaults to now.
    400 on `ValidationError`.
  - **`DELETE ownership/[eventId]`** → `{ ok: true }`.
  - All routes: 404 when the flag is off; 400 on a bad uuid. Any signed-in user
    may write (spec: Permissions).

- [ ] **Step 1:** Read `node_modules/next/dist/docs/` for route handlers
  (params as a Promise).
- [ ] **Step 2:** Implement the 4 route files, following
  `src/app/api/sprints/[id]/schedules/route.ts` for structure.
- [ ] **Step 3:** Run `./node_modules/.bin/tsc --noEmit`. Expected: clean.
- [ ] **Step 4:** Commit `"Support report: ticket APIs"`.

---

### Task 9: Settings and report API routes

**Files:**
- Create: `src/app/api/projects/[id]/support/settings/route.ts`, `.../reports/route.ts`, `.../reports/[reportId]/route.ts`, `.../reports/[reportId]/rebuild/route.ts`, `.../reports/[reportId]/approve/route.ts`, `.../reports/[reportId]/delivery/route.ts`

**Interfaces:**
- Consumes: Tasks 6–7, `istToday`.
- Produces:
  - **`GET settings`** → `SettingsInput` (any signed-in user).
  - **`PUT settings`**:
    - permission: ADMIN+ (`requireRole("ADMIN")`)
    - validation:
      - each email matches `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
      - `enabled=true` requires ≥1 To
      - `periodMode=custom` requires `periodStart`
      - every SLA value is an integer > 0
      - `officeHours.start`/`end` match `^([01]\d|2[0-3]):[0-5]\d$` (or end
        `24:00`), with start < end
      - `days` is a non-empty, distinct subset of 0–6
    - errors return 400 with a message
  - **`GET reports`** → `{ reports: Array<row without data>, canApprove: boolean, sendEnabled: boolean }`.
  - **`POST reports`**: approver or ADMIN only. Calls
    `buildSupportReport(projectId, istToday(), by)` → `{ id }`, or 409 when
    `already_final`. This is "Build now", for the first day or a missed cron.
  - **`GET reports/[reportId]`** → `{ report, html, subject, blocker: string|null }`.
    The HTML comes from `renderSupportReportEmail(report.data)`; this is the
    preview.
  - **`POST rebuild`**:
    - permission: approver or ADMIN
    - only while `awaiting_approval`; otherwise 409
    - rebuilds for the report's own `reportDate`
  - **`POST approve`**:
    - permission: approver or ADMIN
    - when `approvalBlocker` returns a message → 409 `{error: blocker}`
    - otherwise `approveAndSend`, returning 200 `{status}`
    - `ConflictError` → 409 `"Already being sent"`
  - **`GET delivery`**:
    - `resend.emails.get(providerMessageId)` → `{ lastEvent }`
    - 404 when there is no message id
    - same pattern as `src/app/api/scheduled-processes/[id]/runs/[runId]/delivery/route.ts`
  - Every report route checks that `report.projectId === id` (404 otherwise)
    and that the flag is on.

- [ ] **Step 1:** Implement the routes.
- [ ] **Step 2:** Run `./node_modules/.bin/tsc --noEmit`. Expected: clean.
- [ ] **Step 3:** Commit `"Support report: settings and report APIs"`.

---

### Task 10: Daily cron

**Files:**
- Create: `src/app/api/cron/support-reports/route.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `listEnabledProjectIds`, `lapseOlderAwaiting`, `buildSupportReport`,
  `notifyApprovers`, `isSendEnabled`, `istToday`.
- Produces: `GET|POST /api/cron/support-reports` →
  `{ built, lapsed, skipped, failed, errors[] }`.
  - **Auth:** same bearer `CRON_SECRET` check as
    `api/cron/scheduled-processes/route.ts`; 401 otherwise.
  - **Env gate:** when `!isSendEnabled()` → 200
    `{ skipped: "disabled in this environment" }`.
  - **Per project** (try/catch each; one failure doesn't stop the others):
    1. Call `lapseOlderAwaiting(projectId, today)`.
    2. Call `buildSupportReport(projectId, today, null)`.
    3. Call `notifyApprovers` **only when the result has `created === true`**,
       so a second call doesn't re-notify.
  - **Status:** 500 when `failed > 0`, with the stats in the body.
  - **Time budget:** `maxDuration = 300`.
  - **`appUrl`:** taken from `NEXT_PUBLIC_APP_URL`, falling back to the request
    origin.
- `vercel.json` adds `{ "path": "/api/cron/support-reports", "schedule": "30 11 * * *" }`.

- [ ] **Step 1:** Implement the route and the `vercel.json` entry.
- [ ] **Step 2:** Run `./node_modules/.bin/tsc --noEmit`. Expected: clean.
- [ ] **Step 3:** Commit `"Support report: 17:00 IST cron"`.

---

### Task 11: Support tab, Tickets view

**Files:**
- Create: `src/components/support/support-tab.tsx`, `src/components/support/tickets-table.tsx`, `src/components/support/ownership-dialog.tsx`
- Modify: `src/components/project-tabs.tsx` (new prop `supportTab: boolean`; trigger `value="support"` labelled "Support", placed after "Bug Summary"), `src/app/(app)/projects/[id]/page.tsx` (`const supportTab = await isEnabled(FEATURE_FLAGS.SUPPORT_REPORTS)`, passed down)

**Interfaces:**
- Consumes: the Task 8 APIs.
- Produces:
  - `<SupportTab projectId isAdmin />`: shadcn `Tabs` for the sub-views, synced
    to the `view` query param (`tickets` | `reports` | `settings`). Settings is
    only shown when `isAdmin`.
  - `<TicketsTable projectId />` and `<OwnershipDialog projectId issueId open onOpenChange onChanged />`.

**Tickets table:**
- Columns, in spec order:
  - Key (links to Jira), Summary, Jira status, Priority badge, Created (IST)
  - Category `Select`, showing an "Uncategorised" placeholder in amber
  - On: a `Switch`, Salescode ↔ Client
  - First response: date and time input
  - Users reported / Users impacted: number `Input`s
  - ETA: `Calendar` in a `Popover`, showing the Jira due date in muted text
    when the Flux value is empty
  - Salescode time so far
- **Filters:**
  - Open / Closed / All
  - category, including Uncategorised
  - priority
  - search by key or summary
- **Empty state when the label matches nothing:** "No Jira tickets carry the
  `{label}` label yet."
- **Saving:** each edit PATCHes immediately (optimistic, rolled back on error)
  and shows a toast.
- **Ownership:**
  - flipping the switch opens `OwnershipDialog`, prefilled with the new side
    and `at` = now (editable, with a datetime input)
  - the dialog also lists the history: side, at, by, entered at; deleted
    events struck through, with a delete button on live ones

**"Salescode time so far":** computed client-side with `salescodeMinutes`
(import from `src/lib/support/time.ts`; it is pure). The window is created → now
for open tickets and created → resolved for resolved ones. It uses the
`officeHours` from the GET response and is formatted with `formatDuration`.
The column header says "Salescode time (office hrs)".

- [ ] **Step 1:** Implement the components using only `src/components/ui/*`.
  Check that directory for `Select`, `Switch`, `Dialog`, `Table`, `Popover`,
  `Calendar` and `Badge` before building anything custom.
- [ ] **Step 2:** Wire the tab in `project-tabs.tsx` and `page.tsx`.
- [ ] **Step 3:** Run `./node_modules/.bin/tsc --noEmit` and
  `./node_modules/.bin/eslint src/components/support`. Expected: clean.
- [ ] **Step 4:** Commit `"Support report: Support tab — tickets"`.

---

### Task 12: Reports and Settings views, docs, end-to-end check

**Files:**
- Create: `src/components/support/reports-view.tsx`, `src/components/support/settings-form.tsx`, `docs/support-reports.md`

**Interfaces:**
- Consumes: the Task 9 APIs; `usePersonSearch` (`src/hooks/use-person-search.ts`)
  for approvers.
- Produces:
  - **`<ReportsView projectId />`:**
    - Today's report: status `Badge`, the preview rendered in an `<iframe srcDoc>`,
      and buttons:
      - Rebuild (when awaiting and `canApprove`)
      - Approve & send, behind an `AlertDialog` confirm listing the To/CC
        recipients. Disabled with the `blocker` text as a tooltip when blocked.
      - Retry (when failed)
    - When no report exists today, approvers get "Build now".
    - Uncategorised tickets are listed inline with a category `Select` that
      PATCHes, then prompts Rebuild.
    - History table: date, status, approver, sent at, recipients count, and a
      "Check delivery" button.
  - **`<SettingsForm projectId />`:**
    - every `SettingsInput` field
    - period: a `RadioGroup` with MTD / YTD / Custom, plus a date
    - To and CC: chip inputs
    - approvers: a typeahead
    - SLA: a 4×2 grid in minutes, with an hours hint
    - office hours:
      - start and end time inputs (default 10:00 / 19:00)
      - a toggle group for working days (default Mon–Fri)
      - helper text: "SLA time only counts Salescode-owned minutes inside these
        hours (IST)"
    - Save → PUT, showing validation errors inline
- `docs/support-reports.md`: in the style of `docs/scheduled-processes.md`, cover:
  - the moving parts table
  - how a day runs (17:00 build → approve → send)
  - the env gate and why (prod and UAT share one DB)
  - the ownership/backdating rules and office-hours counting
  - how to apply the migration

- [ ] **Step 1:** Implement both views and the doc.
- [ ] **Step 2:** Run the full checks:
  - `./node_modules/.bin/tsx --test "src/lib/support/*.test.ts"` → all PASS
  - `./node_modules/.bin/tsc --noEmit` → clean
  - `./node_modules/.bin/eslint src/lib/support src/components/support src/app/api/projects/\[id\]/support src/app/api/cron/support-reports` → clean
- [ ] **Step 3:** End-to-end in the running app (the `run` skill). Use a local
  DB with the migration applied; **never** the shared DB.
  1. Enable the flag.
  2. Set the settings with To = your own address and `SUPPORT_REPORTS_SEND_ENABLED=true`.
  3. Label two Jira issues.
  4. Categorise one and leave the other uncategorised.
  5. Build now → Approve is blocked with the uncategorised message.
  6. Categorise the second → Rebuild → Approve.
  7. The mail arrives and matches the preview.
  8. A second Approve gives 409.
  9. Set the env flag off → Approve is disabled with the env message.
- [ ] **Step 4:** Commit `"Support report: reports and settings views, docs"`.
