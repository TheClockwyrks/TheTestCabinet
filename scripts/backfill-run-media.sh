#!/usr/bin/env bash
# Backfill published runs' proof + asset media into a REMOTE (prod/staging) backend store,
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
# backend container — the same robust "arg, not stdin redirect" shape reingest-cluster.sh
# uses (az does not run --command through a shell, so `< file`/`|` in --command do not
# work; a pipe inside the container's own `sh -c` does).
#
# Usage (the target environment is REQUIRED):
#   scripts/backfill-run-media.sh --env prod                    # DRY RUN (read-only)
#   scripts/backfill-run-media.sh --env prod --apply            # copy media + refresh
#   RUN_ID=<id> scripts/backfill-run-media.sh --env staging --apply   # one run (repair)
#
# The cluster, namespace, and artifact URL for the chosen env come from
# scripts/lib/env.sh; ARTIFACTS still overrides the artifact URL if needed.
set -euo pipefail

# Resolve the target environment from a REQUIRED --env <prod|staging> (scripts/lib/env.sh);
# --apply switches from the default dry run to the real copy. No default env, so this
# can never silently touch prod.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env=""
apply="0"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) env="${2:-}"; shift 2 ;;
    --env=*) env="${1#*=}"; shift ;;
    --apply) apply="1"; shift ;;
    *) echo "unknown argument: $1 (usage: $0 --env <prod|staging> [--apply])" >&2; exit 2 ;;
  esac
done
# shellcheck source=scripts/lib/env.sh
source "${script_dir}/lib/env.sh"
tcab_env_resolve "$env" || exit $?
resource_group="$TCAB_RG"
cluster="$TCAB_CLUSTER"
namespace="$TCAB_NAMESPACE"
# The artifact service's PUBLIC read URL (the value the backend reports as
# `artifactsUrl` via GET /config, reachable from the backend pod's internet egress);
# still overridable via ARTIFACTS.
artifacts="${ARTIFACTS:-$TCAB_ARTIFACTS_PUBLIC_URL}"
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
