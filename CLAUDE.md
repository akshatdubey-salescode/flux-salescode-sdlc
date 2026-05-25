@AGENTS.md

## Package Manager

Always use `pnpm` for installing packages. Never use `npm install`.

## Database Migrations

Never run `db:push`. Always use `db:generate` followed by `db:migrate` to create and apply migrations.

## Cache Invalidation

The codebase consistently calls `revalidateTag("tag", "max")`. The `"max"` is a Next.js 16 revalidation profile that uses stale-while-revalidate semantics: tagged data is marked stale and refreshed in the background on next visit, rather than being purged immediately. The single-argument form is deprecated. Always pass `"max"` as the second argument when calling `revalidateTag`.
