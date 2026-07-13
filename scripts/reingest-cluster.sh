#!/usr/bin/env bash
# Publish test-case catalog changes to a REMOTE (prod/staging) backend on AKS, on demand.
#
# The in-pod ingest sidecar ingests only once, on backend start, to self-heal the
# ephemeral (emptyDir) definition store after a pod reschedule. It does NOT re-ingest
# on a schedule: a periodic force re-ingest rewrites every version and briefly leaves
# each one manifest-less, which 404s ("… is not ingested") any run that resolves its
# version mid-cycle. So after you push edits to a test-case version, run this to
# refresh the backend's checkout and force a re-ingest. The backend swaps each version
# into place atomically, so this is safe to run while runs are executing.
#
# It drives the cluster with `az aks command invoke`, so it needs only an
# authenticated `az` (no local kubeconfig or port-forward). The invoked command execs
# into the backend pod's `ingest` sidecar — which already carries git + curl and
# mounts the /state/checkout the backend ingests from — to `git fetch` the latest
# pushed HEAD and POST a forced ingest over localhost (the NetworkPolicy admits only
# intra-pod traffic to the backend).
#
# A case's identity is the `slug` its test-case.toml declares (NOT its folder name; the
# two usually match but can differ — carom/ pins slug = "pong"). A WHOLE-CATALOG
# re-ingest (no slug args) also PRUNES the store: any (slug, version) the checkout no
# longer declares is dropped, EXCEPT one a published/pending run still references (kept
# so the run stays resolvable and keeps its case metadata in the snapshot). So a folder
# rename that keeps its slug, or a deleted run-less case, self-heals on the next full
# re-ingest here — no pod restart / rebuild-from-empty needed. A scan scoped to slug
# args never prunes (it hasn't seen the whole catalog); target by slug or folder name.
#
# Usage (the target environment is REQUIRED):
#   scripts/reingest-cluster.sh --env prod                # force re-ingest every case
#   scripts/reingest-cluster.sh --env staging carom       # scope to one case slug
#   scripts/reingest-cluster.sh --env prod carom coil     # scope to several
#
# The cluster, namespace, and the git ref the backend checkout tracks all come from
# scripts/lib/env.sh for the chosen env.
set -euo pipefail

# Resolve the target environment from a REQUIRED --env <prod|staging> (scripts/lib/env.sh);
# any remaining args are case slugs. No default, so a re-ingest can never silently hit prod.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env=""
slugs=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) env="${2:-}"; shift 2 ;;
    --env=*) env="${1#*=}"; shift ;;
    *) slugs+=("$1"); shift ;;
  esac
done
# shellcheck source=scripts/lib/env.sh
source "${script_dir}/lib/env.sh"
tcab_env_resolve "$env" || exit $?
if (( ${#slugs[@]} )); then set -- "${slugs[@]}"; else set --; fi
resource_group="$TCAB_RG"
cluster="$TCAB_CLUSTER"
namespace="$TCAB_NAMESPACE"

# Build the ingest request body. With no slugs, scan everything; otherwise restrict
# the scan to the given slugs. Always force, so an unchanged version string (the store
# is immutable per version) is overwritten with the freshly pushed definition.
if [[ $# -eq 0 ]]; then
  body='{"force": true}'
  scope="every case"
else
  cases=""
  for slug in "$@"; do
    cases+="\"${slug}\","
  done
  body="{\"testCases\": [${cases%,}], \"force\": true}"
  scope="$*"
fi

echo "Re-ingesting ${scope} on ${cluster}/${namespace} (force)…"

# The remote script runs cluster-side in an `az aks command invoke` helper pod. It
# execs the backend's `ingest` sidecar to refresh the checkout, then triggers ingest.
# The JSON body is passed as a positional arg to the innermost `sh` (`$1`) rather than
# interpolated into the script text, so its quotes never collide with the surrounding
# shells. `--fail-with-body` keeps a render error's message (and a non-2xx exit) from
# vanishing. The heredoc is unquoted so ${namespace}/${body} expand here, while \$…
# stays literal for the cluster-side shells.
remote=$(cat <<REMOTE
set -e
kubectl -n ${namespace} exec deploy/tcab-backend -c ingest -- sh -c 'set -e
echo "ingest: refreshing /state/checkout"
git -C /state/checkout fetch --depth 1 origin ${TCAB_INGEST_REF}
git -C /state/checkout reset --hard FETCH_HEAD
echo "ingest: triggering forced re-ingest"
curl -sS --fail-with-body -X POST http://127.0.0.1:8787/ingest -H "content-type: application/json" --data "\$1"
echo' sh '${body}'
REMOTE
)

az aks command invoke \
  --resource-group "${resource_group}" \
  --name "${cluster}" \
  --command "${remote}"

echo "Done. If a reference failed to render, the message is in the output above."
