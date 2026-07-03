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
# CHANGE DETECTION. Rendering all 50+ cases on every edit is wasteful, so by
# default this only re-ingests cases whose files changed since the last successful
# run. We keep a marker file (its mtime is the last-ingest baseline) and, for each
# candidate case, ask `find` whether any file under test-cases/<slug>/ is newer than
# that baseline. Cases with no newer file are skipped without touching the backend.
# The baseline is captured BEFORE the scan and only advanced on success, so an edit
# made while an ingest is in flight is still caught on the next run. Two escape
# hatches ignore the baseline: `--force` (re-ingest everything regardless), and a
# missing marker file (a first run, or `rm .reingest-timestamp`, re-ingests all).
#
# Note the two distinct meanings of "force": the `--force` FLAG here controls the
# CLIENT-side change detection (scan everything, skip the mtime filter), while the
# `"force": true` we always send in the request body is the BACKEND-side overwrite
# of an already-stored (slug, version) — needed because iterating in place reuses a
# version string, which the immutable store would otherwise decline to replace.
#
# A case's identity is the `slug` its test-case.toml declares (NOT its folder name;
# the two usually match but can differ — e.g. carom/ pins slug = "pong" to keep the
# runs published under its original slug). A WHOLE-CATALOG re-ingest (no slug args)
# also PRUNES: any (slug, version) the checkout no longer declares is dropped from the
# store, EXCEPT one a published/pending run still references (those are kept so the run
# stays resolvable). So renaming a folder while keeping its slug, or deleting a run-less
# case, self-heals on the next full re-ingest — no more rebuilding the store from empty.
# A partial scan (slug/folder args) never prunes: it hasn't seen the whole catalog. You
# may target a case by either its slug or its folder name.
#
# Usage:
#   scripts/reingest.sh                 # re-ingest only cases changed since the last run
#   scripts/reingest.sh carom            # scope to one slug (still skipped if unchanged)
#   scripts/reingest.sh carom coil      # scope to several
#   scripts/reingest.sh --force          # re-ingest EVERY case, ignoring change detection
#   scripts/reingest.sh --force carom    # force one slug regardless of its mtimes
#
# Override the target with BACKEND_URL (default http://127.0.0.1:8787):
#   BACKEND_URL=http://127.0.0.1:8787 scripts/reingest.sh carom
set -euo pipefail

backend="${BACKEND_URL:-http://127.0.0.1:8787}"

# Resolve the repo root from this script's own location so change detection reads
# the right test-cases/ tree no matter the caller's working directory.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
cases_dir="${repo_root}/test-cases"

# The change-detection baseline. Gitignored (see .gitignore) — it is per-checkout
# local state, not source. `rm` it to force a full re-ingest without --force.
timestamp="${repo_root}/.reingest-timestamp"

# Parse args: --force toggles the flag; anything else is a case slug. Guard unknown
# options so a typo (`--foce`) is an error, not a slug silently shipped to the backend.
force=false
slugs=()
for arg in "$@"; do
  case "$arg" in
    --force) force=true ;;
    --) : ;;                       # accepted, no-op (POSIX end-of-options)
    -*) echo "unknown option: $arg (did you mean --force?)" >&2; exit 2 ;;
    *)  slugs+=("$arg") ;;
  esac
done

# Snapshot "now" as the candidate next baseline, captured before we scan so any
# concurrent edit is caught next time. Promoted onto $timestamp only on success.
stamp_ref="$(mktemp)"
trap 'rm -f "$stamp_ref" "${marker:-}"' EXIT

# Candidate set: the named slugs, or every case folder when none were named.
candidates=()
if [[ ${#slugs[@]} -gt 0 ]]; then
  candidates=("${slugs[@]}")
else
  while IFS= read -r d; do
    candidates+=("$(basename "$d")")
  done < <(find "$cases_dir" -mindepth 1 -maxdepth 1 -type d | sort)
fi

# Decide what actually gets ingested.
#
# `whole_catalog` (no named slugs AND we are ignoring the mtime filter) sends the
# original body-less `{"force": true}` scan, letting the backend enumerate the
# catalog itself — this covers both --force and the first-run/no-baseline case
# without our having to spell out every slug.
#
# Otherwise we hand the backend an explicit, possibly-filtered slug list. When the
# baseline exists and --force was not given, drop any candidate with no file newer
# than the baseline (`find -newer … -print -quit` stops at the first hit, so it is
# cheap even on large cases). An empty result means nothing changed: report and exit
# cleanly without bothering the backend.
if [[ ${#slugs[@]} -eq 0 && ( "$force" == true || ! -e "$timestamp" ) ]]; then
  body='{"force": true}'
  if [[ "$force" == true ]]; then
    scope="every case (--force)"
  else
    scope="every case (first run — no baseline yet)"
  fi
else
  to_ingest=()
  for slug in "${candidates[@]}"; do
    dir="${cases_dir}/${slug}"
    if [[ "$force" == true || ! -e "$timestamp" || ! -d "$dir" ]]; then
      # --force / no baseline / a slug with no folder on disk (let the backend judge it).
      to_ingest+=("$slug")
    elif [[ -n "$(find "$dir" -newer "$timestamp" -print -quit 2>/dev/null)" ]]; then
      to_ingest+=("$slug")
    fi
  done

  if [[ ${#to_ingest[@]} -eq 0 ]]; then
    echo "Nothing changed since the last re-ingest — skipping. (Use --force to re-ingest anyway.)"
    exit 0
  fi

  cases=""
  for slug in "${to_ingest[@]}"; do
    cases+="\"${slug}\","
  done
  body="{\"testCases\": [${cases%,}], \"force\": true}"
  scope="${to_ingest[*]}"
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

# Success: advance the change-detection baseline to the pre-scan snapshot, so the
# next run only re-ingests cases edited from here on.
touch -r "$stamp_ref" "$timestamp"
