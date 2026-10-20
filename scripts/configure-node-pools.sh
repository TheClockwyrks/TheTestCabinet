#!/usr/bin/env bash
# Apply the node pool upgrade settings that hold a drain until the run pods on a
# node have finished (apps/docs/src/content/docs/deployment/kubernetes/run-plane.md,
# "Node pool upgrade settings"):
#
#   drainTimeoutInMinutes    1440      the AKS maximum, above the longest run
#   undrainableNodeBehavior  Schedule  a node still holding a run pod at the
#                                      timeout is returned to service and retried
#   maxSurge                 10%       surge nodes take new runs meanwhile
#   maxUnavailable           0         capacity never drops during an upgrade
#
# They go on every node pool that can seat a run pod: every User pool, and every
# System pool without a NoSchedule or NoExecute taint (run pods carry no
# tolerations, so an untainted System pool seats them as well). A System pool
# tainted, say, CriticalAddonsOnly=true:NoSchedule is left alone.
#
# The settings are Azure control-plane configuration on the pools, not Kubernetes
# objects, so no overlay can carry them; this script is their declarative home. It
# is idempotent: every run re-asserts the values and prints the resulting
# upgradeSettings. A node pool added later is configured by running it again.
#
# Prerequisites: `az` logged in, its subscription set to the one holding the
# cluster, with rights to update the cluster's node pools.
#
# Usage (the target environment is REQUIRED):
#   scripts/configure-node-pools.sh --env prod
#   scripts/configure-node-pools.sh --env staging
#
# The cluster + resource group for the chosen env come from scripts/lib/env.sh.
set -euo pipefail

DRAIN_TIMEOUT_MINUTES=1440
UNDRAINABLE_NODE_BEHAVIOR=Schedule
MAX_SURGE=10%
MAX_UNAVAILABLE=0

# Resolve the target environment from a REQUIRED --env <prod|staging> (scripts/lib/env.sh);
# no default, so this can never silently reconfigure prod.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) env="${2:-}"; shift $(( $# > 1 ? 2 : 1 )) ;;
    --env=*) env="${1#*=}"; shift ;;
    *) echo "unknown argument: $1 (usage: $0 --env <prod|staging>)" >&2; exit 2 ;;
  esac
done
# shellcheck source=scripts/lib/env.sh
source "${script_dir}/lib/env.sh"
tcab_env_resolve "$env" || exit $?
RG="$TCAB_RG"
CLUSTER="$TCAB_CLUSTER"

command -v az >/dev/null || { echo "az (Azure CLI) is required but not installed." >&2; exit 1; }

# One line per pool: name, mode and its taints joined by commas (empty for none).
pool_list="$(az aks nodepool list -g "$RG" --cluster-name "$CLUSTER" \
  --query "[].[name, mode, join(',', nodeTaints || \`[]\`)]" -o tsv)"

pools=()
while IFS=$'\t' read -r name mode taints; do
  [[ -n "$name" ]] || continue
  if [[ "$mode" == "User" ]]; then
    pools+=("$name")
  elif [[ ",${taints}," == *":NoSchedule,"* || ",${taints}," == *":NoExecute,"* ]]; then
    echo "skipping ${name} (${mode} pool tainted ${taints}; it seats no run pod)"
  else
    pools+=("$name")
  fi
done <<<"$pool_list"

if [[ ${#pools[@]} -eq 0 ]]; then
  echo "error: ${CLUSTER} has no node pool that can seat a run pod" >&2
  exit 1
fi

for pool in "${pools[@]}"; do
  echo "configuring ${CLUSTER}/${pool}: drain timeout ${DRAIN_TIMEOUT_MINUTES}m, undrainable ${UNDRAINABLE_NODE_BEHAVIOR}, surge ${MAX_SURGE}, unavailable ${MAX_UNAVAILABLE}…"
  az aks nodepool update -g "$RG" --cluster-name "$CLUSTER" -n "$pool" \
    --drain-timeout "$DRAIN_TIMEOUT_MINUTES" \
    --undrainable-node-behavior "$UNDRAINABLE_NODE_BEHAVIOR" \
    --max-surge "$MAX_SURGE" \
    --max-unavailable "$MAX_UNAVAILABLE" \
    -o none
  echo "${pool} upgradeSettings:"
  az aks nodepool show -g "$RG" --cluster-name "$CLUSTER" -n "$pool" \
    --query upgradeSettings -o jsonc
done

echo "done — ${#pools[@]} node pool(s) of ${CLUSTER} hold a drain until their run pods finish."
