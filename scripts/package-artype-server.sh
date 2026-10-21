#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ $# -gt 1 ]]; then
  echo 'Usage: scripts/package-artype-server.sh [OUTPUT_DIRECTORY]' >&2
  exit 2
fi
exec node "$root/scripts/package-artype-pilot.mjs" --server-only --out "${1:-$root/build/artype}"
