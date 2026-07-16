#!/bin/bash
# Vercel build entrypoint. Applies any pending Drizzle migrations before
# building — but only on a real Production build (VERCEL_ENV is set by
# Vercel to "production" | "preview" | "development"; it's unset for local
# `pnpm build`). This keeps Preview deployments (opened for every PR) from
# migrating the production database ahead of that PR actually merging, while
# still guaranteeing prod schema is up to date before prod code goes live.
#
# `drizzle-kit migrate` is idempotent — already-applied migrations are
# skipped — so re-running it on every production deploy is safe even when a
# deploy has no new migrations.
set -e

if [ "$VERCEL_ENV" = "production" ]; then
  echo "==> Production build: applying pending database migrations"
  pnpm db:migrate
fi

next build
