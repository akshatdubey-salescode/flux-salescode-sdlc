@AGENTS.md

## Package Manager

Always use `pnpm` for installing packages. Never use `npm install`.

## Database Migrations

Never run `db:push`. Always use `db:generate` followed by `db:migrate` to create and apply migrations.
