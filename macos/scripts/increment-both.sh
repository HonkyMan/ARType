#!/usr/bin/env bash
set -euo pipefail
script_directory="$(cd "$(dirname "$0")" && pwd)"
"$script_directory/increment-build.sh"
"$script_directory/increment-version.sh" "$@"
