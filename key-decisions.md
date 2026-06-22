# Performance Review Engine — Key Decisions

Decisions taken while migrating the external "Rating Engine" logic (see
`public/dev pulse rating doc.pdf`) into this platform as a
**Performance Review** dashboard that suggests quarterly developer ratings from
synced Jira data. Viewing is open to all signed-in users; only recomputing is
superuser-gated (see Access control).

> Naming: we deliberately avoid the product name from the source doc. Use
> generic terms — "performance review", "scorecard", "rating" — everywhere in
> code, UI, and tables.

## Scope

- **Developers only.** Business analysts / testers (who don't get much Jira
  assigned) are explicitly out of scope for this iteration.
- **Five weighted metrics**, which together carry the full weight of 1.00:
  Bug Quality (0.30), Sprint Commitment (0.25), Complex Tasks (0.23),
  MTTR (0.15), AI Tasks (0.07).
- **Code Churn (0.00) and Effort (0.00) are NOT built.** They default to weight
  0 in the source rubric, and the data they need doesn't exist here (no GitHub
  PR/branch table; no per-dev "dev hours"). They render as "N/A — not tracked"
  and never affect `final_score`. The five built metrics summing to exactly 1.00
  is what makes the migrated score faithful without them.
- **Read-only suggestions.** No manager-override / approval workflow this round.

## Metric mapping & fallbacks

- **Complexity** is a dedicated Jira custom field on a **1–5 scale**, mapped
  directly to C1–C5 weights (1/3/5/7/10). The field ID is auto-discovered during
  sync by exact name match (`/^complexity$/i`). Missing complexity → 1 for
  weighting; raw value ≥ 3 marks a task "complex" for the AI-tasks metric.
- **Bug owner** (who a bug's quality penalty falls on): a custom **"Issue Owner"**
  user-picker field, **falling back to the assignee** when the field is absent.
  Auto-discovered by name (`/^issue\s*owner$/i`). Privacy-hidden emails are
  resolved via the same accountId→email map used for the assignee.
- **MTTR** duration = `completed_at − jira_created_at` (wall-clock "time to
  resolve"), since we don't track bug `actual_start/actual_end` dates. Only P1/P2
  bugs contribute samples; attributed to the **bug owner** (Issue Owner field,
  assignee fallback) — the *same* attribution as the weighted-bug penalty, so a
  bug is wholly its owner's for both metrics rather than split between owner and
  assignee.
- **Sprint Commitment** uses the **due date** (existing `extractDueDate`, native
  + discovered fields) and treats **`completed_at` as the actual-end date**. The
  source rule "all four dates required" is relaxed to "has a due date and is
  completed". On time = completion date ≤ due date (time-of-day ignored).
- **Original estimate** for AI Tasks: the standard Jira `timeoriginalestimate`
  (seconds) is now fetched; AI task = complex task with `0 < est/3600 < 5` hours.
  A missing estimate does not qualify.
- **Bugs vs tasks**: issue type (normalized) in {`bug`, `defect`, `sub-bug`} is a
  bug (feeds weighted-bugs + MTTR); everything else is a "task" (feeds Complex /
  AI / Sprint). Bugs with status `not a bug` / `couldn't reproduce` are excluded
  (matched apostrophe- and spacing-insensitively).

## Data capture

- Three Jira fields are newly captured: **complexity**, **issue owner**, and
  **`timeoriginalestimate`**. The first two are discovered per-project (stored on
  `jira_projects.complexity_field_ids` / `issue_owner_field_ids`) and all three
  land in `jira_issues.custom_fields` (JSONB) — no per-field columns.
- **A full Jira resync is required** for complexity / owner / estimate to be
  backfilled. Until then, Bug Quality, Sprint Commitment, and MTTR are accurate;
  Complex Tasks is muted (complexity defaults to 1) and AI Tasks reads 0.

## Scoring window & universe

- **Quarter-scoped** on the fiscal calendar (Apr–Mar). An issue belongs to a
  quarter when its `completed_at` falls in the quarter — i.e. work delivered that
  quarter. Selector offers the current quarter + previous three.
- **User universe** = emails seen as a task/bug **assignee** or **bug owner**
  in-quarter (normalized lower-case). Reporter-only emails are excluded to keep
  external client reporters out of the developer leaderboard.

## Storage & compute

- One row per `(user_email, quarter_key)` in **`performance_scorecards`**,
  including each sub-score's raw inputs, points, the `final_score`, and a
  `breakdown` JSONB powering the drill-down without recomputation.
- A quarter is recomputed via a **superuser server action** ("Recompute"),
  which replaces that quarter's rows atomically and invalidates the
  `performance-scorecards` cache tag with the `"max"` profile.
- **Recompute cadence is manual, on purpose.** Scores are a stored snapshot, not
  live: numbers only change after a Jira **resync** *and* a recompute. Recompute
  at review time, after a bulk complexity backfill, or after the identity-resolve
  script. **Realtime was explicitly rejected** — it's a full-quarter rebuild over
  non-realtime inputs, so per-edit recompute is all cost and no benefit. A
  **scheduled cron** (e.g. nightly for the current quarter, ideally chained after
  the Jira sync) is the recommended next step but is **not built** this round.
- **Config is centralized** (`src/lib/scorecard/config.ts`) as the source-doc
  defaults (weights, rubric thresholds, priority/complexity maps), structured so
  it can move to DB-backed config later without touching the formulas. The engine
  (`engine.ts`) is pure and verified against the source doc's worked example
  (`final_score ≈ 3.451`, see `scripts/verify-scorecard-engine.ts`).

## Access control

- **Viewing is open to all signed-in users.** The dashboard
  (`/performance-review`) is guarded only by `requireAuth()`, and its nav entry
  lives in the **Analytics** section (visible to everyone), not the superuser-only
  Admin section.
- **Recompute stays superuser-only.** It's a heavy full-quarter rebuild, so the
  button is hidden for non-superusers (a `canRecompute` prop) and the server
  action is guarded by `requireRole("SUPERUSER")` — defense in depth, so the gate
  holds even if the button is bypassed.

## Drill-down UX

- Each Jira key in the breakdown tables (weighted bugs, feature tasks, MTTR
  samples) **deep-links to the original Jira issue** (`{baseUrl}/browse/{KEY}`,
  opened in a new tab). The base URL is resolved from the issue key's
  project-key prefix against `jira_projects`, so no extra data is stored on the
  scorecard; keys for unknown projects render as plain text.
