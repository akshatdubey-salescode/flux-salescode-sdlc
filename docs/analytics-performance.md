# Analytics endpoint performance — measured findings

Endpoints: `GET /api/analytics/overview`, `GET /api/analytics/workload/boards`.

Everything below was measured against the real `flux` database (55,189 issues,
154 MB table, `custom_fields` 35 MB total / 664 bytes avg) and against
production with a real session. Dates used: fiscal quarter 2026-07-01 →
2026-09-30, prior quarter start 2026-04-01.

## Where the time actually goes

Server-side query time is *not* the problem. `EXPLAIN (ANALYZE)` on the three
queries behind `/api/analytics/overview`:

| query | what it does | server time |
| ----- | ------------ | ----------- |
| A | issue rows for KPIs + project health | **302 ms** |
| B | weekly created vs completed flow | 60 ms |
| C | p50 cycle time by issue type | 32 ms |

~400 ms of database work, against an endpoint that measured ~2–3 s per call.

The gap is **result volume**. Query A returns **35,832 rows carrying 29 MB of
`custom_fields` jsonb**, and `workload/boards` returns **25,617 rows / 27 MB**,
in both cases to read two planned dates per row via `extractStartDate` /
`extractDueDate`. That payload has to cross the wire and be parsed into JS
objects on every cache miss.

## Fixed (commit `cb13d3e`)

Both of these were cache-layer bugs, and together they are the reason every
single request paid that ~2 s.

1. **`"use cache"` is in-memory only.** Per the Next 16 docs, entries are not
   shared between serverless instances and are typically destroyed after
   serving a request. Three calls with identical arguments returned MISS / MISS
   / MISS at 2.6 s / 1.9 s / 2.0 s; `/api/analytics/availability` behaved the
   same, so it was systemic. Both fetchers now use `"use cache: remote"`.

2. **The cache key changed every minute.** `now` was passed into the cached
   fetcher at minute precision — 60 distinct keys an hour — so even a working
   remote cache would have missed. `bucketNowForCache` floors it to 15 minutes.

With those in place, a repeat request should serve from cache and the 29 MB
never moves. **Confirm after deploying**: a second identical call must return
`X-Cache: HIT`. If it still says MISS, the remote cache handler is not wired up
and nothing else here matters.

## Tried and rejected: narrowing `custom_fields` in SQL

The obvious next step is to stop selecting the whole jsonb and project it down
to just the keys the extractors read. It works and it is exactly
result-preserving — I verified across all 35,835 rows that every candidate key
reads identically from the narrowed object, so zero dashboard numbers change —
and it cuts the payload from 29 MB to 1,989 kB (**6.8%** of the original).

**But it is not worth shipping**, because touching the jsonb per row costs more
than the transfer it saves:

| variant | server time | end-to-end from a laptop (incl. transfer) |
| ------- | ----------- | ----------------------------------------- |
| original (whole jsonb) | 302 ms | 7372 ms |
| narrowed | 2128 ms | 2205 ms |

Two different narrowing implementations (`jsonb_object_agg` over `unnest`, and
a fixed `jsonb_build_object` plus a small `unnest` for the discovered keys) both
landed at ~2.1 s server-side, so the cost is per-row jsonb access, not the
aggregation strategy.

The 7.4 s figure is from a laptop. Vercel runs this in `bom1`, the same region
as the database, so its transfer cost is much lower — the endpoint measured
~2 s, implying ~1.7 s of transfer. Substituting the narrowed variant gives
~2.1 s of server time plus ~0.1 s of transfer: **neutral at best, likely
worse.** Reverted rather than shipped.

## The real structural fix (not done)

Ship fewer rows instead of smaller rows. Of the 35,837 rows query A returns:

| slice | rows | how it is used |
| ----- | ---- | -------------- |
| done | 18,852 | only *counted* — completed this/prior quarter, on-time rate |
| open, no due date in quarter | 15,945 | mostly discarded; a subset feeds `unplanned` as a count |
| **open, due inside the quarter** | **1,040** | the only rows that drive totalActive / overdue / atRisk / topProjects |

So ~1,040 rows and a handful of scalars are genuinely needed. Two options:

1. **Push the counting into SQL.** The done slice becomes `COUNT(*)` /
   `COUNT(*) FILTER (...)`, and only the ~1,040 open in-quarter rows come back.
   ~34× fewer rows and no jsonb over the wire. The catch: the quarter filter
   needs the planned due date in SQL, which means reimplementing
   `extractStartDate` / `extractDueDate` — including their precedence order and
   the ISO validation in `toIsoDate` — as SQL. Postgres will *error* on
   `'2026-02-30'::date` where JS `new Date()` yields Invalid Date, so a naive
   translation can throw or silently disagree. Needs careful equivalence tests
   against the JS helpers before trusting it.

2. **Materialise the two dates as real columns** (`planned_start_date`,
   `planned_due_date`), populated by the existing sync using the *same* JS
   extractors, and indexed. This removes the jsonb work and the correctness risk
   in one move: extraction logic stays in one place, and the analytics queries
   become plain indexed date-range filters. Costs a migration plus a backfill.

Option 2 is the better end state.

## Indexes — mostly not the answer

An earlier draft of this file oversold indexes. Measured:

- `workload/boards` filters `lower(ji.assignee_email) IN (...)`, which cannot use
  `jira_issues_assignee_email_idx` (indexed on the bare column) and does a
  `Seq Scan` over 55,194 rows. Real, but the whole scan is **81 ms** — a minor
  win, not the bottleneck. An expression index on `lower(assignee_email)` is
  still cheap and correct if you want it:
  ```sql
  CREATE INDEX CONCURRENTLY IF NOT EXISTS jira_issues_assignee_email_lower_idx
    ON jira_issues (lower(assignee_email));
  ```
- Query B seq-scans `jira_issues` for the `jira_created_at` range (40 ms of its
  60 ms). An index on `jira_created_at` would trim a few tens of ms:
  ```sql
  CREATE INDEX CONCURRENTLY IF NOT EXISTS jira_issues_jira_created_at_idx
    ON jira_issues (jira_created_at);
  ```
- The partial "open issues" index suggested earlier is **withdrawn**. Query A is
  already driven by a bitmap scan off `project_status_mappings`
  (`jira_issues_project_jira_id_idx` + `jira_issues_status_idx`), not a seq
  scan, so the planner would not use it.

If you add either index, use `CONCURRENTLY` and run it by hand — `CREATE INDEX
CONCURRENTLY` cannot run inside a transaction, and `scripts/build.sh` runs
`db:migrate` on production deploys, where a blocking index build would stall
the Jira webhooks mid-build. Check afterwards that they are actually used:

```sql
SELECT relname, indexrelname, idx_scan
FROM pg_stat_user_indexes
WHERE relname = 'jira_issues'
ORDER BY idx_scan DESC;
```

An index sitting at `idx_scan = 0` is pure write overhead — drop it.

## Incidental observation

Query A's plan shows a `Memoize` node with `Hits: 0  Misses: 903
Evictions: 462`, i.e. the planner's memoisation is pure overhead here — it
never once got a hit and evicted half its entries. It follows from the nested
loop driving 903 status mappings into `jira_issues`. Restructuring query A per
the section above makes it moot; not worth chasing on its own.
