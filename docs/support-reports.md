# Support reports (the 17:00 client report)

A daily client support report per project, built from Jira issues that carry the
project's support label, held for a person to review, and mailed to the client
only after an approver presses **Approve & send**. Nothing reaches a client
without that click: the scheduler builds and notifies, it never sends.

The whole feature is behind the `enableSupportReports` feature flag (default
off), which shows the project's **Support** tab: Tickets, Reports and (for
admins) Settings.

## The moving parts

| Piece | Where |
| --- | --- |
| Tables (settings, per-ticket fields, ownership log, reports) | `support_report_settings`, `support_tickets`, `support_ticket_ownership_events`, `support_reports` in `src/lib/db/schema.ts` |
| Migration | `drizzle/0098_eager_katie_power.sql` |
| Shared types, categories, defaults | `src/lib/support/types.ts` |
| Office-hours / Salescode-time math | `src/lib/support/time.ts` (+ `.test.ts`) |
| IST day windows (FTD, MTD / YTD / custom) | `src/lib/support/windows.ts` (+ `.test.ts`) |
| Tickets → report data (pure) | `src/lib/support/aggregate.ts` (+ `.test.ts`) |
| Report data → email HTML + subject | `src/lib/support/render-email.ts` (+ `.test.ts`) |
| Build / rebuild a day's report (lapses older ones first) | `src/lib/support/build.ts` |
| Whether the cron should claim the approver notice (pure) | `src/lib/support/notice.ts` (+ `.test.ts`) |
| Approval rules, env gate, approver check | `src/lib/support/approval.ts` (+ `.test.ts`) |
| Claim → send → mark sent/failed | `src/lib/support/send.ts` |
| Reads/writes and the race-safe claims | `src/lib/support/store.ts` |
| Ticket APIs (list, PATCH fields, ownership log) | `/api/projects/[id]/support/tickets/…` |
| Report APIs (list, build now, preview, rebuild, approve, delivery) | `/api/projects/[id]/support/reports/…` |
| Settings API (GET any user, PUT admin) | `/api/projects/[id]/support/settings` |
| The 17:00 run | `GET|POST /api/cron/support-reports`, registered in `vercel.json` |
| UI | `src/components/support/` (`tickets-table`, `reports-view`, `settings-form`) |

## How a day runs

1. **17:00 IST — build.** `vercel.json` registers the cron at `30 11 * * *`
   (11:30 UTC = 17:00 IST) with `Authorization: Bearer $CRON_SECRET`. For each
   project whose settings are **enabled** it:
   - builds today's report (`buildSupportReport`) — an upsert on
     `(project_id, report_date)` that only overwrites a row still
     `awaiting_approval`, so a sent, sending or failed report is left alone;
   - emails the approvers a "report ready for review" notice once per report.
     The cron first claims it with a conditional
     `UPDATE … SET approvers_notified_at = now() WHERE id = $1 AND
     approvers_notified_at IS NULL AND status = 'awaiting_approval'`
     (`markApproversNotified`) and sends only if it won the claim, so
     re-running the cron never re-notifies. The claim is taken only where
     sending is enabled, so UAT never uses up prod's notice. Because the
     notice is claimed before it is sent, a failed notice mail is logged and
     not retried.

   **Every build lapses older reports.** `buildSupportReport` — whether called
   by the cron, **Build now** or **Rebuild** — first marks every report of the
   project dated before the one being built that is still awaiting approval
   or failed as `lapsed`. A report not sent on its day is never sent later,
   and only one day's report is ever approvable. The cron's response reports
   the count as `lapsed`.
2. **Review.** An approver opens **Support → Reports**: the stored report is
   rendered exactly as the client will see it (a sandboxed iframe). Tickets
   still uncategorised are listed with a category picker; categorising them
   and pressing **Rebuild** recomputes the report from live ticket data.
   **Build now** covers the first day or a missed cron. Build now and Rebuild
   never notify approvers; a report built by hand before 17:00 still gets the
   cron's notice (it is rebuilt then, and its notice has not been claimed).
