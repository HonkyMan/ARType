#!/usr/bin/env bash
# Compatibility entry point for the corporate ARType build.
set -euo pipefail
exec "$(cd "$(dirname "$0")/../.." && pwd)/scripts/build-artype-macos.sh" "$@"
