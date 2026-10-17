#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
service_url="${1:?Usage: scripts/build-artype-macos.sh SERVICE_URL --validation|--release}"
mode="${2:?Choose --validation or --release}"
[[ "$mode" = --validation || "$mode" = --release ]] || exit 2
python3 - "$service_url" "$mode" <<'PY'
import sys
from urllib.parse import urlsplit
u=urlsplit(sys.argv[1]); local=u.hostname in ('127.0.0.1','localhost','::1')
assert u.hostname and not u.username and not u.password and not u.query and not u.fragment and u.path in ('','/'), 'Expected server origin'
assert u.scheme=='https' or (sys.argv[2]=='--validation' and local and u.scheme=='http'), 'HTTPS required'
assert sys.argv[2]!='--release' or not local, 'Release must use public HTTPS service'
PY
if [[ "$mode" = --release ]]; then
  : "${ARTYPE_SIGN_IDENTITY:?Set a Developer ID Application identity}"
  : "${ARTYPE_NOTARY_PROFILE:?Set an xcrun notarytool keychain profile}"
fi
version="$(tr -d '[:space:]' < VERSION)"
out="$(pwd)/build/artype"
derived="${ARTYPE_DERIVED_DATA:-$out/DerivedData}"
mkdir -p "$out"
config=macos/TypeTide/managed-config.json
original="$(mktemp)"; cp "$config" "$original"
trap 'cp "$original" "$config"; rm -f "$original"' EXIT
python3 - "$service_url" "$config" <<'PY'
import sys,json
from pathlib import Path
Path(sys.argv[2]).write_text(json.dumps({'service_url':sys.argv[1].rstrip('/')}))
PY
xcodebuild -project macos/TypeTide.xcodeproj -scheme TypeTide -configuration Release \
  -destination 'platform=macOS,arch=arm64' -derivedDataPath "$derived" \
  -disableAutomaticPackageResolution -onlyUsePackageVersionsFromResolvedFile -jobs 4 \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO CODE_SIGN_IDENTITY= \
  COMPILER_INDEX_STORE_ENABLE=NO build
app="$derived/Build/Products/Release/ARType.app"
cp LICENSE "$app/Contents/Resources/TypeTide-LICENSE.txt"
if [[ "$mode" = --release ]]; then
  while IFS= read -r -d '' library; do codesign --force --options runtime --timestamp --sign "$ARTYPE_SIGN_IDENTITY" "$library"; done < <(find "$app/Contents" -name '*.dylib' -print0)
  codesign --force --deep --options runtime --timestamp --sign "$ARTYPE_SIGN_IDENTITY" "$app"
  codesign --verify --deep --strict --verbose=2 "$app"
  ditto -c -k --keepParent "$app" "$out/notarize.zip"
  xcrun notarytool submit "$out/notarize.zip" --keychain-profile "$ARTYPE_NOTARY_PROFILE" --wait
  xcrun stapler staple "$app"
  label="ARType-$version-macos-arm64"
else
  codesign --force --deep --sign - "$app"
  label="ARType-$version-macos-arm64-UNSIGNED-VALIDATION"
fi
stage="$(mktemp -d)"
trap 'cp "$original" "$config"; rm -f "$original"; rm -rf "$stage"' EXIT
ditto "$app" "$stage/ARType.app"
cp LICENSE "$stage/TypeTide-LICENSE.txt"
ln -s /Applications "$stage/Applications"
hdiutil create -volname ARType -srcfolder "$stage" -ov -format UDZO "$out/$label.dmg"
if [[ "$mode" = --release ]]; then
  codesign --timestamp --sign "$ARTYPE_SIGN_IDENTITY" "$out/$label.dmg"
  xcrun notarytool submit "$out/$label.dmg" --keychain-profile "$ARTYPE_NOTARY_PROFILE" --wait
  xcrun stapler staple "$out/$label.dmg"
  spctl -a -t open --context context:primary-signature -v "$out/$label.dmg"
fi
shasum -a 256 "$out/$label.dmg" > "$out/$label.dmg.sha256"
echo "$out/$label.dmg"
