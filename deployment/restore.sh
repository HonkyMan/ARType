#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
backup="${1:?Usage: deployment/restore.sh backup.dump --replace-database}"
test "${2:-}" = --replace-database || { echo 'Restore replaces database contents. Pass --replace-database explicitly.' >&2; exit 1; }
test -s "$backup"
docker compose stop api web
docker compose exec -T db pg_restore -U artype -d artype --clean --if-exists --no-owner --single-transaction < "$backup"
docker compose up -d api web
