#!/usr/bin/env bash
#
# extract-cluster-assets.sh — copy a finished run's produced tree out of a REMOTE
# (prod/staging) cluster's artifact service onto the host. The remote sibling of
# scripts/extract-assets.sh, which does the same thing against the local k3d stack.
#
# The artifact service (StatefulSet `tcab-artifacts`) holds each run's uploaded tree
# on a PVC mounted at /artifacts, one directory per run id: /artifacts/<run-id>/ with
# `run-record.json` plus the `implementation/` tree (for asset-generation cases, the
# drawn PNGs and their action logs live in there). This pulls the whole run directory
# to tmp/assets/<run-id>/, so you can feed the produced assets into another test case.
#
# Why it can't just `kubectl cp` like the local script does: the deployed clusters
# have a PRIVATE API server and the artifact service is behind the INTERNAL ingress,
# so from a dev box there is neither a usable kubeconfig nor a reachable artifact URL.
# Like the other remote scripts (reingest-cluster.sh, backfill-run-media.sh) this
# drives the cluster with `az aks command invoke`, which needs only an authenticated
# `az`. That gives us a command channel but no file channel — an invoke returns its
# command's stdout and nothing else — so the tree comes back as base64 over stdout:
# the run dir is tarred once into the artifact pod's /tmp, then pulled in chunks
# (one invoke each), decoded, and untarred here. The staged tarball is removed after.
#
# Chunking (rather than one giant invoke) is not a nicety: `az aks command invoke`
# TRUNCATES the logs it returns at 512 KiB (measured: the response stops dead at
# 524287 bytes, mid-payload, with no error). A chunk whose base64 exceeds that comes
# back missing its end marker and is rejected — so CHUNK_BYTES has a hard ceiling,
# not just a speed/size trade-off. base64 inflates by exactly 4/3, so the ceiling on
# raw bytes is ~393 KiB; the default leaves headroom below it. The cost is one
# helper-pod round trip (~15s) per chunk, so a large tree takes a few minutes.
# Raising CHUNK_BYTES past the ceiling is refused up front rather than failing on the
# first chunk after the (slow) staging step.
#
# Usage (the target environment is REQUIRED — there is no default, so this can never
# silently reach into prod):
#   scripts/extract-cluster-assets.sh --env staging <run-id> [<run-id> ...]
#   scripts/extract-cluster-assets.sh --env prod <run-id>
#
# The cluster, resource group, and namespace for the chosen env come from
# scripts/lib/env.sh.
#
# Env overrides:
#   DEST=tmp/assets          host output root (run dirs land at $DEST/<run-id>)
#   NS=                      namespace override (defaults to the env's namespace)
#   CONTAINER=artifacts      container name in the artifact pod
#   CHUNK_BYTES=327680       bytes of tarball pulled per invoke (base64 is ~4/3 that;
#                            must stay under the 512 KiB invoke-response cap)

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
resource_group="$TCAB_RG"
cluster="$TCAB_CLUSTER"
namespace="${NS:-$TCAB_NAMESPACE}"

