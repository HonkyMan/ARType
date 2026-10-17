#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
backup="${1:?Usage: deployment/restore.sh backup.dump --replace-database}"
test "${2:-}" = --replace-database || { echo 'Restore replaces database contents. Pass --replace-database explicitly.' >&2; exit 1; }
test -s "$backup"
running=()
while IFS= read -r service; do
  case "$service" in api|web) running+=("$service");; esac
done < <(docker compose ps --services --filter status=running)
docker compose stop api web
docker compose exec -T db pg_restore -U artype -d artype --clean --if-exists --no-owner --single-transaction < "$backup"
if ((${#running[@]})); then docker compose up -d "${running[@]}"; fi
