#!/usr/bin/env bash
#
# extract-cluster-assets.sh — copy a finished run's produced tree out of a REMOTE
# (prod/staging) environment's artifact service onto the host. The remote sibling of
# scripts/extract-assets.sh, which does the same thing against the local k3d stack.
#
# The artifact service holds each run's uploaded tree as objects in the environment's
# private Blob container, and serves the whole tree as one archive:
# `GET /runs/<run-id>/archive.tar.gz`, the Download link on a run's detail page in the
# console. Its top-level entry is `<run-id>/`, holding `run-record.json`, the logs and
# the `implementation/` tree (for asset-generation cases, the drawn PNGs and their
# action logs live in there). This fetches it through the environment's edge, at
# `/artifacts/` of its origin, and unpacks it to tmp/assets/<run-id>/, so you can feed
# the produced assets into another test case.
#
# The edge is behind Cloudflare Access, so the request presents an Access service
# token, TCAB_ACCESS_CLIENT_ID and TCAB_ACCESS_CLIENT_SECRET, as the
# `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers: the same pair `tcab`
# uses (see apps/docs/src/content/docs/components/auth/overview.md). From a browser
# that is signed in, the console's Download link is the same archive.
#
# Usage (the target environment is REQUIRED — there is no default, so this can never
# silently reach into prod):
#   scripts/extract-cluster-assets.sh --env staging <run-id> [<run-id> ...]
#   scripts/extract-cluster-assets.sh --env prod <run-id>
#
# The origin for the chosen env comes from scripts/lib/env.sh.
#
# Env:
#   TCAB_ACCESS_CLIENT_ID, TCAB_ACCESS_CLIENT_SECRET   the Access service token (required)
#   DEST=tmp/assets          host output root (run dirs land at $DEST/<run-id>)
#   ORIGIN=                  origin override (defaults to the env's origin)

set -euo pipefail

# Resolve the target environment from a REQUIRED --env <prod|staging> (scripts/lib/env.sh);
# any remaining args are run ids.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env=""
run_ids=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) env="${2:-}"; shift 2 ;;
    --env=*) env="${1#*=}"; shift ;;
    -*) echo "unknown argument: $1 (usage: $0 --env <prod|staging> <run-id> [<run-id> ...])" >&2; exit 2 ;;
    *) run_ids+=("$1"); shift ;;
  esac
done
# shellcheck source=scripts/lib/env.sh
source "${script_dir}/lib/env.sh"
tcab_env_resolve "$env" || exit $?
origin="${ORIGIN:-$TCAB_ORIGIN}"
origin="${origin%/}"

if (( ${#run_ids[@]} == 0 )); then
  echo "usage: $0 --env <prod|staging> <run-id> [<run-id> ...]" >&2
  exit 2
fi

if [[ -z "${TCAB_ACCESS_CLIENT_ID:-}" || -z "${TCAB_ACCESS_CLIENT_SECRET:-}" ]]; then
  echo "error: set TCAB_ACCESS_CLIENT_ID and TCAB_ACCESS_CLIENT_SECRET to the ${env} Access" >&2
  echo "       service token; the edge admits no request without it." >&2
  exit 2
fi

DEST="${DEST:-tmp/assets}"

# Run from the repo root so a relative DEST lands under the repo, not wherever the
# script happened to be invoked from.
REPO_ROOT="$(cd "${script_dir}/.." && pwd)"
cd "$REPO_ROOT"

# A run id is interpolated into a URL path: keep it to the UUID-ish shape the ids
# actually have, so it can carry no `/`, `..` or query into the request.
for run_id in "${run_ids[@]}"; do
  if [[ ! "$run_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ || "$run_id" == *".."* ]]; then
    echo "error: implausible run id '${run_id}' (expected letters, digits, '.', '_', '-')" >&2
    exit 2
  fi
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The secret goes to curl through a header file rather than its argument list, so it
# never shows in the process table.
headers="${work}/headers"
(umask 077 && printf 'CF-Access-Client-Id: %s\nCF-Access-Client-Secret: %s\n' \
  "$TCAB_ACCESS_CLIENT_ID" "$TCAB_ACCESS_CLIENT_SECRET" >"$headers")

fail=0
for RUN_ID in "${run_ids[@]}"; do
  url="${origin}/artifacts/runs/${RUN_ID}/archive.tar.gz"
  archive="${work}/${RUN_ID}.tar.gz"
  echo "→ ${RUN_ID}: fetching ${url}"
  status="$(curl -sS -o "$archive" -w '%{http_code}' -H "@${headers}" "$url" || echo "000")"
  case "$status" in
    200) ;;
    404)
      echo "  ✗ ${RUN_ID}: no such run in the ${env} store" >&2
      fail=1
      continue
      ;;
    302 | 401 | 403)
      echo "  ✗ ${RUN_ID}: the edge refused the service token (${status}); check the pair and" >&2
      echo "     that the ${env} Access application's Service Auth policy includes it" >&2
      fail=1
      continue
      ;;
    *)
      echo "  ✗ ${RUN_ID}: the archive request answered ${status}" >&2
      head -c 400 "$archive" >&2 2>/dev/null || true
      echo >&2
      fail=1
      continue
      ;;
  esac

  # Check the whole archive before touching DEST: a body cut short mid-stream must
  # not replace an earlier extraction with a partial tree.
  if ! tar -tzf "$archive" >/dev/null 2>&1; then
    echo "  ✗ ${RUN_ID}: the archive is truncated or not a gzip tar" >&2
    fail=1
    continue
  fi

  OUT="${DEST}/${RUN_ID}"
  mkdir -p "$DEST"
  rm -rf "$OUT"
  echo "  → ${RUN_ID}: unpacking → ${OUT}/"
  # The archive's top-level entry is <run-id>/, so extracting into $DEST lands the
  # tree at $DEST/<run-id>/ — the same layout scripts/extract-assets.sh produces.
  tar -C "$DEST" -xzf "$archive"

  # Surface the asset media so it's obvious what landed (and where run-record.json
  # maps each file). PNGs are the drawn sprites; *.json under the actions tree are
  # the recorded draw-operation logs.
  echo "    files:"
  find "$OUT" -maxdepth 4 \( -name '*.png' -o -name 'run-record.json' \) \
    -printf '      %P\n' 2>/dev/null | sort || true
done

echo "done. extracted under: ${DEST}/"
[[ $fail -eq 0 ]] || { echo "(one or more run ids failed)" >&2; exit 1; }
