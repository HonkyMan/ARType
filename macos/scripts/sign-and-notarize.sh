#!/usr/bin/env bash
# Standalone upstream signing has been replaced by the complete ARType pipeline.
set -euo pipefail
printf '%s\n' 'Use scripts/build-artype-macos.sh SERVICE_URL --release with ARTYPE_SIGN_IDENTITY and ARTYPE_NOTARY_PROFILE.' >&2
exit 2
