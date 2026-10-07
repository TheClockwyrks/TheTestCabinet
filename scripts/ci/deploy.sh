#!/usr/bin/env bash
# Rolls the staging overlay onto one published commit and waits for it to run.
#
#   scripts/ci/deploy.sh <commit>
#
# It renders deployments/k8s/overlays/staging with the server's image set to <commit>
# and applies the render on the cluster the pipeline deploys to. The pipeline's
# deploy stage runs it once the publish stage pushed that commit's images. Run
# by hand, it rolls the overlay onto any commit the registry holds, which is
# also how an earlier commit is put back.
#
# The tag is set in a throwaway kustomization layered over the overlay, so the
# checkout is left as it was and the overlay pins no commit of its own.
#
# The cluster is private, so nothing here holds a kubeconfig. The render is
# handed to `az aks command invoke`, which runs kubectl inside the cluster
# under the caller's identity, and the exit code the command's result reports
# is the verdict. The caller is signed in to Azure: the pipeline through its
# service connection, an operator through `az login`.
#
# Five variables decide the rest:
#
#   THE_TEST_CABINET_REGISTRY         The registry the overlay pins
#   THE_TEST_CABINET_RESOURCE_GROUP   The resource group the cluster sits in
#   THE_TEST_CABINET_CLUSTER          The cluster's name
#   THE_TEST_CABINET_NAMESPACE        The namespace the overlay places the base in
#   THE_TEST_CABINET_ROLLOUT_TIMEOUT  How long a rollout is given, as kubectl spells it
#
# Each defaults to the name the fleet's convention gives it from the project's
# slug, so a roll by hand needs the commit alone. The pipeline sets the first
# three from its variables, which are named by the same convention.
#
# Once the rollout is ready, the script runs the project's own post-deploy
# hook, scripts/ci/post-deploy.sh, where the project has one: the work that
# needs the rolled-out server, such as registering what it serves. The hook is
# given the commit and the five variables above, as this run resolved them, and
# may source lib.sh for aks_invoke. A hook that fails fails the run and leaves
# the rollout in place, because the server it rolled out is ready; running the
# hook again, or the next deployment, finishes the work. A project without one
# deploys exactly as before.
#
# Called by the pipeline's deploy stage rather than by the commit hook;
# runnable by hand from any working directory.
set -euo pipefail

# shellcheck source=scripts/ci/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

USAGE="Usage: scripts/ci/deploy.sh <commit>"

REGISTRY="${THE_TEST_CABINET_REGISTRY:-testcabinet.azurecr.io}"
RESOURCE_GROUP="${THE_TEST_CABINET_RESOURCE_GROUP:-testcabinet-staging-westus2-rg}"
CLUSTER="${THE_TEST_CABINET_CLUSTER:-testcabinet-staging-westus2-aks}"
NAMESPACE="${THE_TEST_CABINET_NAMESPACE:-tcab-staging}"
TIMEOUT="${THE_TEST_CABINET_ROLLOUT_TIMEOUT:-300s}"
OVERLAY="deployments/k8s/overlays/staging"
POST_DEPLOY="scripts/ci/post-deploy.sh"

commit="${1:-}"

# The tags are the commit, so a value that is not one names no image the
# registry holds.
if ! [[ "$commit" =~ ^[0-9a-f]{40}$ ]]; then
	echo >&2 "$USAGE"
	echo >&2 "'${commit}' is not a commit."
	remediation \
		"It is the forty lowercase hex characters of a commit whose images the" \
		"pipeline's publish stage pushed. The registry lists them:" \
		"    az acr repository show-tags --name ${REGISTRY%%.*} --repository the-test-cabinet-backend --orderby time_desc --top 10 -o table"
	exit 1
fi

for tool in kubectl az jq; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		echo >&2 "No $tool on PATH."
		remediation \
			"kubectl renders the overlay, az hands the render to the cluster and" \
			"jq reads the verdict. The devcontainer and the hosted agent carry all" \
			"three."
		exit 1
	fi
done

# Beside the overlay, because kustomize reaches a base by relative path only.
layer="$(mktemp -d "$(dirname "$OVERLAY")/.deploy-XXXXXX")"
render="$(mktemp)"
trap 'rm -rf "$layer" "$render"' EXIT

