#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
backup="${1:?Usage: deployment/restore.sh backup.dump --replace-database}"
test "${2:-}" = --replace-database || { echo 'Restore replaces database contents. Pass --replace-database explicitly.' >&2; exit 1; }
test -s "$backup"
running=()
inventory="$(docker compose ps --services --filter status=running)"
while IFS= read -r service; do
  case "$service" in api|web) running+=("$service");; esac
done <<< "$inventory"
if ((${#running[@]})); then docker compose stop "${running[@]}"; fi
docker compose exec -T db sh -c 'exec pg_restore -U artype --dbname="$POSTGRES_DB" --clean --if-exists --no-owner --single-transaction' < "$backup"
if ((${#running[@]})); then docker compose up -d "${running[@]}"; fi
