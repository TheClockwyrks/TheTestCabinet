#!/usr/bin/env bash
#
# extract-assets.sh — copy a finished run's produced tree out of the local k3d
# stack's artifact service onto the host.
#
# The artifact service holds each run's uploaded tree as objects in its private
# Blob container (Azurite, on the local stack), and serves the whole tree as one
# archive: `GET /runs/<run-id>/archive.tar.gz`, the console's Download link. The
# archive's top-level entry is `<run-id>/`, holding `run-record.json`, the logs and
# the `implementation/` tree (for asset-generation cases, the drawn PNGs and their
# action logs live in there). This fetches it and unpacks it to tmp/assets/<run-id>/,
# so you can feed the produced assets into another test case.
#
# The local overlay sets no Access application, so the service takes the caller's
# identity from the `Cf-Access-Authenticated-User-Email` header, which this sends.
# The service is reached through a `kubectl port-forward` this script holds for its
# own run, or at ARTIFACTS_URL when that is set (for example
# http://127.0.0.1:8790 while `make -C deployments/local local-forward` runs).
#
# For a run on a DEPLOYED cluster (prod/staging), use the remote sibling
# scripts/extract-cluster-assets.sh, which fetches the same archive through the edge.
#
# Usage:
#   scripts/extract-assets.sh <run-id> [<run-id> ...]
#
# Env overrides (defaults match `make -C deployments/local local-up`):
#   NS=tcab-local            namespace of the port-forward
#   ARTIFACTS_URL=           the artifact service's base URL; unset, a port-forward
#                            to svc/tcab-artifacts is opened for the run
#   IDENTITY=dev@local       the identity sent in Cf-Access-Authenticated-User-Email
#   DEST=tmp/assets          host output root (run dirs land at $DEST/<run-id>)
#   CONTEXT=                 kubectl context (defaults to current; k3d uses k3d-tcab)

set -euo pipefail

NS="${NS:-tcab-local}"
IDENTITY="${IDENTITY:-dev@local}"
DEST="${DEST:-tmp/assets}"

# Run from the repo root so a relative DEST lands under the repo, not wherever the
# script happened to be invoked from.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <run-id> [<run-id> ...]" >&2
  exit 2
fi

# A run id is interpolated into a URL path: keep it to the shape ids have, so it can
# carry no `/`, `..` or query into the request.
for run_id in "$@"; do
  if [[ ! "$run_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ || "$run_id" == *".."* ]]; then
    echo "error: implausible run id '${run_id}' (expected letters, digits, '.', '_', '-')" >&2
    exit 2
  fi
done

work="$(mktemp -d)"
forward_pid=""
cleanup() {
  [[ -n "$forward_pid" ]] && kill "$forward_pid" 2>/dev/null
  rm -rf "$work"
}
trap cleanup EXIT

base="${ARTIFACTS_URL:-}"
if [[ -z "$base" ]]; then
  KUBECTL=(kubectl)
  [[ -n "${CONTEXT:-}" ]] && KUBECTL+=(--context "$CONTEXT")
  # An ephemeral local port, read back from the forward's own first line.
  "${KUBECTL[@]}" -n "$NS" port-forward svc/tcab-artifacts :8790 >"$work/forward.log" 2>&1 &
  forward_pid=$!
  port=""
  for _ in $(seq 1 50); do
    port="$(sed -n 's/^Forwarding from 127\.0\.0\.1:\([0-9]*\) .*/\1/p' "$work/forward.log" | head -1)"
    [[ -n "$port" ]] && break
    kill -0 "$forward_pid" 2>/dev/null || break
    sleep 0.2
  done
  if [[ -z "$port" ]]; then
    echo "error: could not port-forward svc/tcab-artifacts in namespace '$NS':" >&2
    cat "$work/forward.log" >&2
    echo "       is the stack up?  make -C deployments/local local-status" >&2
    exit 1
  fi
  base="http://127.0.0.1:${port}"
fi
base="${base%/}"
echo "artifact service: ${base}"

fail=0
for RUN_ID in "$@"; do
  archive="${work}/${RUN_ID}.tar.gz"
  echo "  → ${RUN_ID}: fetching ${base}/runs/${RUN_ID}/archive.tar.gz"
  status="$(curl -sS -o "$archive" -w '%{http_code}' \
    -H "Cf-Access-Authenticated-User-Email: ${IDENTITY}" \
    "${base}/runs/${RUN_ID}/archive.tar.gz" || echo "000")"
  if [[ "$status" == 404 ]]; then
    echo "  ✗ ${RUN_ID}: no such run in the store" >&2
    fail=1
    continue
  fi
  if [[ "$status" != 200 ]]; then
    echo "  ✗ ${RUN_ID}: the archive request answered ${status}" >&2
    head -c 400 "$archive" >&2 2>/dev/null || true
    echo >&2
    fail=1
    continue
  fi

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
  # The archive's top-level entry is <run-id>/, so it lands at $DEST/<run-id>/.
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
