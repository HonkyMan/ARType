#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo 'Install Docker with Compose first.' >&2; exit 1; }
args=(node deployment/configure.mjs)
docker_command=(docker run --rm --user "$(id -u):$(id -g)" -v "$(pwd):/workspace" -w /workspace)
while (($#)); do
  case "$1" in
    --google-json|--provider-key-file)
      flag="$1"; file="${2:?Missing credential file path}"
      test -f "$file" || { echo 'Credential file not found.' >&2; exit 1; }
      file="$(cd "$(dirname "$file")" && pwd -P)/$(basename "$file")"
      if [[ "$flag" = --google-json ]]; then target=/run/artype/google.json; else target=/run/artype/provider-key; fi
      docker_command+=(-v "$file:$target:ro");args+=("$flag" "$target");shift 2;;
    --admin-email|--domain|--port|--provider-url)
      args+=("$1" "${2:?Missing option value}");shift 2;;
    --help) args+=(--help);shift;;
    *) echo 'Unknown option. Run deployment/setup.sh --help.' >&2;exit 2;;
  esac
done
"${docker_command[@]}" node:24-bookworm-slim "${args[@]}"
