# Scheduled processes (the midnight run)

One table of standing instructions, one nightly job that runs whatever is due.
Sprint progress emails are the first — and so far only — process; the shape is
deliberately generic so a bug digest or a delivery reminder is a handler in
code rather than a new scheduler.

## The moving parts

| Piece | Where |
| --- | --- |
| The table (what to run, when it's next due) | `scheduled_processes` in `src/lib/db/schema.ts` |
| The attempt log (did it go out?) | `scheduled_process_runs` |
| Run history + delivery check | `GET /api/scheduled-processes/[id]/runs`, `…/runs/[runId]/delivery` |
| Cadence math | `src/lib/scheduled-processes/recurrence.ts` (+ `.test.ts`) |
| Reads/writes and the invariants | `src/lib/scheduled-processes/store.ts` |
| Process → handler map | `src/lib/scheduled-processes/registry.ts` |
| The nightly loop | `src/lib/scheduled-processes/dispatch.ts` |
| The endpoint | `POST|GET /api/cron/scheduled-processes` |
| Compose + manage (per sprint) | the email dialog's **Repeat** tab |
| Manage everything | `/superuser/scheduled-emails` |

## How a night runs

1. `next_run_on <= today` (IST) and not paused / stopped / deleted → due.
2. For each due row, a run row is **inserted before any work happens**. A
   partial unique index on `(schedule_id, run_on) WHERE trigger = 'cron'` means
   a second trigger conflicts and skips instead of mailing twice.
3. The handler runs, rebuilding the email and the Excel report from live data —
   a schedule stores intent (who, what note, how often), never a snapshot.
4. The run row records sent / failed / skipped, and the schedule advances to its
   next occurrence.

`next_run_on` advances **even after a failure**. Leaving the row due would wedge
it: that day's run row already exists, so the claim in step 2 would conflict
every night from then on. A progress report is worth more fresh tomorrow than
retried from yesterday, and "Send now" is the retry button.

## Timing

Midnight means **IST midnight** — the zone the sprint dates, the risk columns
and the emails themselves are already judged in (`istNowStr` in
`src/lib/sprints/risk.ts`). There is no per-schedule time of day: every send
goes at midnight, which is the whole reason the table needs only a date column.

`vercel.json` registers the endpoint at `30 18 * * *` — 18:30 UTC, i.e. 00:00
IST. Vercel Cron issues a `GET` with `Authorization: Bearer $CRON_SECRET`
injected from the env var, which is why the route answers `GET` as well as
`POST`. Unlike the other five crons (whose schedules are registered outside this
repo — see the comment in `api/cron/loc-sync`), this one is in-repo on purpose:
the cadence is then reviewable in the same PR as the code it runs.

**Calling it more than once a night is safe and sometimes useful.** The claim in
step 2 makes duplicates no-ops, so a second call is also how you finish a night
whose first call hit its time budget — check `remaining` in the response body.
To hand the job to an external scheduler instead, point it at the same path with
the same bearer token and drop the `vercel.json` entry.

## "Did it actually send?" — two different questions

**Did Flux send it?** Our own log. Every attempt writes a row to
`scheduled_process_runs` with `sent` / `failed` / `skipped`, the recipient
count, the failure message and how long it took. The schedule list shows the
last attempt inline; **History** on any row shows every attempt.

**Did it actually arrive?** Only the provider knows. A run marked `sent` means
Resend *accepted* the mail — a bounce, a rejection or a spam complaint all
happen after that hand-off and would otherwise be invisible. So every send
records Resend's message ids on the run (`provider_message_ids`), and
**Check delivery** on a sent run asks Resend what became of each one
(`resend.emails.get` → `last_event`: `delivered`, `bounced`, `complained`,
`queued`, `failed`…), showing it per recipient.

That check is on demand, not on every list load: it costs one provider call per
message, and the answer only matters when someone is asking. Runs sent before
this existed have no ids and say so rather than showing a blank.

Push-based delivery updates (Resend webhooks into a stored event log) would let
the list show bounces without anyone clicking. Worth it only if bounces become
common enough that nobody wants to go looking — the pull covers the question
itself.

## Editing a running schedule

- **Recipients** — click the recipient count on any schedule. Add by name from
  the org directory (the same typeahead the compose dialog uses, shared via
  `usePersonSearch`) or paste any address. Saved through a recipients-only
  action (`PATCH { action: "setRecipients" }`) so it can't disturb the cadence
  or the next run date; it applies from the next send.
- **Cadence, subject, message** — a full `PATCH` re-validates everything and
  re-bases `next_run_on` when the cadence actually changed.

## Sprint progress emails

- Same builders and same transport as the manual send: both go through
  `src/lib/sprints/send-progress-email.ts`, so a scheduled update can't drift
  from what the dialog's Preview tab showed.
- The sender's name is denormalized onto the schedule at creation
  (`created_by_name`) because midnight has no session to read a name from.
- **Send once, then stop:** when the sprint is closed (or its end date has
  passed), the next run sends one wrap-up — with a line saying so — and the
  schedule retires with `stop_reason = 'target_closed'`. A deleted sprint stops
  with `target_deleted` and mails nothing.

## Adding a process

1. Write a handler: `(row, ctx) => Promise<ProcessOutcome>`. Return `sent`, or
   `skipped` with a detail; throw to record a failure. Set `stop` when the target
   can never produce another useful run.
2. Add its name to `SCHEDULED_PROCESS_VALUES` (+ a label) in
   `src/lib/scheduled-processes/types.ts` and to `PROCESS_HANDLERS` in
   `registry.ts`.
3. Give it a create route (copy `api/sprints/[id]/schedules`) — the shared
   `parseScheduleBody` already enforces the recipient/subject/cadence rules.

No migration, and nothing about the nightly run changes.
