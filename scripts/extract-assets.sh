#!/usr/bin/env bash
#
# extract-assets.sh — copy a finished run's produced tree out of the local k3d
# stack's artifact service onto the host.
#
# The artifact service (StatefulSet `tcab-artifacts`, pod `tcab-artifacts-0`)
# holds each run's uploaded tree on a PVC mounted at /artifacts, one directory per
# run id: /artifacts/<run-id>/ with `run-record.json` plus the `implementation/`
# tree (for asset-generation cases, the drawn PNGs and their action logs live in
# there). This pulls the whole run directory to tmp/assets/<run-id>/ via
# `kubectl cp`, so you can feed the produced assets into another test case.
#
# Usage:
#   scripts/extract-assets.sh <run-id> [<run-id> ...]
#
# Env overrides (defaults match `make -C deployments/local local-up`):
#   NS=tcab-local            namespace
#   SELECTOR=app.kubernetes.io/name=tcab-artifacts   pod label selector
#   CONTAINER=artifacts      container name in the pod
#   DEST=tmp/assets          host output root (run dirs land at $DEST/<run-id>)
#   CONTEXT=                  kubectl context (defaults to current; k3d uses k3d-tcab)

set -euo pipefail

NS="${NS:-tcab-local}"
SELECTOR="${SELECTOR:-app.kubernetes.io/name=tcab-artifacts}"
CONTAINER="${CONTAINER:-artifacts}"
DEST="${DEST:-tmp/assets}"

# Run from the repo root so a relative DEST lands under the repo, not wherever the
# script happened to be invoked from.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

KUBECTL=(kubectl)
[[ -n "${CONTEXT:-}" ]] && KUBECTL+=(--context "$CONTEXT")

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <run-id> [<run-id> ...]" >&2
  exit 2
fi

# Resolve the artifact pod once (StatefulSet, so normally tcab-artifacts-0, but
# resolve by label in case the ordinal/name differs).
POD="$("${KUBECTL[@]}" -n "$NS" get pod -l "$SELECTOR" \
        -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
if [[ -z "$POD" ]]; then
  echo "error: no pod matching '$SELECTOR' in namespace '$NS'." >&2
  echo "       is the stack up?  make -C deployments/local local-status" >&2
  exit 1
fi
echo "artifact pod: $NS/$POD (container: $CONTAINER)"

fail=0
for RUN_ID in "$@"; do
  # `kubectl cp` source path is relative to the container's working dir (/), so
  # `artifacts/<run-id>` resolves to the mounted store at /artifacts/<run-id>
  # and avoids the leading-slash warning kubectl prints for absolute paths.
  SRC="artifacts/${RUN_ID}"
  OUT="${DEST}/${RUN_ID}"

  # Confirm the run actually exists in the store before copying, so a typo in the
  # id gives a clear message instead of an empty/partial copy.
  if ! "${KUBECTL[@]}" -n "$NS" exec "$POD" -c "$CONTAINER" -- \
        test -d "/${SRC}" 2>/dev/null; then
    echo "  ✗ ${RUN_ID}: no run directory at /${SRC} in the store" >&2
    fail=1
    continue
  fi

  mkdir -p "$DEST"
  rm -rf "$OUT"
  echo "  → ${RUN_ID}: copying /${SRC} → ${OUT}/"
  "${KUBECTL[@]}" -n "$NS" cp -c "$CONTAINER" "${NS}/${POD}:${SRC}" "$OUT"

  # Surface the asset media so it's obvious what landed (and where run-record.json
  # maps each file). PNGs are the drawn sprites; *.json under the actions tree are
  # the recorded draw-operation logs.
  echo "    files:"
  find "$OUT" -maxdepth 4 \( -name '*.png' -o -name 'run-record.json' \) \
    -printf '      %P\n' 2>/dev/null | sort || true
done

echo "done. extracted under: ${DEST}/"
[[ $fail -eq 0 ]] || { echo "(one or more run ids were not found)" >&2; exit 1; }
