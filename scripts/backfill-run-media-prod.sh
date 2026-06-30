#!/usr/bin/env bash
# Backfill published runs' proof + asset media into the REMOTE (prod) backend store,
# then trigger a snapshot refresh, so the public site can display media for runs that
# were published before the driver started mirroring it (see
# scripts/backfill-run-media.mjs for the why and the per-run logic).
#
# Why it runs cluster-side: the backend's media-upload routes are ungated only on the
# private network, and the prod NetworkPolicy admits just intra-pod traffic to the
# backend — so the copy must POST from inside the backend pod (over localhost). The
# pod also already carries a Node runtime (it shells out to Playwright at ingest), so
# we run the backfill as a plain `node` script with no extra tooling. The pod cannot
# reach the artifact service over its in-cluster ClusterIP (a NetworkPolicy blocks
# that), so the script pulls each run's media from the artifact service's PUBLIC URL
# (the same ungated read endpoint the site loads media from), which the pod reaches
# via its normal internet egress. The backend store is an ephemeral emptyDir in prod,
# so the script's final `POST /snapshot/refresh` is what makes the result durable: it
# re-exports the store (now carrying the media) to R2, which the site reads.
#
# It drives the cluster with `az aks command invoke` (only an authenticated `az` is
# needed — no local kubeconfig or port-forward). The Node script is base64-encoded
# and passed as a positional arg, then decoded and piped to `node -` inside the
# backend container — the same robust "arg, not stdin redirect" shape reingest-prod.sh
# uses (az does not run --command through a shell, so `< file`/`|` in --command do not
# work; a pipe inside the container's own `sh -c` does).
#
# Usage:
#   scripts/backfill-run-media-prod.sh                 # DRY RUN (read-only): report
#                                                      #   what would be copied
#   scripts/backfill-run-media-prod.sh --apply         # copy media + refresh snapshot
#   RUN_ID=<id> scripts/backfill-run-media-prod.sh --apply   # one run (re-run/repair)
#
# Override the target cluster / artifact URL (defaults match prod westus2):
#   RESOURCE_GROUP=… CLUSTER=… NAMESPACE=… ARTIFACTS=… scripts/backfill-run-media-prod.sh
set -euo pipefail

resource_group="${RESOURCE_GROUP:-testcabinet-prod-westus2-rg}"
cluster="${CLUSTER:-testcabinet-prod-westus2-aks}"
namespace="${NAMESPACE:-tcab-prod}"
# The artifact service's PUBLIC read URL — the value the backend reports as
# `artifactsUrl` via GET /config, reachable from the backend pod's internet egress.
artifacts="${ARTIFACTS:-https://artifacts.tcab.testcabinet.ai}"

apply="0"
if [[ "${1:-}" == "--apply" ]]; then
  apply="1"
elif [[ $# -gt 0 ]]; then
  echo "unknown argument: $1 (use --apply, or no argument for a dry run)" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Encode the Node script to a single base64 token (no whitespace), so it survives as
# one positional arg through bash -> az -> kubectl -> the container shell.
b64="$(base64 -w0 < "${script_dir}/backfill-run-media.mjs")"
mode_label=$([[ "${apply}" == "1" ]] && echo "APPLY (copy + refresh)" || echo "DRY RUN (read-only)")

echo "Backfilling run media on ${cluster}/${namespace} via ${artifacts} — ${mode_label}…"

# Inside the backend container: configuration via env, then a shell that decodes the
# base64 arg ($1) and runs it through node. `printf %s` (not echo) keeps the token
# byte-exact. The pipe runs in the container's own `sh -c`, so it is honored.
remote="kubectl -n ${namespace} exec deploy/tcab-backend -c backend -- \
env BACKEND=http://127.0.0.1:8787 ARTIFACTS=${artifacts} APPLY=${apply} RUN_ID=${RUN_ID:-} \
sh -c 'printf %s \"\$1\" | base64 -d | node -' sh ${b64}"

az aks command invoke \
  --resource-group "${resource_group}" \
  --name "${cluster}" \
  --command "${remote}"

echo "Done."
