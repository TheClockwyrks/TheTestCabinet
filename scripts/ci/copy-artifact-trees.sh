#!/usr/bin/env bash
# Copies the run trees the artifacts service's retired StatefulSet held, on the claim
# `artifacts-tcab-artifacts-0`, into the environment's private Blob container
# `run-trees`, in the layout the Deployment reads (microservice-artifacts' store.rs):
#
#   <id>/g/<generation>/<path>   one object per file of the tree
#   <id>/current                 the pointer naming the generation, written last
#
#   scripts/ci/copy-artifact-trees.sh [--dry-run] <staging|prod>
#
# The Deployment reads the container only, so a tree left on the claim (an
# unpublished run awaiting review among them) is a run the console can no longer
# open. Run this before the first deploy that binds the environment's artifacts
# identity, and once more just before it, which copies the trees finished since.
#
# It is idempotent: a run whose pointer is already in the container is skipped, so a
# second pass copies only what the first did not, and a tree the Deployment has
# since replaced is never overwritten. A directory without a run-record.json (the
# old service's `.staging` scratch) is not a run and is not copied.
#
# The copy runs in a pod of the namespace, `tcab-artifact-tree-copy`, which mounts
# the claim read-only and signs in to Azure as the environment's artifacts identity
# (tcab-artifacts-<env>, holding Storage Blob Data Contributor on the container)
# through the `tcab-artifacts` ServiceAccount's federated credential. The claim is
# ReadWriteOnce, so while the StatefulSet's pod still holds it the copy is placed on
# that pod's node. The ServiceAccount is annotated with the identity's client id,
# which the overlay's patch-artifacts-identity.yaml sets on the next deploy anyway.
#
# The cluster's API server is private, so the commands run inside the cluster
# through `az aks command invoke` (lib.sh's aks_invoke), under the caller's Azure
# identity. A pass that outlasts the invocation's polls leaves the pod running; run
# the script again, which waits on that pod rather than starting another.
#
# `--dry-run` prints the files it would send, and sends nothing.
set -euo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CI_DIR
# shellcheck source=scripts/ci/lib.sh
source "${CI_DIR}/lib.sh"

readonly USAGE="usage: scripts/ci/copy-artifact-trees.sh [--dry-run] <staging|prod>"
readonly IMAGE="mcr.microsoft.com/azure-cli:2.91.0"
readonly POD="tcab-artifact-tree-copy"
readonly CLAIM="artifacts-tcab-artifacts-0"

dry_run=""
if [[ "${1:-}" == --dry-run ]]; then
	dry_run=1
	shift
fi
if [[ $# -ne 1 ]]; then
	echo "$USAGE" >&2
	exit 1
fi
readonly ENVIRONMENT="$1"
case "$ENVIRONMENT" in
	staging | prod) ;;
	*)
		echo "copy-artifact-trees.sh: unknown environment '${ENVIRONMENT}' (expected staging or prod)" >&2
		exit 1
		;;
esac
readonly CLUSTER="testcabinet-${ENVIRONMENT}-westus2-aks"
readonly RESOURCE_GROUP="testcabinet-${ENVIRONMENT}-westus2-rg"
readonly NAMESPACE="tcab-${ENVIRONMENT}"
readonly ACCOUNT="tcab${ENVIRONMENT}store"
readonly IDENTITY="tcab-artifacts-${ENVIRONMENT}"

for tool in az jq; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		echo "copy-artifact-trees.sh: no ${tool} on PATH. az hands the commands to the cluster and jq reads its verdict." >&2
		exit 1
	fi
done

if [[ -n "$dry_run" ]]; then
	client_id="CLIENT-ID-OF-${IDENTITY}"
elif ! client_id="$(az identity show --resource-group "$RESOURCE_GROUP" --name "$IDENTITY" --query clientId -o tsv)" || [[ -z "$client_id" ]]; then
	echo "copy-artifact-trees.sh: the identity ${IDENTITY} is not in ${RESOURCE_GROUP}, above; provision it first (deployments/k8s/overlays/${ENVIRONMENT}/patch-artifacts-identity.yaml)." >&2
	exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The pass itself, run in the pod: every run directory on the claim whose pointer is
# not yet in the container is uploaded under a fresh generation, then pointed at.
cat >"${work}/copy.sh" <<EOF
set -eu
az login --service-principal --username "\$AZURE_CLIENT_ID" --tenant "\$AZURE_TENANT_ID" \\
	--federated-token "\$(cat "\$AZURE_FEDERATED_TOKEN_FILE")" --allow-no-subscriptions -o none
