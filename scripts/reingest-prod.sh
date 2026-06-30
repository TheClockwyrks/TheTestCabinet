#!/usr/bin/env bash
# Publish test-case catalog changes to the REMOTE (prod) backend on AKS, on demand.
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
# Usage:
#   scripts/reingest-prod.sh                 # force re-ingest every case
#   scripts/reingest-prod.sh pong            # scope to one case slug
#   scripts/reingest-prod.sh pong snake      # scope to several
#
# Override the target cluster (defaults match the prod westus2 AKS):
#   RESOURCE_GROUP=… CLUSTER=… NAMESPACE=… scripts/reingest-prod.sh
set -euo pipefail

resource_group="${RESOURCE_GROUP:-testcabinet-prod-westus2-rg}"
cluster="${CLUSTER:-testcabinet-prod-westus2-aks}"
namespace="${NAMESPACE:-tcab-prod}"

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
git -C /state/checkout fetch --depth 1 origin HEAD
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
