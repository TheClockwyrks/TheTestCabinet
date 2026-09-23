#!/usr/bin/env bash
# Rolls one environment's cluster to the images of one commit and waits for every
# workload to become ready.
#
#   scripts/ci/deploy.sh <staging|prod> <sha>
#   scripts/ci/deploy.sh --render <staging|prod> <sha>
#
# It renders deployments/k8s/overlays/azure-<env> through a throwaway kustomization
# layered over it into one manifest file. The layer sets every service image to
# `testcabinet.azurecr.io/<image>:<sha>`, and points the dispatcher's driver and
# publisher images and the run-container registry and tag (TCAB_CONTAINER_REGISTRY,
# TCAB_CONTAINER_TAG) at the same registry and sha. The overlays carry no image tags
# of their own, so this is the one place a deployment's images are chosen. The
# checkout is left as it was. `--render` prints that file and touches no cluster;
# scripts/ci/k8s-manifests.sh gates on the same bytes.
#
# The clusters' API servers are private, so every kubectl command runs inside the
# cluster through `az aks command invoke`, which uploads the rendered file with it.
# The command runs under the caller's Microsoft Entra identity, which needs:
#
#   - "Azure Kubernetes Service RBAC Admin" on the environment's namespace
#     (`<cluster id>/namespaces/tcab-<env>`), the Kubernetes permission that decides
#     what may be applied. Everything the overlay renders is namespaced, and the script
#     refuses a render that is not.
#   - "Test Cabinet AKS Command Invoke" on the cluster
#     (deployments/azure/aks-command-invoke.role.json): run a command and read its
#     result, and nothing else on the cluster resource.
#
# Each Deployment and StatefulSet in the file is then waited on. A rollout that does
# not become ready is described, its logs are printed, and it is undone before the
# script fails.
#
# The pipeline runs this after the images stage pushed <sha>. Run by hand, signed in
# to Azure with the same access, it rolls to any sha the registry holds, which is
# also how an earlier commit is put back.
set -euo pipefail
# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

readonly TIMEOUT="600s"

render=""
if [[ "${1:-}" == --render ]]; then
	render=1
	shift
fi
if [[ $# -ne 2 ]]; then
	echo "usage: scripts/ci/deploy.sh [--render] <staging|prod> <sha>" >&2
	exit 1
fi
readonly ENVIRONMENT="$1"
readonly SHA="$2"

case "$ENVIRONMENT" in
	staging | prod) ;;
	*)
		echo "deploy.sh: unknown environment '${ENVIRONMENT}' (expected staging or prod)" >&2
		exit 1
		;;
esac
readonly CLUSTER="testcabinet-${ENVIRONMENT}-westus2-aks"
readonly RESOURCE_GROUP="testcabinet-${ENVIRONMENT}-westus2-rg"
readonly NAMESPACE="tcab-${ENVIRONMENT}"
readonly OVERLAY="azure-${ENVIRONMENT}"

# Beside the overlay, because kustomize reaches a base by relative path only.
layer="$(mktemp -d "deployments/k8s/overlays/.deploy-XXXXXX")"
work="$(mktemp -d)"
trap 'rm -rf "$layer" "$work"' EXIT
readonly manifest="${work}/tcab-${ENVIRONMENT}.yaml"

images=""
for image in tcab-backend tcab-auth-service tcab-dispatcher tcab-driver tcab-artifacts \
	tcab-arena tcab-publisher tcab-web; do
	images+="  - name: REPLACE_REGISTRY/${image}
    newName: ${CI_REGISTRY}/${image}
    newTag: \"${SHA}\"
"
done

cat >"${layer}/kustomization.yaml" <<YAML
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../${OVERLAY}
images:
${images}patches:
  - target:
      kind: Deployment
      name: tcab-dispatcher
    patch: |-
      apiVersion: apps/v1
      kind: Deployment
      metadata:
        name: tcab-dispatcher
      spec:
        template:
          spec:
            containers:
              - name: dispatcher
                env:
                  - name: TCAB_DRIVER_IMAGE
                    value: "${CI_REGISTRY}/tcab-driver:${SHA}"
                  - name: TCAB_PUBLISHER_IMAGE
                    value: "${CI_REGISTRY}/tcab-publisher:${SHA}"
                  - name: TCAB_CONTAINER_REGISTRY
                    value: "${CI_REGISTRY}"
                  - name: TCAB_CONTAINER_TAG
                    value: "${SHA}"
YAML

kubectl kustomize "$layer" >"$manifest"
if [[ -n "$render" ]]; then
	cat "$manifest"
	exit 0
fi

# The deploy identity may write this namespace and nothing else, so an object outside
# it would fail half-way through the apply. Refuse before touching the cluster.
if ! ci_assert_namespaced "$NAMESPACE" <"$manifest"; then
	echo "deploy.sh: ${OVERLAY} renders objects outside ${NAMESPACE}; move them under deployments/k8s/cluster/." >&2
	exit 1
fi

# Runs a shell command inside the cluster, with any files named after it uploaded to
# its working directory. Prints the command's output and returns its exit code.
invoke() {
	local command="$1" result code
	shift
	local files=()
	for file in "$@"; do
		files+=(--file "$file")
	done
	result="$(az aks command invoke --resource-group "$RESOURCE_GROUP" --name "$CLUSTER" \
		--command "$command" "${files[@]}" --output json --only-show-errors)"
	jq -r '.logs // ""' <<<"$result"
	code="$(jq -r '.exitCode // 1' <<<"$result")"
	return "$code"
}

log "applying ${OVERLAY} at ${SHA} to ${CLUSTER}"
invoke "kubectl apply -f $(basename "$manifest")" "$manifest"

workloads=()
while read -r kind _ name; do
	case "$kind" in
		Deployment) workloads+=("deployment/${name}") ;;
		StatefulSet) workloads+=("statefulset/${name}") ;;
	esac
done < <(ci_manifest_index <"$manifest")

failed=()
for workload in "${workloads[@]}"; do
	log "waiting for ${workload}"
	if invoke "kubectl -n ${NAMESPACE} rollout status ${workload} --timeout=${TIMEOUT}"; then
		continue
	fi
	echo "deploy.sh: ${workload} did not become ready at ${SHA}. Rolling it back." >&2
	invoke "kubectl -n ${NAMESPACE} describe ${workload}; kubectl -n ${NAMESPACE} logs ${workload} --all-containers --tail=100" >&2 || true
	invoke "kubectl -n ${NAMESPACE} rollout undo ${workload} && kubectl -n ${NAMESPACE} rollout status ${workload} --timeout=${TIMEOUT}" >&2 || true
	failed+=("$workload")
done

if ((${#failed[@]})); then
	echo "deploy.sh: rolled back ${failed[*]}; ${ENVIRONMENT} is not at ${SHA}." >&2
	exit 1
fi
log "${ENVIRONMENT} is at ${SHA}"
