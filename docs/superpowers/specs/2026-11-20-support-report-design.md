# Support tickets & the daily client support report — design

**Date:** 2026-11-20
**Status:** approved 2026-11-20

## Intent

Today L2 Support hand-builds a daily "Issue Report — Daily Update" mail for
every client: ticket counts by category and priority, SLA performance, P1/P2
impact, and open bugs. Flux already holds the Jira data. This feature moves
the report into Flux, per project:

- Support people see and maintain the project's support tickets in one place.
- Flux prepares the report every day at 17:00 IST.
- A human approves it, and only then is it mailed to the client.

The report must be **trustworthy enough to send to a client**. Two things
make that possible: support decides what counts (by marking and categorising
tickets), and the SLA clock only runs while a ticket is with Salescode.

## Goals

- A **Support** tab on each project that lists every Jira ticket marked as a
  support ticket. Support people can set, per ticket and in Flux only:
  - the category (Understanding, Data Issue, etc.)
  - an ownership toggle: **Salescode ↔ Client**
  - the first-response time
  - Users Reported and Users Impacted
  - the ETA
- **Per-project report settings:**
  - on/off
  - reporting period (MTD / YTD / custom start date)
  - the Jira marker label
  - To and CC recipients
  - approvers
  - the "Shared by" name
  - agreed SLA per priority
- A daily report, frozen as a snapshot at 17:00 IST. An approver previews it,
  can rebuild it, and approves it. Approval sends it.
- History: every daily report with its status (awaiting approval / sent /
  failed / lapsed), who approved it, and a delivery check.

## Non-goals

- Writing anything back to Jira. Category, ownership, response time, user
  counts and ETA live only in Flux.
- Freshdesk. The existing Client Issue Tracker tab is untouched and is a
  separate feature.
- One report spanning several projects. It is strictly one report per Flux
  project.
- Public-holiday calendars. Office hours are a weekly pattern only.
- Auto-sending. Nothing goes to a client without an explicit approval click.

## Anti-goals (this would be a failure even if it "works")

- A client receives a mail nobody approved, or receives the same report twice.
- What is sent differs from what the approver previewed.
- Time a ticket spent waiting on the client is counted against Salescode.
- Numbers that don't reconcile with each other, with no obvious reason why.

## Approaches considered

| | Approach | Trade-off | Verdict |
|---|---|---|---|
| A | Add a `support_report` process to the existing `scheduled_processes` framework | Reuses the cron, run log and delivery check. But that framework is midnight-only, stores intent and rebuilds at send time, and sends unattended. An approval gate and a frozen snapshot fight all three. | Rejected |
| **B** | **Dedicated support module**: own tables, own 17:00 IST cron, snapshot rows with an approval state; reuses the Resend transport and delivery-check pattern | More new code, but the approval lifecycle is first-class and can't disturb sprint/workstream mails | **Chosen** (builder's call, the user handed over the how) |
| C | No cron; build the report when someone opens it | Simplest, but the user asked for it to be prepared at 5 pm | Rejected |

## What the user decided

1. **Support tickets are visible in a Support section per project.** On the
   marked tickets, support people assign the category in Flux.
2. **Users Reported / Users Impacted** are entered in Flux, not Jira.
3. **Response time is entered manually in Flux.**
4. **Average time works on an ownership toggle.** Each ticket is either
   *on Salescode* or *on Client*. Support flips it to Client while waiting for
   client input. Only time on Salescode counts. The averages are taken across
   tickets.
5. **The report is per project.**
6. **Approval:**
   - named approvers are set in project settings
   - an unapproved report lapses when the next day's report is built
   - the report is prepared at 17:00 IST
   - it is sent only after approval
   - recipients are set in project settings
7. **The report layout follows the user's mock** (the second screenshot):
   - **Header:** "Issue Report — Daily Update", Date, "Shared by: …"
   - **§1 Support Ticket Summary:** see "Report sections" below for the exact
     rows and columns
   - **§2 SLA Report:** Agreed SLA, Avg Response Time and Avg Resolution Time,
     for P1–P4
   - **§3 P1 & P2 Ticket Impact:** Issue ID / Heading, Severity,
     Users Reported, Users Impacted, RCA Shared (added 2026-11-20)
   - **§4 Open Bug Detail:** Reported On, Bug ID / Description, Age, Priority,
     ETA
   - **Footer:** "FTD = For The Day | MTD = Month To Date"
