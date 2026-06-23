#!/usr/bin/env bash
# Trigger a forced re-ingest against a local (or remote) backend so it picks up
# edits to test-case versions you are iterating on. A plain scan skips any
# version already in the immutable store, so this always forces the overwrite —
# without it a backend-driven run keeps serving the stale definition (new
# manifest fields read back empty). See development/running.md.
#
# A whole-catalog scan renders every case's references server-side and can take a
# minute-plus, so we ask for the streamed NDJSON progress feed
# (`Accept: application/x-ndjson`) and print a line per case as it completes,
# instead of one silent blocking POST that looks like a hang.
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
  scope="every case"
else
  # Join the slug args into a JSON string array: pong snake -> "pong","snake"
  cases=""
  for slug in "$@"; do
    cases+="\"${slug}\","
  done
  body="{\"testCases\": [${cases%,}], \"force\": true}"
  scope="$*"
fi

# Pull a JSON key's value out of one compact (non-nested) NDJSON line. Handles
# both string (`"slug":"pong"`) and scalar (`"index":1`) values, and is order
# independent. Returns empty when the key is absent; never fails under `set -e`.
jval() { # jval <key> <line>
  if [[ "$2" =~ \"$1\":\"?([^,\"}]*) ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  fi
}

echo "Re-ingesting ${scope} via ${backend}/ingest (force)…"

# A marker file carries an in-band `error` event out of the `while` subshell (the
# right-hand side of a pipe runs in its own shell, so a plain variable would not
# survive). It is also non-empty if no closing `done` arrived, so a truncated or
# pre-streaming response is treated as a failure rather than a silent success.
marker="$(mktemp)"
trap 'rm -f "$marker"' EXIT
printf 'incomplete' >"$marker"

# A whole-catalog render legitimately takes minutes, so a hard `--max-time` is the
# wrong guard — it would abort a healthy long ingest. Instead `--connect-timeout`
# fails fast when the connection cannot be established, and `--speed-time` aborts
# only a *stalled* transfer (under `--speed-limit` bytes/sec for that many seconds),
# which a stream emitting a per-case line every few seconds never trips. Together
# they bound a dead/squatted endpoint (e.g. an editor port-forward that accepts then
# never answers) instead of hanging forever, while a progressing stream runs as long
# as it needs.
curl -fsS -N --connect-timeout 5 --speed-limit 1 --speed-time 120 -X POST "${backend}/ingest" \
  -H 'content-type: application/json' \
  -H 'accept: application/x-ndjson' \
  -d "${body}" \
| while IFS= read -r line; do
    case "$line" in
      *'"event":"start"'*)
        printf '  scanning %s test cases…\n' "$(jval total "$line")"
        ;;
      *'"event":"version"'*)
        if [[ "$line" == *'"ingested":true'* ]]; then
          state="ingested ($(jval renderedReferences "$line") refs)"
        else
          state="unchanged"
        fi
        printf '  [%2s/%2s] %s %s — %s\n' \
          "$(jval index "$line")" "$(jval total "$line")" \
          "$(jval slug "$line")" "$(jval version "$line")" "$state"
        ;;
      *'"event":"done"'*)
        printf 'Catalog ingested: %s ingested, %s unchanged (%s total).\n' \
          "$(jval ingested "$line")" "$(jval skipped "$line")" "$(jval total "$line")"
        : >"$marker"
        ;;
      *'"event":"error"'*)
        printf 'ingest failed: %s\n' "$(jval message "$line")" >&2
        printf 'error' >"$marker"
        ;;
    esac
  done

# Fail the command (so callers like `make local-up` abort) when the transport
# failed or no successful `done` was streamed.
if [[ "${PIPESTATUS[0]}" -ne 0 || -s "$marker" ]]; then
  echo "re-ingest did not complete successfully." >&2
  exit 1
fi
