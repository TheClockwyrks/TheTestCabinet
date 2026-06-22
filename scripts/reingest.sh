#!/usr/bin/env bash
# Trigger a forced re-ingest against a local (or remote) backend so it picks up
# edits to test-case versions you are iterating on. A plain scan skips any
# version already in the immutable store, so this always forces the overwrite —
# without it a backend-driven run keeps serving the stale definition (new
# manifest fields read back empty). See development/running.md.
#
# Usage:
#   scripts/reingest.sh                 # force re-ingest every case
#   scripts/reingest.sh pong            # scope to one case slug
#   scripts/reingest.sh pong snake      # scope to several
#
# Override the target with BACKEND_URL (default http://127.0.0.1:8787):
#   BACKEND_URL=http://127.0.0.1:8787 scripts/reingest.sh pong
set -euo pipefail

backend="${BACKEND_URL:-http://127.0.0.1:8787}"

# Build the JSON body. With no slugs, scan everything; otherwise restrict the
# scan to the given slugs. Always force so an unchanged version is overwritten.
if [[ $# -eq 0 ]]; then
  body='{"force": true}'
else
  # Join the slug args into a JSON string array: pong snake -> "pong","snake"
  cases=""
  for slug in "$@"; do
    cases+="\"${slug}\","
  done
  body="{\"testCases\": [${cases%,}], \"force\": true}"
fi

echo "POST ${backend}/ingest  ${body}"
curl -fsS -X POST "${backend}/ingest" \
  -H 'content-type: application/json' \
  -d "${body}"
echo
