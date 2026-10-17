#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version="$(tr -d '[:space:]' < VERSION)"
out="${1:-$(pwd)/build/artype}"
mkdir -p "$out"
package="$out/ARType-server-$version.tar.gz"
git archive --format=tar --prefix=ARType-server/ HEAD \
  server/src server/public server/package.json server/package-lock.json \
  server/Dockerfile server/.dockerignore compose.yaml compose.local.yaml \
  deployment .env.example README.md docs/OPERATIONS.md docs/ACCEPTANCE.md LICENSE \
  | gzip > "$package"
(
  cd "$out"
  file="$(basename "$package")"
  if command -v sha256sum >/dev/null; then sha256sum "$file" > "$file.sha256";
  else shasum -a 256 "$file" > "$file.sha256"; fi
)
echo "$package"
