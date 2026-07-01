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
# Ingest ADDS and OVERWRITES; it never PRUNES. A case's identity is its folder slug
# under test-cases/, so after you RENAME a case's folder (or delete a version) a
# re-ingest leaves the OLD slug still served alongside the new one. To drop the stale
# slug, start the backend from an empty definition store, then re-ingest.
#
# Usage:
#   scripts/reingest.sh                 # force re-ingest every case
#   scripts/reingest.sh carom            # scope to one case slug
#   scripts/reingest.sh carom coil      # scope to several
#
# Override the target with BACKEND_URL (default http://127.0.0.1:8787):
#   BACKEND_URL=http://127.0.0.1:8787 scripts/reingest.sh carom
set -euo pipefail

backend="${BACKEND_URL:-http://127.0.0.1:8787}"

# Build the JSON body. With no slugs, scan everything; otherwise restrict the
# scan to the given slugs. Always force so an unchanged version is overwritten.
if [[ $# -eq 0 ]]; then
  body='{"force": true}'
  scope="every case"
else
  # Join the slug args into a JSON string array: carom coil -> "carom","coil"
  cases=""
  for slug in "$@"; do
    cases+="\"${slug}\","
  done
  body="{\"testCases\": [${cases%,}], \"force\": true}"
  scope="$*"
fi

# Pull a JSON key's value out of one (non-nested) JSON line. Handles both string
# (`"slug":"carom"`) and scalar (`"index":1`) values, is order independent, and
# tolerates whitespace around the colon — so it reads both the compact NDJSON the
# stream emits and a pretty-printed error body. Returns empty when the key is absent;
# never fails under `set -e`.
jval() { # jval <key> <line>
  if [[ "$2" =~ \"$1\"[[:space:]]*:[[:space:]]*\"?([^,\"}]*) ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  fi
}

echo "Re-ingesting ${scope} via ${backend}/ingest (force)…"

# A marker file carries an in-band `error` event (or a non-streamed error body) out
# of the `while` subshell (the right-hand side of a pipe runs in its own shell, so a
# plain variable would not survive). It is also non-empty if no closing `done`
# arrived, so a truncated or pre-streaming response is treated as a failure rather
# than a silent success.
marker="$(mktemp)"
trap 'rm -f "$marker"' EXIT
printf 'incomplete' >"$marker"

# `--fail-with-body` rather than `-f`: a render failure that the backend reports as a
# plain HTTP error (e.g. a 500 from a backend that did not negotiate the NDJSON feed)
# must still hand us its body, which carries the actual message ("could not render
# reference `…`"). Plain `-f` discards that body and leaves only "curl: (22) … 500".
#
# A whole-catalog render legitimately takes minutes, so a hard `--max-time` is the
# wrong guard — it would abort a healthy long ingest. Instead `--connect-timeout`
# fails fast when the connection cannot be established, and `--speed-time` aborts
# only a *stalled* transfer (under `--speed-limit` bytes/sec for that many seconds),
# which a stream emitting a per-case line every few seconds never trips. Together
# they bound a dead/squatted endpoint (e.g. an editor port-forward that accepts then
# never answers) instead of hanging forever, while a progressing stream runs as long
# as it needs.
curl -sS -N --fail-with-body --connect-timeout 5 --speed-limit 1 --speed-time 120 -X POST "${backend}/ingest" \
  -H 'content-type: application/json' \
  -H 'accept: application/x-ndjson' \
  -d "${body}" \
| while IFS= read -r line || [[ -n "$line" ]]; do
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
      *)
        # Any non-empty line that is not a recognized progress event is unexpected —
        # most often a non-streamed HTTP error body delivered by `--fail-with-body`
        # (a backend that answered with a plain error rather than the NDJSON feed).
        # Surface its `message` (falling back to the raw line) instead of letting it
        # vanish, and mark the run failed.
        if [[ -n "$line" ]]; then
          msg="$(jval message "$line")"
          printf 'ingest error: %s\n' "${msg:-$line}" >&2
          printf 'error' >"$marker"
        fi
        ;;
    esac
  done || true   # see the $marker check below: the pipeline's exit status is not the
                 # signal, so `|| true` keeps `set -e`/`pipefail` from aborting here on
                 # curl's non-zero exit (e.g. 22 from --fail-with-body on an HTTP error)
                 # before we can inspect the outcome the loop recorded.

# Fail the command (so callers like `make local-up` abort) unless a successful `done`
# was streamed. $marker is the single source of truth, written from inside the loop's
# subshell: a clean run empties it on `done`, and every failure mode leaves it
# non-empty — a streamed `error` event or non-streamed HTTP error body ("error"), and a
# truncated stream, a transport failure that produced no body, or a stalled/timed-out
# transfer (the initial "incomplete", never cleared). curl's own diagnostic for the
# last group is already on stderr via -S.
if [[ -s "$marker" ]]; then
  echo "re-ingest did not complete successfully." >&2
  exit 1
fi
