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
- Business-hours SLA math. The clock runs 24/7.
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
     Users Reported, Users Impacted
   - **§4 Open Bug Detail:** Reported On, Bug ID / Description, Age, Priority,
     ETA
   - **Footer:** "FTD = For The Day | MTD = Month To Date"

## Design

### What makes a ticket a support ticket

- A per-project setting `support_label` (default `support`). Any synced
  `jira_issues` row in that project whose `labels` contains it (case-insensitive)
  is a support ticket.
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
| `first_responded_at` | timestamptz, manually entered |
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

**Ownership log.** New table `support_ticket_ownership_events`:

- columns: `issue_id`, `side` (`salescode` / `client`), `at`, `by_user`,
  `by_name`
- each toggle appends a row and updates `owner_side`
- a ticket with no events was on Salescode the whole time

**Corrections** (builder's call, the user approved without objecting):

- **Backdating:** a toggle defaults to "now", but its `at` can be set to any
  moment between the ticket's creation and now.
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

`salescodeMinutes(createdAt, endAt, events)` works like this:

- It walks the intervals from `createdAt` to `endAt`.
- The starting side is Salescode.
- Each event switches the side at its `at`.
- It sums the minutes spent on Salescode.
- Events outside the window are clamped to it.

The two report figures:

- **Response time** = `salescodeMinutes(jiraCreatedAt, first_responded_at)`.
  Only tickets with `first_responded_at` set are counted.
- **Resolution time** = `salescodeMinutes(jiraCreatedAt, completedAt)`. Only
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
- **Open:** every eligible ticket not done/cancelled, **regardless of creation
  date**. An old open P1 must not vanish on the 1st of the month.
- **§2 SLA and §3 Impact** use the period window. Their section titles show the
  period label ("SLA REPORT — MTD").

### Report sections

**§1 Support Ticket Summary — the rows:**

- Total Bugs (category `bug`)
- RCA Shared: bugs whose Jira RCA field (`rcaFieldIds`) is non-empty. This is a
  subset of Total Bugs and is **not** added into Total.
- ISSUES RECEIVED: Understanding, Data Issue
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
  `users_impacted`, with "–" when a value is empty.
- Empty state: "No P1 / P2 tickets reported."

**§4 Open Bug Detail:**

- Contents: open tickets with category `bug`.
- Columns:
  - Reported On (created date)
  - `KEY · summary`
  - Age (whole calendar days since creation, e.g. "4 d")
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

### Settings

New table `support_report_settings`, one row per project:

| Field | Notes |
|---|---|
| `enabled` | bool, default false |
| `support_label` | text, default `support` |
| `period_mode` | `mtd` / `ytd` / `custom` |
| `period_start` | date, custom only |
| `to_emails`, `cc_emails` | text[]. Can't enable with an empty To. |
| `approver_user_ids` | text[] of `users.id` |
| `shared_by` | text, default "L2 Support" |
| `sla` | jsonb `{P1:{responseMin,resolutionMin},…}`, defaults P1 10/240, P2 10/480, P3 30/1440, P4 30/2400 |
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

- columns: Key, Summary, Jira status, Priority, Created, **Category** (select),
  **On** (Salescode/Client toggle), **First response** (datetime picker),
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
- Response time is also measured only on Salescode time.
- Open = all open eligible tickets regardless of period.
- P3/P4 have no Open column, per the mock.
- The footer says "Confidential", not "Internal Use Only".
- ETA falls back to the Jira end/due date.
- Approvers get an internal "ready for approval" mail at 17:00.
- The report is built every day, including weekends.
