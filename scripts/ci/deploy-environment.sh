#!/usr/bin/env bash
# Rolls one environment's cluster to the images of one commit and waits for every
# workload to become ready.
#
#   scripts/ci/deploy-environment.sh <staging|prod> <commit>
#   scripts/ci/deploy-environment.sh --render <staging|prod> <commit>
#
# The pipeline's prod stage (.azure/project/stages.yml) deploys prod with it, after
# publishing the backend's image for the commit. Staging is deployed by the workspace
# template's scripts/ci/deploy.sh, with scripts/ci/pre-deploy.sh and
# scripts/ci/post-deploy.sh around it; this rolls staging by hand, onto any commit
# the registry holds, which is also how an earlier commit is put back.
#
# It copies deployments/k8s to a temporary directory and pins the copy's
# overlays/<env> with scripts/ci/pin-images.sh: every Test Cabinet image at
# `testcabinet.azurecr.io/<image>:<commit>` (the backend's repository is
# `the-test-cabinet-backend`), and the dispatcher's driver and publisher images and
# run-container registry and tag at the same registry and commit. The checkout is
# left as it was. `--render` prints that render and touches no cluster;
# scripts/ci/k8s-deploy-sets.sh gates on the same bytes. TCAB_K8S_ROOT names another
# deployments/k8s tree to copy, which is how the gate's test feeds it broken ones.
#
# The clusters' API servers are private, so every kubectl command runs inside the
# cluster through `az aks command invoke` (lib.sh's aks_invoke), which uploads the
# rendered file with it. The command runs under the caller's Microsoft Entra
# identity, which needs:
#
#   - "Azure Kubernetes Service RBAC Admin" on the environment's namespace
#     (`<cluster id>/namespaces/tcab-<env>`), the Kubernetes permission that decides
#     what may be applied. Everything the overlay renders is namespaced, and the
#     script refuses a render that is not.
#   - "Test Cabinet AKS Command Invoke" on the cluster
#     (deployments/azure/aks-command-invoke.role.json): run a command and read its
#     result, and nothing else on the cluster resource.
#
# Before the apply it retires the backend Deployment of its old name
# (scripts/ci/retire-legacy-backend.sh), which holds the backend's disk. After it,
# scripts/ci/settle-workloads.sh --include-backend waits concurrently on every
# Deployment and StatefulSet in the namespace; each that does not become ready is
# described, its logs are printed, and it is undone before the script fails.
set -euo pipefail

caller_dir="$PWD"
CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CI_DIR
# shellcheck source=scripts/ci/lib.sh
source "${CI_DIR}/lib.sh"
# shellcheck source=scripts/ci/tcab-lib.sh
source "${CI_DIR}/tcab-lib.sh"

readonly USAGE="usage: scripts/ci/deploy-environment.sh [--render] <staging|prod> <commit>"
readonly TIMEOUT="600s"

render=""
if [[ "${1:-}" == --render ]]; then
	render=1
	shift
fi
if [[ $# -ne 2 ]]; then
	echo "$USAGE" >&2
	exit 1
fi
readonly ENVIRONMENT="$1"
readonly COMMIT="$2"

case "$ENVIRONMENT" in
	staging | prod) ;;
	*)
		echo "deploy-environment.sh: unknown environment '${ENVIRONMENT}' (expected staging or prod)" >&2
		exit 1
		;;
esac
if ! [[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
	echo "$USAGE" >&2
	echo "deploy-environment.sh: '${COMMIT}' is not a commit" >&2
	exit 1
fi
readonly CLUSTER="testcabinet-${ENVIRONMENT}-westus2-aks"
readonly RESOURCE_GROUP="testcabinet-${ENVIRONMENT}-westus2-rg"
readonly NAMESPACE="tcab-${ENVIRONMENT}"

source_tree="${TCAB_K8S_ROOT:-deployments/k8s}"
if [[ -n "${TCAB_K8S_ROOT:-}" && "$source_tree" != /* ]]; then
	source_tree="${caller_dir}/${source_tree}"
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
readonly manifest="${work}/tcab-${ENVIRONMENT}.yaml"

cp -R "$source_tree" "${work}/k8s"
if ! TCAB_K8S_ROOT="${work}/k8s" "${CI_DIR}/pin-images.sh" "$ENVIRONMENT" "$COMMIT" >&2; then
	echo "deploy-environment.sh: the ${ENVIRONMENT} overlay could not be pinned to ${COMMIT}, above." >&2
	exit 1
fi
kubectl kustomize "${work}/k8s/overlays/${ENVIRONMENT}" >"$manifest"
if [[ -n "$render" ]]; then
	cat "$manifest"
	exit 0
fi

# The deploy identity may write this namespace and nothing else, so an object outside
# it would fail half-way through the apply. Refuse before touching the cluster.
if ! ci_assert_namespaced "$NAMESPACE" <"$manifest"; then
	echo "deploy-environment.sh: overlays/${ENVIRONMENT} renders objects outside ${NAMESPACE}; move them under deployments/k8s/cluster/." >&2
	exit 1
fi

export THE_TEST_CABINET_RESOURCE_GROUP="$RESOURCE_GROUP"
export THE_TEST_CABINET_CLUSTER="$CLUSTER"
export THE_TEST_CABINET_NAMESPACE="$NAMESPACE"
export THE_TEST_CABINET_ROLLOUT_TIMEOUT="$TIMEOUT"

"${CI_DIR}/retire-legacy-backend.sh"

log "applying overlays/${ENVIRONMENT} at ${COMMIT} to ${CLUSTER}"
verdict=0
aks_invoke "$RESOURCE_GROUP" "$CLUSTER" "$manifest" "kubectl apply -f $(basename "$manifest")" || verdict=$?
if [[ "$verdict" -ne 0 ]]; then
	echo "deploy-environment.sh: the apply of ${COMMIT} to ${NAMESPACE} did not succeed, above." >&2
	exit 1
fi

if ! "${CI_DIR}/settle-workloads.sh" --include-backend "$COMMIT"; then
	echo "deploy-environment.sh: rolled back what did not become ready; ${ENVIRONMENT} is not at ${COMMIT}." >&2
	exit 1
fi
log "${ENVIRONMENT} is at ${COMMIT}"
