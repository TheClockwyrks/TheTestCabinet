#!/usr/bin/env bash
# Deletes the backend Deployment of its old name, `tcab-backend`, from one namespace.
#
#   scripts/ci/retire-legacy-backend.sh [--dry-run]
#
# The backend's Deployment is now `the-test-cabinet-backend`, the name the workspace
# template's deploy script waits on. A namespace deployed before the rename still
# runs `tcab-backend`, whose pod holds the ReadWriteOnce claim `tcab-backend-state`
# that the renamed Deployment mounts, so the new pod would wait on the disk until
# the rollout timed out. This deletes the old Deployment, and waits for its pods to
# be gone, before anything is applied. It is idempotent: once the Deployment is
# gone, the delete finds nothing and succeeds, so every deployment runs it.
#
# The cluster's API server is private, so the delete runs inside the cluster
# through `az aks command invoke` (lib.sh's aks_invoke), under the caller's Azure
# identity. Three variables name where, each defaulting to the staging deployment:
#
#   THE_TEST_CABINET_RESOURCE_GROUP  The resource group the cluster sits in
#   THE_TEST_CABINET_CLUSTER         The cluster's name
#   THE_TEST_CABINET_NAMESPACE       The namespace to retire it from
#
# `--dry-run` prints the command it would send, and sends nothing.
#
# Called by scripts/ci/pre-deploy.sh (the staging deployment) and
# scripts/ci/deploy-environment.sh (prod, and any deployment by hand).
set -euo pipefail

# shellcheck source=scripts/ci/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

readonly RESOURCE_GROUP="${THE_TEST_CABINET_RESOURCE_GROUP:-testcabinet-staging-westus2-rg}"
readonly CLUSTER="${THE_TEST_CABINET_CLUSTER:-testcabinet-staging-westus2-aks}"
readonly NAMESPACE="${THE_TEST_CABINET_NAMESPACE:-tcab-staging}"
readonly LEGACY="tcab-backend"

dry_run=""
if [[ "${1:-}" == --dry-run ]]; then
	dry_run=1
	shift
fi
if [[ $# -ne 0 ]]; then
	echo "usage: scripts/ci/retire-legacy-backend.sh [--dry-run]" >&2
	exit 1
fi

# The command, sent as the one file aks_invoke uploads. A foreground cascade makes
# the wait last until the Deployment's pods are gone, which is what frees the disk.
readonly COMMAND="kubectl -n ${NAMESPACE} delete deployment ${LEGACY} --ignore-not-found --cascade=foreground --wait=true --timeout=300s"

if [[ -n "$dry_run" ]]; then
	echo "Would run on ${CLUSTER} (${RESOURCE_GROUP}):"
	echo "    ${COMMAND}"
	exit 0
fi

for tool in az jq; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		echo "retire-legacy-backend.sh: no ${tool} on PATH. az hands the command to the cluster and jq reads its verdict." >&2
		exit 1
	fi
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
printf 'set -eu\n%s\n' "$COMMAND" >"${work}/retire-legacy-backend.sh"

echo "Retiring the legacy Deployment ${LEGACY} from ${NAMESPACE} on ${CLUSTER}."
verdict=0
aks_invoke "$RESOURCE_GROUP" "$CLUSTER" "${work}/retire-legacy-backend.sh" "sh retire-legacy-backend.sh" || verdict=$?
if [[ "$verdict" -ne 0 ]]; then
	echo "retire-legacy-backend.sh: the legacy Deployment ${LEGACY} was not retired from ${NAMESPACE}, above." >&2
	remediation "Nothing was applied. Delete it by hand, then deploy again:" \
		"    az aks command invoke --resource-group ${RESOURCE_GROUP} --name ${CLUSTER} --command \"${COMMAND}\""
	exit 1
fi
echo "The legacy Deployment ${LEGACY} is not in ${NAMESPACE}."