8. **Year-to-date Excel attachment (2026-11-20):** "Attach all the
   year-to-present support tickets in the mail as an Excel report, based on
   raised date only, with year-month segregation as sheets." See
   "Year-to-date Excel attachment" below.
9. **Per-project timezone (2026-11-21):** "Different clients would have
   different time zones." Each project has an IANA timezone (default
   Asia/Kolkata). Decisions: office hours are read in the client's timezone;
   times are entered and shown in the project's timezone everywhere (pickers,
   Tickets, Reports, email, Excel), labelled with the zone; the report is
   built at 17:00 in the project's timezone for the client's calendar day (cron
   every 30 minutes, building each project in its 17:00–17:29 local window).
   This supersedes "IST" wherever it appears below.
10. **Closed-time override (2026-11-25):** the closing time stays the Jira
   one (latest move into Done/Cancelled) by default, with a Flux field to
   override it; when set, every calculation uses it and the ticket counts as
   closed at that time even if Jira still has it open.

## Design

### What makes a ticket a support ticket

- A per-project setting `support_label`, shown in the UI as **External label**
  (default `external`). Any synced `jira_issues` row in that project whose
  `labels` contains it (case-insensitive) is a support ticket. *User decision
  (2026-11-20):* the default changed from `support` to `external` and the UI
  copy from "Support label" to "External label"; the column/field name
  `support_label` / `supportLabel` is unchanged. Migration 0099 changes only the
  column default, so existing settings rows keep whatever label they saved.
- Labels already sync via the poller and the Jira webhook. No Jira field
  discovery is needed.
- If the label is removed in Jira, the ticket drops out of the Support tab and
  the report. Its Flux data is kept, so re-adding the label restores it.

### Which tickets count (one shared filter)

Every section applies the same filter before aggregating, so the numbers
reconcile.

**User's decision:** every ticket marked as support counts, whatever its Jira
status. The category support assigns decides which row it lands in. A "not a
bug" ticket, for example, is categorised Understanding rather than dropped. No
`BUG_INVALID_STATUSES` exclusion applies anywhere in this feature.

- Done and Cancelled tickets count in FTD, Period and §3. They were received.
- **Every ticket must be counted, so Approve & send is blocked while any
  support ticket in the report's windows is uncategorised.** The approval
  screen lists those tickets with an inline category picker. After fixing
  them, Rebuild re-enables Approve. *Builder's call*, chosen so that "all
  counted" can't silently fail.
- **Avg Resolution Time** counts tickets whose canonical status is DONE or
  CANCELLED, measured to `completedAt`. Where `completedAt` is null for a
  cancelled ticket, it falls back to `jiraUpdatedAt`. *Builder's call.*

### Flux-side ticket data

New table `support_tickets`, one row per Jira issue. The row is created lazily
the first time anyone edits the ticket, or when the report builder first sees it.

| Field | Notes |
|---|---|
| `issue_id` | FK `jira_issues.id`, unique, cascade delete |
| `project_id` | denormalised for querying |
| `category` | enum, see below. Null = uncategorised. |
| `owner_side` | `salescode` / `client`, current value, default `salescode` |
| `raised_at` | nullable timestamptz. When the client actually raised the ticket; may be earlier than the Jira creation time, never in the future, never after `first_responded_at`. Null = use the Jira creation time. *User decision, 2026-11-20.* |
| `rca_shared` | bool, default false. Toggled in Flux; the only source of "RCA Shared". *User decision, 2026-11-20.* |
| `first_responded_at` | timestamptz, manually entered; must not be before the effective raised time |
| `users_reported`, `users_impacted` | nullable ints |
| `eta` | nullable date. When empty, the report falls back to the Jira end/due date (`endDateFieldIds`), then "—". |
| `updated_by`, `updated_at` | |

