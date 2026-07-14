#!/usr/bin/env bash
# Recover published runs' proof + asset media into a REMOTE (prod/staging) backend
# store from a PRIOR public snapshot prefix, then trigger a snapshot refresh — the
# recreate-recovery path when the backend store AND the artifact service volume were
# both wiped (a cluster delete/recreate), so `scripts/backfill-run-media.sh` (which
# pulls from the artifact service) has nothing to copy. See
# scripts/recover-run-media-from-snapshot.mjs for the why and the per-run logic.
#
# The media bytes still live in R2 under the previous snapshot's prefix (there is no
# snapshot GC), served at the public snapshot read URL. This copies them back into
# the backend store and then `POST /snapshot/refresh` re-exports the store (now
# carrying the media) to a fresh R2 prefix the site reads — making the result durable
# (the backend store is an ephemeral emptyDir in prod).
#
# It runs cluster-side (only an authenticated `az` is needed — no kubeconfig/port-forward):
# the Node script is base64-encoded and passed as a positional arg, decoded, and piped
# to `node -` inside the backend container, which reaches the backend over localhost and
# the public snapshot read URL over its normal internet egress. This is the same robust
# "arg, not stdin redirect" shape reingest-cluster.sh / backfill-run-media.sh use.
#
# Usage (the target environment and source prefix are REQUIRED):
#   scripts/recover-run-media-from-snapshot.sh --env prod --source-prefix snapshots/2026-07-10T1901Z-c921bb6b            # DRY RUN
#   scripts/recover-run-media-from-snapshot.sh --env prod --source-prefix snapshots/2026-07-10T1901Z-c921bb6b --apply    # copy + refresh
#   RUN_ID=<id> scripts/recover-run-media-from-snapshot.sh --env prod --source-prefix <prefix> --apply                   # one run (repair)
#
# The SOURCE PREFIX is the last full snapshot from BEFORE the recreate — the newest
# `snapshots/<id>/` prefix whose per-run documents still carry populated
# `proofMedia`/`assetMedia`. To find it, list the bucket's snapshot prefixes (the
# `TCAB_R2_*` credentials are on the backend pod) and take the newest one older than
# the current `index.json` pointer; the recovery runbook shows the exact command.
#
# The cluster, namespace, and public snapshot read base for the chosen env come from
# scripts/lib/env.sh; SOURCE_BASE overrides the read base if needed.
set -euo pipefail

# Resolve the target environment from a REQUIRED --env <prod|staging> (scripts/lib/env.sh);
# --apply switches from the default dry run to the real copy. No default env, so this
# can never silently touch prod.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env=""
apply="0"
source_prefix=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) env="${2:-}"; shift 2 ;;
    --env=*) env="${1#*=}"; shift ;;
    --apply) apply="1"; shift ;;
    --source-prefix) source_prefix="${2:-}"; shift 2 ;;
    --source-prefix=*) source_prefix="${1#*=}"; shift ;;
    *) echo "unknown argument: $1 (usage: $0 --env <prod|staging> --source-prefix <snapshots/...> [--apply])" >&2; exit 2 ;;
  esac
done
if [[ -z "${source_prefix}" ]]; then
  echo "error: --source-prefix is required (the known-good prior snapshot prefix, e.g. snapshots/2026-07-10T1901Z-c921bb6b)" >&2
  exit 2
fi
# shellcheck source=scripts/lib/env.sh
source "${script_dir}/lib/env.sh"
tcab_env_resolve "$env" || exit $?
resource_group="$TCAB_RG"
cluster="$TCAB_CLUSTER"
namespace="$TCAB_NAMESPACE"
# The public snapshot read base for the env (where the source prefix's objects and
# per-run documents are served), overridable via SOURCE_BASE.
source_base="${SOURCE_BASE:-$TCAB_SNAPSHOT_URL}"

# Encode the Node script to a single base64 token (no whitespace), so it survives as
# one positional arg through bash -> az -> kubectl -> the container shell.
b64="$(base64 -w0 < "${script_dir}/recover-run-media-from-snapshot.mjs")"
mode_label=$([[ "${apply}" == "1" ]] && echo "APPLY (copy + refresh)" || echo "DRY RUN (read-only)")

echo "Recovering run media on ${cluster}/${namespace} from ${source_base}/${source_prefix} — ${mode_label}…"

# Inside the backend container: configuration via env, then a shell that decodes the
# base64 arg ($1) and runs it through node. `printf %s` (not echo) keeps the token
# byte-exact. The pipe runs in the container's own `sh -c`, so it is honored.
remote="kubectl -n ${namespace} exec deploy/tcab-backend -c backend -- \
env BACKEND=http://127.0.0.1:8787 SOURCE_BASE=${source_base} SOURCE_PREFIX=${source_prefix} APPLY=${apply} RUN_ID=${RUN_ID:-} \
sh -c 'printf %s \"\$1\" | base64 -d | node -' sh ${b64}"

az aks command invoke \
  --resource-group "${resource_group}" \
  --name "${cluster}" \
  --command "${remote}"

echo "Done."
