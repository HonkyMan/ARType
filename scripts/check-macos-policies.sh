#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
flags=(-swift-version 5 -default-isolation MainActor -warnings-as-errors)
run() {
  local name="$1"
  shift
  swiftc "${flags[@]}" "$@" "macos/tests/$name.swift" -o "$temporary/$name"
  "$temporary/$name"
  printf '%s passed\n' "$name"
}
run credential-origin macos/TypeTide/Services/ManagedEndpoint.swift
run service-translation \
  macos/TypeTide/Services/TranslationActionPolicy.swift \
  macos/TypeTide/Services/ServiceTranslation.swift \
  macos/TypeTide/Services/SystemServiceProvider.swift
run selection-icon-timeout macos/TypeTide/UI/SelectionIconAutoHide.swift
run shortcut-storage macos/TypeTide/Config/KeyboardShortcutPreference.swift
run managed-response \
  macos/TypeTide/Services/ManagedResponse.swift \
  macos/TypeTide/Services/ManagedTransport.swift
python3 macos/tests/services-contract.py
plutil -lint macos/TypeTide/Info.plist
