#!/usr/bin/env bash
# Legacy convenience path: building never bumps, commits or pushes source.
set -euo pipefail
exec "$(cd "$(dirname "$0")/../.." && pwd)/scripts/build-artype-macos.sh" "$@"