3. **Approve & send.** The confirm dialog lists To, CC and the subject. The
   request carries the `builtAt` of the preview on screen; the server claims
   the row with one conditional `UPDATE … WHERE status IN (awaiting, failed)
   AND built_at = $builtAt RETURNING data`. So:
   - what is sent is exactly what was previewed — a rebuild in between makes
     the claim miss and the approver gets a 409 and a reloaded preview;
   - two approvers (or a double click) produce one send; the other gets 409.
4. **Sent / failed.** The row records who approved, when, the recipients and
   Resend's message id. A failure before Resend accepts the mail marks it
   `failed` with the error; **Retry send** goes through the same guarded claim.
   **Check delivery** asks Resend for the message's `last_event`
   (`delivered`, `bounced`, …) on demand.

Approval is **blocked** (button disabled, reason in a tooltip, and refused by
the server) while sending is disabled in the environment, the report has
lapsed or was already sent, any ticket is uncategorised, or no To recipient is
configured. Approvers are the users listed in Settings (stored as lowercase
emails, which are user ids); admins can always approve.

## The env gate, and why

Sends **and** cron builds happen only where
`SUPPORT_REPORTS_SEND_ENABLED=true`. Anywhere else the cron returns
`{ skipped: "disabled in this environment" }`, approval is blocked with
"Sending is disabled in this environment", and the Reports view says
"Sending is disabled in this environment — preview only". Build now, Rebuild
and the preview still work, so the report can be checked anywhere.

The reason is that **prod and UAT share one database**. Both deployments see
the same settings and the same reports, and both run the same cron; if both
could build and send, a client would get mail from UAT, or twice.
The feature flag can't separate them either — it lives in that same database.
So the switch has to be per deployment: set the variable to `true` on prod
only, and leave it unset on UAT, previews and local machines (for a local
end-to-end test, set it on your machine against a local database).

## Ownership, backdating and office hours

Every SLA number counts **Salescode-owned minutes inside office hours**, not
wall-clock time.

- **Ownership.** A ticket starts owned by Salescode at its Jira creation time.
  The Tickets view records changes (Salescode ↔ Client) in
  `support_ticket_ownership_events`, optionally **backdated**: a change can be
  entered after the fact with the time it really happened, but not before the
  ticket was created or in the future. Events are never removed — a delete is
  a soft delete that keeps who deleted it, and the history dialog shows both.
- **Counting rules** (`salescodeMinutes` in `time.ts`):
  - events are sorted by time, so entry order doesn't matter;
  - an event at or before the start sets the starting side;
  - events after the end (resolution, first response, or "now") are ignored;
  - a stretch still open at the end stops counting at the end.
- **Office hours** are per project (Settings): start / end in IST (default
  10:00–19:00) and working days (default Mon–Fri). Only the overlap of
  Salescode stretches with those hours counts. A ticket raised Friday 18:30 and
  resolved Monday 10:30 counts 60 minutes; one raised and resolved entirely
  outside office hours counts 0.
- **Response** is measured to the first-response time entered on the ticket;
  **resolution** to the Jira resolution (Done/Cancelled). Both are averaged
  per priority and shown against the agreed SLA from Settings. Tickets without
  a priority count as P4, so the P1–P4 columns always add up to All.
- **Days are IST calendar days.** "FTD" is the report date in IST, and the
  period column is MTD, YTD, or from a custom start date — all ending on the
  report date.

## Applying the migration

The tables come from `drizzle/0098_eager_katie_power.sql`, generated with
`drizzle-kit generate`. **Never `db:push`.** Applying it is a deploy step for
whoever deploys, against the target database:

```bash
./node_modules/.bin/drizzle-kit migrate
```

Because prod and UAT share one database, it is applied once, for both. Before
running it, check the migration journal against what is already applied:
drizzle only runs a journal entry whose `when` is greater than the newest
`created_at` in `drizzle.__drizzle_migrations`. If `main` and `main-uat` have
diverged and either has applied newer migrations, reconcile the journal `when`
values with the live database (read-only probe of `__drizzle_migrations`
first), as the team does for any migration merge.

After it is applied: turn on `enableSupportReports`, set
`SUPPORT_REPORTS_SEND_ENABLED=true` on prod only, and fill in each project's
Settings (label, To/CC, approvers, SLA, office hours) before enabling its
report.
