#!/usr/bin/env bash
#
# Spin up a local Postgres docker container matching the prod server version,
# dump prod into it, and rewrite .env.local to point DATABASE_URL at it.
# The original prod DATABASE_URL line is preserved (commented out) so it can
# be restored by uncommenting.
#
# Usage:  ./scripts/spin-up-local-db.sh
#
# Re-running is safe: an existing container is reused; the dump step will
# error out if the local DB is already populated unless --force is passed.

set -euo pipefail

CONTAINER_NAME="flux-local-pg"
LOCAL_PORT="9909"
LOCAL_USER="flux"
LOCAL_PASSWORD="flux"
LOCAL_DB="flux"
PG_IMAGE="postgres:15.5"
ENV_FILE=".env.local"

FORCE=0
if [[ "${1:-}" == "--force" ]]; then FORCE=1; fi

# ---------------------------------------------------------------------------
# Sanity checks
# ---------------------------------------------------------------------------

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found in PATH" >&2; exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "docker daemon is not running" >&2; exit 1
fi
if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump not found in PATH" >&2; exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "$ENV_FILE not found — run from repo root" >&2; exit 1
fi

# Extract prod DATABASE_URL (first non-commented match)
PROD_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')
if [[ -z "$PROD_URL" ]]; then
  echo "No active DATABASE_URL in $ENV_FILE" >&2; exit 1
fi
echo "Prod DATABASE_URL detected."

# ---------------------------------------------------------------------------
# Port check
# ---------------------------------------------------------------------------

if lsof -iTCP:$LOCAL_PORT -sTCP:LISTEN >/dev/null 2>&1; then
  # Allow our own container to hold the port
  if ! docker ps --format '{{.Names}} {{.Ports}}' | grep -E "^${CONTAINER_NAME}\b.*:${LOCAL_PORT}->" >/dev/null; then
    echo "Port $LOCAL_PORT is already in use by another process." >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Container lifecycle
# ---------------------------------------------------------------------------

if docker ps -a --format '{{.Names}}' | grep -qE "^${CONTAINER_NAME}$"; then
  if ! docker ps --format '{{.Names}}' | grep -qE "^${CONTAINER_NAME}$"; then
    echo "Starting existing container $CONTAINER_NAME..."
    docker start "$CONTAINER_NAME" >/dev/null
  else
    echo "Container $CONTAINER_NAME already running."
  fi
else
  echo "Pulling $PG_IMAGE (first time only)..."
  docker pull "$PG_IMAGE" >/dev/null
  echo "Creating container $CONTAINER_NAME on port $LOCAL_PORT..."
  docker run -d \
    --name "$CONTAINER_NAME" \
    -e POSTGRES_USER="$LOCAL_USER" \
    -e POSTGRES_PASSWORD="$LOCAL_PASSWORD" \
    -e POSTGRES_DB="$LOCAL_DB" \
    -p "${LOCAL_PORT}:5432" \
    "$PG_IMAGE" >/dev/null
fi

# Wait for readiness
echo -n "Waiting for Postgres to accept connections"
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER_NAME" pg_isready -U "$LOCAL_USER" -d "$LOCAL_DB" >/dev/null 2>&1; then
    echo " — ready."; break
  fi
  echo -n "."
  sleep 1
done

LOCAL_URL="postgresql://${LOCAL_USER}:${LOCAL_PASSWORD}@localhost:${LOCAL_PORT}/${LOCAL_DB}"

# ---------------------------------------------------------------------------
# Dump + restore
# ---------------------------------------------------------------------------

# Detect whether the local DB already has user data
EXISTING_TABLES=$(docker exec -e PGPASSWORD="$LOCAL_PASSWORD" "$CONTAINER_NAME" \
  psql -U "$LOCAL_USER" -d "$LOCAL_DB" -tA \
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" \
  2>/dev/null || echo 0)

if [[ "${EXISTING_TABLES:-0}" -gt 0 && "$FORCE" -ne 1 ]]; then
  echo "Local DB already has ${EXISTING_TABLES} tables. Skipping dump (pass --force to wipe & re-dump)."
else
  if [[ "$FORCE" -eq 1 && "${EXISTING_TABLES:-0}" -gt 0 ]]; then
    echo "--force: dropping and recreating public schema in local DB..."
    docker exec -e PGPASSWORD="$LOCAL_PASSWORD" "$CONTAINER_NAME" \
      psql -U "$LOCAL_USER" -d "$LOCAL_DB" \
      -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null
  fi

  echo "Dumping prod → local (this may take a while)..."
  # --no-owner / --no-acl: strip ownership so restore as local 'flux' user works.
  # Pipe straight through; no temp file.
  pg_dump --no-owner --no-acl --format=plain "$PROD_URL" \
    | docker exec -i -e PGPASSWORD="$LOCAL_PASSWORD" "$CONTAINER_NAME" \
        psql -U "$LOCAL_USER" -d "$LOCAL_DB" -v ON_ERROR_STOP=0 >/dev/null
  echo "Restore complete."
fi

# ---------------------------------------------------------------------------
# Rewrite .env.local
# ---------------------------------------------------------------------------

# If a previous run already swapped this file, don't double-comment.
if grep -qE '^# Prod DB \(commented by spin-up-local-db\.sh\)' "$ENV_FILE"; then
  echo ".env.local already points at local — leaving as-is."
else
  # Use a python helper for safe, idempotent rewrite
  python3 - "$ENV_FILE" "$LOCAL_URL" <<'PYEOF'
import sys, re, pathlib
path = pathlib.Path(sys.argv[1])
local_url = sys.argv[2]
src = path.read_text()
lines = src.splitlines(keepends=False)
out = []
swapped = False
for line in lines:
    if not swapped and re.match(r'^DATABASE_URL=', line):
        out.append('# Prod DB (commented by spin-up-local-db.sh — uncomment to restore)')
        out.append('# ' + line)
        out.append(f'DATABASE_URL="{local_url}"')
        swapped = True
    else:
        out.append(line)
path.write_text("\n".join(out) + ("\n" if src.endswith("\n") else ""))
PYEOF
  echo ".env.local now points at local DB: $LOCAL_URL"
fi

echo
echo "Done. Next steps:"
echo "  pnpm db:generate   # if you have new schema changes"
echo "  pnpm db:migrate"
echo
echo "To stop:    docker stop $CONTAINER_NAME"
echo "To restart: docker start $CONTAINER_NAME"
echo "To wipe:    docker rm -f $CONTAINER_NAME"