blob() { az storage blob "\$@" --account-name ${ACCOUNT} --container-name run-trees --auth-mode login --only-show-errors; }
copied=0
skipped=0
for dir in /artifacts/*/; do
	id="\$(basename "\$dir")"
	[ -f "\${dir}run-record.json" ] || { echo "not a run, left: \$id"; continue; }
	if [ "\$(blob exists --name "\$id/current" --query exists -o tsv)" = true ]; then
		skipped=\$((skipped + 1))
		continue
	fi
	generation="\$(printf '%024x-%s' "\$(date +%s%N)" "\$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')")"
	az storage blob upload-batch --account-name ${ACCOUNT} --destination run-trees \\
		--destination-path "\$id/g/\$generation" --source "\$dir" \\
		--auth-mode login --max-connections 16 --no-progress --only-show-errors -o none
	printf '%s' "\$generation" >/tmp/pointer
	blob upload --name "\$id/current" --file /tmp/pointer --content-type 'text/plain; charset=utf-8' --overwrite -o none
	copied=\$((copied + 1))
	echo "copied \$id (\$(find "\$dir" -type f | wc -l) files)"
done
echo "copied \$copied run trees, skipped \$skipped already in ${ACCOUNT}/run-trees"
EOF

# The pod. `spec` is its last mapping, so the driver appends the node of the
# StatefulSet's pod to it while that pod holds the claim.
cat >"${work}/pod.yaml" <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${POD}
  namespace: ${NAMESPACE}
  labels:
    app.kubernetes.io/name: ${POD}
    azure.workload.identity/use: "true"
spec:
  serviceAccountName: tcab-artifacts
  restartPolicy: Never
  containers:
    - name: copy
      image: ${IMAGE}
      command: ["bash", "/copy/copy.sh"]
      resources:
        requests: { cpu: 250m, memory: 512Mi }
        limits: { memory: 1Gi }
      volumeMounts:
        - { name: trees, mountPath: /artifacts, readOnly: true }
        - { name: copy, mountPath: /copy, readOnly: true }
  volumes:
    - name: trees
      persistentVolumeClaim: { claimName: ${CLAIM}, readOnly: true }
    - name: copy
      configMap: { name: ${POD} }
EOF

# The driver, run in the cluster: start the pass unless one is running, wait on it,
# print what it did and clean up after a pass that succeeded.
cat >"${work}/run.sh" <<EOF
set -eu
ns=${NAMESPACE}
if ! kubectl -n \$ns get pvc ${CLAIM} >/dev/null 2>&1; then
	echo "There is no claim ${CLAIM} in \$ns: nothing to copy."
	exit 0
fi
phase="\$(kubectl -n \$ns get pod ${POD} -o jsonpath='{.status.phase}' 2>/dev/null || true)"
if [ "\$phase" = Succeeded ] || [ "\$phase" = Failed ]; then
	kubectl -n \$ns delete pod ${POD} --wait=true
	phase=""
fi
if [ -z "\$phase" ]; then
	kubectl -n \$ns annotate serviceaccount tcab-artifacts --overwrite azure.workload.identity/client-id=${client_id}
	kubectl -n \$ns create configmap ${POD} --from-file=copy.sh --dry-run=client -o yaml | kubectl apply -f -
	node="\$(kubectl -n \$ns get pod tcab-artifacts-0 -o jsonpath='{.spec.nodeName}' 2>/dev/null || true)"
	{
		cat pod.yaml
		if [ -n "\$node" ]; then echo "  nodeName: \$node"; fi
	} | kubectl apply -f -
fi
echo "Waiting on ${POD} in \$ns."
kubectl -n \$ns wait pod/${POD} --for=jsonpath='{.status.phase}'=Succeeded --timeout=840s || true
phase="\$(kubectl -n \$ns get pod ${POD} -o jsonpath='{.status.phase}')"
kubectl -n \$ns logs ${POD} --tail=-1 || true
case "\$phase" in
	Succeeded)
		kubectl -n \$ns delete pod ${POD} configmap ${POD} --ignore-not-found
		;;
	Pending | Running)
		echo "The pass is still running; run copy-artifact-trees.sh again to wait on it."
		exit 3
		;;
	*)
		kubectl -n \$ns describe pod ${POD} | tail -n 20
		exit 1
		;;
esac
EOF

if [[ -n "$dry_run" ]]; then
	echo "Would run on ${CLUSTER} (${RESOURCE_GROUP}): sh run.sh, with"
	for file in run.sh pod.yaml copy.sh; do
		echo "--- ${file}"
		cat "${work}/${file}"
	done
	exit 0
fi

echo "Copying the run trees on ${CLAIM} in ${NAMESPACE} into ${ACCOUNT}/run-trees."
verdict=0
# az attaches a folder only as `.`, the current one.
(cd "$work" && aks_invoke "$RESOURCE_GROUP" "$CLUSTER" . "sh run.sh") || verdict=$?
if [[ "$verdict" -ne 0 ]]; then
	echo "copy-artifact-trees.sh: the copy did not finish (exit ${verdict}), above. It is idempotent; run it again." >&2
	exit 1
fi
echo "The run trees on ${CLAIM} are in ${ACCOUNT}/run-trees."