**Categories.** The set is fixed in code and matches the report rows:

- `bug`
- `understanding`
- `data_issue`
- `data_upload`
- `image_upload`
- `others`

**Default category.** When a ticket has none set, it defaults to `bug` if its
Jira issue type is bug-family (`BUG_ISSUE_TYPES`). Otherwise it is
*uncategorised*. Uncategorised tickets are flagged in the Support tab and on
the approval screen ("3 tickets uncategorised — not counted"), and are left out
of the report.

**Effective raised time** (*user decision, 2026-11-20*) = `raised_at ?? jira_created_at`.
It replaces the Jira creation time everywhere this feature used it: FTD /
period / open bucketing, the SLA response and resolution start, §3 ordering,
§4 Reported On and Age, the Tickets view's Salescode time, and the lower bound
for the first response and for ownership events. It is fed in once, as
`ReportTicketInput.createdAt`, by the row mapper (`ticket-row.ts`), so the
aggregation itself is unchanged. Clearing `raised_at` falls back to the Jira
creation time; that is refused if it would put the first response before the
ticket was raised. The Tickets view shows a **Raised (IST)** column next to
"Created (IST)"; when no raised time is set it shows the Jira creation time
muted, like the ETA cell's Jira due date.

**RCA shared** (*user decision, 2026-11-20*): a per-ticket Flux toggle
(`rca_shared`, **RCA shared** switch next to Category in the Tickets view). The
Jira RCA field is no longer read by this feature.

**Ownership log.** New table `support_ticket_ownership_events`:

- columns: `issue_id`, `side` (`salescode` / `client`), `at`, `by_user`,
  `by_name`
- each toggle appends a row and updates `owner_side`
- a ticket with no events was on Salescode the whole time