if (( ${#run_ids[@]} == 0 )); then
  echo "usage: $0 --env <prod|staging> <run-id> [<run-id> ...]" >&2
  exit 2
fi

CONTAINER="${CONTAINER:-artifacts}"
DEST="${DEST:-tmp/assets}"
CHUNK_BYTES="${CHUNK_BYTES:-327680}"

# `az aks command invoke` silently truncates its returned logs at 512 KiB, so a chunk
# is only pullable if its base64 (4/3 of the raw bytes, plus the two markers and their
# newlines) lands under that. Check it here: the alternative is discovering it after
# the staging invoke, one round trip into a transfer that cannot succeed.
INVOKE_LOG_CAP=524287
# shellcheck disable=SC2017  # `(n+2)/3*4` IS base64's size: round the group count up,
# then 4 chars per 3-byte group. The suggested `n*4/3` rewrite drops the padding.
chunk_b64=$(( (CHUNK_BYTES + 2) / 3 * 4 + 64 ))
if (( chunk_b64 >= INVOKE_LOG_CAP )); then
  # shellcheck disable=SC2017  # the inverse, rounded DOWN so the result stays legal.
  max_raw=$(( (INVOKE_LOG_CAP - 64) / 4 * 3 ))
  echo "error: CHUNK_BYTES=${CHUNK_BYTES} encodes to ~${chunk_b64} base64 bytes, over the" >&2
  echo "       ${INVOKE_LOG_CAP}-byte cap on what 'az aks command invoke' returns." >&2
  echo "       Use CHUNK_BYTES at or below ${max_raw}." >&2
  exit 2
fi

# Run from the repo root so a relative DEST lands under the repo, not wherever the
# script happened to be invoked from.
REPO_ROOT="$(cd "${script_dir}/.." && pwd)"
cd "$REPO_ROOT"

# A run id is the store's directory key and is interpolated into the remote shell's
# arguments — keep it to the UUID-ish shape the ids actually have so it can never
# carry a path traversal or a quote into the cluster-side command.
for run_id in "${run_ids[@]}"; do
  # Must start alphanumeric and carry no `..`, so neither `-flag` nor a parent-dir
  # hop can reach the store through the run-id slot.
  if [[ ! "$run_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ || "$run_id" == *".."* ]]; then
    echo "error: implausible run id '${run_id}' (expected letters, digits, '.', '_', '-')" >&2
    exit 2
  fi
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Run one command inside the artifact container and echo just its stdout.
#
# `sts/tcab-artifacts` targets the StatefulSet's (single) pod without a separate
# lookup invoke. Everything runs inside the container's own `sh -c`, with the run id
# and offsets passed as POSITIONAL args ($1…) rather than interpolated into the
# script text — the shape the other remote scripts use, so their contents can never
# collide with the surrounding shells. `--query logs -o tsv` strips az's own
# preamble, leaving the command's raw stdout.
#
# az reports the *invoke* succeeding even when the in-pod command fails, so each
# remote script ends by echoing __TCAB_OK__ under `set -e`: no sentinel means the
# command did not reach the end, and the caller treats that as a failure.
#
# The remote scripts below must therefore contain NO single quote — they are pasted
# into a single-quoted `sh -c '…'`. Quote with double quotes cluster-side.
invoke() {
  local remote_script="$1"; shift
  az aks command invoke \
    --resource-group "${resource_group}" \
    --name "${cluster}" \
    --command "kubectl -n ${namespace} exec sts/tcab-artifacts -c ${CONTAINER} -- sh -c '${remote_script}' sh $*" \
    --query logs -o tsv
}

# Pull the base64 payload out of an invoke's logs. The az tsv formatter's treatment
# of embedded newlines is not something to depend on, so this is deliberately
# line-agnostic: strip ALL whitespace first (the base64 alphabet has none, and
# `base64 -w0` emits one unbroken run), then cut everything outside the markers.
# Both markers must be present — otherwise the logs are an error message, not a
# payload, and cutting on a marker that isn't there would hand the whole message to
# `base64 -d`.
between_markers() {
  local squeezed
  squeezed="$(tr -d '[:space:]')"
  [[ "$squeezed" == *__TCAB_B64_BEGIN__*__TCAB_B64_END__* ]] || return 1
  printf '%s' "$squeezed" | sed -e 's/.*__TCAB_B64_BEGIN__//' -e 's/__TCAB_B64_END__.*//'
}

fail=0
for RUN_ID in "${run_ids[@]}"; do
  echo "→ ${RUN_ID}: staging tarball on ${cluster}/${namespace}…"

  # Stage: confirm the run exists in the store, then tar it (from /artifacts, so the
  # archive's top-level entry is the run id) and report the tarball's byte count.
  # shellcheck disable=SC2016  # the $-expansions are for the cluster-side shell, not this one
  staged="$(invoke 'set -e
run="$1"
test -d "/artifacts/$run" || { echo "__TCAB_MISSING__"; exit 4; }
tar -C /artifacts -czf "/tmp/tcab-extract-$run.tgz" "$run"
echo "__TCAB_SIZE__=$(wc -c < "/tmp/tcab-extract-$run.tgz")"
echo __TCAB_OK__' "$RUN_ID" || true)"

  if [[ "$staged" == *__TCAB_MISSING__* ]]; then
    echo "  ✗ ${RUN_ID}: no run directory at /artifacts/${RUN_ID} in the ${env} store" >&2
    fail=1
    continue
  fi
  if [[ "$staged" != *__TCAB_OK__* ]]; then
    echo "  ✗ ${RUN_ID}: could not stage the tarball (is the artifact pod up?)" >&2
    echo "${staged}" >&2
    fail=1
    continue
  fi

  size="$(printf '%s' "$staged" | tr -d '[:space:]' | sed -n 's/.*__TCAB_SIZE__=\([0-9]*\).*/\1/p')"
  if [[ -z "$size" || "$size" == "0" ]]; then
    echo "  ✗ ${RUN_ID}: the staged tarball reported no size" >&2
    fail=1
    continue
  fi

  chunks=$(( (size + CHUNK_BYTES - 1) / CHUNK_BYTES ))
  echo "  staged ${size} bytes; pulling in ${chunks} chunk(s) of ${CHUNK_BYTES}…"

  # Pull: `tail -c +<offset>` is 1-BASED (byte 1 is the first), so the first chunk
  # starts at 1, not 0.
  tgz="${work}/${RUN_ID}.tgz"
  : > "$tgz"
  offset=1
  chunk=0
  pull_failed=0
  while (( offset <= size )); do
    chunk=$(( chunk + 1 ))
    echo "    chunk ${chunk}/${chunks}…"
    # shellcheck disable=SC2016  # cluster-side expansions again
    raw="$(invoke 'echo __TCAB_B64_BEGIN__
tail -c "+$2" "/tmp/tcab-extract-$1.tgz" | head -c "$3" | base64 -w0
echo
echo __TCAB_B64_END__' "$RUN_ID" "$offset" "$CHUNK_BYTES" || true)"
    payload="$(printf '%s' "$raw" | between_markers || true)"
    if [[ -z "$payload" ]]; then
      # A response that opened the payload but never closed it is the signature of the
      # invoke-response cap, not of a pod-side failure — say so, since the two want
      # opposite responses (shrink the chunk vs go look at the cluster).
      squeezed="$(printf '%s' "$raw" | tr -d '[:space:]')"
      if [[ "$squeezed" == *__TCAB_B64_BEGIN__* && "$squeezed" != *__TCAB_B64_END__* ]]; then
        echo "  ✗ ${RUN_ID}: chunk ${chunk} came back truncated (${#squeezed} bytes, no end marker)" >&2
        echo "     — the invoke response hit its size cap; retry with a smaller CHUNK_BYTES" >&2
      else
        echo "  ✗ ${RUN_ID}: chunk ${chunk} came back empty or unparseable" >&2
        printf '%s\n' "${raw:0:400}" >&2
      fi
      pull_failed=1
      break
    fi
    if ! printf '%s' "$payload" | base64 -d >> "$tgz"; then
      echo "  ✗ ${RUN_ID}: chunk ${chunk} did not decode as base64" >&2
      pull_failed=1
      break
    fi
    offset=$(( offset + CHUNK_BYTES ))
  done

  # Best-effort cleanup of the staged tarball, whether or not the pull finished — it
  # sits on the artifact pod's writable layer, not the PVC, but leaving copies of
  # every extracted run there is still needless.
  # shellcheck disable=SC2016  # cluster-side expansion again
  invoke 'rm -f "/tmp/tcab-extract-$1.tgz"
echo __TCAB_OK__' "$RUN_ID" >/dev/null 2>&1 || true

  if (( pull_failed )); then
    fail=1
    continue
  fi

  # The decoded bytes must match what the pod tarred; a short read means a chunk was
  # truncated in transit, and untarring it would leave a plausible-looking partial
  # tree. Fail loudly instead.
  got="$(wc -c < "$tgz")"
  if [[ "$got" != "$size" ]]; then
    echo "  ✗ ${RUN_ID}: transferred ${got} bytes but the tarball is ${size} (truncated — try a smaller CHUNK_BYTES)" >&2
    fail=1
    continue
  fi

  OUT="${DEST}/${RUN_ID}"
  mkdir -p "$DEST"
  rm -rf "$OUT"
  echo "  → ${RUN_ID}: unpacking → ${OUT}/"
  # The archive's top-level entry is <run-id>/, so extracting into $DEST lands the
  # tree at $DEST/<run-id>/ — the same layout scripts/extract-assets.sh produces.
  tar -C "$DEST" -xzf "$tgz"

  # Surface the asset media so it's obvious what landed (and where run-record.json
  # maps each file). PNGs are the drawn sprites; *.json under the actions tree are
  # the recorded draw-operation logs.
  echo "    files:"
  find "$OUT" -maxdepth 4 \( -name '*.png' -o -name 'run-record.json' \) \
    -printf '      %P\n' 2>/dev/null | sort || true
done

echo "done. extracted under: ${DEST}/"
[[ $fail -eq 0 ]] || { echo "(one or more run ids failed)" >&2; exit 1; }
