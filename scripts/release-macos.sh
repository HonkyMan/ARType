#!/usr/bin/env bash
# ARType packaging entry point. Publishing is an explicit separate operation.
set -euo pipefail
exec "$(dirname "$0")/build-artype-macos.sh" "$@"