cat >"$layer/kustomization.yaml" <<KUSTOMIZATION
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../$(basename "$OVERLAY")
images:
  - name: ${REGISTRY}/the-test-cabinet-backend
    newTag: "${commit}"
KUSTOMIZATION

if ! kubectl kustomize "$layer" >"$render"; then
	remediation "The overlay did not render. Reproduce it with:" \
		"    kubectl kustomize $OVERLAY"
	exit 1
fi

rendered="$(grep -cE "image: ${REGISTRY}/the-test-cabinet-backend:${commit}$" "$render" || true)"
if [ "$rendered" -ne 1 ]; then
	echo >&2 "The render carries $rendered of the one image at ${commit}."
	remediation \
		"The layer sets the tag of ${REGISTRY}/the-test-cabinet-backend, which is" \
		"how the staging overlay names it. THE_TEST_CABINET_REGISTRY names the" \
		"registry the overlay spells."
	exit 1
fi

# Runs one shell command inside the cluster, with the render beside it, and
# prints what it wrote; lib.sh's aks_invoke holds the reading of the verdict.
invoke() { # command
	aks_invoke "$RESOURCE_GROUP" "$CLUSTER" "$render" "$1"
}

render_name="$(basename "$render")"

echo "Rolling ${NAMESPACE} on ${CLUSTER} onto ${commit}."
verdict=0
invoke "kubectl apply -f ${render_name} \
	&& kubectl -n ${NAMESPACE} rollout status deployment/the-test-cabinet-backend --timeout=${TIMEOUT}" || verdict=$?
case "$verdict" in
0)
	echo "Deployed ${commit}."
	if [ ! -e "$POST_DEPLOY" ]; then
		exit 0
	fi
	if [ ! -x "$POST_DEPLOY" ]; then
		echo >&2 "deploy.sh: ${commit} is deployed and stays, but $POST_DEPLOY is not executable."
		remediation "Make it executable, commit it, and run the hook on this commit:" \
			"    chmod +x $POST_DEPLOY" \
			"    $POST_DEPLOY ${commit}"
		exit 1
	fi
	echo "Running $POST_DEPLOY on ${commit}."
	if ! env \
		THE_TEST_CABINET_REGISTRY="$REGISTRY" \
		THE_TEST_CABINET_RESOURCE_GROUP="$RESOURCE_GROUP" \
		THE_TEST_CABINET_CLUSTER="$CLUSTER" \
		THE_TEST_CABINET_NAMESPACE="$NAMESPACE" \
		THE_TEST_CABINET_ROLLOUT_TIMEOUT="$TIMEOUT" \
		"./$POST_DEPLOY" "$commit"; then
		echo >&2 "deploy.sh: ${commit} is deployed and stays, but $POST_DEPLOY failed, above."
		remediation "Nothing was rolled back: the rollout is ready. Run the hook again with:" \
			"    $POST_DEPLOY ${commit}"
		exit 1
	fi
	exit 0
	;;
2)
	remediation "Nothing was applied. The caller is signed in to Azure with an" \
		"identity that may run commands on ${CLUSTER}, and the cluster is up:" \
		"    az aks show --resource-group ${RESOURCE_GROUP} --name ${CLUSTER} --query provisioningState"
	exit 1
	;;
3)
	remediation "Nothing was rolled back: the apply and the rollouts may still be" \
		"running. The command above reads their verdict, and the cluster reports" \
		"what it runs:" \
		"    az aks command invoke --resource-group ${RESOURCE_GROUP} --name ${CLUSTER} --command \"kubectl -n ${NAMESPACE} get deployment -o wide\""
	exit 1
	;;
esac

# A rollout that never becomes ready leaves the cluster holding a new revision
# that does not serve. Say why it did not, and put the previous revision back.
echo >&2 "deploy.sh: ${commit} did not become ready. Rolling back."
invoke "kubectl -n ${NAMESPACE} describe pods -l app.kubernetes.io/part-of=the-test-cabinet; \
	kubectl -n ${NAMESPACE} logs deployment/the-test-cabinet-backend --tail=100; \
	kubectl -n ${NAMESPACE} rollout undo deployment/the-test-cabinet-backend; \
	kubectl -n ${NAMESPACE} rollout status deployment/the-test-cabinet-backend --timeout=${TIMEOUT}" >&2 || true
exit 1
