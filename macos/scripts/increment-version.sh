#!/usr/bin/env bash
# Keep the legacy path while updating the single shared product version.
set -euo pipefail
exec "$(cd "$(dirname "$0")/../.." && pwd)/scripts/bump-version.sh" "$@"
