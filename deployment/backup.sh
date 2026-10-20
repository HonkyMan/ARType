#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
destination="${1:?Usage: deployment/backup.sh /absolute/backup-directory}"
mkdir -p "$destination"
backup="$destination/artype-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T db sh -c 'exec pg_dump -U artype --dbname="$POSTGRES_DB" -Fc' > "$backup"
test -s "$backup"
echo "$backup"
