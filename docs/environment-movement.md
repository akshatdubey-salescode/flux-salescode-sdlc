# Environment movement (Delivery tab)

A delivery can be moved to an environment (demo, uat or prod) with one **movement**: one checklist built from
the `DEPLOYMENT-RECORD` comments on the delivery's Jiras, four sign-offs (deployer, BA, lead, QA lead), and a hand-back
to the delivery page when done. Flux **only reads** Jira, GitHub and Confluence for this; it never writes to them.

## Using it

1. Open the delivery in the Delivery tab and pick an environment (Demo / UAT / Prod). A delivery manager
   (ADMIN or the delivery-manager flag) creates the movement and names the deployer, BA, lead and QA lead (four different people; all four must sign).
   A movement made before the QA lead existed keeps working without one; a delivery manager can add a QA lead
   with Change signers while it is still in draft or ready.
2. Tick the Jiras that move. A Jira with no `DEPLOYMENT-RECORD` comment is **blocked**; an ADMIN can override it with a
   reason. Jiras added to the delivery later show a "delivery changed" notice and come in on Refresh.
3. Search and save the branch per repo (searched live from GitHub), read the Summary and per-Jira cards (every
   section has a Copy button), and sign off. Any change to a record resets the sign-offs and mails the signers.
4. Mark done, then confirm the Jira statuses Flux proposes (delivered / not delivered). The page returns to the delivery.

What it reads: one **union** `DEPLOYMENT-RECORD v<n> | KEY | ...` comment per Jira (the 23-row release-page
template). The newest record wins; an edited comment is re-read by its `updated` time. Anything the parser cannot
structure is still shown as the original text.

## Deploying this feature

| Step | What |
|---|---|
| Database | Migration `0102_delivery_movements` (additive: 7 new `delivery_movement*` tables, no change to existing tables) and `0105_movement_qa_lead_slot` (adds the value `qa_lead` to the `movement_slot` enum). `scripts/build.sh` applies it on a **Vercel production** build; Preview builds do not migrate, so the movement pages fail on a Preview until the database has them. |
| Env vars (existing) | `DATABASE_URL`, `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_APP_URL`. Jira and GitHub access reuse the project's Jira connection and the active GitHub org tokens already stored in Flux. |
| Env vars (optional) | `MINIMAX_API_KEY` (+ `MINIMAX_MODEL`, `MINIMAX_BASE_URL`, `MINIMAX_EFFORT`) turns on the "AI summary" button. Without a key the button is off and the rule-based Summary still works. `MOVEMENT_EMAILS_LIVE=1` is only for a self-hosted production build (Vercel production mails real people by itself). |
| Scheduler | Vercel Cron calls `/api/cron/movements` every 30 minutes (`vercel.json`, needs the Vercel **Pro** plan; see `docs/scheduled-processes.md`, "Movement check"). Nothing to set up beyond `CRON_SECRET`. Without the cron the feature still works; changed records are then noticed only when someone opens the movement or presses Refresh. |
| Mail | Outside Vercel production, mail goes only to `+tctest@salescode.ai` / `+tctest2@salescode.ai` addresses. |

After the first deploy, open an existing movement once: the parser version changed, so its records are re-read
automatically (sign-offs on a movement that was already signed off would reset; none exist before the first release).

## Rolling back

Revert the PR. The tables are additive and unused by the rest of Flux, so they can stay in the database. Do not edit
`drizzle/meta` by hand; if another PR takes the same migration numbers, regenerate and keep every `when` in
`drizzle/meta/_journal.json` larger than any migration already applied to production (the migrator skips anything
older than the last applied one).

## Tests

`pnpm test` runs the unit suites (parser fixtures are sanitised copies of real comments). The database suites run only
with `MOVEMENT_DB_TESTS=1` against a dev database:

```
MOVEMENT_DB_TESTS=1 ./node_modules/.bin/tsx --env-file=.env.local --test \
  src/lib/movement/service/service.integration.test.ts \
  src/lib/movement/service/service.comments.integration.test.ts
```