**Corrections** (builder's call, the user approved without objecting):

- **Backdating:** a toggle defaults to "now", but its `at` can be set to any
  moment between the ticket's effective raised time and now.
- **Removing a wrong flip:** an event can be soft-deleted, which sets
  `deleted_at`, `deleted_by` and `deleted_by_name`. Deleted events are ignored
  by the time math and still shown, struck through, in the history.
- **Recording:** `created_at` records when the event was entered, separately
  from `at`.
- **Sorting:** the time math sorts live events by `at`, so out-of-order entry is
  fine.
- **Same side twice:** consecutive events on the same side are harmless no-ops.
- **`owner_side`** is always re-derived from the latest live event.

### Time math (pure, unit-tested module)

`salescodeMinutes(createdAt, endAt, events, officeHours)` works like this:

- It walks the intervals from `createdAt` to `endAt`.
- The starting side is Salescode.
- Each event switches the side at its `at`.
- It sums the minutes spent on Salescode **that fall inside office hours**.
- Events outside the window are clamped to it.

**Office hours (user's decision):**

- Time is counted only within office hours, IST.
- Default: **10:00–19:00**.
- The hours are configurable per project in settings.
- Working days are also a per-project setting, default **Mon–Fri**. *Builder's
  call:* the user didn't specify days.
- A ticket raised at 21:00 starts counting at 10:00 the next working day.
- This applies to response time, resolution time, and the "Salescode time so
  far" shown in the Tickets view.

The two report figures:

The clock starts at the **effective raised time** (`raisedAt` below =
`raised_at ?? jira_created_at`, user decision 2026-11-20), and the IST day
windows bucket tickets by it too.

- **Response time** = `salescodeMinutes(raisedAt, first_responded_at)`.
  Only tickets with `first_responded_at` set are counted.
- **Resolution time** = `salescodeMinutes(raisedAt, completedAt)`. Only
  tickets that are done count, using `completedAt` (the most recent transition
  into Done) and the open/closed rule `isDoneOrCancelled`. See "Which tickets
  count" for cancelled tickets.
- **Averages** are taken per priority across the tickets in the reporting
  period.
- **Display:**
  - under 60 min → "N min"
  - otherwise → "H hr M min", dropping the "M min" part when it is zero
  - no data → "–"

### Reporting windows (all IST)

- **Report date D** = the IST date the report was built.
- **FTD:** created on D. Built at 17:00, so it covers 00:00–17:00 plus anything
  synced by the time of a manual rebuild.
- **Period column** (labelled MTD / YTD / the custom range):
  - **MTD:** created from the 1st of D's month to D
  - **YTD:** created from 1 Jan of D's year to D
  - **Custom:** created from the configured start date to D
- **Open:** tickets created in the period window that are still not
  done/cancelled. *User decision (2026-11-20), replacing the original
  "regardless of creation date" rule:* an MTD report's Open column is this
  month's open tickets only. The same window applies to §4 Open Bug Detail
  and to the uncategorised check that blocks approval. Consequence: an old
  ticket still open on the 1st of the month no longer appears in an MTD
  report.
- **§2 SLA and §3 Impact** use the period window. Their section titles show the
  period label ("SLA REPORT — MTD").

### Report sections

**§1 Support Ticket Summary — the rows:**

- Total Bugs (category `bug`)
- RCA Shared: bugs whose Flux **RCA shared** toggle is on (`rca_shared`; *user
  decision, 2026-11-20* — the Jira RCA field is no longer read). This is a
  subset of Total Bugs and is **not** added into Total.
- Understanding, Data Issue (no group header: *user decision, 2026-11-20*
  removed the "ISSUES RECEIVED" header row)
- REQUESTS RECEIVED: Data Upload, Image Upload, Others
- Total = Bugs + Understanding + Data Issue + Data Upload + Image Upload + Others

**§1 — the columns:**

- All, P1 and P2 each get FTD / Period / Open.
- P3 and P4 get FTD / Period only, as in the mock.
- Note: because P3/P4 have no Open column, All → Open will exceed
  P1 Open + P2 Open. This is intentional, per the mock.
- Priority comes from Jira via `bugBoardPriorityBucket` (P1–P4; anything
  unmatched → P4).

**§2 SLA Report:**

- Agreed SLA comes from project settings, e.g. "Response: 10 min /
  Resolution: 4 hrs".
- Avg Response Time and Avg Resolution Time come from the time math above.
- It covers every category.

**§3 P1 & P2 Ticket Impact:**

- Contents: P1/P2 eligible tickets created in the period, whether open or closed.
- Columns: `KEY · summary`, the severity pill, `users_reported` and
  `users_impacted`, with "–" when a value is empty, then **RCA Shared**
  ("Yes" / "No" from the toggle; *user decision, 2026-11-20*). Reports stored
  before the toggle existed have no value and show "–".
- Empty state: "No P1 / P2 tickets reported."

**§4 Open Bug Detail:**

- Contents: open tickets with category `bug` created in the period window.
- Columns:
  - Reported On (effective raised date, IST)
  - `KEY · summary`
  - Age (whole calendar days since the effective raised date, e.g. "4 d")
  - priority pill
  - ETA
- Sort: priority, then oldest first.
- Empty state: "No open bugs."

**Header and footer:**

- Header: "Issue Report — Daily Update", "Date: 20 Nov 2026",
  "Shared by: {settings.shared_by, default 'L2 Support'}".
- Footer: "Issue Report — {shared_by} · FTD = For The Day | {Period label}".
- *Builder's call:* the mock's "Confidential — Internal Use Only" is changed to
  "Confidential", because the mail goes to the client.

### All-tickets Excel attachment (user decision, 2026-11-20; scope widened the same day from year-to-date to project start)

- **Scope:** every support ticket (label-matched, as the Tickets view lists
  them) whose *effective raised time* falls on an IST date up to the report
  date, inclusive, with no lower bound (from the start of the project). Open and closed, every category,
  uncategorised included. Independent of the project's period setting.
- **Snapshot:** each build/rebuild stores the rows on the report as
  `data.ytdTickets` (`YtdTicketRow[]`, `src/lib/support/ytd.ts`). The
  workbook is generated at send time only from the claimed row's stored
  snapshot, so the attachment sent is the one that could be reviewed. A
  report stored before this change has no `ytdTickets` and is sent without an
  attachment; an empty snapshot still attaches a workbook with one
  "No tickets" sheet (header only). Generation runs before Resend accepts the
  mail, so a failure marks the report `failed` — never a partial send.
- **Sheets:** one per IST year-month of the raised time that has tickets,
  chronological, named like "Jan 2026"; empty months are skipped. Rows are
  oldest raised first.
- **Columns** (Jira Key dropped 2026-11-23, Jira Status 2026-11-20): Summary | Category | Priority |
  Open/Closed | Raised (IST) | First Response (IST) | Response Time (office hrs) |
  Resolved (IST) | Resolution Time (office hrs) | Currently With | RCA Shared |
  Users Reported | Users Impacted | ETA. Times are IST ("20 Nov 2026, 15:22");
  durations are Salescode office-hour time (client-owned stretches excluded),
  "–" when not yet responded/resolved; ETA is Flux's, else Jira's due date.
  The header row is bold, filled, frozen and filtered.
- **File name:** `Support tickets - {project} - {d MMM yyyy}.xlsx`, with
  `\ / : * ? " < > |` replaced by "-".
- **Review:** `GET /api/projects/[id]/support/reports/[reportId]/attachment`
  (any signed-in user, like the preview) downloads the same workbook; 404 for
  reports built before attachments existed. The Reports view shows
  **Download Excel** and "Attached to the email: N tickets raised from project start to …",
  and the Approve dialog names the attachment.

### Settings

New table `support_report_settings`, one row per project:

| Field | Notes |
|---|---|
| `enabled` | bool, default false |
| `support_label` | text, default `external` (was `support`; user decision, 2026-11-20). UI: "External label". |
| `period_mode` | `mtd` / `ytd` / `custom` |
| `period_start` | date, custom only |
| `to_emails`, `cc_emails` | text[]. Can't enable with an empty To. |
| `approver_user_ids` | text[] of `users.id` |
| `shared_by` | text, default "L2 Support" |
| `sla` | jsonb `{P1:{responseMin,resolutionMin},…}`, defaults P1 10/240, P2 10/480, P3 30/1440, P4 30/2400 |
| `work_start`, `work_end` | text `HH:MM` IST, default `10:00` / `19:00`; start < end |
| `work_days` | int[] 0–6 Sunday-first, default `{1,2,3,4,5}`, non-empty |
| `updated_by`, `updated_at` | |

### Daily report lifecycle

New table `support_reports`:

- columns:
  - `id`, `project_id`, `report_date` (date)
  - `status`: `awaiting_approval` / `sending` / `sent` / `failed` / `lapsed`
  - `data` (jsonb, the computed report model)
  - `built_at`, `built_by` (null = cron)
  - `approved_by`, `approved_by_name`, `approved_at`
  - `sent_at`, `recipients_to`, `recipients_cc` (snapshotted at send)
  - `provider_message_id`, `error`
- unique `(project_id, report_date)`

**Lifecycle:**

1. **Build.** Cron `POST|GET /api/cron/support-reports`, bearer `CRON_SECRET`,
   registered in `vercel.json` at `30 11 * * *` (11:30 UTC = 17:00 IST). For
   each enabled project:
   - Mark any earlier `awaiting_approval` report as `lapsed`.
   - Upsert today's row with fresh `data`. A second cron call is a no-op if
     today's row exists and isn't `awaiting_approval`. If it is still awaiting
     approval, the data is rebuilt, which is harmless.
   - Mail the approvers an internal "Support report ready for approval" notice
     linking to the Support tab.
2. **Preview.** The Support tab's *Reports* view renders the HTML from `data`
   with the same renderer the mail uses, so the preview is exactly what will be
   sent.
3. **Rebuild.** An approver can hit *Rebuild*, for example after fixing a
   category or entering user counts. It recomputes `data` for the same report
   date. Only allowed while `awaiting_approval`.
4. **Approve & send.** Only approvers or ADMINs can do this.
   - A conditional update `awaiting_approval → sending` guards against a
     double click or two approvers at once. Only one wins.
   - The mail is rendered from the stored `data` and sent via Resend to To/CC.
   - The result is stored as `sent` (with the message id) or `failed`.
   - *Retry* on `failed` re-attempts with the same guard.
5. **Lapse.** Lapsed reports can't be sent.
6. **Delivery check.** Same pattern as scheduled processes: on demand,
   `resend.emails.get(id)`.

### Which deployment may build and send

Prod and UAT share one database, so an approval clicked on UAT would mail real
clients.

- Both the cron build and the Approve & send / Retry routes check an env flag,
  `SUPPORT_REPORTS_SEND_ENABLED=true`. Set it on production only.
- Without the flag:
  - the cron returns `{skipped: "disabled in this environment"}`
  - the Approve button is disabled and explains why
  - preview and rebuild still work

*Builder's call.*

### Who can see it

Sign-in is restricted to `@salescode.ai` (`ALLOWED_EMAIL_DOMAIN`), so every
user is internal. No client-facing permission model is needed.

### UI (shadcn components only)

New project tab **Support**, visible to everyone, with three sub-views:

**Tickets.** A table of support tickets:

- columns: Key, Summary, Jira status, Priority, Created (Jira), **Raised**
  (IST datetime picker; Jira creation time muted when unset), **Category**
  (select), **RCA shared** (switch), **On** (Salescode/Client toggle), **First response** (datetime picker),
  **Users reported / impacted** (number inputs), **ETA** (date), and a computed
  "Salescode time so far"
- filters: open/closed, category (including "Uncategorised"), priority
- clicking the ownership cell shows the toggle history

**Reports.**

- Today's report: status badge, rendered preview, Rebuild, and Approve & send
  (for approvers).
- Below that, history: date, status, approver, sent time, recipients, and the
  delivery check.

**Settings** (ADMIN). Every field above. Approvers are picked with the existing
org-person typeahead (`usePersonSearch`).

Gate the tab behind a new feature flag `enableSupportReports` (default off)
following `FEATURE_FLAGS`.

**Permissions:**

- Edit ticket fields: any signed-in user. Changes are attributed, and the
  ownership log is the audit trail.
- Edit settings: ADMIN+.
- Rebuild / approve / retry: listed approvers or ADMIN+.

## Constraints

- Next.js 16 in this repo differs from older versions. Read
  `node_modules/next/dist/docs/` before writing route/page code.
- `pnpm`. Migrations via `db:generate` + `db:migrate`, never `db:push`.
  Prod and UAT share one DB.
- `revalidateTag(tag, "max")` when invalidating.
- IST helpers already exist (`istToday` in `scheduled-processes/recurrence`).
- Resend is the transport (`RESEND_API_KEY`, and the existing from-address
  convention in `send-progress-email.ts`).
- Tests: `tsx --test "src/**/*.test.ts"`. Pure modules (time math, windowing,
  aggregation) must be unit-tested.

## Left to the builder

- File and module layout; the API route shapes.
- Email HTML: table-based and inline-styled for mail clients, matching the
  mock's colours and section numbering.
- Whether report `data` stores per-ticket rows or only aggregates. It must be
  enough to re-render the identical mail.
- The table component and pagination for the Tickets view.
- Email subject. Suggested: `Issue Report — Daily Update | {Project} | {DD Mon YYYY}`.

## Builder's calls (for the user to check)

- The Jira label marks eligibility; the label name is configurable per project
  (default `support`).
- Bug-type Jira issues default to category Bug. Other types start
  uncategorised, and approval is blocked until they are categorised.
- The ownership toggle can be backdated and wrong flips removed, with an audit
  trail.
- Resolution time includes cancelled tickets.
- Only the production deployment (`SUPPORT_REPORTS_SEND_ENABLED`) builds and
  sends.
- Office hours default to Mon–Fri, 10:00–19:00 IST. The days are configurable
  per project.
- Response time is also measured only on Salescode time.
- ~~Open = all open eligible tickets regardless of period.~~ Replaced by the user on 2026-11-20: Open = open tickets created in the period.
- P3/P4 have no Open column, per the mock.
- The footer says "Confidential", not "Internal Use Only".
- ETA falls back to the Jira end/due date.
- Approvers get an internal "ready for approval" mail at 17:00.
- The report is built every day, including weekends.
