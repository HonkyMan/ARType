#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
compiler="${CXX:-c++}"
flags=(-std=c++20 -Wall -Wextra -Werror -pthread -fsanitize=address,undefined -fno-omit-frame-pointer -I windows/src)
tests=(managed-protocol replacement-safety clipboard-policy worker-pool request-deadline owned-messages credential-origin crash-metadata)
for test in "${tests[@]}"; do
  sources=("windows/tests/$test.cpp")
  if [[ "$test" == managed-protocol || "$test" == crash-metadata ]]; then sources+=(windows/src/Json.cpp); fi
  if [[ "$test" == managed-protocol ]]; then sources+=(windows/src/Language.cpp); fi
  "$compiler" "${flags[@]}" "${sources[@]}" -o "$temporary/$test"
  "$temporary/$test"
  printf '%s passed\n' "$test"
done
